-- Keep provider run health honest at the database boundary. Previously the
-- application collapsed partial, empty, and unavailable runs into completed,
-- leaving operators and product health checks with a misleading status.
alter table public.op_provider_ingestion_runs
  drop constraint if exists op_provider_ingestion_runs_status_check;

alter table public.op_provider_ingestion_runs
  add constraint op_provider_ingestion_runs_status_check
  check (status in ('queued', 'running', 'completed', 'partial', 'empty', 'failed', 'unavailable'));

update public.op_provider_ingestion_runs
set status = metadata ->> 'pipelineStatus'
where metadata ->> 'pipelineStatus' in ('completed', 'partial', 'empty', 'failed', 'unavailable')
  and status is distinct from metadata ->> 'pipelineStatus';

update public.op_provider_ingestion_runs
set
  status = 'failed',
  completed_at = coalesce(completed_at, now()),
  finished_at = coalesce(finished_at, now()),
  error_message = coalesce(error_message, 'Provider run exceeded the two-hour completion window and was closed as stale.'),
  errors = case
    when jsonb_typeof(errors) = 'array' and jsonb_array_length(errors) > 0 then errors
    else jsonb_build_array('Provider run exceeded the two-hour completion window and was closed as stale.')
  end,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'pipelineStatus', 'failed',
    'staleRunClosedAt', now()
  )
where status = 'running'
  and started_at < now() - interval '2 hours';
