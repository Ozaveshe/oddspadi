import type { Metadata } from "next";
import Link from "next/link";
import { FeedComposer } from "@/components/community/FeedComposer";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community feed",
  description: "What football fans are saying on OddsPadi — reads, reactions and matchday talk."
};

type FeedAuthorRaw = { username?: string | null; display_name?: string | null };
type FeedPost = {
  id: string;
  body: string;
  match_id: string | null;
  created_at: string;
  author: FeedAuthorRaw | FeedAuthorRaw[] | null;
};

function authorOf(post: FeedPost): FeedAuthorRaw | null {
  return Array.isArray(post.author) ? (post.author[0] ?? null) : post.author;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

export default async function CommunityPage() {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  let posts: FeedPost[] = [];
  if (supabase) {
    try {
      const { data } = await supabase
        .from("op_feed_posts")
        .select("id, body, match_id, created_at, author:op_profiles(username, display_name)")
        .order("created_at", { ascending: false })
        .limit(50);
      posts = (data as FeedPost[] | null) ?? [];
    } catch {
      posts = [];
    }
  }

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Community</span>
        <h1>
          The <span className="accent">padi</span> feed
        </h1>
        <p>Fan takes and matchday talk. These are community opinions — not OddsPadi analysis.</p>
      </div>

      {!supabase ? (
        <div className="notice">The community feed isn’t switched on for this environment yet.</div>
      ) : user ? (
        <FeedComposer />
      ) : (
        <div className="notice">
          <Link className="inline-link" href="/account">
            Sign in
          </Link>{" "}
          to post to the feed.
        </div>
      )}

      <section className="section" style={{ paddingTop: 20 }}>
        {posts.length ? (
          <div className="feed-list">
            {posts.map((post) => {
              const author = authorOf(post);
              return (
                <article className="panel feed-post" key={post.id}>
                  <div className="feed-post-head">
                    <strong>@{author?.username ?? "padi"}</strong>
                    {author?.display_name ? <span className="muted small">{author.display_name}</span> : null}
                    <span className="muted small" style={{ marginLeft: "auto" }}>
                      {timeAgo(post.created_at)}
                    </span>
                  </div>
                  <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{post.body}</p>
                  {post.match_id ? (
                    <Link className="inline-link small" href={`/predictions/${post.match_id}`} style={{ marginTop: 8, display: "inline-block" }}>
                      View the match analysis →
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-emoji" aria-hidden="true">
              💬
            </div>
            <h2>No posts yet</h2>
            <p className="muted">Be the first to share your read on today’s matches.</p>
          </div>
        )}
      </section>
    </main>
  );
}
