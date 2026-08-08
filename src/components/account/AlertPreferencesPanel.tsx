"use client";

import { useEffect, useRef, useState } from "react";
import { getPreferredTimeZone } from "@/components/odds/LocalTime";
import { ALERT_TYPES, type AlertType } from "@/lib/personal/alertPolicy";

/**
 * Alert consent and controls. No preferences row means no alerts, and this
 * panel says so; saving is the consent action. Email and WhatsApp appear as
 * what they are — recorded preferences without a delivery path yet — rather
 * than pretending to be live channels.
 */

const TYPE_LABEL: Record<AlertType, string> = {
  fixture_start: "Fixture start reminders",
  official_publication: "Official publications",
  watchlist_change: "Watchlist changes (never phrased as picks)",
  odds_movement: "Material odds movement",
  lineup_change: "Lineup and evidence changes",
  live_start: "Live start",
  final_result: "Final results",
  settlement: "Settlements",
  competition_update: "Competition updates"
};

export function AlertPreferencesPanel() {
  const [enabledTypes, setEnabledTypes] = useState<AlertType[]>([]);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [maxPerDay, setMaxPerDay] = useState(10);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const response = await fetch("/api/my/alert-preferences");
        if (!response.ok || !mounted.current) return;
        const body = (await response.json()) as {
          configured?: boolean;
          preferences?: {
            channels?: string[];
            enabled_types?: AlertType[];
            quiet_hours?: { start?: string; end?: string } | null;
            max_alerts_per_day?: number;
          } | null;
        };
        setConfigured(Boolean(body.configured));
        if (body.preferences) {
          setEnabledTypes(body.preferences.enabled_types ?? []);
          setPushEnabled((body.preferences.channels ?? []).includes("push"));
          setQuietStart(body.preferences.quiet_hours?.start ?? "");
          setQuietEnd(body.preferences.quiet_hours?.end ?? "");
          setMaxPerDay(body.preferences.max_alerts_per_day ?? 10);
        }
      } catch {
        // Panel stays on defaults; save reports honestly.
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    try {
      const quietHours = quietStart && quietEnd ? { start: quietStart, end: quietEnd } : null;
      const response = await fetch("/api/my/alert-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: pushEnabled ? ["push"] : [],
          enabledTypes,
          quietHours,
          timezone: getPreferredTimeZone(),
          maxAlertsPerDay: maxPerDay
        })
      });
      const body = (await response.json()) as { error?: string; note?: string };
      if (mounted.current) {
        setNote(response.ok ? body.note ?? "Alert settings saved. This is your consent record." : body.error ?? "Could not save.");
        if (response.ok) setConfigured(true);
      }
    } catch {
      if (mounted.current) setNote("Could not save alert settings right now.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="panel section" aria-labelledby="alert-preferences-heading">
      <h2 id="alert-preferences-heading">Alerts</h2>
      <p className="muted small">
        {configured === false
          ? "Alerts are off. Nothing is sent until you choose what you want and save — saving is the consent."
          : "Your alert consent record. Push is the delivery channel today; every alert names the fixture or publication it is about."}
      </p>
      <div className="followed-team-chips">
        {ALERT_TYPES.map((type) => (
          <label key={type} className="small">
            <input
              type="checkbox"
              checked={enabledTypes.includes(type)}
              onChange={(event) =>
                setEnabledTypes((current) => (event.target.checked ? [...current, type] : current.filter((entry) => entry !== type)))
              }
            />{" "}
            {TYPE_LABEL[type]}
          </label>
        ))}
      </div>
      <div className="card-actions">
        <label className="small">
          <input type="checkbox" checked={pushEnabled} onChange={(event) => setPushEnabled(event.target.checked)} /> Push
          notifications
        </label>
        <label className="small">
          Quiet from <input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} aria-label="Quiet hours start" />
        </label>
        <label className="small">
          until <input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} aria-label="Quiet hours end" />
        </label>
        <label className="small">
          Max per day{" "}
          <input
            type="number"
            min={1}
            max={50}
            value={maxPerDay}
            onChange={(event) => setMaxPerDay(Number(event.target.value) || 10)}
            aria-label="Maximum alerts per day"
          />
        </label>
        <button className="button primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save alert settings"}
        </button>
      </div>
      <p className="muted small">
        Quiet hours use your displayed timezone. Email and WhatsApp can be recorded as preferences but have no delivery
        path yet — no message pretends otherwise.
      </p>
      {note ? <p className="muted small" role="status">{note}</p> : null}
    </section>
  );
}
