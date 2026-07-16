-- Trigger helpers run inside writes to model-governance tables. Pin their
-- namespace resolution and remove direct Data API execution so an untrusted
-- role cannot influence object lookup or invoke them as RPC endpoints.

alter function public.op_block_calibration_candidate_mutation()
  set search_path = pg_catalog, public;

alter function public.op_prevent_settled_outcome_rewrite()
  set search_path = pg_catalog, public;

alter function public.op_validate_calibration_promotion()
  set search_path = pg_catalog, public;

revoke execute on function public.op_block_calibration_candidate_mutation()
  from public, anon, authenticated;
revoke execute on function public.op_prevent_settled_outcome_rewrite()
  from public, anon, authenticated;
revoke execute on function public.op_validate_calibration_promotion()
  from public, anon, authenticated;

grant execute on function public.op_block_calibration_candidate_mutation()
  to service_role;
grant execute on function public.op_prevent_settled_outcome_rewrite()
  to service_role;
grant execute on function public.op_validate_calibration_promotion()
  to service_role;
