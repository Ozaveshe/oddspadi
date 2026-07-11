import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "OddsPadi — Football Predictions, Live Scores & AI Analysis";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Mark({ size: markSize }: { size: number }) {
  return (
    <svg width={markSize} height={markSize} viewBox="0 0 512 512">
      <rect width="512" height="512" rx="116" fill="#0c1613" />
      <circle cx="256" cy="260" r="128" fill="none" stroke="#26e07d" strokeWidth="34" />
      <path
        d="M 298 84 L 194 286 L 252 286 L 216 428 L 330 220 L 270 220 L 306 84 Z"
        fill="#ffc24b"
        stroke="#0c1613"
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
          backgroundColor: "#0a0e0c",
          backgroundImage:
            "radial-gradient(circle at 10% 0%, rgba(38,224,125,0.28), transparent 55%), radial-gradient(circle at 96% 8%, rgba(255,194,75,0.16), transparent 52%)",
          color: "#eaf5ee",
          fontFamily: "sans-serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Mark size={96} />
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>
            <span>Odds</span>
            <span style={{ color: "#26e07d" }}>Padi</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            Your football padi for
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: "#26e07d" }}>
            smarter predictions.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#9eb4a8", marginTop: 10 }}>
            AI predictions · Real-time live scores · Honest value analysis
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: "rgba(38,224,125,0.14)",
              color: "#86f2b4",
              borderRadius: 999,
              padding: "12px 28px",
              fontSize: 28,
              fontWeight: 700
            }}
          >
            oddspadi.com
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#6f867a" }}>18+ · Analysis only · Play responsibly</div>
        </div>
      </div>
    ),
    size
  );
}
