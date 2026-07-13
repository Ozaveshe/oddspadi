import { ImageResponse } from "next/og";
import { getCachedMatchPrediction } from "@/lib/sports/prediction/cachedPublicReads";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "OddsPadi match prediction and model probabilities";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bricolageFont = fetch("https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9U6as8bTXq_nANBjzKo3IeZx8z6up5BeSl5jBNz_19PpbpMXuECpwUxJBOm_OJWiaaD30YfKfjZZoLvfzlyM0.ttf")
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load the Bricolage Grotesque OG font (${response.status}).`);
    return response.arrayBuffer();
  });

function percent(value: number | undefined): string {
  return `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`;
}

function kickoffLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Kickoff to be confirmed";
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
}

export default async function MatchOpenGraphImage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId: encodedMatchId } = await params;
  let matchId = encodedMatchId;
  try { matchId = decodeURIComponent(encodedMatchId); } catch { /* Keep the route value as-is. */ }
  const row = await getCachedMatchPrediction(matchId);
  const font = await bricolageFont;

  const home = row?.match.homeTeam.name ?? "Team A";
  const away = row?.match.awayTeam.name ?? "Team B";
  const league = row?.match.league.name ?? "OddsPadi match analysis";
  const kickoff = row ? kickoffLabel(row.match.kickoffTime) : "Kickoff to be confirmed";
  const winner = row?.prediction.markets.find((market) => market.marketId === "match_winner");
  const probabilityRows = [
    { label: home, value: winner?.probabilities.home },
    ...(row?.match.sport === "football" ? [{ label: "Draw", value: winner?.probabilities.draw }] : []),
    { label: away, value: winner?.probabilities.away }
  ];

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#0a0e0c", color: "#eef8f1", fontFamily: "Bricolage Grotesque", padding: "58px 64px" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", opacity: 0.19, background: "radial-gradient(circle at 18% 12%, #26e07d 0, transparent 28%), radial-gradient(circle at 82% 100%, #26e07d 0, transparent 24%)" }} />
      <div style={{ position: "absolute", width: 520, height: 520, right: -72, top: 55, display: "flex", border: "3px solid rgba(38,224,125,.24)", borderRadius: 260 }} />
      <div style={{ position: "absolute", width: 260, height: 520, right: 188, top: 55, display: "flex", borderLeft: "3px solid rgba(38,224,125,.24)" }} />

      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 800 }}>
            <span style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: "#26e07d", boxShadow: "0 0 28px #26e07d" }} />
            Odds<span style={{ color: "#26e07d", marginLeft: -14 }}>Padi</span>
          </div>
          <div style={{ display: "flex", color: "#86a792", fontSize: 20, letterSpacing: 1.2, textTransform: "uppercase" }}>{league}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", width: 850 }}>
          <div style={{ display: "flex", color: "#26e07d", fontSize: 22, fontWeight: 700, marginBottom: 14 }}>FLOODLIT MODEL CARD · {kickoff}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 22, fontSize: 69, fontWeight: 800, lineHeight: 0.95, letterSpacing: -3 }}>
            <span>{home}</span><span style={{ color: "#26e07d", fontSize: 35 }}>vs</span><span>{away}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            {probabilityRows.map((item) => (
              <div key={item.label} style={{ minWidth: 150, display: "flex", flexDirection: "column", gap: 7, borderTop: "2px solid #26e07d", background: "rgba(19,31,25,.88)", padding: "15px 17px 13px" }}>
                <span style={{ color: "#91a99b", fontSize: 15, textTransform: "uppercase", letterSpacing: 0.8 }}>{item.label}</span>
                <strong style={{ fontSize: 33 }}>{percent(item.value)}</strong>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", color: "#71877a", fontSize: 17 }}>Model probabilities · Analysis only</div>
        </div>
      </div>
    </div>,
    { ...size, fonts: [{ name: "Bricolage Grotesque", data: font, weight: 700, style: "normal" }] }
  );
}
