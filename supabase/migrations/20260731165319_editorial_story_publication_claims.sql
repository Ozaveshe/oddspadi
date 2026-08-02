-- Stories that assert a win/loss record must carry the ledger rows they
-- counted, so the assertion can be re-checked at render time instead of being
-- trusted forever. Without this, a corrected or retracted pick leaves the
-- article repeating its original number with nothing to notice the drift.
alter table public.op_editorial_stories
  add column if not exists claim jsonb;

comment on column public.op_editorial_stories.claim is
  'Publication ids and the stated wins/losses/graded counts behind a record claim. Re-resolved against op_publications at render time; drift produces a correction notice.';
