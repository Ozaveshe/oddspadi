import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

import { GET as readFollowedTeams, POST as followTeam } from "@/app/api/account/followed-teams/route";
import { normalizeTeamName } from "@/lib/account/followedTeams";

function request(teamId: unknown) {
  return new Request("http://127.0.0.1:3031/api/account/followed-teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ teamId })
  });
}

function client(userId: string | null = "user-1", insertError: { code: string; message: string } | null = null) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const from = vi.fn(() => ({ insert }));
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    from
  });
  return { from, insert };
}

beforeEach(() => createSupabaseServerClientMock.mockReset());

describe("followed teams", () => {
  it("normalizes provider and fixture team names for highlighting", () => {
    expect(normalizeTeamName("Paris Saint-Germain FC")).toBe("parissaintgermainfc");
    expect(normalizeTeamName("  Côte d'Ivoire  ")).toBe("ctedivoire");
  });

  it("rejects signed-out follow attempts", async () => {
    const { from } = client(null);
    const response = await followTeam(request("team-1"));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("treats an anonymous optional follow-list read as a normal signed-out state", async () => {
    const { from } = client(null);
    const response = await readFollowedTeams();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ teams: [], authenticated: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts a follow under the authenticated user's identity", async () => {
    const { from, insert } = client();
    const response = await followTeam(request("team-1"));
    expect(response.status).toBe(201);
    expect(from).toHaveBeenCalledWith("op_followed_teams");
    expect(insert).toHaveBeenCalledWith({ user_id: "user-1", team_id: "team-1" });
  });

  it("treats an existing follow as an idempotent success", async () => {
    client("user-1", { code: "23505", message: "duplicate key" });
    expect((await followTeam(request("team-1"))).status).toBe(201);
  });
});
