import { vi } from "vitest";

const nativeFetch = globalThis.fetch.bind(globalThis);

async function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const parsed = /^https?:\/\//i.test(url) ? new URL(url) : null;
  if (parsed?.hostname.endsWith(".supabase.co")) {
    return Response.json(
      { message: `Direct Supabase network access is disabled during tests for ${parsed.origin}.` },
      { status: 401, headers: { "x-oddspadi-test-network-blocked": "1" } }
    );
  }
  return nativeFetch(input, init);
}

vi.stubGlobal("fetch", guardedFetch);
