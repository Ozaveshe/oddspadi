"use client";

import { useEffect, useRef, useState } from "react";

export type SharePreviewFormat = {
  id: string;
  label: string;
  text: string;
};

export function TipsSharePreview({ formats }: { formats: SharePreviewFormat[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const active = formats.find((format) => format.id === activeId) ?? null;

  // The reset timer outlived the component, so unmounting mid-toast left a
  // pending setState on a dead component; clicking Copy twice also raced two
  // timers, the first of which cleared the second's toast early.
  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  async function copyPreview() {
    if (!active || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(active.text);
    } catch {
      // Clipboard permission can be denied outright; an unhandled rejection
      // here surfaced in the console as a hard error on a cosmetic action.
      return;
    }
    setCopied(true);
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <section className="share-preview" aria-label="Social post previews">
      <div className="share-preview-heading">
        <div><span className="section-kicker">Editorial preview</span><h2>Share-ready, not auto-posted</h2></div>
        <div className="share-preview-actions">
          {formats.map((format) => (
            <button className={`button small-btn${activeId === format.id ? " primary" : ""}`} type="button" key={format.id} onClick={() => { setActiveId(format.id); setCopied(false); }}>
              Preview {format.label}
            </button>
          ))}
        </div>
      </div>
      {active ? (
        <div className="share-preview-output">
          <pre>{active.text}</pre>
          <button className="button small-btn" type="button" onClick={copyPreview}>{copied ? "Copied" : "Copy preview"}</button>
        </div>
      ) : <p className="muted small">Choose a format to inspect the exact post copy. Nothing is published from this page.</p>}
    </section>
  );
}
