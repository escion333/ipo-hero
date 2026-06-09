import { useEffect, useRef, useState } from "react";

/**
 * Live SPCX (SpaceX) mid price from Hyperliquid's `xyz` HIP-3 DEX.
 *
 * Subscribes to the `allMids` channel over the public Hyperliquid websocket and
 * tracks the mid for `xyz:SPCX`. Reconnects with backoff on disconnect. This is a
 * raw market quote, not a valuation or recommendation — display it as data only.
 */

const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
const DEX = "xyz";
const COIN = "xyz:SPCX";

/** ms with no message before we consider the feed stale. */
const STALE_AFTER_MS = 20_000;

export type PriceStatus = "connecting" | "live" | "stale" | "error";
export type PriceDirection = "up" | "down" | "flat";

export type SpacexPrice = {
  /** Latest mid price in USD, or null before the first tick. */
  price: number | null;
  /** Tick-over-tick move, for coloring. */
  direction: PriceDirection;
  status: PriceStatus;
};

export function useSpacexPrice(): SpacexPrice {
  const [price, setPrice] = useState<number | null>(null);
  const [direction, setDirection] = useState<PriceDirection>("flat");
  const [status, setStatus] = useState<PriceStatus>("connecting");

  // Refs survive re-renders without re-triggering the effect.
  const lastPriceRef = useRef<number | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;
    let attempts = 0;

    const markStaleSoon = () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      staleTimerRef.current = setTimeout(() => setStatus("stale"), STALE_AFTER_MS);
    };

    const connect = () => {
      setStatus((s) => (s === "live" ? s : "connecting"));
      try {
        socket = new WebSocket(HL_WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        attempts = 0;
        socket?.send(
          JSON.stringify({
            method: "subscribe",
            subscription: { type: "allMids", dex: DEX },
          }),
        );
      };

      socket.onmessage = (event) => {
        let msg: unknown;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (!isAllMids(msg)) return;

        const raw = msg.data.mids[COIN];
        if (raw == null) return;
        const next = Number(raw);
        if (!Number.isFinite(next)) return;

        const prev = lastPriceRef.current;
        lastPriceRef.current = next;
        setPrice(next);
        setDirection(prev == null || next === prev ? "flat" : next > prev ? "up" : "down");
        setStatus("live");
        markStaleSoon();
      };

      socket.onerror = () => {
        setStatus((s) => (s === "live" ? s : "error"));
      };

      socket.onclose = () => {
        if (!closedByUs) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUs) return;
      attempts += 1;
      const delay = Math.min(1000 * 2 ** (attempts - 1), 15_000);
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return { price, direction, status };
}

type AllMidsMessage = { channel: "allMids"; data: { mids: Record<string, string> } };

function isAllMids(msg: unknown): msg is AllMidsMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { channel?: unknown }).channel === "allMids" &&
    typeof (msg as { data?: unknown }).data === "object" &&
    (msg as { data: { mids?: unknown } }).data !== null &&
    typeof (msg as { data: { mids?: unknown } }).data.mids === "object"
  );
}
