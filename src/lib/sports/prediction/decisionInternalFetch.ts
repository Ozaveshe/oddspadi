type DecisionApiEnvelope<T> = {
  success?: boolean;
  data?: T | null;
};

type DecisionFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

export type DecisionInternalFetchOptions = {
  fetchImpl?: DecisionFetch;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDecisionApiData<T>(
  url: URL | string,
  { fetchImpl = fetch as DecisionFetch, timeoutMs = 45000, maxAttempts = 2, retryDelayMs = 350 }: DecisionInternalFetchOptions = {}
): Promise<T | null> {
  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
      const payload = (await response.json().catch(() => null)) as DecisionApiEnvelope<T> | null;
      if (response.ok && payload?.success && payload.data) return payload.data;
    } catch {
      // Transient local fetch resets are retried; callers decide how to degrade if all attempts fail.
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < attempts - 1) await delay(retryDelayMs);
  }

  return null;
}
