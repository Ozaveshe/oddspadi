import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DecisionEngineClient } from "./DecisionEngineClient";

export const metadata: Metadata = {
  title: "Decision Engine | OddsPadi",
  description: "Live, evidence-aware football, basketball, and tennis prediction decisions with market odds and value checks."
};

export type DecisionEngineSearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<DecisionEngineSearchParams>;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isEnabled(value: string | string[] | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((one(value) ?? "").trim().toLowerCase());
}

function queryForOps(params: DecisionEngineSearchParams): string {
  const preserve = ["date", "sport", "league", "country", "confidence", "q", "publicHistory", "historical"];
  const query = new URLSearchParams();
  for (const key of preserve) {
    const value = one(params[key]);
    if (value) query.set(key, value);
  }
  return query.size ? `?${query.toString()}` : "";
}

export default async function DecisionEnginePage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  if (isEnabled(params.full) || isEnabled(params.ops) || isEnabled(params.deep)) {
    redirect(`/predictions/decision-engine/ops${queryForOps(params)}`);
  }

  return <DecisionEngineClient params={params} />;
}
