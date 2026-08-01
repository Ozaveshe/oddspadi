import { readOperationalStatus, toPublicStatus } from "@/lib/readmodel/publicStatus";

export const dynamic = "force-dynamic";

/**
 * The public status endpoint: one word and one timestamp.
 *
 * Everything an operator would want — which projection is failing, what the
 * database said, which job last succeeded — is deliberately absent. That
 * detail is available through the private operational read, and publishing it
 * would tell an anonymous caller exactly which part of the system is weakest.
 */
export async function GET() {
  const operational = await readOperationalStatus().catch(() => ({ readable: false, projections: [], jobs: {} }));
  const payload = toPublicStatus(operational);
  return Response.json(payload, {
    status: payload.status === "unavailable" ? 503 : 200,
    headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" }
  });
}
