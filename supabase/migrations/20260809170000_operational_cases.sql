-- Operational cases: the human-work layer above the alert queues.
--
-- op_settlement_exceptions and op_content_reports are machine-written alert
-- queues. They carry a state and a severity but no assignee and no timeline —
-- so nobody owns a problem, and "who looked at this and when" is unrecorded.
-- A case wraps an alert (or is opened by hand), and adds ownership, an SLA
-- clock and an append-only timeline. It NEVER rewrites the alert it wraps, and
-- never an immutable record: resolving the underlying alert stays the existing
-- operator-action path. The case records that a human did the work.

create table if not exists public.op_operational_cases (
  id uuid primary key default gen_random_uuid(),

  workspace text not null check (workspace in ('market_ops', 'community')),
  source text not null check (source in (
    'reconciler_exception', 'settlement_exception', 'content_report', 'manual'
  )),

  -- The alert this case wraps, if any. on delete set null so deleting a fixture
  -- (which cascades its exceptions) orphans the case for review rather than
  -- silently deleting the record that a human worked it.
  exception_id uuid references public.op_settlement_exceptions (id) on delete set null,
  report_id uuid references public.op_content_reports (id) on delete set null,

  kind text not null check (char_length(kind) between 1 and 120),
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null check (char_length(title) between 1 and 200),

  state text not null default 'open' check (state in (
    'open', 'acknowledged', 'in_progress', 'waiting', 'resolved', 'dismissed', 'escalated'
  )),
  assignee_fingerprint text check (assignee_fingerprint is null or char_length(assignee_fingerprint) between 3 and 120),

  due_at timestamptz,
  opened_at timestamptz not null default now(),
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  resolved_by text check (resolved_by is null or char_length(resolved_by) between 3 and 120),

  detail jsonb not null default '{}'::jsonb,

  -- A case is resolved/dismissed exactly when it has a resolved_at, same shape
  -- as the exception queue's coherence constraint.
  constraint op_operational_cases_resolution_coherent
    check ((state in ('resolved', 'dismissed')) = (resolved_at is not null))
);

-- One open case per open alert. An 'escalated' case is still active, so it too
-- blocks a duplicate — only a resolved/dismissed case frees the slot, and a
-- recurrence then opens a fresh case rather than reviving a closed decision.
create unique index if not exists op_operational_cases_open_exception_idx
  on public.op_operational_cases (exception_id)
  where exception_id is not null and state not in ('resolved', 'dismissed');

create unique index if not exists op_operational_cases_open_report_idx
  on public.op_operational_cases (report_id)
  where report_id is not null and state not in ('resolved', 'dismissed');

create index if not exists op_operational_cases_board_idx
  on public.op_operational_cases (workspace, state, severity, due_at);

comment on table public.op_operational_cases is
  'Human-work layer above op_settlement_exceptions / op_content_reports: ownership, SLA and timeline. Never rewrites the wrapped alert or any immutable record.';

-- Append-only case timeline. Every ownership change, note, transition,
-- escalation and quality review is one row; the case row shows current state,
-- the timeline shows how it got there.
create table if not exists public.op_operational_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.op_operational_cases (id) on delete cascade,
  actor_fingerprint text not null check (char_length(actor_fingerprint) between 3 and 120),
  event_type text not null check (event_type in (
    'opened', 'note', 'assign', 'unassign', 'state_change', 'escalate', 'quality_review', 'link'
  )),
  from_state text check (from_state is null or char_length(from_state) <= 40),
  to_state text check (to_state is null or char_length(to_state) <= 40),
  body text check (body is null or char_length(body) <= 2000),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists op_operational_case_events_case_idx
  on public.op_operational_case_events (case_id, created_at);

comment on table public.op_operational_case_events is
  'Append-only timeline for operational cases. One row per ownership change, note, transition, escalation or quality review.';

-- Open or refresh a case for a given alert, idempotently. The scheduled sync
-- runs on a cron; a second run for the same still-open alert must return the
-- existing case, not a duplicate. Refreshes severity/title/detail on the open
-- case but never touches opened_at — the age of a case is most of its meaning,
-- exactly as with op_record_settlement_exception. A resolved case recurring
-- opens a NEW case rather than reviving an operator's closed decision.
create or replace function public.op_upsert_operational_case(
  p_workspace text,
  p_source text,
  p_kind text,
  p_severity text,
  p_title text,
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
    set severity = p_severity, title = p_title, detail = p_detail
    where exception_id = p_exception_id and state not in ('resolved', 'dismissed')
    returning * into v_row;
    if found then
      return v_row;
    end if;
  elsif p_report_id is not null then
    update public.op_operational_cases
    set severity = p_severity, title = p_title, detail = p_detail
    where report_id = p_report_id and state not in ('resolved', 'dismissed')
    returning * into v_row;
    if found then
      return v_row;
    end if;
  end if;

  insert into public.op_operational_cases (
    workspace, source, exception_id, report_id, kind, severity, title, due_at, detail, state
  ) values (
    p_workspace, p_source, p_exception_id, p_report_id, p_kind, p_severity, p_title, p_due_at, p_detail, 'open'
  )
  returning * into v_row;

  insert into public.op_operational_case_events (case_id, actor_fingerprint, event_type, to_state, detail)
  values (v_row.id, p_actor_fingerprint, 'opened', 'open', p_detail);

  return v_row;
end;
$$;

comment on function public.op_upsert_operational_case is
  'Idempotently open (or refresh) a case for an exception/report. Returns the open case if one exists; else inserts it and writes the opened timeline event. Never resets opened_at.';

-- Cases and their timeline are read and written only through server routes on
-- the service-role client, after a staff-auth check — the same posture as the
-- moderation queue. No authenticated/anon grants.
alter table public.op_operational_cases enable row level security;
revoke all on public.op_operational_cases from public, anon, authenticated;
grant select, insert, update on public.op_operational_cases to service_role;

alter table public.op_operational_case_events enable row level security;
revoke all on public.op_operational_case_events from public, anon, authenticated;
grant select, insert on public.op_operational_case_events to service_role;

revoke all on function public.op_upsert_operational_case(text, text, text, text, text, uuid, uuid, timestamptz, jsonb, text)
  from public, anon, authenticated;
