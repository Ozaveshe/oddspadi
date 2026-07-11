import type { DecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import type { DecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import type { DecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import type { ConfidenceLevel, DecisionAction, Match, Prediction, RiskLevel, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionAuthorityStatus = "authorized" | "supervised" | "blocked";
export type DecisionAuthoritySource = "deterministic" | "ai-reviewed" | "ai-quarantined" | "proof-blocked";
export type DecisionAuthorityPosture = "public-candidate" | "watchlist-only" | "internal-only";
export type DecisionAuthorityChainStatus = "pass" | "watch" | "block";

export type DecisionAuthorityChainItem = {
  id: string;
  label: string;
  status: DecisionAuthorityChainStatus;
  detail: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAuthority = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAuthorityStatus;
  mode: "decision-authority";
  authorityHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    baselineAction: DecisionAction | null;
    revisedAction: DecisionAction | null;
    authorizedAction: DecisionAction;
    source: DecisionAuthoritySource;
    publicPosture: DecisionAuthorityPosture;
    confidence: ConfidenceLevel;
    risk: RiskLevel;
    reason: string;
  };
  chain: DecisionAuthorityChainItem[];
  counts: {
    pass: number;
    watch: number;
    block: number;
  };
  control: {
    canDisplayCandidate: boolean;
    canApplyAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrainFromResult: false;
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

function safestAction(current: DecisionAction | null, proposed: DecisionAction | null): DecisionAction {
  const currentAction = current ?? "avoid";
  const proposedAction = proposed ?? "avoid";
  return actionRank(proposedAction) <= actionRank(currentAction) ? proposedAction : currentAction;
}

function lowerConfidence(confidence: ConfidenceLevel | null): ConfidenceLevel {
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

function raiseRisk(risk: RiskLevel | null): RiskLevel {
  if (risk === "low") return "medium";
  return "high";
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function activeRow(rows: DecisionRow[], handoff: DecisionAIHandoffPacket): DecisionRow | null {
  const matchId = handoff.activeTarget?.matchId;
  if (matchId) return rows.find((row) => row.match.id === matchId) ?? rows[0] ?? null;
  return rows[0] ?? null;
}

function revisedActionFor(row: DecisionRow | null, metacognition: DecisionMetacognition): DecisionAction | null {
  if (!row) return null;
  if (metacognition.activeBelief?.matchId === row.match.id) return metacognition.activeBelief.revisedAction;
  return row.prediction.decision.action;
}

function acceptedAIAction(firewall: DecisionAIFirewall): DecisionAction | null {
  return firewall.reviews.find((review) => review.accepted)?.appliedAction ?? null;
}

function sourceFor({
  firewall,
  proofRunner,
  aiReviewLedger,
  metacognition
}: {
  firewall: DecisionAIFirewall;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
  metacognition: DecisionMetacognition;
}): DecisionAuthoritySource {
  if (proofRunner.status === "blocked" || aiReviewLedger.status === "blocked" || metacognition.status === "blocked" || firewall.status === "blocked") return "proof-blocked";
  if (firewall.status === "accepted") return "ai-reviewed";
  if (firewall.status === "quarantined") return "ai-quarantined";
  return "deterministic";
}

function statusFor({
  source,
  authorizedAction,
  firewall,
  proofRunner,
  metacognition
}: {
  source: DecisionAuthoritySource;
  authorizedAction: DecisionAction;
  firewall: DecisionAIFirewall;
  proofRunner: DecisionProofRunner;
  metacognition: DecisionMetacognition;
}): DecisionAuthorityStatus {
  if (source === "proof-blocked" || authorizedAction === "avoid") return "blocked";
  if (source === "ai-reviewed" && firewall.status === "accepted" && proofRunner.status === "verified" && metacognition.status === "clear") return "authorized";
  return "supervised";
}

function postureFor(status: DecisionAuthorityStatus, action: DecisionAction): DecisionAuthorityPosture {
  if (status === "authorized" && action === "consider") return "public-candidate";
  if (status !== "blocked" && action !== "avoid") return "watchlist-only";
  return "internal-only";
}

function chainItem(input: DecisionAuthorityChainItem): DecisionAuthorityChainItem {
  return {
    ...input,
    evidence: unique(input.evidence, 5)
  };
}

function buildChain({
  source,
  row,
  metacognition,
  handoff,
  firewall,
  proofRunner,
  aiReviewLedger
}: {
  source: DecisionAuthoritySource;
  row: DecisionRow | null;
  metacognition: DecisionMetacognition;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): DecisionAuthorityChainItem[] {
  return [
    chainItem({
      id: "deterministic-baseline",
      label: "Deterministic baseline",
      status: row ? "pass" : "block",
      detail: row ? row.prediction.decision.summary : "No deterministic decision row is available.",
      evidence: row ? [row.match.id, `action:${row.prediction.decision.action}`, `score:${row.prediction.decision.decisionScore}`] : [],
      nextAction: row?.prediction.decision.nextChecks[0] ?? "Load a deterministic match decision first."
    }),
    chainItem({
      id: "belief-revision",
      label: "Belief revision",
      status: metacognition.status === "blocked" ? "block" : metacognition.status === "watching" ? "watch" : "pass",
      detail: metacognition.summary,
      evidence: [metacognition.metacognitionHash, `mode:${metacognition.mode}`, `active:${metacognition.activeBelief?.status ?? "none"}`],
      nextAction: metacognition.primaryDoubt
    }),
    chainItem({
      id: "ai-handoff",
      label: "AI handoff",
      status: handoff.status === "blocked" ? "block" : handoff.status === "needs-config" ? "watch" : "pass",
      detail: handoff.summary,
      evidence: [handoff.packetHash, handoff.inputHash, `evidence:${handoff.evidence.included}`],
      nextAction: handoff.runbook.blockedBy[0] ?? handoff.runbook.missingEnv[0] ?? "Keep the handoff packet ready for review."
    }),
    chainItem({
      id: "ai-firewall",
      label: "AI firewall",
      status: firewall.status === "accepted" ? "pass" : firewall.status === "pending-review" ? "watch" : "block",
      detail: firewall.summary,
      evidence: [firewall.firewallHash, `reviews:${firewall.counts.reviews}`, `source:${source}`],
      nextAction: firewall.rules.find((rule) => rule.status === "block")?.requiredAction ?? firewall.rules.find((rule) => rule.status === "watch")?.requiredAction ?? "Keep accepted AI review behind the authority gate."
    }),
    chainItem({
      id: "proof-ledger",
      label: "Proof ledger",
      status: proofRunner.status === "blocked" || aiReviewLedger.status === "blocked" ? "block" : proofRunner.status === "partial" || aiReviewLedger.status === "needs-config" ? "watch" : "pass",
      detail: `${proofRunner.summary} ${aiReviewLedger.summary}`,
      evidence: [`proof:${proofRunner.status}`, `ledger:${aiReviewLedger.status}`, aiReviewLedger.ledgerHash],
      nextAction: proofRunner.nextReceipt?.expectedEvidence ?? aiReviewLedger.runbook.requiredBeforeReview[0] ?? "Keep proof receipts attached."
    })
  ];
}

export function buildDecisionAuthority({
  rows,
  date,
  sport,
  metacognition,
  handoff,
  firewall,
  proofRunner,
  aiReviewLedger
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  metacognition: DecisionMetacognition;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): DecisionAuthority {
  const row = activeRow(rows, handoff);
  const baselineAction = row?.prediction.decision.action ?? null;
  const revisedAction = revisedActionFor(row, metacognition);
  const source = sourceFor({ firewall, proofRunner, aiReviewLedger, metacognition });
  const revisedOrBaseline = safestAction(baselineAction, revisedAction);
  const aiAction = acceptedAIAction(firewall);
  const authorizedAction =
    source === "proof-blocked"
      ? safestAction(revisedOrBaseline, "avoid")
      : source === "ai-reviewed"
        ? safestAction(revisedOrBaseline, aiAction)
        : source === "ai-quarantined"
          ? safestAction(revisedOrBaseline, "monitor")
          : revisedOrBaseline;
  const status = statusFor({ source, authorizedAction, firewall, proofRunner, metacognition });
  const publicPosture = postureFor(status, authorizedAction);
  const confidence = status === "blocked" || authorizedAction !== baselineAction ? lowerConfidence(row?.prediction.decision.confidence ?? null) : row?.prediction.decision.confidence ?? "low";
  const risk = status === "blocked" || authorizedAction !== baselineAction ? raiseRisk(row?.prediction.decision.risk ?? null) : row?.prediction.decision.risk ?? "high";
  const chain = buildChain({ source, row, metacognition, handoff, firewall, proofRunner, aiReviewLedger });
  const pass = chain.filter((item) => item.status === "pass").length;
  const watch = chain.filter((item) => item.status === "watch").length;
  const block = chain.filter((item) => item.status === "block").length;
  const authorityHash = stableHash({
    date,
    sport,
    status,
    source,
    activeMatchId: row?.match.id ?? null,
    baselineAction,
    revisedAction,
    authorizedAction,
    posture: publicPosture,
    chain: chain.map((item) => ({ id: item.id, status: item.status })),
    handoff: handoff.packetHash,
    firewall: firewall.firewallHash
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "decision-authority",
    authorityHash,
    summary:
      status === "authorized"
        ? `Decision authority can use ${source} for ${row ? matchLabel(row) : "the active match"} in ${publicPosture} posture.`
        : status === "supervised"
          ? `Decision authority is supervised; use ${authorizedAction} from ${source} and keep public posture ${publicPosture}.`
          : `Decision authority is blocked; use ${authorizedAction} and keep the active decision internal until proof clears.`,
    activeDecision: {
      matchId: row?.match.id ?? null,
      match: row ? matchLabel(row) : null,
      baselineAction,
      revisedAction,
      authorizedAction,
      source,
      publicPosture,
      confidence,
      risk,
      reason:
        source === "ai-reviewed"
          ? "AI review passed the firewall and can only lower or keep the deterministic action."
          : source === "ai-quarantined"
            ? "AI review output is quarantined, so authority keeps a same-or-safer deterministic action."
            : source === "proof-blocked"
              ? "Proof, metacognition, or review ledger is blocked, so authority lowers to avoid/internal handling."
              : "No accepted AI review is available, so authority uses deterministic and belief-revised state."
    },
    chain,
    counts: {
      pass,
      watch,
      block
    },
    control: {
      canDisplayCandidate: publicPosture === "public-candidate",
      canApplyAI: source === "ai-reviewed" && firewall.control.canApplyToDecision,
      canPersist: false,
      canPublish: false,
      canTrainFromResult: false,
      nextSafeCommand: firewall.control.nextSafeCommand ?? handoff.runbook.command ?? metacognition.runbook.nextSafeCommand,
      verifyUrl: firewall.control.verifyUrl ?? handoff.runbook.verifyUrl ?? metacognition.runbook.verifyUrl,
      forbiddenActions: unique([
        "Do not publish a decision authority result while status is blocked or supervised.",
        "Do not persist an authority result until activation proof and Supabase project isolation pass.",
        "Do not train from authority output until outcome settlement and provider provenance are verified.",
        "Do not allow AI to upgrade the deterministic or belief-revised action.",
        ...firewall.control.forbiddenActions
      ])
    }
  };
}
