# Admin — Security Re-Audit (v2)

Confirms/refutes prior findings against **live production** (2026-06-27).

## Confirmed FIXED (verified, not trusted)
- **Anonymous admin RPC bypass** — CLOSED. `admin_grant_coin(_v2)`, `admin_refund_stake_v2`, `admin_set_suspension_v2`, `admin_wallets_totals`, `admin_tx_by_type` all return `42501 permission denied` to `anon`.
- **HttpOnly cookie session** — `admin_session` set with `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=TTL`. Login response body contains **no** token. ✅
- **JWT hardening** — HS256 with `iss=aud=shashki-royale-admin`, `exp` check, `ver` (global kill switch via `JWT_VERSION`), non-empty `sub`. ✅
- **Constant-time-ish password compare** — PBKDF2-SHA256, iter floor ≥100k, salt ≥16B, byte-diff compare; PBKDF2 runs on unknown-email path to flatten the timing oracle (FIND-007). ✅ *(see note A)*
- **UUID validation** on all `:id` routes (`UUID_RE`). ✅
- **Idempotency key required** (UUID) for grant/refund/suspend at API layer; DB PK on `admin_operations.idempotency_key` enforces atomic dedupe. ✅
- **Amount caps** — grant `|amount| ≤ 1_000_000`, suspend `hours ≤ 8760`. ✅
- **Source maps hidden** — none emitted; `sourcemap:false`. ✅
- **Error responses** — generic `{error,request_id}` (cf-ray); no raw error text. ✅
- **Security headers** (HTML) — HSTS preload, CSP (no `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'`), COOP, CORP, XFO DENY, Permissions-Policy, Referrer-Policy. ✅

## Still OPEN / new

### V2-001 — CRITICAL — Secrets persist in git history; PAT re-exposed in chat
`6429c1c` ships `SHASHKI_ROYALE_ADMIN_HANDOFF.docx` containing a `ghp_` PAT and a JWT; deleted from HEAD but reachable in history. The fine-grained PAT issued for this engagement was additionally pasted into a chat channel. **Containment:** revoke the `ghp_` PAT, the JWT-shaped key, and the chat-pasted PAT now; rotate `SUPABASE_SERVICE_ROLE`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH`; `git filter-repo` to purge the docx; enable GitHub secret-scanning + push protection.

### V2-002 — HIGH — Raw `profiles` anon-readable (PII / identity map)
`GET /rest/v1/profiles?select=*` as `anon` → 200 with `player_id`, `auth_user_id`, `email`, `email_verified`. Even with null emails today, the policy permits selecting them. **Fix:** restrict `profiles` RLS to self-or-service; route public consumption through `public_profiles` only.

### V2-003 — HIGH — Insecure realtime (browser ↔ public tables via anon)
`src/lib/realtime.ts` subscribes the admin browser to `postgres_changes` using the `anon` client. Works only because RLS is permissive; cannot cover wallets/ledger/audit/suspension; no event contract, dedup, ordering, or auth on the stream. See ADR.

### V2-004 — MEDIUM — `game_stakes` fully anon-readable
Entry fee, pot, both profile ids, escrow & payout status exposed to the public. **Fix:** RLS to participants/service; expose a sanitized view if the game needs any of it client-side.

### V2-005 — MEDIUM — Login rate-limit fails OPEN; CF hard cap unverified
`loginRateLimit` returns `{ok:true}` on any Supabase error (`catch{} fail-open`) and on missing IP. The comment claims a Cloudflare Rate-Limiting Rule provides the hard cap, but its existence was **not verifiable** from outside. **Fix:** verify/create the CF rule; consider fail-closed with exponential backoff + per-account lockout.

### V2-006 — MEDIUM — No RBAC / no MFA / weak revocation
`role:"owner"` minted unconditionally; `admin_users` exists but unused; no per-admin disable (only global `JWT_VERSION` bump). No second factor. **Fix:** make `admin_users` authoritative (status, role, password_version); embed `admin_user_id` + `ver` in JWT and check against DB on `/auth/me`; add TOTP/WebAuthn or front with Cloudflare Access.

### V2-007 — LOW/MED — Function responses lack security headers
`public/_headers` does not apply to Pages Function output (`/api/health` had no HSTS/CSP). Set headers inside `json()`.

### V2-008 — LOW — `access-control-allow-origin: *` on static assets
Harmless for non-credentialed static GETs but inconsistent with the strict CORS used by `/api/*`. Confirm it is the Pages default and not a custom rule.

**Note A (timing):** `hashToTest = emailMatches ? HASH : HASH` is a no-op ternary — both branches identical. Intent (run PBKDF2 regardless) is met, but the dead ternary should be simplified to avoid confusion; the early-return on `!email||!password` before RL still leaks a *coarse* "format invalid vs credential invalid" timing/branch difference (low risk).
