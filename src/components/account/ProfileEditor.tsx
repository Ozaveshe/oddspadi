"use client";

import { useEffect, useState } from "react";
import type { FollowedTeam } from "@/lib/account/followedTeams";
import { useFollowedTeams } from "./FollowedTeamsProvider";
import { trackEvent } from "@/lib/analytics/events";

export function ProfileEditor({ displayName: initialName, bio: initialBio, favouriteTeam: initialFavourite }: { displayName: string; bio: string; favouriteTeam: string }) {
  const [displayName, setDisplayName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [query, setQuery] = useState(initialFavourite);
  const [selected, setSelected] = useState<FollowedTeam | null>(null);
  const [results, setResults] = useState<FollowedTeam[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const follows = useFollowedTeams();
  useEffect(() => {
    if (query.trim().length < 2 || selected?.name === query) { setResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // The cleanup below aborts this fetch on every keystroke, and an aborted
      // fetch rejects. Without a catch each debounce tick raised an unhandled
      // promise rejection; a genuine network failure did the same.
      void (async () => {
        try {
          const response = await fetch(`/api/account/teams?q=${encodeURIComponent(query)}`, { signal: controller.signal });
          if (!response.ok) return;
          const payload = (await response.json()) as { teams?: FollowedTeam[] };
          if (!controller.signal.aborted) setResults(payload.teams ?? []);
        } catch {
          // Aborted or offline: keep the previous suggestions rather than
          // clearing the list out from under the visitor.
        }
      })();
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selected]);

  async function follow(team: FollowedTeam): Promise<boolean> {
    const alreadyFollowed = follows.teams.some((item) => item.id === team.id);
    try {
      const response = await fetch("/api/account/followed-teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: team.id }) });
      if (!response.ok) return false;
      window.dispatchEvent(new Event("oddspadi:follows-changed"));
      if (!alreadyFollowed) trackEvent("team_followed", { team_id: team.id, team_name: team.name, sport: team.sport, country: team.country ?? "unknown" });
      return true;
    } catch {
      return false;
    }
  }
  async function unfollow(team: FollowedTeam) {
    try {
      const response = await fetch(`/api/account/followed-teams?teamId=${encodeURIComponent(team.id)}`, { method: "DELETE" });
      if (!response.ok) { setMessage("That team could not be unfollowed. Check your connection and try again."); return; }
      window.dispatchEvent(new Event("oddspadi:follows-changed"));
      trackEvent("team_unfollowed", { team_id: team.id, team_name: team.name, sport: team.sport, country: team.country ?? "unknown" });
    } catch {
      setMessage("That team could not be unfollowed. Check your connection and try again.");
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    // Every step here could throw — the network can drop, and an edge error
    // page is not JSON. Without try/finally a single blip left `busy` true, so
    // the Save button stayed disabled reading "Saving…" until a full reload.
    try {
      const response = await fetch("/api/account/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, bio, ...(selected ? { favouriteTeamId: selected.id } : {}) }) });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) { setMessage(payload.error ?? "Profile could not be saved."); return; }
      if (selected) await follow(selected);
      setMessage("Profile saved. Your matchday is now personalised.");
    } catch {
      setMessage("Profile could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel profile-editor">
    <div><span className="section-kicker">Personalise OddsPadi</span><h2>Your profile &amp; teams</h2><p className="muted">Follow clubs to lift their matches across predictions, live scores and your homepage.</p></div>
    <form onSubmit={save}>
      <div className="field"><label htmlFor="display-name">Display name</label><input id="display-name" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
      <div className="field"><label htmlFor="bio">Bio</label><textarea id="bio" className="feed-textarea" maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} /></div>
      <div className="field team-picker"><label htmlFor="favourite-team">Favourite team</label><input id="favourite-team" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }} placeholder="Search Arsenal, Enyimba, Lakers…" autoComplete="off" />
        {results.length ? <div className="team-search-results">{results.map((team) => <button type="button" key={team.id} onClick={() => { setSelected(team); setQuery(team.name); setResults([]); }}><strong>{team.name}</strong><span>{team.sport} · {team.country ?? "World"}</span></button>)}</div> : null}
      </div>
      <button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"}</button>
      {message ? <p role="status" className="small">{message}</p> : null}
    </form>
    <div className="followed-team-chips"><strong>Followed teams</strong>{follows.teams.length ? follows.teams.map((team) => <span key={team.id}>{team.name}<button type="button" onClick={() => void unfollow(team)} aria-label={`Unfollow ${team.name}`}>×</button></span>) : <p className="muted small">Choose a favourite or search above to start your watchlist.</p>}</div>
  </section>;
}
