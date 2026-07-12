"use client";

import { useEffect, useState } from "react";

type Variant = "time" | "datetime";

const FORMATS: Record<Variant, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  datetime: { dateStyle: "medium", timeStyle: "short" }
};

function format(date: Date, variant: Variant, timeZone?: string): string {
  const options = timeZone ? { ...FORMATS[variant], timeZone } : FORMATS[variant];
  return variant === "time" ? date.toLocaleTimeString([], options) : date.toLocaleString([], options);
}

/**
 * Renders a fixture time in the visitor's own timezone.
 *
 * Server components format dates in the host timezone (UTC on most deploys),
 * which shows every kickoff an hour+ off for the app's West-Africa audience.
 * To fix that without a hydration mismatch, the server and first client render
 * both emit a deterministic UTC label; a post-mount effect then re-formats in
 * the browser's local timezone.
 */
export function LocalTime({ iso, variant = "time" }: { iso: string; variant?: Variant }) {
  const date = new Date(iso);
  const valid = !Number.isNaN(date.getTime());
  const [label, setLabel] = useState(() => (valid ? format(date, variant, "UTC") : "TBD"));

  useEffect(() => {
    if (valid) setLabel(format(date, variant));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, variant]);

  if (!valid) return <span>TBD</span>;
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {label}
    </time>
  );
}
