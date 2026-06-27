# Admin — API Route Inventory (v2)

Source: `functions/api/[[path]].ts` @ `main` (`4016a1a`). All routes below the auth gate require a valid `admin_session` cookie (or transitional Bearer). `role` is always `owner` today.

| Method | Path | Auth | Role | Input validation | Rate-limit | Idempotency | DB action | Audit | Sensitive output | Errors |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/health` | none | — | — | — | — | none | no | none | 200 only |
| POST | `/api/auth/login` | none | — | email+password | sliding-window (fail-open) | — | reads env hash; writes RL+audit | yes | set-cookie | 400/401/429 |
| POST | `/api/auth/logout` | cookie opt | — | — | — | — | audit | yes | clears cookie | 200 |
| GET | `/api/auth/me` | cookie | any | — | — | — | none | no | email/role/exp | 401 |
| GET | `/api/admin/players/:id` | cookie | owner | UUID | — | — | read profile/wallet/tx/stakes | yes (view_player) | wallet+PII | 400/401 |
| GET | `/api/admin/players/:id/audit` | cookie | owner | UUID | — | — | read audit | yes | audit rows | 400/401 |
| POST | `/api/admin/players/:id/grant-coin` | cookie | owner | UUID, amount≠0 ≤1e6, reason≥3, idem UUID | — | **required** | `admin_grant_coin_v2`→legacy | yes (+before/after) | balances | 400/401 |
| POST | `/api/admin/stakes/:id/refund` | cookie | owner | UUID, reason≥3, idem UUID | — | **required** | `admin_refund_stake_v2`→legacy | yes | stake | 400/401 |
| POST | `/api/admin/players/:id/suspend` | cookie | owner | UUID, hours≤8760, idem UUID | — | **required** | `admin_set_suspension_v2`→legacy | yes | suspension | 400/401 |
| GET | `/api/admin/wallets/summary` | cookie | owner | — | — | — | `admin_wallets_totals` or scan | yes | aggregates+top20 | 401 |
| GET | `/api/admin/transactions/recent?limit` | cookie | owner | limit 1..500 | — | — | read tx | yes | tx+nickname | 401 |
| GET | `/api/admin/transactions/by-type` | cookie | owner | — | — | — | `admin_tx_by_type` or scan(10k) | yes | aggregates | 401 |
| GET | `/api/admin/overview` | cookie | owner | — | — | — | many counts + stakes scan(20k) | no | counts | 401 |
| GET | `/api/admin/signup-trend?days` | cookie | owner | days 1..90 | — | — | scan(20k) | no | counts | 401 |
| GET | `/api/admin/games-trend?days` | cookie | owner | days 1..90 | — | — | scan(50k) | no | counts | 401 |
| GET | `/api/admin/activity-heatmap?days` | cookie | owner | days 1..60 | — | — | scan moves(50k) | no | grid | 401 |
| GET | `/api/admin/players-list` | cookie | owner | sort allow-list, limit≤200 | — | — | paged read | no | full profiles | 400/401 |
| GET | `/api/admin/player-public/:id` | cookie | owner | UUID | — | — | read | no | public profile | 400/401 |
| GET | `/api/admin/player-games/:id` | cookie | owner | UUID, limit≤200 | — | — | read | no | games | 400/401 |
| GET | `/api/admin/player-stakes/:id` | cookie | owner | UUID, limit≤200 | — | — | read | no | stakes | 400/401 |
| GET | `/api/admin/player-engagement/:id` | cookie | owner | UUID, limit≤500 | — | — | read | no | engagement | 400/401 |
| GET | `/api/admin/games-list` | cookie | owner | status allow-list, limit≤500 | — | — | read | no | games | 400/401 |
| GET | `/api/admin/game/:id` | cookie | owner | UUID | — | — | game+moves(2000) | no | board/moves | 400/401 |
| GET | `/api/admin/stakes-list` | cookie | owner | limit≤2000 | — | — | read | no | stakes | 401 |
| POST | `/api/admin/profiles-by-ids` | cookie | owner | ≤500 UUIDs | — | — | read | no | profiles | 401 |
| GET | `/api/admin/search?q` | cookie | owner | UUID or ilike | — | — | read | no | players/games | 401 |
| GET | `/api/admin/activity-feed?limit` | cookie | owner | limit≤100 | — | — | read x3 | no | feed | 401 |
| GET | `/api/admin/insights` | cookie | owner | — | — | — | scan profiles(5000) | no | anti-fraud digest | 401 |
| GET | `/api/admin/economy/daily?days` | cookie | owner | days 1..180 | — | — | scan stakes(50k) | no | economy | 401 |
| GET | `/api/admin/economy/top-wagerers?limit` | cookie | owner | limit≤50 | — | — | scan stakes(20k) | no | wagerers | 401 |

## Findings
- **V2-API-1 (MED):** Several read endpoints use **unbounded/large client-side scans** (`limit=20000..50000`, then aggregate in JS). At scale (brief targets 100 online / 50 active games / burst events) these get slow and memory-heavy. Push aggregation into SQL RPC (`admin_*_totals` pattern already exists — extend it).
- **V2-API-2 (LOW):** **Read endpoints are not audited** (only mutations + a few views). Mass PII reads (`players-list`, `player-public`, exports) should at least be rate-aware and optionally audited.
- **V2-API-3 (LOW):** No per-request `correlation-id` returned on success (only `cf-ray` on 500). Add `x-request-id` echo on all responses for tracing.
- **V2-API-4 (INFO):** No write endpoint runs under a read-only role (no roles exist). Becomes relevant with RBAC (V2-006).
- No unauthenticated write endpoints. No obvious IDOR (all reads are scoped by validated UUID and run server-side under service-role with explicit filters). ✅
