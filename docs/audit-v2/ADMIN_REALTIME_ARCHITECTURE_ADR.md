# ADR — Admin Realtime Architecture

**Status:** Accepted (implementation on `feat/admin-light-realtime`).
**Date:** 2026-06-27.
**Context:** The admin SPA must show live game/economy/moderation state without manual refresh, without leaking service-role to the browser, without weakening RLS, and while supporting future multi-admin RBAC.

## Options considered

### Option A — Supabase Auth for admins (browser subscribes directly)
Give each admin a real Supabase identity with custom claims; tighten RLS so admins (and only admins) can `SELECT` the operational tables; subscribe from the browser; expose sanitized views/channels.
- **Pros:** Native Supabase Realtime; least new infra; scales with Supabase.
- **Cons:** Requires admin rows in Supabase Auth + careful RLS for *every* operational table + views; presence still needs work; admin identity now lives in the same auth system as players (blast radius); the browser still talks to Supabase directly (more CSP surface, PII closer to the client); harder to filter payloads per-RBAC-role; couples realtime security to RLS correctness forever.

### Option B — Cloudflare authenticated realtime gateway ✅ (primary)
The existing HttpOnly admin session already terminates at a Cloudflare Pages Function with the service-role. Add a server-side streaming endpoint (**SSE** `GET /api/realtime/stream`) that:
1. authenticates the admin via the same cookie/JWT (+ future RBAC role),
2. holds a **server-side** Supabase subscription (service-role) and/or polls,
3. normalises rows into the `AdminRealtimeEvent` contract, **filters payload by role/PII rules**, and
4. pushes only sanitized events to the browser. The browser never sees service-role and never subscribes to Supabase directly.
- **Pros:** Service-role stays server-side; one authn'd stream covers *all* domains incl. economy/moderation/presence; payload filtering & PII redaction per RBAC role; no RLS loosening; clean teardown (close SSE on logout); easy correlation-id/observability; CSP can drop `wss://…supabase.co`.
- **Cons:** Pages Functions are request-scoped — a single long-lived server-side Supabase WS per viewer is awkward on the Workers runtime; naive implementation = per-connection polling. Mitigated by (a) short-interval **server-side change polling** keyed on `updated_at`/`id` cursors for v1 (simple, robust, bounded), and (b) optional **Durable Object** fan-out for true push + multi-tab efficiency in v2.

### Option C — Hybrid ✅ (chosen shape)
Realtime stream (Option B SSE gateway) for **safe, high-frequency events** (presence, games, matchmaking, system) + **REST snapshots** for privileged/detail data (wallet, ledger, audit, player 360) fetched on demand and on reconnect, with **polling fallback** when SSE is unavailable.

## Decision
**Adopt Option C, implemented on the Option B gateway.**
- v1 gateway = SSE endpoint backed by **service-role cursor polling** (≈1–2s tick) producing contract events; React Query does targeted cache patching; privileged details via existing authn'd REST.
- Reconnect → client requests a snapshot (`/api/admin/overview` + scoped lists) and reconciles by `entity version`.
- v2 (future) = swap the polling core for a **Durable Object** holding one upstream Supabase Realtime subscription and fanning sanitized events to all admin SSE connections (true push, lower DB load, multi-tab friendly).

## Why not A
A forces RLS to become the realtime security boundary for sensitive economy/moderation tables and puts admin identities inside the player auth system. The brief explicitly forbids weakening RLS and warns against browser subscriptions to private data. B/C keep the service-role boundary the security boundary, which is already the trusted channel for writes.

## Scorecard (1–5, higher better)
| Criterion | A | B | C |
|---|---|---|---|
| Security (no SR leak, no PII to wrong role) | 3 | 5 | 5 |
| No RLS loosening | 2 | 5 | 5 |
| Covers all 6 domains | 3 | 5 | 5 |
| Latency | 5 | 3 (v1) / 5 (v2 DO) | 4 |
| Complexity (low=better) | 3 | 3 | 3 |
| Operational burden | 4 | 4 | 4 |
| Reconnect/consistency | 3 | 5 | 5 |
| RBAC payload filtering | 2 | 5 | 5 |
| Cost | 5 | 4 | 4 |
| Observability | 3 | 5 | 5 |
| Future multi-admin | 3 | 5 | 5 |
| **Total** | 36 | **49** | **50** |

## Consequences
- New endpoint `GET /api/realtime/stream` (SSE, cookie-authn'd, role-aware).
- CSP `connect-src` can eventually drop direct Supabase `wss://` once the browser no longer subscribes.
- Client module `src/lib/adminRealtime.ts` replaces `src/lib/realtime.ts` (dedup, ordering, status, reconnect, snapshot reconcile, bounded feed, targeted RQ updates).
- DB cursor polling must be **bounded** (cursor by `id`/`updated_at`, capped page size) to satisfy the "no full-table refetch per event" rule.
