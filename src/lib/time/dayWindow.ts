/**
 * What "a day" means, in one place.
 *
 * Every board, projection and date filter used to agree on a definition of
 * today by accident: `utcDateWindow` built its range from `Date.UTC`, so today
 * was the UTC day for everyone. That is only correct for visitors sitting on
 * the prime meridian. Measured on 2026-08-06 the difference was not academic —
 * 472 fixtures fell in the UTC day, 563 in Sydney's, 412 in Los Angeles'. A
 * Sydney visitor at 09:00 was shown a board built for a day that, where they
 * were standing, had already ended.
 *
 * The fix is not an offset added at render time. An offset applied to a
 * formatted string still selects the wrong *rows*: the query has already
 * chosen a UTC range by then. The day boundary has to be resolved before the
 * read, which means the timezone has to reach the server — see
 * `readTimezonePreference` in `./timezoneCookie`.
 *
 * Everything here is pure and takes `now` explicitly, so temporal tests can
 * pin an instant instead of hoping the suite does not run at midnight.
 */

/** Nigerian audience first; see LocalTime.tsx, which owns the client half. */
export const DEFAULT_TIMEZONE = "Africa/Lagos";

const DAY_MS = 86_400_000;

export type DayWindow = {
  /** Calendar day this window represents, as seen in `timeZone`. */
  day: string;
  timeZone: string;
  /** Inclusive UTC instant the local day begins. */
  startUtc: Date;
  /** Exclusive UTC instant the local day ends. */
  endUtc: Date;
};

/**
 * True when the runtime recognises the zone.
 *
 * A timezone arrives from a cookie, which is visitor-controlled input. An
 * unrecognised value must degrade to the default rather than throw inside a
 * server render — a mistyped cookie should not be able to blank the board.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
}

/**
 * Milliseconds `timeZone` is ahead of UTC at a given instant.
 *
 * Derived by formatting the instant in the zone and reading the wall clock
 * back, which is the only approach that stays correct across DST without
 * shipping a timezone database. Node and every browser we target carry the
 * data already.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);

  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = Number(part.value);
  }
  // `hour12: false` yields hour 24 for midnight in some ICU versions.
  const wallClock = Date.UTC(field.year, field.month - 1, field.day, field.hour % 24, field.minute, field.second);
  return wallClock - instant.getTime();
}

/**
 * The UTC instant at which `day` starts in `timeZone`.
 *
 * Two passes, because the first guess uses the offset in force at the *wrong*
 * instant. On a spring-forward morning the offset before and after midnight
 * differ, and a single pass lands an hour out — which on a matchday means an
 * hour of fixtures on the wrong board.
 */
function startOfDayUtc(day: string, timeZone: string): Date {
  const asUtc = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(asUtc.getTime())) throw new RangeError(`Not a calendar day: ${day}`);

  const firstGuess = new Date(asUtc.getTime() - zoneOffsetMs(asUtc, timeZone));
  const corrected = new Date(asUtc.getTime() - zoneOffsetMs(firstGuess, timeZone));
  return corrected;
}

/** The calendar day `instant` falls on, as seen in `timeZone`. */
export function dayInZone(instant: Date, timeZone: string): string {
  const zone = normalizeTimeZone(timeZone);
  // en-CA renders ISO-shaped dates, which avoids re-assembling parts by hand.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(instant);
}

/**
 * The UTC range covering one calendar day in a timezone.
 *
 * `endUtc` is derived from the *next* day's start rather than by adding 24
 * hours, so DST-shortened and DST-lengthened days come out at 23 and 25 hours
 * respectively instead of silently dropping or double-counting an hour of
 * fixtures.
 */
export function dayWindow(day: string, timeZone: string): DayWindow {
  const zone = normalizeTimeZone(timeZone);
  const startUtc = startOfDayUtc(day, zone);
  const nextDay = new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS;
  const endUtc = startOfDayUtc(new Date(nextDay).toISOString().slice(0, 10), zone);
  return { day, timeZone: zone, startUtc, endUtc };
}

/** The window for the visitor's current day. */
export function todayWindow(now: Date, timeZone: string): DayWindow {
  const zone = normalizeTimeZone(timeZone);
  return dayWindow(dayInZone(now, zone), zone);
}

/**
 * `count` consecutive local days starting `offsetDays` from the visitor's
 * today, as one continuous UTC range plus the day labels inside it.
 *
 * This is the timezone-aware replacement for `utcDateWindow`, which returned
 * bare `YYYY-MM-DD` strings and left every caller to decide what they meant.
 * Returning the instants alongside the labels is what stops a caller from
 * re-deriving the boundary and getting a different answer.
 */
export function dayWindowRange(
  now: Date,
  timeZone: string,
  count: number,
  offsetDays = 0
): { timeZone: string; days: string[]; startUtc: Date; endUtc: Date } {
  const zone = normalizeTimeZone(timeZone);
  const total = Math.max(0, count);
  const anchor = dayInZone(now, zone);
  const anchorMidnightUtc = new Date(`${anchor}T00:00:00.000Z`).getTime();

  const days = Array.from({ length: total }, (_, index) =>
    new Date(anchorMidnightUtc + (index + offsetDays) * DAY_MS).toISOString().slice(0, 10)
  );

  if (!days.length) {
    const empty = todayWindow(now, zone);
    return { timeZone: zone, days, startUtc: empty.startUtc, endUtc: empty.startUtc };
  }
  return {
    timeZone: zone,
    days,
    startUtc: dayWindow(days[0], zone).startUtc,
    endUtc: dayWindow(days[days.length - 1], zone).endUtc
  };
}
