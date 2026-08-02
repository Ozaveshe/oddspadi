/**
 * Guest-first fixture shelves: saved fixtures and recently viewed.
 *
 * The product must be personal without demanding an account — the same rule
 * the bet slip already follows (`betSlip.ts`). Both shelves live in
 * localStorage, key on the canonical fixture id (`op_fixtures` external id, the
 * `/predictions/[matchId]` param), and emit one change event so the nav chip
 * and the My Padi page stay in sync without a refetch.
 */
export const SAVED_FIXTURES_STORAGE_KEY = "oddspadi-saved-fixtures-v1";
export const RECENT_FIXTURES_STORAGE_KEY = "oddspadi-recent-fixtures-v1";
export const FIXTURE_SHELF_CHANGED_EVENT = "oddspadi:fixture-shelf-changed";
export const SAVED_FIXTURES_MAX = 50;
export const RECENT_FIXTURES_MAX = 12;

export type ShelfFixture = {
  /** Canonical fixture id — the `/predictions/[matchId]` route param. */
  matchId: string;
  matchLabel: string;
  league: string;
  sport: string;
  kickoffTime: string;
  /** Epoch ms of the last interaction, for ordering. */
  touchedAt: number;
};

function isShelfFixture(value: unknown): value is ShelfFixture {
  if (!value || typeof value !== "object") return false;
  const fixture = value as Partial<ShelfFixture>;
  return typeof fixture.matchId === "string"
    && fixture.matchId.length > 0
    && typeof fixture.matchLabel === "string"
    && typeof fixture.league === "string"
    && typeof fixture.sport === "string"
    && typeof fixture.kickoffTime === "string"
    && typeof fixture.touchedAt === "number"
    && Number.isFinite(fixture.touchedAt);
}

function read(key: string, max: number): ShelfFixture[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter(isShelfFixture).slice(0, max) : [];
  } catch {
    return [];
  }
}

function write(key: string, fixtures: ShelfFixture[], max: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(fixtures.filter(isShelfFixture).slice(0, max)));
    window.dispatchEvent(new Event(FIXTURE_SHELF_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function readSavedFixtures(): ShelfFixture[] {
  return read(SAVED_FIXTURES_STORAGE_KEY, SAVED_FIXTURES_MAX);
}

export function isFixtureSaved(matchId: string): boolean {
  return readSavedFixtures().some((fixture) => fixture.matchId === matchId);
}

/** Returns the new saved state for the fixture (true = now saved). */
export function toggleSavedFixture(fixture: Omit<ShelfFixture, "touchedAt">): boolean {
  const saved = readSavedFixtures();
  const without = saved.filter((entry) => entry.matchId !== fixture.matchId);
  if (without.length < saved.length) {
    write(SAVED_FIXTURES_STORAGE_KEY, without, SAVED_FIXTURES_MAX);
    return false;
  }
  write(SAVED_FIXTURES_STORAGE_KEY, [{ ...fixture, touchedAt: Date.now() }, ...saved], SAVED_FIXTURES_MAX);
  return true;
}

export function readRecentFixtures(): ShelfFixture[] {
  return read(RECENT_FIXTURES_STORAGE_KEY, RECENT_FIXTURES_MAX);
}

export function recordRecentFixture(fixture: Omit<ShelfFixture, "touchedAt">): void {
  const recents = readRecentFixtures().filter((entry) => entry.matchId !== fixture.matchId);
  write(RECENT_FIXTURES_STORAGE_KEY, [{ ...fixture, touchedAt: Date.now() }, ...recents], RECENT_FIXTURES_MAX);
}
