import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0C1613"
        }}
      >
        <svg width="180" height="180" viewBox="0 0 512 512">
          <circle cx="256" cy="260" r="128" fill="none" stroke="#2BD673" strokeWidth="34" />
          <path
            d="M 298 84 L 194 286 L 252 286 L 216 428 L 330 220 L 270 220 L 306 84 Z"
            fill="#FFC53D"
            stroke="#0C1613"
            strokeWidth="18"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size
  );
}
