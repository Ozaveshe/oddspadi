import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyForm } from "@/components/community/ForumComposers";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ category: string; thread: string }> };

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ThreadPage({ params }: PageProps) {
  const { category: slug, thread: threadId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase || !UUID.test(threadId)) notFound();

  const { data: thread } = await supabase
    .from("op_forum_threads")
    .select("id, title, body, is_locked, created_at, author:op_profiles(username)")
    .eq("id", threadId)
    .maybeSingle<ThreadRow>();
  if (!thread) notFound();

  const [{ data: repliesData }, userResult] = await Promise.all([
    supabase
      .from("op_forum_replies")
      .select("id, body, created_at, author:op_profiles(username)")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase.auth.getUser()
  ]);
  const replies = (repliesData as Reply[] | null) ?? [];
  const user = userResult.data.user;

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href={`/forums/${slug}`}>
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
