export type DecisionOpenAIProviderErrorKind = "rate-limit" | "quota" | "auth" | "model-or-request" | "server" | "unknown";

export type DecisionOpenAIProviderError = {
  status: number;
  kind: DecisionOpenAIProviderErrorKind;
  code: string | null;
  type: string | null;
  param: string | null;
  message: string | null;
  requestId: string | null;
  reason: string;
};

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function textValue(value: unknown, maxLength = 180): string | null {
  return typeof value === "string" && value.trim() ? compact(value, maxLength) : null;
}

function classify(status: number, code: string | null, type: string | null, message: string | null): DecisionOpenAIProviderErrorKind {
  const haystack = `${code ?? ""} ${type ?? ""} ${message ?? ""}`.toLowerCase();
  if (status === 401 || status === 403 || haystack.includes("auth") || haystack.includes("permission")) return "auth";
  if (status === 429 && (haystack.includes("quota") || haystack.includes("billing") || haystack.includes("insufficient"))) return "quota";
  if (status === 429) return "rate-limit";
  if (status === 400 || status === 404 || haystack.includes("model") || haystack.includes("invalid_request")) return "model-or-request";
  if (status >= 500) return "server";
  return "unknown";
}

function parsePayload(payload: unknown): {
  code: string | null;
  type: string | null;
  param: string | null;
  message: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { code: null, type: null, param: null, message: null };
  }

  const record = payload as Record<string, unknown>;
  const error = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;

  return {
    code: textValue(error.code, 96),
    type: textValue(error.type, 96),
    param: textValue(error.param, 96),
    message: textValue(error.message, 220)
  };
}

export function buildDecisionOpenAIProviderError({
  status,
  payload = null,
  requestId = null
}: {
  status: number;
  payload?: unknown;
  requestId?: string | null;
}): DecisionOpenAIProviderError {
  const parsed = parsePayload(payload);
  const kind = classify(status, parsed.code, parsed.type, parsed.message);
  const details = [
    parsed.type ? `type ${parsed.type}` : null,
    parsed.code ? `code ${parsed.code}` : null,
    parsed.param ? `param ${parsed.param}` : null,
    parsed.message ? `message ${parsed.message}` : null,
    requestId ? `request ${requestId}` : null
  ].filter(Boolean);

  return {
    status,
    kind,
    ...parsed,
    requestId: textValue(requestId, 120),
    reason: compact(`OpenAI Responses API returned HTTP ${status}${details.length ? ` (${details.join("; ")})` : ""}.`, 360)
  };
}

export async function readDecisionOpenAIProviderError(response: Response): Promise<DecisionOpenAIProviderError> {
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: compact(text, 220) } };
    }
  }

  return buildDecisionOpenAIProviderError({
    status: response.status,
    payload,
    requestId: response.headers.get("x-request-id") ?? response.headers.get("openai-request-id")
  });
}
