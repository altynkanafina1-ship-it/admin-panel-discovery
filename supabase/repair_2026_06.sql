-- ============================================================
-- Shashki Royale · Admin Panel · 2026-06 production REPAIR migration
-- ============================================================
-- One-shot, idempotent SQL bundle that closes the SQL-side findings
-- of the 2026-06-25 audit:
--
--   FIND-001  REVOKE EXECUTE on admin_* RPCs from PUBLIC, anon, authenticated
--   FIND-003  Atomic idempotency via admin_operations table
--   FIND-004  Replace blanket DROP CONSTRAINT with a targeted, named one
--   FIND-013  Replace ineffective UNIQUE(actor_id, idempotency_key) index
--   FIND-021  Add admin_wallets_totals() / admin_tx_by_type() aggregates
--   FIND-023  (same as 21) — also adds least-privilege grants
--   FIND-026  Seed admin_users.owner row so identity can move there next sprint
--   FIND-035  Patch grants so re-applying admin_sprint4.sql cannot regress
--   FIND-036  admin_refund_stake_v2 RAISEs on locked_balance < entry_fee
--   FIND-037  admin_refund_stake_v2 requires a prior stake_lock transaction
--
-- HOW TO APPLY:
--   1. (Recommended) On-demand backup via Supabase Studio → Database → Backups.
--   2. Open Supabase SQL Editor → New Query → paste THIS FILE → Run.
--   3. Verify with the SELECT at the bottom (should return 3 v2 RPCs and 2 helpers).
--   4. Re-run scripts/audit/probe_anon_rpc.sh — RPCs should return permission denied.
--
-- Safe to re-run. Every statement uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================

-- ── 1. FIND-001 / FIND-035 — REVOKE EXECUTE on legacy admin_* RPCs ─────
-- These functions still exist (called by the legacy admin router) but must
-- not be callable by anonymous / authenticated end users.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_grant_coin'
             AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_grant_coin(uuid, numeric, text, text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_grant_coin(uuid, numeric, text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_grant_coin(uuid, numeric, text, text) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_grant_coin(uuid, numeric, text, text) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_refund_stake'
             AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_refund_stake(uuid, text, text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_refund_stake(uuid, text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_refund_stake(uuid, text, text) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_refund_stake(uuid, text, text) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_set_suspension'
             AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_set_suspension(uuid, integer, text, text) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_set_suspension(uuid, integer, text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.admin_set_suspension(uuid, integer, text, text) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_set_suspension(uuid, integer, text, text) TO service_role';
  END IF;
END $$;

-- ── 2. FIND-004 — Reinstate a precise wallet_transactions amount invariant
-- The Sprint 4 migration dropped every constraint whose definition matched
-- 'amount'.  Reinstate one targeted constraint that allows ONLY the new
-- admin_adjustment type to be negative.
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_amount_check;
ALTER TABLE public.wallet_transactions
  ADD  CONSTRAINT wallet_transactions_amount_check
  CHECK (
    amount IS NOT NULL
    AND amount <> 0
    AND (
      type = 'admin_adjustment'
      OR amount > 0
    )
  );

-- ── 3. FIND-003 / FIND-013 — admin_operations table for atomic idempotency
CREATE TABLE IF NOT EXISTS public.admin_operations (
  idempotency_key uuid        PRIMARY KEY,
  actor_email     text        NOT NULL,
  action          text        NOT NULL,
  target_kind     text        NOT NULL,
  target_id       text        NOT NULL,
  amount          numeric,
  reason          text        NOT NULL,
  result          jsonb,
  status          text        NOT NULL CHECK (status IN ('succeeded','failed')),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_operations_actor_idx
  ON public.admin_operations (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_operations_target_idx
  ON public.admin_operations (target_kind, target_id, created_at DESC);

ALTER TABLE public.admin_operations ENABLE ROW LEVEL SECURITY;
-- no policies ⇒ no anon/authenticated visibility

-- Replace the ineffective unique index on admin_audit_log if present.
DROP INDEX IF EXISTS public.admin_audit_idem_idx;
CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_idem_key_only_idx
  ON public.admin_audit_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── 4. FIND-003 / FIND-001 — admin_grant_coin_v2 (self-idempotent) ─────
CREATE OR REPLACE FUNCTION public.admin_grant_coin_v2(
  p_profile_id      uuid,
  p_amount          numeric,
  p_reason          text,
  p_actor           text,
  p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing jsonb;
  v_before   numeric;
  v_after    numeric;
  v_tx_id    uuid;
BEGIN
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN RAISE EXCEPTION 'amount_required'; END IF;
  IF abs(p_amount) > 1000000 THEN RAISE EXCEPTION 'amount_too_large'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_actor IS NULL OR length(trim(p_actor)) < 3 THEN RAISE EXCEPTION 'actor_required'; END IF;

  -- Idempotency replay: if this key already succeeded, return cached result.
  SELECT result INTO v_existing FROM admin_operations
    WHERE idempotency_key = p_idempotency_key AND status = 'succeeded';
  IF FOUND THEN RETURN v_existing; END IF;

  -- Reserve the key atomically. If another tx wins the race, the INSERT will
  -- fail with a unique violation; we surface a "duplicate_in_flight" error.
  BEGIN
    INSERT INTO admin_operations (
      idempotency_key, actor_email, action, target_kind, target_id, amount, reason, status
    ) VALUES (
      p_idempotency_key, p_actor, 'grant_coin', 'player', p_profile_id::text, p_amount, p_reason, 'failed'
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT result INTO v_existing FROM admin_operations
      WHERE idempotency_key = p_idempotency_key AND status = 'succeeded';
    IF FOUND THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'duplicate_in_flight';
  END;

  -- Ensure wallet row, then read FOR UPDATE
  INSERT INTO wallets (profile_id, crypto_balance, locked_balance)
  VALUES (p_profile_id, 0, 0)
  ON CONFLICT (profile_id) DO NOTHING;

  SELECT crypto_balance INTO v_before FROM wallets WHERE profile_id = p_profile_id FOR UPDATE;
  v_after := v_before + p_amount;
  IF v_after < 0 THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  UPDATE wallets SET crypto_balance = v_after, updated_at = now()
   WHERE profile_id = p_profile_id;

  INSERT INTO wallet_transactions (profile_id, type, amount, status, note)
  VALUES (
    p_profile_id,
    CASE WHEN p_amount > 0 THEN 'admin_grant' ELSE 'admin_adjustment' END,
    p_amount, 'completed',
    format('[admin:%s] %s', p_actor, p_reason)
  ) RETURNING id INTO v_tx_id;

  -- Mark operation succeeded with the canonical result payload.
  UPDATE admin_operations
     SET status = 'succeeded',
         result = jsonb_build_object(
           'tx_id', v_tx_id, 'profile_id', p_profile_id,
           'amount', p_amount,
           'balance_before', v_before, 'balance_after', v_after
         )
   WHERE idempotency_key = p_idempotency_key
   RETURNING result INTO v_existing;
  RETURN v_existing;
END $$;
REVOKE ALL ON FUNCTION public.admin_grant_coin_v2(uuid, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_grant_coin_v2(uuid, numeric, text, text, uuid) TO service_role;

-- ── 5. FIND-003 / FIND-036 / FIND-037 — admin_refund_stake_v2 ──────────
CREATE OR REPLACE FUNCTION public.admin_refund_stake_v2(
  p_stake_id        uuid,
  p_reason          text,
  p_actor           text,
  p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stake          game_stakes;
  v_each           numeric;
  v_existing       jsonb;
  v_white_locked   numeric;
  v_black_locked   numeric;
  v_white_lock_seen boolean;
  v_black_lock_seen boolean;
BEGIN
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_actor  IS NULL OR length(trim(p_actor))  < 3 THEN RAISE EXCEPTION 'actor_required'; END IF;

  SELECT result INTO v_existing FROM admin_operations
    WHERE idempotency_key = p_idempotency_key AND status = 'succeeded';
  IF FOUND THEN RETURN v_existing; END IF;

  BEGIN
    INSERT INTO admin_operations (
      idempotency_key, actor_email, action, target_kind, target_id, amount, reason, status
    ) VALUES (
      p_idempotency_key, p_actor, 'refund_stake', 'stake', p_stake_id::text, NULL, p_reason, 'failed'
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT result INTO v_existing FROM admin_operations
      WHERE idempotency_key = p_idempotency_key AND status = 'succeeded';
    IF FOUND THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'duplicate_in_flight';
  END;

  SELECT * INTO v_stake FROM game_stakes WHERE id = p_stake_id FOR UPDATE;
  IF v_stake.id IS NULL THEN RAISE EXCEPTION 'stake_not_found'; END IF;
  IF v_stake.escrow_status = 'refunded' THEN RAISE EXCEPTION 'already_refunded'; END IF;
  IF v_stake.payout_status = 'paid'     THEN RAISE EXCEPTION 'already_paid';     END IF;

  v_each := v_stake.entry_fee;
  IF v_each IS NULL OR v_each <= 0 THEN RAISE EXCEPTION 'invalid_entry_fee'; END IF;

  -- WHITE side
  IF v_stake.white_profile_id IS NOT NULL THEN
    SELECT locked_balance INTO v_white_locked FROM wallets
      WHERE profile_id = v_stake.white_profile_id FOR UPDATE;
    SELECT EXISTS(
      SELECT 1 FROM wallet_transactions
       WHERE profile_id = v_stake.white_profile_id
         AND game_id    = v_stake.game_id
         AND type       = 'stake_lock'
    ) INTO v_white_lock_seen;
    IF NOT v_white_lock_seen THEN RAISE EXCEPTION 'no_prior_stake_lock_white'; END IF;
    IF v_white_locked IS NULL OR v_white_locked < v_each THEN RAISE EXCEPTION 'locked_balance_inconsistent_white'; END IF;

    UPDATE wallets
       SET crypto_balance = crypto_balance + v_each,
           locked_balance = locked_balance - v_each,
           updated_at     = now()
     WHERE profile_id = v_stake.white_profile_id;
    INSERT INTO wallet_transactions (profile_id, game_id, type, amount, status, note)
    VALUES (v_stake.white_profile_id, v_stake.game_id, 'stake_refund', v_each, 'completed',
            format('[admin:%s] refund stake %s — %s', p_actor, p_stake_id, p_reason));
  END IF;

  -- BLACK side
  IF v_stake.black_profile_id IS NOT NULL THEN
    SELECT locked_balance INTO v_black_locked FROM wallets
      WHERE profile_id = v_stake.black_profile_id FOR UPDATE;
    SELECT EXISTS(
      SELECT 1 FROM wallet_transactions
       WHERE profile_id = v_stake.black_profile_id
         AND game_id    = v_stake.game_id
         AND type       = 'stake_lock'
    ) INTO v_black_lock_seen;
    IF NOT v_black_lock_seen THEN RAISE EXCEPTION 'no_prior_stake_lock_black'; END IF;
    IF v_black_locked IS NULL OR v_black_locked < v_each THEN RAISE EXCEPTION 'locked_balance_inconsistent_black'; END IF;

    UPDATE wallets
       SET crypto_balance = crypto_balance + v_each,
           locked_balance = locked_balance - v_each,
           updated_at     = now()
     WHERE profile_id = v_stake.black_profile_id;
    INSERT INTO wallet_transactions (profile_id, game_id, type, amount, status, note)
    VALUES (v_stake.black_profile_id, v_stake.game_id, 'stake_refund', v_each, 'completed',
            format('[admin:%s] refund stake %s — %s', p_actor, p_stake_id, p_reason));
  END IF;

  UPDATE game_stakes
     SET escrow_status = 'refunded', payout_status = 'refunded', updated_at = now()
   WHERE id = p_stake_id;

  UPDATE admin_operations
     SET status = 'succeeded',
         result = jsonb_build_object(
           'stake_id', p_stake_id, 'each', v_each,
           'white_profile_id', v_stake.white_profile_id,
           'black_profile_id', v_stake.black_profile_id
         )
   WHERE idempotency_key = p_idempotency_key
   RETURNING result INTO v_existing;
  RETURN v_existing;
END $$;
REVOKE ALL ON FUNCTION public.admin_refund_stake_v2(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_refund_stake_v2(uuid, text, text, uuid) TO service_role;

-- ── 6. FIND-003 — admin_set_suspension_v2 (self-idempotent) ────────────
CREATE OR REPLACE FUNCTION public.admin_set_suspension_v2(
  p_profile_id      uuid,
  p_hours           integer,
  p_reason          text,
  p_actor           text,
  p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing jsonb;
  v_until    timestamptz;
BEGIN
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  IF p_actor  IS NULL OR length(trim(p_actor))  < 3 THEN RAISE EXCEPTION 'actor_required'; END IF;

  SELECT result INTO v_existing FROM admin_operations
    WHERE idempotency_key = p_idempotency_key AND status = 'succeeded';
  IF FOUND THEN RETURN v_existing; END IF;

  BEGIN
    INSERT INTO admin_operations (
      idempotency_key, actor_email, action, target_kind, target_id, amount, reason, status
    ) VALUES (
      p_idempotency_key, p_actor,
      CASE WHEN p_hours > 0 THEN 'suspend_player' ELSE 'unsuspend_player' END,
      'player', p_profile_id::text, p_hours, COALESCE(p_reason, ''), 'failed'
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT result INTO v_existing FROM admin_operations
      WHERE idempotency_key = p_idempotency_key AND status = 'succeeded';
    IF FOUND THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'duplicate_in_flight';
  END;

  IF p_hours IS NULL OR p_hours <= 0 THEN
    UPDATE profiles SET suspended_until = NULL, suspension_reason = NULL, suspended_by = NULL, updated_at = now()
     WHERE id = p_profile_id;
    v_existing := jsonb_build_object('profile_id', p_profile_id, 'suspended', false);
  ELSE
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
    IF p_hours > 8760 THEN RAISE EXCEPTION 'hours_too_large'; END IF;
    v_until := now() + (p_hours::text || ' hours')::interval;
    UPDATE profiles
       SET suspended_until = v_until, suspension_reason = p_reason,
           suspended_by    = p_actor,  updated_at = now()
     WHERE id = p_profile_id;
    v_existing := jsonb_build_object(
      'profile_id', p_profile_id, 'suspended', true,
      'suspended_until', v_until, 'reason', p_reason
    );
  END IF;

  UPDATE admin_operations SET status='succeeded', result=v_existing
   WHERE idempotency_key = p_idempotency_key;
  RETURN v_existing;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_suspension_v2(uuid, integer, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_set_suspension_v2(uuid, integer, text, text, uuid) TO service_role;

-- ── 7. FIND-021 / FIND-023 — aggregate helpers ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_wallets_totals()
RETURNS TABLE (balance numeric, locked numeric, won numeric, lost numeric, wallet_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(SUM(crypto_balance),0)::numeric AS balance,
    COALESCE(SUM(locked_balance),0)::numeric AS locked,
    COALESCE(SUM(total_won),0)::numeric      AS won,
    COALESCE(SUM(total_lost),0)::numeric     AS lost,
    COUNT(*)                                  AS wallet_count
  FROM wallets;
$$;
REVOKE ALL ON FUNCTION public.admin_wallets_totals() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_wallets_totals() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_tx_by_type()
RETURNS TABLE (type text, count bigint, sum numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(type, 'unknown') AS type,
    COUNT(*)                  AS count,
    COALESCE(SUM(amount),0)   AS sum
  FROM wallet_transactions
  GROUP BY 1
  ORDER BY abs(sum) DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_tx_by_type() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_tx_by_type() TO service_role;

-- ── 8. FIND-026 — seed admin_users so identity can migrate next sprint
-- Note: the password_hash is NOT used by the current router (auth still goes
-- via env), but the row enables `is_active` checks and last_login_* updates
-- after the Phase-1 identity refactor.
INSERT INTO public.admin_users (email, password_hash, role, is_active)
SELECT 'owner@damkaroyal.app', 'PBKDF2_HASH_LIVES_IN_CF_ENV', 'owner', true
WHERE NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = 'owner@damkaroyal.app');

-- ── 9. Reload PostgREST cache ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 10. Verification queries ───────────────────────────────────────────
-- After applying, expect three v2 RPCs and two helper functions, plus
-- the admin_operations table with the correct PK + indexes.
SELECT
  p.proname,
  pg_get_function_arguments(p.oid) AS args,
  array(
    SELECT acl.grantee::regrole::text || '=' || acl.privilege_type
    FROM aclexplode(p.proacl) acl
  ) AS acl
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'admin_grant_coin','admin_grant_coin_v2',
    'admin_refund_stake','admin_refund_stake_v2',
    'admin_set_suspension','admin_set_suspension_v2',
    'admin_wallets_totals','admin_tx_by_type'
  )
ORDER BY 1;

SELECT to_regclass('public.admin_operations') AS admin_operations_table;
