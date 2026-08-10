import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { ModerationQueue } from "@/components/community/ModerationQueue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Moderation queue",
  description: "Open community reports, reviewed by OddsPadi moderators with a full audit trail.",
  path: "/community/moderation",
  noIndex: true
});

export default async function ModerationPage() {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  let isModerator = false;
  if (supabase && user) {
    const { data: profile } = await supabase.from("op_profiles").select("is_admin").eq("id", user.id).maybeSingle();
    isModerator = Boolean(profile?.is_admin);
  }
  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Community</span>
        <h1>Moderation queue</h1>
        <p>Reports from the community, reviewed by OddsPadi staff. Every action writes one audit-log row.</p>
      </div>
      {isModerator ? (
        <ModerationQueue />
      ) : (
        <div className="notice">
          Moderator access required. If a moderation decision affected your content, you can appeal it — appeals are
          reviewed by a moderator who did not take the original action.
        </div>
      )}
    </main>
  );
}
