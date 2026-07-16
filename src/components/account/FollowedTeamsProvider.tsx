"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FollowedTeam } from "@/lib/account/followedTeams";
import { normalizeTeamName } from "@/lib/account/followedTeams";

type FollowedTeamsState = {
  status: "loading" | "signed-out" | "ready" | "unavailable";
  teams: FollowedTeam[];
  isFollowed: (name: string) => boolean;
  refresh: () => Promise<void>;
  ensureLoaded: () => void;
};

const Context = createContext<FollowedTeamsState>({
  status: "loading",
  teams: [],
  isFollowed: () => false,
  refresh: async () => {},
  ensureLoaded: () => {}
});

export function FollowedTeamsProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<FollowedTeamsState["status"]>("loading");
  const [teams, setTeams] = useState<FollowedTeam[]>([]);
  const loadedRef = useRef(false);
  const refresh = useCallback(async () => {
    loadedRef.current = true;
    try {
      const response = await fetch("/api/account/followed-teams");
      if (!response.ok) { setStatus("unavailable"); return; }
      const payload = await response.json() as { teams?: FollowedTeam[]; authenticated?: boolean };
      if (payload.authenticated === false) { setStatus("signed-out"); setTeams([]); return; }
      setTeams(payload.teams ?? []); setStatus("ready");
    } catch { setStatus("unavailable"); }
  }, []);
  const ensureLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const listener = () => void refresh();
    window.addEventListener("oddspadi:follows-changed", listener);
    return () => window.removeEventListener("oddspadi:follows-changed", listener);
  }, [refresh]);
  const names = useMemo(() => new Set(teams.map((team) => normalizeTeamName(team.name))), [teams]);
  const value = useMemo(
    () => ({ status, teams, isFollowed: (name: string) => names.has(normalizeTeamName(name)), refresh, ensureLoaded }),
    [ensureLoaded, names, refresh, status, teams]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useFollowedTeams() {
  const context = useContext(Context);
  useEffect(() => context.ensureLoaded(), [context.ensureLoaded]);
  return context;
}
