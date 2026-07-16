import type { Config, Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };
const clean = (value?: string | null) => value?.trim() || null;

export default async function modelLearningSweep(_request: Request, context: Context) {
  const siteUrl = clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL"));
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  if (!siteUrl || !token) return Response.json({ success: false, error: "Model learning sweep configuration is incomplete." }, { status: 503 });
  try {
    return await fetch(new URL("/.netlify/functions/model-learning-worker-background", siteUrl), {
      method: "POST",
      headers: { "x-oddspadi-schedule-token": token },
      signal: AbortSignal.timeout(25_000)
    });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Model learning sweep failed." }, { status: 504 });
  }
}

// Runs after the daily 02:00 UTC intelligence cycle and subsequent result
// settlement windows. The worker recalibrates in shadow; it never self-promotes.
export const config: Config = { schedule: "45 3 * * *" };
