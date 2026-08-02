import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/sports/decision/training/provider-capacity/route";

const endpoint = "http://localhost/api/sports/decision/training/provider-capacity";

describe("provider capacity route", () => {
  beforeEach(() => {
    process.env.ODDSPADI_ADMIN_TOKEN = "admin-token";
    process.env.API_FOOTBALL_KEY = "football-secret";
    process.env.API_BASKETBALL_KEY = "basketball-secret";
  });

  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
    delete process.env.API_FOOTBALL_KEY;
    delete process.env.API_BASKETBALL_KEY;
    vi.unstubAllGlobals();
  });

  it("refuses an anonymous read", async () => {
    // The anonymous response named every provider and the env var holding its
    // key, which is a map of both the suppliers and the secrets.
    const response = await GET(new Request(endpoint));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("API_FOOTBALL_KEY");
  });

  it("keeps an authorised GET a no-network configuration preview", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(endpoint, { headers: { "x-oddspadi-admin-token": "admin-token" } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.data.providers.map((provider: { status: string }) => provider.status)).toEqual(["configured", "configured"]);
    expect(JSON.stringify(body)).not.toContain("football-secret");
    expect(JSON.stringify(body)).not.toContain("basketball-secret");
  });

  it("requires both explicit execution intent and the timing-safe admin credential", async () => {
    // Unauthorised first: a 400 about a missing `run=1` would confirm the
    // route and teach its interface to a caller holding nothing.
    expect((await POST(new Request(endpoint, { method: "POST" }))).status).toBe(401);
    expect(
      (await POST(new Request(endpoint, { method: "POST", headers: { "x-oddspadi-admin-token": "admin-token" } }))).status
    ).toBe(400);
    expect(
      (
        await POST(
          new Request(`${endpoint}?run=1`, { method: "POST", headers: { "x-oddspadi-admin-token": "wrong-token" } })
        )
      ).status
    ).toBe(401);
  });

  it("returns sanitized provider capacity evidence to an authorized operator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ response: { subscription: { plan: "Pro", active: true }, requests: { current: 10, limit_day: 7_500 } }, errors: {} })
      )
    );

    const response = await POST(
      new Request(`${endpoint}?run=1`, { method: "POST", headers: { "x-oddspadi-admin-token": "admin-token" } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.providers).toHaveLength(2);
    expect(body.data.providers.every((provider: { status: string }) => provider.status === "active")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("football-secret");
    expect(JSON.stringify(body)).not.toContain("basketball-secret");
  });
});
