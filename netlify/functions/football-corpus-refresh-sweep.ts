import type { Config, Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FootballCorpusRefreshSweepOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  fetchImpl?: FetchLike;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function runFootballCorpusRefreshSweep({
  siteUrl,
  adminToken,
  fetchImpl = fetch
}: FootballCorpusRefreshSweepOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  if (!baseUrl || !token) {
    return Response.json(
      { success: false, error: "Scheduled football corpus refresh needs the published site URL and ODDSPADI_ADMIN_TOKEN." },
      { status: 503 }
    );
  }

  const endpoint = new URL("/.netlify/functions/football-corpus-refresh-worker-background", baseUrl);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Football corpus refresh request failed." },
      { status: 504 }
    );
  }
}

export default async function footballCorpusRefreshSweep(_request: Request, context: Context): Promise<Response> {
  return runFootballCorpusRefreshSweep({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"))
  });
}

export const config: Config = {
  schedule: "40 3 * * *"
};
