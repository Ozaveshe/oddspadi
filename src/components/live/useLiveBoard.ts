"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveScoreBoard } from "@/lib/sports/liveScoreBoard";

/**
 * Polls /api/live while the tab is visible.
 * The endpoint is CDN-cached, so many viewers share one upstream call.
 */
export function useLiveBoard(initial: LiveScoreBoard | null, pollMs = 45_000) {
  const [board, setBoard] = useState<LiveScoreBoard | null>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      if (response.ok) {
        const next = (await response.json()) as LiveScoreBoard;
        setBoard(next);
        setUpdatedAt(Date.now());
      }
    } catch {
      // Keep showing the last good board; the next tick retries.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initial) void refresh();

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
