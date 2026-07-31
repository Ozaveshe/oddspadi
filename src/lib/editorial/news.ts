import { getSupabasePublicReadClient, publicReadAbortSignal } from "@/lib/supabase/publicReadClient";
import type { EditorialClaim } from "@/lib/editorial/publicationClaims";

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
  /** Ledger rows behind any record claim; re-verified when the story renders. */
  claim?: EditorialClaim;
};

/**
 * Claims arrive as free-form JSON from the store, so they are validated before
 * a page is allowed to act on them. A malformed claim is dropped rather than
 * partially trusted — a half-read claim would verify against the wrong set.
 */
function parseClaim(value: unknown): EditorialClaim | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const ids = Array.isArray(candidate.publicationIds)
    ? candidate.publicationIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const numbers = ["statedWins", "statedLosses", "statedGraded"] as const;
  if (!ids.length || numbers.some((key) => typeof candidate[key] !== "number")) return undefined;
  return {
    statedWins: candidate.statedWins as number,
    statedLosses: candidate.statedLosses as number,
    statedGraded: candidate.statedGraded as number,
    publicationIds: ids
  };
}

export const newsStories: NewsStory[] = [
  {
    slug: "uefa-qualifying-july-22-matchday-desk",
    title: "UEFA qualifying July 22: the evidence desk",
    excerpt: "Three Champions League and six Conference League first legs are stored; all nine fresh summaries need data, with no canonical public pick.",
    category: "Matchday briefing",
    sport: "Football",
    publishedAt: "2026-07-22",
    sourceAsOf: "2026-07-22T08:28:31.260965Z",
    revision: 1,
    readMinutes: 5,
    body: [
      "UEFA's official schedule lists three Champions League second-qualifying-round first legs on Wednesday, July 22: Omonia v Kairat Almaty at 19:00, Levski Sofia v Universitatea Craiova at 19:30 and Egnatia v Celje at 21:00. OddsPadi's provider rows resolve those kickoffs to 17:00, 17:30 and 19:00 UTC respectively, and the return legs are scheduled for July 28 or 29.",
      "The official Conference League schedule adds six July 22 first legs: Neftchi v Dinamo-Minsk, Bohemians v Ballkani, Basaksehir v Inter Turku, Vardar v Riga, Spartak Trnava v CSKA 1948 and Zeleznicar Pancevo v Braga. All six appear in the fresh stored slate alongside the three Champions League ties.",
      "A read-only OddsPadi database check at 08:28:31 UTC found 10 provider rows for those nine ties because Omonia-Kairat appears once from API-Football and once from The Odds API. The nine fresh API-Football summaries were all needs-data records because bookmaker odds were missing; the older duplicate was an expired watchlist. The 57 underlying market analyses were internal-only, split between 29 no-clear-value avoids and 28 watchlists. No checked fixture had an attached outcome, and the canonical public-pick ledger remained empty.",
      "UEFA says the Champions League winners advance to the third qualifying round while the defeated sides move into Europa League qualifying; Conference League winners also advance to their third qualifying round. This desk therefore confirms the slate and competition stakes without making a selection or inventing lineup, injury or late-team-news claims."
    ],
    sources: [
      { label: "UEFA Champions League qualifying fixtures and format", url: "https://www.uefa.com/uefachampionsleague/accesslist/", checkedAt: "2026-07-22" },
      { label: "UEFA Conference League qualifying fixtures and format", url: "https://www.uefa.com/uefaconferenceleague/news/02a6-20e5e911587f-cc10425958b3-1000--conference-league-qualifying-fixtures-results-dates-how-it-/", checkedAt: "2026-07-22" },
      { label: "UEFA 2026 competition calendar", url: "https://www.uefa.com/news-media/news/02a0-1f71bdf70a9a-b6067bd647f2-1000--2026-european-football-calendar-match-and-draw-dates-for-a/", checkedAt: "2026-07-22" },
      { label: "OddsPadi current predictions", url: "/predictions", checkedAt: "2026-07-22" }
    ]
  },
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
    slug: "spain-argentina-world-cup-final-matchday-desk",
    title: "Spain v Argentina World Cup final: the evidence desk",
    excerpt: "The 104th and final match kicks off at 19:00 UTC; OddsPadi has two matching provider rows, but no canonical public pick or outcome at its check.",
    category: "Matchday briefing",
    sport: "Football",
    publishedAt: "2026-07-19",
    sourceAsOf: "2026-07-19T06:36:19.178934Z",
    revision: 1,
    readMinutes: 4,
    body: [
      "Spain face Argentina in the FIFA World Cup final at New York New Jersey Stadium on Sunday, July 19. FIFA lists kickoff at 3:00 p.m. New York time (19:00 UTC), with the European champions meeting the defending world and South American champions in the 104th and final match of the tournament.",
      "A read-only OddsPadi database check completed at 06:36:19 UTC found two provider records for the same final: API-Football and The Odds API both listed Spain v Argentina at 19:00 UTC. The newer provider record had been synchronized at 06:26:47 UTC and generated a watchlist summary at 06:27:30 UTC; neither record had a published pick, attached outcome or canonical public-pick row.",
      "That distinction matters on a final. A stored fixture and market watchlist are not a recommendation, and paper-only outcome projections are not public picks. This desk therefore confirms the matchup and timing, but makes no model selection and does not infer lineups, injuries or late team news that were not present in the checked evidence."
    ],
    sources: [
      { label: "FIFA World Cup 2026 final: all you need to know", url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/final-live-watch-teams-tickets", checkedAt: "2026-07-19" },
      { label: "Official FIFA Spain v Argentina match preview", url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/spain-v-argentina-live-stream-team-news-tickets-and-more", checkedAt: "2026-07-19" },
      { label: "OddsPadi current predictions", url: "/predictions", checkedAt: "2026-07-19" }
    ]
  },
  {
    slug: "basketball-summer-league-matchday-watchlist",
    title: "NBA Summer League July 19 championship desk",
    excerpt: "Memphis-Golden State is stored for the 6:00 p.m. Las Vegas championship slot; the three checked matchups remain watchlist-only with no public pick.",
    category: "Matchday briefing",
    sport: "Basketball",
    publishedAt: "2026-07-12",
    updatedAt: "2026-07-19",
    sourceAsOf: "2026-07-19T06:36:45.442173Z",
    revision: 9,
    readMinutes: 4,
    body: [
      "The official NBA schedule closes the Las Vegas event on Sunday, July 19 with three Thomas & Mack Center slots at 1:30, 3:30 and 6:00 p.m. local time, with the last designated as the championship. OddsPadi storage maps the earlier slots to Oklahoma City-Brooklyn and Toronto-Denver, and identifies Memphis-Golden State in the final slot at 01:00 UTC on Monday.",
      "An exact, read-only database check at 06:36:45 UTC found five provider rows for the Las Vegas local date, representing those three matchups rather than five separate games. Oklahoma City-Brooklyn and Toronto-Denver each appeared once from API-Basketball and once from The Odds API; Memphis-Golden State appeared in the fresher odds-provider slate. The latest provider synchronization was 06:27:04 UTC.",
      "Every checked matchup remained watchlist-only. None had a published decision, attached prediction outcome or canonical public pick, and the two older API-Basketball summaries had already expired by the check. This desk therefore confirms the schedule and duplicate-provider shape without promoting a selection or treating a paper-only projection as a public result."
    ],
    sources: [
      { label: "Official NBA Summer League schedule PDF", url: "https://cdn.nba.com/teams/uploads/sites/1610612759/2026/07/2026-NBA-Summer-League-Schedule-6.26.26.pdf", checkedAt: "2026-07-19" },
      { label: "Official NBA Summer League dates and championship format", url: "https://www.nba.com/news/2026-nba-summer-league-what-to-watch-key-dates", checkedAt: "2026-07-19" },
      { label: "NBA Summer League semifinal field", url: "https://www.nba.com/news/starting-5-july-17-2026", checkedAt: "2026-07-19" },
      { label: "OddsPadi current predictions", url: "/predictions", checkedAt: "2026-07-19" }
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

type EditorialStoryRow = { slug: string; generator: string; data_fingerprint: string; title: string; excerpt: string; category: string; sport: string; published_at: string; updated_at: string; source_as_of: string; revision: number; read_minutes: number; body: unknown; sources: unknown; claim: unknown };
export function isSafeGeneratedEditorialFingerprint(value: string): boolean {
  return value.startsWith("canonical-v1-") || value.startsWith("fixture-desk-fnv1a-");
}
function generatedStory(row: EditorialStoryRow): NewsStory | null {
  if (!isSafeGeneratedEditorialFingerprint(row.data_fingerprint)) return null;
  if (!Array.isArray(row.body) || !row.body.every((item) => typeof item === "string")) return null;
  const sources = Array.isArray(row.sources) ? row.sources.filter((item): item is { label: string; url: string; checkedAt: string } => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" && typeof (item as Record<string, unknown>).url === "string" && typeof (item as Record<string, unknown>).checkedAt === "string") : [];
  return { slug: row.slug, title: row.title, excerpt: row.excerpt, category: row.category, sport: row.sport, publishedAt: row.published_at, updatedAt: row.updated_at, sourceAsOf: row.source_as_of, revision: row.revision, readMinutes: row.read_minutes, body: row.body, sources, claim: parseClaim(row.claim) };
}

export async function getNewsStories(): Promise<NewsStory[]> {
  const db = getSupabasePublicReadClient();
  if (!db) return newsStories;
  const { data, error } = await db.from("op_editorial_stories").select("slug,generator,data_fingerprint,title,excerpt,category,sport,published_at,updated_at,source_as_of,revision,read_minutes,body,sources,claim").order("published_at", { ascending: false }).limit(100).abortSignal(publicReadAbortSignal());
  if (error) return newsStories;
  const generated = (data as EditorialStoryRow[] ?? []).map(generatedStory).filter((story): story is NewsStory => Boolean(story));
  const generatedSlugs = new Set(generated.map((story) => story.slug));
  return [...generated, ...newsStories.filter((story) => !generatedSlugs.has(story.slug))];
}

export async function getNewsStory(slug: string): Promise<NewsStory | null> {
  const stories = await getNewsStories();
  return stories.find((story) => story.slug === slug) ?? getFallbackNewsStory(slug);
}
