import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forums",
  description: "OddsPadi forums — match talk, predictions debate, and league chat with fellow fans.",
  alternates: { canonical: "/forums" },
  openGraph: {
    title: "Forums — OddsPadi",
    description: "OddsPadi forums — match talk, predictions debate, and league chat with fellow fans."
  }
};

type Category = { id: string; slug: string; name: string; description: string | null };

export default async function ForumsPage() {
  const supabase = await createSupabaseServerClient();
  let categories: Category[] = [];
  if (supabase) {
    try {
      const { data } = await supabase
        .from("op_forum_categories")
        .select("id, slug, name, description")
        .order("sort_order", { ascending: true });
      categories = (data as Category[] | null) ?? [];
    } catch {
      categories = [];
    }
  }

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Community</span>
        <h1>
          The <span className="accent">forums</span>
        </h1>
        <p>Longer-form talk with fellow fans — pick a room and jump in.</p>
      </div>

      {!supabase ? (
        <div className="notice">The forums aren’t switched on for this environment yet.</div>
      ) : categories.length ? (
        <div className="forum-list">
          {categories.map((category) => (
            <Link className="forum-row" key={category.id} href={`/forums/${category.slug}`}>
              <span>
                <strong style={{ display: "block", fontSize: 16 }}>{category.name}</strong>
                {category.description ? <span className="muted small">{category.description}</span> : null}
              </span>
              <span className="inline-link" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-emoji" aria-hidden="true">
            🗣️
          </div>
          <h2>Forums are being set up</h2>
          <p className="muted">Categories will appear here shortly.</p>
        </div>
      )}
    </main>
  );
}
