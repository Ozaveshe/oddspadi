"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { trackEvent } from "@/lib/analytics/events";

type Status = { kind: "idle" | "loading" | "error" | "sent"; message?: string };

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    return (
      <div className="notice">
        Community sign-in isn’t switched on for this environment yet. Add your Supabase auth keys and it goes live.
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setStatus({ kind: "loading" });
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/account` }
        });
        if (error) throw error;
        trackEvent("account_auth_completed", { auth_mode: "signup", requires_email_confirmation: true });
        setStatus({ kind: "sent", message: "Check your email to confirm your account, then sign in." });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      trackEvent("account_auth_completed", { auth_mode: "signin" });
      router.refresh();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Something went wrong. Try again." });
    }
  }

  const busy = status.kind === "loading";

  return (
    <form className="panel auth-panel" onSubmit={onSubmit}>
      <div className="seg" role="group" aria-label="Sign in or create account" style={{ marginBottom: 18 }}>
        <button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>
          Create account
        </button>
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
        />
      </div>

      {status.kind === "error" ? (
        <p className="small" role="alert" style={{ color: "var(--red)", marginTop: 12 }}>
          {status.message}
        </p>
      ) : null}
      {status.kind === "sent" ? (
        <p className="small" role="status" style={{ color: "var(--green-strong)", marginTop: 12 }}>
          {status.message}
        </p>
      ) : null}

      <button className="button primary" type="submit" disabled={busy} style={{ marginTop: 18, width: "100%" }}>
        {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>

      <p className="small muted" style={{ marginTop: 14 }}>
        By joining you agree to keep it civil. Community posts are opinions from other fans — not OddsPadi analysis.
      </p>
    </form>
  );
}
