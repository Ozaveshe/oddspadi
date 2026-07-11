export const DEFAULT_OPENAI_DECISION_MODEL = "gpt-5.5";

export type OpenAIDecisionModelEnv = Record<string, string | undefined>;

export function getDecisionOpenAIModel(env: OpenAIDecisionModelEnv = process.env): string {
  return env.OPENAI_DECISION_MODEL?.trim() || DEFAULT_OPENAI_DECISION_MODEL;
}
