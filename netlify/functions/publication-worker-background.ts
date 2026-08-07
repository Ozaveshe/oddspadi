import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "../../src/lib/supabase/server";
import { runPublicationCycle, type CycleResult } from "../../src/lib/publication/runPublicationCycle";

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

export type PublicationWorkerOptions = {
  adminToken: string | null;
  scheduleToken: string | null;
  hours?: string | null;
  client?: SupabaseClient | null;
  now?: Date;
};

/**
 * The scheduled half of publishing, where the authorization check lives.
 *
 * A Netlify scheduled function cannot present a verifiable token to itself —
 * the platform invokes it directly, so any secret it checks would have to be
 * one it also supplies. Auth therefore belongs on this worker half, which is
 * reached over HTTP and can demand the shared token. Putting it on the sweep
 * instead is what froze the projection refresh for 8.5 hours.
 */
export async function runPublicationWorker({
  adminToken,
  scheduleToken,
  hours,
  client = getSupabaseServerClient(),
  now = new Date()
}: PublicationWorkerOptions): Promise<Response> {
  const expected = clean(adminToken);
  const supplied = clean(scheduleToken);
  if (!expected) return Response.json({ success: false, error: "Publication worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(expected, supplied)) {
    return Response.json({ success: false, error: "Publication worker authorization failed." }, { status: 401 });
  }
  if (!client) return Response.json({ success: false, error: "Publication worker has no database client." }, { status: 503 });

  const parsedHours = Number(clean(hours));
  const window = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 12;

  let result: CycleResult;
  try {
    result = await runPublicationCycle({ client, hours: window, commit: true, now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publication cycle failed.";
    console.error(JSON.stringify({ event: "oddspadi-publication-worker", success: false, error: message }));
    return Response.json({ success: false, error: message }, { status: 502 });
  }

  const failed = Object.values(result.failures).reduce((total, count) => total + count, 0);
  // A run that publishes nothing is a normal outcome, not a failure: it means
  // the slate held nothing that cleared the gates. Only refused writes are.
  const success = failed === 0;
  console.info(
    JSON.stringify({
      event: "oddspadi-publication-worker",
      success,
      halted: result.haltedReason,
      read: result.read,
      selected: result.selected.length,
      published: result.published,
      reused: result.reused,
      failed
    })
  );

  return Response.json(
    {
      success,
      mode: "scheduled-publication",
      hours: window,
      haltedReason: result.haltedReason,
      read: result.read,
      selected: result.selected.length,
      published: result.published,
      alreadyLive: result.reused,
      distinctFixtures: result.distinctFixtures,
      bands: result.bandSummary,
      rejections: result.rejections,
      failures: result.failures
    },
    { status: success ? 200 : 502 }
  );
}

export default async function publicationWorker(request: Request, _context: Context): Promise<Response> {
  return runPublicationWorker({
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    hours: clean(Netlify.env.get("ODDSPADI_PUBLICATION_HOURS"))
  });
}
