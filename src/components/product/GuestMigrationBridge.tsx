"use client";

import { useEffect, useRef, useState } from "react";
import { useFollowedTeams } from "@/components/account/FollowedTeamsProvider";
import { readPersonalPreferences, writePersonalPreferences, DEFAULT_PREFERENCES } from "@/lib/personal/preferences";
import { readWorkspacesWithMigration } from "@/lib/workspace/clientState";

/**
 * Guest-to-account migration, run once per browser after sign-in.
 *
 * Follows migrate through /api/my/migrate (name-resolved, duplicate-safe);
 * workspaces through the existing sync merge. The guest copies are cleared
 * only for what migrated cleanly — unmatched team names stay local and are
 * reported, because silently dropping them would lose the user's list and
 * silently guessing would follow the wrong club.
 */

const MIGRATION_FLAG_KEY = "oddspadi-guest-migration-v1";

export function GuestMigrationBridge() {
  const followed = useFollowedTeams();
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (followed.status !== "ready" || started.current) return;
    if (typeof window === "undefined" || window.localStorage.getItem(MIGRATION_FLAG_KEY)) return;

    const preferences = readPersonalPreferences();
    const workspaces = readWorkspacesWithMigration(new Date().toISOString());
    const hasGuestState =
      preferences.followedTeams.length ||
      preferences.followedCompetitions.length ||
      preferences.followedSports.length ||
      preferences.followedPlayers.length ||
      workspaces.length;
    if (!hasGuestState) {
      window.localStorage.setItem(MIGRATION_FLAG_KEY, "empty");
      return;
    }

    started.current = true;
    (async () => {
      try {
        const [migrateResponse, syncResponse] = await Promise.all([
          fetch("/api/my/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamNames: preferences.followedTeams,
              competitions: preferences.followedCompetitions,
              sports: preferences.followedSports,
              players: preferences.followedPlayers
            })
          }),
          workspaces.length
            ? fetch("/api/workspace/sync", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaces })
              })
            : Promise.resolve(null)
        ]);

        if (!migrateResponse.ok) {
          setNote("Your device-saved follows could not migrate just now; they are still saved locally.");
          return;
        }
        const result = (await migrateResponse.json()) as {
          teams: { migrated: number; alreadyFollowed: number; unmatched: string[] };
          follows: { migrated: number; alreadyFollowed: number };
        };

        // Clear only what migrated; unmatched team names stay local.
        writePersonalPreferences({
          ...DEFAULT_PREFERENCES,
          followedTeams: result.teams.unmatched,
          oddsFormat: preferences.oddsFormat
        });
        window.localStorage.setItem(MIGRATION_FLAG_KEY, new Date().toISOString());

        const migratedCount = result.teams.migrated + result.follows.migrated;
        const synced = syncResponse === null || syncResponse.ok;
        setNote(
          [
            migratedCount ? `Moved ${migratedCount} device-saved follow${migratedCount === 1 ? "" : "s"} to your account.` : null,
            result.teams.unmatched.length
              ? `${result.teams.unmatched.length} team name${result.teams.unmatched.length === 1 ? "" : "s"} need picking by hand (kept on this device): ${result.teams.unmatched.join(", ")}.`
              : null,
            synced ? null : "Workspaces did not sync this time; they remain safe on this device."
          ]
            .filter(Boolean)
            .join(" ")
        );
      } catch {
        setNote("Migration will retry next visit; everything is still saved on this device.");
      }
    })();
  }, [followed.status]);

  if (!note) return null;
  return <p className="muted small" role="status">{note}</p>;
}
