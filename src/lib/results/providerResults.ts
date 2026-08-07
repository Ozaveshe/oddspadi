import { emptyResult, type CanonicalResult, type PeriodScore, type ResultStatus, type WinnerBasis } from "@/lib/results/canonicalResult";
import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";

/**
 * Turning a provider payload into a canonical result.
 *
 * All three providers already send the detail this needs and the ingest path
 * throws it away, keeping only an aggregate score. API-Football sends
 * `score.fulltime`, `score.extratime` and `score.penalty` on every fixture;
 * API-Basketball sends per-quarter and overtime lines; API-Tennis sends per-set
 * games. The extra-time score for a cup tie has been arriving in every payload
 * and being collapsed into `home_score` ever since.
 *
 * Payload shapes are read structurally rather than through the provider's own
 * types, so a provider adding a field cannot break this and a provider removing
 * one produces nulls rather than a throw. Nulls are the honest answer for a
 * score nobody reported.
 */

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pair(value: unknown): { home: number | null; away: number | null } {
  if (!value || typeof value !== "object") return { home: null, away: null };
  const record = value as { home?: unknown; away?: unknown };
  return { home: numberOrNull(record.home), away: numberOrNull(record.away) };
}

function winnerFrom(home: number | null, away: number | null): "home" | "away" | "draw" | "none" {
  if (home === null || away === null) return "none";
  return home > away ? "home" : away > home ? "away" : "draw";
}

/**
 * API-Football status codes, mapped to our classification.
 *
 * `AET` and `PEN` are finished, not a separate state — the distinction they
 * carry lives in `winner_basis`, where settlement can act on it. `WO` is a
 * walkover and `AWD` an awarded result: both produce a winner without a normal
 * match, and only the second of them settles.
 */
export function footballResultStatus(short: string | undefined): ResultStatus | null {
  switch ((short ?? "").toUpperCase()) {
    case "FT":
    case "AET":
    case "PEN":
      return "finished";
    case "AWD":
      return "awarded";
    case "WO":
      return "walkover";
    case "ABD":
      return "abandoned";
    case "CANC":
      return "cancelled";
    case "PST":
      return "postponed";
    default:
      return null;
  }
}

export function parseFootballResult(fixtureId: string, payload: unknown): CanonicalResult | null {
  if (!payload || typeof payload !== "object") return null;
  const item = payload as { fixture?: { status?: { short?: string } }; score?: Record<string, unknown>; goals?: unknown };

  const status = footballResultStatus(item.fixture?.status?.short);
  if (status === null) return null;

  const result = emptyResult(fixtureId, "football");
  result.resultStatus = status;

  const halftime = pair(item.score?.halftime);
  // `fulltime` is the score at the end of normal time. `extratime` is
  // inclusive of it, and `penalty` is the shootout alone — the convention the
  // canonical columns are documented against.
  const fulltime = pair(item.score?.fulltime);
  const extratime = pair(item.score?.extratime);
  const penalty = pair(item.score?.penalty);
  const goals = pair(item.goals);

  // A finished fixture with no `fulltime` block but a `goals` block went the
  // regulation distance; the two are the same number in that case.
  result.regulationHome = fulltime.home ?? (extratime.home === null ? goals.home : null);
  result.regulationAway = fulltime.away ?? (extratime.away === null ? goals.away : null);
  result.extraTimeHome = extratime.home;
  result.extraTimeAway = extratime.away;
  result.shootoutHome = penalty.home;
  result.shootoutAway = penalty.away;

  if (halftime.home !== null && halftime.away !== null) {
    result.periodScores.push({ period: "h1", home: halftime.home, away: halftime.away });
  }

  const { winner, basis } = footballWinner(result, status);
  result.winner = winner;
  result.winnerBasis = basis;
  return result;
}

function footballWinner(
  result: CanonicalResult,
  status: ResultStatus
): { winner: CanonicalResult["winner"]; basis: WinnerBasis | null } {
  if (status === "walkover") return { winner: "none", basis: "walkover" };
  if (status === "awarded") return { winner: "none", basis: "awarded" };
  if (status !== "finished") return { winner: "none", basis: null };

  // Order matters: a shootout decides the tie, extra time decides it if there
  // was no shootout, and normal time otherwise. Reading these the other way
  // round is how a penalty winner becomes a draw in the qualification market.
  if (result.shootoutHome !== null && result.shootoutAway !== null && result.shootoutHome !== result.shootoutAway) {
    return { winner: winnerFrom(result.shootoutHome, result.shootoutAway), basis: "shootout" };
  }
  if (result.extraTimeHome !== null && result.extraTimeAway !== null && result.extraTimeHome !== result.extraTimeAway) {
    return { winner: winnerFrom(result.extraTimeHome, result.extraTimeAway), basis: "extra_time" };
  }
  return { winner: winnerFrom(result.regulationHome, result.regulationAway), basis: "regulation" };
}

/**
 * API-Basketball sends per-quarter lines and an overtime line.
 *
 * Regulation is the total minus overtime, not the fourth-quarter line: the
 * quarters are per-period and the total is cumulative. Subtracting is the only
 * way to get "score at the end of the fourth quarter" from this payload, and it
 * is the number `basketball.moneyline.regulation` settles on.
 */
export function parseBasketballResult(fixtureId: string, payload: unknown): CanonicalResult | null {
  if (!payload || typeof payload !== "object") return null;
  const game = payload as { status?: { short?: string; long?: string } | string; scores?: { home?: unknown; away?: unknown } };

  const statusText = typeof game.status === "string" ? game.status : `${game.status?.short ?? ""} ${game.status?.long ?? ""}`;
  const normalized = statusText.toLowerCase();
  let status: ResultStatus;
  if (["cancelled", "canceled"].some((term) => normalized.includes(term))) status = "cancelled";
  else if (normalized.includes("abandoned")) status = "abandoned";
  else if (["postponed", "rescheduled"].some((term) => normalized.includes(term))) status = "postponed";
  else if (/\b(?:ft|aot)\b/.test(normalized) || ["finished", "ended", "game finished"].some((term) => normalized.includes(term)))
    status = "finished";
  else return null;

  const result = emptyResult(fixtureId, "basketball");
  result.resultStatus = status;

  const home = (game.scores?.home ?? {}) as Record<string, unknown>;
  const away = (game.scores?.away ?? {}) as Record<string, unknown>;

  const totalHome = numberOrNull(home.total);
  const totalAway = numberOrNull(away.total);
  const otHome = numberOrNull(home.over_time);
  const otAway = numberOrNull(away.over_time);

  for (const quarter of ["quarter_1", "quarter_2", "quarter_3", "quarter_4"]) {
    const h = numberOrNull(home[quarter]);
    const a = numberOrNull(away[quarter]);
    if (h !== null && a !== null) {
      result.periodScores.push({ period: quarter.replace("quarter_", "q"), home: h, away: a } satisfies PeriodScore);
    }
  }
  if (otHome !== null && otAway !== null) {
    result.periodScores.push({ period: "ot1", home: otHome, away: otAway });
  }

  // Overtime played: extra time is the total, regulation is the total less it.
  // No overtime: regulation is the total and extra time stays null, so a
  // full-game market falls back to regulation rather than reading a null.
  const overtimePlayed = otHome !== null && otAway !== null && (otHome > 0 || otAway > 0);
  if (overtimePlayed && totalHome !== null && totalAway !== null) {
    result.extraTimeHome = totalHome;
    result.extraTimeAway = totalAway;
    result.regulationHome = totalHome - (otHome ?? 0);
    result.regulationAway = totalAway - (otAway ?? 0);
  } else {
    result.regulationHome = totalHome;
    result.regulationAway = totalAway;
  }

  if (status === "finished") {
    const decisive = overtimePlayed
      ? winnerFrom(result.extraTimeHome, result.extraTimeAway)
      : winnerFrom(result.regulationHome, result.regulationAway);
    result.winner = decisive;
    result.winnerBasis = overtimePlayed ? "extra_time" : "regulation";
  }

  return result;
}

/**
 * API-Tennis sends set-by-set games in `event_game_result` and the set count in
 * `event_final_result`.
 *
 * Both are parsed: sets from the count, games from the sum across sets. Reading
 * only the final result would leave `total_games` permanently ungradeable, and
 * reading only the per-set list would break on a payload carrying just a count.
 */
export function parseTennisResult(fixtureId: string, payload: unknown): CanonicalResult | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { event_status?: string; event_final_result?: string; event_game_result?: string; event_winner?: string };

  const normalized = (event.event_status ?? "").toLowerCase();
  let status: ResultStatus;
  if (normalized.includes("retired")) status = "retired";
  else if (normalized.includes("walkover")) status = "walkover";
  else if (["cancelled", "canceled"].some((term) => normalized.includes(term))) status = "cancelled";
  else if (normalized.includes("postponed")) status = "postponed";
  else if (["finished", "complete", "ended"].some((term) => normalized.includes(term))) status = "finished";
  else return null;

  const result = emptyResult(fixtureId, "tennis");
  result.resultStatus = status;

  const setPairs = (event.event_game_result ?? "").match(/\d+\s*-\s*\d+/g) ?? [];
  let gamesHome = 0;
  let gamesAway = 0;
  let setsHome = 0;
  let setsAway = 0;
  let index = 0;
  for (const text of setPairs) {
    const [home, away] = text.split(/\s*-\s*/).map((part) => Number(part));
    if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
    index += 1;
    gamesHome += home!;
    gamesAway += away!;
    if (home! > away!) setsHome += 1;
    else if (away! > home!) setsAway += 1;
    result.periodScores.push({ period: `set${index}`, home: home!, away: away! });
  }

  if (setPairs.length > 0) {
    result.setsHome = setsHome;
    result.setsAway = setsAway;
    result.gamesHome = gamesHome;
    result.gamesAway = gamesAway;
  } else {
    // Only the aggregate arrived; that is already the set count, not a game
    // score. Treating it as one set would score "2 - 1" as 1-0.
    const final = (event.event_final_result ?? "").match(/(\d+)\s*-\s*(\d+)/);
    if (final) {
      result.setsHome = Number(final[1]);
      result.setsAway = Number(final[2]);
    }
  }

  const declared = (event.event_winner ?? "").toLowerCase();
  const winner = declared.includes("first")
    ? "home"
    : declared.includes("second")
      ? "away"
      : winnerFrom(result.setsHome, result.setsAway);

  if (status === "walkover") {
    result.winner = "none";
    result.winnerBasis = "walkover";
  } else if (status === "retired") {
    result.winner = winner;
    result.winnerBasis = "retirement";
  } else if (status === "finished") {
    result.winner = winner;
    result.winnerBasis = "regulation";
  }

  return result;
}

export function parseProviderResult(sport: CanonicalSport, fixtureId: string, payload: unknown): CanonicalResult | null {
  switch (sport) {
    case "football":
      return parseFootballResult(fixtureId, payload);
    case "basketball":
      return parseBasketballResult(fixtureId, payload);
    case "tennis":
      return parseTennisResult(fixtureId, payload);
  }
}
