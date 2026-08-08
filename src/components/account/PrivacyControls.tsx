"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

/**
 * Privacy and session controls for the signed-in account: export, deletion,
 * and sign-out-everywhere. Each action reports what actually happened; the
 * deletion path demands the typed confirmation the API requires, so the two
 * safeguards are the same safeguard.
 */
export function PrivacyControls() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const mounted = useRef(true);

  async function exportData() {
    setBusy("export");
    try {
      const response = await fetch("/api/my/export");
      if (!response.ok) {
        setNote("Export is unavailable right now.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "oddspadi-personal-export.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNote("Export downloaded. It contains everything your account stores.");
    } catch {
      setNote("Export is unavailable right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function deleteData() {
    setBusy("delete");
    try {
      const response = await fetch("/api/my/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText })
      });
      const body = (await response.json()) as { error?: string; note?: string };
      setNote(response.ok ? `Personal data deleted. ${body.note ?? ""}` : body.error ?? "Deletion failed.");
      if (response.ok) setConfirmText("");
    } catch {
      setNote("Deletion is unavailable right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function signOutEverywhere() {
    setBusy("signout");
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setNote("Sign-out is unavailable right now.");
        return;
      }
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) {
        // Stated failure beats an optimistic redirect that leaves sessions live.
        setNote("Sign-out everywhere failed — your other sessions are still active.");
        return;
      }
      window.location.assign("/");
    } catch {
      setNote("Sign-out is unavailable right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <section className="panel section" aria-labelledby="privacy-controls-heading">
      <h2 id="privacy-controls-heading">Privacy &amp; sessions</h2>
      <p className="muted small">
        Everything personal is private by default — there is no public profile. Export gives you a copy of all of it;
        deletion removes it; sign out everywhere revokes every device&apos;s session, including this one.
      </p>
      <div className="card-actions">
        <button className="button secondary" type="button" disabled={busy !== null} onClick={() => void exportData()}>
          {busy === "export" ? "Exporting…" : "Export my data"}
        </button>
        <button className="button secondary" type="button" disabled={busy !== null} onClick={() => void signOutEverywhere()}>
          {busy === "signout" ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
      <div className="card-actions">
        <input
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder='Type "delete my personal data"'
          aria-label="Deletion confirmation"
          maxLength={40}
        />
        <button
          className="button secondary"
          type="button"
          disabled={busy !== null || confirmText !== "delete my personal data"}
          onClick={() => void deleteData()}
        >
          {busy === "delete" ? "Deleting…" : "Delete my personal data"}
        </button>
      </div>
      {note ? <p className="muted small" role="status">{note}</p> : null}
    </section>
  );
}
