import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ handle: string }> };
export const metadata: Metadata = { title: "Community profile", robots: { index: false, follow: true } };

export default async function CommunityProfilePage({ params }: Props) {
  const handle = decodeURIComponent((await params).handle);
  const supabase = await createSupabaseServerClient(); if (!supabase) notFound();
  const { data: profile } = await supabase.from("op_profiles").select("id,username,display_name,bio,favourite_team").eq("username", handle).maybeSingle<{ id: string; username: string; display_name: string | null; bio: string | null; favourite_team: string | null }>();
  if (!profile) notFound();
  const { data: posts } = await supabase.from("op_feed_posts").select("id,body,match_id,created_at").eq("author_id", profile.id).order("created_at", { ascending: false }).limit(20);
  return <main id="main" className="container"><div className="page-heading"><span className="section-kicker">Community profile</span><h1>{profile.display_name || `@${profile.username}`}</h1><p>@{profile.username}{profile.favourite_team ? ` · Supports ${profile.favourite_team}` : ""}</p></div>
    <section className="panel profile-public"><h2>About</h2><p>{profile.bio || "This padi has not added a bio yet."}</p></section>
    <section className="section"><div className="section-title"><h2>Recent posts</h2></div><div className="feed-list">{(posts ?? []).map((post) => <article className="panel feed-post" key={post.id}><p>{post.body}</p>{post.match_id ? <Link className="community-match-chip" href={`/predictions/${encodeURIComponent(post.match_id)}`}>⚽ Match discussion</Link> : null}</article>)}</div></section>
  </main>;
}
