import type { RankableFixture } from "@/lib/discovery/fixtureRanking";
import { isAfricaRelevant } from "@/lib/discovery/fixtureRanking";

/**
 * Discovery filters, persisted for guests.
 *
 * Filters survive navigation because re-picking "football, live, model
 * covered" on every visit is the kind of friction that makes broad coverage
 * feel like a burden rather than a feature. Persistence is localStorage, so it
 * works without an account, matching the rest of the guest-first surfaces.
 */
export const DISCOVERY_FILTER_STORAGE_KEY = "oddspadi-discovery-filters-v1";
export const DISCOVERY_FILTER_CHANGED_EVENT = "oddspadi:discovery-filters";

export type DiscoveryFilters = {
  sports: string[];
  competitions: string[];
  regions: string[];
  /** ISO date, or null for "today". */
  date: string | null;
  status: Array<"live" | "upcoming" | "finished">;
  modelCovered: boolean;
  officialDecision: boolean;
  saved: boolean;
  followed: boolean;
  evidenceComplete: boolean;
  africaRelevant: boolean;
};

export const EMPTY_FILTERS: DiscoveryFilters = {
  sports: [],
  competitions: [],
  regions: [],
  date: null,
  status: [],
  modelCovered: false,
  officialDecision: false,
  saved: false,
  followed: false,
  evidenceComplete: false,
  africaRelevant: false
};

/** Evidence at or above this counts as complete for filtering. */
const EVIDENCE_COMPLETE_THRESHOLD = 0.7;

export function isFilterActive(filters: DiscoveryFilters): boolean {
  return (
    filters.sports.length > 0 ||
    filters.competitions.length > 0 ||
    filters.regions.length > 0 ||
    filters.date !== null ||
    filters.status.length > 0 ||
    filters.modelCovered ||
    filters.officialDecision ||
    filters.saved ||
    filters.followed ||
    filters.evidenceComplete ||
    filters.africaRelevant
  );
}

export type FilterContext = { savedFixtureIds: string[]; followedTeams: string[]; followedCompetitions: string[] };

export function applyFilters(
  fixtures: RankableFixture[],
  filters: DiscoveryFilters,
  context: FilterContext
): RankableFixture[] {
  const follows = context.followedTeams.map((team) => team.toLowerCase());
  return fixtures.filter((fixture) => {
    if (filters.sports.length && !filters.sports.includes(fixture.sport)) return false;
    if (filters.competitions.length && !(fixture.competitionSlug && filters.competitions.includes(fixture.competitionSlug))) return false;
    if (filters.regions.length && !(fixture.country && filters.regions.includes(fixture.country))) return false;
    if (filters.date && fixture.kickoffAt.slice(0, 10) !== filters.date) return false;

    if (filters.status.length) {
      const bucket =
        fixture.status === "live" ? "live" : fixture.status === "finished" ? "finished" : "upcoming";
      if (!filters.status.includes(bucket as "live" | "upcoming" | "finished")) return false;
    }

    if (filters.modelCovered && !fixture.hasModelCoverage) return false;
    if (filters.officialDecision && !fixture.hasOfficialDecision) return false;
    if (filters.saved && !context.savedFixtureIds.includes(fixture.fixtureId)) return false;
    if (filters.followed) {
      const followedTeam = follows.includes(fixture.homeTeam.toLowerCase()) || follows.includes(fixture.awayTeam.toLowerCase());
      const followedCompetition = Boolean(fixture.competitionSlug && context.followedCompetitions.includes(fixture.competitionSlug));
      if (!followedTeam && !followedCompetition) return false;
    }
    // Unknown evidence is not "complete": the filter promises verified
    // coverage, so an unmeasured fixture must not satisfy it.
    if (filters.evidenceComplete && (fixture.evidenceScore === null || fixture.evidenceScore < EVIDENCE_COMPLETE_THRESHOLD)) return false;
    if (filters.africaRelevant && !isAfricaRelevant(fixture)) return false;
    return true;
  });
}

/** Validated on read: a hand-edited or stale value must not corrupt the board. */
export function parseFilters(value: unknown): DiscoveryFilters {
  if (!value || typeof value !== "object") return { ...EMPTY_FILTERS };
  const candidate = value as Record<string, unknown>;
  const stringList = (input: unknown) =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
  const flag = (input: unknown) => input === true;
  const statuses = stringList(candidate.status).filter((entry): entry is "live" | "upcoming" | "finished" =>
    entry === "live" || entry === "upcoming" || entry === "finished"
  );
  const date = typeof candidate.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ? candidate.date : null;

  return {
    sports: stringList(candidate.sports),
    competitions: stringList(candidate.competitions),
    regions: stringList(candidate.regions),
    date,
    status: statuses,
    modelCovered: flag(candidate.modelCovered),
    officialDecision: flag(candidate.officialDecision),
    saved: flag(candidate.saved),
    followed: flag(candidate.followed),
    evidenceComplete: flag(candidate.evidenceComplete),
    africaRelevant: flag(candidate.africaRelevant)
  };
}

export function readFilters(): DiscoveryFilters {
  if (typeof window === "undefined") return { ...EMPTY_FILTERS };
  try {
    return parseFilters(JSON.parse(window.localStorage.getItem(DISCOVERY_FILTER_STORAGE_KEY) ?? "null"));
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

export function writeFilters(filters: DiscoveryFilters): boolean {
  if (typeof window === "undefined") return false;
  try {
    // A date filter is deliberately not persisted: returning tomorrow to a
    // board silently pinned to yesterday reads as broken, not as a preference.
    const { date: _date, ...persistable } = filters;
    window.localStorage.setItem(DISCOVERY_FILTER_STORAGE_KEY, JSON.stringify(persistable));
    window.dispatchEvent(new Event(DISCOVERY_FILTER_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}
