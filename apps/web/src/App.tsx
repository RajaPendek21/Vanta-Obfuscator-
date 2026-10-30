import { useEffect, useState, type FormEvent } from "react";
import {
  Activity, Bot, Boxes, ChevronRight, Code2, Cpu, FileCode2,
  Gauge, KeyRound, LayoutDashboard, Menu, Settings, ShieldCheck
} from "lucide-react";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

export default function App() {
  const [health, setHealth] = useState("Checking API...");
  const [source, setSource] = useState('-- Paste your Luau code here\nprint("Hello from Vanta")');
  const [notice, setNotice] = useState("");
  const [output, setOutput] = useState("");
  const [buildStats, setBuildStats] = useState<{ inputBytes: number; outputBytes: number; tokens: number; reductionPercent: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("Overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [token, setToken] = useState(() => sessionStorage.getItem("vanta_token") ?? "");
  const [user, setUser] = useState<{ email: string; display_name: string; role: string } | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ id: string; status: string; created_at: string; output_bytes: number | null }>>([]);
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string; key_prefix: string; created_at: string; revoked_at: string | null }>>([]);
  const [keyName, setKeyName] = useState("My API key");
  const [newKey, setNewKey] = useState("");
  const [summary, setSummary] = useState<{ totalBuilds: number; buildsToday: number; activeApiKeys: number; accessMode: string } | null>(null);
  const [discordAccount, setDiscordAccount] = useState<{ discord_user_id: string; linked_at: string } | null>(null);
  const [discordNotice, setDiscordNotice] = useState("");
  const [historyOutput, setHistoryOutput] = useState("");
  const [inviteUses, setInviteUses] = useState("1");
  const [inviteExpiryDays, setInviteExpiryDays] = useState("7");
  const [createdInvite, setCreatedInvite] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");

  useEffect(() => {
    fetch(`${apiUrl}/api/health`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setHealth(`${data.service} connected`))
      .catch(() => setHealth("API offline — start the backend"));
  }, []);

  useEffect(() => {
    if (!token) { setUser(null); return; }
    sessionStorage.setItem("vanta_token", token);
    fetch(`${apiUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setUser(data.user))
      .catch(() => { sessionStorage.removeItem("vanta_token"); setToken(""); setUser(null); });
  }, [token]);

  useEffect(() => {
    if (!token || page !== "Overview") return;
    fetch(`${apiUrl}/api/account/summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [token, page]);

  useEffect(() => {
    if (!token || page !== "Discord bot") return;
    fetch(`${apiUrl}/api/discord/link`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setDiscordAccount(data.account ?? null))
      .catch(() => setDiscordNotice("Could not load Discord link status."));
  }, [token, page]);

  useEffect(() => {
    if (!token || (page !== "Build history" && page !== "API keys")) return;
    const endpoint = page === "Build history" ? "/api/builds/history" : "/api/keys";
    fetch(`${apiUrl}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => page === "Build history" ? setHistory(data.builds ?? []) : setApiKeys(data.keys ?? []))
      .catch(() => setNotice("Could not load this account page."));
  }, [token, page]);

  async function requestAuth(event: FormEvent) {
    event.preventDefault(); setAuthBusy(true); setAuthNotice("");
    try {
      const response = await fetch(`${apiUrl}/api/auth/${authMode === "login" ? "login" : "register"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authMode === "login" ? { email, password } : { email, password, displayName: displayName || "Vanta user", inviteCode: inviteCode || undefined })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Authentication failed.");
      setToken(data.token); setUser(data.user); setPassword(""); setAuthNotice("Signed in successfully.");
    } catch (error) { setAuthNotice(error instanceof Error ? error.message : "Authentication failed."); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    if (token) await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    sessionStorage.removeItem("vanta_token"); setToken(""); setUser(null); setPage("Overview");
  }

  async function openHistoryBuild(id: string) {
    try {
      const response = await fetch(`${apiUrl}/api/builds/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load build output.");
      setHistoryOutput(data.build.output ?? "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load build output."); }
  }

  async function createApiKey() {
    try {
      const response = await fetch(`${apiUrl}/api/keys`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: keyName }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not create key.");
      setNewKey(data.key); setApiKeys(current => [data.record, ...current]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create key."); }
  }

  async function startDiscordLink() {
    setDiscordNotice("Opening Discord authorization...");
    try {
      const response = await fetch(`${apiUrl}/api/discord/oauth/start`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error ?? "Discord linking is not configured.");
      window.location.assign(data.url);
    } catch (error) { setDiscordNotice(error instanceof Error ? error.message : "Could not start Discord linking."); }
  }

  async function revokeApiKey(id: string) {
    const response = await fetch(`${apiUrl}/api/keys/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setApiKeys(current => current.map(key => key.id === id ? { ...key, revoked_at: new Date().toISOString() } : key));
  }

  async function createInvite() {
    setInviteNotice(""); setCreatedInvite("");
    try {
      const response = await fetch(`${apiUrl}/api/admin/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uses: Number(inviteUses), expiresInDays: Number(inviteExpiryDays) })
      });
      const data = await response.json();
      if (!response.ok || !data.code) throw new Error(data.error ?? "Could not create invitation.");
      setCreatedInvite(data.code);
      setInviteNotice("Invitation created. Copy it now; it will not be shown again.");
    } catch (error) { setInviteNotice(error instanceof Error ? error.message : "Could not create invitation."); }
  }

  async function requestBuild() {
    setBusy(true); setNotice(""); setOutput(""); setBuildStats(null); setWarnings([]);
    try {
      const response = await fetch(`${apiUrl}/api/builds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ source, target: "luau" })
      });
      const accepted = await response.json();
      if (!response.ok || !accepted.buildId) throw new Error(accepted.message ?? accepted.error ?? "Build request failed.");
      setNotice("Build queued. Waiting for an isolated worker...");
      let state = accepted.status as string;
      let statusData: any = null;
      for (let attempt = 0; attempt < 120 && state !== "completed" && state !== "failed"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const statusResponse = await fetch(`${apiUrl}/api/builds/${accepted.buildId}/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.error ?? "Could not check build status.");
        state = statusData.status;
        setNotice(state === "running" ? "Worker is processing your build..." : "Build queued. Waiting for an isolated worker...");
      }
      if (state !== "completed") throw new Error(statusData?.message ?? (state === "failed" ? "Build failed." : "Build timed out. Check build history."));
      const outputResponse = await fetch(`${apiUrl}/api/builds/${accepted.buildId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const outputData = await outputResponse.json();
      if (!outputResponse.ok) throw new Error(outputData.error ?? "Could not retrieve build output.");
      setOutput(outputData.build.output ?? "");
      setBuildStats(outputData.build.stats ?? null);
      setWarnings(outputData.build.warnings ?? []);
      setNotice("Build completed successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cannot reach the build service.");
    } finally { setBusy(false); }
  }

  const nav = [
    [LayoutDashboard, "Overview"],
    [Code2, "Obfuscator"],
    [FileCode2, "Build history"],
    [Bot, "Discord bot"],
    [KeyRound, "API keys"],
    [Settings, "Settings"]
  ] as const;

  return <div className="shell">
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={21}/></div><div><b>VANTA</b><small>OBFUSCATOR</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{nav.map(([Icon, label]) => <button key={label} onClick={() => { setPage(label); setMobileNavOpen(false); }} className={`nav-item ${page === label ? "active" : ""}`}><Icon size={17}/><span>{label}</span>{page === label && <i/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="status-dot"/><span>{health}</span></div>
    </aside>

    <main className="main">
      <header className="topbar"><button className="mobile-menu" aria-label="Toggle navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}><Menu/></button><div className="crumb">Workspace <ChevronRight size={14}/> <b>{page}</b></div><div className="top-right"><span className="plan">{user ? user.email : "GUEST WORKSPACE"}</span>{user ? <button className="secondary" onClick={signOut}>Sign out</button> : <div className="avatar">V</div>}</div></header>
      <div className="content">
        {!user && <section className="auth-card"><div><h2>Your Vanta account</h2><p>Sign in to save build history and manage API keys. You can still try anonymous builds.</p></div><form onSubmit={requestAuth} className="auth-form"><div className="auth-switch"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Sign in</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Create account</button></div>{authMode === "register" && <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name" maxLength={40}/>}<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required/><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (10+ characters for registration)" required minLength={authMode === "register" ? 10 : 1}/>{authMode === "register" && <input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Invite code (if required)"/>}<button className="primary" disabled={authBusy}>{authBusy ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account"}</button>{authNotice && <small>{authNotice}</small>}</form></section>}
        {page === "Build history" ? <section className="page-panel"><h1>Build history</h1>{!user ? <p>Sign in to view saved builds.</p> : history.length ? history.map(item => <div className="history-row" key={item.id}><b>Standard build</b><span>{item.status}</span><small>{new Date(item.created_at).toLocaleString()}</small><button className="secondary" disabled={item.status !== "completed"} onClick={() => openHistoryBuild(item.id)}>View output</button></div>) : <p>No saved builds yet.</p>}{historyOutput && <div className="key-once"><b>Build output</b><textarea className="output-editor" readOnly value={historyOutput}/><button className="secondary" onClick={() => navigator.clipboard.writeText(historyOutput)}>Copy output</button></div>}</section> : page === "API keys" ? <section className="page-panel"><h1>API keys</h1>{!user ? <p>Sign in to manage API keys.</p> : <><div className="key-create"><input value={keyName} onChange={e => setKeyName(e.target.value)} aria-label="API key name"/><button className="primary" onClick={createApiKey}>Create key</button></div>{newKey && <div className="key-once"><b>Copy this key now:</b><code>{newKey}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(newKey)}>Copy</button></div>}{apiKeys.map(key => <div className="history-row" key={key.id}><b>{key.name}</b><span>{key.key_prefix}••••</span><small>{key.revoked_at ? "Revoked" : "Active"}</small>{!key.revoked_at && <button className="secondary" onClick={() => revokeApiKey(key.id)}>Revoke</button>}</div>)}</>}</section> : page === "Discord bot" ? <section className="page-panel"><h1>Discord integration</h1><p>The Vanta bot supports status checks, build requests, linked profiles and administrator statistics.</p>{!user ? <p>Sign in to link your Discord account.</p> : <><p>{discordAccount ? `Linked Discord account: ${discordAccount.discord_user_id}` : "Your Vanta account is not linked to Discord yet."}</p><button className="primary" onClick={startDiscordLink}>{discordAccount ? "Relink Discord account" : "Link Discord account"}</button></>}{discordNotice && <small>{discordNotice}</small>}<p>Configure DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI on the API/bot hosts.</p></section> : page === "Settings" ? <section className="page-panel"><h1>Settings</h1><p>Access mode: {summary?.accessMode ?? "Configured by server"}</p><p>Signed in as: {user?.email ?? "Guest"}</p>{user?.role === "admin" && <div className="key-create" style={{ marginTop: 24, flexWrap: "wrap" }}><div><h2>Invitation codes</h2><p>Create one-time or multi-use registration invitations.</p></div><input aria-label="Invitation uses" type="number" min="1" max="100" value={inviteUses} onChange={e => setInviteUses(e.target.value)}/><input aria-label="Invitation expiry days" type="number" min="1" max="365" value={inviteExpiryDays} onChange={e => setInviteExpiryDays(e.target.value)}/><button className="primary" onClick={createInvite}>Create invitation</button>{createdInvite && <div className="key-once"><b>Copy this invitation:</b><code>{createdInvite}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(createdInvite)}>Copy</button></div>}{inviteNotice && <small>{inviteNotice}</small>}</div>}</section> : <>
        <div className="eyebrow"><span/> PROTECTION WORKSPACE</div>
        <div className="heading-row"><div><h1>Welcome to Vanta.</h1><p className="subheading">Your code protection workspace.</p></div><button className="secondary" onClick={() => setNotice(health)}><Activity size={16}/> System status</button></div>

        <section className="stats">
          <div className="stat-card"><div className="stat-icon"><Boxes/></div><span>Total builds</span><strong>{summary?.totalBuilds ?? (buildStats ? "1" : "—")}</strong><small>{summary ? "Saved account builds" : "Sign in for saved totals"}</small></div>
          <div className="stat-card"><div className="stat-icon"><Gauge/></div><span>Builds today</span><strong>{summary?.buildsToday ?? "—"}</strong><small>{summary ? "Completed and queued builds today" : "Sign in for usage totals"}</small></div>
          <div className="stat-card"><div className="stat-icon"><Cpu/></div><span>Engine status</span><strong className="status-text">Obscura VM</strong><small>Official Luau validation</small></div>
        </section>

        <div className="section-title"><div><h2>New protection build</h2><p>Paste your Luau source and create a protection build. One Obscura-powered Luau engine.</p></div><span className="tag">LUАU TARGET</span></div>
        <section className="editor-card">
          <div className="editor-top"><div><span className="file-dot"/> <b>untitled.luau</b></div><span>EDITOR PREVIEW</span></div>
          <textarea spellCheck={false} value={source} onChange={e => setSource(e.target.value)} aria-label="Luau source code"/>
          <div className="editor-footer"><span>{source.length.toLocaleString()} characters</span><div className="build-controls"><button className="primary" onClick={requestBuild} disabled={busy || !source.trim()}><ShieldCheck size={16}/>{busy ? "Submitting..." : "Obfuscate Luau"}</button></div></div>
          {notice && <div className="notice">{notice}</div>}
          {buildStats && <div className="build-result">
            <div className="result-heading"><div><b>Build output</b><small>Completed · {buildStats.tokens.toLocaleString()} tokens</small></div><button className="secondary" onClick={() => navigator.clipboard.writeText(output)}>Copy output</button></div>
            <div className="result-stats"><span>{buildStats.inputBytes.toLocaleString()} B input</span><span>{buildStats.outputBytes.toLocaleString()} B output</span><span>{buildStats.reductionPercent}% smaller</span></div>
            <textarea className="output-editor" aria-label="Obfuscated Luau output" readOnly spellCheck={false} value={output}/>
            {warnings.map((warning, index) => <p className="disclaimer" key={index}>{warning}</p>)}
          </div>}
          <p className="disclaimer">Vanta runs the pinned Obscura PARANOID virtual-machine pipeline and validates the generated Luau with the official Luau compiler. Obscura supports a subset of Luau syntax; unsupported constructs will fail the build rather than silently return unprotected source.</p>
        </section>

        <div className="bottom-grid">
          <section className="info-card"><div className="info-icon"><Bot/></div><div><h3>Connect your Discord</h3><p>Use the Vanta bot for status, account linking, platform statistics and build commands.</p><span className="muted-link">Discord application credentials required</span></div></section>
          <section className="info-card"><div className="info-icon"><KeyRound/></div><div><h3>Developer API</h3><p>Create API keys to automate Luau builds through authenticated endpoints.</p><span className="muted-link">Session and API-key authentication</span></div></section>
        </div>
        </>}
        <footer>VANTA OBFUSCATOR <span>·</span> LUAU PROTECTION WORKSPACE <span>·</span> v0.5.0</footer>
      </div>
    </main>
  </div>;
}
