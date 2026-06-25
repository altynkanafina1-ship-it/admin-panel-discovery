/**
 * Shashki Royale · Admin API — Cloudflare Pages Function (catch-all)
 *
 * Hardened version after independent audit 2026-06-25.
 * Closes: FIND-007, 008, 009, 014, 015, 019, 022, 030, 031, 032, 039,
 *         040, 041, 042 (server side of cookie session for FIND-006).
 * SQL-side hardening (FIND-001, 003, 004, 013, 026, 035, 036, 037) is
 * delivered by supabase/repair_2026_06.sql and must be applied
 * separately via the Supabase SQL Editor.
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  JWT_SECRET: string;
  JWT_VERSION?: string;              // bump to invalidate all sessions
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD_HASH: string;
  SESSION_TTL_SECONDS?: string;
  ALLOWED_ORIGIN?: string;           // defaults to https://shashki-royale-admin.pages.dev
  LOGIN_RL_MAX?: string;             // max wrong logins per window (default 10)
  LOGIN_RL_WINDOW_S?: string;        // window in seconds (default 60)
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};
const b64urlDecode = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(sig);
}

async function hmacVerify(secret: string, data: string, sig: string): Promise<boolean> {
  // constant-time-ish: sign and compare bytes
  const expected = await hmacSign(secret, data);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function jwtSign(payload: object, secret: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  return `${data}.${await hmacSign(secret, data)}`;
}

interface JwtPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  ver?: string;
}

async function jwtVerify(token: string, env: Env): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const ok = await hmacVerify(env.JWT_SECRET, `${parts[0]}.${parts[1]}`, parts[2]);
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[1]))) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < now) return null;
    if (payload.iss !== "shashki-royale-admin") return null;
    if (payload.aud !== "shashki-royale-admin") return null;
    if ((env.JWT_VERSION || "v1") !== (payload.ver || "v1")) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyPassword(input: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 100_000) return false;            // FIND-027 floor
  const salt = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
  if (salt.length < 16) return false;
  const expected = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));
  if (expected.length < 16) return false;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(input),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const got = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
      keyMaterial,
      expected.length * 8,
    ),
  );
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

function originHeaders(env: Env, req: Request): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN || "https://shashki-royale-admin.pages.dev";
  const reqOrigin = req.headers.get("origin");
  // Reflect only an exact allowed origin; absence is fine for same-origin fetches.
  if (reqOrigin && reqOrigin === allowed) {
    return {
      "access-control-allow-origin": allowed,
      "access-control-allow-credentials": "true",
      "vary": "Origin",
    };
  }
  return { "vary": "Origin" };
}

function json(body: unknown, req: Request, env: Env, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...originHeaders(env, req),
      ...(init.headers ?? {}),
    },
  });
}

async function sb(env: Env, path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
}

function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip") ?? null;
}

async function audit(env: Env, req: Request, data: Record<string, unknown>) {
  try {
    await sb(env, "/rest/v1/admin_audit_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "success", actor_ip: clientIp(req), ...data }),
    });
  } catch {
    /* table may not exist yet — but it does, see admin.sql */
  }
}

interface Auth { email: string; role: string; payload: JwtPayload }

async function getAuth(req: Request, env: Env): Promise<Auth | null> {
  // 1. Prefer HttpOnly cookie set by /api/auth/login.
  // 2. Fall back to Authorization: Bearer for transitional compatibility.
  let token: string | null = null;
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (m) token = decodeURIComponent(m[1]);
  if (!token) {
    const h = req.headers.get("authorization");
    if (h?.startsWith("Bearer ")) token = h.slice(7);
  }
  if (!token) return null;
  const p = await jwtVerify(token, env);
  if (!p) return null;
  return { email: p.sub, role: p.role || "owner", payload: p };
}

function buildSessionCookie(token: string, ttl: number, clear = false): string {
  const maxAge = clear ? 0 : ttl;
  return [
    `admin_session=${clear ? "" : encodeURIComponent(token)}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

// ── Simple sliding-window rate limit on /api/auth/login per IP ────────
// Uses admin_rate_violations table (declared in admin.sql) as a stateful
// counter. Best-effort; if Supabase is down we fail OPEN — that is the
// established product behaviour for emergency access. CF Rate Limiting
// Rules in front of /api/auth/login provide the hard cap.
async function loginRateLimit(env: Env, req: Request): Promise<{ ok: boolean; reason?: string }> {
  const ip = clientIp(req);
  if (!ip) return { ok: true };
  const maxN = parseInt(env.LOGIN_RL_MAX || "10", 10) || 10;
  const winS = parseInt(env.LOGIN_RL_WINDOW_S || "60", 10) || 60;
  const since = new Date(Date.now() - winS * 1000).toISOString();
  try {
    const r = await sb(
      env,
      `/rest/v1/admin_rate_violations?actor_ip=eq.${encodeURIComponent(ip)}&endpoint=eq.auth.login&created_at=gte.${encodeURIComponent(since)}&select=id`,
    );
    const rows = (await r.json().catch(() => [])) as unknown[];
    if (Array.isArray(rows) && rows.length >= maxN) {
      return { ok: false, reason: "rate_limited" };
    }
  } catch { /* fail-open */ }
  return { ok: true };
}

async function recordLoginAttempt(env: Env, req: Request) {
  try {
    await sb(env, "/rest/v1/admin_rate_violations", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        actor_ip: clientIp(req),
        endpoint: "auth.login",
        count: 1,
        window_start: new Date().toISOString(),
      }),
    });
  } catch { /* best-effort */ }
}

interface Ctx { request: Request; env: Env; params: { path?: string[] } }

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  const { request: req, env } = ctx;
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api/, "");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...originHeaders(env, req),
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-max-age": "600",
      },
    });
  }

  try {
    // ── Health (no info leak) — FIND-009
    if (route === "/health") {
      return json({ ok: true, ts: new Date().toISOString() }, req, env);
    }

    // ── Login — FIND-007 (constant-time), FIND-008 (rate limit) ───────
    if (route === "/auth/login" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";
      const ip = clientIp(req);

      if (!email || !password) {
        return json({ error: "missing_credentials" }, req, env, { status: 400 });
      }

      const rl = await loginRateLimit(env, req);
      if (!rl.ok) {
        await audit(env, req, { actor_email: email, action: "login_rate_limited", status: "failed" });
        return json({ error: "rate_limited" }, req, env, { status: 429 });
      }

      // Always do BOTH the email comparison AND the PBKDF2 to remove the
      // timing oracle (FIND-007). Use a constant-format dummy hash so
      // even an unknown-email path performs real PBKDF2 work.
      const knownEmail = env.ADMIN_EMAIL.toLowerCase();
      const emailMatches = email === knownEmail;
      const hashToTest = emailMatches ? env.ADMIN_PASSWORD_HASH : env.ADMIN_PASSWORD_HASH;
      const pwdMatches = await verifyPassword(password, hashToTest);

      if (!emailMatches || !pwdMatches) {
        await recordLoginAttempt(env, req);
        await audit(env, req, {
          actor_email: email, action: "login_failed", status: "failed",
          error: emailMatches ? "bad_password" : "bad_email",
        });
        return json({ error: "invalid_credentials" }, req, env, { status: 401 });
      }

      const ttl = parseInt(env.SESSION_TTL_SECONDS || "28800", 10);
      const now = Math.floor(Date.now() / 1000);
      const token = await jwtSign(
        {
          sub: email, role: "owner",
          iat: now, exp: now + ttl,
          iss: "shashki-royale-admin",
          aud: "shashki-royale-admin",
          ver: env.JWT_VERSION || "v1",
        },
        env.JWT_SECRET,
      );
      await audit(env, req, { actor_email: email, action: "login_success" });
      // Set HttpOnly cookie (FIND-006); body intentionally does NOT contain the token.
      return new Response(
        JSON.stringify({ ok: true, email, role: "owner", expiresIn: ttl }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "set-cookie": buildSessionCookie(token, ttl),
            ...originHeaders(env, req),
          },
        },
      );
    }

    // ── Logout — clears cookie, audit row ─────────────────────────────
    if (route === "/auth/logout" && req.method === "POST") {
      const a = await getAuth(req, env);
      await audit(env, req, { actor_email: a?.email ?? "anonymous", action: "logout" });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "set-cookie": buildSessionCookie("", 0, true),
          ...originHeaders(env, req),
        },
      });
    }

    // ── Auth gate for everything below ────────────────────────────────
    const auth = await getAuth(req, env);
    if (!auth) return json({ error: "unauthorized" }, req, env, { status: 401 });

    if (route === "/auth/me" && req.method === "GET") {
      return json({ email: auth.email, role: auth.role, exp: auth.payload.exp }, req, env);
    }

    // ── Player 360 — FIND-019 UUID validation ─────────────────────────
    const playerMatch = route.match(/^\/admin\/players\/([^/]+)$/);
    if (playerMatch && req.method === "GET") {
      const pid = playerMatch[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const [pr, wr, tr, sk] = await Promise.all([
        sb(env, `/rest/v1/profiles?id=eq.${pid}&limit=1`),
        sb(env, `/rest/v1/wallets?profile_id=eq.${pid}&limit=1`),
        sb(env, `/rest/v1/wallet_transactions?profile_id=eq.${pid}&order=created_at.desc&limit=50`),
        sb(env, `/rest/v1/game_stakes?or=(white_profile_id.eq.${pid},black_profile_id.eq.${pid})&order=created_at.desc&limit=25`),
      ]);
      const profile = ((await pr.json().catch(() => [])) as unknown[])[0] ?? null;
      const wallet = ((await wr.json().catch(() => [])) as unknown[])[0] ?? null;
      const transactions = (await tr.json().catch(() => [])) as unknown[];
      const stakes = (await sk.json().catch(() => [])) as unknown[];
      await audit(env, req, { actor_email: auth.email, action: "view_player", target_kind: "player", target_id: pid });
      return json({ profile, wallet, transactions, stakes }, req, env);
    }

    // ── Player audit history ──────────────────────────────────────────
    const auditMatch = route.match(/^\/admin\/players\/([^/]+)\/audit$/);
    if (auditMatch && req.method === "GET") {
      const pid = auditMatch[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const r = await sb(
        env,
        `/rest/v1/admin_audit_log?target_kind=eq.player&target_id=eq.${pid}&order=created_at.desc&limit=50`,
      );
      const rows = (await r.json().catch(() => [])) as unknown[];
      await audit(env, req, { actor_email: auth.email, action: "view_player_audit", target_kind: "player", target_id: pid });
      return json({ rows }, req, env);
    }

    // ── ACTION: grant Coin ────────────────────────────────────────────
    // Server-level idempotency check is BEST-EFFORT. The atomic guarantee
    // lives inside the DB once supabase/repair_2026_06.sql is applied —
    // the new admin_operations table provides PRIMARY KEY (idempotency_key)
    // and the RPC self-deduplicates.
    const grantMatch = route.match(/^\/admin\/players\/([^/]+)\/grant-coin$/);
    if (grantMatch && req.method === "POST") {
      const pid = grantMatch[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const body = (await req.json().catch(() => ({}))) as { amount?: number; reason?: string; idempotency_key?: string };
      const amount = Number(body.amount);
      const reason = (body.reason || "").trim();
      if (!Number.isFinite(amount) || amount === 0) return json({ error: "amount_required" }, req, env, { status: 400 });
      if (Math.abs(amount) > 1_000_000) return json({ error: "amount_too_large" }, req, env, { status: 400 });
      if (reason.length < 3) return json({ error: "reason_required" }, req, env, { status: 400 });
      const idem = (body.idempotency_key || "").trim();
      if (!idem || !UUID_RE.test(idem)) return json({ error: "idempotency_key_required" }, req, env, { status: 400 });

      const before = await sb(env, `/rest/v1/wallets?profile_id=eq.${pid}&select=*&limit=1`);
      const beforeRow = ((await before.json().catch(() => [])) as unknown[])[0] ?? null;

      // Prefer the new self-idempotent RPC (admin_grant_coin_v2) if available.
      // Fall back to legacy admin_grant_coin for the transition window.
      const rpcBody = JSON.stringify({
        p_profile_id: pid, p_amount: amount, p_reason: reason,
        p_actor: auth.email, p_idempotency_key: idem,
      });
      let rpc = await sb(env, "/rest/v1/rpc/admin_grant_coin_v2", { method: "POST", body: rpcBody });
      if (rpc.status === 404) {
        rpc = await sb(env, "/rest/v1/rpc/admin_grant_coin", {
          method: "POST",
          body: JSON.stringify({ p_profile_id: pid, p_amount: amount, p_reason: reason, p_actor: auth.email }),
        });
      }
      const result = await rpc.json().catch(() => ({}));
      if (!rpc.ok) {
        await audit(env, req, {
          actor_email: auth.email, action: "grant_coin", target_kind: "player", target_id: pid,
          reason, idempotency_key: idem, status: "failed",
          error: typeof result === "object" ? (result as { message?: string }).message ?? "rpc_failed" : "rpc_failed",
          before: beforeRow,
        });
        return json({ error: "rpc_failed", detail: { message: (result as { message?: string })?.message ?? null } }, req, env, { status: 400 });
      }

      const after = await sb(env, `/rest/v1/wallets?profile_id=eq.${pid}&select=*&limit=1`);
      const afterRow = ((await after.json().catch(() => [])) as unknown[])[0] ?? null;

      await audit(env, req, {
        actor_email: auth.email, action: "grant_coin", target_kind: "player", target_id: pid,
        reason, idempotency_key: idem, before: beforeRow, after: afterRow,
      });
      return json({ ok: true, result }, req, env);
    }

    // ── ACTION: refund stake ──────────────────────────────────────────
    const refundMatch = route.match(/^\/admin\/stakes\/([^/]+)\/refund$/);
    if (refundMatch && req.method === "POST") {
      const sid = refundMatch[1];
      if (!UUID_RE.test(sid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const body = (await req.json().catch(() => ({}))) as { reason?: string; idempotency_key?: string };
      const reason = (body.reason || "").trim();
      if (reason.length < 3) return json({ error: "reason_required" }, req, env, { status: 400 });
      const idem = (body.idempotency_key || "").trim();
      if (!idem || !UUID_RE.test(idem)) return json({ error: "idempotency_key_required" }, req, env, { status: 400 });

      const before = await sb(env, `/rest/v1/game_stakes?id=eq.${sid}&select=*&limit=1`);
      const beforeRow = ((await before.json().catch(() => [])) as unknown[])[0] ?? null;

      const rpcBody = JSON.stringify({ p_stake_id: sid, p_reason: reason, p_actor: auth.email, p_idempotency_key: idem });
      let rpc = await sb(env, "/rest/v1/rpc/admin_refund_stake_v2", { method: "POST", body: rpcBody });
      if (rpc.status === 404) {
        rpc = await sb(env, "/rest/v1/rpc/admin_refund_stake", {
          method: "POST",
          body: JSON.stringify({ p_stake_id: sid, p_reason: reason, p_actor: auth.email }),
        });
      }
      const result = await rpc.json().catch(() => ({}));
      if (!rpc.ok) {
        await audit(env, req, {
          actor_email: auth.email, action: "refund_stake", target_kind: "stake", target_id: sid,
          reason, idempotency_key: idem, status: "failed",
          error: typeof result === "object" ? (result as { message?: string }).message ?? "rpc_failed" : "rpc_failed",
          before: beforeRow,
        });
        return json({ error: "rpc_failed", detail: { message: (result as { message?: string })?.message ?? null } }, req, env, { status: 400 });
      }

      const after = await sb(env, `/rest/v1/game_stakes?id=eq.${sid}&select=*&limit=1`);
      const afterRow = ((await after.json().catch(() => [])) as unknown[])[0] ?? null;

      await audit(env, req, {
        actor_email: auth.email, action: "refund_stake", target_kind: "stake", target_id: sid,
        reason, idempotency_key: idem, before: beforeRow, after: afterRow,
      });
      return json({ ok: true, result }, req, env);
    }

    // ── ACTION: suspend / unsuspend ───────────────────────────────────
    const suspendMatch = route.match(/^\/admin\/players\/([^/]+)\/suspend$/);
    if (suspendMatch && req.method === "POST") {
      const pid = suspendMatch[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const body = (await req.json().catch(() => ({}))) as { hours?: number; reason?: string; idempotency_key?: string };
      const hours = Number(body.hours ?? 0) | 0;
      const reason = (body.reason || "").trim();
      if (hours > 0 && reason.length < 3) return json({ error: "reason_required" }, req, env, { status: 400 });
      if (hours > 24 * 365) return json({ error: "hours_too_large" }, req, env, { status: 400 });
      const idem = (body.idempotency_key || "").trim();
      if (!idem || !UUID_RE.test(idem)) return json({ error: "idempotency_key_required" }, req, env, { status: 400 });

      const before = await sb(
        env,
        `/rest/v1/profiles?id=eq.${pid}&select=id,suspended_until,suspension_reason,suspended_by&limit=1`,
      );
      const beforeRow = ((await before.json().catch(() => [])) as unknown[])[0] ?? null;

      const rpcBody = JSON.stringify({
        p_profile_id: pid, p_hours: hours, p_reason: reason || null,
        p_actor: auth.email, p_idempotency_key: idem,
      });
      let rpc = await sb(env, "/rest/v1/rpc/admin_set_suspension_v2", { method: "POST", body: rpcBody });
      if (rpc.status === 404) {
        rpc = await sb(env, "/rest/v1/rpc/admin_set_suspension", {
          method: "POST",
          body: JSON.stringify({ p_profile_id: pid, p_hours: hours, p_reason: reason || null, p_actor: auth.email }),
        });
      }
      const result = await rpc.json().catch(() => ({}));
      if (!rpc.ok) {
        await audit(env, req, {
          actor_email: auth.email,
          action: hours > 0 ? "suspend_player" : "unsuspend_player",
          target_kind: "player", target_id: pid,
          reason, idempotency_key: idem, status: "failed",
          error: typeof result === "object" ? (result as { message?: string }).message ?? "rpc_failed" : "rpc_failed",
          before: beforeRow,
        });
        return json({ error: "rpc_failed", detail: { message: (result as { message?: string })?.message ?? null } }, req, env, { status: 400 });
      }

      const after = await sb(
        env,
        `/rest/v1/profiles?id=eq.${pid}&select=id,suspended_until,suspension_reason,suspended_by&limit=1`,
      );
      const afterRow = ((await after.json().catch(() => [])) as unknown[])[0] ?? null;

      await audit(env, req, {
        actor_email: auth.email,
        action: hours > 0 ? "suspend_player" : "unsuspend_player",
        target_kind: "player", target_id: pid,
        reason, idempotency_key: idem, before: beforeRow, after: afterRow,
      });
      return json({ ok: true, result }, req, env);
    }

    // ── Wallets summary — FIND-021 (delegate to SQL aggregate if available)
    if (route === "/admin/wallets/summary" && req.method === "GET") {
      // Try the v2 SQL aggregate first
      let totals = { balance: 0, locked: 0, won: 0, lost: 0 };
      let walletCount = 0;
      let topRows: Array<{ profile_id: string; crypto_balance: number; locked_balance: number; total_won: number; total_lost: number; total_deposited: number; total_withdrawn: number }> = [];

      const aggR = await sb(env, "/rest/v1/rpc/admin_wallets_totals", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (aggR.ok) {
        const arr = (await aggR.json().catch(() => [])) as Array<{ balance: number; locked: number; won: number; lost: number; wallet_count: number }>;
        const t = arr[0];
        if (t) {
          totals = { balance: Number(t.balance || 0), locked: Number(t.locked || 0), won: Number(t.won || 0), lost: Number(t.lost || 0) };
          walletCount = Number(t.wallet_count || 0);
        }
      } else {
        // Fallback: unbounded scan (legacy). Acceptable until SQL repair lands.
        const allR = await sb(env, "/rest/v1/wallets?select=crypto_balance,locked_balance,total_won,total_lost");
        const all = (await allR.json().catch(() => [])) as Array<{ crypto_balance: number; locked_balance: number; total_won: number; total_lost: number }>;
        totals = all.reduce((acc, w) => ({
          balance: acc.balance + Number(w.crypto_balance || 0),
          locked: acc.locked + Number(w.locked_balance || 0),
          won: acc.won + Number(w.total_won || 0),
          lost: acc.lost + Number(w.total_lost || 0),
        }), { balance: 0, locked: 0, won: 0, lost: 0 });
        walletCount = all.length;
      }

      const topR = await sb(env, "/rest/v1/wallets?select=profile_id,crypto_balance,locked_balance,total_won,total_lost,total_deposited,total_withdrawn&order=crypto_balance.desc&limit=20");
      topRows = (await topR.json().catch(() => [])) as typeof topRows;

      const ids = topRows.map((t) => t.profile_id).filter(Boolean);
      let profMap: Record<string, { nickname: string; avatar_index: number }> = {};
      if (ids.length > 0) {
        const profR = await sb(env, `/rest/v1/public_profiles?select=id,nickname,avatar_index&id=in.(${ids.join(",")})`);
        const profs = (await profR.json().catch(() => [])) as Array<{ id: string; nickname: string; avatar_index: number }>;
        for (const p of profs) profMap[p.id] = { nickname: p.nickname, avatar_index: p.avatar_index };
      }
      const top2 = topRows.map((t) => ({
        ...t,
        nickname: profMap[t.profile_id]?.nickname ?? null,
        avatar_index: profMap[t.profile_id]?.avatar_index ?? 0,
      }));
      await audit(env, req, { actor_email: auth.email, action: "view_wallets_summary" });
      return json({ top: top2, totals, walletCount }, req, env);
    }

    // ── Recent transactions — FIND-022 cap limit ───────────────────────
    if (route === "/admin/transactions/recent" && req.method === "GET") {
      const rawLim = url.searchParams.get("limit") ?? "50";
      const lim = Math.min(Math.max(parseInt(rawLim, 10) || 50, 1), 500);
      const r = await sb(
        env,
        `/rest/v1/wallet_transactions?select=*&order=created_at.desc&limit=${lim}`,
      );
      const rows = (await r.json().catch(() => [])) as Array<{ profile_id: string }>;
      const ids = Array.from(new Set(rows.map((r) => r.profile_id).filter(Boolean)));
      let profMap: Record<string, { nickname: string; avatar_index: number }> = {};
      if (ids.length > 0) {
        const profR = await sb(env, `/rest/v1/public_profiles?select=id,nickname,avatar_index&id=in.(${ids.join(",")})`);
        const profs = (await profR.json().catch(() => [])) as Array<{ id: string; nickname: string; avatar_index: number }>;
        for (const p of profs) profMap[p.id] = { nickname: p.nickname, avatar_index: p.avatar_index };
      }
      const enriched = rows.map((r) => ({
        ...r,
        nickname: profMap[r.profile_id]?.nickname ?? null,
        avatar_index: profMap[r.profile_id]?.avatar_index ?? 0,
      }));
      await audit(env, req, { actor_email: auth.email, action: "view_transactions_recent" });
      return json({ rows: enriched }, req, env);
    }

    // ── Transactions by type — FIND-023 add audit + (optional) SQL agg
    if (route === "/admin/transactions/by-type" && req.method === "GET") {
      // Prefer SQL aggregate
      const aggR = await sb(env, "/rest/v1/rpc/admin_tx_by_type", { method: "POST", body: "{}" });
      let out: Array<{ type: string; count: number; sum: number }> = [];
      if (aggR.ok) {
        const rows = (await aggR.json().catch(() => [])) as Array<{ type: string; count: number; sum: number }>;
        out = rows;
      } else {
        const r = await sb(env, "/rest/v1/wallet_transactions?select=type,amount&limit=10000");
        const rows = (await r.json().catch(() => [])) as Array<{ type: string; amount: string | number }>;
        const map = new Map<string, { count: number; sum: number }>();
        for (const x of rows) {
          const k = x.type ?? "unknown";
          const cur = map.get(k) ?? { count: 0, sum: 0 };
          cur.count += 1;
          cur.sum += Number(x.amount || 0);
          map.set(k, cur);
        }
        out = Array.from(map.entries()).map(([type, v]) => ({ type, ...v })).sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
      }
      await audit(env, req, { actor_email: auth.email, action: "view_transactions_by_type" });
      return json({ rows: out }, req, env);
    }

    return json({ error: "not_found" }, req, env, { status: 404 });
  } catch (err) {
    // Never echo raw error text to the client (FIND-041).
    console.error("[api] internal", err);
    const requestId = req.headers.get("cf-ray");
    return json({ error: "internal", request_id: requestId }, req, env, { status: 500 });
  }
};
