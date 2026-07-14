import React from "react";
import type { FixtureOddsHistory } from "@/lib/sports/intelligence/types";
import { buildOddsMovementSeries } from "@/lib/sports/intelligence/oddsHistory";

const WIDTH = 720;
const HEIGHT = 250;
const PAD = { top: 18, right: 26, bottom: 38, left: 48 };

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Unknown time";
}

function movementLabel(value: number): string {
  if (Math.abs(value) < 0.005) return "unchanged";
  return value < 0 ? `shortened ${Math.abs(value).toFixed(2)}` : `drifted ${value.toFixed(2)}`;
}

function chartPath(
  points: Array<{ capturedAt: string; decimalOdds: number }>,
  minTime: number,
  maxTime: number,
  minOdds: number,
  maxOdds: number
): string {
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  return points.map((point, index) => {
    const timestamp = Date.parse(point.capturedAt);
    const x = PAD.left + (maxTime === minTime ? 0.5 : (timestamp - minTime) / (maxTime - minTime)) * plotWidth;
    const y = PAD.top + (1 - (point.decimalOdds - minOdds) / (maxOdds - minOdds)) * plotHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function OddsMovementChart({
  history,
  market,
  marketLabel
}: {
  history: FixtureOddsHistory;
  market: string;
  marketLabel: string;
}) {
  const series = buildOddsMovementSeries(history.snapshots, market);
  if (history.status !== "ready" || !series.length) {
    const heading = history.status === "failed"
      ? "Odds history could not be read"
      : history.status === "unavailable"
        ? "Odds history is unavailable"
        : `No stored ${marketLabel.toLowerCase()} movement yet`;
    return (
      <div className={`odds-history-state state-${history.status}`}>
        <strong>{heading}</strong>
        <p>{history.reason ?? "A second verified pre-match snapshot is required before movement can be calculated."}</p>
      </div>
    );
  }

  const allPoints = series.flatMap((item) => item.points);
  const timestamps = allPoints.map((point) => Date.parse(point.capturedAt));
  const rawOdds = allPoints.map((point) => point.decimalOdds);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const rawMinOdds = Math.min(...rawOdds);
  const rawMaxOdds = Math.max(...rawOdds);
  const padding = Math.max(0.05, (rawMaxOdds - rawMinOdds) * 0.14);
  const minOdds = Math.max(1.01, rawMinOdds - padding);
  const maxOdds = rawMaxOdds + padding;
  const tickOdds = Array.from({ length: 4 }, (_, index) => maxOdds - (maxOdds - minOdds) * index / 3);
  const totalDistinctTimes = new Set(allPoints.map((point) => point.capturedAt)).size;

  return (
    <figure className="odds-movement-chart">
      <figcaption>
        <div>
          <span className="section-kicker">Verified price tape</span>
          <strong>{marketLabel} movement</strong>
        </div>
        <span>{history.rowsRead} stored snapshot{history.rowsRead === 1 ? "" : "s"}</span>
      </figcaption>
      {totalDistinctTimes > 1 ? (
        <div className="odds-chart-scroll">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="odds-chart-title odds-chart-desc">
            <title id="odds-chart-title">{`${marketLabel} decimal odds movement`}</title>
            <desc id="odds-chart-desc">Stored pre-match prices from {timeLabel(new Date(minTime).toISOString())} to {timeLabel(new Date(maxTime).toISOString())}.</desc>
            {tickOdds.map((value, index) => {
              const y = PAD.top + (HEIGHT - PAD.top - PAD.bottom) * index / 3;
              return <g key={value.toFixed(4)}><line className="odds-grid-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} /><text className="odds-axis-label" x={PAD.left - 10} y={y + 4} textAnchor="end">{value.toFixed(2)}</text></g>;
            })}
            <text className="odds-axis-label" x={PAD.left} y={HEIGHT - 10}>{timeLabel(new Date(minTime).toISOString())}</text>
            <text className="odds-axis-label" x={WIDTH - PAD.right} y={HEIGHT - 10} textAnchor="end">{timeLabel(new Date(maxTime).toISOString())}</text>
            {series.map((item, index) => (
              <g className={`odds-series series-${index}`} key={item.selection}>
                <path d={chartPath(item.points, minTime, maxTime, minOdds, maxOdds)} />
                {item.points.map((point) => {
                  const plotWidth = WIDTH - PAD.left - PAD.right;
                  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
                  const x = PAD.left + (maxTime === minTime ? 0.5 : (Date.parse(point.capturedAt) - minTime) / (maxTime - minTime)) * plotWidth;
                  const y = PAD.top + (1 - (point.decimalOdds - minOdds) / (maxOdds - minOdds)) * plotHeight;
                  return <circle key={`${item.selection}:${point.capturedAt}`} cx={x} cy={y} r="4"><title>{`${item.label}: ${point.decimalOdds.toFixed(2)} at ${timeLabel(point.capturedAt)}`}</title></circle>;
                })}
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <div className="odds-history-state state-no-data"><strong>Opening price stored</strong><p>Movement needs at least two verified capture times. OddsPadi will not infer a trend from one snapshot.</p></div>
      )}
      <div className="odds-movement-legend">
        {series.map((item, index) => (
          <div key={item.selection}>
            <i className={`series-${index}`} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{item.openingOdds.toFixed(2)} <b aria-hidden="true">to</b> {item.latestOdds.toFixed(2)}</strong>
            <small className={item.movement < -0.005 ? "shortened" : item.movement > 0.005 ? "drifted" : ""}>{movementLabel(item.movement)}</small>
          </div>
        ))}
      </div>
      <p className="muted small">Decimal odds from stored pre-match provider snapshots. Lower odds mean the market has strengthened that outcome; higher odds mean it has weakened. This is observed movement, not proof that the move is correct.</p>
      {history.reason ? <p className="muted small">{history.reason}</p> : null}
    </figure>
  );
}
