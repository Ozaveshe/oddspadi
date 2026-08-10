import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY, filterAnalyticsMetadata, safeAnalyticsPath, trackEvent } from "@/lib/analytics/events";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("analytics metadata allowlist", () => {
  it("drops private slip contents from betslip events", () => {
    const filtered = filterAnalyticsMetadata("betslip_pick_added", {
      sport: "football",
      league: "NPFL",
      source: "match",
      selection: "Arsenal to win",
      decimal_odds: 2.1
    });
    expect(filtered).toEqual({ sport: "football", league: "NPFL", source: "match" });
    expect(filtered).not.toHaveProperty("selection");
    expect(filtered).not.toHaveProperty("decimal_odds");
  });

  it("drops the followed team's identity, keeping only the sport", () => {
    const filtered = filterAnalyticsMetadata("team_followed", { sport: "football", team_id: "api-football:33", team_name: "Manchester United", country: "England" });
    expect(filtered).toEqual({ sport: "football" });
  });

  it("drops unknown keys smuggled through the declarative channel", () => {
    const filtered = filterAnalyticsMetadata("outbound_link_clicked", { destination_host: "bbc.co.uk", email: "a@b.com", user_id: "u1" });
    expect(filtered).toEqual({ destination_host: "bbc.co.uk" });
  });
});

describe("beacon path never carries a token or handle", () => {
  it("collapses dynamic segments to placeholders", () => {
    expect(safeAnalyticsPath("/workspace/shared/abc.123.sig")).toBe("/workspace/shared/:id");
    expect(safeAnalyticsPath("/community/u/some-handle")).toBe("/community/u/:id");
    expect(safeAnalyticsPath("/predictions/api-football-1234")).toBe("/predictions/:id");
    expect(safeAnalyticsPath("/track-record/publication/pub-1")).toBe("/track-record/publication/:id");
    expect(safeAnalyticsPath("/predictions")).toBe("/predictions");
  });
});

describe("trackEvent redacts before sending", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only allowlisted metadata and a safe path to the beacon", () => {
    const gtag = vi.fn();
    const sendBeacon = vi.fn((_url: string, _body?: BodyInit) => true);
    const storage = new Map<string, string>([[ANALYTICS_CONSENT_KEY, "granted"]]);
    process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT = "/api/analytics-test";
    vi.stubGlobal("window", { location: { pathname: "/workspace/shared/secret.token.sig" }, localStorage: { getItem: (k: string) => storage.get(k) ?? null }, gtag });
    vi.stubGlobal("navigator", { sendBeacon });

    trackEvent("betslip_pick_added", { sport: "football", selection: "Arsenal", decimal_odds: 2.1 });

    expect(gtag).toHaveBeenCalledWith("event", "betslip_pick_added", { sport: "football" });
    const beaconBody = JSON.parse(String(sendBeacon.mock.calls[0][1]));
    expect(beaconBody.metadata).toEqual({ sport: "football" });
    expect(beaconBody.path).toBe("/workspace/shared/:id");
    expect(JSON.stringify(beaconBody)).not.toContain("secret.token");
    delete process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
  });
});

describe("leaking call sites are fixed at source", () => {
  it("betslip button no longer passes selection or odds", () => {
    const source = read("src/components/odds/AddToSlipButton.tsx");
    expect(source).not.toMatch(/selection:\s*[^,}]*label/);
    expect(source).not.toContain("decimal_odds:");
  });

  it("follow controls no longer pass team_name", () => {
    for (const file of ["src/components/account/FollowTeamButton.tsx", "src/components/account/ProfileEditor.tsx"]) {
      expect(read(file)).not.toContain("team_name:");
    }
  });
});
