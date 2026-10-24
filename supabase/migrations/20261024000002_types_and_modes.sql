-- Wizard PT — richer output-comparison modes, and custom-driver ("class design") problems.

-- New comparison modes: structural JSON, and "any order" answers.
alter table public.coding_configs drop constraint if exists coding_configs_compare_mode_check;
alter table public.coding_configs add constraint coding_configs_compare_mode_check
  check (compare_mode in ('exact', 'trim', 'tokens', 'float', 'json', 'unordered', 'unordered_deep'));

-- A function-mode problem may have no method signature when the admin supplies a full boilerplate driver
-- (class-design problems). Everything else about publishing is unchanged.
create or replace function public.publish_coding_question(p_question_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  q public.questions%rowtype;
  v public.question_versions%rowtype;
  c public.coding_configs%rowtype;
  s public.coding_secrets%rowtype;
  n_public int; n_hidden int; problems text[] := '{}'; was_published boolean;
begin
  perform public.assert_admin();
  select * into q from public.questions where id = p_question_id for update;
  if not found or q.type <> 'coding' then raise exception 'Coding question not found'; end if;
  select * into v from public.question_versions where id = q.current_version_id;
  if not found then raise exception 'Question has no version'; end if;
  if v.published_at is not null then raise exception 'This version is already published. Edit the question to create a new version.'; end if;

  select * into c from public.coding_configs where question_version_id = v.id;
  select * into s from public.coding_secrets where question_version_id = v.id;

  if btrim(v.title) = '' then problems := array_append(problems, 'Title is required'::text); end if;
  if btrim(v.statement_md) = '' then problems := array_append(problems, 'Problem statement is required'::text); end if;
  if c.question_version_id is null then
    problems := array_append(problems, 'Coding configuration is missing'::text);
  else
    if btrim(c.starter_code) = '' then problems := array_append(problems, 'Starter code is required'::text); end if;
    if c.execution_mode = 'function'
       and coalesce(btrim(c.function_signature), '') = ''
       and coalesce(btrim(s.boilerplate_source), '') = '' then
      problems := array_append(problems, 'Function signature is required in function mode'::text);
    end if;
    if c.execution_mode = 'function' and (s.question_version_id is null or btrim(s.template_suffix) = '') then
      problems := array_append(problems, 'Execution wrapper has not been generated — save the configuration first'::text);
    end if;
    if c.grading_mode = 'auto' then
      select count(*) filter (where visibility = 'public'), count(*) filter (where visibility = 'hidden')
        into n_public, n_hidden from public.test_cases where question_version_id = v.id;
      if n_public < 1 then problems := array_append(problems, 'Add at least one public test case'::text); end if;
      if n_hidden < 1 then problems := array_append(problems, 'Add at least one hidden test case'::text); end if;
    end if;
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Cannot publish: %', array_to_string(problems, '; ') using errcode = 'P0001';
  end if;

  was_published := q.published_version_id is not null;
  update public.question_versions set published_at = now() where id = v.id;
  update public.questions set status = 'published', published_version_id = v.id where id = q.id;

  insert into public.notifications (recipient_id, type, title, body, link, reference_id)
    select p.id,
           case when was_published then 'problem_updated' else 'problem_published' end,
           case when was_published then 'Problem updated: ' else 'New problem: ' end || v.title,
           upper(v.difficulty) || coalesce(' · ' || v.topic, ''),
           '/student/problems/' || q.id,
           q.id
    from public.profiles p where p.role = 'student';
  return v.id;
end $$;
