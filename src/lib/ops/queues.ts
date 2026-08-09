/**
 * Workspace queues — the named work-lists each role home is organised around.
 *
 * A queue is a view over the case board filtered by category. Defining them here
 * (pure) lets the role pages render "settlement queue: 3", "closing-price queue:
 * 1" from the same case rows the board already reads, with no second source of
 * truth. Queues that draw on non-case sources (approved content, scheduled
 * posts, forum threads) are read directly by the page and noted there.
 */

import type { CaseCategory } from "@/lib/ops/caseCategories";
import type { CaseState } from "@/lib/ops/cases";

export type QueueDef = {
  id: string;
  label: string;
  categories: readonly CaseCategory[];
};

export const MARKET_QUEUES: readonly QueueDef[] = [
  { id: "stale_exceptions", label: "Stale exceptions", categories: ["stale_fixture", "stale_odds"] },
  { id: "market_mapping", label: "Market mapping queue", categories: ["market_mismatch"] },
  { id: "result_verification", label: "Result verification queue", categories: ["result_conflict"] },
  { id: "settlement", label: "Settlement queue", categories: ["settlement_exception"] },
  { id: "closing_price", label: "Closing-price queue", categories: ["missing_close"] },
  { id: "provider_incidents", label: "Provider incidents", categories: ["provider_outage"] },
  { id: "reconciliation_mismatches", label: "Reconciliation mismatches", categories: ["record_mismatch", "identity_mismatch"] }
];

export const COMMUNITY_QUEUES: readonly QueueDef[] = [
  { id: "community_reports", label: "Community reports", categories: ["user_report"] },
  { id: "community_abuse", label: "Abuse / safety", categories: ["community_abuse"] },
  { id: "content_errors", label: "Content errors & corrections", categories: ["content_error"] }
];

const TERMINAL = new Set<CaseState>(["resolved", "dismissed"]);

export type QueueCaseRow = { category?: CaseCategory | null; state: CaseState };

export type QueueCount = { id: string; label: string; count: number };

/**
 * Count active (non-terminal) cases in each queue. Every queue appears in the
 * result even at zero, so a role home shows the full board, not just the busy
 * lanes. A case with no category counts toward nothing.
 */
export function bucketCasesByQueue(cases: readonly QueueCaseRow[], queues: readonly QueueDef[]): QueueCount[] {
  return queues.map((queue) => {
    const set = new Set<CaseCategory>(queue.categories);
    const count = cases.filter((c) => !TERMINAL.has(c.state) && c.category != null && set.has(c.category)).length;
    return { id: queue.id, label: queue.label, count };
  });
}
