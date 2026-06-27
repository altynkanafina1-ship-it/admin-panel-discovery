# Admin — Realtime Readiness Audit (v2)

## Current state
`src/lib/realtime.ts`:
```ts
supabase.channel(`rt-${table}-${random}`)
  .on("postgres_changes", { event:"*", schema:"public", table }, () => onChange())
  .subscribe();
```
- The **admin browser** holds the **anon** Supabase client and subscribes directly to Postgres CDC on public tables.
- `onChange()` is wired (in pages) to React Query invalidation → tends toward broad refetch.
- Channel name is randomised per mount → **risk of duplicate subscriptions** and no shared connection.

## Gap analysis vs. the brief's required live domains
| Domain | Can current anon-realtime deliver? | Why |
|---|---|---|
| Player presence (online/offline/last_seen) | ❌ | No presence channel; `last_seen_at` updates only via row writes; no Supabase Presence |
| Matchmaking (queue, match found, timeout) | ⚠️ partial | Only if a queue table is in the publication & anon-readable |
| Games (created/started/move/turn/capture/end) | ✅ public CDC | `games`/`moves` anon-readable & likely published |
| Stakes & economy (lock/payout/refund/ledger) | ❌ | `wallets`/`wallet_transactions` correctly hidden from anon → no events reach browser |
| Moderation (suspend/admin action) | ❌ | `admin_audit_log` hidden from anon |
| System (connected/recovering/degradation/version) | ❌ | No app-level system events |

**Verdict:** Realtime "works without refresh" **only for the public game tables**, and only by virtue of RLS being permissive enough to leak data the admin shouldn't be reading via the browser anyway. The privileged half of the operations centre (economy, moderation, audit, presence) **cannot** be served by the current design without weakening RLS further — which is explicitly forbidden.

## Required properties currently MISSING
- Event contract (`event_id`, `entity_type`, monotonic `version`, `occurred_at`).
- Deduplication & out-of-order handling.
- Connection-state UI (LIVE / reconnecting / stale).
- Snapshot reconciliation after reconnect.
- Bounded, windowed activity feed (current approach risks unbounded arrays).
- Targeted React Query cache patching (vs. blanket invalidation).
- Subscription teardown on logout (random channel names make this leaky).
- Authn/authz on the stream itself.

## SLO gap
None of the brief's SLOs (≤2s latency, ≤5s reconnect, ≤10s snapshot recovery, no dup, no stale, no unauthorized sub, no service-role leak) are *measured* today. The "no unauthorized subscription" SLO is **actively violated** (anon can subscribe).

**Recommendation:** Replace with the Cloudflare authenticated gateway (see ADR), which keeps service-role server-side, applies the event contract, and lets all six domains stream over one authn'd channel.
