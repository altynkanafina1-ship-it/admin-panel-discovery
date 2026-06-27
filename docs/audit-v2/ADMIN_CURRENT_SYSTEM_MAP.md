# Admin — Current System Map (v2)

## Components

```
                ┌─────────────────────────────────────────────┐
                │  Admin SPA (React 18 + Vite + TS)            │
                │  shashki-royale-admin.pages.dev              │
                │  - TanStack Query, Recharts, Tailwind (dark) │
                │  - @supabase/supabase-js (ANON key) ◄───────┐│
                └───────────────┬─────────────────────────────┘│
                                │ same-origin fetch /api/*       │ realtime
                                │ (HttpOnly admin_session cookie)│ postgres_changes
                                ▼                                │ (ANON, public tables)
                ┌─────────────────────────────────────────────┐ │
                │ Cloudflare Pages Function functions/api/[[..]]│ │
                │  - JWT verify (HS256, iss/aud/ver/exp)        │ │
                │  - SUPABASE_SERVICE_ROLE (server-only)        │ │
                │  - read endpoints + grant/refund/suspend      │ │
                └───────────────┬─────────────────────────────┘ │
                                │ service_role REST + RPC          │
                                ▼                                  ▼
                ┌──────────────────────────────────────────────────┐
                │ Supabase / PostgreSQL  ref jsykbnkbrwwsxcdurzcw    │
                │  tables: profiles, public_profiles(view), wallets, │
                │  wallet_transactions, games, moves, game_stakes,   │
                │  engagement_log, admin_audit_log, admin_operations,│
                │  admin_rate_violations, admin_users                │
                │  RPC: admin_grant_coin(_v2), admin_refund_stake(_v2)│
                │       admin_set_suspension(_v2), admin_wallets_totals│
                │       admin_tx_by_type                              │
                │  Realtime publication: (public tables — see below)  │
                └────────────────────────────────────────────────────┘
                                ▲
                                │ same DB (source of truth)
                ┌───────────────┴─────────────────────────────┐
                │  Game SPA (React + Vite + TS + PWA + Android) │
                │  shashki-royale.pages.dev (ANON key)          │
                └───────────────────────────────────────────────┘
```

## Trust boundaries
- **Browser ↔ Pages Function**: admin identity via HttpOnly cookie JWT. Strong.
- **Pages Function ↔ Supabase**: `service_role`, bypasses RLS. Strong, server-side only.
- **Browser ↔ Supabase (direct)**: `anon` key + realtime. **This is the weak boundary** — security depends entirely on RLS, and RLS is currently too permissive for `profiles`/`game_stakes`.

## Source of truth
Single shared Supabase project. Admin reads/writes go through the same tables and the same atomic RPC the game uses. **No separate admin database** — good. The admin `service_role` path is the correct privileged channel; the direct `anon` realtime path is the architecture smell to remove.

## Identity model (as-built)
- One admin: `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (pbkdf2-sha256, ≥100k iters) in Pages env.
- JWT `role` is hard-coded `"owner"` at mint time. `admin_users` table exists but is **not** consulted during auth.
