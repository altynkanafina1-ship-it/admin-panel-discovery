# Admin — Realtime Event Contract

All events crossing the gateway → admin browser conform to:

```ts
export type AdminRealtimeEvent = {
  event_id: string;        // ULID/uuid — unique; used for dedup
  event_type: string;      // see registry below
  entity_type: "player" | "game" | "stake" | "wallet" | "queue"
             | "moderation" | "system";
  entity_id: string;       // PK of the affected entity ("-" for system)
  occurred_at: string;     // ISO8601 (DB timestamp, not gateway clock, where possible)
  version?: number;        // monotonic per-entity version (e.g. move_number, updated_at epoch)
  actor_type?: "player" | "admin" | "system";
  correlation_id?: string; // request/trace id (e.g. cf-ray of the originating action)
  payload: Record<string, unknown>; // sanitized, role-filtered, NO secrets/tokens
};
```

## Rules
- **Schema version:** every SSE frame is prefixed by a stream header `{"_schema":1}` event on connect. Bump on breaking change.
- **Deduplication:** client keeps an LRU set of the last N `event_id`s; duplicates dropped.
- **Ordering:** events carry `version`; client never applies a lower `version` over a higher one for the same `entity_id`.
- **No-secret policy:** gateway strips `auth_user_id`, `email`, IP, device, service-role — always. PII fields (`player_id`, raw email) only included for roles with `pii:read` permission.
- **Correlation:** admin-initiated events echo the `correlation_id` of the mutation that caused them.
- **`occurred_at` vs gateway time:** use the source row timestamp; the gateway adds `received_at` only in observability logs, not the contract.

## Event registry
| event_type | entity_type | version source | payload (sanitized) |
|---|---|---|---|
| `player.online` | player | last_seen epoch | `{profile_id, nickname, avatar_index, current_game?}` |
| `player.offline` | player | last_seen epoch | `{profile_id, last_seen_at}` |
| `queue.entered` | queue | ts | `{profile_id, stake, queued_at}` |
| `queue.cancelled` | queue | ts | `{profile_id}` |
| `match.found` | game | ts | `{game_id, white_profile_id, black_profile_id, stake}` |
| `game.created` | game | updated_at | `{game_id, room_code, stake}` |
| `game.started` | game | updated_at | `{game_id, room_code}` |
| `game.move` | game | move_number | `{game_id, move_number, player_color}` *(delta, NOT full board)* |
| `game.turn_changed` | game | move_number | `{game_id, current_turn, move_number}` |
| `game.capture` | game | move_number | `{game_id, move_number, count}` |
| `game.ended` | game | updated_at | `{game_id, winner, resign_reason?}` |
| `game.resign` | game | updated_at | `{game_id, by_color}` |
| `game.timeout` | game | updated_at | `{game_id, loser_color}` |
| `stake.created` | stake | updated_at | `{stake_id, game_id, entry_fee, pot_amount, escrow_status}` |
| `stake.locked` | stake | updated_at | `{stake_id, escrow_status}` |
| `stake.payout` | stake | updated_at | `{stake_id, pot_amount, payout_status}` |
| `stake.refund` | stake | updated_at | `{stake_id, payout_status}` |
| `stake.settlement_error` | stake | updated_at | `{stake_id, error_code}` |
| `wallet.transaction` | wallet | created_at | `{tx_id, profile_id*, type, amount, balance_after}` (*role-gated) |
| `wallet.ledger_alert` | wallet | ts | `{kind, detail}` |
| `moderation.suspended` | moderation | ts | `{profile_id, suspended_until, by}` |
| `moderation.unsuspended` | moderation | ts | `{profile_id}` |
| `moderation.admin_action` | moderation | ts | `{action, target_id, actor, idempotency_key}` |
| `system.connected` | system | — | `{stream_id}` |
| `system.heartbeat` | system | — | `{ts, lag_ms}` |
| `system.recovering` | system | — | `{reason}` |
| `system.degraded` | system | — | `{component, detail}` |
| `system.deployment` | system | — | `{version}` |

## Delta discipline
`game.move` carries only `move_number`/`player_color` — the Match Detail view fetches the authoritative board via `/api/admin/game/:id` on open and applies move deltas thereafter; it does **not** receive a full board snapshot per move.
