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
      // FIND V2-007: Pages Function responses do not inherit public/_headers.
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
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

    // ──────────────────────────────────────────────────────────────────
    // SECURE REALTIME GATEWAY — SSE (FIND V2-003)
    // Cookie-authenticated (sits below the auth gate). Reads with service_role
    // server-side, sanitises payloads (NO email / auth_user_id / IP / tokens),
    // and forwards only AdminRealtimeEvent frames. The browser never holds
    // service_role and never subscribes to Supabase directly.
    // v1 transport = bounded service-role cursor polling (see ADR). Connection
    // is capped (~50s) so EventSource auto-reconnect refreshes the lease.
    // ──────────────────────────────────────────────────────────────────
    if (route === "/realtime/stream" && req.method === "GET") {
      const eid = () => crypto.randomUUID();
      const epoch = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);
      const rows = async (path: string): Promise<Record<string, unknown>[]> => {
        try {
          const r = await sb(env, path);
          const j = await r.json().catch(() => []);
          return Array.isArray(j) ? (j as Record<string, unknown>[]) : [];
        } catch {
          return [];
        }
      };
      const nowIso = () => new Date().toISOString();
      const TICK_MS = 1500;
      const MAX_MS = 50_000;

      // Start cursors "now" → stream only NEW changes; existing state comes
      // from REST snapshots on the client (hybrid, per ADR).
      let cGames = nowIso();
      let cMoves = nowIso();
      let cStakes = nowIso();
      let cPresence = nowIso();
      let cTx = nowIso();

      const stream = new ReadableStream({
        async start(controller) {
          const send = (e: Record<string, unknown>) =>
            controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          const started = Date.now();
          const streamId = eid();

          send({ _schema: 1 });
          send({
            event_id: eid(), event_type: "system.connected", entity_type: "system",
            entity_id: "-", occurred_at: nowIso(), actor_type: "system",
            payload: { stream_id: streamId, role: auth.role },
          });

          try {
            while (Date.now() - started < MAX_MS) {
              const tickStart = Date.now();

              // ── Games (created/started/turn/ended) ──────────────────
              const games = await rows(
                `/rest/v1/games?select=id,room_code,status,current_turn,move_number,winner,resign_reason,created_at,updated_at&updated_at=gt.${encodeURIComponent(cGames)}&order=updated_at.asc&limit=40`,
              );
              for (const g of games) {
                cGames = (g.updated_at as string) || cGames;
                const ver = epoch(g.updated_at as string);
                const base = { game_id: g.id, room_code: g.room_code };
                let type = "game.updated";
                if (g.status === "waiting") type = "game.created";
                else if (g.status === "playing" && g.move_number === 0) type = "game.started";
                else if (g.status === "playing") type = "game.turn_changed";
                else if (g.status === "finished") type = "game.ended";
                send({
                  event_id: eid(), event_type: type, entity_type: "game",
                  entity_id: g.id, occurred_at: g.updated_at, version: ver,
                  actor_type: "player",
                  payload: g.status === "finished"
                    ? { ...base, winner: g.winner ?? null, resign_reason: g.resign_reason ?? null }
                    : { ...base, status: g.status, current_turn: g.current_turn ?? null, move_number: g.move_number ?? 0 },
                });
              }

              // ── Moves (delta only — never full board) ───────────────
              const moves = await rows(
                `/rest/v1/moves?select=game_id,move_number,player_color,created_at&created_at=gt.${encodeURIComponent(cMoves)}&order=created_at.asc&limit=60`,
              );
              for (const m of moves) {
                cMoves = (m.created_at as string) || cMoves;
                send({
                  event_id: eid(), event_type: "game.move", entity_type: "game",
                  entity_id: m.game_id, occurred_at: m.created_at,
                  version: Number(m.move_number) || undefined, actor_type: "player",
                  payload: { game_id: m.game_id, move_number: m.move_number, player_color: m.player_color },
                });
              }

              // ── Stakes / economy ────────────────────────────────────
              const stakes = await rows(
                `/rest/v1/game_stakes?select=id,game_id,entry_fee,pot_amount,escrow_status,payout_status,updated_at&updated_at=gt.${encodeURIComponent(cStakes)}&order=updated_at.asc&limit=40`,
              );
              for (const s of stakes) {
                cStakes = (s.updated_at as string) || cStakes;
                let type = "stake.updated";
                if (s.payout_status === "paid") type = "stake.payout";
                else if (s.payout_status === "refunded") type = "stake.refund";
                else if (s.escrow_status === "locked") type = "stake.locked";
                send({
                  event_id: eid(), event_type: type, entity_type: "stake",
                  entity_id: s.id, occurred_at: s.updated_at, version: epoch(s.updated_at as string),
                  actor_type: "system",
                  payload: {
                    stake_id: s.id, game_id: s.game_id, entry_fee: Number(s.entry_fee || 0),
                    pot_amount: Number(s.pot_amount || 0), escrow_status: s.escrow_status, payout_status: s.payout_status,
                  },
                });
              }

              // ── Presence (throttled last_seen) ──────────────────────
              const presence = await rows(
                `/rest/v1/public_profiles?select=id,nickname,avatar_index,last_seen_at&last_seen_at=gt.${encodeURIComponent(cPresence)}&order=last_seen_at.asc&limit=40`,
              );
              for (const p of presence) {
                cPresence = (p.last_seen_at as string) || cPresence;
                send({
                  event_id: eid(), event_type: "player.online", entity_type: "player",
                  entity_id: p.id, occurred_at: p.last_seen_at, version: epoch(p.last_seen_at as string),
                  actor_type: "player",
                  payload: { profile_id: p.id, nickname: p.nickname, avatar_index: p.avatar_index ?? 0 },
                });
              }

              // ── Wallet transactions (admin-authorised; no PII) ──────
              const tx = await rows(
                `/rest/v1/wallet_transactions?select=id,profile_id,type,amount,balance_after,created_at&created_at=gt.${encodeURIComponent(cTx)}&order=created_at.asc&limit=40`,
              );
              for (const t of tx) {
                cTx = (t.created_at as string) || cTx;
                send({
                  event_id: eid(), event_type: "wallet.transaction", entity_type: "wallet",
                  entity_id: String(t.id), occurred_at: t.created_at, version: epoch(t.created_at as string),
                  actor_type: "system",
                  payload: { tx_id: t.id, profile_id: t.profile_id, type: t.type, amount: Number(t.amount || 0), balance_after: t.balance_after ?? null },
                });
              }

              send({
                event_id: eid(), event_type: "system.heartbeat", entity_type: "system",
                entity_id: "-", occurred_at: nowIso(), actor_type: "system",
                payload: { lag_ms: Date.now() - tickStart },
              });

              const elapsed = Date.now() - tickStart;
              await new Promise((r) => setTimeout(r, Math.max(0, TICK_MS - elapsed)));
            }
          } catch {
            /* client disconnected or upstream error → close cleanly */
          } finally {
            try { controller.close(); } catch { /* already closed */ }
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          ...originHeaders(env, req),
        },
      });
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

    // ──────────────────────────────────────────────────────────────────
    // ADMIN READ ENDPOINTS — replace direct anon reads from admin SPA.
    // All routes below run under service_role (server-side), bypass RLS,
    // and return safe-shape data only. They REQUIRE a valid admin JWT
    // because they sit below the auth gate.
    // ──────────────────────────────────────────────────────────────────

    const countOf = async (path: string): Promise<number> => {
      const r = await sb(env, path, { headers: { Prefer: "count=exact", Range: "0-0" } });
      const cr = r.headers.get("content-range") || "0-0/0";
      const m = cr.match(/\/(\d+|\*)$/);
      return m && m[1] !== "*" ? parseInt(m[1], 10) : 0;
    };

    // /api/admin/overview — bundled KPIs (totals + active-users + funnel)
    if (route === "/admin/overview" && req.method === "GET") {
      const now = Date.now();
      const cuts = {
        on5:  new Date(now - 5 * 60_000).toISOString(),
        d1:   new Date(now - 86_400_000).toISOString(),
        d7:   new Date(now - 7 * 86_400_000).toISOString(),
        d30:  new Date(now - 30 * 86_400_000).toISOString(),
      };
      const [
        players, played, games, active, finished, stakes, moves,
        on5, d1, d7, d30, p1, p5,
      ] = await Promise.all([
        countOf("/rest/v1/public_profiles?select=id"),
        countOf("/rest/v1/public_profiles?select=id&total_games=gt.0"),
        countOf("/rest/v1/games?select=id"),
        countOf("/rest/v1/games?select=id&status=in.(waiting,playing)"),
        countOf("/rest/v1/games?select=id&status=eq.finished"),
        countOf("/rest/v1/game_stakes?select=id"),
        countOf("/rest/v1/moves?select=id"),
        countOf(`/rest/v1/public_profiles?select=id&last_seen_at=gte.${encodeURIComponent(cuts.on5)}`),
        countOf(`/rest/v1/public_profiles?select=id&last_seen_at=gte.${encodeURIComponent(cuts.d1)}`),
        countOf(`/rest/v1/public_profiles?select=id&last_seen_at=gte.${encodeURIComponent(cuts.d7)}`),
        countOf(`/rest/v1/public_profiles?select=id&last_seen_at=gte.${encodeURIComponent(cuts.d30)}`),
        countOf("/rest/v1/public_profiles?select=id&total_games=gte.1"),
        countOf("/rest/v1/public_profiles?select=id&total_games=gte.5"),
      ]);
      const stR = await sb(env, "/rest/v1/game_stakes?select=white_profile_id,black_profile_id&limit=20000");
      const stakeIds = new Set<string>();
      for (const s of (await stR.json().catch(() => [])) as Array<{ white_profile_id: string | null; black_profile_id: string | null }>) {
        if (s.white_profile_id) stakeIds.add(s.white_profile_id);
        if (s.black_profile_id) stakeIds.add(s.black_profile_id);
      }
      return json({
        totals: { players, games, active, finished, stakes, movesSeen: moves, playedAtLeastOnce: played },
        activeUsers: { online5m: on5, d1, d7, d30 },
        funnel: { registered: players, played1: p1, played5: p5, stake1: stakeIds.size },
      }, req, env);
    }

    // /api/admin/signup-trend?days=14
    if (route === "/admin/signup-trend" && req.method === "GET") {
      const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "14", 10) || 14, 1), 90);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const r = await sb(env, `/rest/v1/public_profiles?select=created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=20000`);
      const rows = (await r.json().catch(() => [])) as Array<{ created_at: string }>;
      const bucket = new Map<string, number>();
      for (let i = days - 1; i >= 0; i--) bucket.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
      for (const x of rows) {
        const k = (x.created_at || "").slice(0, 10);
        if (bucket.has(k)) bucket.set(k, (bucket.get(k) ?? 0) + 1);
      }
      return json({ rows: Array.from(bucket, ([day, count]) => ({ day, count })) }, req, env);
    }

    // /api/admin/games-trend?days=14
    if (route === "/admin/games-trend" && req.method === "GET") {
      const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "14", 10) || 14, 1), 90);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const r = await sb(env, `/rest/v1/games?select=updated_at,status&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc&limit=50000`);
      const rows = (await r.json().catch(() => [])) as Array<{ updated_at: string; status: string }>;
      const bucket = new Map<string, number>();
      for (let i = days - 1; i >= 0; i--) bucket.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
      for (const x of rows) {
        if (x.status !== "finished") continue;
        const k = (x.updated_at || "").slice(0, 10);
        if (bucket.has(k)) bucket.set(k, (bucket.get(k) ?? 0) + 1);
      }
      return json({ rows: Array.from(bucket, ([day, count]) => ({ day, count })) }, req, env);
    }

    // /api/admin/activity-heatmap?days=14
    if (route === "/admin/activity-heatmap" && req.method === "GET") {
      const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "14", 10) || 14, 1), 60);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const r = await sb(env, `/rest/v1/moves?select=created_at&created_at=gte.${encodeURIComponent(since)}&limit=50000`);
      const rows = (await r.json().catch(() => [])) as Array<{ created_at: string }>;
      const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const x of rows) {
        const d = new Date(x.created_at);
        const dow = (d.getUTCDay() + 6) % 7;
        grid[dow][d.getUTCHours()] += 1;
      }
      return json({ grid }, req, env);
    }

    // /api/admin/players-list?sort=&dir=&limit=&offset=&search=&hasGames=&minGames=&minStreak=&active24h=
    if (route === "/admin/players-list" && req.method === "GET") {
      const sort = url.searchParams.get("sort") || "last_seen_at";
      const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
      const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
      const search = url.searchParams.get("search") || "";
      const hasGames = url.searchParams.get("hasGames") === "true";
      const minGames = parseInt(url.searchParams.get("minGames") || "0", 10) || 0;
      const minStreak = parseInt(url.searchParams.get("minStreak") || "0", 10) || 0;
      const active24h = url.searchParams.get("active24h") === "true";
      const SORT_OK = ["rating", "last_seen_at", "created_at", "total_games", "win_streak", "best_win_streak"];
      if (!SORT_OK.includes(sort)) return json({ error: "bad_sort" }, req, env, { status: 400 });

      const params: string[] = [`select=*`, `order=${sort}.${dir}`];
      if (search) params.push(`nickname=ilike.${encodeURIComponent("*" + search + "*")}`);
      if (hasGames) params.push(`total_games=gt.0`);
      if (minGames > 0) params.push(`total_games=gte.${minGames}`);
      if (minStreak > 0) params.push(`best_win_streak=gte.${minStreak}`);
      if (active24h) params.push(`last_seen_at=gte.${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`);
      const r = await sb(env, `/rest/v1/public_profiles?${params.join("&")}`, {
        headers: { Prefer: "count=exact", Range: `${offset}-${offset + limit - 1}` },
      });
      const rows = (await r.json().catch(() => [])) as unknown[];
      const total = (() => {
        const cr = r.headers.get("content-range") || "0-0/0";
        const m = cr.match(/\/(\d+|\*)$/);
        return m && m[1] !== "*" ? parseInt(m[1], 10) : 0;
      })();
      return json({ rows, total }, req, env);
    }

    // /api/admin/player-public/:id — single public_profiles row
    const playerPub = route.match(/^\/admin\/player-public\/([^/]+)$/);
    if (playerPub && req.method === "GET") {
      const pid = playerPub[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const r = await sb(env, `/rest/v1/public_profiles?id=eq.${pid}&select=*&limit=1`);
      const row = ((await r.json().catch(() => [])) as unknown[])[0] ?? null;
      return json({ row }, req, env);
    }

    // /api/admin/player-games/:id?limit=25
    const playerGames = route.match(/^\/admin\/player-games\/([^/]+)$/);
    if (playerGames && req.method === "GET") {
      const pid = playerGames[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1), 200);
      const r = await sb(env, `/rest/v1/games?select=*&or=(white_player_id.eq.${pid},black_player_id.eq.${pid})&order=updated_at.desc&limit=${limit}`);
      const rows = (await r.json().catch(() => [])) as unknown[];
      return json({ rows }, req, env);
    }

    // /api/admin/player-stakes/:id?limit=25
    const playerStakes = route.match(/^\/admin\/player-stakes\/([^/]+)$/);
    if (playerStakes && req.method === "GET") {
      const pid = playerStakes[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1), 200);
      const r = await sb(env, `/rest/v1/game_stakes?select=*&or=(white_profile_id.eq.${pid},black_profile_id.eq.${pid})&order=created_at.desc&limit=${limit}`);
      const rows = (await r.json().catch(() => [])) as unknown[];
      return json({ rows }, req, env);
    }

    // /api/admin/player-engagement/:id?limit=50
    const playerEng = route.match(/^\/admin\/player-engagement\/([^/]+)$/);
    if (playerEng && req.method === "GET") {
      const pid = playerEng[1];
      if (!UUID_RE.test(pid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
      const r = await sb(env, `/rest/v1/engagement_log?select=*&player_id=eq.${pid}&order=created_at.desc&limit=${limit}`);
      const rows = (await r.json().catch(() => [])) as unknown[];
      return json({ rows }, req, env);
    }

    // /api/admin/games-list?status=playing&limit=8
    if (route === "/admin/games-list" && req.method === "GET") {
      const status = url.searchParams.get("status") || "all";
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
      const STATUS_OK = ["waiting", "playing", "finished", "all"];
      if (!STATUS_OK.includes(status)) return json({ error: "bad_status" }, req, env, { status: 400 });
      const filter = status !== "all" ? `&status=eq.${status}` : "";
      const r = await sb(env,
        `/rest/v1/games?select=id,room_code,status,white_player_id,black_player_id,current_turn,move_number,winner,resign_reason,created_at,updated_at,last_move_at${filter}&order=updated_at.desc&limit=${limit}`);
      const rows = (await r.json().catch(() => [])) as unknown[];
      return json({ rows }, req, env);
    }

    // /api/admin/game/:id  (single row + moves)
    const gameOne = route.match(/^\/admin\/game\/([^/]+)$/);
    if (gameOne && req.method === "GET") {
      const gid = gameOne[1];
      if (!UUID_RE.test(gid)) return json({ error: "bad_id" }, req, env, { status: 400 });
      const [gr, mr] = await Promise.all([
        sb(env, `/rest/v1/games?id=eq.${gid}&select=*&limit=1`),
        sb(env, `/rest/v1/moves?select=*&game_id=eq.${gid}&order=move_number.asc&limit=2000`),
      ]);
      const game = ((await gr.json().catch(() => [])) as unknown[])[0] ?? null;
      const moves = (await mr.json().catch(() => [])) as unknown[];
      return json({ game, moves }, req, env);
    }

    // /api/admin/stakes-list?limit=200
    if (route === "/admin/stakes-list" && req.method === "GET") {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 2000);
      const r = await sb(env, `/rest/v1/game_stakes?select=*&order=created_at.desc&limit=${limit}`);
      const rows = (await r.json().catch(() => [])) as unknown[];
      return json({ rows }, req, env);
    }

    // /api/admin/profiles-by-ids — POST {ids:[...]}
    if (route === "/admin/profiles-by-ids" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
      const ids = Array.from(new Set((body.ids ?? []).filter((s) => UUID_RE.test(s)))).slice(0, 500);
      if (ids.length === 0) return json({ map: {} }, req, env);
      const r = await sb(env, `/rest/v1/public_profiles?select=*&id=in.(${ids.join(",")})`);
      const rows = (await r.json().catch(() => [])) as Array<{ id: string }>;
      const map: Record<string, unknown> = {};
      for (const p of rows) map[p.id] = p;
      return json({ map }, req, env);
    }

    // /api/admin/search?q=...
    if (route === "/admin/search" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ players: [], games: [] }, req, env);
      const isUUID = UUID_RE.test(q);
      const [pR, gR] = await Promise.all([
        isUUID
          ? sb(env, `/rest/v1/public_profiles?id=eq.${q}&select=*&limit=5`)
          : sb(env, `/rest/v1/public_profiles?nickname=ilike.${encodeURIComponent("*" + q + "*")}&select=*&order=last_seen_at.desc&limit=8`),
        isUUID
          ? sb(env, `/rest/v1/games?id=eq.${q}&select=*&limit=5`)
          : sb(env, `/rest/v1/games?room_code=ilike.${encodeURIComponent("*" + q.toUpperCase() + "*")}&select=*&order=updated_at.desc&limit=8`),
      ]);
      const players = (await pR.json().catch(() => [])) as unknown[];
      const games = (await gR.json().catch(() => [])) as unknown[];
      return json({ players, games }, req, env);
    }

    // /api/admin/activity-feed?limit=20
    if (route === "/admin/activity-feed" && req.method === "GET") {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [pR, gR, mR] = await Promise.all([
        sb(env, `/rest/v1/public_profiles?select=id,nickname,avatar_index,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${limit}`),
        sb(env, `/rest/v1/games?select=id,room_code,status,winner,created_at,updated_at&order=updated_at.desc&limit=${limit}`),
        sb(env, `/rest/v1/moves?select=game_id,move_number,player_color,created_at&order=created_at.desc&limit=${limit}`),
      ]);
      const profs = (await pR.json().catch(() => [])) as Array<{ id: string; nickname: string; avatar_index: number; created_at: string }>;
      const games = (await gR.json().catch(() => [])) as Array<{ id: string; room_code: string; status: string; winner: string | null; created_at: string; updated_at: string }>;
      const moves = (await mR.json().catch(() => [])) as Array<{ game_id: string; move_number: number; player_color: string; created_at: string }>;
      const codeMap = new Map<string, string>();
      for (const g of games) codeMap.set(g.id, g.room_code);
      const out: Array<Record<string, unknown>> = [];
      for (const p of profs) out.push({ kind: "registration", at: p.created_at, player: { id: p.id, nickname: p.nickname, avatar_index: p.avatar_index } });
      for (const g of games) {
        if (g.status === "finished") out.push({ kind: "game_finished", at: g.updated_at, gameId: g.id, roomCode: g.room_code, winner: g.winner });
        else out.push({ kind: "game_started", at: g.created_at, gameId: g.id, roomCode: g.room_code });
      }
      for (const m of moves) out.push({ kind: "move", at: m.created_at, gameId: m.game_id, roomCode: codeMap.get(m.game_id) ?? "—", color: m.player_color, moveNumber: m.move_number });
      out.sort((a, b) => +new Date(b.at as string) - +new Date(a.at as string));
      return json({ rows: out.slice(0, limit) }, req, env);
    }

    // /api/admin/insights — anti-fraud / behavioural digest
    if (route === "/admin/insights" && req.method === "GET") {
      const r = await sb(env, "/rest/v1/public_profiles?select=*&order=rating.desc&limit=5000");
      const all = (await r.json().catch(() => [])) as Array<{
        id: string; rating: number; total_games: number; wins: number; best_win_streak: number;
        last_seen_at: string; created_at: string;
      }>;
      const cutoff = Date.now() - 14 * 86_400_000;
      const highWinrate = all
        .filter((p) => p.total_games >= 20 && p.wins / Math.max(1, p.total_games) >= 0.9)
        .map((p) => ({ ...p, winrate: Math.round((p.wins / p.total_games) * 100) }))
        .slice(0, 10);
      const longestStreaks = all
        .filter((p) => (p.best_win_streak ?? 0) >= 5)
        .sort((a, b) => (b.best_win_streak ?? 0) - (a.best_win_streak ?? 0))
        .slice(0, 10);
      const inactiveButRated = all
        .filter((p) => new Date(p.last_seen_at).getTime() < cutoff && p.total_games >= 10 && p.rating > 1200)
        .sort((a, b) => b.rating - a.rating).slice(0, 10);
      const groups = new Map<string, typeof all>();
      for (const p of all) {
        const sec = (p.created_at || "").slice(0, 19);
        if (!sec) continue;
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec)!.push(p);
      }
      const sameSecondSignups = Array.from(groups.entries())
        .filter(([, list]) => list.length >= 3)
        .map(([bucket, players]) => ({ bucket, count: players.length, players }))
        .sort((a, b) => b.count - a.count).slice(0, 5);
      const ratings = all.map((p) => p.rating);
      const mean = ratings.reduce((s, n) => s + n, 0) / Math.max(1, ratings.length);
      const variance = ratings.reduce((s, n) => s + (n - mean) ** 2, 0) / Math.max(1, ratings.length);
      const sigma = Math.sqrt(variance);
      const ratingOutliers = all
        .filter((p) => Math.abs(p.rating - mean) > 2 * sigma)
        .sort((a, b) => Math.abs(b.rating - mean) - Math.abs(a.rating - mean)).slice(0, 10);
      const zero = all.filter((p) => p.total_games === 0).length;
      return json({
        highWinrate, longestStreaks, inactiveButRated, sameSecondSignups, ratingOutliers,
        zeroGames: { total: zero, pct: all.length ? Math.round((zero / all.length) * 1000) / 10 : 0 },
      }, req, env);
    }

    // /api/admin/economy/daily?days=30
    if (route === "/admin/economy/daily" && req.method === "GET") {
      const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 180);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const r = await sb(env, `/rest/v1/game_stakes?select=created_at,updated_at,entry_fee,pot_amount,payout_status&created_at=gte.${encodeURIComponent(since)}&limit=50000`);
      const rows = (await r.json().catch(() => [])) as Array<{ created_at: string; pot_amount: string | number; payout_status: string }>;
      const bucket = new Map<string, { day: string; pot: number; paid: number; refunded: number; commission: number }>();
      for (let i = days - 1; i >= 0; i--) {
        const k = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        bucket.set(k, { day: k, pot: 0, paid: 0, refunded: 0, commission: 0 });
      }
      for (const s of rows) {
        const k = (s.created_at || "").slice(0, 10);
        const row = bucket.get(k); if (!row) continue;
        const pot = Number(s.pot_amount || 0);
        row.pot += pot;
        if (s.payout_status === "paid") { row.paid += pot; row.commission += pot * 0.05; }
        else if (s.payout_status === "refunded") row.refunded += pot;
      }
      return json({ rows: Array.from(bucket.values()).map((r) => ({ ...r, commission: Math.round(r.commission) })) }, req, env);
    }

    // /api/admin/economy/top-wagerers?limit=10
    if (route === "/admin/economy/top-wagerers" && req.method === "GET") {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1), 50);
      const r = await sb(env, "/rest/v1/game_stakes?select=entry_fee,white_profile_id,black_profile_id&limit=20000");
      const rows = (await r.json().catch(() => [])) as Array<{ entry_fee: string | number; white_profile_id: string | null; black_profile_id: string | null }>;
      const acc = new Map<string, { wagered: number; count: number }>();
      for (const s of rows) {
        const fee = Number(s.entry_fee || 0);
        for (const pid of [s.white_profile_id, s.black_profile_id]) {
          if (!pid) continue;
          const prev = acc.get(pid) ?? { wagered: 0, count: 0 };
          acc.set(pid, { wagered: prev.wagered + fee, count: prev.count + 1 });
        }
      }
      const top = Array.from(acc.entries()).sort((a, b) => b[1].wagered - a[1].wagered).slice(0, limit);
      if (top.length === 0) return json({ rows: [] }, req, env);
      const ids = top.map(([id]) => id);
      const pR = await sb(env, `/rest/v1/public_profiles?select=*&id=in.(${ids.join(",")})`);
      const profs = (await pR.json().catch(() => [])) as Array<{ id: string }>;
      const map: Record<string, unknown> = {};
      for (const p of profs) map[p.id] = p;
      return json({
        rows: top.filter(([id]) => map[id]).map(([id, { wagered, count }]) => ({
          profile: map[id], totalWagered: wagered, games: count,
        })),
      }, req, env);
    }

    return json({ error: "not_found" }, req, env, { status: 404 });
  } catch (err) {
    // Never echo raw error text to the client (FIND-041).
    console.error("[api] internal", err);
    const requestId = req.headers.get("cf-ray");
    return json({ error: "internal", request_id: requestId }, req, env, { status: 500 });
  }
};
