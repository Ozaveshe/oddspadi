import { dayInZone, dayWindow, dayWindowRange, normalizeTimeZone } from "@/lib/time/dayWindow";

/**
 * What "this week" means on the public track record.
 *
 * Two rules shape this module, and both exist because a period control is the
 * easiest place in a performance page to tell a lie by accident.
 *
 * **Boundaries are resolved once, in the visitor's timezone, before the read.**
 * Nothing here re-derives a day boundary: every window comes out of
 * `dayWindow`/`dayWindowRange`, which already handle DST-short and DST-long
 * days and already normalise an untrusted timezone cookie. A period that picks
 * its rows with a UTC range and then formats them in Lagos is selecting the
 * wrong rows, and no amount of correct formatting afterwards fixes that.
 *
 * **A period with no publications says so.** An empty period is not a zero.
 * "0 picks, 0% hit rate" reads as a result — a month in which the model went
 * 0-for-0 — when the truth is that the ledger does not reach back that far.
 * `resolveTrackRecordPeriod` therefore returns a window, and the caller is
 * expected to report coverage against `ledgerSpan` rather than render a zero.
 *
 * Periods are measured by **publication time**, not kickoff. A track record is
 * a record of claims, and a claim belongs to the day it was made public. This
 * matters at the boundary: a pick published on Sunday for a Monday fixture is
 * Sunday's claim, and moving it to Monday would let a losing weekend be
 * reported as a fresh week.
 */

const DAY_MS = 86_400_000;

export const TRACK_RECORD_PERIOD_IDS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "previous-month",
  "year-to-date",
  "all-time",
  "custom"
] as const;

export type TrackRecordPeriodId = (typeof TRACK_RECORD_PERIOD_IDS)[number];

/**
 * All time is the default, deliberately.
 *
 * With a young ledger every relative period except the publishing day is
 * genuinely empty, and landing a first-time visitor on an empty "today" makes
 * a growing record look like a broken one. All time is also the only period
 * that cannot mislead: it is exactly what we have.
 */
export const DEFAULT_TRACK_RECORD_PERIOD: TrackRecordPeriodId = "all-time";

/** The longest custom range we will resolve. Five years of daily publishing. */
export const MAX_CUSTOM_RANGE_DAYS = 1830;

export function isTrackRecordPeriodId(value: unknown): value is TrackRecordPeriodId {
  return typeof value === "string" && (TRACK_RECORD_PERIOD_IDS as readonly string[]).includes(value);
}

export type ResolvedTrackRecordPeriod = {
  id: TrackRecordPeriodId;
  label: string;
  /** One line of plain English naming the boundary, for the page and exports. */
  description: string;
  timeZone: string;
  /** Inclusive UTC instant the period begins. Null only for all time. */
  startUtc: Date | null;
  /** Exclusive UTC instant the period ends. Null only for all time. */
  endUtc: Date | null;
  /** Inclusive local calendar days at each end. Null only for all time. */
  startDay: string | null;
  endDay: string | null;
  /** Echoed back so a rejected custom range can be shown as it was typed. */
  requestedFrom: string | null;
  requestedTo: string | null;
  /** Set when a custom range was refused and this window is the fallback. */
  invalidReason: string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a string that is both ISO-shaped and a real calendar day. */
export function isCalendarDay(value: string | null | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Shift a calendar day by whole days. Pure string arithmetic, no timezone. */
export function shiftCalendarDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday. The football week starts on Monday and so does this one. */
function mondayIndex(day: string): number {
  const sunday0 = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return (sunday0 + 6) % 7;
}

function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function firstOfYear(day: string): string {
  return `${day.slice(0, 4)}-01-01`;
}

/** Days between two calendar days, inclusive of both ends. */
export function calendarDaySpan(startDay: string, endDay: string): number {
  return Math.round((Date.parse(`${endDay}T00:00:00.000Z`) - Date.parse(`${startDay}T00:00:00.000Z`)) / DAY_MS) + 1;
}

type Bounds = { startDay: string; endDay: string; startUtc: Date; endUtc: Date };

/**
 * `count` local days ending at the visitor's today, via the shared range
 * helper so the DST handling is the same one the boards use.
 */
function relativeBounds(now: Date, zone: string, count: number, offsetDays: number): Bounds {
  const range = dayWindowRange(now, zone, count, offsetDays);
  return {
    startDay: range.days[0],
    endDay: range.days[range.days.length - 1],
    startUtc: range.startUtc,
    endUtc: range.endUtc
  };
}

/**
 * A calendar-anchored window from two local day labels.
 *
 * `dayWindowRange` takes a count, which would mean materialising up to 366 day
 * strings to describe a year. The two endpoints are the same boundary
 * computation with none of that, and they come from the same `dayWindow`.
 */
function calendarBounds(startDay: string, endDay: string, zone: string): Bounds {
  return {
    startDay,
    endDay,
    startUtc: dayWindow(startDay, zone).startUtc,
    endUtc: dayWindow(endDay, zone).endUtc
  };
}

export type PeriodRequest = {
  id?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
  timeZone?: string | null;
};

const LABELS: Record<TrackRecordPeriodId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "previous-month": "Previous month",
  "year-to-date": "Year to date",
  "all-time": "All time",
  custom: "Custom range"
};

export function trackRecordPeriodLabel(id: TrackRecordPeriodId): string {
  return LABELS[id];
}

/**
 * Resolve a requested period into a concrete UTC window.
 *
 * An unrecognised period id, or a custom range that is malformed, backwards or
 * absurdly long, falls back to all time and says why in `invalidReason`. It
 * never throws: these values arrive in a URL, and a shareable link is
 * visitor-controlled input.
 */
export function resolveTrackRecordPeriod({
  id,
  from = null,
  to = null,
  now = new Date(),
  timeZone
}: PeriodRequest = {}): ResolvedTrackRecordPeriod {
  const zone = normalizeTimeZone(timeZone);
  const today = dayInZone(now, zone);
  const requested = isTrackRecordPeriodId(id) ? id : DEFAULT_TRACK_RECORD_PERIOD;

  const allTime = (invalidReason: string | null, periodId: TrackRecordPeriodId = "all-time"): ResolvedTrackRecordPeriod => ({
    id: periodId,
    label: LABELS[periodId],
    description: "Every official publication in the ledger, from the first to the most recent.",
    timeZone: zone,
    startUtc: null,
    endUtc: null,
    startDay: null,
    endDay: null,
    requestedFrom: from,
    requestedTo: to,
    invalidReason
  });

  const build = (bounds: Bounds, description: string, invalidReason: string | null = null): ResolvedTrackRecordPeriod => ({
    id: requested,
    label: LABELS[requested],
    description,
    timeZone: zone,
    startUtc: bounds.startUtc,
    endUtc: bounds.endUtc,
    startDay: bounds.startDay,
    endDay: bounds.endDay,
    requestedFrom: from,
    requestedTo: to,
    invalidReason
  });

  if (requested === "all-time") return allTime(null);

  if (requested === "custom") {
    if (!isCalendarDay(from) || !isCalendarDay(to)) {
      return allTime("A custom range needs two calendar dates in YYYY-MM-DD form. Showing all time instead.", "custom");
    }
    if (Date.parse(`${from}T00:00:00.000Z`) > Date.parse(`${to}T00:00:00.000Z`)) {
      return allTime("The custom range ended before it started. Showing all time instead.", "custom");
    }
    const span = calendarDaySpan(from, to);
    if (span > MAX_CUSTOM_RANGE_DAYS) {
      return allTime(
        `A custom range is limited to ${MAX_CUSTOM_RANGE_DAYS} days; ${span} were requested. Showing all time instead.`,
        "custom"
      );
    }
    return build(
      calendarBounds(from, to, zone),
      `${from} to ${to} inclusive, in ${zone}, measured by publication time.`
    );
  }

  if (requested === "today") {
    return build(relativeBounds(now, zone, 1, 0), `The ${zone} day of ${today}, measured by publication time.`);
  }
  if (requested === "yesterday") {
    const day = shiftCalendarDay(today, -1);
    return build(relativeBounds(now, zone, 1, -1), `The ${zone} day of ${day}, measured by publication time.`);
  }
  if (requested === "this-week") {
    const index = mondayIndex(today);
    const bounds = relativeBounds(now, zone, index + 1, -index);
    return build(bounds, `Monday ${bounds.startDay} to today ${bounds.endDay} in ${zone}. The week is still running.`);
  }
  if (requested === "last-week") {
    const index = mondayIndex(today);
    const bounds = relativeBounds(now, zone, 7, -(index + 7));
    return build(bounds, `The complete week from Monday ${bounds.startDay} to Sunday ${bounds.endDay} in ${zone}.`);
  }
  if (requested === "this-month") {
    const bounds = calendarBounds(firstOfMonth(today), today, zone);
    return build(bounds, `${bounds.startDay} to today ${bounds.endDay} in ${zone}. The month is still running.`);
  }
  if (requested === "previous-month") {
    const lastDay = shiftCalendarDay(firstOfMonth(today), -1);
    const bounds = calendarBounds(firstOfMonth(lastDay), lastDay, zone);
    return build(bounds, `The complete month from ${bounds.startDay} to ${bounds.endDay} in ${zone}.`);
  }
  // year-to-date
  const bounds = calendarBounds(firstOfYear(today), today, zone);
  return build(bounds, `${bounds.startDay} to today ${bounds.endDay} in ${zone}. The year is still running.`);
}

/**
 * How much of the ledger a period can possibly cover.
 *
 * This is the honesty device for a young record. The tabs still offer every
 * period, because the structure has to be right for a record that grows — but
 * a period that begins before the first publication, or ends after the last,
 * is reported as partially or entirely outside the ledger rather than as a
 * result of zero.
 */
export type LedgerSpan = {
  /** ISO instant of the earliest publication, or null when there is none. */
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  /** Total publications in the ledger, ignoring every filter and period. */
  totalPublished: number | null;
  /** Whole calendar days from first to last publication, inclusive. */
  spanDays: number | null;
  availability: "measured" | "unavailable";
};

export type PeriodCoverage =
  | { kind: "unknown"; sentence: string }
  | { kind: "empty-ledger"; sentence: string }
  | { kind: "entirely-before-ledger"; sentence: string }
  | { kind: "partially-covered"; sentence: string }
  | { kind: "covered"; sentence: string };

function shortDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Describe, in one sentence, what this period can and cannot contain.
 *
 * Called even when the period *does* have rows, because "this month" holding
 * one day of publishing is a fact a reader needs in order to read the number
 * next to it correctly.
 */
export function describePeriodCoverage(period: ResolvedTrackRecordPeriod, span: LedgerSpan): PeriodCoverage {
  if (span.availability === "unavailable") {
    return {
      kind: "unknown",
      sentence: "We could not read the ledger's date range, so we cannot say how much of this period it covers. This is not a claim that it covers none of it."
    };
  }
  if (!span.firstPublishedAt || !span.lastPublishedAt || !span.totalPublished) {
    return {
      kind: "empty-ledger",
      sentence: "No official picks have been published yet, so no period contains any. This is an empty ledger, not a zero result."
    };
  }
  if (!period.startUtc || !period.endUtc) {
    return {
      kind: "covered",
      sentence: `The ledger runs from ${shortDay(span.firstPublishedAt)} to ${shortDay(span.lastPublishedAt)}${
        span.spanDays === 1 ? " — a single day of publishing" : ` — ${span.spanDays} days`
      }.`
    };
  }

  const first = Date.parse(span.firstPublishedAt);
  const last = Date.parse(span.lastPublishedAt);
  const start = period.startUtc.getTime();
  const end = period.endUtc.getTime();

  if (end <= first || start > last) {
    return {
      kind: "entirely-before-ledger",
      sentence: `No publications exist in this period. The ledger only covers ${shortDay(span.firstPublishedAt)} to ${shortDay(
        span.lastPublishedAt
      )}, so this period is outside the record rather than a period the model went without a result.`
    };
  }
  if (start < first || end > last) {
    return {
      kind: "partially-covered",
      sentence: `This period is only partly inside the ledger, which runs ${shortDay(span.firstPublishedAt)} to ${shortDay(
        span.lastPublishedAt
      )}. Days outside that range hold no publications because none were made, not because none won.`
    };
  }
  return {
    kind: "covered",
    sentence: `The ledger covers this period in full (${shortDay(span.firstPublishedAt)} to ${shortDay(span.lastPublishedAt)}).`
  };
}
