import type { OddsMarket, ValueEdge } from "@/lib/sports/types";

export type ExecutionPriceReceipt = Pick<ValueEdge, "bookmaker" | "priceObservedAt" | "priceMethod">;
export type ExecutionPriceState = "best-price" | "quoted" | "source-missing";

export type ExecutionPricePresentation = {
  state: ExecutionPriceState;
  label: string;
  source: string;
  timestamp: string;
  detail: string;
};

function formattedTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date);
}

function priceLabel(method: OddsMarket["priceMethod"] | undefined): string {
  return method === "best-price-per-selection-v1" ? "Best executable quote" : "Executable quote";
}

export function buildExecutionPricePresentation(receipt?: ExecutionPriceReceipt | null): ExecutionPricePresentation {
  const source = receipt?.bookmaker?.name?.trim() || "Bookmaker source unavailable";
  const timestamp = formattedTimestamp(receipt?.priceObservedAt) ?? "Selection update time unavailable";
  if (!receipt?.bookmaker) {
    return {
      state: "source-missing",
      label: "Quote provenance incomplete",
      source,
      timestamp,
      detail: `${source} / ${timestamp}. Do not treat this as a verified best-price claim.`
    };
  }

  const bestPrice = receipt.priceMethod === "best-price-per-selection-v1";
  return {
    state: bestPrice ? "best-price" : "quoted",
    label: priceLabel(receipt.priceMethod),
    source,
    timestamp,
    detail: `${source} / ${timestamp}.${bestPrice ? " The consensus probability is calculated separately." : ""}`
  };
}
