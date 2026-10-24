-- Wizard PT — defence in depth. RLS stays the primary control; this removes privileges nothing needs,
-- so a future policy mistake cannot widen access, and closes the issues reported by the Supabase advisor.

-- ---------------------------------------------------------------- table privileges
-- TRUNCATE bypasses RLS entirely; REFERENCES/TRIGGER are never needed by API roles.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
-- The app never reads or writes tables as an anonymous visitor.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Grading data is written only by the server (service role) or by SECURITY DEFINER functions.
-- Students have no write policy on these anyway; with no privilege either, a policy slip cannot open them.
revoke insert, update, delete on public.assessment_attempts, public.attempt_answers, public.attempt_grades,
  public.code_submission_private, public.code_submissions, public.code_runs from authenticated;

-- New tables/functions must be granted deliberately, never by default.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------- functions
-- Trigger functions: pin search_path (advisor 0011) and take them off the API (they only fire as triggers).
alter function public.guard_version_update() set search_path = public, pg_temp;
alter function public.guard_version_child() set search_path = public, pg_temp;
alter function public.guard_coding_secrets() set search_path = public, pg_temp;
alter function public.guard_assessment_questions() set search_path = public, pg_temp;
alter function public.guard_assessment_update() set search_path = public, pg_temp;
alter function public.guard_submission_snapshot() set search_path = public, pg_temp;
alter function public.touch_updated_at() set search_path = public, pg_temp;
revoke execute on function
  public.guard_version_update(), public.guard_version_child(), public.guard_coding_secrets(),
  public.guard_assessment_questions(), public.guard_assessment_update(), public.guard_submission_snapshot(),
  public.touch_updated_at()
from public, anon, authenticated;

-- assert_admin() is only called from inside the admin functions (which run as their owner).
revoke execute on function public.assert_admin() from public, anon, authenticated;
grant execute on function public.assert_admin() to service_role;

-- ---------------------------------------------------------------- integrity / abuse limits
alter table public.code_submissions add constraint code_submissions_source_len check (char_length(source_code) <= 70000);
alter table public.code_drafts add constraint code_drafts_source_len check (char_length(source_code) <= 70000);

-- A student can keep drafts only for problems she is actually allowed to see.
drop policy if exists drafts_own on public.code_drafts;
create policy drafts_own on public.code_drafts for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.is_student() and public.student_can_see_version(question_version_id));
