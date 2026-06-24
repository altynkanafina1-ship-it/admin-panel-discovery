-- ============================================================
-- Shashki Royale · Admin Panel · Sprint 4 (v2, safe re-run)
-- ============================================================
-- Apply via Supabase SQL Editor.  Idempotent.  No BEGIN/COMMIT
-- so partial failure is visible immediately and previous parts stay applied.
-- ============================================================

-- ── 1. Suspension columns on profiles ─────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_until    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason  text         NULL,
  ADD COLUMN IF NOT EXISTS suspended_by       text         NULL;

CREATE INDEX IF NOT EXISTS profiles_suspended_until_idx
  ON public.profiles (suspended_until)
  WHERE suspended_until IS NOT NULL;

-- ── 2. Allow admin transaction types ──────────────────────────
-- Drop ALL existing CHECK constraints on wallet_transactions.type
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.wallet_transactions'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ~* 'type'
  LOOP
    EXECUTE format('ALTER TABLE public.wallet_transactions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'deposit','withdrawal','fee_lock','fee_refund','prize_payout',
    'starting_bonus','welcome_bonus','daily_bonus','referral',
    'win','loss','commission',
    'stake_lock','stake_refund','stake_payout',
    'admin_grant','admin_refund','admin_adjustment'
  ));

-- Drop the amount >= 0 CHECK so admin_adjustment can be negative
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.wallet_transactions'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ~* 'amount'
  LOOP
    EXECUTE format('ALTER TABLE public.wallet_transactions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ── 3. RPC: admin_grant_coin ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_grant_coin(
  p_profile_id  uuid,
  p_amount      numeric,
  p_reason      text,
  p_actor       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before numeric;
  v_after  numeric;
  v_tx_id  uuid;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'amount_required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  INSERT INTO wallets (profile_id, crypto_balance, locked_balance)
  VALUES (p_profile_id, 0, 0)
  ON CONFLICT (profile_id) DO NOTHING;

  SELECT crypto_balance INTO v_before
  FROM wallets WHERE profile_id = p_profile_id FOR UPDATE;

  v_after := v_before + p_amount;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  UPDATE wallets
  SET crypto_balance = v_after, updated_at = now()
  WHERE profile_id = p_profile_id;

  INSERT INTO wallet_transactions (profile_id, type, amount, status, note)
  VALUES (
    p_profile_id,
    CASE WHEN p_amount > 0 THEN 'admin_grant' ELSE 'admin_adjustment' END,
    p_amount, 'completed',
    format('[admin:%s] %s', p_actor, p_reason)
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'tx_id', v_tx_id, 'profile_id', p_profile_id,
    'amount', p_amount,
    'balance_before', v_before, 'balance_after', v_after
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_grant_coin(uuid, numeric, text, text) TO service_role;

-- ── 4. RPC: admin_refund_stake ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_refund_stake(
  p_stake_id  uuid,
  p_reason    text,
  p_actor     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stake          game_stakes;
  v_each           numeric;
  v_white_balance  numeric;
  v_black_balance  numeric;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO v_stake FROM game_stakes WHERE id = p_stake_id FOR UPDATE;
  IF v_stake.id IS NULL THEN RAISE EXCEPTION 'stake_not_found'; END IF;
  IF v_stake.escrow_status = 'refunded' THEN RAISE EXCEPTION 'already_refunded'; END IF;
  IF v_stake.payout_status = 'paid' THEN RAISE EXCEPTION 'already_paid'; END IF;

  v_each := v_stake.entry_fee;

  IF v_stake.white_profile_id IS NOT NULL THEN
    UPDATE wallets
    SET crypto_balance = crypto_balance + v_each,
        locked_balance = GREATEST(locked_balance - v_each, 0),
        updated_at = now()
    WHERE profile_id = v_stake.white_profile_id
    RETURNING crypto_balance INTO v_white_balance;

    INSERT INTO wallet_transactions (profile_id, game_id, type, amount, status, note)
    VALUES (v_stake.white_profile_id, v_stake.game_id, 'stake_refund', v_each, 'completed',
      format('[admin:%s] refund stake %s — %s', p_actor, p_stake_id, p_reason));
  END IF;

  IF v_stake.black_profile_id IS NOT NULL THEN
    UPDATE wallets
    SET crypto_balance = crypto_balance + v_each,
        locked_balance = GREATEST(locked_balance - v_each, 0),
        updated_at = now()
    WHERE profile_id = v_stake.black_profile_id
    RETURNING crypto_balance INTO v_black_balance;

    INSERT INTO wallet_transactions (profile_id, game_id, type, amount, status, note)
    VALUES (v_stake.black_profile_id, v_stake.game_id, 'stake_refund', v_each, 'completed',
      format('[admin:%s] refund stake %s — %s', p_actor, p_stake_id, p_reason));
  END IF;

  UPDATE game_stakes
  SET escrow_status = 'refunded', payout_status = 'refunded', updated_at = now()
  WHERE id = p_stake_id;

  RETURN jsonb_build_object(
    'stake_id', p_stake_id, 'each', v_each,
    'white_balance', v_white_balance, 'black_balance', v_black_balance
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_refund_stake(uuid, text, text) TO service_role;

-- ── 5. RPC: admin_set_suspension ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_suspension(
  p_profile_id uuid,
  p_hours      integer,
  p_reason     text,
  p_actor      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    UPDATE profiles
    SET suspended_until = NULL, suspension_reason = NULL,
        suspended_by = NULL, updated_at = now()
    WHERE id = p_profile_id;
    RETURN jsonb_build_object('profile_id', p_profile_id, 'suspended', false);
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  v_until := now() + (p_hours::text || ' hours')::interval;

  UPDATE profiles
  SET suspended_until = v_until, suspension_reason = p_reason,
      suspended_by = p_actor, updated_at = now()
  WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'profile_id', p_profile_id, 'suspended', true,
    'suspended_until', v_until, 'reason', p_reason
  );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_suspension(uuid, integer, text, text) TO service_role;

-- ── 6. Reload PostgREST schema cache ──────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 7. Verification ───────────────────────────────────────────
SELECT
  proname,
  pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('admin_grant_coin', 'admin_refund_stake', 'admin_set_suspension')
ORDER BY proname;
