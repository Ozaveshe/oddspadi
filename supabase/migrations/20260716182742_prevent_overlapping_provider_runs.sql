-- A canonical job type may have only one active receipt. Serverless retries or
-- anonymous fan-out must observe the existing owner instead of starting a
-- second provider/decision pass.
update public.op_fixtures
set status = 'suspended',
    updated_at = now()
where status = 'live'
  and last_synced_at < now() - interval '6 hours'
  and home_score is null
  and away_score is null;

create unique index if not exists op_provider_ingestion_runs_one_running_job_idx
  on public.op_provider_ingestion_runs (job_type)
  where status = 'running' and job_type is not null;
