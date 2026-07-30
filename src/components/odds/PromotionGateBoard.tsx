import type { PromotionGateStatus } from "@/lib/sports/promotionGateStatus";

/**
 * Status-page-style board for the seven promotion gates.
 *
 * The product publishes no picks until a calibration profile passes every
 * gate; without this board the zeros around the site read as breakage. Each
 * bar is the measured value against its threshold — the same numbers the
 * promotion script enforces, so this cannot drift into marketing.
 */
function formatGateValue(id: string, value: number | null): string {
  if (value === null) return "—";
  if (id === "settled") return String(Math.round(value));
  if (id === "coverage") return `${(value * 100).toFixed(1)}%`;
  if (id === "clv" || id === "skill") return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
  return value.toFixed(4);
}

function formatThreshold(id: string, threshold: number, direction: "at-least" | "at-most"): string {
  const prefix = direction === "at-least" ? "≥" : "≤";
  if (id === "settled") return `${prefix} ${threshold}`;
  if (id === "coverage") return `${prefix} ${(threshold * 100).toFixed(0)}%`;
  if (id === "logloss") return `${prefix} ln 2`;
  if (threshold === 0) return `${prefix} 0`;
  return `${prefix} ${threshold}`;
}

export function PromotionGateBoard({ status }: { status: PromotionGateStatus }) {
  return (
    <div className="gate-board">
      <p className="gate-board-summary">
        <strong>
          {status.passingCount} of {status.gates.length} gates passing
        </strong>{" "}
        on {status.settled} settled outcomes. Publication opens when all {status.gates.length} hold — no gate is ever
        lowered to make picks appear.
      </p>
      <ul className="gate-board-list">
        {status.gates.map((gate) => (
          <li key={gate.id} className={gate.passing ? "gate-pass" : "gate-blocked"}>
            <div className="gate-row-top">
              <span className="gate-label">{gate.label}</span>
              <span className="gate-values">
                <strong>{formatGateValue(gate.id, gate.value)}</strong>
                <span className="muted small"> {formatThreshold(gate.id, gate.threshold, gate.direction)}</span>
              </span>
            </div>
            <div className="gate-bar" role="presentation">
              <div
                className="gate-bar-fill"
                style={{ width: `${Math.round(gate.progress * 100)}%` }}
              />
              {gate.direction === "at-most" ? <div className="gate-bar-limit" /> : null}
            </div>
            <span className="gate-state small">{gate.passing ? "Passing" : "Not yet"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
