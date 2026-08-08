import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { escapeIlikePattern } from "@/lib/security/inputValidation";
import { normalizeFollowKey } from "@/lib/personal/preferences";

export const dynamic = "force-dynamic";

/**
 * Guest-to-account migration for follows.
 *
 * Workspaces already migrate through /api/workspace/sync (merge by id and
 * recency). This route carries the rest: guest team names resolve against
 * the team catalogue (exact normalised match only — a fuzzy match would
 * follow the wrong club on the user's behalf), and sports/competitions/
 * players land in op_follows keyed on their normalised names.
 *
 * Idempotent by construction: duplicate-key inserts are successes, unknown
 * team names are reported back rather than guessed, and running the same
 * migration twice changes nothing.
 */

const MAX_PER_KIND = 50;

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 120)
        .map((entry) => entry.trim())
        .slice(0, MAX_PER_KIND)
    : [];
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Migration is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to migrate your saved follows." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "follow_team");
  if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{
    teamNames?: unknown;
    competitions?: unknown;
    sports?: unknown;
    players?: unknown;
  }>(request, 16_000);
  if (!parsed.ok) return parsed.response;

  const teamNames = names(parsed.value.teamNames);
  const result = {
    teams: { migrated: 0, alreadyFollowed: 0, unmatched: [] as string[] },
    follows: { migrated: 0, alreadyFollowed: 0 }
  };

  // --- Teams: resolve names against the catalogue, exact normalised match ---
  for (const name of teamNames) {
    const { data: matches, error } = await supabase
      .from("op_teams")
      .select("id,name")
      .ilike("name", escapeIlikePattern(name))
      .limit(2);
    if (error) return databaseUnavailable("migration team lookup", error, "Migration is temporarily unavailable.");
    const exact = (matches ?? []).filter((row) => normalizeFollowKey(String(row.name)) === normalizeFollowKey(name));
    if (exact.length !== 1) {
      // Zero or ambiguous: the user picks by hand later. Guessing follows
      // the wrong club silently, which is worse than asking.
      result.teams.unmatched.push(name);
      continue;
    }
    const { error: insertError } = await supabase
      .from("op_followed_teams")
      .insert({ user_id: user.id, team_id: exact[0]!.id });
    if (insertError) {
      if (insertError.code === "23505") result.teams.alreadyFollowed += 1;
      else return databaseUnavailable("migration team follow", insertError, "Migration is temporarily unavailable.");
    } else {
      result.teams.migrated += 1;
    }
  }

  // --- Sports / competitions / players → op_follows -------------------------
  const followRows: Array<{ entity_type: string; display_name: string }> = [
    ...names(parsed.value.sports).map((name) => ({ entity_type: "sport", display_name: name })),
    ...names(parsed.value.competitions).map((name) => ({ entity_type: "competition", display_name: name })),
    ...names(parsed.value.players).map((name) => ({ entity_type: "player", display_name: name }))
  ];
  for (const row of followRows) {
    const { error } = await supabase.from("op_follows").insert({
      user_id: user.id,
      entity_type: row.entity_type,
      entity_key: normalizeFollowKey(row.display_name),
      display_name: row.display_name
    });
    if (error) {
      if (error.code === "23505") result.follows.alreadyFollowed += 1;
      else return databaseUnavailable("migration follow", error, "Migration is temporarily unavailable.");
    } else {
      result.follows.migrated += 1;
    }
  }

  return privateJson({ ok: true, ...result });
}
