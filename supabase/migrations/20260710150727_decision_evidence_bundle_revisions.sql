-- Immutable evidence revisions for reproducible OddsPadi decisions.
--
-- `op_decision_runs` remains the latest materialized decision for a fixture/input
-- pair. This table keeps an append-only copy of every materially distinct final
-- decision with the exact provider, model, market, and context state used.

alter table public.op_decision_runs
  add column if not exists model_version_id uuid references public.op_model_versions(id) on delete restrict,
  add column if not exists evidence_hash text,
  add column if not exists decision_hash text,
  add column if not exists evidence_schema_version text;

create index if not exists op_decision_runs_model_version_created_idx
  on public.op_decision_runs (model_version_id, created_at desc)
  where model_version_id is not null;

create index if not exists op_decision_runs_evidence_hash_created_idx
  on public.op_decision_runs (fixture_external_id, evidence_hash, created_at desc)
  where evidence_hash is not null;

create table if not exists public.op_decision_evidence_bundles (
  id uuid primary key default gen_random_uuid(),
  decision_run_id uuid not null references public.op_decision_runs(id) on delete restrict,
  fixture_external_id text not null,
  sport text not null,
  engine_version text not null,
  model_key text,
  model_version_id uuid references public.op_model_versions(id) on delete restrict,
  evidence_schema_version text not null,
  evidence_hash text not null,
  decision_hash text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  source_manifest jsonb not null default '{}'::jsonb,
  market_snapshot jsonb not null default '{}'::jsonb,
  model_snapshot jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  decision_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (decision_run_id, evidence_hash, decision_hash)
);

create index if not exists op_decision_evidence_bundles_fixture_created_idx
  on public.op_decision_evidence_bundles (fixture_external_id, created_at desc);

create index if not exists op_decision_evidence_bundles_model_version_created_idx
  on public.op_decision_evidence_bundles (model_version_id, created_at desc)
  where model_version_id is not null;

create index if not exists op_decision_evidence_bundles_evidence_hash_idx
  on public.op_decision_evidence_bundles (evidence_hash, created_at desc);

-- Existing rows predate the evidence-bundle format. They remain readable and
-- are marked with their best available deterministic input identity.
update public.op_decision_runs
set
  evidence_hash = coalesce(evidence_hash, input_hash),
  decision_hash = coalesce(
    decision_hash,
    md5(
      concat_ws(
        '|',
        fixture_external_id,
        coalesce(input_hash, ''),
        engine_version,
        coalesce(model_key, ''),
        verdict,
        action,
        coalesce(recommended_selection, ''),
        summary
      )
    )
  ),
  evidence_schema_version = coalesce(evidence_schema_version, 'legacy-decision-run-v1')
where evidence_hash is null
   or decision_hash is null
   or evidence_schema_version is null;

revoke all on public.op_decision_evidence_bundles from anon, authenticated;
grant select, insert on public.op_decision_evidence_bundles to service_role;
alter table public.op_decision_evidence_bundles enable row level security;

create or replace function public.prevent_op_decision_evidence_bundle_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'op_decision_evidence_bundles is append-only'
    using errcode = '55000';
end;
$$;

revoke all on function public.prevent_op_decision_evidence_bundle_mutation() from public, anon, authenticated;
grant execute on function public.prevent_op_decision_evidence_bundle_mutation() to service_role;

drop trigger if exists op_decision_evidence_bundles_immutable on public.op_decision_evidence_bundles;
create trigger op_decision_evidence_bundles_immutable
before update or delete on public.op_decision_evidence_bundles
for each row execute function public.prevent_op_decision_evidence_bundle_mutation();

comment on table public.op_decision_evidence_bundles is
  'Append-only evidence bundle revisions for reproducible OddsPadi decisions. Server-only; every row captures the exact input, provenance, market, model, context, and final decision state.';

comment on column public.op_decision_runs.evidence_hash is
  'Stable hash of provider-backed fixture, market, model, and context inputs used by the decision.';

comment on column public.op_decision_runs.decision_hash is
  'Stable hash of the final decision output, including any grounded AI review result.';

comment on column public.op_decision_runs.evidence_schema_version is
  'Codec version for reconstructing the decision evidence bundle.';
