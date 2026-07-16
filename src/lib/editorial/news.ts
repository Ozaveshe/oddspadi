import { getSupabasePublicReadClient, publicReadAbortSignal } from "@/lib/supabase/publicReadClient";

export type NewsStory = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  sport: string;
  publishedAt: string;
  updatedAt?: string;
  revision?: number;
  sourceAsOf?: string;
  readMinutes: number;
  body: string[];
  sources?: Array<{ label: string; url: string; checkedAt: string }>;
};

export const newsStories: NewsStory[] = [
  {
    slug: "how-oddspadi-reads-a-match-before-kickoff",
    title: "How OddsPadi reads a match before kickoff",
    excerpt: "A plain-language guide to form, prices, missing information, and why the engine sometimes refuses to make a pick.",
    category: "Inside the model",
    sport: "All sports",
    publishedAt: "2026-07-12",
    readMinutes: 5,
    body: [
      "A prediction should be an argument you can inspect, not a score dropped from the sky. OddsPadi starts with the fixture, recent performance and the market price, then checks whether the information is complete enough to support a public view.",
      "The model probability is only one part of that view. We compare it with the bookmaker's implied probability, account for margin, and look for a meaningful difference. A large-looking edge can still be rejected when team news, lineups or price coverage are weak.",
      "That is why ‘no clear value’ is a useful result. It means the available evidence does not justify a stronger claim. As kickoff approaches and better information arrives, the same match can move from watchlist to actionable—or remain an honest pass."
    ],
    sources: [{ label: "OddsPadi prediction methodology", url: "/predictions/decision-engine", checkedAt: "2026-07-12" }]
  },
  {
    slug: "basketball-summer-league-matchday-watchlist",
    title: "NBA Summer League July 16 desk: seven official games, four stored, no pick",
    excerpt: "The NBA lists seven Las Vegas games from 4 to 10 p.m. ET; four were present in OddsPadi's recovered store, but their stale, suspended state does not support a pick.",
    category: "Matchday briefing",
    sport: "Basketball",
    publishedAt: "2026-07-12",
    updatedAt: "2026-07-16",
    sourceAsOf: "2026-07-16T16:32:05.225873Z",
    revision: 6,
    readMinutes: 4,
    body: [
      "The NBA's official schedule lists seven Las Vegas Summer League games for Thursday, July 16: Dallas–Oklahoma City at 4 p.m. ET, Brooklyn–Houston at 4:30 p.m., LA Lakers–Chicago at 6 p.m., Golden State–New York at 7 p.m., Memphis–Atlanta at 8 p.m., Toronto–Miami at 9 p.m. and Portland–Denver at 10 p.m.",
      "This is the last day of the first-four-game stage. After each team has completed that stage, the top four records advance to the July 18 semifinals; the other 26 teams play a fifth consolation game from July 17–19, and the championship follows on July 19. The published tiebreak order starts with head-to-head for a two-team tie, then point differential and total points.",
      "An exact OddsPadi database check completed on July 16 at 16:32:05 UTC. Four of the seven official fixtures were stored: Dallas–Oklahoma City, Brooklyn–Houston, LA Lakers–Chicago and Golden State–New York. Memphis–Atlanta, Toronto–Miami and Portland–Denver were not present in the checked schedule window. The four stored rows had last synced on July 15 at 02:26:37 UTC and were marked live without scores; their latest summaries were suspended, with no current market decisions, outcomes or public picks. This desk therefore makes no model pick and does not treat the stored status as current game-state evidence."
    ],
    sources: [
      { label: "Official NBA Summer League schedule PDF", url: "https://cdn.nba.com/teams/uploads/sites/1610612759/2026/07/2026-NBA-Summer-League-Schedule-6.26.26.pdf", checkedAt: "2026-07-16" },
      { label: "Official 2026 Summer League format and tiebreakers", url: "https://www.nba.com/news/2026-summer-league-format", checkedAt: "2026-07-16" },
      { label: "OddsPadi current predictions", url: "/predictions", checkedAt: "2026-07-16" }
    ]
  },
  {
    slug: "upcoming-football-season-predictions-explained",
    title: "Upcoming season predictions: what can be said now",
    excerpt: "Squads are moving and schedules are arriving. Here is how we publish useful early outlooks without pretending they are final.",
    category: "Season outlook",
    sport: "Football",
    publishedAt: "2026-07-11",
    readMinutes: 6,
    body: [
      "Pre-season forecasts should change. Transfers, injuries, promoted teams and new managers all alter the evidence, so OddsPadi will publish season outlooks as dated snapshots rather than permanent claims.",
      "The Premier League has confirmed Coventry City, Ipswich Town and Hull City as the promoted clubs, and released all 380 fixtures. The campaign begins on 21 August with Arsenal hosting Coventry City. Those facts now anchor the first OddsPadi returning-team baseline.",
      "Match predictions begin when provider fixtures and usable prices are available. Until then, season outlooks are ranges and watchlists—not precise match tips dressed up as certainty."
    ],
    sources: [
      { label: "Premier League confirms the 2026/27 clubs", url: "https://www.premierleague.com/en/news/4673099/the-202627-premier-league-season-officially-starts/", checkedAt: "2026-07-12" },
      { label: "Official 2026/27 fixture list", url: "https://www.premierleague.com/en/news/4675097/all-380-fixtures-for-202627-premier-league-season/", checkedAt: "2026-07-12" }
    ]
  }
];

export function getFallbackNewsStory(slug: string) {
  return newsStories.find((story) => story.slug === slug) ?? null;
}

type EditorialStoryRow = { slug: string; title: string; excerpt: string; category: string; sport: string; published_at: string; updated_at: string; source_as_of: string; revision: number; read_minutes: number; body: unknown; sources: unknown };
function generatedStory(row: EditorialStoryRow): NewsStory | null {
  if (!Array.isArray(row.body) || !row.body.every((item) => typeof item === "string")) return null;
  const sources = Array.isArray(row.sources) ? row.sources.filter((item): item is { label: string; url: string; checkedAt: string } => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" && typeof (item as Record<string, unknown>).url === "string" && typeof (item as Record<string, unknown>).checkedAt === "string") : [];
  return { slug: row.slug, title: row.title, excerpt: row.excerpt, category: row.category, sport: row.sport, publishedAt: row.published_at, updatedAt: row.updated_at, sourceAsOf: row.source_as_of, revision: row.revision, readMinutes: row.read_minutes, body: row.body, sources };
}

export async function getNewsStories(): Promise<NewsStory[]> {
  const db = getSupabasePublicReadClient();
  if (!db) return newsStories;
  const { data, error } = await db.from("op_editorial_stories").select("slug,title,excerpt,category,sport,published_at,updated_at,source_as_of,revision,read_minutes,body,sources").order("published_at", { ascending: false }).limit(100).abortSignal(publicReadAbortSignal());
  if (error) return newsStories;
  const generated = (data as EditorialStoryRow[] ?? []).map(generatedStory).filter((story): story is NewsStory => Boolean(story));
  const generatedSlugs = new Set(generated.map((story) => story.slug));
  return [...generated, ...newsStories.filter((story) => !generatedSlugs.has(story.slug))];
}

export async function getNewsStory(slug: string): Promise<NewsStory | null> {
  const stories = await getNewsStories();
  return stories.find((story) => story.slug === slug) ?? getFallbackNewsStory(slug);
}
