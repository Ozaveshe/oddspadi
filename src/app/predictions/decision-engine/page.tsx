import type { Metadata } from "next";
import { DecisionEngineClient } from "./DecisionEngineClient";

export const metadata: Metadata = {
  title: "AI Decision Engine",
  description: "Live, evidence-aware football, basketball, and tennis prediction decisions with market odds and value checks.",
  alternates: { canonical: "/predictions/decision-engine" },
  openGraph: {
    title: "AI Decision Engine — OddsPadi",
    description: "Live, evidence-aware football, basketball, and tennis prediction decisions with market odds and value checks."
  }
};

export type DecisionEngineSearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<DecisionEngineSearchParams>;
};

// The deep operator console (formerly /predictions/decision-engine/ops) has been
// archived out of the build to src/_archived/decision-engine-ops. The public
// "AI Engine" page renders the client summary directly.
export default async function DecisionEnginePage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  return <DecisionEngineClient params={params} />;
}
