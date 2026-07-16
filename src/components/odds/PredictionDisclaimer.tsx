import * as React from "react";

export function PredictionDisclaimer({ sport = "sport" }: { sport?: string }) {
  return (
    <div className="notice">
      <strong>Real talk:</strong> {sport} is unpredictable — that&apos;s why we love it. OddsPadi predictions are
      statistical opinions, not guarantees. Use them to think clearly, not to bet blindly. 18+ where betting applies.
    </div>
  );
}

export function ResponsibleUseNotice() {
  return (
    <div className="notice">
      <strong>Play it smart, padi:</strong> good analysis helps you decide better, but no analysis removes risk.
      OddsPadi presents probabilities rather than certainty, doesn&apos;t take bets, and doesn&apos;t hold your money. If you
      bet, keep it fun — only stake what you can afford to lose.
    </div>
  );
}
