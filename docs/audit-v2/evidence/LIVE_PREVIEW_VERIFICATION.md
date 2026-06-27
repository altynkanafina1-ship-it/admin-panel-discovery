# Live Preview Verification (feat/admin-light-realtime)

**Date:** 2026-06-27 · **Preview:** https://feat-admin-light-realtime.shashki-royale-admin.pages.dev
**Deployed via:** `wrangler pages deploy` (direct upload — these Pages projects are NOT git-integrated; "Git Provider: No").

## Preview backend isolation (good — addresses V2-CICD-3)
- The Pages **production** env contains real secrets (incl. `SUPABASE_SERVICE_ROLE`).
- The Pages **preview** env was **empty** before this engagement → a fresh preview deploy has **no production write secrets** by default. Confirmed: an un-configured deploy returned `500` on `/api/auth/login` (missing env), proving no inheritance.
- For this read-only review I set **preview-only** env vars (production untouched):
  - `SUPABASE_SERVICE_ROLE` = the **public anon key** (RLS-enforced, NO write power; admin RPC stay `401`).
  - A generated **test** admin (`preview-admin@shashki-royale.local`) + random `JWT_SECRET`.
  - `ALLOWED_ORIGIN` pinned to the preview origin.
- Net: the preview can demonstrate realtime + read dashboards on real public data, but **cannot grant/refund/suspend** (anon cannot call admin RPC) and **cannot read wallets/audit** (RLS) — exactly the safe read-only posture the brief requires for a preview.

## Verified LIVE
| Check | Result |
|---|---|
| `/api/health` | 200; now carries HSTS+CSP+nosniff+XFO (**V2-007 fix confirmed live**) |
| `/api/admin/overview` no cookie | 401 |
| `/api/realtime/stream` anonymous | **401** (realtime protected from anon ✅) |
| Service-role in client bundle | **none** (only UI text mentions "service_role"; no JWT/key) ✅ |
| Login (test admin) | 200; `Set-Cookie: admin_session … HttpOnly; Secure; SameSite=Strict` ✅ |
| `/api/admin/overview` w/ cookie | real data: 186 players, 4 games, 3 stakes |
| `/api/realtime/stream` w/ cookie | emits `{_schema:1}` → `system.connected{role:"owner"}` → `system.heartbeat{lag_ms≈900}` every ~1.5s |
| Realtime UI | top-bar shows **"LIVE · Nс назад"**; updates without manual refresh |

Heartbeat lag ≈ 0.9s → within the **<2s** event-latency SLO.

## Screenshots captured (light premium)
- Login (warm cream, Cinzel gold brand, Inter, gold CTA, mono technical line).
- Overview (light KPI cards, engagement funnel gold/sage/red, LIVE badge, light charts).
- Economy (P&L with gold/sage/red series — not five beige lines; escrow/payout donuts).
- Players (light table, gold selected-row, mono IDs, avatars, filters, CSV).

## New finding from live testing
**V2-AUTH-3 (LOW) — PBKDF2 iteration cap footgun.** Cloudflare Workers `crypto.subtle` rejects PBKDF2 iteration counts **> 100000** (`NotSupportedError`), while `verifyPassword` only enforces a floor of `≥100000`. Therefore **only exactly 100000** works on Workers. If the owner ever rotates `ADMIN_PASSWORD_HASH` with a higher iteration count (200k is a common default), login will fail with a `500`. Recommend: clamp/validate iterations to exactly 100000 at hash-generation time and document it; return a clean `503 not_configured` instead of `500` when admin env is missing.

## Cleanup note
The preview env vars are read-only/test values (no write power). They can be removed by the owner via the Pages dashboard, or left in place so the light/realtime preview remains reviewable. Test login (read-only preview only): `preview-admin@shashki-royale.local` / `PreviewAudit#2026`.
