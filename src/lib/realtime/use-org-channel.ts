"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  type FloorEvent,
  type FloorEventPayloadMap,
  type PresencePayload,
  orgFloorTopic,
} from "./events";

// ─────────────────────────────────────────────────────────────────────────────
// The browser's end of the org floor channel.
//
// ONE socket + ONE channel per org, shared by every consumer on the page (the
// dialer, the monitors, the roster, the floor strip): a module-level registry
// ref-counts consumers and tears the channel down when the last one unmounts.
// Without this, four components would hold four websockets and four private-
// channel joins — and the whole point of E1 is replacing four poll loops with
// one push pipe, not with four push pipes.
//
// Private channel auth: RLS on realtime.messages authorizes the join by active-
// org membership (schema.sql PART 35), which requires the user's ACCESS TOKEN
// on the realtime connection — so we setAuth() before subscribing and re-set it
// on every auth refresh (tokens rotate hourly; a stale one would fail the next
// rejoin and silently strand the channel).
//
// Handlers live in refs: re-renders never resubscribe, and the newest closure
// always runs. Demo mode (no Supabase) reports "unavailable" and does nothing —
// every consumer keeps a poll fallback, so nothing breaks, it's just slower.
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelHealth = "connecting" | "live" | "reconnecting" | "unavailable";

type FloorHandlers = {
  [E in FloorEvent]?: (payload: FloorEventPayloadMap[E]) => void;
};

interface Listener {
  handle: (event: FloorEvent, payload: unknown) => void;
  resync: () => void;
  setHealth: (h: ChannelHealth) => void;
  setPresence: (p: Map<string, PresencePayload>) => void;
}

interface Entry {
  client: SupabaseClient;
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  health: ChannelHealth;
  presence: Map<string, PresencePayload>;
  /** Most recent presence payload a consumer asked to track (flushed on join). */
  pendingTrack: PresencePayload | null;
  joined: boolean;
  /** Set when the last consumer released the entry — subscribe() must not run
   *  after this, or the async auth handshake would rejoin a removed channel. */
  disposed: boolean;
  unsubAuth: () => void;
}

const FLOOR_EVENTS: FloorEvent[] = [
  "call.state",
  "call.answered",
  "transcript.segment",
  "leaderboard.delta",
  "review.created",
];

const registry = new Map<string, Entry>();

function notifyHealth(entry: Entry, health: ChannelHealth): void {
  entry.health = health;
  for (const l of entry.listeners) l.setHealth(health);
}

function syncPresence(entry: Entry): void {
  // presenceState() keys by presence ref/key; the floor keys by userId (the
  // payload we track always carries one — anything without it is ignored).
  const map = new Map<string, PresencePayload>();
  const state = entry.channel.presenceState() as Record<string, unknown[]>;
  for (const metas of Object.values(state)) {
    for (const meta of metas) {
      const p = meta as Partial<PresencePayload> | null;
      if (p && typeof p.userId === "string") map.set(p.userId, p as PresencePayload);
    }
  }
  entry.presence = map;
  for (const l of entry.listeners) l.setPresence(map);
}

function createEntry(orgId: string): Entry {
  const client = createClient();
  const channel = client.channel(orgFloorTopic(orgId), {
    config: {
      private: true,
      broadcast: { self: false, ack: false },
    },
  });

  const entry: Entry = {
    client,
    channel,
    listeners: new Set(),
    health: "connecting",
    presence: new Map(),
    pendingTrack: null,
    joined: false,
    disposed: false,
    unsubAuth: () => {},
  };

  for (const event of FLOOR_EVENTS) {
    channel.on("broadcast", { event }, (msg: { payload?: unknown }) => {
      for (const l of entry.listeners) l.handle(event, msg.payload ?? {});
    });
  }
  channel.on("presence", { event: "sync" }, () => syncPresence(entry));

  // The private-channel join is evaluated against the caller's JWT, so the
  // realtime socket must carry the session token BEFORE we subscribe — and a
  // fresh one after every refresh, or the next rejoin fails authorization.
  const { data: authSub } = client.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) void client.realtime.setAuth(session.access_token);
  });
  entry.unsubAuth = () => authSub.subscription.unsubscribe();

  void client.auth
    .getSession()
    .then(({ data }) => {
      if (data.session?.access_token) {
        return client.realtime.setAuth(data.session.access_token);
      }
    })
    .catch(() => {})
    .then(() => {
      // The auth handshake is async — if every consumer unmounted meanwhile,
      // joining now would leak a channel nothing will ever release.
      if (entry.disposed) return;
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          entry.joined = true;
          notifyHealth(entry, "live");
          // Fresh join = a gap we may have missed events across. Every consumer
          // refetches its snapshot, then rides the stream again.
          for (const l of entry.listeners) l.resync();
          if (entry.pendingTrack) void channel.track(entry.pendingTrack);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          entry.joined = false;
          notifyHealth(entry, "reconnecting");
        }
      });
    });

  return entry;
}

function acquire(orgId: string, listener: Listener): () => void {
  let entry = registry.get(orgId);
  if (!entry) {
    entry = createEntry(orgId);
    registry.set(orgId, entry);
  }
  entry.listeners.add(listener);
  // Late joiners get the current picture immediately, not on the next change.
  listener.setHealth(entry.health);
  listener.setPresence(entry.presence);

  const held = entry;
  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size === 0) {
      registry.delete(orgId);
      held.disposed = true;
      held.unsubAuth();
      void held.client.removeChannel(held.channel);
    }
  };
}

/** Update (or clear) the presence payload tracked on an org's channel. */
function trackOnEntry(orgId: string, track: PresencePayload | null): void {
  const entry = registry.get(orgId);
  if (!entry) return;
  entry.pendingTrack = track;
  if (!entry.joined) return; // flushed on SUBSCRIBED
  if (track) void entry.channel.track(track);
  else void entry.channel.untrack();
}

export interface UseOrgChannelOptions {
  orgId: string | null | undefined;
  /** Event handlers — kept in a ref, so inline objects are fine. */
  on?: FloorHandlers;
  /** Presence to self-report on the channel (the dialer tracks in E3). */
  track?: PresencePayload | null;
  /** Called on every (re)subscribe — refetch your snapshot here. */
  onResync?: () => void;
}

export interface UseOrgChannelResult {
  health: ChannelHealth;
  /** Self-reported presence on the channel, keyed by userId. */
  presence: Map<string, PresencePayload>;
}

export function useOrgChannel(opts: UseOrgChannelOptions): UseOrgChannelResult {
  const { orgId } = opts;
  const usable = Boolean(orgId) && isSupabaseConfigured();

  const [health, setHealth] = useState<ChannelHealth>(usable ? "connecting" : "unavailable");
  const [presence, setPresence] = useState<Map<string, PresencePayload>>(() => new Map());

  const onRef = useRef(opts.on);
  onRef.current = opts.on;
  const onResyncRef = useRef(opts.onResync);
  onResyncRef.current = opts.onResync;

  useEffect(() => {
    if (!orgId || !isSupabaseConfigured()) {
      setHealth("unavailable");
      setPresence(new Map());
      return;
    }
    const release = acquire(orgId, {
      handle: (event, payload) => {
        const handler = onRef.current?.[event] as
          | ((p: unknown) => void)
          | undefined;
        handler?.(payload);
      },
      resync: () => onResyncRef.current?.(),
      setHealth,
      setPresence,
    });
    return release;
  }, [orgId]);

  // Presence tracking rides the shared channel; only re-track when the payload
  // actually changes identity (callers should memoize or pass null).
  const track = opts.track ?? null;
  useEffect(() => {
    if (!orgId || !isSupabaseConfigured() || !track) return;
    trackOnEntry(orgId, track);
    return () => trackOnEntry(orgId, null);
  }, [orgId, track]);

  return { health, presence };
}
