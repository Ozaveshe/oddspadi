import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string }> };
export const metadata: Metadata = { title: "Community profile", robots: { index: false, follow: true } };

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  favourite_team: string | null;
  avatar_url: string | null;
};

type Performance = {
  published_tips: number | string;
  settled_tips: number | string;
  wins: number | string;
  losses: number | string;
  pushes: number | string;
  voids: number | string;
  net_units: number | string;
  yield_percent: number | string;
};

type Tip = {
  id: string;
  fixture_id: string;
  home_team: string;
  away_team: string;
  market: string;
  selection_label: string;
  tipped_odds: number | string;
  stake_units: number | string;
  rationale: string;
  published_at: string;
  revisions: Array<{ revision_kind: string; reason: string; created_at: string }> | null;
  settlement: { result: string; net_units: number | string; settled_at: string } | Array<{ result: string; net_units: number | string; settled_at: string }> | null;
};

function number(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function marketLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function CommunityProfilePage({ params }: Props) {
  const handle = decodeURIComponent((await params).handle);
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();

  const { data: profileData } = await supabase
    .from("op_profiles")
    .select("id,username,display_name,bio,favourite_team,avatar_url")
    .eq("username", handle)
    .maybeSingle<Profile>();
  if (!profileData) notFound();
  const profile = profileData;

  const [{ data: posts }, { data: performanceData }, { data: tipsData }] = await Promise.all([
    supabase.from("op_feed_posts").select("id,body,match_id,created_at").eq("author_id", profile.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("op_public_tipster_performance").select("published_tips,settled_tips,wins,losses,pushes,voids,net_units,yield_percent").eq("author_id", profile.id).maybeSingle<Performance>(),
    supabase.from("op_community_tips").select("id,fixture_id,home_team,away_team,market,selection_label,tipped_odds,stake_units,rationale,published_at,revisions:op_community_tip_revisions(revision_kind,reason,created_at),settlement:op_community_tip_settlements(result,net_units,settled_at)").eq("author_id", profile.id).order("published_at", { ascending: false }).limit(20)
  ]);

  const performance = performanceData ?? null;
  const tips = (tipsData as Tip[] | null) ?? [];
  const wins = number(performance?.wins);
  const losses = number(performance?.losses);
  const decided = wins + losses;
  const hitRate = decided > 0 ? (wins / decided) * 100 : null;
  const netUnits = number(performance?.net_units);

  return (
    <main id="main" className="container community-profile-page">
      <div className="page-heading community-profile-heading">
        <span className="section-kicker">Community tipster</span>
        <h1>{profile.display_name || `@${profile.username}`}</h1>
        <p>@{profile.username}{profile.favourite_team ? ` · Supports ${profile.favourite_team}` : ""}</p>
      </div>

      <section className="community-profile-identity" aria-label="Community profile and tip record">
        <article className="community-profile-about">
          <span>About this padi</span>
          <p>{profile.bio || "This padi has not added a bio yet."}</p>
          <small>Posts and tips are community opinions. They are not OddsPadi analysis.</small>
        </article>
        <article className="community-record-card">
          <header><div><span>Settled community record</span><h2>{number(performance?.settled_tips)} graded tips</h2></div><strong className={netUnits >= 0 ? "positive" : "negative"}>{netUnits >= 0 ? "+" : ""}{netUnits.toFixed(2)}u</strong></header>
          <dl>
            <div><dt>Published</dt><dd>{number(performance?.published_tips)}</dd></div>
            <div><dt>W–L</dt><dd>{wins}–{losses}</dd></div>
            <div><dt>Hit rate</dt><dd>{hitRate === null ? "—" : `${hitRate.toFixed(1)}%`}</dd></div>
            <div><dt>Yield</dt><dd>{number(performance?.settled_tips) ? `${number(performance?.yield_percent).toFixed(1)}%` : "—"}</dd></div>
          </dl>
          <p>Only immutable, settled community tips count here. Pending picks and feed posts do not improve the record.</p>
        </article>
      </section>

      <section className="section community-profile-tips">
        <div className="section-title"><div><span className="section-kicker">Accountable notebook</span><h2>Published tips</h2></div><span className="badge scheduled">{tips.length}</span></div>
        {tips.length ? <div className="community-profile-tip-list">{tips.map((tip) => {
          const settlement = relation(tip.settlement);
          const withdrawn = tip.revisions?.some((revision) => revision.revision_kind === "withdrawal") ?? false;
          const units = settlement ? number(settlement.net_units) : null;
          return <article className={`community-profile-tip ${withdrawn ? "withdrawn" : ""}`} key={tip.id}>
            <header><div><span>{marketLabel(tip.market)}</span><h3>{tip.selection_label}</h3></div><strong>{number(tip.tipped_odds).toFixed(2)}</strong></header>
            <Link href={`/predictions/${encodeURIComponent(tip.fixture_id)}`}>{tip.home_team} vs {tip.away_team}</Link>
            <p>{tip.rationale}</p>
            <footer><time dateTime={tip.published_at}>{new Date(tip.published_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</time><span>{number(tip.stake_units).toFixed(1)}u risked</span><b className={units === null ? "pending" : units >= 0 ? "positive" : "negative"}>{withdrawn ? "Withdrawn" : settlement ? `${settlement.result} · ${units! >= 0 ? "+" : ""}${units!.toFixed(2)}u` : "Pending"}</b></footer>
          </article>;
        })}</div> : <div className="community-empty-compact"><strong>No published tips yet</strong><p>This profile has no immutable community-tip record.</p></div>}
      </section>

      <section className="section">
        <div className="section-title"><div><span className="section-kicker">Matchday conversation</span><h2>Recent posts</h2></div></div>
        {(posts ?? []).length ? <div className="feed-list">{(posts ?? []).map((post) => <article className="panel feed-post" key={post.id}><p>{post.body}</p>{post.match_id ? <Link className="community-match-chip" href={`/predictions/${encodeURIComponent(post.match_id)}`}>Match discussion</Link> : null}</article>)}</div> : <div className="community-empty-compact"><strong>No feed posts yet</strong><p>Published tips remain separate from casual matchday conversation.</p></div>}
      </section>
    </main>
  );
}
