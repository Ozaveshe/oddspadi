import { apiError, apiSuccess, parsePredictionFilters } from "@/app/api/sports/_utils";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { getPredictions, todayIsoDate } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

type ModelCardSport = Extract<Sport, "football" | "basketball" | "tennis">;

const MODEL_CARD_SPORTS: ModelCardSport[] = ["football", "basketball", "tennis"];

function parseDate(value: string | null): string | { error: string } {
  const date = value ?? todayIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date. Use YYYY-MM-DD." };
  return date;
}

function parseSports(value: string | null): ModelCardSport[] | { error: string } {
  if (!value || value === "all") return MODEL_CARD_SPORTS;
  if (MODEL_CARD_SPORTS.includes(value as ModelCardSport)) return [value as ModelCardSport];
  return { error: "Invalid sport for model cards. Use football, basketball, tennis, or all." };
}

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

async function buildInput({
  date,
  sport,
  limit,
  filters
}: {
  date: string;
  sport: ModelCardSport;
  limit: number;
  filters: ReturnType<typeof parsePredictionFilters>;
}) {
  const scopedFilters = {
    league: sport === "football" ? filters.league : undefined,
    country: sport === "football" ? filters.country : undefined,
    query: sport === "football" ? filters.query : undefined,
    confidence: sport === "football" ? filters.confidence : undefined
  };
  const [rows, training] = await Promise.all([getPredictions({ date, sport, ...scopedFilters }), getTrainingDataSnapshot(sport)]);
  const rankedRows = rows.slice().sort((a, b) => {
    const verdictDiff = verdictRank(b.prediction.decision.verdict) - verdictRank(a.prediction.decision.verdict);
    if (verdictDiff !== 0) return verdictDiff;
    const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
    const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
    if (bEv !== aEv) return bEv - aEv;
    return b.match.dataQualityScore - a.match.dataQualityScore;
  });
  const matrix = buildDecisionFeatureMatrix({ rows: rankedRows, date, sport, limit });
  const governance = buildDecisionModelGovernance({ matrix, training, date, sport });

  return {
    sport,
    matrix,
    governance,
    training,
    predictions: rankedRows.map((row) => row.prediction)
  };
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 8;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = parseDate(url.searchParams.get("date"));
  if (typeof date !== "string") return apiError(date.error);
  const sports = parseSports(url.searchParams.get("sport"));
  if ("error" in sports) return apiError(sports.error);
  const filters = parsePredictionFilters(request);

  const inputs = await Promise.all(sports.map((sport) => buildInput({ date, sport, limit: parseLimit(url.searchParams.get("limit")), filters })));
  return apiSuccess(buildDecisionModelCards({ date, inputs }));
}
