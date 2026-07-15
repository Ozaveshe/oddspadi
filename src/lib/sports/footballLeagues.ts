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
  /**
   * The Odds API competition keys that price this league, in preference order.
   * A league can span several keys across a season (UEFA competitions publish a
   * separate `_qualification` key that is the only active one in July), so the
   * odds layer selects whichever key the provider currently reports as active
   * rather than assuming a single key is live year-round.
   */
  oddsSportKeys: readonly string[];
};

/**
 * Prediction coverage must stay populated all year. The European season runs
 * roughly August–May, so a registry of only European (and northern-African)
 * leagues leaves every prediction surface empty for the whole summer — which is
 * exactly what happened: on 2026-07-15 the provider returned 168 fixtures and
 * none of them were in a prediction league. The Americas, Nordic and Asian
 * calendars run February–December and cover that gap, so predictions stay on
 * whichever competitions are actually being played.
 */
export const footballLeagueRegistry: readonly FootballLeague[] = [
  { id: 1, leagueId: "1", slug: "world-cup", name: "FIFA World Cup", leagueName: "FIFA World Cup", country: "World", tier: "global", enrichmentPriority: 0, homeAdvantageFactor: 1, predictions: false, oddsSportKeys: ["soccer_fifa_world_cup"] },
  { id: 6, leagueId: "6", slug: "afcon", name: "Africa Cup of Nations", leagueName: "Africa Cup of Nations", country: "Africa", tier: "continental", enrichmentPriority: 1, homeAdvantageFactor: 1.04, predictions: false, oddsSportKeys: ["soccer_africa_cup_of_nations"] },
  { id: 2, leagueId: "2", slug: "champions-league", name: "UEFA Champions League", leagueName: "UEFA Champions League", country: "Europe", tier: "continental", enrichmentPriority: 2, homeAdvantageFactor: 1.09, predictions: true, oddsSportKeys: ["soccer_uefa_champs_league", "soccer_uefa_champs_league_qualification"] },
  { id: 12, leagueId: "12", slug: "caf-champions-league", name: "CAF Champions League", leagueName: "CAF Champions League", country: "Africa", tier: "continental", enrichmentPriority: 3, homeAdvantageFactor: 1.12, predictions: false, oddsSportKeys: [] },
  { id: 39, leagueId: "39", slug: "premier-league", name: "Premier League", leagueName: "Premier League", country: "England", tier: "top-five", enrichmentPriority: 4, homeAdvantageFactor: 1.08, predictions: true, oddsSportKeys: ["soccer_epl"] },
  { id: 140, leagueId: "140", slug: "la-liga", name: "La Liga", leagueName: "La Liga", country: "Spain", tier: "top-five", enrichmentPriority: 5, homeAdvantageFactor: 1.1, predictions: true, oddsSportKeys: ["soccer_spain_la_liga"] },
  { id: 135, leagueId: "135", slug: "serie-a", name: "Serie A", leagueName: "Serie A", country: "Italy", tier: "top-five", enrichmentPriority: 6, homeAdvantageFactor: 1.09, predictions: true, oddsSportKeys: ["soccer_italy_serie_a"] },
  { id: 78, leagueId: "78", slug: "bundesliga", name: "Bundesliga", leagueName: "Bundesliga", country: "Germany", tier: "top-five", enrichmentPriority: 7, homeAdvantageFactor: 1.07, predictions: true, oddsSportKeys: ["soccer_germany_bundesliga"] },
  { id: 61, leagueId: "61", slug: "ligue-1", name: "Ligue 1", leagueName: "Ligue 1", country: "France", tier: "top-five", enrichmentPriority: 8, homeAdvantageFactor: 1.09, predictions: true, oddsSportKeys: ["soccer_france_ligue_one"] },
  { id: 3, leagueId: "3", slug: "europa-league", name: "UEFA Europa League", leagueName: "UEFA Europa League", country: "Europe", tier: "continental", enrichmentPriority: 9, homeAdvantageFactor: 1.09, predictions: true, oddsSportKeys: ["soccer_uefa_europa_league", "soccer_uefa_europa_league_qualification"] },
  { id: 848, leagueId: "848", slug: "conference-league", name: "UEFA Conference League", leagueName: "UEFA Conference League", country: "Europe", tier: "continental", enrichmentPriority: 10, homeAdvantageFactor: 1.09, predictions: true, oddsSportKeys: ["soccer_uefa_europa_conference_league"] },
  { id: 13, leagueId: "13", slug: "copa-libertadores", name: "Copa Libertadores", leagueName: "CONMEBOL Libertadores", country: "South America", tier: "continental", enrichmentPriority: 11, homeAdvantageFactor: 1.22, predictions: true, oddsSportKeys: ["soccer_conmebol_copa_libertadores"] },
  { id: 20, leagueId: "20", slug: "caf-confederation-cup", name: "CAF Confederation Cup", leagueName: "CAF Confederation Cup", country: "Africa", tier: "continental", enrichmentPriority: 12, homeAdvantageFactor: 1.12, predictions: false, oddsSportKeys: [] },
  { id: 399, leagueId: "399", slug: "npfl", name: "Nigeria Premier Football League", leagueName: "Nigeria Premier Football League", country: "Nigeria", tier: "africa-primary", enrichmentPriority: 13, homeAdvantageFactor: 1.16, predictions: true, oddsSportKeys: [] },
  { id: 288, leagueId: "288", slug: "psl", name: "South African Premier Division", leagueName: "South African Premier Division", country: "South Africa", tier: "africa-primary", enrichmentPriority: 14, homeAdvantageFactor: 1.12, predictions: true, oddsSportKeys: [] },
  { id: 233, leagueId: "233", slug: "egyptian-premier-league", name: "Egyptian Premier League", leagueName: "Egyptian Premier League", country: "Egypt", tier: "africa-primary", enrichmentPriority: 15, homeAdvantageFactor: 1.14, predictions: true, oddsSportKeys: [] },
  // Southern-hemisphere, Nordic and Asian calendars: these are the competitions
  // that are actually in play while Europe is on its summer break.
  { id: 71, leagueId: "71", slug: "brasileirao", name: "Brasileirão Série A", leagueName: "Serie A", country: "Brazil", tier: "regional", enrichmentPriority: 16, homeAdvantageFactor: 1.2, predictions: true, oddsSportKeys: ["soccer_brazil_campeonato"] },
  { id: 253, leagueId: "253", slug: "mls", name: "Major League Soccer", leagueName: "Major League Soccer", country: "USA", tier: "regional", enrichmentPriority: 17, homeAdvantageFactor: 1.15, predictions: true, oddsSportKeys: ["soccer_usa_mls"] },
  { id: 262, leagueId: "262", slug: "liga-mx", name: "Liga MX", leagueName: "Liga MX", country: "Mexico", tier: "regional", enrichmentPriority: 18, homeAdvantageFactor: 1.18, predictions: true, oddsSportKeys: ["soccer_mexico_ligamx"] },
  { id: 128, leagueId: "128", slug: "liga-argentina", name: "Liga Profesional Argentina", leagueName: "Liga Profesional Argentina", country: "Argentina", tier: "regional", enrichmentPriority: 19, homeAdvantageFactor: 1.18, predictions: true, oddsSportKeys: ["soccer_argentina_primera_division"] },
  { id: 292, leagueId: "292", slug: "k-league-1", name: "K League 1", leagueName: "K League 1", country: "South-Korea", tier: "regional", enrichmentPriority: 20, homeAdvantageFactor: 1.12, predictions: true, oddsSportKeys: ["soccer_korea_kleague1"] },
  { id: 98, leagueId: "98", slug: "j1-league", name: "J1 League", leagueName: "J1 League", country: "Japan", tier: "regional", enrichmentPriority: 21, homeAdvantageFactor: 1.1, predictions: true, oddsSportKeys: ["soccer_japan_j_league"] },
  { id: 103, leagueId: "103", slug: "eliteserien", name: "Eliteserien", leagueName: "Eliteserien", country: "Norway", tier: "regional", enrichmentPriority: 22, homeAdvantageFactor: 1.1, predictions: true, oddsSportKeys: ["soccer_norway_eliteserien"] },
  { id: 113, leagueId: "113", slug: "allsvenskan", name: "Allsvenskan", leagueName: "Allsvenskan", country: "Sweden", tier: "regional", enrichmentPriority: 23, homeAdvantageFactor: 1.1, predictions: true, oddsSportKeys: ["soccer_sweden_allsvenskan"] },
  { id: 119, leagueId: "119", slug: "danish-superliga", name: "Danish Superliga", leagueName: "Superliga", country: "Denmark", tier: "regional", enrichmentPriority: 24, homeAdvantageFactor: 1.09, predictions: true, oddsSportKeys: ["soccer_denmark_superliga"] },
  { id: 244, leagueId: "244", slug: "veikkausliiga", name: "Veikkausliiga", leagueName: "Veikkausliiga", country: "Finland", tier: "regional", enrichmentPriority: 25, homeAdvantageFactor: 1.1, predictions: true, oddsSportKeys: ["soccer_finland_veikkausliiga"] },
  { id: 169, leagueId: "169", slug: "chinese-super-league", name: "Chinese Super League", leagueName: "Super League", country: "China", tier: "regional", enrichmentPriority: 26, homeAdvantageFactor: 1.12, predictions: true, oddsSportKeys: ["soccer_china_superleague"] },
  { id: 200, leagueId: "200", slug: "botola-pro", name: "Botola Pro", leagueName: "Botola Pro", country: "Morocco", tier: "regional", enrichmentPriority: 27, homeAdvantageFactor: 1.14, predictions: false, oddsSportKeys: [] },
  { id: 570, leagueId: "570", slug: "ghana-premier-league", name: "Ghana Premier League", leagueName: "Ghana Premier League", country: "Ghana", tier: "regional", enrichmentPriority: 28, homeAdvantageFactor: 1.15, predictions: false, oddsSportKeys: [] },
  { id: 276, leagueId: "276", slug: "fkf-premier-league", name: "FKF Premier League", leagueName: "FKF Premier League", country: "Kenya", tier: "regional", enrichmentPriority: 29, homeAdvantageFactor: 1.14, predictions: false, oddsSportKeys: [] },
  { id: 88, leagueId: "88", slug: "eredivisie", name: "Eredivisie", leagueName: "Eredivisie", country: "Netherlands", tier: "regional", enrichmentPriority: 30, homeAdvantageFactor: 1.08, predictions: false, oddsSportKeys: ["soccer_netherlands_eredivisie"] },
  { id: 94, leagueId: "94", slug: "primeira-liga", name: "Primeira Liga", leagueName: "Primeira Liga", country: "Portugal", tier: "regional", enrichmentPriority: 31, homeAdvantageFactor: 1.1, predictions: false, oddsSportKeys: ["soccer_portugal_primeira_liga"] },
  { id: 203, leagueId: "203", slug: "super-lig", name: "Super Lig", leagueName: "Super Lig", country: "Turkey", tier: "regional", enrichmentPriority: 32, homeAdvantageFactor: 1.11, predictions: false, oddsSportKeys: ["soccer_turkey_super_league"] }
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

/**
 * The Odds API keys that can price the given prediction leagues (defaults to
 * every prediction league), ordered by enrichment priority so that when the
 * request budget forces a cap, the biggest competitions keep their prices.
 */
export function predictionOddsSportKeys(leagueIds?: Set<string>): string[] {
  return Array.from(
    new Set(
      predictionFootballLeagues
        .filter((league) => !leagueIds || leagueIds.has(league.leagueId))
        .slice()
        .sort((left, right) => left.enrichmentPriority - right.enrichmentPriority)
        .flatMap((league) => league.oddsSportKeys)
    )
  );
}

export function configuredPredictionLeagueIds(raw: string | undefined): Set<string> {
  const allowed = new Set(defaultPredictionFootballLeagueIds);
  if (!raw?.trim()) return allowed;
  const requested = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const configured = requested.filter((id) => allowed.has(id));
  return new Set(configured.length ? configured : defaultPredictionFootballLeagueIds);
}
