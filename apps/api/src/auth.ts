import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { requireDatabase } from "./db.js";

const scrypt = promisify(scryptCallback);
const sessionDays = 14;
export type AuthUser = { id: string; email: string; display_name: string; role: string; access_mode: string };
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const db = requireDatabase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await db.query("INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1,$2,$3)", [userId, hashToken(token), expiresAt]);
  return { token, expiresAt };
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || token.length > 256) return res.status(401).json({ error: "Authentication required." });
    const db = requireDatabase();
    const result = await db.query(
      `SELECT u.id,u.email,u.display_name,u.role,u.access_mode
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now()
       UNION ALL
       SELECT u.id,u.email,u.display_name,u.role,u.access_mode
       FROM api_keys k JOIN users u ON u.id=k.user_id
       WHERE k.key_hash=$1 AND k.revoked_at IS NULL
       LIMIT 1`, [hashToken(token)]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Session is invalid or expired." });
    req.user = result.rows[0] as AuthUser;
    await db.query("UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1 AND revoked_at IS NULL", [hashToken(token)]);
    next();
  } catch (error) { next(error); }
}

/** Optional bearer auth: anonymous builds are allowed, but a supplied bad token is rejected. */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  if (!header) return next();
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Invalid authorization header." });
  const token = header.slice(7);
  if (!token || token.length > 256) return res.status(401).json({ error: "Invalid session token." });
  try {
    const result = await requireDatabase().query(
      `SELECT u.id,u.email,u.display_name,u.role,u.access_mode
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now()
       UNION ALL
       SELECT u.id,u.email,u.display_name,u.role,u.access_mode
       FROM api_keys k JOIN users u ON u.id=k.user_id
       WHERE k.key_hash=$1 AND k.revoked_at IS NULL
       LIMIT 1`, [hashToken(token)]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Session is invalid or expired." });
    req.user = result.rows[0] as AuthUser;
    await requireDatabase().query("UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1 AND revoked_at IS NULL", [hashToken(token)]);
    return next();
  } catch (error) { return next(error); }
}
