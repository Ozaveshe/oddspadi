"use client";

import { useEffect, useState } from "react";

const MINUTE = 60_000;
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * "12m ago" style label for a timestamp, relative to `now`.
 *
 * Callers on the server pass the post's own timestamp as `now` so the first
 * paint is deterministic ("just now"); the hydrated component then re-measures
 * against the real clock and keeps ticking. Without that split the server and
 * the browser compute different minute counts and hydration desyncs.
 */
export function relativeLabel(iso: string, now: number): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const mins = Math.floor((now - timestamp) / MINUTE);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return DAY_FORMAT.format(new Date(timestamp));
}

/** Ticks once a minute so an open feed does not freeze at its render-time label. */
export function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => new Date(iso).getTime());

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {relativeLabel(iso, now)}
    </time>
  );
}
