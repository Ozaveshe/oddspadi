"use client";

import { useState } from "react";

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
  "south korea": "KR", china: "CN", "saudi arabia": "SA", qatar: "QA", emirates: "AE",
  chile: "CL", colombia: "CO", "dominican republic": "DO", "faroe islands": "FO",
  gibraltar: "GI", "ivory coast": "CI", latvia: "LV", lebanon: "LB", lithuania: "LT",
  "new zealand": "NZ", philippines: "PH", "puerto rico": "PR", vietnam: "VN"
};

function normalizedCountry(country: string): string {
  return country.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
}

export function flagEmoji(country?: string | null): string {
  if (!country || ["world", "europe"].includes(normalizedCountry(country))) return String.fromCodePoint(0x1f30d);
  const code = countryCodes[normalizedCountry(country)];
  if (!code) return String.fromCodePoint(0x1f3f3);
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

export function usableFlagUrl(flag?: string | null): string | null {
  const cleaned = flag?.trim();
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned, "https://oddspadi.invalid");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const filename = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.svg$/i, "").trim();
    return filename ? cleaned : null;
  } catch {
    return null;
  }
}

export function CountryFlag({ country, flag, size = 18 }: { country?: string | null; flag?: string | null; size?: number }) {
  const label = country?.trim() || "Unknown country";
  const usableFlag = usableFlagUrl(flag);
  const [failedFlag, setFailedFlag] = useState<string | null>(null);
  if (usableFlag && failedFlag !== usableFlag) return <img className="country-flag" src={usableFlag} alt={`${label} flag`} width={size} height={Math.round(size * .7)} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedFlag(usableFlag)} />;
  return <span className="country-flag country-flag--emoji" role="img" aria-label={`${label} flag`} style={{ fontSize: size }}>{flagEmoji(country)}</span>;
}
