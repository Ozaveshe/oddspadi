import type { GeneratedEditorialStory } from "./generatedStories";

/**
 * Optional OpenAI rewrite pass for generated editorial stories. The
 * deterministic generators guarantee factual grounding; this pass only
 * improves the prose. Any failure (no key, bad model, timeout, malformed
 * response) falls back to the deterministic text, so the pipeline can never
 * lose a story to the LLM.
 */

export const DEFAULT_EDITORIAL_OPENAI_MODEL = "gpt-5-mini";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "excerpt", "body"],
  properties: {
    title: { type: "string", minLength: 10, maxLength: 140 },
    excerpt: { type: "string", minLength: 20, maxLength: 320 },
    body: { type: "array", minItems: 2, maxItems: 10, items: { type: "string", minLength: 20 } }
  }
} as const;

const SYSTEM_PROMPT = [
  "You are the matchday desk editor for OddsPadi, a sports prediction site for African fans.",
  "Rewrite the draft story into warm, plain-language editorial prose. Voice: a knowledgeable friend ('your football padi'), never hype.",
  "Hard rules:",
  "- Keep every fact, number, team name, percentage and date exactly as given. Never invent fixtures, stats or quotes.",
  "- Never promise wins or 'sure odds'. Keep the honest, responsible-play framing of the draft.",
  "- Keep any sentence that explains data limitations or uncertainty, rephrased but intact in meaning.",
  "- 3-6 body paragraphs, each 1-4 sentences. No markdown, no headings, no emojis."
].join("\n");

type PolishResult = { title: string; excerpt: string; body: string[] };

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> };
  if (typeof record.output_text === "string" && record.output_text) return record.output_text;
  for (const item of record.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text) return content.text;
    }
  }
  return null;
}

export async function polishEditorialStory(
  story: GeneratedEditorialStory,
  options: { apiKey: string; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<GeneratedEditorialStory> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model?.trim() || DEFAULT_EDITORIAL_OPENAI_MODEL,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              category: story.category,
              sport: story.sport,
              title: story.title,
              excerpt: story.excerpt,
              body: story.body
            })
          }
        ],
        text: {
          format: { type: "json_schema", name: "OddsPadiEditorialPolish", strict: true, schema: RESPONSE_SCHEMA }
        }
      })
    });
    if (!response.ok) return story;
    const text = extractOutputText(await response.json().catch(() => null));
    if (!text) return story;
    const parsed = JSON.parse(text) as PolishResult;
    if (
      typeof parsed.title !== "string" || parsed.title.length < 10 ||
      typeof parsed.excerpt !== "string" || parsed.excerpt.length < 20 ||
      !Array.isArray(parsed.body) || parsed.body.length < 2 ||
      parsed.body.some((paragraph) => typeof paragraph !== "string" || paragraph.length < 20)
    ) {
      return story;
    }
    return {
      ...story,
      title: parsed.title.slice(0, 140),
      excerpt: parsed.excerpt.slice(0, 320),
      body: parsed.body.slice(0, 10)
    };
  } catch {
    return story;
  } finally {
    clearTimeout(timeout);
  }
}

export async function polishEditorialStories(
  stories: GeneratedEditorialStory[],
  options: { apiKey: string | null; model?: string | null; fetchImpl?: typeof fetch }
): Promise<GeneratedEditorialStory[]> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return stories;
  return Promise.all(
    stories.map((story) =>
      polishEditorialStory(story, { apiKey, model: options.model ?? undefined, fetchImpl: options.fetchImpl })
    )
  );
}
