-- Wizard PT — atomic "save draft" operations. Each call either fully succeeds or leaves nothing behind.

-- ------------------------------------------------------------ save_coding_draft
create or replace function public.save_coding_draft(p_payload jsonb, p_question_id uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  qid uuid := p_question_id;
  vid uuid;
  cfg jsonb := coalesce(p_payload -> 'config', '{}'::jsonb);
  sec jsonb := coalesce(p_payload -> 'secrets', '{}'::jsonb);
  t jsonb;
  i int := 0;
begin
  perform public.assert_admin();

  if qid is null then
    insert into public.questions (type, created_by, import_id, is_seed)
      values ('coding', auth.uid(), nullif(p_payload ->> 'import_id', '')::uuid, coalesce((p_payload ->> 'is_seed')::boolean, false))
      returning id into qid;
    insert into public.question_versions (question_id, version, title) values (qid, 1, 'draft') returning id into vid;
    update public.questions set current_version_id = vid where id = qid;
  else
    if not exists (select 1 from public.questions where id = qid and type = 'coding') then
      raise exception 'Coding question not found';
    end if;
    vid := public.new_draft_version(qid);
  end if;

  update public.question_versions set
    title          = coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Untitled problem'),
    difficulty     = coalesce(nullif(p_payload ->> 'difficulty', ''), 'easy'),
    topic          = nullif(btrim(coalesce(p_payload ->> 'topic', '')), ''),
    tags           = coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'tags', '[]'::jsonb))), '{}'),
    company        = nullif(btrim(coalesce(p_payload ->> 'company', '')), ''),
    statement_md   = coalesce(p_payload ->> 'statement_md', ''),
    input_format   = nullif(p_payload ->> 'input_format', ''),
    output_format  = nullif(p_payload ->> 'output_format', ''),
    constraints_md = nullif(p_payload ->> 'constraints_md', ''),
    examples       = coalesce(p_payload -> 'examples', '[]'::jsonb),
    marks          = coalesce((p_payload ->> 'marks')::numeric, 10),
    est_minutes    = nullif(p_payload ->> 'est_minutes', '')::int,
    review_flags   = coalesce(p_payload -> 'review_flags', '[]'::jsonb)
  where id = vid;

  insert into public.question_secrets (question_version_id, explanation_md)
    values (vid, nullif(p_payload ->> 'explanation_md', ''))
  on conflict (question_version_id) do update set explanation_md = excluded.explanation_md;

  insert into public.coding_configs (question_version_id, language, execution_mode, grading_mode, function_signature,
      editable_scope, starter_code, time_limit_ms, memory_limit_mb, compare_mode, float_tolerance, allow_custom_input, reveal_hidden)
  values (vid, 'java',
      coalesce(cfg ->> 'execution_mode', 'function'),
      coalesce(cfg ->> 'grading_mode', 'auto'),
      nullif(cfg ->> 'function_signature', ''),
      coalesce(cfg ->> 'editable_scope', 'method'),
      coalesce(cfg ->> 'starter_code', ''),
      coalesce((cfg ->> 'time_limit_ms')::int, 2000),
      coalesce((cfg ->> 'memory_limit_mb')::int, 256),
      coalesce(cfg ->> 'compare_mode', 'exact'),
      coalesce((cfg ->> 'float_tolerance')::float8, 1e-6),
      coalesce((cfg ->> 'allow_custom_input')::boolean, true),
      coalesce((cfg ->> 'reveal_hidden')::boolean, false))
  on conflict (question_version_id) do update set
      execution_mode = excluded.execution_mode, grading_mode = excluded.grading_mode,
      function_signature = excluded.function_signature, editable_scope = excluded.editable_scope,
      starter_code = excluded.starter_code, time_limit_ms = excluded.time_limit_ms,
      memory_limit_mb = excluded.memory_limit_mb, compare_mode = excluded.compare_mode,
      float_tolerance = excluded.float_tolerance, allow_custom_input = excluded.allow_custom_input,
      reveal_hidden = excluded.reveal_hidden;

  insert into public.coding_secrets (question_version_id, template_prefix, template_suffix, boilerplate_source, reference_solution, last_validation)
  values (vid, coalesce(sec ->> 'template_prefix', ''), coalesce(sec ->> 'template_suffix', ''),
          nullif(sec ->> 'boilerplate_source', ''), nullif(sec ->> 'reference_solution', ''), null)
  on conflict (question_version_id) do update set
      template_prefix = excluded.template_prefix, template_suffix = excluded.template_suffix,
      boilerplate_source = excluded.boilerplate_source, reference_solution = excluded.reference_solution,
      last_validation = null;

  delete from public.test_cases where question_version_id = vid;
  for t in select * from jsonb_array_elements(coalesce(p_payload -> 'tests', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.test_cases (question_version_id, input, expected_output, visibility, weight, ordering, label)
    values (vid, coalesce(t ->> 'input', ''), coalesce(t ->> 'expected_output', ''),
            coalesce(t ->> 'visibility', 'hidden'), coalesce((t ->> 'weight')::numeric, 1), i, nullif(t ->> 'label', ''));
  end loop;

  update public.questions set updated_at = now() where id = qid;
  return jsonb_build_object('question_id', qid, 'version_id', vid);
end $$;

-- ------------------------------------------------------------ save_mcq_draft
create or replace function public.save_mcq_draft(p_payload jsonb, p_question_id uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  qid uuid := p_question_id;
  vid uuid;
  o jsonb;
  oid uuid;
  i int := 0;
begin
  perform public.assert_admin();

  if qid is null then
    insert into public.questions (type, created_by, import_id, is_seed)
      values ('mcq', auth.uid(), nullif(p_payload ->> 'import_id', '')::uuid, coalesce((p_payload ->> 'is_seed')::boolean, false))
      returning id into qid;
    insert into public.question_versions (question_id, version, title) values (qid, 1, 'draft') returning id into vid;
    update public.questions set current_version_id = vid where id = qid;
  else
    if not exists (select 1 from public.questions where id = qid and type = 'mcq') then
      raise exception 'MCQ not found';
    end if;
    vid := public.new_draft_version(qid);
  end if;

  update public.question_versions set
    title        = coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Untitled question'),
    difficulty   = coalesce(nullif(p_payload ->> 'difficulty', ''), 'easy'),
    topic        = nullif(btrim(coalesce(p_payload ->> 'topic', '')), ''),
    tags         = coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'tags', '[]'::jsonb))), '{}'),
    company      = nullif(btrim(coalesce(p_payload ->> 'company', '')), ''),
    statement_md = coalesce(p_payload ->> 'statement_md', ''),
    code_snippet = nullif(p_payload ->> 'code_snippet', ''),
    image_path   = nullif(p_payload ->> 'image_path', ''),
    marks        = coalesce((p_payload ->> 'marks')::numeric, 1),
    mcq_multi    = coalesce((p_payload ->> 'mcq_multi')::boolean, false),
    review_flags = coalesce(p_payload -> 'review_flags', '[]'::jsonb)
  where id = vid;

  insert into public.question_secrets (question_version_id, explanation_md)
    values (vid, nullif(p_payload ->> 'explanation_md', ''))
  on conflict (question_version_id) do update set explanation_md = excluded.explanation_md;

  delete from public.mcq_options where question_version_id = vid;  -- cascades to the answer key
  for o in select * from jsonb_array_elements(coalesce(p_payload -> 'options', '[]'::jsonb)) loop
    i := i + 1;
    insert into public.mcq_options (question_version_id, option_text, display_order)
      values (vid, coalesce(o ->> 'text', ''), i) returning id into oid;
    if coalesce((o ->> 'correct')::boolean, false) then
      insert into public.mcq_correct_options (option_id, question_version_id) values (oid, vid);
    end if;
  end loop;

  update public.questions set updated_at = now() where id = qid;
  return jsonb_build_object('question_id', qid, 'version_id', vid);
end $$;

-- ------------------------------------------------------------ save_quiz_draft
create or replace function public.save_quiz_draft(p_payload jsonb, p_assessment_id uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  aid uuid := p_assessment_id;
  item jsonb;
  i int := 0;
  vid uuid;
begin
  perform public.assert_admin();
  if aid is null then
    insert into public.assessments (title, description, settings, created_by, is_seed)
      values (coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Untitled quiz'), nullif(p_payload ->> 'description', ''),
              coalesce(p_payload -> 'settings', '{}'::jsonb), auth.uid(), coalesce((p_payload ->> 'is_seed')::boolean, false))
      returning id into aid;
  else
    if (select status from public.assessments where id = aid) <> 'draft' then
      raise exception 'Only draft quizzes can be edited. Unpublish it first (possible only before any attempts).' using errcode = 'P0001';
    end if;
    update public.assessments set
      title = coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Untitled quiz'),
      description = nullif(p_payload ->> 'description', ''),
      settings = coalesce(p_payload -> 'settings', '{}'::jsonb)
    where id = aid;
  end if;

  delete from public.assessment_questions where assessment_id = aid;
  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'questions', '[]'::jsonb)) loop
    i := i + 1;
    -- A quiz always references the question's current version (draft versions are frozen at publish).
    select current_version_id into vid from public.questions where id = (item ->> 'question_id')::uuid and type = 'mcq';
    if vid is null then raise exception 'Question % is not an MCQ', item ->> 'question_id'; end if;
    insert into public.assessment_questions (assessment_id, question_version_id, ordering, marks)
      values (aid, vid, i, coalesce((item ->> 'marks')::numeric, 1));
  end loop;
  return aid;
end $$;

revoke execute on function public.save_coding_draft(jsonb, uuid), public.save_mcq_draft(jsonb, uuid), public.save_quiz_draft(jsonb, uuid) from public, anon;
grant execute on function public.save_coding_draft(jsonb, uuid), public.save_mcq_draft(jsonb, uuid), public.save_quiz_draft(jsonb, uuid) to authenticated, service_role;
