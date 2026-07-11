import { apiSuccess } from "@/app/api/sports/_utils";
import { readFootballProviderFeatureIntakeGapReceipt } from "@/lib/sports/training/footballProviderFeatureIntakeGapReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const receipt = await readFootballProviderFeatureIntakeGapReceipt({
    env: process.env,
    origin: url.origin,
    targetDate: url.searchParams.get("date") ?? undefined
  });

  return apiSuccess(receipt, { status: receipt.status === "failed" ? 500 : 200 });
}
