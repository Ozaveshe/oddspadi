import type { OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { countsTowardRecord } from "@/lib/domain/states";

/**
 * The gate a generated article must pass before it is allowed to exist.
 *
 * Generated stories used to compute their own wins and losses from whatever
 * rows the generator happened to read, then bake the numbers into prose. The
 * article became the claim, and nothing downstream could check it.
 *
 * Validation here **fails closed**: an article that cannot prove its claims is
 * not published, not published-with-a-caveat. A missing article is a gap; a
 * published false one is a lie the site is telling on its own behalf.
 */
export type ArticleProvenance = {
  /** Canonical fixture ids the article discusses. */
  sourceFixtureIds: string[];
  /** Ledger ids for every pick the article claims OddsPadi published. */
  publicationIds: string[];
  /** Settlement ids backing any result claim. */
  settlementIds: string[];
  /** Latest source record the article reflects. */
  dataCutoffAt: string;
  generatedAt: string;
  /** Bumped when the prose template changes, so old text is identifiable. */
  generatorVersion: string;
  modelVersion: string | null;
};

export type ArticleClaims = {
  /** How many official picks the prose says exist. */
  statedPickCount: number;
  statedWins: number;
  statedLosses: number;
  /** True when the article presents results as final. */
  claimsFinalResults: boolean;
  /** Set when the article knowingly renders an incomplete projection. */
  disclosesIncompleteData: boolean;
};

export type ValidationFailure = { rule: string; detail: string };

export type ArticleValidation = {
  /** The only field a caller should branch on. */
  publishable: boolean;
  failures: ValidationFailure[];
};

export type ValidationContext = {
  provenance: ArticleProvenance;
  claims: ArticleClaims;
  /** Resolved from the ledger at validation time. */
  publications: OfficialPublicationSummary[];
  /** Fixture ids confirmed to exist. */
  knownFixtureIds: string[];
  /** True when the projections feeding the article were stale or partial. */
  sourceIncomplete: boolean;
  /** The performance page's current settled count, for contradiction checks. */
  performanceSettledCount: number | null;
};

export function validateArticle(context: ValidationContext): ArticleValidation {
  const failures: ValidationFailure[] = [];
  const { provenance, claims, publications } = context;

  // 1. Every referenced fixture must exist.
  const knownFixtures = new Set(context.knownFixtureIds);
  const missingFixtures = provenance.sourceFixtureIds.filter((id) => !knownFixtures.has(id));
  if (missingFixtures.length) {
    failures.push({
      rule: "fixtures-exist",
      detail: `${missingFixtures.length} referenced fixture(s) could not be found: ${missingFixtures.slice(0, 3).join(", ")}`
    });
  }

  // 2. Every claimed pick must be a real official publication.
  const resolved = new Map(publications.map((publication) => [publication.publicationId, publication]));
  const unresolved = provenance.publicationIds.filter((id) => !resolved.has(id));
  if (unresolved.length) {
    failures.push({
      rule: "picks-are-official",
      detail: `${unresolved.length} claimed pick(s) are not in the publication ledger: ${unresolved.slice(0, 3).join(", ")}`
    });
  }

  // 3. The stated count must equal the referenced ids. This is the rule that
  //    stops an article inventing or independently inferring a pick count.
  if (claims.statedPickCount !== provenance.publicationIds.length) {
    failures.push({
      rule: "count-matches-ids",
      detail: `the article states ${claims.statedPickCount} pick(s) but references ${provenance.publicationIds.length} publication id(s)`
    });
  }

  // 4. Result claims must match current settlement, not settlement as it was
  //    when the generator ran.
  const scorable = publications.filter((publication) => publication.publicationStatus !== "retracted");
  const currentWins = scorable.filter((publication) => publication.settlementStatus === "won").length;
  const currentLosses = scorable.filter((publication) => publication.settlementStatus === "lost").length;
  if (claims.statedWins !== currentWins || claims.statedLosses !== currentLosses) {
    failures.push({
      rule: "settlement-current",
      detail: `the article states ${claims.statedWins}-${claims.statedLosses} but the ledger currently shows ${currentWins}-${currentLosses}`
    });
  }

  // 5. A retracted pick cannot be cited as a pick at all.
  const retracted = publications.filter((publication) => publication.publicationStatus === "retracted");
  if (retracted.length) {
    failures.push({
      rule: "no-retracted-picks",
      detail: `${retracted.length} referenced publication(s) have been retracted`
    });
  }

  // 6. A finished review may not present unsettled events as final results.
  if (claims.claimsFinalResults) {
    const unsettled = scorable.filter((publication) => !countsTowardRecord(publication.settlementStatus));
    if (unsettled.length) {
      failures.push({
        rule: "final-results-are-settled",
        detail: `${unsettled.length} referenced pick(s) have not settled, so results cannot be presented as final`
      });
    }
  }

  // 7. Odds must be timestamped: a price without a time is not evidence.
  const untimed = publications.filter((publication) => !publication.publishedAt || !Number.isFinite(Date.parse(publication.publishedAt)));
  if (untimed.length) {
    failures.push({ rule: "odds-timestamped", detail: `${untimed.length} referenced publication(s) have no valid publication time` });
  }

  // 8. Stale or partial source data may be used, but only with disclosure.
  if (context.sourceIncomplete && !claims.disclosesIncompleteData) {
    failures.push({
      rule: "disclose-incomplete-data",
      detail: "the article was generated from stale or partial projections without disclosing it"
    });
  }

  // 9. The article must not contradict the performance page.
  if (context.performanceSettledCount !== null) {
    const articleSettled = currentWins + currentLosses;
    if (claims.claimsFinalResults && articleSettled > context.performanceSettledCount) {
      failures.push({
        rule: "agrees-with-performance",
        detail: `the article implies ${articleSettled} settled picks but the performance page reports ${context.performanceSettledCount}`
      });
    }
  }

  // 10. Provenance completeness — an article that cannot say what it was built
  //     from cannot be re-checked later.
  if (!provenance.dataCutoffAt || !Number.isFinite(Date.parse(provenance.dataCutoffAt))) {
    failures.push({ rule: "provenance-complete", detail: "the article has no valid data cutoff" });
  }
  if (!provenance.generatorVersion) {
    failures.push({ rule: "provenance-complete", detail: "the article has no generator version" });
  }

  return { publishable: failures.length === 0, failures };
}

/**
 * Articles that make no ledger claim skip the pick-specific rules.
 *
 * A fixture preview that names no picks has nothing to prove against the
 * ledger, and forcing it through the pick rules would block legitimate
 * content — the failure mode in the other direction.
 */
export function validateNonClaimingArticle(provenance: ArticleProvenance, knownFixtureIds: string[]): ArticleValidation {
  return validateArticle({
    provenance: { ...provenance, publicationIds: [], settlementIds: [] },
    claims: { statedPickCount: 0, statedWins: 0, statedLosses: 0, claimsFinalResults: false, disclosesIncompleteData: false },
    publications: [],
    knownFixtureIds,
    sourceIncomplete: false,
    performanceSettledCount: null
  });
}
