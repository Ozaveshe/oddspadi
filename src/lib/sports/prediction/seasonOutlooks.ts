export type SeasonBaselineTeam = {
  name: string;
  position: number;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type SeasonProjection = SeasonBaselineTeam & {
  titleProbability: number;
  topFourProbability: number;
  medianPosition: number;
  strengthIndex: number;
};

export const premierLeague2026Baseline = {
  id: "premier-league-2026-27-returning-baseline",
  competition: "Premier League",
  country: "England",
  targetSeason: "2026/27",
  revision: 1,
  publishedAt: "2026-07-12",
  sourceAsOf: "2026-05-24T15:00:00Z",
  source: "OddsPadi normalized API-Football standings snapshots",
  sourceLeagueId: "api-football:39",
  model: "returning-team Monte Carlo baseline v1",
  simulations: 20_000,
  caveat: "Returning-team baseline only. Promoted clubs, transfers, injuries, managers, schedule strength and opening prices are not included yet.",
  confirmedPromoted: ["Coventry City", "Ipswich Town", "Hull City"],
  seasonStarts: "2026-08-21",
  officialSources: [
    { label: "Premier League confirms 2026/27 clubs", url: "https://www.premierleague.com/en/news/4673099/the-202627-premier-league-season-officially-starts/", checkedAt: "2026-07-12" },
    { label: "All 380 Premier League fixtures", url: "https://www.premierleague.com/en/news/4675097/all-380-fixtures-for-202627-premier-league-season/", checkedAt: "2026-07-12" }
  ],
  teams: [
    ["Arsenal", 1, 38, 85, 71, 27], ["Manchester City", 2, 38, 78, 77, 35],
    ["Manchester United", 3, 38, 71, 69, 50], ["Aston Villa", 4, 38, 65, 56, 49],
    ["Liverpool", 5, 38, 60, 63, 53], ["Bournemouth", 6, 38, 57, 58, 54],
    ["Sunderland", 7, 38, 54, 42, 48], ["Brighton", 8, 38, 53, 52, 46],
    ["Brentford", 9, 38, 53, 55, 52], ["Chelsea", 10, 38, 52, 58, 52],
    ["Fulham", 11, 38, 52, 47, 51], ["Newcastle", 12, 38, 49, 53, 55],
    ["Everton", 13, 38, 49, 47, 50], ["Leeds", 14, 38, 47, 49, 56],
    ["Crystal Palace", 15, 38, 45, 41, 51], ["Nottingham Forest", 16, 38, 44, 48, 51],
    ["Tottenham", 17, 38, 41, 48, 57]
  ].map(([name, position, played, points, goalsFor, goalsAgainst]) => ({ name, position, played, points, goalsFor, goalsAgainst })) as SeasonBaselineTeam[]
} as const;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function buildPremierLeague2026Projection(simulations: number = premierLeague2026Baseline.simulations): SeasonProjection[] {
  const teams = premierLeague2026Baseline.teams;
  const runs = Math.max(1_000, Math.min(100_000, Math.round(simulations)));
  const random = seededRandom(0x0dd5_2026);
  const title = new Array(teams.length).fill(0) as number[];
  const topFour = new Array(teams.length).fill(0) as number[];
  const positionSamples = teams.map(() => [] as number[]);
  const strengths = teams.map((team) => {
    const ppg = team.points / Math.max(team.played, 1);
    const goalDifferencePerGame = (team.goalsFor - team.goalsAgainst) / Math.max(team.played, 1);
    return ppg * 0.78 + goalDifferencePerGame * 0.22;
  });

  for (let run = 0; run < runs; run += 1) {
    const ranked = strengths
      .map((strength, index) => ({ index, score: strength + gaussian(random) * 0.34 }))
      .sort((a, b) => b.score - a.score);
    ranked.forEach(({ index }, position) => {
      positionSamples[index].push(position + 1);
      if (position === 0) title[index] += 1;
      if (position < 4) topFour[index] += 1;
    });
  }

  return teams.map((team, index) => {
    const positions = positionSamples[index].sort((a, b) => a - b);
    return {
      ...team,
      titleProbability: title[index] / runs,
      topFourProbability: topFour[index] / runs,
      medianPosition: positions[Math.floor(positions.length / 2)],
      strengthIndex: strengths[index]
    };
  }).sort((a, b) => b.titleProbability - a.titleProbability || a.medianPosition - b.medianPosition);
}

export const seasonCoverageQueue = [
  { sport: "Football", competition: "Premier League", season: "2026/27", status: "baseline-live", nextInput: "Calibrated promoted-team strength, transfers and provider fixture map" },
  { sport: "Football", competition: "CAF Champions League", season: "2026/27", status: "source-watch", nextInput: "Confirmed entrants and draw" },
  { sport: "Basketball", competition: "NBA", season: "2026/27", status: "source-watch", nextInput: "Final rosters and schedule release" },
  { sport: "Tennis", competition: "ATP / WTA", season: "2026 second half", status: "event-window", nextInput: "Tournament fields and active surface keys" }
] as const;
