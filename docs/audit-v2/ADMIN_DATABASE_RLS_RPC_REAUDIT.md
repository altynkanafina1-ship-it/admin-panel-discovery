# Admin — Database / RLS / RPC Re-Audit (v2)

> Verified via anonymous probes + service-role-side code review. Direct service-role schema introspection (information_schema / pg_proc) requires the rotated service-role key and should be re-run by the owner after rotation; the SQL diagnostics in `scripts/audit/*.sql` are provided for that.

## What is proven present in production
| Object | Evidence | Status |
|---|---|---|
| `admin_operations` table | anon `select` → 200 (RLS empty) | EXISTS |
| `admin_rate_violations` table | anon `select` → 200 | EXISTS |
| `admin_users` table | anon `select` → 200 | EXISTS |
| `admin_audit_log` table | anon `select` → 200 (RLS empty) | EXISTS |
| `admin_grant_coin_v2` RPC | anon → `42501` | EXISTS, anon-revoked |
| `admin_grant_coin` (legacy) RPC | anon → `42501` | EXISTS, anon-revoked |
| `admin_refund_stake_v2` RPC | anon → `42501` | EXISTS, anon-revoked |
| `admin_set_suspension_v2` RPC | anon → `42501` | EXISTS, anon-revoked |
| `admin_wallets_totals` RPC | anon → `42501` | EXISTS, anon-revoked |
| `admin_tx_by_type` RPC | anon → `42501` | EXISTS, anon-revoked |

**Conclusion:** `supabase/repair_2026_06.sql` is **applied** to the degree that its v2 RPCs and operation/audit tables exist and admin RPC EXECUTE is revoked from `anon`. The "file present ≠ applied" risk does **not** materialise here for the RPC layer.

## RLS posture (probed)
| Table | anon SELECT | Verdict |
|---|---|---|
| `wallets` | 200 `[]` | RLS effective (no rows to anon) ✅ |
| `wallet_transactions` | 200 `[]` | RLS effective ✅ |
| `admin_audit_log` | 200 `[]` | RLS effective ✅ |
| `admin_operations` / `admin_rate_violations` / `admin_users` | 200 `[]` | effective ✅ |
| `profiles` (RAW) | 200 **rows w/ player_id, auth_user_id, email** | **RLS too broad — V2-002** ❌ |
| `public_profiles` (view) | 200 rows (nickname/avatar) | intended ✅ |
| `game_stakes` | 200 **full rows** | **exposed — V2-004** ⚠️ |
| `games`, `moves` | 200 rows | needed for gameplay; acceptable but feeds insecure realtime |

## Items the owner must still verify with service-role (cannot be proven anon-only)
1. `admin_operations` has `PRIMARY KEY (idempotency_key)` (atomic dedupe). — run `scripts/audit/diag_constraints.sql`.
2. Exact `CHECK` constraints on amounts / suspension hours at DB level.
3. `SECURITY DEFINER` functions have `SET search_path = public, pg_temp` (anti-search-path-hijack) and schema-qualified table refs. — run `scripts/audit/diag_grants.sql`.
4. Precise EXECUTE grant matrix (which of `authenticated`/`service_role` can call each RPC; legacy RPCs should be `service_role`-only).
5. The set of tables in the `supabase_realtime` publication (drives the ADR; see Realtime Readiness doc).

## Recommended RLS migration (prepared, NOT auto-applied — needs isolated verify + rollback)
See `supabase/repair_2026_06.sql` for the existing bundle; the v2 remediation adds:
```sql
-- V2-002: lock raw profiles to self + service_role; force public reads via public_profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_anon_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());
-- service_role bypasses RLS automatically.

-- V2-004: restrict game_stakes to participants + service_role
ALTER TABLE public.game_stakes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS game_stakes_anon_read ON public.game_stakes;
CREATE POLICY game_stakes_participant_read ON public.game_stakes FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() IN (
     SELECT auth_user_id FROM public.profiles
     WHERE id IN (white_profile_id, black_profile_id)));
```
> ⚠️ **Rollback plan:** capture current policies first (`diag_grants.sql`), apply on a branch DB / staging snapshot, replay game smoke (matchmaking + a full game + settlement) to confirm the game still functions for *authenticated* users, then promote. The game currently reads these tables with the `anon` key for *guest* users — confirm the guest flow uses an authenticated `auth.uid()` (it appears to: `player_id` like `auth_guest_*` with `auth_user_id` populated for signed-in users) before tightening, or the change will break guest play. **This is the single highest-regression-risk change and must not be applied blind.**
