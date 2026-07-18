import type { Metadata } from "next";
import Link from "next/link";
import { CommunityFeed, type CommunityPost } from "@/components/community/CommunityFeed";
import { FeedComposer, type ComposerMatch } from "@/components/community/FeedComposer";
import { TipsterLeaderboard, type TipsterLeaderboardRow } from "@/components/community/TipsterLeaderboard";
import { getCachedPredictionsPageData } from "@/lib/sports/prediction/cachedPublicReads";
import { todayIsoDate } from "@/lib/sports/service";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Community feed", description: "What football fans are saying on OddsPadi — reads, reactions and matchday talk.", alternates: { canonical: "/community" } };
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
  let matches: ComposerMatch[] = [];
  try {
    const { rows } = await getCachedPredictionsPageData(todayIsoDate(), "football");
    matches = rows.slice(0, 30).map(({ match }) => ({ id: match.id, label: `${match.homeTeam.name} vs ${match.awayTeam.name}`, kickoff: match.kickoffTime }));
  } catch { matches = []; }

  return <main id="main" className="container">
    <div className="page-heading"><span className="section-kicker">Community</span><h1>The <span className="accent">padi</span> feed</h1><p>Fan takes and matchday talk. These are community opinions — not OddsPadi analysis.</p></div>
    <TipsterLeaderboard rows={leaderboard} />
    {!supabase ? <div className="notice">The community feed isn&apos;t switched on for this environment yet.</div> : user ? <FeedComposer matches={matches} initialMatchId={params.match ?? ""} initialBody={params.prompt ?? ""} /> : <div className="notice"><Link className="inline-link" href="/account">Sign in</Link> to post to the feed.</div>}
    <section className="section" style={{ paddingTop: 20 }}><CommunityFeed initialPosts={posts} initialCursor={nextCursor} userId={user?.id ?? null} matches={matches} /></section>
  </main>;
}
