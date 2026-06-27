# Admin — Realtime Test Plan

Automated + documented scenarios. **Write E2E only against a test profile / staging — never a real player.**

## Tooling
- Gateway unit/contract tests: dedup, ordering (lower `version` ignored), PII stripping, role filtering.
- Client tests (`adminRealtime.test.ts`): reconnect backoff, snapshot reconcile, bounded feed cap, teardown on logout.
- E2E: Playwright drives the admin UI + a scripted Supabase test-profile client to emit game/economy events.

## Scenarios (acceptance)
1. **Presence** — start game test profile → admin shows online ≤2s; close → offline/last-seen within heartbeat window.
2. **Matchmaking** — test player picks stake → live queue updates; 2nd player → `match.found` shown.
3. **Game flow** — game starts → Match Detail auto-appears; moves stream without refresh; turn flips; game ends → status/result update.
4. **Economy** — test stake lock → locked Coin shown; settlement creates ledger entry → wallet+economy update; delta reconciles.
5. **Suspension (staging/test only)** — suspend → ack + audit row; game enforcement blocks new matchmaking; unsuspend; replay same idempotency key → **no second effect**.
6. **Reconnect** — drop admin network; emit several events; restore → reconnect ≤5s; snapshot reconcile ≤10s; no duplicates; final state correct.
7. **Unauthorized** — anonymous browser cannot open the stream (401); expired/disabled admin loses stream; wrong role sees no privileged events; **service-role absent from browser bundle** (grep build output).

## SLO assertions
| Metric | Target | How measured |
|---|---|---|
| Event latency to UI | <2s | `occurred_at` → client render timestamp |
| Reconnect | <5s | network-drop harness |
| Snapshot recovery | <10s | reconnect → reconciled badge |
| Duplicate visible events | 0 | dedup counter == duplicates received |
| Stale KPI post-reconcile | 0 | compare to REST snapshot |
| Unauthorized subscription | 0 | anon/expired probes return 401 |
| Service-role leakage | 0 | `grep -R "service_role\|SUPABASE_SERVICE" dist/` == empty |

## Status in this engagement
- Contract + client logic delivered on `feat/admin-light-realtime` with unit-level guards.
- Full Playwright E2E with two live Supabase clients is **documented but not executed here** (requires staging test-profiles + rotated keys). Flagged as owner follow-up.
