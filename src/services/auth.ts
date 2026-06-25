/**
 * Admin auth client — talks to Cloudflare Pages Functions at /api/*
 *
 * Hardened version after the audit. Notes:
 *  - JWT is delivered via HttpOnly cookie set by /api/auth/login (FIND-006).
 *    The frontend NEVER touches the token — XSS cannot exfiltrate it.
 *  - Session presence is determined by calling /api/auth/me; the cookie
 *    rides along automatically because /api/* is same-origin.
 *  - All `apiFetch`/`apiMutate` errors now properly throw on !ok (FIND-042).
 *  - Idempotency keys for mutations are now passed in from the caller
 *    (FIND-045) so retries reuse the same key.
 */

const API = (import.meta.env.VITE_API_URL as string) || "/api";

export type AdminSession = { email: string; role: string; exp: number };

let _cached: AdminSession | null = null;

export async function fetchSession(): Promise<AdminSession | null> {
  try {
    const r = await fetch(`${API}/auth/me`, {
      credentials: "same-origin",
      headers: { "x-requested-with": "fetch" },
    });
    if (!r.ok) {
      _cached = null;
      return null;
    }
    const data = (await r.json()) as AdminSession;
    _cached = data;
    return data;
  } catch {
    _cached = null;
    return null;
  }
}

export function cachedSession(): AdminSession | null {
  return _cached;
}

export async function login(email: string, password: string): Promise<AdminSession> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-requested-with": "fetch" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await r.json().catch(() => ({}))) as { error?: string; email?: string; role?: string; expiresIn?: number };
  if (!r.ok) throw new Error(body.error || `http_${r.status}`);
  // Session is now established via HttpOnly cookie set by the server.
  const sess: AdminSession = {
    email: body.email || email,
    role: body.role || "owner",
    exp: Math.floor(Date.now() / 1000) + (body.expiresIn || 28800),
  };
  _cached = sess;
  return sess;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API}/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-requested-with": "fetch" },
    });
  } catch { /* ignore */ }
  _cached = null;
}

async function apiFetch(path: string): Promise<unknown> {
  const r = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    headers: { "x-requested-with": "fetch" },
  });
  if (r.status === 401) {
    _cached = null;
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body?.error || `http_${r.status}`);
  }
  return r.json();
}

async function apiMutate(path: string, body: unknown): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(`${API}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("network_error");
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 401) {
    _cached = null;
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    throw new Error(data.error || `http_${r.status}`);
  }
  return data;
}

export type FullProfile = {
  id: string;
  player_id: string | null;
  nickname: string;
  email: string | null;
  display_name: string | null;
  avatar_index: number;
  rating: number;
  total_games: number;
  wins: number;
  losses: number;
  draws: number;
  win_streak: number;
  best_win_streak: number;
  login_streak: number;
  last_login_date: string | null;
  rank_tier: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type Wallet = {
  profile_id: string;
  crypto_balance: number;
  locked_balance: number;
  total_deposited: number;
  total_withdrawn: number;
  total_won: number;
  total_lost: number;
  created_at: string;
  updated_at: string;
};

export type WalletTransaction = {
  id: string;
  profile_id: string;
  game_id: string | null;
  type: string;
  amount: number | string;
  status: string;
  note: string | null;
  balance_before: number | null;
  balance_after: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  nickname?: string | null;
  avatar_index?: number;
};

export type Stake = {
  id: string;
  game_id: string;
  entry_fee: number | string;
  pot_amount: number | string;
  white_profile_id: string | null;
  black_profile_id: string | null;
  escrow_status: "waiting" | "locked" | "paid" | "refunded";
  payout_status: "pending" | "paid" | "failed" | "refunded";
  created_at: string;
  updated_at: string;
};

export type Player360 = {
  profile: (FullProfile & {
    suspended_until?: string | null;
    suspension_reason?: string | null;
    suspended_by?: string | null;
  }) | null;
  wallet: Wallet | null;
  transactions: WalletTransaction[];
  stakes: Stake[];
};

export async function fetchPlayer360(id: string): Promise<Player360> {
  return apiFetch(`/admin/players/${id}`) as Promise<Player360>;
}

export type AuditEntry = {
  id: number;
  actor_email: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  reason: string | null;
  status: string;
  error: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

export async function fetchPlayerAudit(id: string): Promise<{ rows: AuditEntry[] }> {
  return apiFetch(`/admin/players/${id}/audit`) as Promise<{ rows: AuditEntry[] }>;
}

// ── Mutations — idempotency_key is now REQUIRED and provided by caller (FIND-045)
export async function grantCoin(
  profileId: string, amount: number, reason: string, idempotencyKey: string,
): Promise<{ ok: true; result: Record<string, unknown> }> {
  return apiMutate(`/admin/players/${profileId}/grant-coin`, {
    amount, reason, idempotency_key: idempotencyKey,
  }) as Promise<{ ok: true; result: Record<string, unknown> }>;
}

export async function refundStake(
  stakeId: string, reason: string, idempotencyKey: string,
): Promise<{ ok: true; result: Record<string, unknown> }> {
  return apiMutate(`/admin/stakes/${stakeId}/refund`, {
    reason, idempotency_key: idempotencyKey,
  }) as Promise<{ ok: true; result: Record<string, unknown> }>;
}

export async function suspendPlayer(
  profileId: string, hours: number, reason: string, idempotencyKey: string,
): Promise<{ ok: true; result: Record<string, unknown> }> {
  return apiMutate(`/admin/players/${profileId}/suspend`, {
    hours, reason, idempotency_key: idempotencyKey,
  }) as Promise<{ ok: true; result: Record<string, unknown> }>;
}

export type WalletSummary = {
  top: Array<Wallet & { nickname: string | null; avatar_index: number }>;
  totals: { balance: number; locked: number; won: number; lost: number };
  walletCount: number;
};
export async function fetchWalletsSummary(): Promise<WalletSummary> {
  return apiFetch("/admin/wallets/summary") as Promise<WalletSummary>;
}
export async function fetchRecentTransactions(limit = 50): Promise<{ rows: WalletTransaction[] }> {
  return apiFetch(`/admin/transactions/recent?limit=${limit}`) as Promise<{ rows: WalletTransaction[] }>;
}
export async function fetchTxByType(): Promise<{ rows: Array<{ type: string; count: number; sum: number }> }> {
  return apiFetch("/admin/transactions/by-type") as Promise<{
    rows: Array<{ type: string; count: number; sum: number }>;
  }>;
}
