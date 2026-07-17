import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type MultiSportDecisionCycleWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  fetchImpl?: FetchLike;
};

type WorkerStage = {
  name: "refresh-odds" | "run-daily-engine";
  path: string;
  ok: boolean;
  status: number;
  pipelineStatus: string | null;
  body: unknown;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pipelineStatus(body: unknown): string | null {
  const status = record(record(record(body).data).run).status;
  return typeof status === "string" ? status : null;
}

async function callPipelineStage(
  fetchImpl: FetchLike,
  baseUrl: string,
  token: string,
  name: WorkerStage["name"]
): Promise<WorkerStage> {
  const endpoint = new URL(`/api/cron/${name}`, baseUrl);
  endpoint.searchParams.set("sports", "basketball,tennis");
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(4 * 60_000)
    });
    const body = await response.json().catch(() => null);
    const status = pipelineStatus(body);
    const degraded = status === "partial" || status === "failed" || status === "unavailable";
    return {
      name,
      path: endpoint.pathname,
      ok: response.ok && status !== null && !degraded,
      status: response.status,
      pipelineStatus: status,
      body
    };
  } catch (error) {
    return {
      name,
      path: endpoint.pathname,
      ok: false,
      status: 504,
      pipelineStatus: null,
      body: { success: false, error: error instanceof Error ? error.message : `Scheduled ${name} stage failed.` }
    };
  }
}

export async function runMultiSportDecisionCycleWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  fetchImpl = fetch
}: MultiSportDecisionCycleWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const suppliedToken = clean(scheduleToken);
  if (!baseUrl || !token) return Response.json({ success: false, error: "Multi-sport decision cycle worker configuration is incomplete." }, { status: 503 });
  if (!suppliedToken || !tokenMatches(token, suppliedToken)) {
    return Response.json({ success: false, error: "Multi-sport decision cycle worker authorization failed." }, { status: 401 });
  }

  const stages: WorkerStage[] = [];
  stages.push(await callPipelineStage(fetchImpl, baseUrl, token, "refresh-odds"));
  stages.push(await callPipelineStage(fetchImpl, baseUrl, token, "run-daily-engine"));
  const success = stages.every((stage) => stage.ok);
  console.info(JSON.stringify({
    event: "oddspadi-scheduled-multi-sport-pipeline-cycle",
    success,
    sports: ["basketball", "tennis"],
    stages: stages.map(({ name, path, ok, status, pipelineStatus }) => ({ name, path, ok, status, pipelineStatus }))
  }));
  return Response.json({
    success,
    mode: "scheduled-multi-sport-pipeline-cycle",
    sports: ["basketball", "tennis"],
    stages
  }, { status: success ? 200 : 502 });
}

export default async function multiSportDecisionCycleWorker(request: Request, context: Context): Promise<Response> {
  return runMultiSportDecisionCycleWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token")
  });
}
