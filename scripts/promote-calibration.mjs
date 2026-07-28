#!/usr/bin/env node
/**
 * Promote a calibration candidate to the active champion profile.
 *
 *   node scripts/promote-calibration.mjs --sport football            # list
 *   node scripts/promote-calibration.mjs --sport football --promote <id> \
 *     --by "ozaveshe" --rationale "n=34, Brier skill +0.06"
 *
 * Until this existed there was no way to promote anything: the engine writes
 * calibration candidates on every run, `promoteCalibrationCandidate` had no
 * caller anywhere in the codebase, and `op_calibration_promotions` stayed empty
 * forever. That left the empirical 95% value floor permanently unavailable.
 *
 * A candidate carries its own `metrics.promotionReadiness` verdict. This script
 * refuses to promote one that reports `canInfluenceLive: false` unless you pass
 * --force, so a model that has not beaten the base rate cannot be pushed into
 * the live publication path by accident.
 */
import { createClient } from "@supabase/supabase-js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const sport = arg("sport", "football");
const client = createClient(url, key, { auth: { persistSession: false } });

function readiness(candidate) {
  return candidate?.metrics?.promotionReadiness ?? null;
}

async function list() {
  const { data, error } = await client
    .from("op_calibration_candidates")
    .select("id,sport,model_key,engine_version,sample_size,settled_size,metrics,generated_at")
    .eq("sport", sport)
    .order("generated_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  if (!data?.length) {
    console.log(`No calibration candidates stored for ${sport}.`);
    return;
  }
  const { data: active } = await client
    .from("op_calibration_promotions")
    .select("id,candidate_id,model_key,approved_at")
    .eq("sport", sport)
    .eq("status", "approved")
    .is("revoked_at", null);
  console.log(`Active ${sport} promotions: ${active?.length ? active.map((row) => row.model_key).join(", ") : "none"}\n`);

  for (const candidate of data) {
    const ready = readiness(candidate);
    const verdict = ready?.canInfluenceLive ? "ELIGIBLE" : `blocked (${ready?.status ?? "unknown"})`;
    console.log(`${candidate.id}  ${candidate.model_key}  settled=${candidate.settled_size}  ${verdict}`);
    for (const blocker of ready?.blockers ?? []) console.log(`    - ${blocker}`);
  }
}

async function promote(candidateId) {
  const { data: candidate, error } = await client
    .from("op_calibration_candidates")
    .select("id,sport,model_key,metrics")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!candidate) throw new Error(`Candidate ${candidateId} was not found.`);

  const ready = readiness(candidate);
  if (!ready?.canInfluenceLive && !has("force")) {
    console.error(`Refusing to promote ${candidate.model_key}: the candidate reports canInfluenceLive=false.`);
    for (const blocker of ready?.blockers ?? []) console.error(`  - ${blocker}`);
    console.error("Re-run with --force only if you accept publishing against an unvalidated profile.");
    process.exit(2);
  }

  const approvedBy = arg("by");
  const rationale = arg("rationale");
  if (!approvedBy || !rationale) {
    console.error("--by and --rationale are required so the promotion is attributable.");
    process.exit(1);
  }

  const { data, error: rpcError } = await client.rpc("op_promote_calibration_challenger", {
    p_candidate_id: candidateId,
    p_approved_by: approvedBy,
    p_rationale: rationale,
    p_expires_at: arg("expires") ?? null,
    p_comparison_receipt_id: arg("comparison") ?? null
  });
  if (rpcError) throw new Error(rpcError.message);
  console.log(`Promoted ${candidate.model_key} (${candidate.sport}). Promotion id: ${data ?? "unknown"}`);
}

const target = arg("promote");
try {
  if (target) await promote(target);
  else await list();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
