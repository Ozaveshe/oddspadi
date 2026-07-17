import type { Match } from "@/lib/sports/types";
import type { MarketPriorEvidencePolicy } from "./odds";

/**
 * Cap a football model's influence when its historical-strength sample is thin.
 * Shared by live prediction and chronological replay so the same evidence gets
 * the same no-vig market floor in both paths.
 */
export function footballMarketPriorEvidencePolicy(match: Match): MarketPriorEvidencePolicy | undefined {
  if (match.sport !== "football" || match.dataSource?.kind !== "provider" || !match.dataSource.oddsProvider) return undefined;

  const evidence = [match.homeTeam.ratingEvidence, match.awayTeam.ratingEvidence];
  const sampleSizes = evidence.map((item) =>
    typeof item?.sampleSize === "number" && Number.isFinite(item.sampleSize) ? Math.max(0, Math.trunc(item.sampleSize)) : 0
  );
  const minimumSample = Math.min(...sampleSizes);
  const sources = evidence.map((item) => item?.source ?? "missing-team-history");
  const bothHistoricalElo = sources.every((source) => source.includes("historical-elo"));

  if (bothHistoricalElo && minimumSample >= 20) return undefined;
  if (minimumSample === 0) {
    return {
      minimumWeight: 0.9,
      reason: `one or both teams have no measured historical-strength sample (${sources.join(" vs ")})`
    };
  }
  if (minimumSample < 5) {
    return {
      minimumWeight: 0.88,
      reason: `the smaller team-strength sample contains only ${minimumSample} matches, so short-window form cannot dominate a coherent market`
    };
  }
  if (minimumSample < 10) {
    return {
      minimumWeight: 0.75,
      reason: `the smaller team-strength sample contains only ${minimumSample} matches`
    };
  }
  return {
    minimumWeight: 0.6,
    reason: `team strength is not yet supported by at least 20 historical Elo matches per team (${minimumSample} minimum)`
  };
}
