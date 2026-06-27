# Admin — Auth & RBAC Re-Audit (v2)

## Session lifecycle (as-built, verified in code)
| Property | Value | Status |
|---|---|---|
| Token transport | `admin_session` cookie | ✅ |
| HttpOnly / Secure / SameSite | `HttpOnly; Secure; SameSite=Strict` | ✅ |
| Path | `/` | ✅ |
| TTL | `SESSION_TTL_SECONDS` (default 28800s = 8h) | ✅ |
| Algo | HS256, HMAC-SHA256 | ✅ |
| `iss` / `aud` | `shashki-royale-admin` (both checked) | ✅ |
| `exp` | checked, no clock-skew grace | ✅ (skew=0 acceptable) |
| `ver` | checked vs `JWT_VERSION` | ✅ global revoke only |
| Bearer fallback | accepted if no cookie | ⚠️ transitional; allows token in header (V2-AUTH-1) |
| Logout invalidation | clears cookie; **token still valid until exp** | ⚠️ no server denylist (V2-AUTH-2) |
| Password rotation invalidation | only by bumping `JWT_VERSION` | ⚠️ |
| Role-change / disable invalidation | impossible per-user | ❌ V2-006 |

## RBAC reality
- `admin_users` table **exists** but is **not** read at login. Identity = env `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`.
- `role` is hard-coded `"owner"` in `jwtSign(...)`. Every authenticated request is full-power.
- A "disabled admin" cannot be disabled short of rotating the shared password + bumping `JWT_VERSION` (logs everyone out).

## Findings
- **V2-006 (MED)** No RBAC, single owner, no MFA, no per-user revocation.
- **V2-AUTH-1 (LOW)** Bearer fallback widens attack surface (token replay if it ever leaks to JS). Remove once transition done; cookie-only.
- **V2-AUTH-2 (LOW/MED)** Logout is client-cookie-clear only; a captured token remains valid until `exp`. Add a short TTL + refresh, or a `sessions`/`token_version`-per-user denylist.

## Target model (see ADR for realtime tie-in)
1. `admin_users(id, email, role, status, password_hash, password_version, mfa_secret, created_at)`.
2. Login reads `admin_users`, checks `status='active'`, mints JWT with `sub=admin_user_id`, `role`, `pv=password_version`.
3. `/auth/me` (and the auth gate) re-validate `status` + `pv` against DB → instant disable & password-rotation revocation.
4. Roles: `owner` (all), `operator` (grant/refund/suspend with caps), `analyst` (read-only, no PII), `support` (read player 360, no economy writes).
5. MFA: TOTP enrolment, or front the whole origin with Cloudflare Access (zero-code, strong).
