const countryCodes: Record<string, string> = {
  england: "GB", nigeria: "NG", ghana: "GH", "south africa": "ZA", egypt: "EG", morocco: "MA",
  kenya: "KE", tanzania: "TZ", uganda: "UG", zambia: "ZM", senegal: "SN", cameroon: "CM",
  algeria: "DZ", tunisia: "TN", rwanda: "RW", ethiopia: "ET", angola: "AO", mali: "ML",
  france: "FR", germany: "DE", italy: "IT", spain: "ES", portugal: "PT", netherlands: "NL",
  turkey: "TR", brazil: "BR", argentina: "AR", mexico: "MX", canada: "CA", "united states": "US",
  usa: "US", japan: "JP", australia: "AU", india: "IN"
};

function flagEmoji(country: string): string {
  if (country.toLowerCase() === "world") return "🌍";
  const code = countryCodes[country.trim().toLowerCase()];
  if (!code) return "🏳";
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

export function CountryFlag({ country, flag, size = 18 }: { country: string; flag?: string | null; size?: number }) {
  if (flag) return <img className="country-flag" src={flag} alt={`${country} flag`} width={size} height={Math.round(size * .7)} loading="lazy" referrerPolicy="no-referrer" />;
  return <span className="country-flag country-flag--emoji" role="img" aria-label={`${country} flag`} style={{ fontSize: size }}>{flagEmoji(country)}</span>;
}
