// Must be a real OpenAI model id — the previous default ("gpt-5.5") does not
// exist and would 400 on every request even with a valid key.
export const DEFAULT_OPENAI_DECISION_MODEL = "gpt-5.1";

export type OpenAIDecisionModelEnv = Record<string, string | undefined>;

export function getDecisionOpenAIModel(env: OpenAIDecisionModelEnv = process.env): string {
  return env.OPENAI_DECISION_MODEL?.trim() || DEFAULT_OPENAI_DECISION_MODEL;
}
