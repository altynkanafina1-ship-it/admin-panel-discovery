# Admin — Coin Ledger Re-Audit (v2)

> Read-only review. **No reconciliation mutations.** Full numeric reconciliation requires the rotated service-role key — run `scripts/audit/diag_reconcile.sql` after rotation. This document assesses *structural* integrity from code + probes.

## Atomicity of admin mutations
The hardened design satisfies the brief's requirement (authorization + mutation + ledger + operation record + audit in one trusted DB transaction):
- Grant/refund/suspend go through `admin_*_v2` **SECURITY DEFINER** RPC.
- `admin_operations(idempotency_key PK)` provides DB-level dedupe → replays are no-ops (verified: API requires a UUID idempotency key; tables exist).
- The Pages Function additionally records a best-effort `admin_audit_log` row with `before`/`after` snapshots.

**Trust verdict:**
- **Grant Coin:** trustworthy *if* `diag_constraints.sql` confirms the `admin_operations` PK and the in-RPC ledger write. Server enforces amount cap `≤ 1_000_000` and non-zero. ✅ (pending DB-constraint confirmation)
- **Refund stake:** trustworthy structurally; must confirm the RPC checks the stake is in a refundable state (not already paid/refunded) to avoid double-refund. ⚠️ verify in `repair_2026_06.sql`.
- **Suspend/unsuspend:** trustworthy; idempotent via key.

## Risks / things to reconcile (service-role required)
| Check | How | Why |
|---|---|---|
| Negative balances | `SELECT * FROM wallets WHERE crypto_balance<0 OR locked_balance<0` | integrity |
| Orphan transactions | tx with no matching wallet/game | integrity |
| Duplicate settlements | group `wallet_transactions` by `(game_id,type)` having count>expected | double-pay |
| Locked > balance | `locked_balance > crypto_balance + locked_balance` anomalies | escrow bug |
| Refund without prior lock | stake `refunded` but no `lock` tx | ledger gap |
| Repeated welcome/referral | count `type IN ('welcome','referral')` per profile > 1 | farm/abuse |
| Idempotency collisions | duplicate `admin_operations.idempotency_key` (should be impossible w/ PK) | dedupe proof |

`scripts/audit/diag_reconcile.sql` contains these queries (read-only).

## Findings
- **V2-LEDGER-1 (INFO/needs-verify):** Full reconciliation not performed in this audit (no service-role). Structural controls are sound; numeric drift is **unknown, not "clean"**. Do not report "ledger clean" until `diag_reconcile.sql` returns zero anomalies.
- **V2-LEDGER-2 (LOW):** Economy commission is computed in the API (`pot*0.05`) for *display* only; ensure settlement RPC is the single source of truth for actual commission so admin charts cannot diverge from reality.
- **Product rule compliance:** No code path introduces monetary value, purchase, withdrawal, deposit, or crypto-exchange semantics for Coin. `total_deposited`/`total_withdrawn` columns exist but are internal counters; **no external money rail** is present. ✅ (Recommend renaming to `total_credited`/`total_debited` later to avoid implying real money — non-blocking.)
