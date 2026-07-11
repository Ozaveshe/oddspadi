import type { ConfidenceLevel, MatchStatus, RiskLevel } from "@/lib/sports/types";
import { formatSignedPercent } from "@/lib/sports/prediction/format";

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return <span className={`badge ${level}`}>{level} confidence</span>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`badge ${level}-risk`}>{level} risk</span>;
}

export function ValueEdgeBadge({ edge }: { edge: number }) {
  if (edge <= 0) return <span className="badge no-value">No value</span>;
  return <span className="badge positive">{formatSignedPercent(edge)} edge</span>;
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
