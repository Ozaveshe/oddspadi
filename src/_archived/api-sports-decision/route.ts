import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getPredictions } from "@/lib/sports/service";

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const rows = await getPredictions({ date: query.date, sport: query.sport });
  const decisions = rows
    .map(({ match, prediction }) => ({
      matchId: match.id,
      match: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      league: match.league.name,
      country: match.league.country,
      kickoffTime: match.kickoffTime,
      decision: prediction.decision,
      bestPick: prediction.bestPick,
      dataQualityScore: match.dataQualityScore
    }))
    .sort((a, b) => {
      const verdictDiff = verdictRank(b.decision.verdict) - verdictRank(a.decision.verdict);
      if (verdictDiff !== 0) return verdictDiff;
      const aEv = a.bestPick.hasValue ? a.bestPick.expectedValue : -1;
      const bEv = b.bestPick.hasValue ? b.bestPick.expectedValue : -1;
      if (bEv !== aEv) return bEv - aEv;
      const aEdge = a.bestPick.hasValue ? a.bestPick.edge : -1;
      const bEdge = b.bestPick.hasValue ? b.bestPick.edge : -1;
      return bEdge - aEdge;
    });

  const summary = decisions.reduce(
    (acc, row) => {
      acc[row.decision.action] += 1;
      return acc;
    },
    { consider: 0, monitor: 0, avoid: 0 }
  );

  return apiSuccess({
    summary,
    decisions
  });
}
