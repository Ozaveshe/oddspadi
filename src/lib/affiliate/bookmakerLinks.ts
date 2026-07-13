export type AffiliateMarket = "NG" | "GH" | "KE" | "ZA";

type BookmakerLinkConfig = {
  id: string;
  displayName: string;
  baseUrl: string;
  affiliateTagEnv: string;
  licensedMarketsEnv: string;
  tagParam: string;
};

export const BOOKMAKER_LINKS = [
  { id: "bet365", displayName: "bet365", baseUrl: "https://www.bet365.com/", affiliateTagEnv: "ODDSPADI_AFFILIATE_BET365_TAG", licensedMarketsEnv: "ODDSPADI_AFFILIATE_BET365_MARKETS", tagParam: "affiliate" },
  { id: "betway", displayName: "Betway", baseUrl: "https://betway.com/", affiliateTagEnv: "ODDSPADI_AFFILIATE_BETWAY_TAG", licensedMarketsEnv: "ODDSPADI_AFFILIATE_BETWAY_MARKETS", tagParam: "btag" },
  { id: "unibet", displayName: "Unibet", baseUrl: "https://www.unibet.com/", affiliateTagEnv: "ODDSPADI_AFFILIATE_UNIBET_TAG", licensedMarketsEnv: "ODDSPADI_AFFILIATE_UNIBET_MARKETS", tagParam: "affiliate" },
  { id: "williamhill", displayName: "William Hill", baseUrl: "https://www.williamhill.com/", affiliateTagEnv: "ODDSPADI_AFFILIATE_WILLIAMHILL_TAG", licensedMarketsEnv: "ODDSPADI_AFFILIATE_WILLIAMHILL_MARKETS", tagParam: "affiliate" }
] as const satisfies readonly BookmakerLinkConfig[];

const COUNTRY_MARKET: Record<string, AffiliateMarket | undefined> = {
  nigeria: "NG",
  ghana: "GH",
  kenya: "KE",
  "south africa": "ZA"
};

function configuredMarkets(value: string | undefined): AffiliateMarket[] {
  return (value ?? "")
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter((market): market is AffiliateMarket => ["NG", "GH", "KE", "ZA"].includes(market));
}

export function affiliateMarketForCountry(country: string): AffiliateMarket | null {
  return COUNTRY_MARKET[country.trim().toLowerCase()] ?? null;
}

export function bookmakerDisplayName(bookmakerId: string, providerName?: string): string {
  return BOOKMAKER_LINKS.find((bookmaker) => bookmaker.id === bookmakerId.toLowerCase())?.displayName ?? providerName ?? bookmakerId;
}

export function affiliateBookmakerLink(
  bookmakerId: string,
  country: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  const config = BOOKMAKER_LINKS.find((bookmaker) => bookmaker.id === bookmakerId.toLowerCase());
  const market = affiliateMarketForCountry(country);
  if (!config || !market) return null;

  const tag = env[config.affiliateTagEnv]?.trim();
  const licensedMarkets = configuredMarkets(env[config.licensedMarketsEnv]);
  if (!tag || !licensedMarkets.includes(market)) return null;

  const url = new URL(config.baseUrl);
  url.searchParams.set(config.tagParam, tag);
  return url.toString();
}
