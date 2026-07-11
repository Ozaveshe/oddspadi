import { EPL_2026_FIXTURE_SOURCE_URL, EPL_2026_OPENING_WINDOW, getEpl2026OpeningFixturesForDate } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import type { Match, MatchContextSignal, OddsMarket, Sport, SportsDataProvider, TeamForm } from "@/lib/sports/types";

type FixtureTemplate = {
  id: string;
  league: { id: string; name: string; country: string; strength: number };
  time: string;
  home: [string, number];
  away: [string, number];
  status: "scheduled" | "live" | "finished";
  odds: [number, number, number];
  dataQuality: number;
};

type CourtTemplate = FixtureTemplate & {
  totalLine: number;
  spread: number;
};

type TennisTemplate = FixtureTemplate & {
  totalGamesLine: number;
};

const fixtures: FixtureTemplate[] = [
  fixture("epl-001", "epl", "English Premier League", "England", 0.94, "12:30", ["Arsenal", 91], ["Aston Villa", 82], "scheduled", [1.88, 3.75, 4.1], 0.9),
  fixture("epl-002", "epl", "English Premier League", "England", 0.94, "15:00", ["Manchester City", 94], ["Newcastle United", 84], "scheduled", [1.62, 4.2, 5.4], 0.91),
  fixture("epl-003", "epl", "English Premier League", "England", 0.94, "15:00", ["Chelsea", 86], ["Brighton", 80], "live", [2.02, 3.55, 3.75], 0.87),
  fixture("epl-004", "epl", "English Premier League", "England", 0.94, "17:30", ["Liverpool", 92], ["Tottenham", 85], "scheduled", [1.82, 3.9, 4.15], 0.9),
  fixture("laliga-001", "laliga", "La Liga", "Spain", 0.92, "13:00", ["Barcelona", 91], ["Sevilla", 80], "scheduled", [1.7, 3.9, 5.0], 0.89),
  fixture("laliga-002", "laliga", "La Liga", "Spain", 0.92, "15:15", ["Real Madrid", 94], ["Real Sociedad", 84], "scheduled", [1.58, 4.1, 5.8], 0.9),
  fixture("laliga-003", "laliga", "La Liga", "Spain", 0.92, "17:30", ["Atletico Madrid", 88], ["Valencia", 79], "finished", [1.76, 3.5, 5.2], 0.86),
  fixture("laliga-004", "laliga", "La Liga", "Spain", 0.92, "20:00", ["Villarreal", 81], ["Real Betis", 80], "scheduled", [2.35, 3.35, 3.05], 0.84),
  fixture("seriea-001", "seriea", "Serie A", "Italy", 0.89, "12:00", ["Inter", 90], ["Fiorentina", 81], "scheduled", [1.74, 3.7, 5.0], 0.87),
  fixture("seriea-002", "seriea", "Serie A", "Italy", 0.89, "14:00", ["Juventus", 87], ["Bologna", 80], "scheduled", [1.95, 3.35, 4.2], 0.86),
  fixture("seriea-003", "seriea", "Serie A", "Italy", 0.89, "17:00", ["Milan", 88], ["Lazio", 82], "live", [2.05, 3.4, 3.8], 0.86),
  fixture("seriea-004", "seriea", "Serie A", "Italy", 0.89, "19:45", ["Napoli", 86], ["Roma", 84], "scheduled", [2.2, 3.45, 3.35], 0.85),
  fixture("bundes-001", "bundesliga", "Bundesliga", "Germany", 0.9, "13:30", ["Bayern Munich", 93], ["Stuttgart", 82], "scheduled", [1.52, 4.6, 5.9], 0.9),
  fixture("bundes-002", "bundesliga", "Bundesliga", "Germany", 0.9, "14:30", ["Borussia Dortmund", 87], ["RB Leipzig", 86], "scheduled", [2.45, 3.65, 2.85], 0.87),
  fixture("bundes-003", "bundesliga", "Bundesliga", "Germany", 0.9, "14:30", ["Leverkusen", 91], ["Eintracht Frankfurt", 82], "live", [1.72, 4.0, 4.7], 0.88),
  fixture("bundes-004", "bundesliga", "Bundesliga", "Germany", 0.9, "17:30", ["Wolfsburg", 79], ["Freiburg", 78], "scheduled", [2.38, 3.35, 3.1], 0.82),
  fixture("ligue1-001", "ligue1", "Ligue 1", "France", 0.86, "14:00", ["PSG", 92], ["Rennes", 80], "scheduled", [1.5, 4.35, 6.7], 0.87),
  fixture("ligue1-002", "ligue1", "Ligue 1", "France", 0.86, "16:05", ["Lyon", 81], ["Marseille", 83], "scheduled", [2.65, 3.35, 2.75], 0.84),
  fixture("ligue1-003", "ligue1", "Ligue 1", "France", 0.86, "18:30", ["Monaco", 85], ["Nice", 80], "finished", [1.98, 3.55, 3.85], 0.85),
  fixture("ucl-001", "ucl", "UEFA Champions League", "Europe", 0.98, "18:00", ["Porto", 84], ["Benfica", 85], "scheduled", [2.7, 3.25, 2.7], 0.88),
  fixture("ucl-002", "ucl", "UEFA Champions League", "Europe", 0.98, "20:00", ["PSV", 84], ["Celtic", 80], "scheduled", [1.95, 3.7, 3.85], 0.86),
  fixture("ucl-003", "ucl", "UEFA Champions League", "Europe", 0.98, "20:00", ["Galatasaray", 82], ["Ajax", 81], "scheduled", [2.18, 3.55, 3.35], 0.84),
  fixture("uel-001", "uel", "UEFA Europa League", "Europe", 0.84, "17:45", ["Sporting CP", 85], ["Fenerbahce", 82], "scheduled", [2.0, 3.45, 3.9], 0.84),
  fixture("uel-002", "uel", "UEFA Europa League", "Europe", 0.84, "17:45", ["Real Betis", 80], ["Rangers", 78], "scheduled", [2.12, 3.45, 3.5], 0.82),
  fixture("npfl-001", "npfl", "Nigeria Professional Football League", "Nigeria", 0.68, "15:00", ["Enyimba", 76], ["Shooting Stars", 68], "scheduled", [1.95, 3.05, 4.45], 0.78),
  fixture("npfl-002", "npfl", "Nigeria Professional Football League", "Nigeria", 0.68, "15:00", ["Kano Pillars", 73], ["Rivers United", 72], "live", [2.35, 2.95, 3.35], 0.75),
  fixture("npfl-003", "npfl", "Nigeria Professional Football League", "Nigeria", 0.68, "16:00", ["Remo Stars", 74], ["Plateau United", 70], "scheduled", [2.05, 2.9, 4.1], 0.76),
  fixture("npfl-004", "npfl", "Nigeria Professional Football League", "Nigeria", 0.68, "16:30", ["Akwa United", 70], ["Lobi Stars", 69], "finished", [2.5, 2.88, 3.15], 0.72),
  fixture("psl-001", "psl", "South African Premier Division", "South Africa", 0.72, "14:30", ["Mamelodi Sundowns", 82], ["Kaizer Chiefs", 73], "scheduled", [1.82, 3.25, 4.85], 0.8),
  fixture("psl-002", "psl", "South African Premier Division", "South Africa", 0.72, "17:00", ["Orlando Pirates", 77], ["SuperSport United", 72], "scheduled", [2.05, 3.1, 3.95], 0.78),
  fixture("psl-003", "psl", "South African Premier Division", "South Africa", 0.72, "19:00", ["Cape Town City", 71], ["Stellenbosch", 70], "live", [2.45, 3.0, 3.2], 0.74),
  fixture("ghana-001", "ghana", "Ghana Premier League", "Ghana", 0.64, "15:00", ["Asante Kotoko", 74], ["Medeama", 70], "scheduled", [2.0, 2.9, 4.2], 0.73),
  fixture("ghana-002", "ghana", "Ghana Premier League", "Ghana", 0.64, "15:00", ["Hearts of Oak", 73], ["Aduana Stars", 69], "scheduled", [2.08, 2.85, 4.0], 0.72),
  fixture("ghana-003", "ghana", "Ghana Premier League", "Ghana", 0.64, "16:00", ["Dreams FC", 68], ["Berekum Chelsea", 67], "finished", [2.5, 2.8, 3.25], 0.7),
  fixture("kenya-001", "kenya", "Kenya Premier League", "Kenya", 0.61, "13:00", ["Gor Mahia", 75], ["Tusker", 72], "scheduled", [2.02, 2.95, 4.1], 0.73),
  fixture("kenya-002", "kenya", "Kenya Premier League", "Kenya", 0.61, "15:15", ["AFC Leopards", 70], ["KCB", 68], "scheduled", [2.25, 2.9, 3.55], 0.7),
  fixture("kenya-003", "kenya", "Kenya Premier League", "Kenya", 0.61, "16:30", ["Bandari", 68], ["Sofapaka", 66], "live", [2.18, 2.85, 3.75], 0.69),
  fixture("africa-001", "caf", "CAF Champions League", "Africa", 0.78, "18:00", ["Al Ahly", 84], ["TP Mazembe", 78], "scheduled", [1.9, 3.25, 4.4], 0.81),
  fixture("africa-002", "caf", "CAF Champions League", "Africa", 0.78, "20:00", ["Wydad AC", 80], ["Esperance", 79], "scheduled", [2.35, 3.05, 3.3], 0.8),
  fixture("africa-003", "caf", "CAF Champions League", "Africa", 0.78, "20:30", ["Petro de Luanda", 76], ["Young Africans", 75], "scheduled", [2.4, 3.0, 3.25], 0.77)
];

const basketballFixtures: CourtTemplate[] = [
  courtFixture("nba-001", "nba", "NBA", "United States", 0.96, "19:00", ["Boston Celtics", 92], ["Miami Heat", 84], "scheduled", [1.62, 2.35], 0.9, 219.5, -5.5),
  courtFixture("nba-002", "nba", "NBA", "United States", 0.96, "20:30", ["Denver Nuggets", 90], ["Phoenix Suns", 87], "scheduled", [1.82, 2.05], 0.88, 224.5, -2.5),
  courtFixture("nba-003", "nba", "NBA", "United States", 0.96, "22:00", ["LA Lakers", 84], ["Golden State Warriors", 86], "live", [2.15, 1.74], 0.84, 228.5, 3.5),
  courtFixture("euro-001", "euroleague", "EuroLeague", "Europe", 0.86, "18:45", ["Real Madrid Basketball", 89], ["Fenerbahce Basketball", 85], "scheduled", [1.72, 2.18], 0.85, 166.5, -4.5),
  courtFixture("bal-001", "bal", "Basketball Africa League", "Africa", 0.66, "17:00", ["Petro de Luanda Basketball", 77], ["Al Ahly Basketball", 78], "scheduled", [2.02, 1.86], 0.74, 154.5, 1.5)
];

const tennisFixtures: TennisTemplate[] = [
  tennisFixture("tennis-001", "atp-hard", "ATP Hard Court Quarterfinal", "World", 0.9, "11:00", ["Carlos Alcaraz", 93], ["Daniil Medvedev", 89], "scheduled", [1.68, 2.22], 0.88, 22.5),
  tennisFixture("tennis-002", "wta-clay", "WTA Clay Semifinal", "World", 0.84, "13:30", ["Iga Swiatek", 94], ["Coco Gauff", 88], "scheduled", [1.55, 2.55], 0.9, 21.5),
  tennisFixture("tennis-003", "atp-grass", "ATP Grass Final", "World", 0.86, "15:00", ["Jannik Sinner", 92], ["Novak Djokovic", 91], "live", [1.92, 1.92], 0.86, 23.5),
  tennisFixture("tennis-004", "wta-hard", "WTA Hard Court Round 16", "World", 0.8, "18:00", ["Ons Jabeur", 84], ["Madison Keys", 83], "scheduled", [1.98, 1.88], 0.8, 22.5)
];

function fixture(
  id: string,
  leagueId: string,
  leagueName: string,
  country: string,
  strength: number,
  time: string,
  home: [string, number],
  away: [string, number],
  status: "scheduled" | "live" | "finished",
  odds: [number, number, number],
  dataQuality: number
): FixtureTemplate {
  return {
    id,
    league: { id: leagueId, name: leagueName, country, strength },
    time,
    home,
    away,
    status,
    odds,
    dataQuality
  };
}

function courtFixture(
  id: string,
  leagueId: string,
  leagueName: string,
  country: string,
  strength: number,
  time: string,
  home: [string, number],
  away: [string, number],
  status: "scheduled" | "live" | "finished",
  odds: [number, number],
  dataQuality: number,
  totalLine: number,
  spread: number
): CourtTemplate {
  return {
    ...fixture(id, leagueId, leagueName, country, strength, time, home, away, status, [odds[0], 999, odds[1]], dataQuality),
    totalLine,
    spread
  };
}

function tennisFixture(
  id: string,
  leagueId: string,
  leagueName: string,
  country: string,
  strength: number,
  time: string,
  home: [string, number],
  away: [string, number],
  status: "scheduled" | "live" | "finished",
  odds: [number, number],
  dataQuality: number,
  totalGamesLine: number
): TennisTemplate {
  return {
    ...fixture(id, leagueId, leagueName, country, strength, time, home, away, status, [odds[0], 999, odds[1]], dataQuality),
    totalGamesLine
  };
}

function buildDateTime(date: string, time: string): string {
  return `${date}T${time}:00+01:00`;
}

function seedFromText(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function buildForm(teamId: string, rating: number, offset: number): TeamForm {
  const results: Array<"W" | "D" | "L"> = [];
  const seed = seedFromText(teamId) + offset;
  for (let index = 0; index < 5; index += 1) {
    const marker = (seed + index * 7 + Math.round(rating)) % 10;
    results.push(marker >= 6 ? "W" : marker >= 3 ? "D" : "L");
  }

  return {
    teamId,
    recentResults: results,
    goalsFor: Number((1.05 + (rating - 65) / 32 + (seed % 4) * 0.18).toFixed(2)),
    goalsAgainst: Number((1.55 - (rating - 65) / 60 + (seed % 3) * 0.12).toFixed(2)),
    attackStrength: Number((0.55 + (rating - 65) / 42 + (seed % 5) * 0.025).toFixed(2)),
    defenseStrength: Number((0.52 + (rating - 65) / 48 + (seed % 4) * 0.025).toFixed(2))
  };
}

function kickoffClock(kickoff: string | null): string {
  return kickoff?.match(/\d{2}:\d{2}/)?.[0] ?? "15:00";
}

function dayDiff(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function openingFixtureOdds(homeRating: number, awayRating: number): [number, number, number] {
  const ratingDiff = homeRating - awayRating;
  const drawProbability = clamp(0.245 - Math.abs(ratingDiff) * 0.0026, 0.17, 0.28);
  const sideShare = 1 - drawProbability;
  const homeSideProbability = logistic((ratingDiff + 6.5) / 14);
  const homeProbability = clamp(sideShare * homeSideProbability, 0.12, 0.76);
  const awayProbability = clamp(sideShare - homeProbability, 0.1, 0.7);
  const total = homeProbability + drawProbability + awayProbability;
  const margin = 1.055;
  const decimal = (probability: number) => Number((1 / ((probability / total) * margin)).toFixed(2));
  return [decimal(homeProbability), decimal(drawProbability), decimal(awayProbability)];
}

function eplOpeningContextSignals(template: (typeof EPL_2026_OPENING_WINDOW)[number]): MatchContextSignal[] {
  const daysFromFixtureRelease = dayDiff("2026-06-19", template.date);
  const preseasonHorizon = dayDiff("2026-07-02", template.date);
  const promotedAway = ["Coventry City", "Hull City", "Leeds United", "Sunderland"].includes(template.away);
  const promotedHome = ["Coventry City", "Hull City", "Leeds United", "Sunderland"].includes(template.home);

  return [
    {
      id: `${template.id}-official-fixture-release`,
      category: "news",
      label: "Official EPL fixture release",
      detail: `Premier League 2026/27 fixture seed released 2026-06-19; kickoff is ${preseasonHorizon} day(s) from the MVP reference date and ${daysFromFixtureRelease} day(s) after fixture release. Kickoff time and broadcast slots remain mutable.`,
      quality: "acceptable",
      impact: "unknown",
      confidence: 0.7,
      weight: 0,
      source: "premierleague-official-fixture-release",
      publishedAt: "2026-06-19T09:00:00.000Z"
    },
    {
      id: `${template.id}-preseason-horizon-risk`,
      category: "news",
      label: "Preseason horizon risk",
      detail:
        "This is a future preseason fixture seed: transfers, injuries, tactical roles, lineups, first odds snapshots, and weather are not settled enough for public action.",
      quality: "thin",
      impact: "unknown",
      confidence: 0.84,
      weight: 0,
      source: "oddspadi-preseason-risk-model",
      publishedAt: "2026-07-02T00:00:00.000Z"
    },
    {
      id: `${template.id}-promoted-club-context`,
      category: "standings",
      label: "Promoted club baseline",
      detail:
        promotedHome || promotedAway
          ? `${promotedHome ? template.home : template.away} is treated as a promoted-club baseline until provider standings, squad quality, and historical top-flight priors are backfilled.`
          : "Both clubs are treated with existing top-flight baseline ratings until provider standings and 10-year history are connected.",
      quality: "acceptable",
      impact: promotedHome ? "away-positive" : promotedAway ? "home-positive" : "neutral",
      confidence: promotedHome || promotedAway ? 0.62 : 0.52,
      weight: promotedHome || promotedAway ? 0.012 : 0,
      source: "oddspadi-epl-2026-baseline",
      publishedAt: "2026-07-02T00:00:00.000Z"
    }
  ];
}

function buildOddsMarkets(template: FixtureTemplate): OddsMarket[] {
  const [home, draw, away] = template.odds;
  const seed = seedFromText(template.id);
  const over = Number((1.78 + (seed % 6) * 0.05).toFixed(2));
  const under = Number((1.84 + (seed % 5) * 0.06).toFixed(2));
  const bttsYes = Number((1.82 + (seed % 6) * 0.06).toFixed(2));
  const bttsNo = Number((1.86 + (seed % 5) * 0.05).toFixed(2));

  return [
    {
      id: "match_winner",
      name: "Match winner",
      selections: [
        { id: "home", label: template.home[0], decimalOdds: home },
        { id: "draw", label: "Draw", decimalOdds: draw },
        { id: "away", label: template.away[0], decimalOdds: away }
      ]
    },
    {
      id: "over_under_25",
      name: "Goals over/under 2.5",
      selections: [
        { id: "over_25", label: "Over 2.5 Goals", decimalOdds: over },
        { id: "under_25", label: "Under 2.5 Goals", decimalOdds: under }
      ]
    },
    {
      id: "both_teams_to_score",
      name: "Both teams to score",
      selections: [
        { id: "yes", label: "BTTS Yes", decimalOdds: bttsYes },
        { id: "no", label: "BTTS No", decimalOdds: bttsNo }
      ]
    }
  ];
}

function toEpl2026OpeningMatch(template: (typeof EPL_2026_OPENING_WINDOW)[number]): Match {
  const homeId = `${template.id}-home`;
  const awayId = `${template.id}-away`;
  const fixtureTemplate: FixtureTemplate = {
    id: template.id,
    league: { id: "epl", name: "English Premier League", country: "England", strength: 0.94 },
    time: kickoffClock(template.kickoff),
    home: [template.home, template.homeRating],
    away: [template.away, template.awayRating],
    status: "scheduled",
    odds: openingFixtureOdds(template.homeRating, template.awayRating),
    dataQuality: 0.82
  };

  return {
    id: template.id,
    sport: "football",
    league: fixtureTemplate.league,
    kickoffTime: buildDateTime(template.date, fixtureTemplate.time),
    homeTeam: { id: homeId, name: template.home, rating: template.homeRating },
    awayTeam: { id: awayId, name: template.away, rating: template.awayRating },
    status: "scheduled",
    oddsMarkets: buildOddsMarkets(fixtureTemplate),
    homeForm: buildForm(homeId, template.homeRating, 23),
    awayForm: buildForm(awayId, template.awayRating, 37),
    dataQualityScore: fixtureTemplate.dataQuality,
    providerContextSignals: eplOpeningContextSignals(template),
    dataSource: {
      kind: "mock",
      fixtureProvider: "premierleague-official-2026-seed",
      oddsProvider: "synthetic-preseason-placeholder",
      formProvider: "deterministic-preseason-seed",
      fetchedAt: new Date("2026-07-02T00:00:00.000Z").toISOString(),
      notes: [
        `Opening fixture seed from ${EPL_2026_FIXTURE_SOURCE_URL}.`,
        "Bookmaker event IDs and live odds snapshots are still locked behind provider/odds credentials and clean Supabase storage proof."
      ]
    }
  };
}

function buildBasketballOddsMarkets(template: CourtTemplate): OddsMarket[] {
  const [home, , away] = template.odds;
  return [
    {
      id: "match_winner",
      name: "Moneyline",
      selections: [
        { id: "home", label: template.home[0], decimalOdds: home },
        { id: "away", label: template.away[0], decimalOdds: away }
      ]
    },
    {
      id: "spread",
      name: "Spread",
      selections: [
        { id: "home_cover", label: `${template.home[0]} ${template.spread < 0 ? "" : "+"}${template.spread}`, decimalOdds: 1.91 },
        { id: "away_cover", label: `${template.away[0]} ${template.spread < 0 ? "+" : "-"}${Math.abs(template.spread)}`, decimalOdds: 1.91 }
      ]
    },
    {
      id: "total_points",
      name: "Total points",
      selections: [
        { id: "over", label: `Over ${template.totalLine}`, decimalOdds: 1.9 },
        { id: "under", label: `Under ${template.totalLine}`, decimalOdds: 1.9 }
      ]
    }
  ];
}

function buildTennisOddsMarkets(template: TennisTemplate): OddsMarket[] {
  const [home, , away] = template.odds;
  return [
    {
      id: "match_winner",
      name: "Match winner",
      selections: [
        { id: "home", label: template.home[0], decimalOdds: home },
        { id: "away", label: template.away[0], decimalOdds: away }
      ]
    },
    {
      id: "set_handicap",
      name: "Set handicap",
      selections: [
        { id: "home_sets", label: `${template.home[0]} -1.5 sets`, decimalOdds: 2.28 },
        { id: "away_sets", label: `${template.away[0]} +1.5 sets`, decimalOdds: 1.62 }
      ]
    },
    {
      id: "total_games",
      name: "Total games",
      selections: [
        { id: "over", label: `Over ${template.totalGamesLine}`, decimalOdds: 1.88 },
        { id: "under", label: `Under ${template.totalGamesLine}`, decimalOdds: 1.92 }
      ]
    }
  ];
}

function buildScore(template: FixtureTemplate) {
  const seed = seedFromText(template.id);
  if (template.status === "scheduled") return undefined;

  return {
    home: template.status === "finished" ? seed % 3 : seed % 2,
    away: template.status === "finished" ? (seed + 1) % 3 : (seed + 2) % 2,
    minute: template.status === "live" ? 18 + (seed % 68) : undefined
  };
}

function toMatch(template: FixtureTemplate, date: string): Match {
  const homeId = `${template.id}-home`;
  const awayId = `${template.id}-away`;

  return {
    id: template.id,
    sport: "football",
    league: template.league,
    kickoffTime: buildDateTime(date, template.time),
    homeTeam: { id: homeId, name: template.home[0], rating: template.home[1] },
    awayTeam: { id: awayId, name: template.away[0], rating: template.away[1] },
    status: template.status,
    score: buildScore(template),
    oddsMarkets: buildOddsMarkets(template),
    homeForm: buildForm(homeId, template.home[1], 0),
    awayForm: buildForm(awayId, template.away[1], 11),
    dataQualityScore: template.dataQuality,
    dataSource: {
      kind: "mock",
      fixtureProvider: "mockSportsDataProvider",
      oddsProvider: "mockSportsDataProvider",
      formProvider: "mockSportsDataProvider"
    }
  };
}

function toBasketballMatch(template: CourtTemplate, date: string): Match {
  const homeId = `${template.id}-home`;
  const awayId = `${template.id}-away`;

  return {
    id: template.id,
    sport: "basketball",
    league: template.league,
    kickoffTime: buildDateTime(date, template.time),
    homeTeam: { id: homeId, name: template.home[0], rating: template.home[1] },
    awayTeam: { id: awayId, name: template.away[0], rating: template.away[1] },
    status: template.status,
    score: buildScore(template),
    oddsMarkets: buildBasketballOddsMarkets(template),
    homeForm: buildForm(homeId, template.home[1], 3),
    awayForm: buildForm(awayId, template.away[1], 17),
    dataQualityScore: template.dataQuality,
    dataSource: {
      kind: "mock",
      fixtureProvider: "mockSportsDataProvider",
      oddsProvider: "mockSportsDataProvider",
      formProvider: "mockSportsDataProvider"
    }
  };
}

function toTennisMatch(template: TennisTemplate, date: string): Match {
  const homeId = `${template.id}-home`;
  const awayId = `${template.id}-away`;

  return {
    id: template.id,
    sport: "tennis",
    league: template.league,
    kickoffTime: buildDateTime(date, template.time),
    homeTeam: { id: homeId, name: template.home[0], rating: template.home[1] },
    awayTeam: { id: awayId, name: template.away[0], rating: template.away[1] },
    status: template.status,
    score: buildScore(template),
    oddsMarkets: buildTennisOddsMarkets(template),
    homeForm: buildForm(homeId, template.home[1], 5),
    awayForm: buildForm(awayId, template.away[1], 19),
    dataQualityScore: template.dataQuality,
    dataSource: {
      kind: "mock",
      fixtureProvider: "mockSportsDataProvider",
      oddsProvider: "mockSportsDataProvider",
      formProvider: "mockSportsDataProvider"
    }
  };
}

export class MockSportsDataProvider implements SportsDataProvider {
  async getFixtures(date: string, sport: Sport): Promise<Match[]> {
    const eplOpeningFixtures = sport === "football" ? getEpl2026OpeningFixturesForDate(date) : [];
    if (eplOpeningFixtures.length) return eplOpeningFixtures.map(toEpl2026OpeningMatch);
    if (sport === "football") return fixtures.map((template) => toMatch(template, date));
    if (sport === "basketball") return basketballFixtures.map((template) => toBasketballMatch(template, date));
    if (sport === "tennis") return tennisFixtures.map((template) => toTennisMatch(template, date));
    return [];
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const openingFixture = EPL_2026_OPENING_WINDOW.find((item) => item.id === matchId);
    if (openingFixture) return toEpl2026OpeningMatch(openingFixture);
    const template = fixtures.find((item) => item.id === matchId);
    const date = new Date().toISOString().slice(0, 10);
    if (template) return toMatch(template, date);
    const basketball = basketballFixtures.find((item) => item.id === matchId);
    if (basketball) return toBasketballMatch(basketball, date);
    const tennis = tennisFixtures.find((item) => item.id === matchId);
    if (tennis) return toTennisMatch(tennis, date);
    return null;
  }

  async getLiveScores(date: string, sport: Sport): Promise<Match[]> {
    const matches = await this.getFixtures(date, sport);
    return matches.filter((match) => match.status === "live" || match.status === "scheduled" || match.status === "finished");
  }

  async getOdds(matchId: string): Promise<OddsMarket[]> {
    const match = await this.getMatch(matchId);
    return match?.oddsMarkets ?? [];
  }

  async getTeamForm(teamId: string): Promise<TeamForm> {
    const match = fixtures.find((item) => teamId.startsWith(item.id));
    if (!match) {
      return buildForm(teamId, 70, 0);
    }
    return buildForm(teamId, teamId.endsWith("home") ? match.home[1] : match.away[1], 0);
  }
}

// TODO: Add adapters for API-Football, API-Sports, SportMonks, TheSportsDB,
// The Odds API, bookmaker odds providers, live scores providers, and football
// news/injury providers. Keep API keys in SPORTS_API_KEY, ODDS_API_KEY,
// LIVE_SCORES_API_KEY, and NEWS_API_KEY.

export const mockSportsDataProvider = new MockSportsDataProvider();
