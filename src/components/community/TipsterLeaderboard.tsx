import Link from "next/link";
import { wilsonInterval } from "@/lib/performance/ledgerMetrics";
import { AccountBadge } from "./AccountBadge";

export type TipsterLeaderboardRow = {
  rank_position: number | string;
  author_id: string;
  username: string;
  display_name: string | null;
  account_type?: string | null;
  published_tips: number | string;
  settled_tips: number | string;
  wins: number | string;
  losses: number | string;
  pushes: number | string;
  net_units: number | string;
  yield_percent: number | string;
  average_settled_odds?: number | string | null;
  sports_mix?: string[] | null;
  markets_mix?: string[] | null;
  ranking_score: number | string;
  eligible: boolean;
};

function number(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedUnits(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}u`;
}

function identity(row: TipsterLeaderboardRow): string {
  return row.display_name?.trim() || `@${row.username}`;
}

/** 95% Wilson interval on the decided hit rate, or null below one decided tip. */
function hitRateRange(row: TipsterLeaderboardRow): string | null {
  const wins = number(row.wins);
  const decided = wins + number(row.losses);
  if (!decided) return null;
  const interval = wilsonInterval(wins, decided);
  if (!interval) return null;
  return `${Math.round(interval.low * 100)}–${Math.round(interval.high * 100)}%`;
}

function mixLine(row: TipsterLeaderboardRow): string | null {
  const parts = [...(row.sports_mix ?? []), ...(row.markets_mix ?? []).map((market) => market.replaceAll("_", " "))];
  return parts.length ? parts.slice(0, 4).join(" · ") : null;
}

export function TipsterLeaderboard({ rows }: { rows: TipsterLeaderboardRow[] }) {
  const leader = rows.find((row) => row.eligible) ?? null;
  const tableRows = rows.filter((row) => row.author_id !== leader?.author_id).slice(0, 6);

  return (
    <section className="community-leaderboard" aria-labelledby="community-leaderboard-title">
      <header className="community-leaderboard-heading">
        <div>
          <span className="section-kicker">Accountable tipsters</span>
          <h2 id="community-leaderboard-title">Receipts, not popularity</h2>
        </div>
        <p>
          Only immutable, provider-settled tips count. Ranking needs 5 settled picks, a week-old account, no integrity
          flags and few deleted selections; a 20-unit evidence prior keeps one lucky result from topping the table.
        </p>
      </header>

      <div className="community-leaderboard-grid">
        {leader ? (
          <article className="community-leader-card">
            <span>Current evidence leader</span>
            <div>
              <strong>#{number(leader.rank_position)}</strong>
              <p>
                <Link href={`/community/u/${encodeURIComponent(leader.username)}`}>{identity(leader)}</Link>
                <AccountBadge accountType={leader.account_type} />
                <small>@{leader.username}</small>
              </p>
            </div>
            <dl>
              <div><dt>Net record</dt><dd className={number(leader.net_units) >= 0 ? "positive" : "negative"}>{signedUnits(number(leader.net_units))}</dd></div>
              <div><dt>Yield</dt><dd>{number(leader.yield_percent).toFixed(1)}%</dd></div>
              <div><dt>W–L</dt><dd>{number(leader.wins)}–{number(leader.losses)}</dd></div>
              <div><dt>Avg odds</dt><dd>{leader.average_settled_odds ? number(leader.average_settled_odds).toFixed(2) : "—"}</dd></div>
            </dl>
            <small>
              {number(leader.settled_tips)} settled
              {hitRateRange(leader) ? ` · hit rate ${hitRateRange(leader)} (95% CI)` : ""}
              {mixLine(leader) ? ` · ${mixLine(leader)}` : ""}
            </small>
            <small>Ranking score {number(leader.ranking_score).toFixed(2)}% after evidence shrinkage.</small>
          </article>
        ) : (
          <article className="community-leader-card open-seat">
            <span>Leaderboard qualification</span>
            <div><strong>5</strong><p>settled tips<small>Minimum evidence floor</small></p></div>
            <p>No tipster has a qualified record yet. The first position stays visibly open instead of rewarding an unproved streak.</p>
          </article>
        )}

        <div className="community-leaderboard-table" role="region" aria-label="Community tipster standings" tabIndex={0}>
          {tableRows.length ? tableRows.map((row) => {
            const net = number(row.net_units);
            const range = hitRateRange(row);
            return (
              <article key={row.author_id} className={!row.eligible ? "establishing" : undefined}>
                <span>{row.eligible ? `#${number(row.rank_position)}` : "—"}</span>
                <p>
                  <Link href={`/community/u/${encodeURIComponent(row.username)}`}>{identity(row)}</Link>
                  <AccountBadge accountType={row.account_type} />
                  <small>
                    {row.eligible ? `${number(row.settled_tips)} settled` : `${number(row.settled_tips)}/5 to rank`}
                    {row.eligible && range ? ` · ${range}` : ""}
                    {row.eligible && mixLine(row) ? ` · ${mixLine(row)}` : ""}
                  </small>
                </p>
                <dl>
                  <div><dt>W–L</dt><dd>{number(row.wins)}–{number(row.losses)}</dd></div>
                  <div><dt>Avg odds</dt><dd>{row.average_settled_odds ? number(row.average_settled_odds).toFixed(2) : "—"}</dd></div>
                  <div><dt>Yield</dt><dd>{number(row.settled_tips) ? `${number(row.yield_percent).toFixed(1)}%` : "—"}</dd></div>
                  <div><dt>Net</dt><dd className={net >= 0 ? "positive" : "negative"}>{number(row.settled_tips) ? signedUnits(net) : "—"}</dd></div>
                </dl>
              </article>
            );
          }) : <div className="community-leaderboard-empty"><strong>No settled community record yet</strong><p>Tipsters will appear after provider-backed fixtures have been graded.</p></div>}
        </div>
      </div>
      <footer>Community ranking is a separate opinion ledger. It never changes OddsPadi probabilities, model ROI or publication thresholds.</footer>
    </section>
  );
}
