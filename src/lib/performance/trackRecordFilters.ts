import type { OfficialPublicationDetail } from "@/lib/domain/canonicalReads";
import { ODDS_BANDS, oddsBandFor } from "@/lib/performance/ledgerMetrics";
import {
  DEFAULT_TRACK_RECORD_PERIOD,
  isTrackRecordPeriodId,
  type TrackRecordPeriodId
} from "@/lib/performance/trackRecordPeriods";

/**
 * The filter vocabulary of the public track record.
 *
 * Three properties are load-bearing here, and all three are the kind that get
 * lost when filtering is written inline in a page component.
 *
 * **A filtered view is a URL.** Every dimension round-trips through the query
 * string, so a filtered record can be linked, cited in an article, and
 * reproduced by a reader months later. A filter that lives in component state
 * cannot be checked by anyone.
 *
 * **One predicate, three consumers.** The summary, the table and the export
 * all call `matchesTrackRecordFilters`. When the headline and the CSV are
 * filtered by two different code paths they eventually disagree, and the
 * export is the copy that gets forwarded.
 *
 * **Deriving a band is not the same as storing one.** Odds bands, probability
 * bands and lead-time bands are computed from ledger columns rather than
 * stored, so the definitions live here and are exported into the docs and the
 * export header. A band with no published definition is a number someone will
 * misquote.
 */

export const TRACK_RECORD_FILTER_KEYS = [
  "sport",
  "competition",
  "marketFamily",
  "selectionType",
  "modelVersion",
  "calibrationVersion",
  "decisionTier",
  "oddsBand",
  "probabilityBand",
  "readinessBand",
  "leadTimeBand",
  "result"
] as const;

export type TrackRecordFilterKey = (typeof TRACK_RECORD_FILTER_KEYS)[number];

/** `all` is the absent value, spelled out so a URL is readable. */
export const ANY = "all";

export type TrackRecordFilters = Record<TrackRecordFilterKey, string>;

/** Query-string names. Kept short and stable — these end up in shared links. */
export const FILTER_PARAM: Record<TrackRecordFilterKey, string> = {
  sport: "sport",
  competition: "competition",
  marketFamily: "market",
  selectionType: "selection",
  modelVersion: "model",
  calibrationVersion: "calibration",
  decisionTier: "tier",
  oddsBand: "odds",
  probabilityBand: "probability",
  readinessBand: "readiness",
  leadTimeBand: "lead",
  result: "result"
};

export const FILTER_LABEL: Record<TrackRecordFilterKey, string> = {
  sport: "Sport",
  competition: "Competition",
  marketFamily: "Market family",
  selectionType: "Selection type",
  modelVersion: "Model version",
  calibrationVersion: "Calibration version",
  decisionTier: "Decision tier",
  oddsBand: "Odds band",
  probabilityBand: "Probability band",
  readinessBand: "Data readiness",
  leadTimeBand: "Publication lead time",
  result: "Result state"
};

export const PERIOD_PARAM = "period";
export const FROM_PARAM = "from";
export const TO_PARAM = "to";
export const CURSOR_PARAM = "after";
export const PAGE_SIZE_PARAM = "rows";

export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function emptyTrackRecordFilters(): TrackRecordFilters {
  return Object.fromEntries(TRACK_RECORD_FILTER_KEYS.map((key) => [key, ANY])) as TrackRecordFilters;
}

/* -------------------------------------------------------------------------
 * Derived bands
 * ---------------------------------------------------------------------- */

export type BandDefinition = { id: string; label: string; definition: string };

/**
 * Market families.
 *
 * The ledger stores a market key per selection (`match_winner`,
 * `over_under_2_5`, …). Grouping them is a presentation decision, so the
 * grouping is written down rather than being re-guessed by each surface. The
 * match is on substrings because the key carries its line: `over_under_2_5`
 * and `over_under_3_5` are the same family at different lines.
 */
export const MARKET_FAMILIES: Array<BandDefinition & { match: (market: string) => boolean }> = [
  {
    id: "match-result",
    label: "Match result",
    definition: "Which side wins, including the draw where the sport has one (1X2, moneyline, match winner).",
    match: (market) => /match_winner|match_result|moneyline|1x2|winner/.test(market)
  },
  {
    id: "double-chance",
    label: "Double chance",
    definition: "Two of the three match-result outcomes taken together.",
    match: (market) => market.includes("double_chance")
  },
  {
    id: "totals",
    label: "Totals",
    definition: "Combined score over or under a line (over/under, totals, goals lines).",
    match: (market) => /over_under|totals?|goal_line|points_total/.test(market)
  },
  {
    id: "both-teams-to-score",
    label: "Both teams to score",
    definition: "Whether both sides score at least once.",
    match: (market) => /btts|both_teams/.test(market)
  },
  {
    id: "handicap",
    label: "Handicap",
    definition: "A side with a goal, point or game start applied (handicap, spread, Asian handicap).",
    match: (market) => /handicap|spread|line/.test(market)
  }
];

export const OTHER_FAMILY: BandDefinition = {
  id: "other",
  label: "Other markets",
  definition: "Every market that does not fall into one of the named families above."
};

export function marketFamilyOf(market: string): BandDefinition {
  const key = market.toLowerCase();
  return MARKET_FAMILIES.find((family) => family.match(key)) ?? OTHER_FAMILY;
}

export const SELECTION_TYPES: Array<BandDefinition & { match: (selection: string) => boolean }> = [
  { id: "home", label: "Home", definition: "The home side, or the first-named player.", match: (s) => s === "home" || s === "1" },
  { id: "away", label: "Away", definition: "The away side, or the second-named player.", match: (s) => s === "away" || s === "2" },
  { id: "draw", label: "Draw", definition: "The match ends level.", match: (s) => s === "draw" || s === "x" },
  { id: "over", label: "Over", definition: "The total finishes above the line.", match: (s) => s.startsWith("over") },
  { id: "under", label: "Under", definition: "The total finishes below the line.", match: (s) => s.startsWith("under") },
  { id: "yes", label: "Yes", definition: "The named event happens.", match: (s) => s === "yes" },
  { id: "no", label: "No", definition: "The named event does not happen.", match: (s) => s === "no" }
];

export const OTHER_SELECTION: BandDefinition = {
  id: "other",
  label: "Other",
  definition: "Any selection that is not one of the standard sides, totals or yes/no outcomes."
};

export function selectionTypeOf(selection: string): BandDefinition {
  const key = selection.toLowerCase();
  return SELECTION_TYPES.find((type) => type.match(key)) ?? OTHER_SELECTION;
}

export const PROBABILITY_BANDS: Array<BandDefinition & { min: number; max: number }> = [
  { id: "under-40", label: "Under 40%", definition: "Model probability below 0.40.", min: 0, max: 0.4 },
  { id: "40-49", label: "40–49%", definition: "Model probability from 0.40 up to but not including 0.50.", min: 0.4, max: 0.5 },
  { id: "50-59", label: "50–59%", definition: "Model probability from 0.50 up to but not including 0.60.", min: 0.5, max: 0.6 },
  { id: "60-69", label: "60–69%", definition: "Model probability from 0.60 up to but not including 0.70.", min: 0.6, max: 0.7 },
  { id: "70-plus", label: "70% and above", definition: "Model probability of 0.70 or higher.", min: 0.7, max: Number.POSITIVE_INFINITY }
];

export function probabilityBandOf(probability: number): BandDefinition {
  return PROBABILITY_BANDS.find((band) => probability < band.max) ?? PROBABILITY_BANDS[PROBABILITY_BANDS.length - 1];
}

const HOUR_MS = 3_600_000;

/**
 * Publication lead time: how long before kickoff the claim was made.
 *
 * Worth filtering on because it is one of the few dimensions where a
 * plausible-sounding edge can be an artefact — a pick made twenty minutes
 * before kickoff has seen team news that a pick made two days out has not, and
 * the two should not be pooled without being able to separate them again.
 */
export const LEAD_TIME_BANDS: Array<BandDefinition & { minHours: number; maxHours: number }> = [
  { id: "under-2h", label: "Under 2 hours", definition: "Published less than two hours before kickoff.", minHours: 0, maxHours: 2 },
  { id: "2-6h", label: "2–6 hours", definition: "Published two to six hours before kickoff.", minHours: 2, maxHours: 6 },
  { id: "6-24h", label: "6–24 hours", definition: "Published six to twenty-four hours before kickoff.", minHours: 6, maxHours: 24 },
  { id: "over-24h", label: "Over 24 hours", definition: "Published more than a day before kickoff.", minHours: 24, maxHours: Number.POSITIVE_INFINITY }
];

/** Null when either timestamp is unusable — an unknown lead time is not zero. */
export function leadTimeHours(publication: Pick<OfficialPublicationDetail, "publishedAt" | "kickoffAt">): number | null {
  const published = Date.parse(publication.publishedAt);
  const kickoff = Date.parse(publication.kickoffAt);
  if (!Number.isFinite(published) || !Number.isFinite(kickoff)) return null;
  return (kickoff - published) / HOUR_MS;
}

export function leadTimeBandOf(hours: number): BandDefinition {
  return LEAD_TIME_BANDS.find((band) => hours < band.maxHours) ?? LEAD_TIME_BANDS[LEAD_TIME_BANDS.length - 1];
}

export const READINESS_BANDS: BandDefinition[] = [
  { id: "complete", label: "Complete", definition: "Every evidence input the decision policy asks for was present." },
  { id: "partial", label: "Partial", definition: "Some evidence was missing; the decision was made on what was there." },
  { id: "stale", label: "Stale", definition: "The evidence or price behind the claim had aged past its freshness bar." },
  { id: "unavailable", label: "Unavailable", definition: "Evidence could not be read at decision time." },
  { id: "confirmed_empty", label: "Confirmed empty", definition: "The evidence source was readable and genuinely held nothing." }
];

export const DECISION_TIERS: BandDefinition[] = [
  { id: "pick", label: "Pick", definition: "Cleared every gate; published as a selection." },
  { id: "lean", label: "Lean", definition: "The model favoured a side below the publication bar." },
  { id: "watch", label: "Watch", definition: "Tracked interest that had not cleared publication." },
  { id: "pass", label: "Pass", definition: "Analysed and declined." },
  { id: "withheld", label: "Withheld", definition: "A decision existed but the evidence bar was not met." },
  { id: "unavailable", label: "Unavailable", definition: "No decision could be formed from the available data." }
];

/**
 * Result states.
 *
 * `pending` groups the two states in which no verdict exists yet; it is not a
 * result. `settled` is the union of every terminal state, which is why it is
 * offered separately from `won`/`lost` — asking "show me everything that has
 * finished" is a different question from "show me the wins".
 */
export const RESULT_STATES: BandDefinition[] = [
  { id: "won", label: "Won", definition: "The selection was correct at the published price." },
  { id: "lost", label: "Lost", definition: "The selection was incorrect. One unit staked, one unit lost." },
  { id: "push", label: "Push", definition: "The market returned the stake. Excluded from the hit-rate denominator." },
  { id: "void", label: "Void", definition: "The market never resolved. Excluded from the hit-rate denominator." },
  { id: "cancelled", label: "Cancelled", definition: "The fixture was called off. Excluded from the hit-rate denominator." },
  { id: "pending", label: "Pending", definition: "No verdict yet — either unsettled or awaiting verification." },
  { id: "settled", label: "Any settled", definition: "Every claim that has reached a terminal state, whatever the verdict." }
];

/* -------------------------------------------------------------------------
 * Parsing and encoding
 * ---------------------------------------------------------------------- */

export type SearchParamRecord = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length ? first : null;
}

/**
 * Free-text dimensions (sport, competition, model version) are taken as given
 * but bounded and stripped of control characters, because they are echoed back
 * into a chip and into the export header.
 */
/** Drop C0 controls and DEL. Written by code point so the source stays legible. */
function stripControlCharacters(value: string): string {
  let cleaned = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) cleaned += character;
  }
  return cleaned;
}

function sanitiseValue(value: string | null): string {
  if (!value) return ANY;
  const cleaned = stripControlCharacters(value).trim();
  if (!cleaned || cleaned.toLowerCase() === ANY) return ANY;
  return cleaned.slice(0, 120);
}

const ENUM_VALUES: Partial<Record<TrackRecordFilterKey, readonly string[]>> = {
  marketFamily: [...MARKET_FAMILIES.map((family) => family.id), OTHER_FAMILY.id],
  selectionType: [...SELECTION_TYPES.map((type) => type.id), OTHER_SELECTION.id],
  oddsBand: ODDS_BANDS.map((band) => band.id),
  probabilityBand: PROBABILITY_BANDS.map((band) => band.id),
  readinessBand: READINESS_BANDS.map((band) => band.id),
  decisionTier: DECISION_TIERS.map((tier) => tier.id),
  leadTimeBand: LEAD_TIME_BANDS.map((band) => band.id),
  result: RESULT_STATES.map((state) => state.id)
};

export function parseTrackRecordFilters(params: SearchParamRecord): TrackRecordFilters {
  const filters = emptyTrackRecordFilters();
  for (const key of TRACK_RECORD_FILTER_KEYS) {
    const raw = sanitiseValue(single(params[FILTER_PARAM[key]]));
    if (raw === ANY) continue;
    const allowed = ENUM_VALUES[key];
    // An unknown value for a closed dimension is dropped rather than applied.
    // Silently returning zero rows for a typo reads as "the model has no wins
    // in that band", which is a claim we did not make.
    filters[key] = allowed && !allowed.includes(raw) ? ANY : raw;
  }
  return filters;
}

export function parsePeriodRequest(params: SearchParamRecord): {
  id: TrackRecordPeriodId;
  from: string | null;
  to: string | null;
} {
  const raw = single(params[PERIOD_PARAM]);
  return {
    id: isTrackRecordPeriodId(raw) ? raw : DEFAULT_TRACK_RECORD_PERIOD,
    from: sanitiseValue(single(params[FROM_PARAM])) === ANY ? null : sanitiseValue(single(params[FROM_PARAM])),
    to: sanitiseValue(single(params[TO_PARAM])) === ANY ? null : sanitiseValue(single(params[TO_PARAM]))
  };
}

export function parsePageSize(params: SearchParamRecord): number {
  const raw = Number(single(params[PAGE_SIZE_PARAM]));
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : DEFAULT_PAGE_SIZE;
}

export type TrackRecordQueryState = {
  period: TrackRecordPeriodId;
  from?: string | null;
  to?: string | null;
  filters: TrackRecordFilters;
  pageSize?: number;
  cursor?: string | null;
};

/**
 * Build the query string for a view.
 *
 * Defaults are omitted so a plain link stays plain, and keys are emitted in a
 * fixed order so two identical views produce byte-identical URLs — which is
 * what makes a filtered link comparable and a CDN cache key stable.
 */
export function encodeTrackRecordQuery(state: TrackRecordQueryState): string {
  const search = new URLSearchParams();
  if (state.period !== DEFAULT_TRACK_RECORD_PERIOD) search.set(PERIOD_PARAM, state.period);
  if (state.period === "custom") {
    if (state.from) search.set(FROM_PARAM, state.from);
    if (state.to) search.set(TO_PARAM, state.to);
  }
  for (const key of TRACK_RECORD_FILTER_KEYS) {
    const value = state.filters[key];
    if (value && value !== ANY) search.set(FILTER_PARAM[key], value);
  }
  if (state.pageSize && state.pageSize !== DEFAULT_PAGE_SIZE) search.set(PAGE_SIZE_PARAM, String(state.pageSize));
  if (state.cursor) search.set(CURSOR_PARAM, state.cursor);
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export function trackRecordHref(state: TrackRecordQueryState, basePath = "/track-record"): string {
  return `${basePath}${encodeTrackRecordQuery(state)}`;
}

/* -------------------------------------------------------------------------
 * Applying
 * ---------------------------------------------------------------------- */

function matchesResult(publication: OfficialPublicationDetail, value: string): boolean {
  const status = publication.settlementStatus;
  if (value === "pending") return status === "unsettled" || status === "pending_verification";
  if (value === "settled") return status !== "unsettled" && status !== "pending_verification";
  return status === value;
}

/** True when a publication belongs in a filtered view. Pure; used everywhere. */
export function matchesTrackRecordFilters(publication: OfficialPublicationDetail, filters: TrackRecordFilters): boolean {
  for (const key of TRACK_RECORD_FILTER_KEYS) {
    const value = filters[key];
    if (!value || value === ANY) continue;

    switch (key) {
      case "sport":
        if (publication.sport !== value) return false;
        break;
      case "competition":
        if (publication.competition !== value) return false;
        break;
      case "marketFamily":
        if (marketFamilyOf(publication.market).id !== value) return false;
        break;
      case "selectionType":
        if (selectionTypeOf(publication.selection).id !== value) return false;
        break;
      case "modelVersion":
        if (publication.modelVersion !== value) return false;
        break;
      case "calibrationVersion":
        if (publication.calibrationVersion !== value) return false;
        break;
      case "decisionTier":
        if (publication.decisionStatus !== value) return false;
        break;
      case "oddsBand":
        if (oddsBandFor(publication.oddsAtPublication).id !== value) return false;
        break;
      case "probabilityBand":
        if (probabilityBandOf(publication.modelProbability).id !== value) return false;
        break;
      case "readinessBand":
        if (publication.dataQuality !== value) return false;
        break;
      case "leadTimeBand": {
        const hours = leadTimeHours(publication);
        // An unknown lead time cannot satisfy a lead-time filter, and must not
        // be quietly swept into the first band.
        if (hours === null || leadTimeBandOf(hours).id !== value) return false;
        break;
      }
      case "result":
        if (!matchesResult(publication, value)) return false;
        break;
    }
  }
  return true;
}

export function applyTrackRecordFilters(
  publications: OfficialPublicationDetail[],
  filters: TrackRecordFilters
): OfficialPublicationDetail[] {
  return publications.filter((publication) => matchesTrackRecordFilters(publication, filters));
}

/* -------------------------------------------------------------------------
 * Describing
 * ---------------------------------------------------------------------- */

export type FilterOption = { value: string; label: string };

export type TrackRecordFilterOptions = Record<TrackRecordFilterKey, FilterOption[]>;

const staticOptions = (definitions: BandDefinition[]): FilterOption[] =>
  definitions.map((definition) => ({ value: definition.id, label: definition.label }));

/**
 * The option lists a control should offer.
 *
 * Open dimensions (sport, competition, model version, calibration version) are
 * built from the rows actually present in the period rather than from a fixed
 * list, so a control never offers a competition the ledger has never covered —
 * an option that always returns nothing is indistinguishable from a bug.
 */
export function buildFilterOptions(publications: OfficialPublicationDetail[]): TrackRecordFilterOptions {
  const distinct = (pick: (row: OfficialPublicationDetail) => string | null): FilterOption[] =>
    [...new Set(publications.map(pick).filter((value): value is string => Boolean(value)))]
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({ value, label: value }));

  return {
    sport: distinct((row) => row.sport),
    competition: distinct((row) => row.competition),
    marketFamily: staticOptions([...MARKET_FAMILIES, OTHER_FAMILY]),
    selectionType: staticOptions([...SELECTION_TYPES, OTHER_SELECTION]),
    modelVersion: distinct((row) => row.modelVersion),
    calibrationVersion: distinct((row) => row.calibrationVersion),
    decisionTier: staticOptions(DECISION_TIERS),
    oddsBand: ODDS_BANDS.map((band) => ({ value: band.id, label: band.label })),
    probabilityBand: staticOptions(PROBABILITY_BANDS),
    readinessBand: staticOptions(READINESS_BANDS),
    leadTimeBand: staticOptions(LEAD_TIME_BANDS),
    result: staticOptions(RESULT_STATES)
  };
}

export type ActiveFilter = { key: TrackRecordFilterKey; label: string; value: string; valueLabel: string };

export function activeTrackRecordFilters(
  filters: TrackRecordFilters,
  options: TrackRecordFilterOptions
): ActiveFilter[] {
  return TRACK_RECORD_FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({
    key,
    label: FILTER_LABEL[key],
    value: filters[key],
    valueLabel: options[key].find((option) => option.value === filters[key])?.label ?? filters[key]
  }));
}

/** One line naming every active filter, for an export header and a page caption. */
export function describeTrackRecordFilters(active: ActiveFilter[]): string {
  if (!active.length) return "No filters applied; every official publication in the period is included.";
  return active.map((entry) => `${entry.label}: ${entry.valueLabel}`).join("; ");
}

/**
 * Every band definition, flattened.
 *
 * Exported so the documentation, the page legend and the export footer all
 * quote the same words. A definition that exists in three places drifts in two
 * of them.
 */
export function trackRecordBandDefinitions(): Array<{ dimension: string; band: string; definition: string }> {
  const rows: Array<{ dimension: string; band: string; definition: string }> = [];
  const push = (dimension: string, definitions: BandDefinition[]) => {
    for (const definition of definitions) rows.push({ dimension, band: definition.label, definition: definition.definition });
  };
  push(FILTER_LABEL.marketFamily, [...MARKET_FAMILIES, OTHER_FAMILY]);
  push(FILTER_LABEL.selectionType, [...SELECTION_TYPES, OTHER_SELECTION]);
  push(
    FILTER_LABEL.oddsBand,
    ODDS_BANDS.map((band) => ({
      id: band.id,
      label: band.label,
      definition: `Odds at publication ${band.min === 0 ? "below" : `from ${band.min.toFixed(2)} up to but not including`} ${
        Number.isFinite(band.max) ? band.max.toFixed(2) : "any higher price"
      }.`
    }))
  );
  push(FILTER_LABEL.probabilityBand, PROBABILITY_BANDS);
  push(FILTER_LABEL.decisionTier, DECISION_TIERS);
  push(FILTER_LABEL.readinessBand, READINESS_BANDS);
  push(FILTER_LABEL.leadTimeBand, LEAD_TIME_BANDS);
  push(FILTER_LABEL.result, RESULT_STATES);
  return rows;
}
