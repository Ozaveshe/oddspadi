import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";

/**
 * The canonical result of a fixture.
 *
 * `op_fixtures` stores only `home_score` and `away_score`, and it is upserted
 * on every results refresh. Two things follow. First, a cup tie decided on
 * penalties has no recoverable normal-time score, so football 1X2 has been
 * settling against a post-shootout result — a wrong verdict, silently. Second,
 * verification state and correction history cannot live in a row that ingest
 * overwrites, which is why this is a separate store rather than more columns.
 *
 * The score basis is declared rather than inferred, because a reader who has to
 * work out whether `extraTime` includes regulation will eventually work it out
 * wrong:
 *
 *   regulation  — the score at the end of normal time
 *   extraTime   — the score at the end of extra time, INCLUSIVE of regulation
 *                 (API-Football's `score.extratime` convention)
 *   shootout    — penalties alone, exclusive of everything before them
 */

export type ResultStatus =
  | "finished"
  | "postponed"
  | "cancelled"
  | "abandoned"
  | "retired"
  | "walkover"
  | "awarded";

export type WinnerSide = "home" | "away" | "draw" | "none";

export type WinnerBasis =
  | "regulation"
  | "extra_time"
  | "shootout"
  | "retirement"
  | "walkover"
  | "awarded";

/**
 * How much we trust the result, which is a different question from what the
 * provider's status string says.
 *
 * Settlement reads only `verified`. That is the whole enforcement of "do not
 * settle on a provisional score" — a query filter rather than a rule anyone
 * has to remember at each call site.
 */
export type VerificationState = "provisional" | "verified" | "conflicted" | "manual_review";

export type PeriodScore = {
  /** `q1`..`q4`, `ot1`, `set1`..`set5`, `h1`, `h2`. */
  period: string;
  home: number;
  away: number;
};

export type CanonicalResult = {
  /**
   * The stored row's id, where this result came from storage. Absent on a
   * result freshly parsed from a payload, which has not been written yet — so
   * a settlement produced from one links to nothing, honestly, rather than to
   * a guess.
   */
  resultId?: string | null;
  fixtureId: string;
  sport: CanonicalSport;
  resultStatus: ResultStatus;

  regulationHome: number | null;
  regulationAway: number | null;
  extraTimeHome: number | null;
  extraTimeAway: number | null;
  shootoutHome: number | null;
  shootoutAway: number | null;

  setsHome: number | null;
  setsAway: number | null;
  gamesHome: number | null;
  gamesAway: number | null;

  periodScores: PeriodScore[];

  winner: WinnerSide;
  winnerBasis: WinnerBasis | null;

  finalAt: string | null;
  verificationState: VerificationState;

  revision: number;
};

/** The score a `full_game_including_ot` market reads: extra time if it was played. */
export function fullGameScore(result: CanonicalResult): { home: number; away: number } | null {
  const home = result.extraTimeHome ?? result.regulationHome;
  const away = result.extraTimeAway ?? result.regulationAway;
  if (home === null || away === null) return null;
  return { home, away };
}

/** The score a `regulation` market reads. Never falls back to the full-time score. */
export function regulationScore(result: CanonicalResult): { home: number; away: number } | null {
  if (result.regulationHome === null || result.regulationAway === null) return null;
  return { home: result.regulationHome, away: result.regulationAway };
}

export function setScore(result: CanonicalResult): { home: number; away: number } | null {
  if (result.setsHome === null || result.setsAway === null) return null;
  return { home: result.setsHome, away: result.setsAway };
}

export function gameScore(result: CanonicalResult): { home: number; away: number } | null {
  if (result.gamesHome === null || result.gamesAway === null) return null;
  return { home: result.gamesHome, away: result.gamesAway };
}

/**
 * A result shell with every optional field absent.
 *
 * Exported for tests and for provider adapters, which build a result by filling
 * in what their payload actually carried. Starting from a full shell rather
 * than an object literal means a new field added here shows up as `null`
 * everywhere instead of as a type error in fifteen adapters — and `null` is the
 * honest default for a score nobody reported.
 */
export function emptyResult(fixtureId: string, sport: CanonicalSport): CanonicalResult {
  return {
    resultId: null,
    fixtureId,
    sport,
    resultStatus: "finished",
    regulationHome: null,
    regulationAway: null,
    extraTimeHome: null,
    extraTimeAway: null,
    shootoutHome: null,
    shootoutAway: null,
    setsHome: null,
    setsAway: null,
    gamesHome: null,
    gamesAway: null,
    periodScores: [],
    winner: "none",
    winnerBasis: null,
    finalAt: null,
    verificationState: "provisional",
    revision: 1
  };
}
