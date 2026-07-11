import { apiSuccess } from "@/app/api/sports/_utils";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const receipt = await readSupabaseTrainingCorpusCensus({
    env: process.env,
    origin: url.origin
  });

  return apiSuccess(receipt, { status: receipt.status === "failed" ? 500 : 200 });
}
