import { useRealtimeEvent } from "@/lib/adminRealtime";

/**
 * Compatibility shim (FIND V2-003).
 *
 * Previously this subscribed the admin browser directly to Supabase
 * `postgres_changes` using the public ANON key — an unauthenticated stream that
 * depended on permissive RLS and could not carry private domains.
 *
 * It now forwards to the secure Cloudflare authenticated gateway via
 * `useRealtimeEvent`. Existing pages keep the same `useRealtimeTable(table, cb)`
 * call signature, but no browser-side anon subscription is ever created.
 */
const TABLE_ENTITY: Record<string, string> = {
  games: "game",
  moves: "game",
  public_profiles: "player",
  profiles: "player",
  game_stakes: "stake",
  wallet_transactions: "wallet",
  admin_audit_log: "moderation",
};

export function useRealtimeTable(
  table: string,
  onChange: () => void,
  enabled = true,
) {
  useRealtimeEvent((e) => {
    if (!enabled) return;
    const ent = TABLE_ENTITY[table];
    if (ent && e.entity_type === ent) onChange();
  });
}
