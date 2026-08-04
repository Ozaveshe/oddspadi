-- Extensions required by op_flag_duplicate_fixtures.
--
-- Applied to production on 2026-08-03 but never written down, which a release
-- audit caught: the duplicate-fixture matcher calls `extensions.unaccent` and
-- `extensions.similarity`, so a fresh environment would create the function
-- fine and fail the moment it ran.
--
-- Numbered before 20260803190000_flag_duplicate_fixtures.sql so a clean replay
-- has the extensions in place before the function that needs them.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
