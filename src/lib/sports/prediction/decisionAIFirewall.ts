import type { DecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import type { DecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import type { DecisionAIOrchestrator, DecisionAIOrchestratorRunItem } from "@/lib/sports/prediction/decisionAIOrchestrator";
import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionAIFirewallStatus = "accepted" | "pending-review" | "quarantined" | "blocked";
export type DecisionAIFirewallRuleStatus = "pass" | "watch" | "block";

export type DecisionAIFirewallRule = {
  id: string;
  label: string;
  status: DecisionAIFirewallRuleStatus;
  detail: string;
  requiredAction: string;
  evidence: string[];
};

export type DecisionAIFirewallReview = {
  scope: DecisionAIOrchestratorRunItem["scope"];
  provider: DecisionAIOrchestratorRunItem["provider"];
  status: DecisionAIOrchestratorRunItem["status"] | "not-run";
  reviewVerdict: string | null;
  appliedAction: DecisionAction | null;
  maximumAllowedAction: DecisionAction | null;
  accepted: boolean;
  quarantined: boolean;
  reason: string;
  evidence: string[];
};

export type DecisionAIFirewall = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAIFirewallStatus;
  mode: "ai-output-firewall";
  firewallHash: string;
  summary: string;
  activeTarget: string | null;
  reviews: DecisionAIFirewallReview[];
  rules: DecisionAIFirewallRule[];
  counts: {
    reviews: number;
    acceptedReviews: number;
    quarantinedReviews: number;
    pass: number;
    watch: number;
    block: number;
  };
  control: {
    canApplyToDecision: boolean;
    canPersist: false;
    canPublish: false;
    canUpgrade: false;
    nextSafeCommand: string | null;
    verifyUrl: string | null;
    forbiddenActions: string[];
  };
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: string[], limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function actionRank(action: DecisionAction | null): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function sameOrSafer(applied: DecisionAction | null, maximum: DecisionAction | null): boolean {
  if (!applied || !maximum) return false;
  return actionRank(applied) <= actionRank(maximum);
}

function maximumActionForScope({
  scope,
  handoff,
  council
}: {
  scope: DecisionAIOrchestratorRunItem["scope"];
  handoff: DecisionAIHandoffPacket;
  council: DecisionAICouncil;
}): DecisionAction | null {
  if (scope === "slate") return council.finalAction;
  return handoff.activeTarget?.maximumAllowedAction ?? null;
}

function reviewEvidence(item: DecisionAIOrchestratorRunItem): string[] {
  return unique([
    `provider:${item.provider}`,
    `status:${item.status}`,
    item.model ? `model:${item.model}` : "",
    item.reviewVerdict ? `verdict:${item.reviewVerdict}` : "",
    item.appliedAction ? `applied:${item.appliedAction}` : "",
    item.safeNoPersistence ? "safeNoPersistence:true" : "safeNoPersistence:false",
    item.reason ?? ""
  ]);
}

function reviewItem({
  item,
  handoff,
  council
}: {
  item: DecisionAIOrchestratorRunItem;
  handoff: DecisionAIHandoffPacket;
  council: DecisionAICouncil;
}): DecisionAIFirewallReview {
  const maximumAllowedAction = maximumActionForScope({ scope: item.scope, handoff, council });
  const actionSafe = sameOrSafer(item.appliedAction, maximumAllowedAction);
  const reviewed = item.status === "reviewed";
  const accepted = reviewed && item.safeNoPersistence && actionSafe;
  const quarantined = reviewed && (!item.safeNoPersistence || !actionSafe);

  return {
    scope: item.scope,
    provider: item.provider,
    status: item.status,
    reviewVerdict: item.reviewVerdict,
    appliedAction: item.appliedAction,
    maximumAllowedAction,
    accepted,
    quarantined,
    reason: !reviewed
      ? item.reason ?? "AI review has not completed."
      : !item.safeNoPersistence
        ? "AI review is not marked safe for no-persistence handling."
        : !actionSafe
          ? "AI review attempted to apply a stronger action than the deterministic baseline."
          : "AI review is same-or-safer and safe for no-persistence handling.",
    evidence: reviewEvidence(item)
  };
}

function rule(input: DecisionAIFirewallRule): DecisionAIFirewallRule {
  return {
    ...input,
    evidence: unique(input.evidence, 6)
  };
}

function rulesFor({
  handoff,
  orchestrator,
  aiReviewLedger,
  metacognition,
  reviews
}: {
  handoff: DecisionAIHandoffPacket;
  orchestrator: DecisionAIOrchestrator;
  aiReviewLedger: DecisionAIReviewLedger;
  metacognition: DecisionMetacognition;
  reviews: DecisionAIFirewallReview[];
}): DecisionAIFirewallRule[] {
  const reviewed = reviews.filter((item) => item.status === "reviewed");
  const anyUpgrade = reviews.some((item) => item.appliedAction && item.maximumAllowedAction && !sameOrSafer(item.appliedAction, item.maximumAllowedAction));
  const anyUnsafePersistence = orchestrator.latestRun.items.some((item) => !item.safeNoPersistence);
  const anyProviderFailure = orchestrator.latestRun.items.some((item) => item.status === "provider-error" || item.status === "invalid-response");

  return [
    rule({
      id: "handoff-state",
      label: "Handoff state",
      status: handoff.status === "blocked" ? "block" : handoff.status === "needs-config" ? "watch" : "pass",
      detail: handoff.summary,
      requiredAction: handoff.runbook.blockedBy[0] ?? handoff.runbook.missingEnv[0] ?? "Keep the handoff packet with the review evidence.",
      evidence: [handoff.packetHash, handoff.inputHash, `status:${handoff.status}`]
    }),
    rule({
      id: "review-completed",
      label: "Review completed",
      status: reviewed.length ? "pass" : anyProviderFailure ? "block" : "watch",
      detail: reviewed.length ? `${reviewed.length} AI review item(s) completed.` : "No completed AI review item is available to accept.",
      requiredAction: reviewed.length ? "Keep the completed review behind the firewall until all rules pass." : "Run a guarded review after OpenAI and proof gates are ready.",
      evidence: orchestrator.latestRun.items.flatMap(reviewEvidence)
    }),
    rule({
      id: "same-or-safer",
      label: "Same-or-safer action",
      status: anyUpgrade ? "block" : reviewed.length ? "pass" : "watch",
      detail: anyUpgrade ? "At least one AI review tried to apply a stronger action than the deterministic baseline." : "No AI review upgrade was detected.",
      requiredAction: anyUpgrade ? "Quarantine the AI output and keep the deterministic or safer action." : "Continue enforcing avoid < monitor < consider.",
      evidence: reviews.map((item) => `${item.scope}:${item.maximumAllowedAction ?? "none"}->${item.appliedAction ?? "none"}`)
    }),
    rule({
      id: "no-persistence",
      label: "No persistence",
      status: anyUnsafePersistence || handoff.requestPreview.store ? "block" : "pass",
      detail: handoff.requestPreview.store ? "The AI request preview requested storage." : "AI request preview and run items are marked no-persistence.",
      requiredAction: "Never persist AI output from this firewall without activation proof.",
      evidence: [`store:${handoff.requestPreview.store}`, ...orchestrator.latestRun.items.map((item) => `safeNoPersistence:${item.safeNoPersistence}`)]
    }),
    rule({
      id: "proof-ledger",
      label: "Proof ledger",
      status: aiReviewLedger.status === "blocked" ? "block" : aiReviewLedger.status === "needs-config" ? "watch" : "pass",
      detail: aiReviewLedger.summary,
      requiredAction: aiReviewLedger.runbook.requiredBeforeReview[0] ?? "Keep proof receipts attached to review acceptance.",
      evidence: [aiReviewLedger.ledgerHash, `blocked:${aiReviewLedger.counts.blocked}`, `needsConfig:${aiReviewLedger.counts.needsConfig}`]
    }),
    rule({
      id: "metacognition-state",
      label: "Metacognition state",
      status: metacognition.status === "blocked" ? "block" : metacognition.status === "watching" ? "watch" : "pass",
      detail: metacognition.summary,
      requiredAction: metacognition.primaryDoubt,
      evidence: [metacognition.metacognitionHash, `mode:${metacognition.mode}`, `blocks:${metacognition.counts.block}`]
    })
  ];
}

function statusFromRules({
  rules,
  reviews
}: {
  rules: DecisionAIFirewallRule[];
  reviews: DecisionAIFirewallReview[];
}): DecisionAIFirewallStatus {
  if (rules.some((item) => item.id !== "review-completed" && item.status === "block")) return "blocked";
  if (reviews.some((item) => item.quarantined) || rules.some((item) => item.status === "block")) return "quarantined";
  if (!reviews.some((item) => item.accepted)) return "pending-review";
  return "accepted";
}

export function buildDecisionAIFirewall({
  date,
  sport,
  council,
  orchestrator,
  aiReviewLedger,
  metacognition,
  handoff
}: {
  date: string;
  sport: Sport;
  council: DecisionAICouncil;
  orchestrator: DecisionAIOrchestrator;
  aiReviewLedger: DecisionAIReviewLedger;
  metacognition: DecisionMetacognition;
  handoff: DecisionAIHandoffPacket;
}): DecisionAIFirewall {
  const reviews = orchestrator.latestRun.items.map((item) => reviewItem({ item, handoff, council }));
  const rules = rulesFor({ handoff, orchestrator, aiReviewLedger, metacognition, reviews });
  const status = statusFromRules({ rules, reviews });
  const pass = rules.filter((item) => item.status === "pass").length;
  const watch = rules.filter((item) => item.status === "watch").length;
  const block = rules.filter((item) => item.status === "block").length;
  const acceptedReviews = reviews.filter((item) => item.accepted).length;
  const quarantinedReviews = reviews.filter((item) => item.quarantined).length;
  const canApplyToDecision = status === "accepted";
  const firewallHash = stableHash({
    date,
    sport,
    status,
    handoff: handoff.packetHash,
    ledger: aiReviewLedger.ledgerHash,
    metacognition: metacognition.metacognitionHash,
    rules: rules.map((item) => ({ id: item.id, status: item.status })),
    reviews: reviews.map((item) => ({ scope: item.scope, status: item.status, appliedAction: item.appliedAction, accepted: item.accepted }))
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "ai-output-firewall",
    firewallHash,
    summary:
      status === "accepted"
        ? `AI firewall accepted ${acceptedReviews} review item(s) for same-or-safer in-memory application.`
        : status === "quarantined"
          ? `AI firewall quarantined ${quarantinedReviews} review item(s); keep deterministic action.`
          : status === "blocked"
            ? "AI firewall is blocked by handoff, proof, or metacognition requirements."
            : "AI firewall is waiting for a completed guarded AI review.",
    activeTarget: handoff.activeTarget?.label ?? null,
    reviews,
    rules,
    counts: {
      reviews: reviews.length,
      acceptedReviews,
      quarantinedReviews,
      pass,
      watch,
      block
    },
    control: {
      canApplyToDecision,
      canPersist: false,
      canPublish: false,
      canUpgrade: false,
      nextSafeCommand: handoff.runbook.command ?? metacognition.runbook.nextSafeCommand,
      verifyUrl: handoff.runbook.verifyUrl ?? metacognition.runbook.verifyUrl,
      forbiddenActions: unique([
        "Do not apply quarantined AI output.",
        "Do not persist AI output from this firewall.",
        "Do not publish AI output until activation proof and provider evidence pass.",
        "Do not let AI output upgrade a deterministic action.",
        ...handoff.runbook.forbiddenActions
      ])
    }
  };
}
