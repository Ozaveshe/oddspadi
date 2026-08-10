/**
 * Training scenarios — a fixed set of synthetic exercises new staff practise on.
 *
 * Every scenario is invented data (ids prefixed `SYNTHETIC-`) and every choice
 * is evaluated purely in code. Nothing here reads or writes a production table:
 * the sandbox teaches the judgement calls — void vs grade, map vs ignore, reject
 * a guaranteed-win claim — without any path to production. This is the "training
 * data mode" the brief asks for; the workspace's training flag
 * (ODDSPADI_OPS_TRAINING) is the complementary "actions never write" guarantee.
 */

export type TrainingTask =
  | "resolve_stale_fixture"
  | "map_market"
  | "settle_edge_case"
  | "approve_content"
  | "moderate_report";

export type TrainingOption = { id: string; label: string; correct: boolean; feedback: string };

export type TrainingScenario = {
  id: string;
  task: TrainingTask;
  title: string;
  brief: string;
  options: readonly TrainingOption[];
};

export const TRAINING_SCENARIOS: readonly TrainingScenario[] = [
  {
    id: "SYNTHETIC-stale-fixture-1",
    task: "resolve_stale_fixture",
    title: "A fixture card has not updated in three hours",
    brief: "SYNTHETIC-fixture-8842 shows a live score last synced 3h ago. Kick-off was 4h ago. What do you do?",
    options: [
      { id: "verify_as_is", label: "Mark the result verified from the current score", correct: false, feedback: "The score is stale — verifying it risks settling on a wrong result. Re-pull first." },
      { id: "resync_then_verify", label: "Re-pull from the provider, then verify the final score", correct: true, feedback: "Correct. A stale card is refreshed before it is trusted; only a fresh final result is verified." },
      { id: "delete", label: "Delete the fixture to clear the queue", correct: false, feedback: "Never delete to clear a queue — that destroys evidence and the fixture will re-import." }
    ]
  },
  {
    id: "SYNTHETIC-map-market-1",
    task: "map_market",
    title: "An unmapped market has appeared",
    brief: "SYNTHETIC-market 'Total Corners Over 9.5' has no canonical mapping. How do you map it?",
    options: [
      { id: "nearest_goals", label: "Map it to the existing 'Total Goals Over 2.5'", correct: false, feedback: "Corners and goals are different markets — mapping them together would settle one from the other." },
      { id: "new_canonical", label: "Create a new canonical corners mapping with the 9.5 line", correct: true, feedback: "Correct. A genuinely new market gets its own canonical mapping, line preserved." },
      { id: "ignore", label: "Leave it unmapped", correct: false, feedback: "Leaving it unmapped strands the odds — the case stays open and the market never prices." }
    ]
  },
  {
    id: "SYNTHETIC-settle-edge-1",
    task: "settle_edge_case",
    title: "An abandoned match with a partial score",
    brief: "SYNTHETIC-fixture-9001 was abandoned at 1-0 after 55 minutes. A published pick was Over 2.5 goals. How does it settle?",
    options: [
      { id: "grade_partial", label: "Grade it lost from the 1-0 partial score", correct: false, feedback: "An abandoned match has no official result — grading a partial score invents an outcome." },
      { id: "void", label: "Void the market — the match did not complete", correct: true, feedback: "Correct. Abandoned fixtures void; the stake is returned, and it never enters the win/loss record." },
      { id: "won", label: "Mark it won because Over looked likely", correct: false, feedback: "Likelihood is not a result. Never settle on what might have happened." }
    ]
  },
  {
    id: "SYNTHETIC-approve-content-1",
    task: "approve_content",
    title: "A draft with a guaranteed-win claim",
    brief: "A SYNTHETIC draft article says 'this bet is a guaranteed 5-0 win'. Do you approve it?",
    options: [
      { id: "publish", label: "Approve and publish", correct: false, feedback: "A guaranteed-win claim can never be published — it is unsupported and against the responsible-use policy." },
      { id: "reject", label: "Reject it — no guaranteed outcomes, unsupported claim", correct: true, feedback: "Correct. Reject the claim; content must be supported by the ledger and never promise a certain outcome." },
      { id: "silent_edit", label: "Quietly edit the number and publish", correct: false, feedback: "A silent edit hides the problem. Reject with a reason so the author learns the boundary." }
    ]
  },
  {
    id: "SYNTHETIC-moderate-report-1",
    task: "moderate_report",
    title: "A report of a paid-tips scam post",
    brief: "A SYNTHETIC community post sells 'VIP fixed matches, DM to pay'. A user reported it. What action?",
    options: [
      { id: "dismiss", label: "Dismiss the report", correct: false, feedback: "This is a clear scam/paid-tips violation — dismissing it leaves harm live." },
      { id: "hide_and_flag", label: "Hide the post, flag the account, log the reason", correct: true, feedback: "Correct. Hide the content, flag the account for integrity, and record the reason in the audit log." },
      { id: "delete_user", label: "Permanently delete the user's account", correct: false, feedback: "Deletion is disproportionate and destroys evidence. Hide and flag; escalation decides account status." }
    ]
  }
];

export function trainingScenario(id: string): TrainingScenario | null {
  return TRAINING_SCENARIOS.find((s) => s.id === id) ?? null;
}

/** Evaluate a trainee's choice, purely. Returns null for an unknown scenario/option. */
export function evaluateTrainingChoice(scenarioId: string, optionId: string): { correct: boolean; feedback: string } | null {
  const scenario = trainingScenario(scenarioId);
  const option = scenario?.options.find((o) => o.id === optionId);
  if (!option) return null;
  return { correct: option.correct, feedback: option.feedback };
}
