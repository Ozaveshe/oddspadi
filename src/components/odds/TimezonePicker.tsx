"use client";

import { useEffect, useState } from "react";
import { DEFAULT_TIMEZONE, getPreferredTimeZone, publishTimeZoneToServer, setPreferredTimeZone } from "@/components/odds/LocalTime";

/**
 * Site-wide timezone preference.
 *
 * Kickoffs default to West Africa Time because that is OddsPadi's first
 * audience, but nothing about a football fixture cares where the viewer sits —
 * so the viewer chooses, once, and every timestamp on the site follows.
 */
const ZONES: Array<{ id: string; label: string }> = [
  { id: "Africa/Lagos", label: "Lagos (WAT)" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Central Europe" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "UTC", label: "UTC" }
];

export function TimezonePicker() {
  const [zone, setZone] = useState(DEFAULT_TIMEZONE);
  const [browserZone, setBrowserZone] = useState<string | null>(null);

  useEffect(() => {
    const preferred = getPreferredTimeZone();
    setZone(preferred);
    // Visitors who chose a zone before the cookie existed have it only in
    // localStorage, which the server cannot see — so their first render after
    // this ships would still be built for the UTC day. Mirroring on mount
    // backfills them silently; the picker is in the layout, so it happens once
    // per session on every page.
    publishTimeZoneToServer(preferred);
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected && !ZONES.some((entry) => entry.id === detected)) setBrowserZone(detected);
    } catch {
      // Detection is a convenience, not a requirement.
    }
  }, []);

  return (
    <label className="timezone-picker">
      <span className="sr-only">Timezone for kickoff times</span>
      <select
        aria-label="Timezone for kickoff times"
        value={zone}
        onChange={(event) => {
          setZone(event.target.value);
          setPreferredTimeZone(event.target.value);
        }}
      >
        {ZONES.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
        {browserZone ? <option value={browserZone}>{browserZone.replaceAll("_", " ")}</option> : null}
      </select>
    </label>
  );
}
