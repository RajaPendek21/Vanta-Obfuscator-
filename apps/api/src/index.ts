import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { authenticate, optionalAuthenticate, createSession, hashPassword, hashToken, verifyPassword } from "./auth.js";
import { pool, requireDatabase } from "./db.js";
import { redis } from "./redis.js";
import { buildQueue, queueConnection } from "./queue.js";
import type { ApiHealth, BuildRequest } from "@vanta/shared";
import type { PoolClient } from "pg";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",").map(v => v.trim()).filter(Boolean);
if (process.env.WEB_APP_URL) {
  try {
    const configured = process.env.WEB_APP_URL;
    allowedOrigins.push(new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).origin);
  } catch { console.warn("WEB_APP_URL is not a valid URL/hostname; configure WEB_ORIGIN explicitly."); }
}
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error("Origin not allowed"));
} }));
app.use(express.json({ limit: "128kb", strict: true }));

// Shared Redis rate limiting, with a bounded in-process fallback for local development.
const windows = new Map<string, { start: number; count: number }>();
function scopedRateLimit(scope: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${scope}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) windows.set(key, { start: now, count: 1 });
    else current.count++;
    const entry = windows.get(key)!;
    if (windows.size > 10_000) {
      for (const [oldKey, value] of windows) {
        if (now - value.start >= windowMs) windows.delete(oldKey);
        if (windows.size <= 9_000) break;
      }
      while (windows.size > 10_000) windows.delete(windows.keys().next().value!);
    }
    if (entry.count > limit) return res.status(429).json({ error: "Too many requests. Try again later." });
    return next();
  };
}
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  const key = `vanta:rate:${req.ip ?? "unknown"}`;
  try {
    if (redis?.isReady) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      if (count > 180) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      return next();
    }
  } catch (error) { console.error("Redis rate limiter fallback:", error); }
  const now = Date.now(), current = windows.get(key);
  if (!current || now - current.start > 60_000) windows.set(key, { start: now, count: 1 });
  else current.count++;
  if ((windows.get(key)?.count ?? 0) > 180) return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
  if (windows.size > 10_000) {
    for (const [entry, window] of windows) {
      if (now - window.start > 60_000) windows.delete(entry);
      if (windows.size <= 9_000) break;
    }
    while (windows.size > 10_000) windows.delete(windows.keys().next().value!);
  }
  return next();
});

app.get("/api/engine/capabilities", (_req, res) => {
  res.json({ target: "luau", parser: "Obscura Luau parser + official Luau compiler validation", buildMode: "Obscura PARANOID VM pipeline", transforms: ["Obscura Luau bytecode compilation", "encrypted bytecode and constants", "polymorphic generated VM runtime"], executesUserCode: false });
});

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(2).max(40).default("Vanta user"),
  inviteCode: z.string().trim().min(8).max(128).optional()
}).strict();
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).strict();

app.post("/api/auth/register", scopedRateLimit("register", 5, 60 * 60_000), async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid registration details", details: parsed.error.flatten() });
  if (!pool) return res.status(503).json({ error: "Database is not configured." });
  const { email, password, displayName, inviteCode } = parsed.data;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    if ((process.env.ACCESS_MODE ?? "public") === "invite_only") {
      const isBootstrapAdmin = email.toLowerCase() === (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").toLowerCase();
      if (!inviteCode && !isBootstrapAdmin) { await client.query("ROLLBACK"); return res.status(403).json({ error: "An invitation code is required." }); }
      if (inviteCode) {
        const invite = await client.query(
          "SELECT id FROM invites WHERE code_hash=$1 AND uses_remaining>0 AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE",
          [hashToken(inviteCode)]
        );
        if (!invite.rowCount) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Invitation code is invalid or expired." }); }
        await client.query("UPDATE invites SET uses_remaining=uses_remaining-1 WHERE id=$1", [invite.rows[0].id]);
      }
    }
    const passwordHash = await hashPassword(password);
    const created = await client.query(
      `INSERT INTO users(email,password_hash,display_name,access_mode,role)
       VALUES(lower($1),$2,$3,$4,CASE WHEN lower($1)=lower($5) AND $5<>'' THEN 'admin' ELSE 'user' END)
       RETURNING id,email,display_name,role,access_mode`,
      [email, passwordHash, displayName, process.env.ACCESS_MODE === "invite_only" ? "invite_only" : "public", process.env.BOOTSTRAP_ADMIN_EMAIL ?? ""]
    );
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await client.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)", [created.rows[0].id, hashToken(token), expiresAt]);
    await client.query("COMMIT");
    return res.status(201).json({ user: created.rows[0], token, expiresAt });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    return next(error);
  } finally { client?.release(); }
});

app.post("/api/auth/login", scopedRateLimit("login", 10, 60_000), async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid login details" });
  try {
    const db = requireDatabase();
    const found = await db.query("SELECT id,email,password_hash,display_name,role,access_mode FROM users WHERE email=lower($1)", [parsed.data.email]);
    if (!found.rowCount || !(await verifyPassword(parsed.data.password, found.rows[0].password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
    const session = await createSession(found.rows[0].id);
    const { password_hash: _passwordHash, ...user } = found.rows[0];
    return res.json({ user, ...session });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: req.user }));
app.post("/api/auth/logout", authenticate, async (req, res, next) => {
  try {
    const token = (req.header("authorization") ?? "").slice(7);
    await requireDatabase().query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
    return res.json({ status: "signed_out" });
  } catch (error) { next(error); }
});

const apiKeySchema = z.object({ name: z.string().trim().min(2).max(40) }).strict();
app.get("/api/keys", authenticate, async (req, res, next) => {
  try {
    const result = await requireDatabase().query(
      "SELECT id,name,key_prefix,last_used_at,created_at,revoked_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC",
      [req.user!.id]
    );
    return res.json({ keys: result.rows });
  } catch (error) { next(error); }
});
app.post("/api/keys", authenticate, async (req, res, next) => {
  const parsed = apiKeySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid API key name." });
  try {
    const rawKey = `vnt_${randomBytes(32).toString("base64url")}`;
    const prefix = rawKey.slice(0, 12);
    const result = await requireDatabase().query(
      "INSERT INTO api_keys(user_id,name,key_prefix,key_hash) VALUES($1,$2,$3,$4) RETURNING id,name,key_prefix,created_at",
      [req.user!.id, parsed.data.name, prefix, hashToken(rawKey)]
    );
    return res.status(201).json({ key: rawKey, record: result.rows[0], warning: "Copy this key now. It cannot be displayed again." });
  } catch (error) { next(error); }
});
app.delete("/api/keys/:keyId", authenticate, async (req, res, next) => {
  try {
    const result = await requireDatabase().query(
      "UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
      [req.params.keyId, req.user!.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Active API key not found." });
    return res.json({ status: "revoked" });
  } catch (error) { next(error); }
});

app.post("/api/admin/invites", authenticate, async (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  const schema = z.object({ uses: z.number().int().min(1).max(100).default(1), expiresInDays: z.number().int().min(1).max(365).optional() }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid invite settings." });
  try {
    const code = `vnt-invite-${randomBytes(18).toString("base64url")}`;
    const expiresAt = parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000) : null;
    const result = await requireDatabase().query(
      "INSERT INTO invites(code_hash,created_by,uses_remaining,expires_at) VALUES($1,$2,$3,$4) RETURNING id,uses_remaining,expires_at,created_at",
      [hashToken(code), req.user!.id, parsed.data.uses, expiresAt]
    );
    await requireDatabase().query("INSERT INTO audit_events(actor_user_id,event_type,metadata) VALUES($1,'invite.created',$2::jsonb)", [req.user!.id, JSON.stringify({ inviteId: result.rows[0].id, uses: parsed.data.uses })]);
    return res.status(201).json({ code, invite: result.rows[0], warning: "Store this invite code securely; it is shown only once." });
  } catch (error) { next(error); }
});

app.get("/api/discord/link", authenticate, async (req, res, next) => {
  try {
    const result = await requireDatabase().query(
      "SELECT discord_user_id,linked_at FROM discord_links WHERE user_id=$1", [req.user!.id]
    );
    return res.json({ linked: Boolean(result.rowCount), account: result.rows[0] ?? null });
  } catch (error) { next(error); }
});

app.post("/api/discord/oauth/start", authenticate, async (req, res, next) => {
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI ?? (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/api/discord/oauth/callback` : "http://localhost:4000/api/discord/oauth/callback");
    if (!clientId || !redirectUri) return res.status(503).json({ error: "Discord OAuth is not configured." });
    const state = randomBytes(32).toString("base64url");
    await requireDatabase().query(
      "INSERT INTO discord_oauth_states(state_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hashToken(state), req.user!.id]
    );
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);
    return res.json({ url: url.toString() });
  } catch (error) { next(error); }
});

app.get("/api/discord/oauth/callback", async (req, res, next) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) return res.status(400).send("Discord authorization was not completed.");
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI ?? (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/api/discord/oauth/callback` : "http://localhost:4000/api/discord/oauth/callback");
  if (!clientId || !clientSecret || !redirectUri) return res.status(503).send("Discord OAuth is not configured.");
  try {
    const db = requireDatabase();
    const claimed = await db.query(
      "DELETE FROM discord_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING user_id",
      [hashToken(state)]
    );
    if (!claimed.rowCount) return res.status(400).send("This Discord link request expired or was already used.");
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(8_000)
    });
    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenData.access_token) return res.status(400).send("Discord did not approve the account link.");
    const discordResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }, signal: AbortSignal.timeout(8_000)
    });
    const discordUser = await discordResponse.json() as { id?: string };
    if (!discordResponse.ok || !discordUser.id) return res.status(400).send("Could not read the Discord account.");
    await db.query(
      `INSERT INTO discord_links(user_id,discord_user_id) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET discord_user_id=EXCLUDED.discord_user_id,linked_at=now()`,
      [claimed.rows[0].user_id, discordUser.id]
    );
    const configuredWebUrl = process.env.WEB_APP_URL ?? "http://localhost:8080";
    const webUrl = /^https?:\/\//i.test(configuredWebUrl) ? configuredWebUrl : `https://${configuredWebUrl}`;
    return res.redirect(`${webUrl.replace(/\/$/, "")}/?discord=linked`);
  } catch (error) { next(error); }
});

app.get("/api/admin/stats", authenticate, async (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  try {
    const [users, builds, keys] = await Promise.all([
      requireDatabase().query("SELECT count(*)::int AS count FROM users"),
      requireDatabase().query("SELECT count(*)::int AS count FROM builds"),
      requireDatabase().query("SELECT count(*)::int AS count FROM api_keys WHERE revoked_at IS NULL")
    ]);
    return res.json({ users: users.rows[0].count, builds: builds.rows[0].count, activeApiKeys: keys.rows[0].count });
  } catch (error) { next(error); }
});
app.get("/api/admin/discord/:discordId", authenticate, async (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  try {
    const result = await requireDatabase().query(
      "SELECT u.id,u.email,u.display_name,u.role,l.discord_user_id,l.linked_at FROM discord_links l JOIN users u ON u.id=l.user_id WHERE l.discord_user_id=$1",
      [req.params.discordId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "No Vanta account is linked to this Discord user." });
    return res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

app.get("/api/account/summary", authenticate, async (req, res, next) => {
  try {
    const db = requireDatabase();
    const [builds, today, keys] = await Promise.all([
      db.query("SELECT count(*)::int AS count FROM builds WHERE user_id=$1", [req.user!.id]),
      db.query("SELECT count(*)::int AS count FROM builds WHERE user_id=$1 AND created_at>=date_trunc('day',now())", [req.user!.id]),
      db.query("SELECT count(*)::int AS count FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL", [req.user!.id])
    ]);
    return res.json({ totalBuilds: builds.rows[0].count, buildsToday: today.rows[0].count, activeApiKeys: keys.rows[0].count, accessMode: req.user!.access_mode });
  } catch (error) { next(error); }
});

app.get("/api/builds/history", authenticate, async (req, res, next) => {
  try {
    const result = await requireDatabase().query(
      "SELECT id,status,target,source_bytes,output_bytes,warnings,created_at,completed_at FROM builds WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [req.user!.id]
    );
    return res.json({ builds: result.rows });
  } catch (error) { next(error); }
});

app.get("/api/builds/:buildId", optionalAuthenticate, async (req, res, next) => {
  try {
    const result = await requireDatabase().query(
      "SELECT id,user_id,status,target,source_bytes,output_bytes,token_count,output_text,warnings,created_at,completed_at FROM builds WHERE id=$1",
      [req.params.buildId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Build not found." });
    const row = result.rows[0];
    if (row.user_id && row.user_id !== req.user?.id) return res.status(404).json({ error: "Build not found." });
    if (row.status !== "completed") return res.status(409).json({ error: "Build is not completed yet.", status: row.status });
    const reductionPercent = row.source_bytes > 0 && row.output_bytes !== null ? Math.max(0, Number(((1 - row.output_bytes / row.source_bytes) * 100).toFixed(2))) : 0;
    return res.json({ build: { ...row, output: row.output_text, stats: { inputBytes: row.source_bytes, outputBytes: row.output_bytes, tokens: row.token_count, reductionPercent } } });
  } catch (error) { next(error); }
});

app.get("/api/health", async (_req, res) => {
  const [databaseReady, queueReady] = await Promise.all([
    pool ? pool.query("SELECT 1").then(() => true).catch(() => false) : Promise.resolve(false),
    queueConnection ? queueConnection.ping().then(() => true).catch(() => false) : Promise.resolve(false)
  ]);
  const ready = Boolean(buildQueue && databaseReady && queueReady);
  const body: ApiHealth = { status: ready ? "ok" : "degraded", service: "vanta-api", version: "0.5.0", engine: "Obscura PARANOID VM (pinned) + official Luau compiler validation" };
  res.status(ready ? 200 : 503).json({ ...body, readiness: ready ? "ready" : "degraded", queue: queueReady ? "ready" : "unavailable", database: databaseReady ? "ready" : "unavailable" });
});

const buildSchema = z.object({
  source: z.string().min(1).max(100_000),
  target: z.literal("luau")
}).strict();

app.post("/api/builds", scopedRateLimit("build-submit", 12, 60_000), optionalAuthenticate, async (req, res, next) => {
  const parsed = buildSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid build request", details: parsed.error.flatten() });
  if (!pool || !buildQueue) return res.status(503).json({ error: "Build queue is unavailable. Check PostgreSQL and Redis." });
  const request: BuildRequest = parsed.data;
  const buildId = randomUUID();
  try {
    const sourceBytes = new TextEncoder().encode(request.source).length;
    const digest = createHash("sha256").update(request.source).digest("hex");
    await pool.query(
      `INSERT INTO builds(id,user_id,status,target,source_bytes,source_digest)
       VALUES($1,$2,'queued',$3,$4,$5)`,
      [buildId, req.user?.id ?? null, request.target, sourceBytes, digest]
    );
    try {
      await buildQueue.add("build", { buildId, source: request.source, userId: req.user?.id ?? null }, {
        jobId: buildId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000
      });
    } catch (queueError) {
      await pool.query("UPDATE builds SET status='failed',error_message='Build queue rejected the job.',completed_at=now() WHERE id=$1", [buildId]);
      throw queueError;
    }
    return res.status(202).json({ buildId, status: "queued", message: "Build accepted and added to the isolated worker queue." });
  } catch (error) { return next(error); }
});

app.get("/api/builds/:buildId/status", optionalAuthenticate, async (req, res, next) => {
  try {
    const result = await requireDatabase().query(
      "SELECT id,user_id,status,warnings,error_message,output_bytes,created_at,completed_at FROM builds WHERE id=$1",
      [req.params.buildId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Build not found." });
    const row = result.rows[0];
    if (row.user_id && row.user_id !== req.user?.id) return res.status(404).json({ error: "Build not found." });
    return res.json({ buildId: row.id, status: row.status, warnings: row.warnings, message: row.error_message ?? undefined, stats: { outputBytes: row.output_bytes }, createdAt: row.created_at, completedAt: row.completed_at });
  } catch (error) { next(error); }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Vanta API request failed:", err);
  res.status(500).json({ error: "Internal server error." });
});
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

async function start() {
  if (redis && !redis.isOpen) {
    try { await redis.connect(); console.log("Vanta Redis rate limiter is ready."); }
    catch (error) { console.error("Redis unavailable; using local rate limiter:", error); }
  }
  if (pool) {
    const migration = await readFile(resolve(process.cwd(), "apps/api/migrations/001_initial.sql"), "utf8");
    await pool.query(migration);
    console.log("Vanta database schema is ready.");
  }
  const server = app.listen(port, () => console.log(`Vanta API listening on http://localhost:${port}`));
  const shutdown = async () => {
    server.close();
    await buildQueue?.close().catch(() => undefined);
    await queueConnection?.quit().catch(() => undefined);
    if (redis?.isOpen) await redis.quit().catch(() => undefined);
    await pool?.end().catch(() => undefined);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

start().catch(error => {
  console.error("Vanta API failed to start:", error);
  process.exitCode = 1;
});
