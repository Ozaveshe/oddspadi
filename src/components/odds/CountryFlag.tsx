const countryCodes: Record<string, string> = {
  england: "GB", nigeria: "NG", ghana: "GH", "south africa": "ZA", egypt: "EG", morocco: "MA",
  kenya: "KE", tanzania: "TZ", uganda: "UG", zambia: "ZM", senegal: "SN", cameroon: "CM",
  algeria: "DZ", tunisia: "TN", rwanda: "RW", ethiopia: "ET", angola: "AO", mali: "ML",
  france: "FR", germany: "DE", italy: "IT", spain: "ES", portugal: "PT", netherlands: "NL",
  turkey: "TR", brazil: "BR", argentina: "AR", mexico: "MX", canada: "CA", "united states": "US",
  usa: "US", japan: "JP", australia: "AU", india: "IN", scotland: "GB", wales: "GB",
  ireland: "IE", "northern ireland": "GB", belgium: "BE", denmark: "DK", sweden: "SE",
  norway: "NO", finland: "FI", poland: "PL", austria: "AT", switzerland: "CH",
  greece: "GR", croatia: "HR", serbia: "RS", romania: "RO", bulgaria: "BG",
  ukraine: "UA", czechia: "CZ", "czech republic": "CZ", slovakia: "SK", slovenia: "SI",
  hungary: "HU", cyprus: "CY", israel: "IL", georgia: "GE", armenia: "AM",
  azerbaijan: "AZ", kazakhstan: "KZ", iceland: "IS", albania: "AL", kosovo: "XK",
  montenegro: "ME", "north macedonia": "MK", bosnia: "BA", "bosnia and herzegovina": "BA",
  "south korea": "KR", china: "CN", "saudi arabia": "SA", qatar: "QA", emirates: "AE"
};

export function flagEmoji(country?: string | null): string {
  if (!country || ["world", "europe"].includes(country.trim().toLowerCase())) return String.fromCodePoint(0x1f30d);
  const code = countryCodes[country.trim().toLowerCase()];
  if (!code) return String.fromCodePoint(0x1f3f3);
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

export function CountryFlag({ country, flag, size = 18 }: { country?: string | null; flag?: string | null; size?: number }) {
  const label = country?.trim() || "Unknown country";
  if (flag) return <img className="country-flag" src={flag} alt={`${label} flag`} width={size} height={Math.round(size * .7)} loading="lazy" referrerPolicy="no-referrer" />;
  return <span className="country-flag country-flag--emoji" role="img" aria-label={`${label} flag`} style={{ fontSize: size }}>{flagEmoji(country)}</span>;
}
