const LABELS: Record<string, string> = {
  staff: "OddsPadi staff",
  demo: "Demo account",
  system: "System"
};

// Provenance label rendered beside any community author. Organic accounts get
// nothing; staff, demo and system accounts are always visibly marked so seeded
// or official activity can never masquerade as organic users.
export function AccountBadge({ accountType }: { accountType?: string | null }) {
  const label = accountType ? LABELS[accountType] : undefined;
  if (!label) return null;
  return (
    <span className="badge" data-account-type={accountType} style={{ marginLeft: "0.4rem", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
