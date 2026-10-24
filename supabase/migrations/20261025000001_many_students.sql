-- Wizard PT — one admin, many students.
-- Students are provisioned by the admin (public sign-up stays disabled). A student can be deactivated
-- without deleting their history: they are signed out of every data path (RLS) and cannot sign in.

alter table public.profiles add column active boolean not null default true;

-- Deactivated students lose all student access at the database level, not just in the UI.
create or replace function public.is_student() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'student' and active) $$;

-- Own-row reads still work (so the app can tell a deactivated user to sign out); `active` is never
-- writable by API roles — only the admin's server code (service role) changes it.
-- (profiles update is already restricted to the display_name column.)

-- All student read paths go through student_can_see_version (versions, options, configs, public tests) or the
-- assessment policies; gate both on an active student. Admins have their own policies and are unaffected.
create or replace function public.student_can_see_version(vid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_student() and (
    exists (
      select 1 from public.question_versions v
      join public.questions q on q.id = v.question_id
      where v.id = vid and v.published_at is not null
        and q.type = 'coding' and q.status = 'published' and q.published_version_id = v.id)
    or exists (
      select 1 from public.assessment_questions aq
      join public.assessments a on a.id = aq.assessment_id
      where aq.question_version_id = vid and a.status = 'published')
    or exists (
      select 1 from public.assessment_questions aq
      join public.assessment_attempts t on t.assessment_id = aq.assessment_id
      where aq.question_version_id = vid and t.student_id = auth.uid())
    or exists (select 1 from public.code_submissions s where s.question_version_id = vid and s.student_id = auth.uid())
    or exists (select 1 from public.code_drafts d where d.question_version_id = vid and d.student_id = auth.uid()))
$$;

drop policy assessments_student_read on public.assessments;
create policy assessments_student_read on public.assessments for select to authenticated
  using (public.is_student() and (status = 'published'
         or exists (select 1 from public.assessment_attempts t
                    where t.assessment_id = assessments.id and t.student_id = auth.uid())));

drop policy aq_student_read on public.assessment_questions;
create policy aq_student_read on public.assessment_questions for select to authenticated
  using (public.is_student() and exists (select 1 from public.assessments a
                 where a.id = assessment_id
                   and (a.status = 'published'
                        or exists (select 1 from public.assessment_attempts t
                                   where t.assessment_id = a.id and t.student_id = auth.uid()))));
