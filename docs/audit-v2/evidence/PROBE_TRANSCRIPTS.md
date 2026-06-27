# Evidence — Live Probe Transcripts (post-hardening re-audit)

> Date of capture: **2026-06-27 UTC**
> Method: read-only HTTPS probes against production. No production mutations were performed.
> Secrets are NEVER printed in this file. Tokens used during probing are referenced by type only.

## 0. Repository HEADs at audit time

| Repo | Branch | HEAD |
|------|--------|------|
| `admin-panel-discovery` | `main` | `4016a1a` ("polish(admin): instant logout …") |
| `admin-panel-discovery` | `fix/admin-panel-p0-hardening` | `4016a1a` (== main → **already merged**) |
| `shashki-royale` | `main` | `7406713` ("chore(sw): bump CACHE_VERSION …") |
| `shashki-royale` | `feat/light-premium-game-theme` | open as **PR #4** |

## 1. Anonymous READ probes (Supabase REST, role = `anon`)

```
GET /rest/v1/profiles?select=*&limit=1
  -> HTTP 200  EXPOSES columns: id, player_id, auth_user_id, email, email_verified,
     nickname, avatar_index, rating, last_seen_at, ...   (RAW private table readable by anon)
GET /rest/v1/public_profiles?select=id,nickname    -> HTTP 200 (intended public view)
GET /rest/v1/wallets?select=...                     -> HTTP 200  []   (RLS filters all rows)
GET /rest/v1/wallet_transactions?select=id          -> HTTP 200  []   (RLS filters all rows)
GET /rest/v1/game_stakes?select=*&limit=1           -> HTTP 200  FULL ROW exposed:
     entry_fee, pot_amount, white_profile_id, black_profile_id, escrow_status, payout_status
GET /rest/v1/games?select=id,status                 -> HTTP 200 (readable)
GET /rest/v1/moves?select=id                         -> HTTP 200 (readable)
GET /rest/v1/admin_audit_log?select=id              -> HTTP 200  []   (RLS filters; table exists)
GET /rest/v1/admin_operations?select=idempotency_key-> HTTP 200  []   (table EXISTS)
GET /rest/v1/admin_rate_violations?select=id        -> HTTP 200  []   (table EXISTS)
GET /rest/v1/admin_users?select=id                  -> HTTP 200  []   (table EXISTS)
GET /rest/v1/engagement_log?select=id               -> HTTP 400  42703 (no `id` column)
```

## 2. Anonymous ADMIN RPC permission probes (no mutation — PG enforces EXECUTE before body)

Probed with a non-existent fake UUID `00000000-0000-0000-0000-000000000000`.

```
POST /rest/v1/rpc/admin_grant_coin_v2       -> HTTP 401  42501 permission denied for function admin_grant_coin_v2
POST /rest/v1/rpc/admin_grant_coin (legacy) -> HTTP 401  42501 permission denied for function admin_grant_coin
POST /rest/v1/rpc/admin_refund_stake_v2     -> HTTP 401  42501 permission denied for function admin_refund_stake_v2
POST /rest/v1/rpc/admin_set_suspension_v2   -> HTTP 401  42501 permission denied for function admin_set_suspension_v2
POST /rest/v1/rpc/admin_wallets_totals      -> HTTP 401  42501 permission denied for function admin_wallets_totals
POST /rest/v1/rpc/admin_tx_by_type          -> HTTP 401  42501 permission denied for function admin_tx_by_type
```

**Conclusion:** The v2 RPCs **exist** in the schema and the legacy `admin_grant_coin` also exists; **all are revoked from `anon`**. The anonymous administrative-RPC bypass reported by the prior audit is **CLOSED** in production.

## 3. Production HTTP headers

### `https://shashki-royale-admin.pages.dev/` (HTML)
```
HTTP/2 200
strict-transport-security: max-age=63072000; includeSubDomains; preload
content-security-policy: default-src 'self'; script-src 'self'; ... frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: no-referrer
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), ...
access-control-allow-origin: *      <-- note: present on static asset response
cache-control: no-store, must-revalidate
```

### `https://shashki-royale-admin.pages.dev/api/health`
```
HTTP/2 200   cache-control: no-store   (body: {"ok":true,"ts":...})
*** Security headers from public/_headers do NOT apply to Pages Function responses ***
```

### `https://shashki-royale-admin.pages.dev/api/admin/overview` (no cookie)
```
HTTP/2 401  {"error":"unauthorized"}   (auth gate confirmed)
```

### `https://shashki-royale.pages.dev/` (game, for comparison)
```
HTTP/2 200
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
*** NO HSTS, NO CSP, NO X-Frame-Options *** (game frontend much weaker than admin)
```

### Source maps
```
dist build emits NO *.map files; vite.config build.sourcemap=false. (no leak)
```

## 4. Secret exposure in git history

```
commit 6429c1c  "docs(admin): comprehensive handoff doc for next agent (with all tokens & roadmap)"
  + docs/admin/SHASHKI_ROYALE_ADMIN_HANDOFF.docx  (52407 bytes)
File is DELETED from current HEAD but REMAINS reachable in history at 6429c1c.
Masked content scan of that blob found:
  - 1x GitHub classic PAT pattern  (ghp_…[MASKED])
  - 1x JWT pattern                 (eyJ…[MASKED]; Supabase anon/service shape)
=> Treat ALL tokens that ever appeared in handoff docs as COMPROMISED. Rotation required.
```

## 5. Build / CI verification (local, from this audit)

```
yarn install --frozen-lockfile  -> OK
yarn typecheck (tsc -b --noEmit) -> OK
yarn build (tsc -b && vite build)-> OK; dist/assets/index-*.js = 848 kB (gzip 236 kB), single chunk, no code-split
```
