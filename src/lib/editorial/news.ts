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
    title: "NBA Summer League July 18 semifinal desk",
    excerpt: "Rockets-Grizzlies tip at 6:30 p.m. ET and Warriors-Lakers at 8:30; OddsPadi found no Las Vegas July 18 rows, outcomes or public picks at its check.",
    category: "Matchday briefing",
    sport: "Basketball",
    publishedAt: "2026-07-12",
    updatedAt: "2026-07-18",
    sourceAsOf: "2026-07-18T06:40:12.107148Z",
    revision: 8,
    readMinutes: 4,
    body: [
      "The NBA's semifinal field is set for Saturday, July 18. Houston faces Memphis at 6:30 p.m. ET (22:30 UTC), followed by Golden State against the Los Angeles Lakers at 8:30 p.m. ET (00:30 UTC Sunday); both games are at Thomas & Mack Center on Prime Video. The Lakers finished pool play as the only unbeaten team, while the Rockets, Grizzlies and Warriors completed the four-team field.",
      "The published format advances the top four records after each team's first four games into a single-elimination semifinal round, with the winners meeting in the July 19 championship. The official July 18 schedule contains seven slots: five consolation games around the two-game semifinal doubleheader.",
      "An exact, read-only OddsPadi database check completed on July 18 at 06:40:12 UTC found 91 fixtures in the UTC day but no NBA Summer League fixture whose Las Vegas local date was July 18. The 90 current fixture summaries were 88 needs-data records and two expired watchlists; no prediction outcome or canonical public pick was attached to the checked window. This desk therefore makes no model pick and does not relabel the previous night's consolation rows as Saturday evidence."
    ],
    sources: [
      { label: "NBA Summer League semifinal field and matchups", url: "https://www.nba.com/news/starting-5-july-17-2026", checkedAt: "2026-07-18" },
      { label: "Official NBA Day 8 recap", url: "https://www.nba.com/news/live-updates-2026-nba-summer-league-day-8", checkedAt: "2026-07-18" },
      { label: "Official NBA Summer League schedule PDF", url: "https://cdn.nba.com/teams/uploads/sites/1610612759/2026/07/2026-NBA-Summer-League-Schedule-6.26.26.pdf", checkedAt: "2026-07-18" },
      { label: "Official 2026 Summer League format and tiebreakers", url: "https://www.nba.com/news/2026-summer-league-format", checkedAt: "2026-07-18" },
      { label: "OddsPadi current predictions", url: "/predictions", checkedAt: "2026-07-18" }
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
].sort((left, right) => Date.parse(right.updatedAt ?? right.publishedAt) - Date.parse(left.updatedAt ?? left.publishedAt));

export function getFallbackNewsStory(slug: string) {
  return newsStories.find((story) => story.slug === slug) ?? null;
}

type EditorialStoryRow = { slug: string; generator: string; data_fingerprint: string; title: string; excerpt: string; category: string; sport: string; published_at: string; updated_at: string; source_as_of: string; revision: number; read_minutes: number; body: unknown; sources: unknown };
export function isSafeGeneratedEditorialFingerprint(value: string): boolean {
  return value.startsWith("canonical-v1-") || value.startsWith("fixture-desk-fnv1a-");
}
function generatedStory(row: EditorialStoryRow): NewsStory | null {
  if (!isSafeGeneratedEditorialFingerprint(row.data_fingerprint)) return null;
  if (!Array.isArray(row.body) || !row.body.every((item) => typeof item === "string")) return null;
  const sources = Array.isArray(row.sources) ? row.sources.filter((item): item is { label: string; url: string; checkedAt: string } => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" && typeof (item as Record<string, unknown>).url === "string" && typeof (item as Record<string, unknown>).checkedAt === "string") : [];
  return { slug: row.slug, title: row.title, excerpt: row.excerpt, category: row.category, sport: row.sport, publishedAt: row.published_at, updatedAt: row.updated_at, sourceAsOf: row.source_as_of, revision: row.revision, readMinutes: row.read_minutes, body: row.body, sources };
}

export async function getNewsStories(): Promise<NewsStory[]> {
  const db = getSupabasePublicReadClient();
  if (!db) return newsStories;
  const { data, error } = await db.from("op_editorial_stories").select("slug,generator,data_fingerprint,title,excerpt,category,sport,published_at,updated_at,source_as_of,revision,read_minutes,body,sources").order("published_at", { ascending: false }).limit(100).abortSignal(publicReadAbortSignal());
  if (error) return newsStories;
  const generated = (data as EditorialStoryRow[] ?? []).map(generatedStory).filter((story): story is NewsStory => Boolean(story));
  const generatedSlugs = new Set(generated.map((story) => story.slug));
  return [...generated, ...newsStories.filter((story) => !generatedSlugs.has(story.slug))];
}

export async function getNewsStory(slug: string): Promise<NewsStory | null> {
  const stories = await getNewsStories();
  return stories.find((story) => story.slug === slug) ?? getFallbackNewsStory(slug);
}
