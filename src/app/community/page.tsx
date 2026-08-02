import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Link from "next/link";
import { CommunityFeed, type CommunityPost } from "@/components/community/CommunityFeed";
import { FeedComposer, type ComposerMatch } from "@/components/community/FeedComposer";
import { TipsterLeaderboard, type TipsterLeaderboardRow } from "@/components/community/TipsterLeaderboard";
import { readProjectionList, todayScope } from "@/lib/readmodel/publicProjection";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Community feed",
  description: "What football fans are saying on OddsPadi — reads, reactions and matchday talk.",
  path: "/community",
  socialTitle: "OddsPadi community feed",
  socialDescription: "Fan reads, matchday reactions and tipster records, all in one feed."
});
type PageProps = { searchParams?: Promise<{ match?: string; prompt?: string }> };

export default async function CommunityPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  let posts: CommunityPost[] = []; let nextCursor: string | null = null;
  let leaderboard: TipsterLeaderboardRow[] = [];
  if (supabase) {
    const [{ data }, { data: leaderboardData }] = await Promise.all([
      supabase.from("op_feed_posts")
        .select("id, author_id, body, match_id, created_at, author:op_profiles!op_feed_posts_author_id_fkey(username, display_name), likes:op_feed_post_likes(user_id), comments:op_feed_comments!op_feed_comments_post_id_fkey(count)")
        .order("created_at", { ascending: false }).limit(21),
      supabase.from("op_public_tipster_leaderboard")
        .select("rank_position,author_id,username,display_name,published_tips,settled_tips,wins,losses,pushes,net_units,yield_percent,ranking_score,eligible")
        .order("eligible", { ascending: false })
        .order("ranking_score", { ascending: false })
        .limit(8)
    ]);
    const rows = (data as CommunityPost[] | null) ?? []; posts = rows.slice(0, 20); nextCursor = rows.length > 20 ? rows[19]?.created_at ?? null : null;
    leaderboard = (leaderboardData as TipsterLeaderboardRow[] | null) ?? [];
  }
  // The composer needs 30 fixture labels for a <select>. It used to get them
  // from getCachedPredictionsPageData, which fans out to live providers on a
  // cache miss — a multi-second third-party round trip on a page that is not
  // about fixtures at all. The prepared daily slate is one indexed row.
  const slate = await readProjectionList<{ fixtureId: string; homeTeam: string; awayTeam: string; kickoffAt: string }>(
    "daily_fixture_slate",
    todayScope()
  ).catch(() => null);
  const matches: ComposerMatch[] = (slate?.data ?? []).slice(0, 30).map((fixture) => ({
    id: fixture.fixtureId,
    label: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
    kickoff: fixture.kickoffAt
  }));

  return <main id="main" className="container">
    <div className="page-heading"><span className="section-kicker">Community</span><h1>The <span className="accent">padi</span> feed</h1><p>Fan takes and matchday talk. These are community opinions — not OddsPadi analysis.</p></div>
    <TipsterLeaderboard rows={leaderboard} />
    {!supabase ? <div className="notice">The community feed isn&apos;t switched on for this environment yet.</div> : user ? <FeedComposer matches={matches} initialMatchId={params.match ?? ""} initialBody={params.prompt ?? ""} /> : <div className="notice"><Link className="inline-link" href="/account">Sign in</Link> to post to the feed.</div>}
    <section className="section" style={{ paddingTop: 20 }}><CommunityFeed initialPosts={posts} initialCursor={nextCursor} userId={user?.id ?? null} matches={matches} /></section>
    {/* Member-authored tips get less scrutiny than the engine's, not more, so
        the responsible-use framing matters at least as much here. */}
    <section className="section"><ResponsibleUseNotice /></section>
  </main>;
}
