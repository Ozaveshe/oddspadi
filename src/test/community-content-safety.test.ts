import { describe, expect, it } from "vitest";
import { assessCommunityText, extractLinks, isSafeLinkHost, CONTENT_SAFETY_COPY } from "@/lib/community/contentSafety";

describe("extractLinks", () => {
  it("finds http, https and www links", () => {
    expect(extractLinks("see https://example.com/a and www.example.org")).toEqual([
      "https://example.com/a",
      "www.example.org"
    ]);
  });

  it("returns an empty list for plain talk", () => {
    expect(extractLinks("no links here, just football talk")).toEqual([]);
  });
});

describe("assessCommunityText", () => {
  it("allows ordinary match talk", () => {
    const verdict = assessCommunityText("Arsenal look strong at home this season, midfield press is the difference.");
    expect(verdict.allowed).toBe(true);
    expect(verdict.flags).toEqual([]);
    expect(verdict.reasons).toEqual([]);
  });

  it("allows a direct link to a reputable source", () => {
    const verdict = assessCommunityText("Team news is up: https://www.bbc.co.uk/sport/football/12345");
    expect(verdict.allowed).toBe(true);
  });

  it("rejects link shorteners", () => {
    const verdict = assessCommunityText("free picks here https://bit.ly/3abcd");
    expect(verdict.allowed).toBe(false);
    expect(verdict.flags).toContain("unsafe_link");
    expect(verdict.reasons).toContain(CONTENT_SAFETY_COPY.unsafe_link);
  });

  it("rejects raw-IP hosts and userinfo tricks", () => {
    expect(assessCommunityText("pay at http://203.0.113.9/pay").allowed).toBe(false);
    expect(assessCommunityText("visit https://legit.com@evil.example/x").allowed).toBe(false);
  });

  it("rejects paid-tip solicitation", () => {
    for (const text of [
      "DM me for tips, big odds tonight",
      "join my VIP group on t.me/bigwins",
      "wa.me/2348000000 for sure odds"
    ]) {
      const verdict = assessCommunityText(text);
      expect(verdict.allowed).toBe(false);
      expect(verdict.flags).toContain("scam_or_paid_tips");
    }
  });

  it("rejects certainty claims", () => {
    for (const text of ["guaranteed win tonight", "this bet is 100% sure", "fixed match info available"]) {
      const verdict = assessCommunityText(text);
      expect(verdict.allowed).toBe(false);
      expect(verdict.flags).toContain("guaranteed_win_claim");
    }
  });

  it("rejects link spam", () => {
    const repeated = Array.from({ length: 4 }, () => "https://example.com/offer").join(" ");
    expect(assessCommunityText(repeated).flags).toContain("spam");
  });

  it("keeps flags deduplicated and reasons aligned", () => {
    const verdict = assessCommunityText("guaranteed win https://bit.ly/x https://bit.ly/x");
    expect(new Set(verdict.flags).size).toBe(verdict.flags.length);
    expect(verdict.reasons.length).toBe(verdict.flags.length);
  });
});

describe("isSafeLinkHost", () => {
  it("accepts plain https hosts and rejects shorteners and script schemes", () => {
    expect(isSafeLinkHost("https://www.bbc.co.uk/sport")).toBe(true);
    expect(isSafeLinkHost("www.espn.com/football")).toBe(true);
    expect(isSafeLinkHost("https://tinyurl.com/x")).toBe(false);
    expect(isSafeLinkHost("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHost("data:text/html,hi")).toBe(false);
    expect(isSafeLinkHost("https://localhost/x")).toBe(false);
  });
});
