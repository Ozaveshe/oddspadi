import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyForm } from "@/components/community/ForumComposers";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { serializeJsonLd } from "@/lib/security/jsonLd";
import { isIsoTimestampCursor, isUuid } from "@/lib/security/inputValidation";
import { absoluteUrl, pageMetadata } from "@/lib/seo/pageMetadata";

export const dynamic = "force-dynamic";

/** Percent-encoded so a slug can never break out of its path segment. */
function threadPath(slug: string, threadId: string): string {
  return `/forums/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}`;
}

type PageProps = { params: Promise<{ category: string; thread: string }>; searchParams?: Promise<{ cursor?: string }> };

function prettifySlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type AuthorRaw = { username?: string | null };
type ThreadRow = {
  id: string;
  title: string;
  body: string;
  is_locked: boolean;
  created_at: string;
  author: AuthorRaw | AuthorRaw[] | null;
};
type Reply = { id: string; body: string; created_at: string; author: AuthorRaw | AuthorRaw[] | null };

function authorName(author: AuthorRaw | AuthorRaw[] | null): string {
  const a = Array.isArray(author) ? author[0] : author;
  return a?.username ?? "padi";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: slug, thread: threadId } = await params;
  const fallback: Metadata = { title: "Forum thread", robots: { index: false, follow: true } };
  const supabase = await createSupabaseServerClient();
  if (!supabase || !isUuid(threadId)) return fallback;
  const { data } = await supabase
    .from("op_forum_threads")
    .select("title, body")
    .eq("id", threadId)
    .maybeSingle<{ title: string; body: string }>();
  if (!data) return fallback;
  const description = data.body.replace(/\s+/g, " ").trim().slice(0, 155) || "A discussion on the OddsPadi forums.";
  return pageMetadata({
    title: data.title,
    description,
    path: threadPath(slug, threadId),
    type: "article",
    socialTitle: `${data.title} — OddsPadi Forums`
  });
}

export default async function ThreadPage({ params, searchParams }: PageProps) {
  const { category: slug, thread: threadId } = await params;
  const supabase = await createSupabaseServerClient();
  const cursor = (await searchParams)?.cursor;
  if (!supabase || !isUuid(threadId)) notFound();

  const { data: thread } = await supabase
    .from("op_forum_threads")
    .select("id, title, body, is_locked, created_at, author:op_profiles!op_forum_threads_author_id_fkey(username)")
    .eq("id", threadId)
    .maybeSingle<ThreadRow>();
  if (!thread) notFound();

  let replyQuery = supabase
      .from("op_forum_replies")
      .select("id, body, created_at, author:op_profiles!op_forum_replies_author_id_fkey(username)")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true }).limit(51);
  // Validated like the community API's cursor: an arbitrary query-string value
  // reached the PostgREST filter and silently emptied the reply list.
  if (cursor && isIsoTimestampCursor(cursor)) replyQuery = replyQuery.gt("created_at", cursor);
  const [{ data: repliesData }, userResult] = await Promise.all([
    replyQuery,
    supabase.auth.getUser()
  ]);
  const replyRows = (repliesData as Reply[] | null) ?? [];
  const replies = replyRows.slice(0, 50);
  const nextCursor = replyRows.length > 50 ? replies[49]?.created_at : null;
  const user = userResult.data.user;
  const threadUrl = absoluteUrl(threadPath(slug, thread.id));

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: "Forums", item: absoluteUrl("/forums") },
        { "@type": "ListItem", position: 3, name: prettifySlug(slug), item: absoluteUrl(`/forums/${encodeURIComponent(slug)}`) },
        { "@type": "ListItem", position: 4, name: thread.title, item: threadUrl }
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "DiscussionForumPosting",
      headline: thread.title,
      text: thread.body,
      datePublished: thread.created_at,
      url: threadUrl,
      author: { "@type": "Person", name: authorName(thread.author) },
      interactionStatistic: {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: replies.length
      },
      comment: replies.map((reply) => ({
        "@type": "Comment",
        text: reply.body,
        datePublished: reply.created_at,
        author: { "@type": "Person", name: authorName(reply.author) }
      }))
    }
  ];

  return (
    <main id="main" className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href={`/forums/${encodeURIComponent(slug)}`}>
            ← Back
          </Link>
        </div>
        <h1>{thread.title}</h1>
        <p className="muted small">by @{authorName(thread.author)}</p>
      </div>

      <article className="panel feed-post">
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{thread.body}</p>
      </article>

      <section className="section" style={{ paddingTop: 20 }}>
        <div className="section-title">
          <h2>
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </h2>
        </div>
        <div className="feed-list">
          {replies.map((reply) => (
            <article className="panel feed-post" key={reply.id}>
              <div className="feed-post-head">
                <strong>@{authorName(reply.author)}</strong>
              </div>
              <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{reply.body}</p>
            </article>
          ))}
        </div>
        {nextCursor ? <Link className="button secondary community-load-more" href={`/forums/${encodeURIComponent(slug)}/${encodeURIComponent(thread.id)}?cursor=${encodeURIComponent(nextCursor)}`}>Load more</Link> : null}

        <div style={{ marginTop: 18 }}>
          {thread.is_locked ? (
            <div className="notice">This thread is locked.</div>
          ) : user ? (
            <ReplyForm threadId={thread.id} />
          ) : (
            <div className="notice">
              <Link className="inline-link" href="/account">
                Sign in
              </Link>{" "}
              to reply.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
