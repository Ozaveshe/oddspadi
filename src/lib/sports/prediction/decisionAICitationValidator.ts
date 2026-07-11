import type { DecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import type { DecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import type { Sport } from "@/lib/sports/types";

export type DecisionAICitationValidatorStatus = "valid" | "pending-review" | "invalid" | "blocked";
export type DecisionAICitationRuleStatus = "pass" | "watch" | "block";
export type DecisionAICitationReviewStatus = "verified" | "pending" | "missing-citations" | "quarantined";

export type DecisionAICitationRule = {
  id: string;
  label: string;
  status: DecisionAICitationRuleStatus;
  detail: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAICitationReview = {
  scope: string;
  status: DecisionAICitationReviewStatus;
  reviewStatus: string;
  accepted: boolean;
  citedEvidenceIds: string[];
  invalidEvidenceIds: string[];
  reason: string;
};

export type DecisionAICitationValidator = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAICitationValidatorStatus;
  mode: "ai-citation-validator";
  validatorHash: string;
  summary: string;
  evidence: {
    total: number;
    included: number;
    uniqueIds: number;
    sourceCount: number;
    sources: string[];
  };
  reviews: DecisionAICitationReview[];
  rules: DecisionAICitationRule[];
  counts: {
    pass: number;
    watch: number;
    block: number;
    verifiedReviews: number;
    pendingReviews: number;
    invalidReviews: number;
  };
  control: {
    canTrustAIOutput: boolean;
    canSubmitToOpenAI: boolean;
    canPersist: false;
    canPublish: false;
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

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && !lower.includes("persist=1") && !lower.includes("persist=true") && !lower.includes("-x post");
}

function rule(input: DecisionAICitationRule): DecisionAICitationRule {
  return {
    ...input,
    evidence: unique(input.evidence, 6)
  };
}

function schemaRequiresCitations(handoff: DecisionAIHandoffPacket): boolean {
  const schemaText = JSON.stringify(handoff.requestPreview.text.format.schema).toLowerCase();
  return (
    handoff.outputContract.mustCiteEvidenceIds &&
    schemaText.includes("citedevidenceids") &&
    handoff.outputContract.requiredFields.includes("reasoningTrace") &&
    handoff.outputContract.requiredFields.includes("evidenceChecks")
  );
}

function promptRequiresGrounding(handoff: DecisionAIHandoffPacket): boolean {
  const prompt = handoff.prompt.system.toLowerCase();
  return prompt.includes("use only") && prompt.includes("evidence") && prompt.includes("do not invent");
}

function reviewCitations({
  firewall,
  evidenceIds
}: {
  firewall: DecisionAIFirewall;
  evidenceIds: Set<string>;
}): DecisionAICitationReview[] {
  return firewall.reviews.map((review) => {
    const citedEvidenceIds = review.evidence.filter((item) => evidenceIds.has(item));
    const invalidEvidenceIds = review.evidence.filter((item) => item.startsWith("evidence-") && !evidenceIds.has(item));
    const reviewed = review.status === "reviewed";
    const missingCitations = reviewed && citedEvidenceIds.length === 0;
    return {
      scope: review.scope,
      status: review.quarantined ? "quarantined" : !reviewed ? "pending" : missingCitations || invalidEvidenceIds.length ? "missing-citations" : "verified",
      reviewStatus: review.status,
      accepted: review.accepted,
      citedEvidenceIds,
      invalidEvidenceIds,
      reason: review.quarantined
        ? review.reason
        : !reviewed
          ? "Review has not completed, so citations cannot be validated yet."
          : missingCitations
            ? "Review completed but no supplied evidence IDs were available in the firewall metadata."
            : invalidEvidenceIds.length
              ? "Review cited evidence IDs that were not in the handoff packet."
              : "Review citations match the supplied handoff evidence IDs."
    };
  });
}

function buildRules({
  handoff,
  firewall,
  reviews
}: {
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  reviews: DecisionAICitationReview[];
}): DecisionAICitationRule[] {
  const ids = handoff.evidence.ids;
  const uniqueIds = new Set(ids);
  const duplicateIds = ids.length - uniqueIds.size;
  const sources = unique(handoff.evidence.items.map((item) => item.source), 50);
  const schemaOk = schemaRequiresCitations(handoff);
  const promptOk = promptRequiresGrounding(handoff);
  const unsafeCommand = Boolean(handoff.runbook.command && !commandIsSafe(handoff.runbook.command));
  const reviewed = reviews.filter((item) => item.reviewStatus === "reviewed");
  const badReview = reviews.find((item) => item.status === "missing-citations" || item.status === "quarantined");

  return [
    rule({
      id: "evidence-docket",
      label: "Evidence docket",
      status: ids.length && !duplicateIds ? "pass" : "block",
      detail: ids.length ? `${ids.length} evidence ID(s) are available across ${sources.length} source bucket(s).` : "No evidence IDs are available for AI citation.",
      evidence: [`ids:${ids.length}`, `unique:${uniqueIds.size}`, `duplicates:${duplicateIds}`],
      nextAction: duplicateIds ? "Remove duplicate evidence IDs before model review." : "Keep evidence IDs stable through review and firewall checks."
    }),
    rule({
      id: "citation-schema",
      label: "Citation schema",
      status: schemaOk ? "pass" : "block",
      detail: schemaOk ? "The model response schema requires citedEvidenceIds in reasoning and evidence checks." : "The model response schema does not enforce cited evidence IDs.",
      evidence: [handoff.outputContract.schemaName, `mustCite:${handoff.outputContract.mustCiteEvidenceIds}`, ...handoff.outputContract.requiredFields],
      nextAction: "Require reasoningTrace and evidenceChecks to cite supplied evidence IDs."
    }),
    rule({
      id: "prompt-grounding",
      label: "Prompt grounding",
      status: promptOk ? "pass" : "block",
      detail: promptOk ? "The system prompt tells the model to use supplied evidence only and not invent facts." : "The system prompt is missing evidence-only or no-invention language.",
      evidence: [handoff.prompt.system],
      nextAction: "Keep no-invention and supplied-evidence-only instructions in the system prompt."
    }),
    rule({
      id: "review-citations",
      label: "Review citations",
      status: badReview ? "block" : reviewed.length ? "pass" : "watch",
      detail: badReview ? badReview.reason : reviewed.length ? `${reviewed.length} reviewed output item(s) have verifiable citation metadata.` : "No completed AI review output is available to validate yet.",
      evidence: reviews.map((item) => `${item.scope}:${item.status}:${item.citedEvidenceIds.length}`),
      nextAction: badReview ? "Quarantine AI output until it cites supplied evidence IDs." : "Run a guarded review and retain cited evidence IDs in firewall metadata."
    }),
    rule({
      id: "no-persistence",
      label: "No persistence",
      status: handoff.requestPreview.store || unsafeCommand ? "block" : "pass",
      detail: handoff.requestPreview.store ? "The AI request preview requested storage." : unsafeCommand ? "The handoff command is not safe for citation validation." : "The AI request is store-off and the handoff command is read-only.",
      evidence: [`store:${handoff.requestPreview.store}`, handoff.runbook.command ?? "no-command"],
      nextAction: "Keep AI citation validation read-only until activation proof passes."
    }),
    rule({
      id: "firewall-alignment",
      label: "Firewall alignment",
      status: firewall.status === "accepted" ? (badReview ? "block" : "pass") : firewall.status === "pending-review" ? "watch" : "block",
      detail: `Firewall state is ${firewall.status}.`,
      evidence: [firewall.firewallHash, `accepted:${firewall.counts.acceptedReviews}`, `quarantined:${firewall.counts.quarantinedReviews}`],
      nextAction: firewall.status === "accepted" ? "Allow only same-or-safer cited AI output to proceed." : "Keep AI output held behind firewall and citation validation."
    })
  ];
}

function statusFromRules({
  handoff,
  rules,
  reviews
}: {
  handoff: DecisionAIHandoffPacket;
  rules: DecisionAICitationRule[];
  reviews: DecisionAICitationReview[];
}): DecisionAICitationValidatorStatus {
  if (handoff.status === "blocked") return "blocked";
  if (rules.some((item) => item.status === "block")) return "invalid";
  if (!reviews.some((item) => item.status === "verified")) return "pending-review";
  return "valid";
}

export function buildDecisionAICitationValidator({
  date,
  sport,
  handoff,
  firewall
}: {
  date: string;
  sport: Sport;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
}): DecisionAICitationValidator {
  const evidenceIds = new Set(handoff.evidence.ids);
  const reviews = reviewCitations({ firewall, evidenceIds });
  const rules = buildRules({ handoff, firewall, reviews });
  const status = statusFromRules({ handoff, rules, reviews });
  const pass = rules.filter((item) => item.status === "pass").length;
  const watch = rules.filter((item) => item.status === "watch").length;
  const block = rules.filter((item) => item.status === "block").length;
  const verifiedReviews = reviews.filter((item) => item.status === "verified").length;
  const pendingReviews = reviews.filter((item) => item.status === "pending").length;
  const invalidReviews = reviews.filter((item) => item.status === "missing-citations" || item.status === "quarantined").length;
  const sources = unique(handoff.evidence.items.map((item) => item.source), 50);
  const canTrustAIOutput = status === "valid" && firewall.status === "accepted";
  const validatorHash = stableHash({
    date,
    sport,
    status,
    handoff: handoff.packetHash,
    firewall: firewall.firewallHash,
    evidenceIds: handoff.evidence.ids,
    rules: rules.map((item) => ({ id: item.id, status: item.status })),
    reviews: reviews.map((item) => ({ scope: item.scope, status: item.status, cited: item.citedEvidenceIds.length }))
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "ai-citation-validator",
    validatorHash,
    summary:
      status === "valid"
        ? `AI citation validator verified ${verifiedReviews} review item(s) against supplied evidence IDs.`
        : status === "pending-review"
          ? "AI citation validator is ready but waiting for a completed model review."
          : status === "blocked"
            ? "AI citation validator is blocked because the handoff packet or proof path is blocked."
            : "AI citation validator rejected the current AI review path because citations or grounding are invalid.",
    evidence: {
      total: handoff.evidence.totalAvailable,
      included: handoff.evidence.included,
      uniqueIds: evidenceIds.size,
      sourceCount: sources.length,
      sources
    },
    reviews,
    rules,
    counts: {
      pass,
      watch,
      block,
      verifiedReviews,
      pendingReviews,
      invalidReviews
    },
    control: {
      canTrustAIOutput,
      canSubmitToOpenAI: handoff.runbook.canSubmitToOpenAI && pass >= 4 && block === 0,
      canPersist: false,
      canPublish: false,
      nextSafeCommand: handoff.runbook.command ?? firewall.control.nextSafeCommand,
      verifyUrl: handoff.runbook.verifyUrl ?? firewall.control.verifyUrl,
      forbiddenActions: unique([
        "Do not trust AI output without cited supplied evidence IDs.",
        "Do not accept invented injuries, lineups, odds moves, scores, weather, or news.",
        "Do not persist citation validation output.",
        "Do not publish AI-reviewed decisions until citation validation, firewall, authority, and activation proof pass.",
        ...firewall.control.forbiddenActions
      ])
    }
  };
}
