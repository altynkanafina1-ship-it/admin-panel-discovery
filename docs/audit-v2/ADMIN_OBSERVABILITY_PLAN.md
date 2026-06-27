# Admin — Observability Plan

## Structured telemetry (emit, never log secrets)
Per request / stream, log a JSON line with:
`request_id` (cf-ray), `realtime_connection_id`, `admin_actor` (email/id), `role`, `event_type`, `entity_id`, `subscription_state`, `reconnect_count`, `latency_ms`, `dropped_event_count`, `dedup_count`, `snapshot_recovery_ms`, `api_status`, `rpc_error_code`.

**Never log:** JWT, cookies, password, service-role, full sensitive payloads, PII beyond the minimum (`profile_id` ok; `email`/IP only in the protected backend audit context).

## Where
- **Backend (Pages Function):** `console.log(JSON.stringify({...}))` → Cloudflare Logpush/Workers logs. Add `x-request-id` echo header on every response.
- **Gateway:** emit `system.heartbeat` with `lag_ms`; count reconnects/dedups server-side.
- **Client:** a small telemetry buffer posts aggregate stream health to `/api/telemetry` (bounded, throttled) for the dashboard.

## Audit hardening (ties to V2-009)
- Today `audit()` swallows failures in `catch{}`. Make audit failures **visible**: on failure, emit a `system.degraded{component:"audit"}` event and increment an error counter; never let a mutation succeed silently without its audit row. Consider an append-only/immutable mirror (separate table with `REVOKE UPDATE/DELETE` from all roles) + alerting on gaps.

## Dashboard / readout (System Health page)
- Realtime status (LIVE/reconnecting/down), stream latency (p50/p95), last successful snapshot time, error count, reconnect count, dropped/dedup counts, deployment version, API/RPC error rates, DB degradation banner.

## Alerting (recommended)
- Settlement failure spike, ledger inconsistency alert, audit-write failures, login rate-limit saturation, gateway disconnect storms.
