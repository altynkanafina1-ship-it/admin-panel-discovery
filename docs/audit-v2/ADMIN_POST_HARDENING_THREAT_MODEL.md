# Admin — Post-Hardening Threat Model (v2)

STRIDE over the as-built system. Only deltas vs. the original threat model are emphasised.

## Assets
- Coin wallet balances & ledger (integrity-critical, no monetary value but in-game economy).
- Player PII / identity mapping (`profiles.player_id`, `auth_user_id`, `email`).
- Admin session integrity & admin action authority (grant/refund/suspend).
- Audit trail (non-repudiation).
- Service-role credential (catastrophic if leaked).

## Actors
- Anonymous internet user (has the public `anon` key — it ships in both SPAs).
- Authenticated game player.
- Admin (single `owner`).
- Compromised admin browser (XSS / stolen device).
- Insider with repo access / leaked PAT.

## Key threats

| # | STRIDE | Threat | Current control | Residual |
|---|--------|--------|-----------------|----------|
| T1 | Information disclosure | Anon reads raw `profiles` (player_id, auth_user_id, email) | RLS allows it (too broad) | **HIGH (V2-002)** |
| T2 | Information disclosure | Anon reads full `game_stakes` economy rows | RLS allows it | **MED (V2-004)** |
| T3 | Elevation/Tampering | Anon calls admin RPC to mint/refund/suspend | EXECUTE revoked from anon | **CLOSED ✅** |
| T4 | Spoofing/Elevation | Stolen GitHub PAT / service-role from handoff docx | none (still in history) | **CRIT (V2-001)** |
| T5 | Spoofing | Admin session theft via XSS | HttpOnly cookie + strict CSP | LOW |
| T6 | Spoofing | CSRF on admin mutations | SameSite=Strict + exact-origin CORS + custom header | LOW |
| T7 | DoS/Spoofing | Login brute force / IP spoof via header | best-effort RL, **fails open**; CF rule unverified | **MED (V2-005)** |
| T8 | Repudiation | Admin denies action / audit lost on error | audit best-effort, `catch{}` swallows failures | MED (V2-009) |
| T9 | Elevation | Disabled admin keeps valid cookie until exp | only `JWT_VERSION` global kill; no per-user revoke | **MED (V2-006)** |
| T10 | Tampering | Realtime stream tamper / unauthorized subscribe | none beyond RLS; anon can subscribe to public tables | **HIGH (V2-003)** |
| T11 | Information disclosure | Service-role leaks into browser bundle | server-only; verified absent | CLOSED ✅ |

## Attack trees of note
- **Economy manipulation via UI:** blocked server-side (RPC atomic + idempotent + amount caps + UUID validation). Trustworthy.
- **Mass PII export:** partially mitigated for `wallets`/`transactions` (RLS), **not** for `profiles` direct anon read.
- **Realtime spoof/replay:** no `event_id`/version contract today; events are raw Postgres CDC fanned to the browser.
