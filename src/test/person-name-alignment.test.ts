import { describe, expect, it } from "vitest";
import { initialsConflict, personNamesAlign, teamNamesAlign } from "@/lib/sports/providers/teamNameAlignment";

/**
 * The club matcher drops tokens under three characters, so a player's initials
 * are invisible to it and every `Zverev` aligns with every other `Zverev`. For a
 * corpus join that costs a row. For attaching bookmaker prices to a fixture it
 * prices one match from another match's odds — which is why tennis odds
 * alignment needs this guard before it is allowed to be fuzzy at all.
 */
describe("person name alignment", () => {
  it("aligns the same player written in either order", () => {
    expect(personNamesAlign("Popyrin A.", "A. Popyrin")).toBe(true);
    expect(personNamesAlign("Carreno Busta P.", "P. Carreno-Busta")).toBe(true);
    expect(personNamesAlign("Van De Zandschulp B.", "B. Van De Zandschulp")).toBe(true);
    expect(personNamesAlign("Rublev A.", "A. Rublev")).toBe(true);
  });

  it("still aligns when one side states no initial at all", () => {
    // A bare surname is not evidence of a different person.
    expect(personNamesAlign("Rublev", "A. Rublev")).toBe(true);
    expect(personNamesAlign("Krejcikova B.", "Krejcikova")).toBe(true);
  });

  // The safety property. Without it the club matcher says these are the same
  // player, because "A." and "M." are both discarded before comparison.
  it("refuses same-surname players whose initials disagree", () => {
    expect(teamNamesAlign("Zverev A.", "M. Zverev")).toBe(true);
    expect(personNamesAlign("Zverev A.", "M. Zverev")).toBe(false);

    expect(teamNamesAlign("Williams S.", "V. Williams")).toBe(true);
    expect(personNamesAlign("Williams S.", "V. Williams")).toBe(false);

    expect(personNamesAlign("Tsitsipas S.", "P. Tsitsipas")).toBe(false);
    expect(personNamesAlign("Cerundolo J.M.", "F. Cerundolo")).toBe(false);
  });

  it("keeps refusing what the club matcher already refused", () => {
    expect(personNamesAlign("Nadal R.", "R. Federer")).toBe(false);
    expect(personNamesAlign("", "A. Rublev")).toBe(false);
  });

  it("reports an initials conflict only when both sides state one", () => {
    expect(initialsConflict("Zverev A.", "M. Zverev")).toBe(true);
    expect(initialsConflict("Zverev A.", "A. Zverev")).toBe(false);
    expect(initialsConflict("Zverev", "M. Zverev")).toBe(false);
    expect(initialsConflict("Zverev", "Zverev")).toBe(false);
    // Multi-initial names share a letter, so they must not conflict.
    expect(initialsConflict("Cerundolo J.M.", "J. M. Cerundolo")).toBe(false);
  });

  it("leaves club alignment untouched", () => {
    expect(teamNamesAlign("Sutjeska", "FK Sutjeska Nikšić")).toBe(true);
    expect(teamNamesAlign("Manchester United", "Manchester City")).toBe(false);
  });
});
