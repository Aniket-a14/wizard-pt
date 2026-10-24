-- Wizard PT — multiple languages (Java stays the base language; C++ and C are optional per problem).
--
-- Per-language data lives in two jsonb columns so no new table or policy is needed:
--   coding_configs.variants  (student-visible)  { "cpp": { "function_signature": "...", "starter_code": "..." }, "c": { ... } }
--   coding_secrets.variants  (admin only)       { "cpp": { "template_prefix", "template_suffix", "boilerplate_source", "reference_solution" } }
-- The student-readable column never carries wrapper code or reference solutions.

alter table public.coding_configs add column variants jsonb not null default '{}'::jsonb
  check (jsonb_typeof(variants) = 'object' and pg_column_size(variants) < 200000);
alter table public.coding_secrets add column variants jsonb not null default '{}'::jsonb
  check (jsonb_typeof(variants) = 'object' and pg_column_size(variants) < 600000);

-- A student keeps one draft per problem AND language.
alter table public.code_drafts add column language text not null default 'java'
  check (language in ('java', 'cpp', 'c'));
alter table public.code_drafts drop constraint code_drafts_pkey;
alter table public.code_drafts add primary key (student_id, question_version_id, language);

alter table public.code_submissions add constraint code_submissions_language_check
  check (language in ('java', 'cpp', 'c'));

-- Saving a draft and cloning a version now carry the per-language data.
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
      editable_scope, starter_code, time_limit_ms, memory_limit_mb, compare_mode, float_tolerance, allow_custom_input, reveal_hidden, variants)
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
      coalesce((cfg ->> 'reveal_hidden')::boolean, false),
      coalesce(cfg -> 'variants', '{}'::jsonb))
  on conflict (question_version_id) do update set
      execution_mode = excluded.execution_mode, grading_mode = excluded.grading_mode,
      function_signature = excluded.function_signature, editable_scope = excluded.editable_scope,
      starter_code = excluded.starter_code, time_limit_ms = excluded.time_limit_ms,
      memory_limit_mb = excluded.memory_limit_mb, compare_mode = excluded.compare_mode,
      float_tolerance = excluded.float_tolerance, allow_custom_input = excluded.allow_custom_input,
      reveal_hidden = excluded.reveal_hidden, variants = excluded.variants;

  insert into public.coding_secrets (question_version_id, template_prefix, template_suffix, boilerplate_source, reference_solution, last_validation, variants)
  values (vid, coalesce(sec ->> 'template_prefix', ''), coalesce(sec ->> 'template_suffix', ''),
          nullif(sec ->> 'boilerplate_source', ''), nullif(sec ->> 'reference_solution', ''), null,
          coalesce(sec -> 'variants', '{}'::jsonb))
  on conflict (question_version_id) do update set
      template_prefix = excluded.template_prefix, template_suffix = excluded.template_suffix,
      boilerplate_source = excluded.boilerplate_source, reference_solution = excluded.reference_solution,
      variants = excluded.variants, last_validation = null;

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
      allow_custom_input, reveal_hidden, variants)
    select nv, language, execution_mode, grading_mode, function_signature, editable_scope, starter_code,
      time_limit_ms, memory_limit_mb, compare_mode, float_tolerance, allow_custom_input, reveal_hidden, variants
    from public.coding_configs where question_version_id = v.id;

  insert into public.coding_secrets (question_version_id, template_prefix, template_suffix, boilerplate_source, reference_solution, variants)
    select nv, template_prefix, template_suffix, boilerplate_source, reference_solution, variants
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
