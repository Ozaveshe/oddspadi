import { buildDecisionAgentLoop, type DecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionSelfAudit, type DecisionSelfAudit, type DecisionSelfAuditCategory, type DecisionSelfAuditFinding } from "@/lib/sports/prediction/decisionSelfAudit";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

type RepairActionType = "configure-env" | "dry-run-provider" | "read-status" | "run-review" | "persist-memory" | "backfill-training" | "operator-review";
type RepairPriority = "critical" | "high" | "medium" | "low";
type RepairStatus = "ready" | "blocked" | "waiting";

export type DecisionRepairAction = {
  id: string;
  findingId: string;
  category: DecisionSelfAuditCategory;
  type: RepairActionType;
  priority: RepairPriority;
  status: RepairStatus;
  title: string;
  detail: string;
  command: string | null;
  verifyUrl: string;
  expectedEvidence: string;
  expectedTrustDelta: number;
  affectedMatches: number;
  missingEnv: string[];
  safety: string[];
};

export type DecisionRepairPlan = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: "clear" | "ready" | "blocked";
  summary: string;
  trustScoreBefore: number;
  potentialTrustScore: number;
  actions: DecisionRepairAction[];
  nextAction: DecisionRepairAction | null;
  verificationUrl: string;
  notes: string[];
};

function command(method: "GET" | "POST", url: string, requiresAdmin = false): string {
  const header = requiresAdmin ? ' -H "x-oddspadi-admin-token: <ODDSPADI_ADMIN_TOKEN>"' : "";
  const target = decisionApiUrl(url);
  return method === "POST" ? `curl.exe -sS -X POST${header} "${target}"` : `curl.exe -sS${header} "${target}"`;
}

function priorityFromFinding(finding: DecisionSelfAuditFinding): RepairPriority {
  if (finding.severity === "critical") return "critical";
  if (finding.severity === "high") return "high";
  if (finding.severity === "medium") return "medium";
  return "low";
}

function trustDelta(priority: RepairPriority): number {
  if (priority === "critical") return 24;
  if (priority === "high") return 16;
  if (priority === "medium") return 9;
  return 4;
}

function statusFromMissingEnv(missingEnv: string[]): RepairStatus {
  return missingEnv.length ? "blocked" : "ready";
}

function envForFinding(finding: DecisionSelfAuditFinding, loop: DecisionAgentLoop): string[] {
  if (finding.category === "runtime") return loop.autonomy.missingEnv;
  if (finding.category === "data" || finding.category === "tools") return ["API_FOOTBALL_KEY or APISPORTS_KEY", "THE_ODDS_API_KEY or ODDS_API_KEY"];
  if (finding.category === "market") return ["THE_ODDS_API_KEY or ODDS_API_KEY"];
  if (finding.category === "memory") return ["SUPABASE_SERVICE_ROLE_KEY"];
  if (finding.category === "learning") return ["API_FOOTBALL_KEY or APISPORTS_KEY", "THE_ODDS_API_KEY or ODDS_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  if (finding.category === "safety") return ["OPENAI_API_KEY"];
  return [];
}

function actionForFinding({
  finding,
  loop,
  date,
  sport
}: {
  finding: DecisionSelfAuditFinding;
  loop: DecisionAgentLoop;
  date: string;
  sport: Sport;
}): DecisionRepairAction {
  const priority = priorityFromFinding(finding);
  const baseVerifyUrl = `/api/sports/decision/self-audit?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;
  const missingEnv = envForFinding(finding, loop);
  const base = {
    findingId: finding.id,
    category: finding.category,
    priority,
    expectedTrustDelta: trustDelta(priority),
    affectedMatches: finding.affectedMatches,
    verifyUrl: baseVerifyUrl,
    safety: ["Start with read-only or dry-run routes.", "Do not publish unless self-audit passes and controlPolicy.publishAllowed is true."]
  };

  if (finding.category === "runtime") {
    return {
      ...base,
      id: "repair-runtime-env",
      type: "configure-env",
      status: "blocked",
      title: "Repair runtime environment",
      detail: finding.mitigation,
      command: null,
      expectedEvidence: "Status, agent-loop, and self-audit endpoints stop reporting missing runtime env.",
      missingEnv
    };
  }

  if (finding.category === "data" || finding.category === "tools") {
    const url = `/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2025&date=${encodeURIComponent(date)}&includeEvents=1&includeContext=1&includeNews=1&dryRun=1`;
    return {
      ...base,
      id: `repair-${finding.category}-provider-context`,
      type: "dry-run-provider",
      status: statusFromMissingEnv(missingEnv),
      title: "Dry-run provider context repair",
      detail: finding.mitigation,
      command: command("POST", url, true),
      expectedEvidence: "Dry-run returns normalized fixture, event, lineup, injury, standings, news, or weather counts without writes.",
      missingEnv: ["ODDSPADI_ADMIN_TOKEN", ...missingEnv]
    };
  }

  if (finding.category === "market") {
    const url = `/api/sports/decision/training/provider-sync?provider=the-odds-api&sportKey=soccer_epl&date=${encodeURIComponent(`${date}T12:00:00Z`)}&dryRun=1`;
    return {
      ...base,
      id: "repair-market-odds",
      type: "dry-run-provider",
      status: statusFromMissingEnv(missingEnv),
      title: "Dry-run odds refresh",
      detail: finding.mitigation,
      command: command("POST", url, true),
      expectedEvidence: "Dry-run returns h2h odds snapshots and no-vig market counts before any storage attempt.",
      missingEnv: ["ODDSPADI_ADMIN_TOKEN", ...missingEnv]
    };
  }

  if (finding.category === "memory") {
    return {
      ...base,
      id: "repair-memory-read",
      type: "persist-memory",
      status: statusFromMissingEnv(missingEnv),
      title: "Restore decision memory reads",
      detail: finding.mitigation,
      command: command("GET", "/api/sports/decision/memory"),
      expectedEvidence: "Decision memory returns ready or no-memory instead of failed/not-configured, and stored brain traces become replayable for new runs.",
      missingEnv
    };
  }

  if (finding.category === "learning") {
    const url = "/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&includeEvents=1&includeContext=1&maxJobs=1&dryRun=1";
    return {
      ...base,
      id: "repair-training-backfill",
      type: "backfill-training",
      status: statusFromMissingEnv(missingEnv),
      title: "Dry-run first historical backfill job",
      detail: finding.mitigation,
      command: command("POST", url, true),
      expectedEvidence: "Dry-run returns capped historical fixture/context counts for one job before write mode is considered.",
      missingEnv: ["ODDSPADI_ADMIN_TOKEN", ...missingEnv]
    };
  }

  if (finding.category === "safety") {
    const matchId = loop.activeFocus?.matchId ?? "";
    const url = matchId ? `/api/sports/decision/${encodeURIComponent(matchId)}?agent=1` : `/api/sports/decision?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;
    return {
      ...base,
      id: "repair-guarded-ai-review",
      type: "run-review",
      status: statusFromMissingEnv(missingEnv),
      title: "Run guarded AI review",
      detail: finding.mitigation,
      command: command("GET", url),
      expectedEvidence: "AI reviewer returns reviewed/not-configured/provider-error with cited audit fields and no unsupported upgrade.",
      missingEnv
    };
  }

  return {
    ...base,
    id: `repair-${finding.category}-operator-review`,
    type: "operator-review",
    status: "waiting",
    title: "Review actionability contract",
    detail: finding.mitigation,
    command: command("GET", loop.verification.rerunUrl),
    expectedEvidence: "Rerun returns controlPolicy, actionability, and self-audit without internal contradictions.",
    missingEnv
  };
}

function sortActions(actions: DecisionRepairAction[]): DecisionRepairAction[] {
  const priorityRank: Record<RepairPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<RepairStatus, number> = { ready: 3, waiting: 2, blocked: 1 };
  return actions
    .slice()
    .sort((a, b) => {
      const priority = priorityRank[b.priority] - priorityRank[a.priority];
      if (priority !== 0) return priority;
      const status = statusRank[b.status] - statusRank[a.status];
      if (status !== 0) return status;
      return b.expectedTrustDelta - a.expectedTrustDelta;
    });
}

export function buildDecisionRepairPlan({
  rows,
  date,
  sport,
  agentLoop,
  selfAudit
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  agentLoop?: DecisionAgentLoop;
  selfAudit?: DecisionSelfAudit;
}): DecisionRepairPlan {
  const loop = agentLoop ?? buildDecisionAgentLoop({ rows, date, sport });
  const audit = selfAudit ?? buildDecisionSelfAudit({ rows, date, sport, agentLoop: loop });
  const actions = sortActions(
    audit.findings.map((finding) =>
      actionForFinding({
        finding,
        loop,
        date,
        sport
      })
    )
  ).slice(0, 8);
  const nextAction = actions.find((action) => action.status === "ready") ?? actions[0] ?? null;
  const potentialTrustScore = Math.min(100, audit.trustScore + actions.reduce((sum, action) => sum + action.expectedTrustDelta, 0));
  const status: DecisionRepairPlan["status"] = !actions.length ? "clear" : actions.some((action) => action.status === "ready") ? "ready" : "blocked";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "clear"
        ? "No repair action is queued because the self-audit has no findings."
        : status === "ready"
          ? `Repair planner has ${actions.filter((action) => action.status === "ready").length} ready action(s); start with ${nextAction?.title ?? "the top action"}.`
          : `Repair planner is blocked on configuration before it can run ${actions.length} queued action(s).`,
    trustScoreBefore: audit.trustScore,
    potentialTrustScore,
    actions,
    nextAction,
    verificationUrl: `/api/sports/decision/repair-plan?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
    notes: [
      "Repair actions are not betting advice and do not guarantee outcomes.",
      "Dry-run provider commands must be reviewed before write mode.",
      "A repair is complete only when self-audit findings clear or downgrade on rerun."
    ]
  };
}
