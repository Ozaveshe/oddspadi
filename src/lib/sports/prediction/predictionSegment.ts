import type { Match, PredictionSegmentDimension, Sport } from "@/lib/sports/types";

function normalizedToken(value: string | null | undefined): string | null {
  const token = value?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return token || null;
}

export function predictionSegmentDimension(sport: Sport): PredictionSegmentDimension {
  return sport === "tennis" ? "surface" : "competition";
}

export function normalizedTennisSurface(value: string | null | undefined): string | null {
  const surface = normalizedToken(value);
  return surface === "hard" || surface === "clay" || surface === "grass" || surface === "indoor"
    ? surface
    : null;
}

/** Stable segment identity shared by live selection and chronological replay. */
export function predictionSegmentKey(match: Match): string | null {
  if (match.sport !== "tennis") {
    const competition = normalizedToken(match.league.id);
    return competition ? `competition:${competition}` : null;
  }
  const homeSurface = normalizedTennisSurface(match.homeTeam.ratingEvidence?.surface);
  const awaySurface = normalizedTennisSurface(match.awayTeam.ratingEvidence?.surface);
  if (!homeSurface || !awaySurface || homeSurface !== awaySurface) return null;
  return `surface:${homeSurface}`;
}
