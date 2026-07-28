"use client";

import { useEffect, useState } from "react";

type Variant = "time" | "seconds" | "datetime" | "date" | "daymonth" | "weekday";

const FORMATS: Record<Variant, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  seconds: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { day: "numeric", month: "short", year: "numeric" },
  daymonth: { day: "numeric", month: "short" },
  weekday: { weekday: "short", day: "numeric", month: "short" }
};

const TIME_ONLY: ReadonlySet<Variant> = new Set<Variant>(["time", "seconds"]);

function format(date: Date, variant: Variant, timeZone?: string): string {
  const options = timeZone ? { ...FORMATS[variant], timeZone } : FORMATS[variant];
  // The deterministic pass pins the locale too: Node defaults to en-US on some
  // deploys while the browser uses the visitor's, so locale alone could differ
  // across hydration even with the zone fixed. The post-mount pass then
  // re-formats with the visitor's real locale and zone.
  const locale = timeZone ? "en-GB" : [];
  return TIME_ONLY.has(variant)
    ? date.toLocaleTimeString(locale, options)
    : date.toLocaleString(locale, options);
}

function useLocalLabel(iso: string | null | undefined, variant: Variant, fallback: string) {
  const parsed = iso ? new Date(iso) : null;
  const valid = parsed !== null && !Number.isNaN(parsed.getTime());
  const [label, setLabel] = useState(() => (valid ? format(parsed, variant, "UTC") : fallback));

  useEffect(() => {
    if (!iso) return;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) setLabel(format(date, variant));
  }, [iso, variant]);

  return { label, valid };
}

/**
 * Renders a timestamp in the visitor's own timezone.
 *
 * Server components format dates in the host timezone (UTC on most deploys),
 * which shows every kickoff an hour+ off for the app's West-Africa audience.
 * Client components that server-render hit the same problem *and* a hydration
 * mismatch, because the server and the browser disagree about the zone.
 *
 * To fix both without a mismatch, the server and first client render emit a
 * deterministic UTC label; a post-mount effect then re-formats in the browser's
 * local timezone. `fallback` covers a missing or unparseable input.
 */
export function LocalTime({
  iso,
  variant = "time",
  fallback = "TBD"
}: {
  iso: string | null | undefined;
  variant?: Variant;
  fallback?: string;
}) {
  const { label, valid } = useLocalLabel(iso, variant, fallback);
  if (!valid) return <span>{fallback}</span>;
  return (
    <time dateTime={iso ?? undefined} suppressHydrationWarning>
      {label}
    </time>
  );
}

/**
 * Same deterministic-then-local contract as {@link LocalTime}, for callers that
 * cannot nest a `<time>` element — text already inside a `<time>`, or a label
 * spliced into a surrounding sentence.
 */
export function LocalTimeText({
  iso,
  variant = "time",
  fallback = "TBD"
}: {
  iso: string | null | undefined;
  variant?: Variant;
  fallback?: string;
}) {
  const { label } = useLocalLabel(iso, variant, fallback);
  return <span suppressHydrationWarning>{label}</span>;
}
