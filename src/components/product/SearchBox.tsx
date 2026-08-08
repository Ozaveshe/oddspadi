"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * The unified search box.
 *
 * Debounced fetch against /api/search, grouped results, every hit a real link
 * to a canonical route. Three states a reader can tell apart: searching,
 * nothing found, and a degraded catalogue — the last because a search over a
 * partial index that stays quiet about it reads as "that team does not exist".
 */

type ApiResult = { id: string; name: string; context: string | null; href: string | null; matchedOn: string };
type ApiGroup = { kind: string; results: ApiResult[] };
type ApiResponse = { groups: ApiGroup[]; ambiguous: boolean; missingSources: string[] };

const GROUP_LABELS: Record<string, string> = {
  team: "Teams",
  competition: "Competitions",
  fixture: "Fixtures",
  player: "Players"
};

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResponse(null);
      setBusy(false);
      setFailed(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const body = (await result.json()) as { success: boolean; data: ApiResponse };
        if (!controller.signal.aborted) {
          setResponse(body.success ? body.data : null);
          setFailed(!body.success);
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setResponse(null);
          setFailed(true);
        }
      } finally {
        // The busy flag clears here and only here, so no throw path can leave
        // "Searching…" on screen forever. An aborted request skips it: a newer
        // request owns the flag by then, and clearing it would blank that
        // request's spinner mid-flight.
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const hasResults = (response?.groups.length ?? 0) > 0;

  return (
    <div className="search-box" role="search">
      <label className="search-box-label" htmlFor="unified-search">
        Search teams, competitions and fixtures
      </label>
      <input
        id="unified-search"
        className="search-box-input"
        type="search"
        placeholder="Arsenal, Premier League, Arsenal v Chelsea…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      {query.trim().length >= 2 ? (
        <div className="search-box-results" aria-live="polite">
          {busy ? <p className="muted small">Searching…</p> : null}
          {failed ? <p className="muted small">Search is unavailable right now. The boards below still work.</p> : null}
          {!busy && !failed && response && !hasResults ? (
            <p className="muted small">Nothing matched &ldquo;{query.trim()}&rdquo;.</p>
          ) : null}
          {!busy && response?.missingSources.length ? (
            // A partial index that stays quiet reads as "that team does not exist".
            <p className="muted small">Some sources are unavailable; results may be incomplete.</p>
          ) : null}
          {!busy && response?.ambiguous ? (
            <p className="muted small">Several close matches — check the context line before opening one.</p>
          ) : null}
          {!busy &&
            response?.groups.map((group) => (
              <div className="search-box-group" key={group.kind}>
                <span className="section-kicker">{GROUP_LABELS[group.kind] ?? group.kind}</span>
                <ul>
                  {group.results.map((result) => (
                    <li key={`${group.kind}-${result.id}`}>
                      {result.href ? (
                        <Link href={result.href} prefetch={false}>
                          <strong>{result.name}</strong>
                          {result.context ? <span className="muted small"> · {result.context}</span> : null}
                        </Link>
                      ) : (
                        <span>
                          <strong>{result.name}</strong>
                          {result.context ? <span className="muted small"> · {result.context}</span> : null}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
