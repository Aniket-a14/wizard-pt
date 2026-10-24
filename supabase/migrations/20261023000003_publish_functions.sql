-- Wizard PT — atomic lifecycle operations (versioning, publish, unpublish).
-- These run as SECURITY DEFINER but verify the caller is an admin (or the service role) first.

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Admin only' using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------ new_draft_version
-- Returns the editable draft version for a question, cloning the latest published
-- version into a fresh draft when no draft exists yet.
create or replace function public.new_draft_version(p_question_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  q  public.questions%rowtype;
  v  public.question_versions%rowtype;
  nv uuid;
begin
  perform public.assert_admin();
  select * into q from public.questions where id = p_question_id for update;
  if not found then raise exception 'Question not found'; end if;
  select * into v from public.question_versions where id = q.current_version_id;
  if found and v.published_at is null then return v.id; end if;

  insert into public.question_versions (question_id, version, title, difficulty, topic, tags, company,
      statement_md, input_format, output_format, constraints_md, examples, code_snippet, image_path,
      marks, est_minutes, mcq_multi)
  select question_id, version + 1, title, difficulty, topic, tags, company,
      statement_md, input_format, output_format, constraints_md, examples, code_snippet, image_path,
      marks, est_minutes, mcq_multi
  from public.question_versions where id = v.id
  returning id into nv;

  insert into public.question_secrets (question_version_id, explanation_md)
    select nv, explanation_md from public.question_secrets where question_version_id = v.id;

  insert into public.coding_configs (question_version_id, language, execution_mode, grading_mode, function_signature,
      editable_scope, starter_code, time_limit_ms, memory_limit_mb, compare_mode, float_tolerance,
      allow_custom_input, reveal_hidden)
    select nv, language, execution_mode, grading_mode, function_signature, editable_scope, starter_code,
      time_limit_ms, memory_limit_mb, compare_mode, float_tolerance, allow_custom_input, reveal_hidden
    from public.coding_configs where question_version_id = v.id;

  insert into public.coding_secrets (question_version_id, template_prefix, template_suffix, boilerplate_source, reference_solution)
    select nv, template_prefix, template_suffix, boilerplate_source, reference_solution
    from public.coding_secrets where question_version_id = v.id;

  insert into public.test_cases (question_version_id, input, expected_output, visibility, weight, ordering, label)
    select nv, input, expected_output, visibility, weight, ordering, label
    from public.test_cases where question_version_id = v.id;

  insert into public.mcq_options (question_version_id, option_text, display_order)
    select nv, option_text, display_order from public.mcq_options where question_version_id = v.id;

  insert into public.mcq_correct_options (option_id, question_version_id)
    select n.id, nv
    from public.mcq_correct_options c
    join public.mcq_options o on o.id = c.option_id
    join public.mcq_options n on n.question_version_id = nv and n.display_order = o.display_order
    where c.question_version_id = v.id;

  update public.questions set current_version_id = nv where id = q.id;
  return nv;
end $$;

-- ------------------------------------------------------------ publish_coding_question
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
    if c.execution_mode = 'function' and coalesce(btrim(c.function_signature), '') = '' then
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

-- ------------------------------------------------------------ unpublish / archive question
create or replace function public.unpublish_question(p_question_id uuid, p_archive boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.questions
     set status = case when p_archive then 'archived' else 'draft' end,
         published_version_id = null
   where id = p_question_id;
end $$;

-- ------------------------------------------------------------ publish_assessment
create or replace function public.publish_assessment(p_assessment_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.assessments%rowtype;
  r record; n_opts int; n_correct int; problems text[] := '{}'; n_q int;
begin
  perform public.assert_admin();
  select * into a from public.assessments where id = p_assessment_id for update;
  if not found then raise exception 'Assessment not found'; end if;
  if a.status <> 'draft' then raise exception 'Assessment is not a draft'; end if;

  select count(*) into n_q from public.assessment_questions where assessment_id = a.id;
  if n_q = 0 then problems := array_append(problems, 'Add at least one question'::text); end if;

  for r in
    select aq.question_version_id as vid, v.title, v.mcq_multi, q.type, q.id as qid
    from public.assessment_questions aq
    join public.question_versions v on v.id = aq.question_version_id
    join public.questions q on q.id = v.question_id
    where aq.assessment_id = a.id
  loop
    if r.type <> 'mcq' then
      problems := array_append(problems, ('"' || r.title || '" is not an MCQ')::text);
      continue;
    end if;
    select count(*) into n_opts from public.mcq_options where question_version_id = r.vid;
    select count(*) into n_correct from public.mcq_correct_options where question_version_id = r.vid;
    if n_opts < 2 then problems := array_append(problems, ('"' || r.title || '" needs at least two options')::text); end if;
    if n_correct < 1 then problems := array_append(problems, ('"' || r.title || '" has no correct answer set')::text); end if;
    if not r.mcq_multi and n_correct > 1 then problems := array_append(problems, ('"' || r.title || '" is single-answer but has several correct options')::text); end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception 'Cannot publish: %', array_to_string(problems, '; ') using errcode = 'P0001';
  end if;

  -- Freeze every referenced version so later edits create new versions instead.
  update public.question_versions set published_at = now()
   where published_at is null
     and id in (select question_version_id from public.assessment_questions where assessment_id = a.id);
  update public.questions q set status = 'published',
         published_version_id = (select aq.question_version_id from public.assessment_questions aq
                                  join public.question_versions v on v.id = aq.question_version_id
                                  where aq.assessment_id = a.id and v.question_id = q.id limit 1)
   where q.id in (select v.question_id from public.assessment_questions aq
                  join public.question_versions v on v.id = aq.question_version_id
                  where aq.assessment_id = a.id);

  update public.assessments set status = 'published', published_at = now() where id = a.id;

  insert into public.notifications (recipient_id, type, title, body, link, reference_id)
    select p.id, 'quiz_published', 'New quiz: ' || a.title,
           n_q || ' question' || case when n_q = 1 then '' else 's' end,
           '/student/quizzes/' || a.id, a.id
    from public.profiles p where p.role = 'student';
end $$;

-- ------------------------------------------------------------ unpublish_assessment
create or replace function public.unpublish_assessment(p_assessment_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_admin();
  if exists (select 1 from public.assessment_attempts where assessment_id = p_assessment_id) then
    raise exception 'This quiz already has attempts. Archive it instead of unpublishing.' using errcode = 'P0001';
  end if;
  update public.assessments set status = 'draft', published_at = null where id = p_assessment_id;
end $$;

revoke execute on function
  public.assert_admin(), public.new_draft_version(uuid), public.publish_coding_question(uuid),
  public.unpublish_question(uuid, boolean), public.publish_assessment(uuid), public.unpublish_assessment(uuid)
from public, anon;
grant execute on function
  public.assert_admin(), public.new_draft_version(uuid), public.publish_coding_question(uuid),
  public.unpublish_question(uuid, boolean), public.publish_assessment(uuid), public.unpublish_assessment(uuid)
to authenticated, service_role;
