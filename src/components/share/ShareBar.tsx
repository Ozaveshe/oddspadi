"use client";

import { useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/lib/analytics/events";

type ShareChannel = "whatsapp" | "telegram" | "copy" | "native";

export type ShareBarProps = {
  text: string;
  url: string;
  title?: string;
  pageContext: "match_prediction" | "value_pick" | "results_ledger";
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
  const links = useMemo(() => buildShareLinks(text, absoluteUrl), [absoluteUrl, text]);

  useEffect(() => {
    setAbsoluteUrl(resolvedUrl(url));
    setCanNativeShare(typeof navigator.share === "function");
  }, [url]);

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
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2600);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url: absoluteUrl });
      track("native");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  return (
    <div className={`share-bar${compact ? " share-bar--compact" : ""}`} aria-label="Share this analysis">
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
