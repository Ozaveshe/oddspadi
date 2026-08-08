import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMUNITY_SUBJECT_TYPES, parseCommunitySubject, parseSubjectParam, subjectHref } from "@/lib/community/subjects";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("community subjects", () => {
  it("covers the eight canonical subject kinds", () => {
    expect([...COMMUNITY_SUBJECT_TYPES]).toEqual([
      "fixture",
      "competition",
      "team",
      "player",
      "publication",
      "season_outlook",
      "strategy",
      "product_feedback"
    ]);
  });

  it("validates fixture ids like the rest of the community API", () => {
    expect(parseCommunitySubject({ subjectType: "fixture", subjectId: "api-football-1234" })).toEqual({
      subject_type: "fixture",
      subject_id: "api-football-1234"
    });
    expect(parseCommunitySubject({ subjectType: "fixture", subjectId: "bad id!" })).toBeNull();
  });

  it("rejects unknown types and oversized ids", () => {
    expect(parseCommunitySubject({ subjectType: "vibe", subjectId: "x" })).toBeNull();
    expect(parseCommunitySubject({ subjectType: "competition", subjectId: "x".repeat(121) })).toBeNull();
  });

  it("round-trips the subject query parameter", () => {
    expect(parseSubjectParam("competition:premier-league")).toEqual({
      subjectType: "competition",
      subjectId: "premier-league"
    });
    expect(subjectHref("competition", "premier-league")).toBe("/community?subject=competition%3Apremier-league");
    expect(parseSubjectParam("nope")).toBeNull();
    expect(parseSubjectParam(undefined)).toBeNull();
  });
});

describe("contextual surfaces", () => {
  it("embeds community context on the competition hub", () => {
    expect(read("src/app/predictions/league/[slug]/table/page.tsx")).toContain("CommunitySubjectPanel");
  });

  it("embeds community context on publication receipts", () => {
    expect(read("src/app/track-record/publication/[publicationId]/page.tsx")).toContain("CommunitySubjectPanel");
  });

  it("links season outlooks to discussion without a DB read", () => {
    const page = read("src/app/season-outlooks/page.tsx");
    expect(page).toContain('subjectHref("season_outlook"');
    expect(page).not.toContain("CommunitySubjectPanel");
  });

  it("stores a canonical subject when a feed post carries one", () => {
    const route = read("src/app/api/community/posts/route.ts");
    expect(route).toContain("parseCommunitySubject");
    expect(route).toContain("subject_type");
  });
});
