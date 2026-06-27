# Admin — Final Report (Audit v2)

**Date:** 2026-06-27 · **Admin HEAD:** `4016a1a` · **Game HEAD:** `7406713`
**Method:** source review + read-only production probes + git-history review. **No production mutations.**

## 1. Direct answers to the brief's verdict questions

| Question | Answer | Basis |
|---|---|---|
| Can admin writes stay enabled? | **YES, with monitoring** | RPC are atomic + idempotent (PK), amount-capped, UUID-validated, anon-revoked |
| Can we trust grant Coin? | **YES (pending DB-constraint confirm)** | `admin_grant_coin_v2` exists, anon-revoked, idempotent; confirm `admin_operations` PK via diag |
| Can we trust refund? | **MOSTLY** | `admin_refund_stake_v2` exists; confirm refundable-state guard in RPC |
| Can we trust suspend? | **YES** | `admin_set_suspension_v2` exists, idempotent; enforcement must also live in game (see game instrumentation) |
| Is SQL repair applied? | **YES** | v2 RPCs + admin_operations/users/rate_violations tables all present in prod |
| Is the anonymous RPC bypass closed? | **YES — verified** | all admin RPC → `42501 permission denied` for anon |
| Are old secrets rotated? | **NO** | handoff `.docx` (PAT+JWT) still in history; engagement PAT pasted in chat |
| Does realtime work without refresh? | **PARTIALLY** | only public game tables stream, via insecure anon subscription |
| Is realtime protected from anonymous users? | **NO** | anon can subscribe to the same public tables |
| Is admin ready for multiple roles? | **NO** | single hardcoded owner; admin_users unused; no MFA |
| Can the light theme be merged? | **YES, after CI** (on `feat/admin-light-realtime`) | does not touch security model |
| Can we do a production deploy? | **NOT until P0 done** | rotate secrets (V2-001) + decide on RLS tightening (V2-002/004) |

## 2. Old claims: confirmed vs outdated
- **Confirmed true:** anon RPC bypass closed; HttpOnly cookie; CSP/HSTS/COOP/CORP; JWT hardening; idempotency/amount caps; source maps hidden; auth gate; SQL repair RPCs applied.
- **Outdated / not done:** "secrets rotated / history rewritten" (NOT done); implicit "realtime is fine" (insecure pattern); implicit "RLS locked down" (profiles + game_stakes still anon-readable).
- **Not previously surfaced clearly:** audit-write silent-swallow, fail-open login RL with unverified CF cap, unbounded read scans, no kill-switch, no RBAC revocation.

## 3. Findings by severity
**Critical 1 · High 3 · Medium 6 · Low 7 · Info 2** · plus **8 prior findings verified CLOSED**. (Full detail: `findings-v2.json`.)

## 4. Scores (0–100) + RAG

| Domain | Score | RAG |
|---|---|---|
| Security | 68 | YELLOW |
| Authentication | 74 | YELLOW |
| Authorization | 70 | YELLOW |
| RBAC | 35 | RED |
| Database integrity | 78 | GREEN-ish/YELLOW |
| Coin ledger | 72 | YELLOW (numeric recon pending) |
| API resilience | 66 | YELLOW |
| Auditability | 60 | YELLOW |
| Privacy | 45 | RED (profiles/stakes anon-readable) |
| Realtime security | 30 | RED |
| Realtime reliability | 40 | RED |
| Realtime latency | 55 | YELLOW |
| Frontend UX | 62 | YELLOW (dark theme, pre-redesign) |
| CI/CD | 64 | YELLOW |
| Observability | 40 | RED |
| Tests | 35 | RED (specs are markdown; little executed) |
| **Production readiness** | **58** | **YELLOW** |

**Overall:** the *write path* is genuinely solid post-hardening; the *privacy + realtime + identity* layers are the weak axis. Net: **YELLOW — safe to keep operating with monitoring, NOT safe to expand (multi-admin / public realtime) until P0+P1 land.**

## 5. What blocks production merge
1. V2-001 secret rotation + history purge (Critical).
2. Decision + staged apply of V2-002/004 RLS tightening (High) — highest regression risk; needs isolated verify + rollback.
3. Owner approval (no auto-merge).

## 6. Requires explicit owner action
- Rotate all exposed secrets (GitHub/Supabase/Cloudflare) — cannot be done safely from CI.
- Apply RLS migration on a staging snapshot, run game smoke, then promote.
- Verify Cloudflare login Rate-Limiting Rule + Supabase PITR.
- Provide a **staging/test profile** for the realtime write E2E (scenarios 4–5).
- Provide the **Cloudflare API token** if you want me to drive/verify the preview deployment directly (otherwise Pages git-integration auto-preview is used).
