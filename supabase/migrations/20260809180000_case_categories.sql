-- Normalized case category.
--
-- A case already carries `kind` (the raw alert vocabulary). `category` is the
-- operational class a human triages by, and the class the dashboards, SLAs and
-- escalation paths key off. Twelve categories, mapped from kinds in
-- src/lib/ops/caseCategories.ts.

alter table public.op_operational_cases
  add column if not exists category text;

alter table public.op_operational_cases
  drop constraint if exists op_operational_cases_category_check;
alter table public.op_operational_cases
  add constraint op_operational_cases_category_check
  check (category is null or category in (
    'stale_fixture', 'stale_odds', 'identity_mismatch', 'market_mismatch',
    'result_conflict', 'settlement_exception', 'missing_close', 'record_mismatch',
    'content_error', 'user_report', 'community_abuse', 'provider_outage'
  ));

create index if not exists op_operational_cases_category_idx
  on public.op_operational_cases (category, state);

-- Recreate the upsert RPC with p_category. The added parameter changes the
-- signature, so the previous one is dropped first (an overload would leave two).
drop function if exists public.op_upsert_operational_case(text, text, text, text, text, uuid, uuid, timestamptz, jsonb, text);

create or replace function public.op_upsert_operational_case(
  p_workspace text,
  p_source text,
  p_kind text,
  p_severity text,
  p_title text,
  p_category text default null,
  p_exception_id uuid default null,
  p_report_id uuid default null,
  p_due_at timestamptz default null,
  p_detail jsonb default '{}'::jsonb,
  p_actor_fingerprint text default 'system:case-sync'
)
returns public.op_operational_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.op_operational_cases;
begin
  if p_exception_id is not null then
    update public.op_operational_cases
    set severity = p_severity, title = p_title, category = p_category, detail = p_detail
    where exception_id = p_exception_id and state not in ('resolved', 'dismissed')
    returning * into v_row;
    if found then
      return v_row;
    end if;
  elsif p_report_id is not null then
    update public.op_operational_cases
    set severity = p_severity, title = p_title, category = p_category, detail = p_detail
    where report_id = p_report_id and state not in ('resolved', 'dismissed')
    returning * into v_row;
    if found then
      return v_row;
    end if;
  end if;

  insert into public.op_operational_cases (
    workspace, source, category, exception_id, report_id, kind, severity, title, due_at, detail, state
  ) values (
    p_workspace, p_source, p_category, p_exception_id, p_report_id, p_kind, p_severity, p_title, p_due_at, p_detail, 'open'
  )
  returning * into v_row;

  insert into public.op_operational_case_events (case_id, actor_fingerprint, event_type, to_state, detail)
  values (v_row.id, p_actor_fingerprint, 'opened', 'open', p_detail);

  return v_row;
end;
$$;

comment on function public.op_upsert_operational_case is
  'Idempotently open (or refresh) a categorised case for an exception/report. Returns the open case if one exists; else inserts it and writes the opened timeline event. Never resets opened_at.';

revoke all on function public.op_upsert_operational_case(text, text, text, text, text, text, uuid, uuid, timestamptz, jsonb, text)
  from public, anon, authenticated;
