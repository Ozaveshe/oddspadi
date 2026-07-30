import { describe, expect, it } from "vitest";
import { tennisOddsEventAlignsWithFixture } from "@/lib/sports/providers/providerBackedProvider";

/**
 * Tennis odds attachment was an exact-key lookup with no fallback, while
 * football had fuzzy alignment. Tennis names are the ones that never join
 * exactly, so tennis fixtures routinely carried no odds, the market prior had
 * nothing to blend toward, and the anchor that should hold an unproven model at
 * 80% market weight never applied — corr(model, market) 0.078 for tennis against
 * 0.895 for football.
 *
 * A false positive here is worse than a miss: it prices one match from another
 * match's odds.
 */
const KICKOFF = "2026-07-21T13:00:00.000Z";
const event = (home: string, away: string, commence = KICKOFF) => ({
  commence_time: commence,
  home_team: home,
  away_team: away
});

describe("tennis odds alignment", () => {
  it("attaches odds when the two feeds order the name differently", () => {
    expect(tennisOddsEventAlignsWithFixture(event("Popyrin A.", "Skatov T."), "A. Popyrin", "T. Skatov", KICKOFF)).toBe(true);
    expect(
      tennisOddsEventAlignsWithFixture(event("Carreno Busta P.", "Gaubas V."), "P. Carreno-Busta", "V. Gaubas", KICKOFF)
    ).toBe(true);
  });

  it("attaches odds when only one feed states an initial", () => {
    expect(tennisOddsEventAlignsWithFixture(event("Rublev", "van Assche"), "A. Rublev", "L. van Assche", KICKOFF)).toBe(true);
  });

  // Without personNamesAlign these pass, because the club matcher discards "A."
  // and "M." before comparing. Tennis draws are full of namesakes.
  it("refuses a namesake whose initial disagrees", () => {
    expect(tennisOddsEventAlignsWithFixture(event("Zverev M.", "Skatov T."), "A. Zverev", "T. Skatov", KICKOFF)).toBe(false);
    expect(tennisOddsEventAlignsWithFixture(event("Tsitsipas P.", "Skatov T."), "S. Tsitsipas", "T. Skatov", KICKOFF)).toBe(false);
  });

  it("refuses a different match starting at the same moment", () => {
    expect(tennisOddsEventAlignsWithFixture(event("Bublik A.", "Molcan A."), "A. Rublev", "T. Skatov", KICKOFF)).toBe(false);
  });

  it("refuses the same players outside the kickoff tolerance", () => {
    const twoHoursLater = new Date(Date.parse(KICKOFF) + 2 * 3_600_000).toISOString();
    expect(tennisOddsEventAlignsWithFixture(event("Popyrin A.", "Skatov T.", twoHoursLater), "A. Popyrin", "T. Skatov", KICKOFF)).toBe(false);
  });

  /**
   * Which player a tennis feed calls "home" is arbitrary, and
   * `oddsMarketsForEvent` keys its selections from the event's own order — so a
   * swapped match must be refused rather than corrected. Attaching it would
   * invert the market probabilities, which is unrecoverable; a missing price is
   * not.
   */
  it("refuses a swapped pairing rather than attaching inverted prices", () => {
    expect(tennisOddsEventAlignsWithFixture(event("Skatov T.", "Popyrin A."), "A. Popyrin", "T. Skatov", KICKOFF)).toBe(false);
  });
});
