import type { DecisionEngineReport, DecisionEnhancementResult, Match, Prediction } from "@/lib/sports/types";
import { readDecisionOpenAIProviderError } from "./decisionOpenAIProviderError";
import { getDecisionOpenAIModel } from "./openaiModel";

type EnhancementResponse = {
  summary: string;
  risks: string[];
  nextChecks: string[];
};

const enhancementSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    nextChecks: { type: "array", items: { type: "string" } }
  },
  required: ["summary", "risks", "nextChecks"]
};

export function extractOutputText(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const record = response as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;

  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
      }
    }
  }

  return null;
}

export function safeParseEnhancement(text: string): EnhancementResponse | null {
  try {
    const parsed = JSON.parse(text) as Partial<EnhancementResponse>;
    if (!parsed.summary || !Array.isArray(parsed.risks) || !Array.isArray(parsed.nextChecks)) return null;
    return {
      summary: parsed.summary,
      risks: parsed.risks.filter((item): item is string => typeof item === "string").slice(0, 5),
      nextChecks: parsed.nextChecks.filter((item): item is string => typeof item === "string").slice(0, 5)
    };
  } catch {
    return null;
  }
}

export function buildOpenAIDecisionPayload({
  match,
  prediction,
  model
}: {
  match: Match;
  prediction: Prediction;
  model: string;
}) {
  return {
    model,
    store: false,
    reasoning: { effort: "low", summary: "auto" },
    input: [
      {
        role: "system",
        content:
          "You are OddsPadi's responsible sports analysis agent. Improve the visible decision summary only. Do not claim certainty, do not invent data, and do not recommend betting as required action."
      },
      {
        role: "user",
        content: JSON.stringify({
          fixture: {
            homeTeam: match.homeTeam.name,
            awayTeam: match.awayTeam.name,
            league: match.league.name,
            country: match.league.country,
            status: match.status
          },
          prediction: {
            bestPick: prediction.bestPick,
            diagnostics: prediction.diagnostics,
            decision: prediction.decision
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "OddsPadiDecisionEnhancement",
        strict: true,
        schema: enhancementSchema
      }
    },
    max_output_tokens: 900
  };
}

export async function runDecisionEnhancementWithOpenAI({
  match,
  prediction,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch
}: {
  match: Match;
  prediction: Prediction;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionEnhancementResult> {
  if (!apiKey) {
    return {
      requested: true,
      provider: "deterministic",
      status: "not-configured",
      decision: {
        ...prediction.decision,
        llmStatus: "not-configured",
        llmFailureReason: "OPENAI_API_KEY is not configured."
      },
      reason: "OPENAI_API_KEY is not configured."
    };
  }

  const payload = buildOpenAIDecisionPayload({ match, prediction, model });

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const providerError = await readDecisionOpenAIProviderError(response);
      const reason = providerError.reason;
      return {
        requested: true,
        provider: "openai",
        status: "provider-error",
        model,
        decision: {
          ...prediction.decision,
          llmStatus: "provider-error",
          llmFailureReason: reason
        },
        reason
      };
    }

    const json = (await response.json()) as unknown;
    const outputText = extractOutputText(json);
    if (!outputText) {
      const reason = "OpenAI response did not include output text.";
      return {
        requested: true,
        provider: "openai",
        status: "invalid-response",
        model,
        decision: {
          ...prediction.decision,
          llmStatus: "invalid-response",
          llmFailureReason: reason
        },
        reason
      };
    }

    const enhancement = safeParseEnhancement(outputText);
    if (!enhancement) {
      const reason = "OpenAI response did not match the decision enhancement schema.";
      return {
        requested: true,
        provider: "openai",
        status: "invalid-response",
        model,
        decision: {
          ...prediction.decision,
          llmStatus: "invalid-response",
          llmFailureReason: reason
        },
        reason
      };
    }

    const decision = {
      ...prediction.decision,
      summary: enhancement.summary,
      risks: Array.from(new Set([...enhancement.risks, ...prediction.decision.risks])).slice(0, 7),
      nextChecks: Array.from(new Set([...enhancement.nextChecks, ...prediction.decision.nextChecks])).slice(0, 7),
      llmEnhanced: true,
      llmModel: model,
      llmStatus: "enhanced" as const
    };

    return {
      requested: true,
      provider: "openai",
      status: "enhanced",
      model,
      decision
    };
  } catch {
    const reason = "OpenAI request failed before a valid response was received.";
    return {
      requested: true,
      provider: "openai",
      status: "provider-error",
      model,
      decision: {
        ...prediction.decision,
        llmStatus: "provider-error",
        llmFailureReason: reason
      },
      reason
    };
  }
}

export async function enhanceDecisionWithOpenAI(args: {
  match: Match;
  prediction: Prediction;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionEngineReport> {
  return (await runDecisionEnhancementWithOpenAI(args)).decision;
}
