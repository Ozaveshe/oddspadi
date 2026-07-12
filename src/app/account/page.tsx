import type { Metadata } from "next";
import Link from "next/link";
import { AuthPanel } from "@/components/community/AuthPanel";
import { SignOutButton } from "@/components/community/SignOutButton";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  description: "Sign in to join the OddsPadi community — post to the feed and the forums.",
  robots: { index: false, follow: true }
};

async function loadProfile(userId: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("op_profiles")
      .select("username, display_name, favourite_team, bio")
      .eq("id", userId)
      .maybeSingle();
    return data;
  } catch {
    return null;
  }
}

export default async function AccountPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main id="main" className="container">
        <div className="page-heading">
          <span className="section-kicker">Community</span>
          <h1>
            Join your <span className="accent">football padi</span> crew
          </h1>
          <p>Sign in to post to the community feed, start forum threads, and follow the conversation on matchday.</p>
        </div>
        <div style={{ maxWidth: 460 }}>
          <AuthPanel />
        </div>
      </main>
    );
  }

  const profile = await loadProfile(user.id);
  const handle = profile?.username ?? user.email?.split("@")[0] ?? "padi";

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Your account</span>
        <h1>@{handle}</h1>
        <p>{profile?.display_name ?? user.email}</p>
      </div>

      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="metrics-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="metric">
            <span className="metric-label">Handle</span>
            <span className="metric-value">@{handle}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Favourite team</span>
            <span className="metric-value">{profile?.favourite_team ?? "Not set"}</span>
          </div>
        </div>
        {profile?.bio ? <p className="muted" style={{ marginTop: 14 }}>{profile.bio}</p> : null}
        <div className="card-actions" style={{ marginTop: 18 }}>
          <Link className="button primary" href="/community">
            Go to the feed
          </Link>
          <Link className="button" href="/forums">
            Forums
          </Link>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
