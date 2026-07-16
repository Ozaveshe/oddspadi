"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveScoreBoard } from "@/lib/sports/liveScoreBoard";

/**
 * Polls /api/live while the tab is visible.
 * The endpoint is CDN-cached, so many viewers share one upstream call.
 */
export function useLiveBoard(initial: LiveScoreBoard | null, pollMs = 45_000, date?: string) {
  const [board, setBoard] = useState<LiveScoreBoard | null>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestRequestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    // Sequence requests so a slow response for an earlier day can't overwrite a
    // newer one, and abort any in-flight request when a fresh one starts.
    const requestId = ++latestRequestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => aliveRef.current && requestId === latestRequestRef.current;

    setRefreshing(true);
    let succeeded = false;
    try {
      const response = await fetch(date ? `/api/live?date=${encodeURIComponent(date)}` : "/api/live", {
        cache: "no-store",
        signal: controller.signal
      });
      if (response.ok) {
        const next = (await response.json()) as LiveScoreBoard;
        if (isCurrent()) {
          setBoard(next);
          setUpdatedAt(Date.now());
          succeeded = true;
        }
      }
    } catch {
      // Aborted or network error: keep the last good board; the next tick retries.
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
    return succeeded;
  }, [date]);

  const mountedRef = useRef(false);

  // Guard against state updates / dangling fetches after unmount.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    // Refresh on mount (when no server board) and whenever the date changes.
    if (!initial || mountedRef.current) void refresh();
    mountedRef.current = true;

    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, pollMs);
    };
    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initial, pollMs, refresh]);

  return { board, refreshing, updatedAt, refresh };
}
