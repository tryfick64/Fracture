import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { useEffect, useRef, useState, useCallback } from "react";

// ── Ленивый Supabase клиент ──────────────────────────────────────────────────
// ВАЖНО: создаём клиента только при первом обращении и только если env есть.
// Иначе createClient("", "") бросает «supabaseUrl is required» прямо при
// импорте модуля → React не успевает смонтироваться → белый экран.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

let _client: SupabaseClient | null = null;

export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!hasSupabaseConfig()) {
    throw new Error(
      "Supabase не настроен: задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в .env.local"
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 30 } },
  });
  return _client;
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
export function generateRoomKey(len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function getClientId(): string {
  const KEY = "fracture-client-id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        "c_" +
        Math.random().toString(36).slice(2, 10) +
        Date.now().toString(36).slice(-4);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "c_" + Math.random().toString(36).slice(2, 12);
  }
}

// ── Типы сообщений ───────────────────────────────────────────────────────────
export interface RoomMessage<T = unknown> {
  from: string;
  ts: number;
  payload: T;
}

// ── Хук: подключение к комнате ───────────────────────────────────────────────
export interface UseRoomOptions<TState> {
  roomKey: string | null;
  state: TState;
  applyRemoteState: (state: TState) => void;
  throttleMs?: number;
}

export function useRoom<TState>({
  roomKey,
  state,
  applyRemoteState,
  throttleMs = 40,
}: UseRoomOptions<TState>) {
  const clientId = useRef(getClientId());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const lastSentRef = useRef<string>("");
  const lastAppliedRemoteRef = useRef<string>("");
  const pendingSendRef = useRef<TState | null>(null);
  const lastSendAtRef = useRef<number>(0);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyRef = useRef(applyRemoteState);
  useEffect(() => {
    applyRef.current = applyRemoteState;
  }, [applyRemoteState]);

  useEffect(() => {
    if (!roomKey) {
      setConnected(false);
      setPeerCount(0);
      setError(null);
      return;
    }

    let sb: SupabaseClient;
    try {
      sb = getSupabase();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error("[realtime]", msg);
      return;
    }

    const channel = sb.channel(`fracture:${roomKey}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: clientId.current },
      },
    });

    channel
      .on("broadcast", { event: "state" }, (msg) => {
        const data = msg.payload as RoomMessage<TState>;
        if (!data || data.from === clientId.current) return;
        const serialized = JSON.stringify(data.payload);
        if (serialized === lastAppliedRemoteRef.current) return;
        lastAppliedRemoteRef.current = serialized;
        lastSentRef.current = serialized;
        applyRef.current(data.payload);
      })
      .on("broadcast", { event: "sync-request" }, (msg) => {
        const data = msg.payload as RoomMessage<null>;
        if (!data || data.from === clientId.current) return;
        const payload = pendingSendRef.current;
        if (payload) {
          void channel.send({
            type: "broadcast",
            event: "state",
            payload: { from: clientId.current, ts: Date.now(), payload },
          });
        }
      })
      .on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState();
        setPeerCount(Object.keys(presenceState).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          setError(null);
          await channel.track({
            clientId: clientId.current,
            joinedAt: Date.now(),
          });
          void channel.send({
            type: "broadcast",
            event: "sync-request",
            payload: { from: clientId.current, ts: Date.now(), payload: null },
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(`Realtime: ${status}`);
          setConnected(false);
        } else {
          setConnected(false);
        }
      });

    channelRef.current = channel;

    return () => {
      setConnected(false);
      setPeerCount(0);
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current);
        sendTimerRef.current = null;
      }
      try {
        void sb.removeChannel(channel);
      } catch {
        /* noop */
      }
      channelRef.current = null;
      lastSentRef.current = "";
      lastAppliedRemoteRef.current = "";
    };
  }, [roomKey]);

  useEffect(() => {
    if (!roomKey) return;
    pendingSendRef.current = state;

    const serialized = JSON.stringify(state);
    if (serialized === lastSentRef.current) return;

    const channel = channelRef.current;
    if (!channel) return;

    const doSend = () => {
      sendTimerRef.current = null;
      const ch = channelRef.current;
      const payload = pendingSendRef.current;
      if (!ch || payload == null) return;
      const ser = JSON.stringify(payload);
      if (ser === lastSentRef.current) return;
      lastSentRef.current = ser;
      lastSendAtRef.current = Date.now();
      void ch.send({
        type: "broadcast",
        event: "state",
        payload: { from: clientId.current, ts: Date.now(), payload },
      });
    };

    const now = Date.now();
    const since = now - lastSendAtRef.current;
    if (since >= throttleMs) {
      doSend();
    } else if (!sendTimerRef.current) {
      sendTimerRef.current = setTimeout(doSend, throttleMs - since);
    }
  }, [state, roomKey, throttleMs]);

  const leave = useCallback(() => {
    const ch = channelRef.current;
    if (ch) {
      try {
        void getSupabase().removeChannel(ch);
      } catch {
        /* noop */
      }
    }
    channelRef.current = null;
  }, []);

  return {
    connected,
    peerCount,
    clientId: clientId.current,
    leave,
    error,
    configured: hasSupabaseConfig(),
  };
}
