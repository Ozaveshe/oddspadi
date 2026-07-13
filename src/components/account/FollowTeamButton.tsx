"use client";

import { useState } from "react";
import { useFollowedTeams } from "./FollowedTeamsProvider";
import { normalizeTeamName, type FollowedTeam } from "@/lib/account/followedTeams";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Follow a team from the page where you meet it, instead of only from the
 * account settings search. Resolves the team-catalog row by name on first
 * follow; signed-out visitors are sent to /account.
 */
export function FollowTeamButton({ teamName, sport }: { teamName: string; sport: string }) {
  const follows = useFollowedTeams();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const followed = follows.isFollowed(teamName);

  async function unfollow() {
    const team = follows.teams.find((item) => normalizeTeamName(item.name) === normalizeTeamName(teamName));
    if (!team) return;
    setBusy(true);
    const response = await fetch(`/api/account/followed-teams?teamId=${encodeURIComponent(team.id)}`, { method: "DELETE" });
    if (response.ok) {
      window.dispatchEvent(new Event("oddspadi:follows-changed"));
      trackEvent("team_unfollowed", { team_id: team.id, team_name: team.name, sport: team.sport, country: team.country ?? "unknown" });
    }
    setBusy(false);
  }

  async function follow() {
    setBusy(true);
    setNote(null);
    try {
      const search = await fetch(`/api/account/teams?q=${encodeURIComponent(teamName)}`);
      if (search.status === 401) {
        window.location.href = "/account";
        return;
      }
      const { teams } = (await search.json().catch(() => ({ teams: [] }))) as { teams?: FollowedTeam[] };
      const candidates = (teams ?? []).filter((team) => team.sport === sport);
      const exact = candidates.find((team) => normalizeTeamName(team.name) === normalizeTeamName(teamName));
      const team = exact ?? candidates[0];
      if (!team) {
        setNote("Not in the team catalogue yet");
        return;
      }
      const response = await fetch("/api/account/followed-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id })
      });
      if (response.ok) {
        window.dispatchEvent(new Event("oddspadi:follows-changed"));
        trackEvent("team_followed", { team_id: team.id, team_name: team.name, sport: team.sport, country: team.country ?? "unknown" });
      }
    } finally {
      setBusy(false);
    }
  }

  if (note) return <span className="muted small">{note}</span>;
  return (
    <button
      className={`button small-btn${followed ? "" : " secondary"}`}
      type="button"
      disabled={busy}
      aria-pressed={followed}
      onClick={() => void (followed ? unfollow() : follow())}
    >
      {busy ? "…" : followed ? `Following ${teamName} ✓` : `Follow ${teamName}`}
    </button>
  );
}
