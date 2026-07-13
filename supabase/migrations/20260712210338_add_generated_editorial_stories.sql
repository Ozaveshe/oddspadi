create table public.op_editorial_stories (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  generator text not null check (generator in ('weekend-preview', 'results-recap', 'value-picks-watch', 'model-vs-market')),
  title text not null check (char_length(title) between 10 and 140),
  excerpt text not null check (char_length(excerpt) between 20 and 320),
  category text not null,
  sport text not null,
  body jsonb not null check (jsonb_typeof(body) = 'array'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  revision integer not null default 1 check (revision > 0),
  source_as_of timestamptz not null,
  published_at timestamptz not null,
  updated_at timestamptz not null default now(),
  read_minutes integer not null default 3 check (read_minutes between 1 and 30),
  data_fingerprint text not null
);

comment on table public.op_editorial_stories is
  'Deterministic OddsPadi newsroom stories generated only from owned fixture, model, market, and public outcome data.';

create index op_editorial_stories_published_idx on public.op_editorial_stories (published_at desc);
alter table public.op_editorial_stories enable row level security;
revoke all on table public.op_editorial_stories from public, anon, authenticated;
grant select on table public.op_editorial_stories to anon, authenticated;
grant select, insert, update, delete on table public.op_editorial_stories to service_role;
create policy "Generated editorial stories are publicly readable"
  on public.op_editorial_stories for select to anon, authenticated using (true);
