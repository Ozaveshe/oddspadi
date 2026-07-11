export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="op-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3BE87E" />
          <stop offset="1" stopColor="#0E9F52" />
        </linearGradient>
        <linearGradient id="op-bolt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD166" />
          <stop offset="1" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="#0C1613" />
      <circle cx="256" cy="260" r="128" fill="none" stroke="url(#op-ring)" strokeWidth="34" />
      <path
        d="M 298 84 L 194 286 L 252 286 L 216 428 L 330 220 L 270 220 L 306 84 Z"
        fill="url(#op-bolt)"
        stroke="#0C1613"
        strokeWidth="18"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandWord() {
  return (
    <span className="brand-word">
      Odds<em>Padi</em>
    </span>
  );
}
