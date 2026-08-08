import type { OddsFormat } from "@/lib/workspace/selection";

/**
 * Guest-local personal preferences: follows beyond teams, odds format, and
 * the vocabulary the account layer syncs.
 *
 * Everything here lives on the visitor's device, in the same convention as
 * every other guest store (`oddspadi-<thing>-v1` key, paired change event,
 * type guard on read AND write, hard caps, `window` guards). The product is
 * fully usable in this mode; the interface states the trade-off rather than
 * nagging: on this device only, gone if browser storage is cleared.
 *
 * Team follows are special: signed-in users have `op_followed_teams` (uuid
 * rows against the team catalogue). Guests store team NAMES here, and
 * migration resolves names against the catalogue on sign-in — see
 * `/api/my/migrate` and docs/guest-account-migration.md.
 */

export const PERSONAL_PREFERENCES_KEY = "oddspadi-personal-preferences-v1";
export const PERSONAL_PREFERENCES_EVENT = "oddspadi:personal-preferences";

export const MAX_FOLLOWS_PER_KIND = 50;

/** What a guest can follow locally. Mirrors op_follows.entity_type. */
export type FollowKind = "sport" | "competition" | "team" | "player";

export type PersonalPreferences = {
  followedSports: string[];
  followedCompetitions: string[];
  /** Team names for guests; the account layer holds catalogue uuids. */
  followedTeams: string[];
  followedPlayers: string[];
  oddsFormat: OddsFormat;
};

export const DEFAULT_PREFERENCES: PersonalPreferences = {
  followedSports: [],
  followedCompetitions: [],
  followedTeams: [],
  followedPlayers: [],
  oddsFormat: "decimal"
};

/** One sentence, used verbatim wherever guest persistence needs explaining. */
export const GUEST_PERSISTENCE_COPY =
  "Saved on this device only. Your follows, workspaces and preferences stay in this browser — they are not backed up and do not follow you across devices. A free account adds private sync, nothing else changes.";

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length <= 120);
}

function isPreferences(value: unknown): value is PersonalPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersonalPreferences>;
  return (
    isStringList(candidate.followedSports) &&
    isStringList(candidate.followedCompetitions) &&
    isStringList(candidate.followedTeams) &&
    isStringList(candidate.followedPlayers) &&
    (candidate.oddsFormat === "decimal" || candidate.oddsFormat === "fractional" || candidate.oddsFormat === "american")
  );
}

function capped(preferences: PersonalPreferences): PersonalPreferences {
  return {
    followedSports: preferences.followedSports.slice(0, MAX_FOLLOWS_PER_KIND),
    followedCompetitions: preferences.followedCompetitions.slice(0, MAX_FOLLOWS_PER_KIND),
    followedTeams: preferences.followedTeams.slice(0, MAX_FOLLOWS_PER_KIND),
    followedPlayers: preferences.followedPlayers.slice(0, MAX_FOLLOWS_PER_KIND),
    oddsFormat: preferences.oddsFormat
  };
}

export function readPersonalPreferences(): PersonalPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PERSONAL_PREFERENCES_KEY) ?? "null");
    return isPreferences(value) ? capped(value) : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writePersonalPreferences(preferences: PersonalPreferences): boolean {
  if (typeof window === "undefined") return false;
  if (!isPreferences(preferences)) return false;
  try {
    window.localStorage.setItem(PERSONAL_PREFERENCES_KEY, JSON.stringify(capped(preferences)));
    window.dispatchEvent(new Event(PERSONAL_PREFERENCES_EVENT));
    return true;
  } catch {
    return false;
  }
}

const KIND_FIELD: Record<FollowKind, keyof Pick<
  PersonalPreferences,
  "followedSports" | "followedCompetitions" | "followedTeams" | "followedPlayers"
>> = {
  sport: "followedSports",
  competition: "followedCompetitions",
  team: "followedTeams",
  player: "followedPlayers"
};

/** Case-insensitive identity so "Premier League" and "premier league" merge. */
export function normalizeFollowKey(value: string): string {
  return value.trim().toLowerCase();
}

export function toggleFollow(preferences: PersonalPreferences, kind: FollowKind, value: string): PersonalPreferences {
  const trimmed = value.trim();
  if (!trimmed) return preferences;
  const field = KIND_FIELD[kind];
  const existing = preferences[field];
  const already = existing.some((entry) => normalizeFollowKey(entry) === normalizeFollowKey(trimmed));
  return {
    ...preferences,
    [field]: already
      ? existing.filter((entry) => normalizeFollowKey(entry) !== normalizeFollowKey(trimmed))
      : [...existing, trimmed].slice(0, MAX_FOLLOWS_PER_KIND)
  };
}

export function isFollowing(preferences: PersonalPreferences, kind: FollowKind, value: string): boolean {
  return preferences[KIND_FIELD[kind]].some((entry) => normalizeFollowKey(entry) === normalizeFollowKey(value));
}

/**
 * Merge guest preferences into account state without duplicates — the
 * pure half of guest-to-account migration. Later wins nothing here: merge
 * is a set union on normalised keys, keeping the first spelling seen.
 */
export function mergeFollowLists(account: string[], guest: string[]): string[] {
  const seen = new Set(account.map(normalizeFollowKey));
  const merged = [...account];
  for (const entry of guest) {
    const key = normalizeFollowKey(entry);
    if (!entry.trim() || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry.trim());
  }
  return merged.slice(0, MAX_FOLLOWS_PER_KIND);
}
