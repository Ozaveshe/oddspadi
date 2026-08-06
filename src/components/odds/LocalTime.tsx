"use client";

import { useEffect, useState } from "react";

type Variant = "time" | "seconds" | "datetime" | "date" | "daymonth" | "weekday" | "kickoff";

const FORMATS: Record<Variant, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  seconds: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { day: "numeric", month: "short", year: "numeric" },
  daymonth: { day: "numeric", month: "short" },
  weekday: { weekday: "short", day: "numeric", month: "short" },
  // Resolved dynamically in format(): time only when the fixture is today in
  // the viewer's zone, date + time otherwise. Fixtures several days out were
  // showing a bare clock time, which is unreadable on a weekly board.
  kickoff: { hour: "2-digit", minute: "2-digit" }
};

/**
 * Timezone preference.
 *
 * OddsPadi's first audience is Nigerian, so the default is Africa/Lagos rather
 * than whatever the host or browser happens to be set to. Visitors can change
 * it (TimezonePicker); the choice persists in localStorage and every mounted
 * LocalTime re-renders on the change event.
 */
export const TIMEZONE_STORAGE_KEY = "oddspadi-timezone";
export const TIMEZONE_CHANGE_EVENT = "oddspadi:timezone";
export const DEFAULT_TIMEZONE = "Africa/Lagos";

export function getPreferredTimeZone(): string {
  if (typeof window === "undefined") return DEFAULT_TIMEZONE;
  try {
    return window.localStorage.getItem(TIMEZONE_STORAGE_KEY) || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function setPreferredTimeZone(zone: string): void {
  try {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, zone);
  } catch {
    // Storage can be unavailable (private mode); the event still updates the page.
  }
  publishTimeZoneToServer(zone);
  window.dispatchEvent(new CustomEvent(TIMEZONE_CHANGE_EVENT, { detail: zone }));
}

/**
 * Mirror the preference into a cookie so the server can read it.
 *
 * localStorage is invisible to a server render, so until this existed the
 * picker only re-formatted times that had already been *selected* for the UTC
 * day. Choosing the right rows has to happen before the query, which means the
 * zone has to travel with the request. See `src/lib/time/timezoneCookie.ts`,
 * which owns the read and the attribute string.
 *
 * Attributes are duplicated here rather than imported because that module
 * pulls in `next/headers`, which cannot be bundled into a client component.
 * `timezone-cookie-contract.test.ts` asserts the two stay identical.
 */
export function publishTimeZoneToServer(zone: string): void {
  if (typeof document === "undefined") return;
  const attributes = [
    `oddspadi-tz=${encodeURIComponent(zone)}`,
    "path=/",
    `max-age=${60 * 60 * 24 * 365}`,
    "samesite=lax"
  ];
  if (window.location.protocol === "https:") attributes.push("secure");
  document.cookie = attributes.join("; ");
}

const TIME_ONLY: ReadonlySet<Variant> = new Set<Variant>(["time", "seconds"]);

function format(date: Date, variant: Variant, timeZone?: string): string {
  const zone = timeZone ?? getPreferredTimeZone();
  // The deterministic pass pins the locale too: Node defaults to en-US on some
  // deploys while the browser uses the visitor's, so locale alone could differ
  // across hydration even with the zone fixed. The post-mount pass then
  // re-formats with the visitor's real locale and the preferred zone.
  const locale = timeZone ? "en-GB" : [];
  if (variant === "kickoff") {
    const dayInZone = (value: Date) => value.toLocaleDateString("en-GB", { timeZone: zone });
    const time = date.toLocaleTimeString(locale, { ...FORMATS.kickoff, timeZone: zone });
    if (dayInZone(date) === dayInZone(new Date())) return time;
    const day = date.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: zone });
    return `${day}, ${time}`;
  }
  const options = { ...FORMATS[variant], timeZone: zone };
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
    const render = () => {
      const date = new Date(iso);
      if (!Number.isNaN(date.getTime())) setLabel(format(date, variant));
    };
    render();
    window.addEventListener(TIMEZONE_CHANGE_EVENT, render);
    return () => window.removeEventListener(TIMEZONE_CHANGE_EVENT, render);
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
