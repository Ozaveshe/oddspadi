import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { CommunityBody } from "@/components/community/CommunityBody";
import { AccountBadge } from "@/components/community/AccountBadge";
import { RelativeTime } from "@/components/community/RelativeTime";
import { subjectHref, type CommunitySubjectType } from "@/lib/community/subjects";

type SubjectPost = {
  id: string;
  body: string;
  created_at: string;
  author: { username?: string | null; display_name?: string | null; account_type?: string | null } | Array<{
    username?: string | null;
    display_name?: string | null;
    account_type?: string | null;
  }> | null;
};

function author(post: SubjectPost) {
  return Array.isArray(post.author) ? post.author[0] : post.author;
}

/**
 * Contextual community module: the most recent on-subject conversation for a
 * real sports entity, with an honest empty state — never seeded filler.
 */
export async function CommunitySubjectPanel({
  subjectType,
  subjectId,
  title
}: {
  subjectType: CommunitySubjectType;
  subjectId: string;
  title: string;
}) {
  const supabase = await createSupabaseServerClient();
  let posts: SubjectPost[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("op_feed_posts")
      .select(
        "id, body, created_at, author:op_profiles!op_feed_posts_author_id_fkey(username, display_name, account_type)"
      )
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(5);
    posts = (data as SubjectPost[] | null) ?? [];
  }
  const composeHref = subjectHref(subjectType, subjectId);
  return (
    <section className="section community-subject-panel" aria-label={`Community discussion: ${title}`}>
      <div className="section-title">
        <div>
          <span className="section-kicker">Community</span>
          <h2>{title}</h2>
        </div>
        <Link className="button secondary" href={composeHref}>
          Join the discussion
        </Link>
      </div>
      {posts.length ? (
        <div className="feed-list">
          {posts.map((post) => {
            const profile = author(post);
            const handle = profile?.username ?? "padi";
            return (
              <article className="panel feed-post" key={post.id}>
                <div className="feed-post-head">
                  <Link href={`/community/u/${encodeURIComponent(handle)}`}>
                    <strong>@{handle}</strong>
                  </Link>
                  <AccountBadge accountType={profile?.account_type} />
                  <span className="muted small" style={{ marginLeft: "auto" }}>
                    <RelativeTime iso={post.created_at} />
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <CommunityBody text={post.body} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="community-empty-compact">
          <strong>No discussion yet</strong>
          <p>
            Nothing has been posted about this yet — an honest quiet beats artificial chatter.{" "}
            <Link className="inline-link" href={composeHref}>
              Start the thread
            </Link>
            .
          </p>
        </div>
      )}
    </section>
  );
}
