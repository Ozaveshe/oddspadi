"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics/events";

type ShareChannel = "whatsapp" | "telegram" | "copy" | "native";

export type ShareBarProps = {
  text: string;
  url: string;
  title?: string;
  pageContext: "match_prediction" | "value_pick" | "results_ledger" | "news_story";
  matchId?: string;
  sport?: string;
  league?: string;
  compact?: boolean;
};

export function buildShareLinks(text: string, absoluteUrl: string) {
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${absoluteUrl}`)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(text)}`
  };
}

function resolvedUrl(value: string): string {
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return window.location.href;
  }
}

export function ShareBar({ text, url, title = "OddsPadi analysis", pageContext, matchId, sport, league, compact = false }: ShareBarProps) {
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [absoluteUrl, setAbsoluteUrl] = useState(url);
  const resetTimerRef = useRef<number | null>(null);
  const links = useMemo(() => buildShareLinks(text, absoluteUrl), [absoluteUrl, text]);

  useEffect(() => {
    setAbsoluteUrl(resolvedUrl(url));
    setCanNativeShare(typeof navigator.share === "function");
  }, [url]);

  // The copy-state timers were never cleared: unmounting mid-toast left a
  // pending setState on a dead component, and two quick clicks raced two timers
  // so the first one reset the second's toast early.
  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  function scheduleCopyReset(delayMs: number) {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopyState("idle"), delayMs);
  }

  function track(channel: ShareChannel) {
    trackEvent("share_clicked", {
      channel,
      page_context: pageContext,
      ...(matchId ? { match_id: matchId } : {}),
      ...(sport ? { sport } : {}),
      ...(league ? { league } : {})
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopyState("copied");
      track("copy");
      scheduleCopyReset(2200);
    } catch {
      setCopyState("failed");
      scheduleCopyReset(2600);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url: absoluteUrl });
      track("native");
    } catch (error) {
      // Dismissing the sheet is a normal outcome, not a failure. Anything else
      // (no share target, permission denied) previously vanished with no
      // feedback at all — surface it the same way a failed copy is surfaced.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCopyState("failed");
      scheduleCopyReset(2600);
    }
  }

  // `role="group"` is required for the label to be exposed: an `aria-label` on a
  // plain <div> has no role to attach to, so assistive technology discarded it
  // and this control cluster was announced unnamed.
  return (
    <div className={`share-bar${compact ? " share-bar--compact" : ""}`} role="group" aria-label="Share this analysis">
      <span className="share-bar-label">Share</span>
      <a className="share-action share-action--whatsapp" href={links.whatsapp} target="_blank" rel="noreferrer" onClick={() => track("whatsapp")}>
        WhatsApp
      </a>
      <a className="share-action" href={links.telegram} target="_blank" rel="noreferrer" onClick={() => track("telegram")}>
        Telegram
      </a>
      <button className="share-action" type="button" onClick={copyLink}>
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy link"}
      </button>
      {canNativeShare ? <button className="share-action share-action--native" type="button" onClick={nativeShare}>More</button> : null}
      <span className="sr-only" aria-live="polite">{copyState === "copied" ? "Link copied to clipboard." : copyState === "failed" ? "The link could not be copied." : ""}</span>
    </div>
  );
}
