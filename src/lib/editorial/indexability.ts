/**
 * Whether a generated page earns a place in the index.
 *
 * OddsPadi generates a page per day per surface. Most days that is genuine
 * analysis; some days it is "no fixtures qualified", rendered in a template.
 * Indexing the second kind trains search engines to see the site as a thin
 * content farm and drags the good pages down with it, so the rule is: a page
 * is indexable when it says something a person could not have guessed from
 * the template.
 */
export type IndexabilityInput = {
  /** Distinct fixtures, picks or competitions the page actually discusses. */
  subjectCount: number;
  /** Words of prose that vary with the data, excluding boilerplate. */
  uniqueWordCount: number;
  /** True when the page is rendering an unavailable or empty state. */
  isUnavailableOrEmpty: boolean;
  /** True for internal engine-operation summaries. */
  isOperationalSummary: boolean;
  /** True when the page repeats a template with only numbers swapped. */
  isRepetitiveSummary: boolean;
};

export type IndexabilityVerdict = {
  index: boolean;
  /** Shown in the page's robots meta reasoning and in tests. */
  reason: string;
};

/** Below this the page is a stub with a headline, whatever the template says. */
const MIN_UNIQUE_WORDS = 120;
const MIN_SUBJECTS = 1;

export function classifyIndexability(input: IndexabilityInput): IndexabilityVerdict {
  if (input.isUnavailableOrEmpty) {
    return { index: false, reason: "The page is rendering an empty or unavailable state and has nothing durable to offer." };
  }
  if (input.isOperationalSummary) {
    return { index: false, reason: "Internal engine-operation summaries are for operators, not search results." };
  }
  if (input.subjectCount < MIN_SUBJECTS) {
    return { index: false, reason: "The page discusses no specific fixture, pick or competition." };
  }
  if (input.isRepetitiveSummary && input.uniqueWordCount < MIN_UNIQUE_WORDS) {
    return { index: false, reason: "The page repeats a template without enough unique analysis to stand alone." };
  }
  if (input.uniqueWordCount < MIN_UNIQUE_WORDS) {
    return { index: false, reason: `The page carries ${input.uniqueWordCount} words of unique analysis, below the ${MIN_UNIQUE_WORDS}-word bar.` };
  }
  return { index: true, reason: "The page contains unique, durable analysis of a specific subject." };
}

/**
 * Word count of the parts that vary with the data.
 *
 * Boilerplate is excluded by passing only the generated body; counting the
 * whole page would let a long disclaimer make every stub look substantial.
 */
export function uniqueWordCount(paragraphs: string[]): number {
  return paragraphs.join(" ").split(/\s+/).filter((word) => word.length > 1).length;
}
