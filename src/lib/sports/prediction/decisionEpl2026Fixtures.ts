export const EPL_2026_FIXTURE_SOURCE_URL = "https://www.premierleague.com/en/news/4675097/all-380-fixtures-for-202627-premier-league-season";

export type DecisionEpl2026OpeningFixture = {
  id: string;
  date: string;
  kickoff: string | null;
  home: string;
  away: string;
  broadcaster: string | null;
  homeRating: number;
  awayRating: number;
};

export const EPL_2026_SEASON = {
  competition: "Premier League" as const,
  leagueId: "39" as const,
  season: "2026/27" as const,
  providerSeason: "2026" as const,
  fixtureReleaseDate: "2026-06-19" as const,
  seasonStartDate: "2026-08-21" as const,
  finalMatchDate: "2027-05-30" as const,
  totalFixtures: 380 as const,
  sourceUrl: EPL_2026_FIXTURE_SOURCE_URL
};

export const EPL_2026_OPENING_WINDOW: DecisionEpl2026OpeningFixture[] = [
  {
    id: "epl-2026-arsenal-coventry-city",
    date: "2026-08-21",
    kickoff: "20:00 UK",
    home: "Arsenal",
    away: "Coventry City",
    broadcaster: "Sky Sports",
    homeRating: 91,
    awayRating: 72
  },
  {
    id: "epl-2026-hull-city-manchester-united",
    date: "2026-08-22",
    kickoff: "12:30 UK",
    home: "Hull City",
    away: "Manchester United",
    broadcaster: "TNT Sports",
    homeRating: 71,
    awayRating: 86
  },
  {
    id: "epl-2026-everton-crystal-palace",
    date: "2026-08-22",
    kickoff: null,
    home: "Everton",
    away: "Crystal Palace",
    broadcaster: null,
    homeRating: 78,
    awayRating: 78
  },
  {
    id: "epl-2026-ipswich-town-sunderland",
    date: "2026-08-22",
    kickoff: null,
    home: "Ipswich Town",
    away: "Sunderland",
    broadcaster: null,
    homeRating: 73,
    awayRating: 72
  },
  {
    id: "epl-2026-nottingham-forest-leeds-united",
    date: "2026-08-22",
    kickoff: null,
    home: "Nottingham Forest",
    away: "Leeds United",
    broadcaster: null,
    homeRating: 80,
    awayRating: 74
  },
  {
    id: "epl-2026-brentford-tottenham-hotspur",
    date: "2026-08-22",
    kickoff: "17:30 UK",
    home: "Brentford",
    away: "Tottenham Hotspur",
    broadcaster: "Sky Sports",
    homeRating: 79,
    awayRating: 85
  },
  {
    id: "epl-2026-brighton-and-hove-albion-aston-villa",
    date: "2026-08-23",
    kickoff: "14:00 UK",
    home: "Brighton & Hove Albion",
    away: "Aston Villa",
    broadcaster: "Sky Sports",
    homeRating: 80,
    awayRating: 82
  },
  {
    id: "epl-2026-manchester-city-afc-bournemouth",
    date: "2026-08-23",
    kickoff: "14:00 UK",
    home: "Manchester City",
    away: "AFC Bournemouth",
    broadcaster: "Sky Sports",
    homeRating: 94,
    awayRating: 79
  },
  {
    id: "epl-2026-newcastle-united-liverpool",
    date: "2026-08-23",
    kickoff: "16:30 UK",
    home: "Newcastle United",
    away: "Liverpool",
    broadcaster: "Sky Sports",
    homeRating: 84,
    awayRating: 92
  },
  {
    id: "epl-2026-fulham-chelsea",
    date: "2026-08-24",
    kickoff: "20:00 UK",
    home: "Fulham",
    away: "Chelsea",
    broadcaster: "Sky Sports",
    homeRating: 78,
    awayRating: 86
  }
];

export function getEpl2026OpeningFixturesForDate(date: string): DecisionEpl2026OpeningFixture[] {
  return EPL_2026_OPENING_WINDOW.filter((fixture) => fixture.date === date);
}
