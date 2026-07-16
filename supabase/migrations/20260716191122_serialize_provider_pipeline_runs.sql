-- A single provider/model pipeline owner prevents import, odds, daily and
-- weekly jobs from duplicating the same provider fan-out concurrently.
update public.op_provider_ingestion_runs
set status = 'failed',
    completed_at = now(),
    finished_at = now(),
    error_message = 'Legacy HTTP pipeline stage exceeded its five-minute function window and was closed as stale.',
    errors = '["Legacy HTTP pipeline stage exceeded its five-minute function window and was closed as stale."]'::jsonb,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('pipelineStatus', 'failed', 'staleRunClosedAt', now())
where status = 'running'
  and started_at < now() - interval '5 minutes';

drop index if exists public.op_provider_ingestion_runs_one_running_job_idx;

create unique index op_provider_ingestion_runs_one_running_pipeline_idx
  on public.op_provider_ingestion_runs ((true))
  where status = 'running';
