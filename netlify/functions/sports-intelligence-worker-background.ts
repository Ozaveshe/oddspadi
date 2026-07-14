import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function callStage(siteUrl: string, path: string, token: string): Promise<{ path: string; ok: boolean; status: number; body: unknown }> {
  try {
    const response = await fetch(new URL(path, siteUrl), {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(5 * 60_000)
    });
    return { path, ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { path, ok: false, status: 504, body: { error: error instanceof Error ? error.message : "Pipeline stage failed." } };
  }
}

export default async function sportsIntelligenceWorker(request: Request, context: Context): Promise<Response> {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  const supplied = clean(request.headers.get("x-oddspadi-schedule-token"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Sports intelligence worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(token, supplied)) return Response.json({ success: false, error: "Sports intelligence worker authorization failed." }, { status: 401 });

  const requestedFullCycle = new URL(request.url).searchParams.get("full") === "1";
  const configuredFullRunHour = Number(Netlify.env.get("ODDSPADI_INTELLIGENCE_FULL_RUN_HOUR_UTC") ?? "2");
  const fullRunHour = Number.isInteger(configuredFullRunHour) && configuredFullRunHour >= 0 && configuredFullRunHour <= 23
    ? configuredFullRunHour
    : 2;
  const fullCycle = requestedFullCycle || new Date().getUTCHours() === fullRunHour;
  const stages = [];
  if (fullCycle) stages.push(await callStage(siteUrl, "/api/cron/import-fixtures", token));
  stages.push(await callStage(siteUrl, "/api/cron/refresh-odds", token));
  if (fullCycle) {
    stages.push(await callStage(siteUrl, "/api/cron/run-daily-engine", token));
    stages.push(await callStage(siteUrl, "/api/cron/generate-weekly-predictions", token));
  }
  const success = stages.every((stage) => stage.ok);
  console.info(JSON.stringify({ event: "oddspadi-sports-intelligence-cycle", success, fullCycle, stages: stages.map(({ path, ok, status }) => ({ path, ok, status })) }));
  return Response.json({ success, mode: "sports-intelligence-cycle", fullCycle, stages }, { status: success ? 200 : 502 });
}
