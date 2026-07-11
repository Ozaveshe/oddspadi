import { calculateBookmakerMargin, decimalOddsToImpliedProbability, removeBookmakerMargin } from "@/lib/sports/prediction/odds";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { footballDataSeasonCode, normalizeFootballDataSeasonRange, parseFootballDataCsv } from "@/lib/sports/training/footballDataCsvCorpusProbe";

type FetchCsv = (url: string) => Promise<string>;
type Outcome = "home" | "draw" | "away";

export type FootballDataMarketConsensusStatus = "completed" | "partial" | "no-data" | "failed";

export type FootballDataBookmakerCoverage = {
  bookmaker: string;
  prefix: string;
  rows: number;
  averageMargin: number | null;
  averageHomeNoVig: number | null;
  averageDrawNoVig: number | null;
  averageAwayNoVig: number | null;
};

export type FootballDataConsensusSeason = {
  seasonStart: number;
  seasonLabel: string;
  rows: number;
  pricedRows: number;
  bookmakerMarkets: number;
  averageBookmakersPerFixture: number | null;
  averageMargin: number | null;
  averageDisagreement: number | null;
  sharpAverageGap: number | null;
};

export type FootballDataMarketConsensus = {
  mode: "football-data-market-consensus";
  generatedAt: string;
  status: FootballDataMarketConsensusStatus;
  summary: string;
  provider: {
    name: "Football-Data.co.uk";
    leagueCode: "E0";
    competition: "English Premier League";
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    dryRun: true;
  };
  totals: {
    seasonsRequested: number;
    seasonsLoaded: number;
    rows: number;
    pricedRows: number;
    bookmakerMarkets: number;
    bookmakers: number;
    averageBookmakersPerFixture: number | null;
    averageMargin: number | null;
    averageDisagreement: number | null;
    sharpAverageGap: number | null;
  };
  seasons: FootballDataConsensusSeason[];
  bookmakerCoverage: FootballDataBookmakerCoverage[];
  marketQuality: {
    status: "usable-shadow" | "thin" | "high-margin" | "high-disagreement";
    marginGuardrail: number;
    disagreementGuardrail: number;
    detail: string;
  };
  sampleConsensus: Array<{
    fixture: string;
    date: string;
    bookmakerCount: number;
    margin: number | null;
    disagreement: number | null;
    consensusNoVig: Record<Outcome, number>;
  }>;
  controls: {
    canInspectReadOnly: true;
    canUseAsMarketPriorEvidence: boolean;
    canWriteOddsSnapshots: false;
    canPersistTrainingRows: false;
    canApplyMarketWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
};

const BOOKMAKER_PREFIXES: Array<{ prefix: string; bookmaker: string }> = [
  { prefix: "PS", bookmaker: "Pinnacle" },
  { prefix: "B365", bookmaker: "Bet365" },
  { prefix: "BW", bookmaker: "Bet&Win" },
  { prefix: "IW", bookmaker: "Interwetten" },
  { prefix: "WH", bookmaker: "William Hill" },
  { prefix: "VC", bookmaker: "VC Bet" },
  { prefix: "Max", bookmaker: "Market maximum" },
  { prefix: "Avg", bookmaker: "Market average" }
];

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/E0.csv`;
}

function seasonLabel(seasonStart: number): string {
  return `${seasonStart}/${String((seasonStart + 1) % 100).padStart(2, "0")}`;
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values) ?? 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function parseNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function rowObject(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function marketTriples(row: Record<string, string>) {
  return BOOKMAKER_PREFIXES.flatMap(({ prefix, bookmaker }) => {
    const home = parseNumber(row[`${prefix}H`]);
    const draw = parseNumber(row[`${prefix}D`]);
    const away = parseNumber(row[`${prefix}A`]);
    if (!home || !draw || !away) return [];
    const raw = [home, draw, away].map(decimalOddsToImpliedProbability);
    const noVig = removeBookmakerMargin(raw);
    return [
      {
        prefix,
        bookmaker,
        odds: { home, draw, away },
        margin: calculateBookmakerMargin(raw),
        noVig: {
          home: noVig[0] ?? 0,
          draw: noVig[1] ?? 0,
          away: noVig[2] ?? 0
        }
      }
    ];
  });
}

function disagreement(markets: ReturnType<typeof marketTriples>): number | null {
  if (markets.length < 2) return null;
  const outcomes: Outcome[] = ["home", "draw", "away"];
  const values = outcomes.flatMap((outcome) => {
    const outcomeValues = markets.map((market) => market.noVig[outcome]);
    const spread = stddev(outcomeValues);
    return spread === null ? [] : [spread];
  });
  return round(average(values), 6);
}

function consensus(markets: ReturnType<typeof marketTriples>): Record<Outcome, number> {
  return {
    home: round(average(markets.map((market) => market.noVig.home)) ?? 0, 6) ?? 0,
    draw: round(average(markets.map((market) => market.noVig.draw)) ?? 0, 6) ?? 0,
    away: round(average(markets.map((market) => market.noVig.away)) ?? 0, 6) ?? 0
  };
}

function sharpAverageGap(markets: ReturnType<typeof marketTriples>): number | null {
  const sharp = markets.find((market) => market.prefix === "PS");
  const avg = markets.find((market) => market.prefix === "Avg");
  if (!sharp || !avg) return null;
  return round(
    average([
      Math.abs(sharp.noVig.home - avg.noVig.home),
      Math.abs(sharp.noVig.draw - avg.noVig.draw),
      Math.abs(sharp.noVig.away - avg.noVig.away)
    ]),
    6
  );
}

export async function buildFootballDataMarketConsensus({
  seasonFrom,
  seasonTo,
  maxSeasons,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
} = {}): Promise<FootballDataMarketConsensus> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  const seasons: FootballDataConsensusSeason[] = [];
  const bookmakerRows = new Map<string, Array<{ margin: number; noVig: Record<Outcome, number> }>>();
  const sampleConsensus: FootballDataMarketConsensus["sampleConsensus"] = [];
  let failed = 0;

  for (const seasonStart of range.starts) {
    try {
      const parsed = parseFootballDataCsv(await fetchCsv(sourceUrl(seasonStart)));
      const headers = parsed[0]?.map((item) => item.trim()).filter(Boolean) ?? [];
      const rows = parsed.slice(1).map((row) => rowObject(headers, row));
      let pricedRows = 0;
      let bookmakerMarkets = 0;
      const margins: number[] = [];
      const disagreements: number[] = [];
      const sharpGaps: number[] = [];

      for (const row of rows) {
        const markets = marketTriples(row);
        if (!markets.length) continue;
        pricedRows += 1;
        bookmakerMarkets += markets.length;
        margins.push(...markets.map((market) => market.margin));
        const rowDisagreement = disagreement(markets);
        const rowSharpGap = sharpAverageGap(markets);
        if (rowDisagreement !== null) disagreements.push(rowDisagreement);
        if (rowSharpGap !== null) sharpGaps.push(rowSharpGap);
        for (const market of markets) {
          const rowsForBook = bookmakerRows.get(market.prefix) ?? [];
          rowsForBook.push({ margin: market.margin, noVig: market.noVig });
          bookmakerRows.set(market.prefix, rowsForBook);
        }
        if (sampleConsensus.length < 5) {
          sampleConsensus.push({
            fixture: `${row.HomeTeam ?? ""} vs ${row.AwayTeam ?? ""}`.trim(),
            date: row.Date ?? "",
            bookmakerCount: markets.length,
            margin: round(average(markets.map((market) => market.margin)), 6),
            disagreement: rowDisagreement,
            consensusNoVig: consensus(markets)
          });
        }
      }

      seasons.push({
        seasonStart,
        seasonLabel: seasonLabel(seasonStart),
        rows: rows.length,
        pricedRows,
        bookmakerMarkets,
        averageBookmakersPerFixture: round(pricedRows ? bookmakerMarkets / pricedRows : null, 4),
        averageMargin: round(average(margins), 6),
        averageDisagreement: round(average(disagreements), 6),
        sharpAverageGap: round(average(sharpGaps), 6)
      });
    } catch {
      failed += 1;
    }
  }

  const loaded = seasons.length;
  const allMargins = seasons.map((season) => season.averageMargin).filter((value): value is number => value !== null);
  const allDisagreements = seasons.map((season) => season.averageDisagreement).filter((value): value is number => value !== null);
  const allSharpGaps = seasons.map((season) => season.sharpAverageGap).filter((value): value is number => value !== null);
  const pricedRows = seasons.reduce((sum, season) => sum + season.pricedRows, 0);
  const bookmakerMarkets = seasons.reduce((sum, season) => sum + season.bookmakerMarkets, 0);
  const averageMargin = round(average(allMargins), 6);
  const averageDisagreement = round(average(allDisagreements), 6);
  const status: FootballDataMarketConsensusStatus = loaded && !failed ? "completed" : loaded ? "partial" : failed ? "failed" : "no-data";
  const marketQuality = quality({ pricedRows, averageMargin, averageDisagreement });
  const action = nextAction(range.seasonFrom, range.seasonTo, range.maxSeasons);

  return {
    mode: "football-data-market-consensus",
    generatedAt: now.toISOString(),
    status,
    summary:
      status === "completed" || status === "partial"
        ? `Analyzed ${bookmakerMarkets} bookmaker market(s) across ${pricedRows} EPL fixture row(s); market quality is ${marketQuality.status}.`
        : "No bookmaker consensus evidence could be analyzed from public EPL CSVs.",
    provider: {
      name: "Football-Data.co.uk",
      leagueCode: "E0",
      competition: "English Premier League"
    },
    request: {
      seasonFrom: range.seasonFrom,
      seasonTo: range.seasonTo,
      maxSeasons: range.maxSeasons,
      dryRun: true
    },
    totals: {
      seasonsRequested: range.starts.length,
      seasonsLoaded: loaded,
      rows: seasons.reduce((sum, season) => sum + season.rows, 0),
      pricedRows,
      bookmakerMarkets,
      bookmakers: bookmakerRows.size,
      averageBookmakersPerFixture: round(pricedRows ? bookmakerMarkets / pricedRows : null, 4),
      averageMargin,
      averageDisagreement,
      sharpAverageGap: round(average(allSharpGaps), 6)
    },
    seasons,
    bookmakerCoverage: Array.from(bookmakerRows.entries()).map(([prefix, rows]) => ({
      bookmaker: BOOKMAKER_PREFIXES.find((item) => item.prefix === prefix)?.bookmaker ?? prefix,
      prefix,
      rows: rows.length,
      averageMargin: round(average(rows.map((row) => row.margin)), 6),
      averageHomeNoVig: round(average(rows.map((row) => row.noVig.home)), 6),
      averageDrawNoVig: round(average(rows.map((row) => row.noVig.draw)), 6),
      averageAwayNoVig: round(average(rows.map((row) => row.noVig.away)), 6)
    })),
    marketQuality,
    sampleConsensus,
    controls: {
      canInspectReadOnly: true,
      canUseAsMarketPriorEvidence: marketQuality.status === "usable-shadow",
      canWriteOddsSnapshots: false,
      canPersistTrainingRows: false,
      canApplyMarketWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: action,
    locks: [
      "Market consensus evidence is read-only and cannot write odds snapshots.",
      "Consensus/no-vig analysis can inform shadow diagnostics only; it cannot alter live market weights.",
      "True opening and independent closing-line movement still require provider odds snapshots."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-market-consensus",
      "/api/sports/decision/training/football-data-walk-forward",
      "/api/sports/decision/training/football-data-threshold-sweep",
      "/api/sports/decision/training/historical-corpus-acquisition"
    ]
  };
}

function quality({
  pricedRows,
  averageMargin,
  averageDisagreement
}: {
  pricedRows: number;
  averageMargin: number | null;
  averageDisagreement: number | null;
}): FootballDataMarketConsensus["marketQuality"] {
  const marginGuardrail = 0.08;
  const disagreementGuardrail = 0.035;
  const status =
    pricedRows < 500
      ? "thin"
      : averageMargin !== null && averageMargin > marginGuardrail
        ? "high-margin"
        : averageDisagreement !== null && averageDisagreement > disagreementGuardrail
          ? "high-disagreement"
          : "usable-shadow";
  return {
    status,
    marginGuardrail,
    disagreementGuardrail,
    detail:
      status === "usable-shadow"
        ? "Bookmaker consensus is usable as shadow market-prior evidence after margin removal."
        : status === "thin"
          ? "Bookmaker consensus sample is too thin for threshold or weighting claims."
          : status === "high-margin"
            ? "Average bookmaker margin is too high for confident market-prior weighting."
            : "Bookmakers disagree too much for a stable consensus prior."
  };
}

function nextAction(seasonFrom: number, seasonTo: number, maxSeasons: number) {
  const verifyUrl = `/api/sports/decision/training/football-data-market-consensus?seasonFrom=${seasonFrom}&seasonTo=${seasonTo}&maxSeasons=${maxSeasons}&dryRun=1`;
  return {
    label: "Run public EPL bookmaker consensus audit",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: "Read-only bookmaker coverage, margin, no-vig consensus, sharp-vs-average gap, and market-quality guardrails from public EPL CSV odds columns."
  };
}

export const FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_VERIFY_URL =
  "/api/sports/decision/training/football-data-market-consensus?seasonFrom=2016&seasonTo=2025&maxSeasons=10&dryRun=1";

export const FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_COMMAND = decisionCurlCommand(FOOTBALL_DATA_MARKET_CONSENSUS_DEFAULT_VERIFY_URL);
