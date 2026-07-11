import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "OddsPadi — Football Predictions, Live Scores & AI Analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Mark({ size: markSize }: { size: number }) {
  return (
    <svg width={markSize} height={markSize} viewBox="0 0 512 512">
      <rect width="512" height="512" rx="116" fill="#101d17" />
      <circle cx="256" cy="260" r="128" fill="none" stroke="#2BD673" strokeWidth="34" />
      <path
        d="M 298 84 L 194 286 L 252 286 L 216 428 L 330 220 L 270 220 L 306 84 Z"
        fill="#FFC53D"
        stroke="#101d17"
        strokeWidth="18"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          backgroundColor: "#0B1310",
          backgroundImage:
            "radial-gradient(circle at 12% 0%, rgba(43,214,115,0.22), transparent 55%), radial-gradient(circle at 95% 10%, rgba(255,197,61,0.16), transparent 50%)",
          color: "#EDF5F0",
          fontFamily: "sans-serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Mark size={96} />
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>
            <span>Odds</span>
            <span style={{ color: "#2BD673" }}>Padi</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            Your football padi for
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: "#2BD673" }}>
            smarter predictions.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#9DB3A7", marginTop: 10 }}>
            AI predictions · Real-time live scores · Honest value analysis
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: "rgba(43,214,115,0.14)",
              color: "#7EE8AB",
              borderRadius: 999,
              padding: "12px 28px",
              fontSize: 28,
              fontWeight: 700
            }}
          >
            oddspadi.com
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#70867A" }}>18+ · Analysis only · Play responsibly</div>
        </div>
      </div>
    ),
    size
  );
}
