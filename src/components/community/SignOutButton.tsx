"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { trackEvent } from "@/lib/analytics/events";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
      trackEvent("account_signed_out");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="button" type="button" onClick={signOut} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
