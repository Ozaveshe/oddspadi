"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { trackEvent } from "@/lib/analytics/events";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      // `signOut` can fail (offline, revoked token, Supabase outage) and the
      // session then survives. Reporting that matters more than most failures:
      // silently returning to the signed-out-looking UI tells someone on a
      // shared device that they are signed out when they are not.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError("Sign-out failed — you are still signed in. Try again.");
        return;
      }
      trackEvent("account_signed_out");
      router.refresh();
    } catch {
      setError("Sign-out failed — you are still signed in. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="sign-out-control">
      <button className="button" type="button" onClick={() => void signOut()} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error ? <span className="small" role="alert">{error}</span> : null}
    </span>
  );
}
