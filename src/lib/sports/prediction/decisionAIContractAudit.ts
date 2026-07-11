import type { DecisionAICitationValidator } from "@/lib/sports/prediction/decisionAICitationValidator";
import type { DecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import type { DecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIContractAuditStatus = "accepted-shadow" | "ready-to-request" | "needs-key" | "pending-review" | "quarantined" | "blocked";
export type DecisionAIContractAuditCheckStatus = "pass" | "watch" | "block";

export type DecisionAIContractAuditCheck = {
  id: string;
  label: string;
  status: DecisionAIContractAuditCheckStatus;
  detail: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAIContractAudit = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-review-contract-audit";
  status: DecisionAIContractAuditStatus;
  auditHash: string;
  summary: string;
  checks: DecisionAIContractAuditCheck[];
  counts: {
    pass: number;
    watch: number;
    block: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestOpenAI: boolean;
    canAcceptAIOutput: boolean;
    canTrustAIOutput: boolean;
    canApplyAIToDecision: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
  };
  nextStep: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  blockers: string[];
  proofUrls: string[];
  locks: string[];
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

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && !lower.includes("persist=1") && !lower.includes("persist=true") && !lower.includes("dryrun=0") && !lower.includes("dryrun=false");
}

function check(input: DecisionAIContractAuditCheck): DecisionAIContractAuditCheck {
  return {
    ...input,
    evidence: unique(input.evidence, 8)
  };
}

function buildChecks({
  readiness,
  ledger,
  handoff,
  firewall,
  citations
}: {
  readiness: DecisionAIReviewReadiness;
  ledger: DecisionAIReviewLedger;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  citations: DecisionAICitationValidator;
}): DecisionAIContractAuditCheck[] {
  return [
    check({
      id: "openai-key-gate",
      label: "OpenAI key gate",
      status: readiness.openAiConfigured ? "pass" : "block",
      detail: readiness.openAiConfigured ? "OPENAI_API_KEY is loaded in the server runtime." : "OPENAI_API_KEY is missing from the server runtime.",
      evidence: [`readiness:${readiness.status}`, `missing:${readiness.missingEnv.join(",") || "none"}`],
      nextAction: readiness.openAiConfigured ? "Keep the key server-side and use only guarded run=1 routes." : "Create or reuse an OpenAI key securely, write it to server env, and restart the app."
    }),
    check({
      id: "lane-contracts",
      label: "Lane contracts",
      status: readiness.status === "blocked" ? "block" : readiness.controls.canRunLiveReview ? "pass" : "watch",
      detail: `${readiness.totals.readyLiveReview}/${readiness.totals.lanes} live review lane(s) are ready; ${readiness.totals.deterministicFallbacks} deterministic fallback(s) are declared.`,
      evidence: readiness.lanes.map((lane) => `${lane.id}:${lane.status}:${lane.schemaName}:store=${lane.requestStore}`),
      nextAction: readiness.controls.canRunLiveReview ? "Submit only through explicit run=1 guarded routes." : "Keep deterministic fallbacks active until every lane is ready."
    }),
    check({
      id: "request-storage",
      label: "Request storage",
      status: handoff.requestPreview.store || !ledger.controlContract.noPersistence ? "block" : "pass",
      detail: handoff.requestPreview.store ? "The handoff request preview has storage enabled." : "The handoff request preview is store=false and the ledger forbids persistence.",
      evidence: [`store:${handoff.requestPreview.store}`, `ledgerNoPersistence:${ledger.controlContract.noPersistence}`],
      nextAction: "Keep Responses API requests store=false for the decision reviewer."
    }),
    check({
      id: "schema-and-citations",
      label: "Schema and citations",
      status: citations.rules.some((rule) => rule.id === "citation-schema" && rule.status === "pass") && citations.rules.some((rule) => rule.id === "prompt-grounding" && rule.status === "pass") ? "pass" : "block",
      detail: citations.summary,
      evidence: citations.rules.map((rule) => `${rule.id}:${rule.status}`),
      nextAction: "Require strict JSON schema, citedEvidenceIds, and no-invention prompt language."
    }),
    check({
      id: "proof-ledger",
      label: "Proof ledger",
      status: ledger.status === "blocked" ? "block" : ledger.status === "needs-config" ? "watch" : "pass",
      detail: ledger.summary,
      evidence: [ledger.ledgerHash, `blocked:${ledger.counts.blocked}`, `needsConfig:${ledger.counts.needsConfig}`],
      nextAction: ledger.runbook.requiredBeforeReview[0] ?? "Keep review targets and proof dependencies attached."
    }),
    check({
      id: "handoff-packet",
      label: "Handoff packet",
      status: handoff.status === "ready" ? "pass" : handoff.status === "needs-config" ? "watch" : "block",
      detail: handoff.summary,
      evidence: [handoff.packetHash, handoff.inputHash, `evidence:${handoff.evidence.included}/${handoff.evidence.totalAvailable}`],
      nextAction: handoff.runbook.blockedBy[0] ?? handoff.runbook.missingEnv[0] ?? "Keep the model input packet evidence-bound."
    }),
    check({
      id: "firewall",
      label: "AI output firewall",
      status: firewall.status === "accepted" ? "pass" : firewall.status === "pending-review" ? "watch" : "block",
      detail: firewall.summary,
      evidence: [firewall.firewallHash, `accepted:${firewall.counts.acceptedReviews}`, `quarantined:${firewall.counts.quarantinedReviews}`],
      nextAction: firewall.rules.find((rule) => rule.status === "block")?.requiredAction ?? "Accept only same-or-safer no-persistence output."
    }),
    check({
      id: "citation-validator",
      label: "Citation validator",
      status: citations.status === "valid" ? "pass" : citations.status === "pending-review" ? "watch" : "block",
      detail: citations.summary,
      evidence: [citations.validatorHash, `ids:${citations.evidence.uniqueIds}`, `verified:${citations.counts.verifiedReviews}`],
      nextAction: citations.rules.find((rule) => rule.status === "block")?.nextAction ?? "Validate reviewed output against supplied evidence IDs."
    }),
    check({
      id: "same-or-safer",
      label: "Same-or-safer action",
      status: firewall.rules.find((rule) => rule.id === "same-or-safer")?.status ?? "block",
      detail: firewall.rules.find((rule) => rule.id === "same-or-safer")?.detail ?? "Same-or-safer rule is missing from the firewall.",
      evidence: firewall.reviews.map((review) => `${review.scope}:${review.maximumAllowedAction ?? "none"}->${review.appliedAction ?? "none"}`),
      nextAction: "Never allow AI output to upgrade avoid to monitor/consider or monitor to consider."
    })
  ];
}

function statusFrom({
  readiness,
  handoff,
  firewall,
  citations,
  checks
}: {
  readiness: DecisionAIReviewReadiness;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  citations: DecisionAICitationValidator;
  checks: DecisionAIContractAuditCheck[];
}): DecisionAIContractAuditStatus {
  if (firewall.status === "quarantined" || citations.status === "invalid") return "quarantined";
  if (firewall.status === "accepted" && citations.status === "valid") return "accepted-shadow";
  if (!readiness.openAiConfigured) return "needs-key";
  if (checks.some((item) => item.status === "block")) return "blocked";
  if (handoff.runbook.canSubmitToOpenAI && citations.control.canSubmitToOpenAI) return "ready-to-request";
  return "pending-review";
}

function summaryFor(status: DecisionAIContractAuditStatus, counts: DecisionAIContractAudit["counts"]): string {
  const suffix = `${counts.pass} pass, ${counts.watch} watch, ${counts.block} block.`;
  if (status === "accepted-shadow") return `AI review contract accepted shadow output only; ${suffix}`;
  if (status === "ready-to-request") return `AI review contract is ready for an explicit guarded run=1 request; ${suffix}`;
  if (status === "needs-key") return `AI review contract is wired but waiting for OPENAI_API_KEY; ${suffix}`;
  if (status === "pending-review") return `AI review contract is waiting for a completed guarded review; ${suffix}`;
  if (status === "quarantined") return `AI review contract quarantined the current AI output path; ${suffix}`;
  return `AI review contract is blocked by key, proof, handoff, firewall, or citation gates; ${suffix}`;
}

export function buildDecisionAIContractAudit({
  date,
  sport,
  readiness,
  ledger,
  handoff,
  firewall,
  citations,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  readiness: DecisionAIReviewReadiness;
  ledger: DecisionAIReviewLedger;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  citations: DecisionAICitationValidator;
  now?: Date;
}): DecisionAIContractAudit {
  const checks = buildChecks({ readiness, ledger, handoff, firewall, citations });
  const counts = {
    pass: checks.filter((item) => item.status === "pass").length,
    watch: checks.filter((item) => item.status === "watch").length,
    block: checks.filter((item) => item.status === "block").length
  };
  const status = statusFrom({ readiness, handoff, firewall, citations, checks });
  const nextBlockingCheck = checks.find((item) => item.status === "block") ?? checks.find((item) => item.status === "watch") ?? null;
  const command = handoff.runbook.command ?? citations.control.nextSafeCommand ?? ledger.runbook.firstProofCommand ?? readiness.nextSafeCommand.command;
  const verifyUrl = handoff.runbook.verifyUrl ?? citations.control.verifyUrl ?? ledger.runbook.firstProofUrl ?? readiness.nextSafeCommand.url;

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "ai-review-contract-audit",
    status,
    auditHash: stableHash({
      date,
      sport,
      status,
      readiness: readiness.readinessHash,
      ledger: ledger.ledgerHash,
      handoff: handoff.packetHash,
      firewall: firewall.firewallHash,
      citations: citations.validatorHash,
      checks: checks.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, counts),
    checks,
    counts,
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAI: status === "ready-to-request",
      canAcceptAIOutput: status === "accepted-shadow",
      canTrustAIOutput: status === "accepted-shadow" && citations.control.canTrustAIOutput,
      canApplyAIToDecision: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    nextStep: {
      label: nextBlockingCheck?.label ?? (status === "ready-to-request" ? "Run guarded AI review" : "Inspect AI contract audit"),
      command: commandIsSafe(command) ? command : readiness.nextSafeCommand.command,
      verifyUrl,
      safeToRun: commandIsSafe(command) || readiness.nextSafeCommand.safeToRun,
      expectedEvidence: nextBlockingCheck?.nextAction ?? "Guarded review returns strict, cited, same-or-safer output without persistence."
    },
    blockers: unique([
      ...checks.filter((item) => item.status === "block").map((item) => `${item.label}: ${item.detail}`),
      ...handoff.runbook.blockedBy,
      ...handoff.runbook.missingEnv,
      ...ledger.runbook.requiredBeforeReview
    ]),
    proofUrls: unique([
      "/api/sports/decision/ai-contract-audit",
      "/api/sports/decision/ai-review-readiness",
      "/api/sports/decision/ai-review-ledger",
      "/api/sports/decision/ai-handoff",
      "/api/sports/decision/ai-firewall",
      "/api/sports/decision/ai-citations"
    ]),
    locks: [
      "This audit never calls OpenAI; it inspects contracts only.",
      "AI requests must keep store=false.",
      "AI output must cite supplied evidence IDs.",
      "AI output can only hold or downgrade the deterministic action.",
      "AI output cannot persist, publish, train, raise trust, or upgrade public action."
    ]
  };
}
