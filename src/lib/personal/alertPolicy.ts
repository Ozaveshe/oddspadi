/**
 * Alert policy: the one gate every personal alert passes before delivery.
 *
 * Three rules carry this file:
 *
 * 1. **Alerts are canonical or they are nothing.** An `AlertEvent` must name
 *    a canonical entity (fixture external id, publication id, competition
 *    key) and the timestamp of the thing that happened. A worker that cannot
 *    fill those fields has no event to announce.
 *
 * 2. **A watchlist candidate is not a pick.** `watchlist_change` events have
 *    their own type and their own copy builder, and the copy builder for
 *    picks refuses watchlist input. The failure this prevents is a push
 *    notification reading "New pick: …" for a candidate the engine
 *    deliberately did not publish.
 *
 * 3. **No preferences row, no alerts.** Consent is an action. Every check
 *    here defaults closed: unknown type → refuse, sport switched off →
 *    refuse, inside quiet hours → hold, over the daily cap → refuse.
 */

export type AlertType =
  | "fixture_start"
  | "official_publication"
  | "watchlist_change"
  | "odds_movement"
  | "lineup_change"
  | "live_start"
  | "final_result"
  | "settlement"
  | "competition_update";

export const ALERT_TYPES: readonly AlertType[] = [
  "fixture_start",
  "official_publication",
  "watchlist_change",
  "odds_movement",
  "lineup_change",
  "live_start",
  "final_result",
  "settlement",
  "competition_update"
];

export type AlertChannel = "push" | "email" | "whatsapp";

/**
 * Channels the product can actually deliver on today. Email has no sending
 * infrastructure and WhatsApp has no approved integration; both stay in the
 * vocabulary so preferences can record consent, and both are refused at
 * delivery with the reason stated. Claiming them before they exist would be
 * a lie with a settings toggle.
 */
export const DELIVERABLE_CHANNELS: readonly AlertChannel[] = ["push"];

export type AlertEvent = {
  type: AlertType;
  /** Canonical fixture external id, when the event concerns a fixture. */
  fixtureExternalId: string | null;
  /** Canonical publication id for publication/settlement events. */
  publicationId: string | null;
  competition: string | null;
  sport: string;
  /** When the underlying thing happened — never "now". */
  occurredAt: string;
};

export type AlertPreferences = {
  channels: AlertChannel[];
  enabledTypes: AlertType[];
  quietHours: { start: string; end: string } | null;
  timezone: string;
  sportSettings: Record<string, boolean>;
  competitionSettings: Record<string, boolean>;
  maxAlertsPerDay: number;
};

export type AlertVerdict =
  | { deliver: true; channels: AlertChannel[] }
  | { deliver: false; reason: string };

function minutesInZone(iso: string, timezone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = formatter.formatToParts(new Date(iso));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** True when `atIso`, seen in the user's timezone, falls inside quiet hours. */
export function isQuietTime(
  quietHours: { start: string; end: string } | null,
  timezone: string,
  atIso: string
): boolean {
  if (!quietHours) return false;
  const start = parseClock(quietHours.start);
  const end = parseClock(quietHours.end);
  const now = minutesInZone(atIso, timezone);
  if (start === null || end === null || now === null) {
    // A malformed window fails toward silence: wrongly holding an alert is
    // recoverable, wrongly waking someone at 3am is not.
    return true;
  }
  if (start === end) return false;
  // Overnight windows (22:00 → 07:00) wrap midnight.
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function decideAlert(
  event: AlertEvent,
  preferences: AlertPreferences | null,
  context: { now: string; deliveredToday: number }
): AlertVerdict {
  if (!preferences) return { deliver: false, reason: "No alert preferences on record; consent has not been given." };
  if (!ALERT_TYPES.includes(event.type)) return { deliver: false, reason: `Unknown alert type "${event.type}".` };
  if (!preferences.enabledTypes.includes(event.type)) {
    return { deliver: false, reason: `The user has not enabled ${event.type} alerts.` };
  }

  // Canonical grounding: a fixture-shaped event without a fixture id, or a
  // publication-shaped one without a publication id, is not deliverable.
  const fixtureShaped: AlertType[] = ["fixture_start", "live_start", "final_result", "odds_movement", "lineup_change", "watchlist_change"];
  if (fixtureShaped.includes(event.type) && !event.fixtureExternalId) {
    return { deliver: false, reason: `A ${event.type} alert must reference a canonical fixture.` };
  }
  if ((event.type === "official_publication" || event.type === "settlement") && !event.publicationId) {
    return { deliver: false, reason: `A ${event.type} alert must reference a canonical publication.` };
  }
  if (!event.occurredAt || Number.isNaN(Date.parse(event.occurredAt))) {
    return { deliver: false, reason: "An alert must carry the timestamp of the thing it announces." };
  }

  if (preferences.sportSettings[event.sport] === false) {
    return { deliver: false, reason: `Alerts for ${event.sport} are switched off.` };
  }
  if (event.competition && preferences.competitionSettings[event.competition.toLowerCase()] === false) {
    return { deliver: false, reason: `Alerts for ${event.competition} are switched off.` };
  }

  if (context.deliveredToday >= preferences.maxAlertsPerDay) {
    return { deliver: false, reason: `Daily alert cap (${preferences.maxAlertsPerDay}) reached.` };
  }

  if (isQuietTime(preferences.quietHours, preferences.timezone, context.now)) {
    return { deliver: false, reason: "Inside the user's quiet hours." };
  }

  const channels = preferences.channels.filter((channel) => DELIVERABLE_CHANNELS.includes(channel));
  if (!channels.length) {
    return {
      deliver: false,
      reason:
        "No deliverable channel: push needs an active subscription, and email/WhatsApp delivery does not exist yet."
    };
  }
  return { deliver: true, channels };
}

/**
 * Copy builders. Separate on purpose: the pick builder throws on watchlist
 * input rather than producing softened pick copy, because the boundary is
 * the point.
 */
export function officialPublicationCopy(event: AlertEvent, selectionLabel: string, fixtureLabel: string): {
  title: string;
  body: string;
} {
  if (event.type !== "official_publication") {
    throw new Error(`officialPublicationCopy only formats official_publication events, got ${event.type}.`);
  }
  return {
    title: "OddsPadi published a pick",
    body: `${selectionLabel} — ${fixtureLabel}. Published ${event.occurredAt}.`
  };
}

export function watchlistChangeCopy(event: AlertEvent, fixtureLabel: string, direction: "promoted" | "removed"): {
  title: string;
  body: string;
} {
  if (event.type !== "watchlist_change") {
    throw new Error(`watchlistChangeCopy only formats watchlist_change events, got ${event.type}.`);
  }
  // Deliberately not pick language: a watchlist candidate is something the
  // engine is watching, not something it recommends.
  return {
    title: direction === "promoted" ? "Added to the watchlist" : "Left the watchlist",
    body: `${fixtureLabel} ${direction === "promoted" ? "is now being watched by the engine — not a pick" : "is no longer on the watchlist"}.`
  };
}
