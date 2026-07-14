export type FootballLeagueTier = "global" | "continental" | "top-five" | "africa-primary" | "regional";

export type FootballLeague = {
  id: number;
  leagueId: string;
  slug: string;
  name: string;
  leagueName: string;
  country: string;
  tier: FootballLeagueTier;
  enrichmentPriority: number;
  homeAdvantageFactor: number;
  predictions: boolean;
};

export const footballLeagueRegistry: readonly FootballLeague[] = [
  { id: 1, leagueId: "1", slug: "world-cup", name: "FIFA World Cup", leagueName: "FIFA World Cup", country: "World", tier: "global", enrichmentPriority: 0, homeAdvantageFactor: 1, predictions: false },
  { id: 6, leagueId: "6", slug: "afcon", name: "Africa Cup of Nations", leagueName: "Africa Cup of Nations", country: "Africa", tier: "continental", enrichmentPriority: 1, homeAdvantageFactor: 1.04, predictions: false },
  { id: 2, leagueId: "2", slug: "champions-league", name: "UEFA Champions League", leagueName: "UEFA Champions League", country: "Europe", tier: "continental", enrichmentPriority: 2, homeAdvantageFactor: 1.09, predictions: false },
  { id: 12, leagueId: "12", slug: "caf-champions-league", name: "CAF Champions League", leagueName: "CAF Champions League", country: "Africa", tier: "continental", enrichmentPriority: 3, homeAdvantageFactor: 1.12, predictions: false },
  { id: 39, leagueId: "39", slug: "premier-league", name: "Premier League", leagueName: "Premier League", country: "England", tier: "top-five", enrichmentPriority: 4, homeAdvantageFactor: 1.08, predictions: true },
  { id: 140, leagueId: "140", slug: "la-liga", name: "La Liga", leagueName: "La Liga", country: "Spain", tier: "top-five", enrichmentPriority: 5, homeAdvantageFactor: 1.1, predictions: true },
  { id: 135, leagueId: "135", slug: "serie-a", name: "Serie A", leagueName: "Serie A", country: "Italy", tier: "top-five", enrichmentPriority: 6, homeAdvantageFactor: 1.09, predictions: true },
  { id: 78, leagueId: "78", slug: "bundesliga", name: "Bundesliga", leagueName: "Bundesliga", country: "Germany", tier: "top-five", enrichmentPriority: 7, homeAdvantageFactor: 1.07, predictions: true },
  { id: 61, leagueId: "61", slug: "ligue-1", name: "Ligue 1", leagueName: "Ligue 1", country: "France", tier: "top-five", enrichmentPriority: 8, homeAdvantageFactor: 1.09, predictions: true },
  { id: 3, leagueId: "3", slug: "europa-league", name: "UEFA Europa League", leagueName: "UEFA Europa League", country: "Europe", tier: "continental", enrichmentPriority: 9, homeAdvantageFactor: 1.09, predictions: false },
  { id: 848, leagueId: "848", slug: "conference-league", name: "UEFA Conference League", leagueName: "UEFA Conference League", country: "Europe", tier: "continental", enrichmentPriority: 10, homeAdvantageFactor: 1.09, predictions: false },
  { id: 20, leagueId: "20", slug: "caf-confederation-cup", name: "CAF Confederation Cup", leagueName: "CAF Confederation Cup", country: "Africa", tier: "continental", enrichmentPriority: 11, homeAdvantageFactor: 1.12, predictions: false },
  { id: 399, leagueId: "399", slug: "npfl", name: "Nigeria Premier Football League", leagueName: "Nigeria Premier Football League", country: "Nigeria", tier: "africa-primary", enrichmentPriority: 12, homeAdvantageFactor: 1.16, predictions: true },
  { id: 288, leagueId: "288", slug: "psl", name: "South African Premier Division", leagueName: "South African Premier Division", country: "South Africa", tier: "africa-primary", enrichmentPriority: 13, homeAdvantageFactor: 1.12, predictions: true },
  { id: 233, leagueId: "233", slug: "egyptian-premier-league", name: "Egyptian Premier League", leagueName: "Egyptian Premier League", country: "Egypt", tier: "africa-primary", enrichmentPriority: 14, homeAdvantageFactor: 1.14, predictions: true },
  { id: 200, leagueId: "200", slug: "botola-pro", name: "Botola Pro", leagueName: "Botola Pro", country: "Morocco", tier: "regional", enrichmentPriority: 15, homeAdvantageFactor: 1.14, predictions: false },
  { id: 570, leagueId: "570", slug: "ghana-premier-league", name: "Ghana Premier League", leagueName: "Ghana Premier League", country: "Ghana", tier: "regional", enrichmentPriority: 16, homeAdvantageFactor: 1.15, predictions: false },
  { id: 276, leagueId: "276", slug: "fkf-premier-league", name: "FKF Premier League", leagueName: "FKF Premier League", country: "Kenya", tier: "regional", enrichmentPriority: 17, homeAdvantageFactor: 1.14, predictions: false },
  { id: 88, leagueId: "88", slug: "eredivisie", name: "Eredivisie", leagueName: "Eredivisie", country: "Netherlands", tier: "regional", enrichmentPriority: 20, homeAdvantageFactor: 1.08, predictions: false },
  { id: 94, leagueId: "94", slug: "primeira-liga", name: "Primeira Liga", leagueName: "Primeira Liga", country: "Portugal", tier: "regional", enrichmentPriority: 21, homeAdvantageFactor: 1.1, predictions: false },
  { id: 203, leagueId: "203", slug: "super-lig", name: "Super Lig", leagueName: "Super Lig", country: "Turkey", tier: "regional", enrichmentPriority: 22, homeAdvantageFactor: 1.11, predictions: false }
] as const;

export const predictionFootballLeagues = footballLeagueRegistry.filter((league) => league.predictions);
export const defaultPredictionFootballLeagueIds = predictionFootballLeagues.map((league) => league.leagueId);

export function footballLeagueById(id: string | number) { return footballLeagueRegistry.find((league) => league.leagueId === String(id).replace("api-football:", "")) ?? null; }
export function footballLeagueBySlug(slug: string) { return footballLeagueRegistry.find((league) => league.slug === slug) ?? null; }
export function predictionLeagueBySlug(slug: string) { return predictionFootballLeagues.find((league) => league.slug === slug) ?? null; }
export function footballLeaguePriority(id: string | number) { return footballLeagueById(id)?.enrichmentPriority ?? null; }
export function homeAdvantageForLeague(id: string | number) { return footballLeagueById(id)?.homeAdvantageFactor ?? 1.11; }

/** Shared normalization used by both daily provider fixtures and historical replay. */
export function footballLeagueStrength(country: string, leagueName: string): number {
  const text = `${country} ${leagueName}`.toLowerCase();
  if (text.includes("champions league")) return 0.98;
  if (text.includes("england") || text.includes("premier league")) return 0.94;
  if (text.includes("spain") || text.includes("italy") || text.includes("germany")) return 0.9;
  if (text.includes("france") || text.includes("netherlands") || text.includes("portugal")) return 0.85;
  if (text.includes("nigeria") || text.includes("ghana") || text.includes("kenya") || text.includes("south africa")) return 0.7;
  return 0.78;
}

export function configuredPredictionLeagueIds(raw: string | undefined): Set<string> {
  const allowed = new Set(defaultPredictionFootballLeagueIds);
  if (!raw?.trim()) return allowed;
  const requested = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const configured = requested.filter((id) => allowed.has(id));
  return new Set(configured.length ? configured : defaultPredictionFootballLeagueIds);
}
