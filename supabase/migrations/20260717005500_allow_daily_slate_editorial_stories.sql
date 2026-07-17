alter table public.op_editorial_stories
  drop constraint if exists op_editorial_stories_generator_check;

alter table public.op_editorial_stories
  add constraint op_editorial_stories_generator_check
  check (generator in (
    'daily-slate',
    'weekend-preview',
    'results-recap',
    'value-picks-watch',
    'model-vs-market'
  ));

comment on constraint op_editorial_stories_generator_check on public.op_editorial_stories is
  'Allows every deterministic editorial generator emitted by the OddsPadi newsroom worker.';
