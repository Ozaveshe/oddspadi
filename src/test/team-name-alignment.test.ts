import { describe, expect, it } from "vitest";
import { teamNamesAlign } from "@/lib/sports/providers/providerBackedProvider";

/**
 * API-Football and The Odds API spell the same club differently outside the top
 * five leagues. Before this matcher existed, every in-season summer fixture went
 * unpriced because the exact-name lookup never hit, so the site published no
 * tips at all while matches were being played.
 */
describe("team name alignment", () => {
  it("aligns spellings that differ only by club affix or legal form", () => {
    expect(teamNamesAlign("Sutjeska", "FK Sutjeska Nikšić")).toBe(true);
    expect(teamNamesAlign("ML Vitebsk", "FC Vitebsk")).toBe(true);
    expect(teamNamesAlign("Atert Bissen", "FC Atert Bissen")).toBe(true);
    expect(teamNamesAlign("Egnatia Rrogozhinë", "KF Egnatia")).toBe(true);
    expect(teamNamesAlign("Petrocub", "Petrocub Hîncești")).toBe(true);
    expect(teamNamesAlign("Kairat Almaty", "FC Kairat")).toBe(true);
  });

  it("folds diacritics rather than treating them as different clubs", () => {
    expect(teamNamesAlign("Dečić", "Decic")).toBe(true);
    expect(teamNamesAlign("Universitatea Craiova", "Universitatea Craiova")).toBe(true);
  });

  it("aligns transliteration endings on a long shared stem", () => {
    expect(teamNamesAlign("KI Klaksvik", "Klaksvíkar Ítróttarfelag")).toBe(true);
  });

  // The safety property. A false positive here would attach one match's prices
  // to a different match and publish a pick from them.
  it("refuses same-city clubs that share only a common token", () => {
    expect(teamNamesAlign("Manchester United", "Manchester City")).toBe(false);
    expect(teamNamesAlign("Sporting Gijon", "Sporting Lisbon")).toBe(false);
    expect(teamNamesAlign("Real Madrid", "Real Sociedad")).toBe(false);
    expect(teamNamesAlign("Inter Milan", "Inter Miami")).toBe(false);
    expect(teamNamesAlign("Dynamo Kyiv", "Dynamo Moscow")).toBe(false);
  });

  it("refuses short stems that merely share a prefix", () => {
    // "Lens" is not "Lensk"; a four-letter prefix is not enough evidence.
    expect(teamNamesAlign("Lens", "Lensk")).toBe(false);
  });

  it("refuses names that reduce to nothing", () => {
    expect(teamNamesAlign("FC", "FC")).toBe(false);
    expect(teamNamesAlign("", "Arsenal")).toBe(false);
  });
});
