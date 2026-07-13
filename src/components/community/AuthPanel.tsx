"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import { trackEvent } from "@/lib/analytics/events";

type Mode = "signin" | "signup" | "reset" | "update";
type Status = { kind: "idle" | "loading" | "error" | "sent"; message?: string };

export function AuthPanel() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") setMode("update"); });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) return <div className="notice">Community sign-in isn&apos;t switched on for this environment yet.</div>;

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return; setStatus({ kind: "loading" });
    try {
      if (mode === "reset") { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/account` }); if (error) throw error; setStatus({ kind: "sent", message: "Check your email for a secure reset link." }); return; }
      if (mode === "update") { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setStatus({ kind: "sent", message: "Password updated successfully." }); return; }
      if (mode === "signup") { const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/account` } }); if (error) throw error; trackEvent("account_auth_completed", { auth_mode: "signup", requires_email_confirmation: true }); setStatus({ kind: "sent", message: "Check your email to confirm your account, then sign in." }); return; }
      const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; trackEvent("account_auth_completed", { auth_mode: "signin" }); router.refresh();
    } catch (error) { setStatus({ kind: "error", message: error instanceof Error ? error.message : "Something went wrong. Try again." }); }
  }
  const switchMode = (next: Mode) => { setMode(next); setStatus({ kind: "idle" }); };
  return <form className="panel auth-panel" onSubmit={submit}>
    {mode !== "update" ? <div className="seg" role="group" aria-label="Sign in or create account"><button type="button" aria-pressed={mode === "signin"} onClick={() => switchMode("signin")}>Sign in</button><button type="button" aria-pressed={mode === "signup"} onClick={() => switchMode("signup")}>Create account</button></div> : <h2>Choose a new password</h2>}
    {mode !== "update" ? <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div> : null}
    {mode !== "reset" ? <div className="field"><label htmlFor="password">{mode === "update" ? "New password" : "Password"}</label><input id="password" type="password" minLength={8} required autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></div> : null}
    {status.kind === "error" ? <p role="alert" className="small auth-error">{status.message}</p> : null}{status.kind === "sent" ? <p role="status" className="small auth-success">{status.message}</p> : null}
    <button className="button primary" type="submit" disabled={status.kind === "loading"}>{status.kind === "loading" ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : mode === "update" ? "Set new password" : "Sign in"}</button>
    {mode !== "update" ? <button className="auth-text-button" type="button" onClick={() => switchMode(mode === "reset" ? "signin" : "reset")}>{mode === "reset" ? "Back to sign in" : "Forgot your password?"}</button> : null}
    <p className="small muted">By joining you agree to keep it civil. Community posts are opinions from other fans — not OddsPadi analysis.</p>
  </form>;
}
