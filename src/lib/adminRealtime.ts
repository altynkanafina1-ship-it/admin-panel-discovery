/**
 * Admin secure realtime client.
 *
 * Connects to the Cloudflare authenticated SSE gateway at /api/realtime/stream.
 * The browser NEVER holds a Supabase service-role key and NEVER subscribes to
 * Supabase directly — the gateway (functions/api) authenticates the admin via the
 * HttpOnly cookie, reads with service_role server-side, sanitises payloads and
 * forwards only AdminRealtimeEvent frames.
 *
 * Replaces the legacy anon-key postgres_changes subscription (FIND V2-003).
 *
 * Responsibilities: reconnect (native EventSource + status), deduplication by
 * event_id, monotonic per-entity version ordering, bounded feed, connection
 * status + last-event age, clean teardown on logout.
 */
import { useEffect, useRef, useState } from "react";

export type AdminRealtimeEvent = {
  event_id: string;
  event_type: string;
  entity_type:
    | "player"
    | "game"
    | "stake"
    | "wallet"
    | "queue"
    | "moderation"
    | "system";
  entity_id: string;
  occurred_at: string;
  version?: number;
  actor_type?: "player" | "admin" | "system";
  correlation_id?: string;
  payload: Record<string, unknown>;
};

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "down";

type EventHandler = (e: AdminRealtimeEvent) => void;
type StatusListener = () => void;

const FEED_MAX = 200;
const DEDUP_MAX = 600;

class AdminRealtimeClient {
  private es: EventSource | null = null;
  private started = false;

  status: StreamStatus = "idle";
  lastEventAt = 0;
  reconnectCount = 0;
  dedupCount = 0;
  droppedStaleCount = 0;

  private feed: AdminRealtimeEvent[] = [];
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private versions = new Map<string, number>();

  private eventHandlers = new Set<EventHandler>();
  private statusListeners = new Set<StatusListener>();

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  stop() {
    this.started = false;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.feed = [];
    this.seen.clear();
    this.seenOrder = [];
    this.versions.clear();
    this.setStatus("idle");
  }

  private connect() {
    if (!this.started) return;
    this.setStatus(this.reconnectCount > 0 ? "reconnecting" : "connecting");
    try {
      // same-origin → HttpOnly admin_session cookie rides along automatically.
      this.es = new EventSource("/api/realtime/stream", { withCredentials: true });
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.es.onopen = () => this.setStatus("live");
    this.es.onmessage = (ev) => this.ingest(ev.data);
    this.es.onerror = () => {
      // EventSource auto-reconnects; reflect transient state. If the gateway
      // closed us (e.g. 401 after logout) we will keep failing → "down".
      if (!this.started) return;
      this.setStatus("reconnecting");
      this.reconnectCount += 1;
      // If the browser does not auto-recover quickly, force a clean reconnect.
      if (this.es && this.es.readyState === EventSource.CLOSED) {
        this.es = null;
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (!this.started) return;
    const delay = Math.min(5000, 800 * Math.max(1, this.reconnectCount));
    setTimeout(() => this.connect(), delay);
  }

  private ingest(raw: string) {
    let e: AdminRealtimeEvent;
    try {
      e = JSON.parse(raw) as AdminRealtimeEvent;
    } catch {
      return;
    }
    if (!e || !e.event_id) return;

    // dedup
    if (this.seen.has(e.event_id)) {
      this.dedupCount += 1;
      return;
    }
    this.seen.add(e.event_id);
    this.seenOrder.push(e.event_id);
    if (this.seenOrder.length > DEDUP_MAX) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }

    // monotonic ordering per entity
    if (typeof e.version === "number" && e.entity_id) {
      const key = `${e.entity_type}:${e.entity_id}`;
      const prev = this.versions.get(key);
      if (prev !== undefined && e.version <= prev) {
        this.droppedStaleCount += 1;
        return;
      }
      this.versions.set(key, e.version);
    }

    if (e.event_type !== "system.heartbeat") {
      this.lastEventAt = Date.now();
      this.feed.unshift(e);
      if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
    }

    if (e.event_type === "system.connected") this.setStatus("live");

    for (const h of this.eventHandlers) {
      try {
        h(e);
      } catch {
        /* handler errors must not break the stream */
      }
    }
    this.emitStatus();
  }

  private setStatus(s: StreamStatus) {
    if (this.status !== s) {
      this.status = s;
      this.emitStatus();
    }
  }
  private emitStatus() {
    for (const l of this.statusListeners) l();
  }

  onEvent(h: EventHandler): () => void {
    this.eventHandlers.add(h);
    return () => {
      this.eventHandlers.delete(h);
    };
  }
  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => {
      this.statusListeners.delete(l);
    };
  }
  getFeed() {
    return this.feed;
  }
}

export const adminRealtime = new AdminRealtimeClient();

/** Subscribe a component to live connection status + counters. */
export function useRealtimeStatus() {
  const [, force] = useState(0);
  useEffect(() => {
    adminRealtime.start();
    return adminRealtime.onStatus(() => force((n) => n + 1));
  }, []);
  return {
    status: adminRealtime.status,
    lastEventAt: adminRealtime.lastEventAt,
    reconnectCount: adminRealtime.reconnectCount,
    dedupCount: adminRealtime.dedupCount,
    droppedStaleCount: adminRealtime.droppedStaleCount,
  };
}

/** Register a deduped/ordered event handler for targeted cache updates. */
export function useRealtimeEvent(handler: EventHandler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    adminRealtime.start();
    return adminRealtime.onEvent((e) => ref.current(e));
  }, []);
}

/** Bounded live feed for the activity timeline. */
export function useRealtimeFeed(limit = 60) {
  const [, force] = useState(0);
  useEffect(() => {
    adminRealtime.start();
    return adminRealtime.onEvent(() => force((n) => n + 1));
  }, []);
  return adminRealtime.getFeed().slice(0, limit);
}
