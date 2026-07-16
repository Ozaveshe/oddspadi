import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewThreadForm } from "@/components/community/ForumComposers";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { serializeJsonLd } from "@/lib/security/jsonLd";

export const dynamic = "force-dynamic";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

type PageProps = { params: Promise<{ category: string }>; searchParams?: Promise<{ cursor?: string }> };

type Category = { id: string; name: string; description: string | null };
type AuthorRaw = { username?: string | null };
type Thread = {
  id: string;
  title: string;
  reply_count: number;
  last_activity_at: string;
  is_pinned: boolean;
  author: AuthorRaw | AuthorRaw[] | null;
};

function authorName(author: Thread["author"]): string {
  const a = Array.isArray(author) ? author[0] : author;
  return a?.username ?? "padi";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: slug } = await params;
  const fallback: Metadata = { title: "Forum category", alternates: { canonical: `/forums/${slug}` } };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return fallback;
  const { data } = await supabase
    .from("op_forum_categories")
    .select("name, description")
    .eq("slug", slug)
    .maybeSingle<{ name: string; description: string | null }>();
  if (!data) return fallback;
  const description = data.description ?? `Threads, predictions debate and match talk in ${data.name} on the OddsPadi forums.`;
  return {
    title: data.name,
    description,
    alternates: { canonical: `/forums/${slug}` },
    openGraph: { title: `${data.name} — OddsPadi Forums`, description }
  };
}

export default async function ForumCategoryPage({ params, searchParams }: PageProps) {
  const { category: slug } = await params;
  const cursor = (await searchParams)?.cursor;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return (
      <main id="main" className="container">
        <div className="notice">The forums aren’t switched on for this environment yet.</div>
      </main>
    );
  }

  const { data: category } = await supabase
    .from("op_forum_categories")
    .select("id, name, description")
    .eq("slug", slug)
    .maybeSingle<Category>();
  if (!category) notFound();

  let threadQuery = supabase
      .from("op_forum_threads")
      .select("id, title, reply_count, last_activity_at, is_pinned, author:op_profiles!op_forum_threads_author_id_fkey(username)")
      .eq("category_id", category.id)
      .order("is_pinned", { ascending: false })
      .order("last_activity_at", { ascending: false }).limit(21);
  if (cursor) threadQuery = threadQuery.lt("last_activity_at", cursor);
  const [{ data: threadsData }, userResult] = await Promise.all([
    threadQuery,
    supabase.auth.getUser()
  ]);
  const threadRows = (threadsData as Thread[] | null) ?? [];
  const threads = threadRows.slice(0, 20);
  const nextCursor = threadRows.length > 20 ? threads[19]?.last_activity_at : null;
  const user = userResult.data.user;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Forums", item: `${siteUrl}/forums` },
      { "@type": "ListItem", position: 3, name: category.name, item: `${siteUrl}/forums/${slug}` }
    ]
  };

  return (
    <main id="main" className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href="/forums">
            ← Forums
          </Link>
        </div>
        <h1>{category.name}</h1>
        {category.description ? <p>{category.description}</p> : null}
      </div>

      {user ? (
        <NewThreadForm categoryId={category.id} />
      ) : (
        <div className="notice">
          <Link className="inline-link" href="/account">
            Sign in
          </Link>{" "}
          to start a thread.
        </div>
      )}

      <section className="section" style={{ paddingTop: 20 }}>
        {threads.length ? (
          <><div className="forum-list">
            {threads.map((thread) => (
              <Link className="forum-row" key={thread.id} href={`/forums/${slug}/${thread.id}`}>
                <span>
                  <strong style={{ display: "block", fontSize: 15.5 }}>
                    {thread.is_pinned ? "📌 " : ""}
                    {thread.title}
                  </strong>
                  <span className="muted small">by @{authorName(thread.author)}</span>
                </span>
                <span className="forum-meta">{thread.reply_count} repl{thread.reply_count === 1 ? "y" : "ies"}</span>
              </Link>
            ))}
          </div>{nextCursor ? <Link className="button secondary community-load-more" href={`/forums/${slug}?cursor=${encodeURIComponent(nextCursor)}`}>Load more</Link> : null}</>
        ) : (
          <div className="empty-state">
            <div className="empty-emoji" aria-hidden="true">
              💬
            </div>
            <h2>No threads yet</h2>
            <p className="muted">Start the first conversation in {category.name}.</p>
          </div>
        )}
      </section>
    </main>
  );
}
