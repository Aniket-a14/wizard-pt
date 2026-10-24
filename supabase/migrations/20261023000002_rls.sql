-- Wizard PT — row level security, immutability triggers, storage, realtime.
-- Principle: deny by default. Students get read access only to published, non-secret content
-- and to their own drafts / submissions / notifications. Everything involving answer keys,
-- hidden tests, or release-gated results is admin-only here and served to students by
-- server code that applies the release rules.

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.is_student() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'student') $$;

-- True when the calling student is allowed to read this (non-secret) version content.
create or replace function public.student_can_see_version(vid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select
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
    or exists (select 1 from public.code_drafts d where d.question_version_id = vid and d.student_id = auth.uid())
$$;

revoke execute on function public.is_admin(), public.is_student(), public.student_can_see_version(uuid) from public, anon;
grant execute on function public.is_admin(), public.is_student(), public.student_can_see_version(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table public.profiles               enable row level security;
alter table public.imports                enable row level security;
alter table public.questions              enable row level security;
alter table public.question_versions      enable row level security;
alter table public.question_secrets       enable row level security;
alter table public.mcq_options            enable row level security;
alter table public.mcq_correct_options    enable row level security;
alter table public.coding_configs         enable row level security;
alter table public.coding_secrets         enable row level security;
alter table public.test_cases             enable row level security;
alter table public.assessments            enable row level security;
alter table public.assessment_questions   enable row level security;
alter table public.assessment_attempts    enable row level security;
alter table public.attempt_answers        enable row level security;
alter table public.attempt_grades         enable row level security;
alter table public.code_drafts            enable row level security;
alter table public.code_runs              enable row level security;
alter table public.code_submissions       enable row level security;
alter table public.code_submission_private enable row level security;
alter table public.reviews                enable row level security;
alter table public.notifications          enable row level security;

-- ---------------------------------------------------------------- profiles
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- A user may only ever change their own display name, never the role.
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon;

-- ---------------------------------------------------------------- admin-only tables
create policy admin_all on public.imports              for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.question_secrets     for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.mcq_correct_options  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.coding_secrets       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.assessment_attempts  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.attempt_answers      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.attempt_grades       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.code_submission_private for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- content (versioned)
create policy questions_admin on public.questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy questions_student_read on public.questions for select to authenticated
  using (exists (select 1 from public.question_versions v
                 where v.question_id = questions.id and public.student_can_see_version(v.id)));

create policy versions_admin on public.question_versions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy versions_student_read on public.question_versions for select to authenticated
  using (published_at is not null and public.student_can_see_version(id));

create policy mcq_options_admin on public.mcq_options for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy mcq_options_student_read on public.mcq_options for select to authenticated
  using (public.student_can_see_version(question_version_id));

create policy coding_configs_admin on public.coding_configs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy coding_configs_student_read on public.coding_configs for select to authenticated
  using (public.student_can_see_version(question_version_id));

create policy test_cases_admin on public.test_cases for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Hidden tests have NO student policy: the row simply does not exist for them.
create policy test_cases_student_public on public.test_cases for select to authenticated
  using (visibility = 'public' and public.student_can_see_version(question_version_id));

-- ---------------------------------------------------------------- assessments
create policy assessments_admin on public.assessments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy assessments_student_read on public.assessments for select to authenticated
  using (status = 'published'
         or exists (select 1 from public.assessment_attempts t
                    where t.assessment_id = assessments.id and t.student_id = auth.uid()));

create policy aq_admin on public.assessment_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy aq_student_read on public.assessment_questions for select to authenticated
  using (exists (select 1 from public.assessments a
                 where a.id = assessment_id
                   and (a.status = 'published'
                        or exists (select 1 from public.assessment_attempts t
                                   where t.assessment_id = a.id and t.student_id = auth.uid()))));

-- ---------------------------------------------------------------- student work
create policy drafts_own on public.code_drafts for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid() and public.is_student());
create policy drafts_admin_read on public.code_drafts for select to authenticated using (public.is_admin());

create policy runs_read on public.code_runs for select to authenticated
  using (student_id = auth.uid() or public.is_admin());

-- Submissions: students read their own. All writes happen server-side with the service role.
create policy submissions_read on public.code_submissions for select to authenticated
  using (student_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- reviews
create policy reviews_admin on public.reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy reviews_student_read on public.reviews for select to authenticated
  using (published_at is not null and (
           exists (select 1 from public.code_submissions s where s.id = code_submission_id and s.student_id = auth.uid())
        or exists (select 1 from public.assessment_attempts t where t.id = attempt_id and t.student_id = auth.uid())));

-- ---------------------------------------------------------------- notifications
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------- lock down anon completely
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------- immutability triggers
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger touch_questions before update on public.questions for each row execute function public.touch_updated_at();
create trigger touch_versions  before update on public.question_versions for each row execute function public.touch_updated_at();
create trigger touch_assessments before update on public.assessments for each row execute function public.touch_updated_at();
create trigger touch_reviews   before update on public.reviews for each row execute function public.touch_updated_at();

-- A published version can never change. (Setting published_at on a draft is the one allowed update.)
create or replace function public.guard_version_update() returns trigger language plpgsql as $$
begin
  if old.published_at is not null then
    raise exception 'Published question versions are immutable. Create a new version to change them.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_version_update before update on public.question_versions
  for each row execute function public.guard_version_update();

-- Children of a published version are frozen too (cascading deletes from a parent are fine).
create or replace function public.guard_version_child() returns trigger language plpgsql as $$
declare vid uuid; pub timestamptz;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    vid := old.question_version_id;
  else
    vid := new.question_version_id;
  end if;
  select published_at into pub from public.question_versions where id = vid;
  if pub is not null then
    raise exception 'This question version is published and immutable. Create a new version to change it.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_child before insert or update or delete on public.mcq_options          for each row execute function public.guard_version_child();
create trigger guard_child before insert or update or delete on public.mcq_correct_options  for each row execute function public.guard_version_child();
create trigger guard_child before insert or update or delete on public.coding_configs       for each row execute function public.guard_version_child();
create trigger guard_child before insert or update or delete on public.test_cases           for each row execute function public.guard_version_child();
create trigger guard_child before insert or update or delete on public.question_secrets     for each row execute function public.guard_version_child();

-- coding_secrets: wrapper + reference are frozen once published; last_validation may still be refreshed.
create or replace function public.guard_coding_secrets() returns trigger language plpgsql as $$
declare pub timestamptz;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    select published_at into pub from public.question_versions where id = old.question_version_id;
    if pub is not null then raise exception 'Published version is immutable.' using errcode = 'P0001'; end if;
    return old;
  end if;
  select published_at into pub from public.question_versions where id = new.question_version_id;
  if pub is not null then
    if tg_op = 'INSERT' or new.template_prefix is distinct from old.template_prefix
       or new.template_suffix is distinct from old.template_suffix then
      raise exception 'Published version is immutable.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger guard_secrets before insert or update or delete on public.coding_secrets
  for each row execute function public.guard_coding_secrets();

-- Assessment structure is frozen once published.
create or replace function public.guard_assessment_questions() returns trigger language plpgsql as $$
declare st text; aid uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  aid := coalesce(new.assessment_id, old.assessment_id);
  select status into st from public.assessments where id = aid;
  if st is not null and st <> 'draft' then
    raise exception 'A published assessment cannot change its questions.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_aq before insert or update or delete on public.assessment_questions
  for each row execute function public.guard_assessment_questions();

create or replace function public.guard_assessment_update() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and new.settings is distinct from old.settings then
    raise exception 'Settings of a published assessment cannot change.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_assessment before update on public.assessments
  for each row execute function public.guard_assessment_update();

-- Submitted code is an immutable snapshot.
create or replace function public.guard_submission_snapshot() returns trigger language plpgsql as $$
begin
  if new.source_code is distinct from old.source_code
     or new.student_id is distinct from old.student_id
     or new.question_version_id is distinct from old.question_version_id
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'Submissions are immutable snapshots.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_submission before update on public.code_submissions
  for each row execute function public.guard_submission_snapshot();

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-assets', 'question-assets', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy imports_admin on storage.objects for all to authenticated
  using (bucket_id = 'imports' and public.is_admin())
  with check (bucket_id = 'imports' and public.is_admin());
create policy assets_read on storage.objects for select to authenticated
  using (bucket_id = 'question-assets');
create policy assets_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'question-assets' and public.is_admin());
create policy assets_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'question-assets' and public.is_admin());
create policy assets_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'question-assets' and public.is_admin());

-- ---------------------------------------------------------------- realtime
-- Only notifications are broadcast; payloads are filtered by RLS (recipient-only).
alter publication supabase_realtime add table public.notifications;
alter table public.notifications replica identity full;
