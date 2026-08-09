export type DashboardTile = {
  label: string;
  /** null renders as "—" (unread/unknown), never a misleading zero. */
  value: number | string | null;
  unit?: string;
  status?: "ok" | "warn" | "page" | "unknown";
  target?: number | null;
};

const STATUS_LABEL: Record<NonNullable<DashboardTile["status"]>, string> = {
  ok: "OK",
  warn: "Warn",
  page: "Page",
  unknown: "Unknown"
};

function display(value: DashboardTile["value"], unit?: string): string {
  if (value === null) return "—";
  return unit ? `${value}${unit}` : String(value);
}

/**
 * A role dashboard as a grid of tiles. A null value shows "—" (unread), and a
 * target of 0 is labelled so an analyst reads "should be zero", not "is fine".
 */
export function OpsDashboard({ title, tiles }: { title: string; tiles: DashboardTile[] }) {
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <dl className="stat-grid">
        {tiles.map((tile) => (
          <div key={tile.label} data-status={tile.status ?? undefined}>
            <dt>{tile.label}</dt>
            <dd>{display(tile.value, tile.unit)}</dd>
            {tile.status ? <span className="muted small">{STATUS_LABEL[tile.status]}</span> : null}
            {tile.target === 0 ? <span className="muted small">target 0</span> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
