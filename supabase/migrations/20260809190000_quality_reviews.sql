-- Quality review records.
--
-- Sampled second-look review of the operation's own decisions — mappings,
-- settlements, result verifications, social copy and moderation decisions. Each
-- review is a record with a verdict, feedback, and a retraining flag; a failed
-- review with the flag set IS the retraining record. Append-only, service-role
-- only, and the reviewer is a non-reversible fingerprint like every other
-- operator action.

create table if not exists public.op_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in (
    'mapping', 'settlement', 'result_verification', 'social_copy', 'moderation_decision'
  )),
  subject_ref text not null check (char_length(subject_ref) between 1 and 200),
  reviewer_fingerprint text not null check (char_length(reviewer_fingerprint) between 3 and 120),
  verdict text not null check (verdict in ('pass', 'fail', 'needs_follow_up')),
  feedback text check (feedback is null or char_length(feedback) <= 2000),
  retraining_flag boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists op_quality_reviews_subject_idx
  on public.op_quality_reviews (subject_type, created_at desc);

comment on table public.op_quality_reviews is
  'Append-only sampled quality reviews of operational decisions. A failed review with retraining_flag set is the retraining record. Service-role only.';

alter table public.op_quality_reviews enable row level security;
revoke all on public.op_quality_reviews from public, anon, authenticated;
grant select, insert on public.op_quality_reviews to service_role;
