import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FootballSettlementWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  fetchImpl?: FetchLike;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function runFootballSettlementWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  fetchImpl = fetch
}: FootballSettlementWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const suppliedToken = clean(scheduleToken);
  if (!baseUrl || !token) {
    return Response.json({ success: false, error: "Settlement worker configuration is incomplete." }, { status: 503 });
  }
  if (!suppliedToken || !tokenMatches(token, suppliedToken)) {
    return Response.json({ success: false, error: "Settlement worker authorization failed." }, { status: 401 });
  }

  const autonomousEndpoint = new URL("/api/sports/decision/autonomous-settlement", baseUrl);
  autonomousEndpoint.searchParams.set("limit", "250");
  const featureEndpoint = new URL("/api/sports/decision/training/football-provider-live-settlement-label-receipt", baseUrl);
  featureEndpoint.searchParams.set("run", "1");
  featureEndpoint.searchParams.set("dryRun", "0");
  featureEndpoint.searchParams.set("limit", "250");

  try {
    const requestInit: RequestInit = {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(10 * 60_000)
    };
    const autonomousResponse = await fetchImpl(autonomousEndpoint, requestInit);
    const autonomousBody = await autonomousResponse.json().catch(() => null);
    const featureResponse = await fetchImpl(featureEndpoint, requestInit);
    const featureBody = await featureResponse.json().catch(() => null);
    const success = autonomousResponse.ok && featureResponse.ok;
    return Response.json(
      {
        success,
        autonomousOutcomes: { status: autonomousResponse.status, body: autonomousBody },
        trainingLabels: { status: featureResponse.status, body: featureBody }
      },
      { status: success ? 200 : autonomousResponse.ok ? featureResponse.status : autonomousResponse.status }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Settlement worker request failed."
      },
      { status: 504 }
    );
  }
}

export default async function footballSettlementWorker(request: Request, context: Context): Promise<Response> {
  return runFootballSettlementWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token")
  });
}
