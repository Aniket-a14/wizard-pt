-- Atomic quiz writes, execution admission, retry-safe imports and private feedback drafts.
-- Service-only RPCs take explicit authenticated student ids; public clients cannot call them.

create function public.save_quiz_answer(p_attempt_id uuid, p_student_id uuid, p_version_id uuid,
  p_selected uuid[], p_marked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.assessment_attempts%rowtype; multi boolean; selected uuid[];
begin
  select * into a from public.assessment_attempts where id = p_attempt_id and student_id = p_student_id for update;
  if not found then raise exception 'Attempt not found.'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student' and active) then
    raise exception 'Student account is inactive.'; end if;
  if a.status <> 'in_progress' then raise exception 'This attempt has already been submitted.'; end if;
  if a.deadline_at is not null and clock_timestamp() > a.deadline_at + interval '8 seconds' then raise exception 'Time is up.'; end if;
  if not (p_version_id = any(a.question_order)) then raise exception 'That question is not part of this attempt.'; end if;
  select mcq_multi into strict multi from public.question_versions where id = p_version_id;
  select coalesce(array_agg(distinct x order by x), '{}') into selected from unnest(p_selected) x;
  if exists (select 1 from unnest(selected) x where not exists (
    select 1 from public.mcq_options where id = x and question_version_id = p_version_id)) then
    raise exception 'Invalid option selected.'; end if;
  if not multi and cardinality(selected) > 1 then raise exception 'Only one option can be selected.'; end if;
  insert into public.attempt_answers (attempt_id, question_version_id, selected_option_ids, marked_for_review)
    values (p_attempt_id, p_version_id, selected, p_marked)
  on conflict (attempt_id, question_version_id) do update set
    selected_option_ids = excluded.selected_option_ids, marked_for_review = excluded.marked_for_review, updated_at = now();
end $$;

-- Grade computation remains shared TypeScript. Commit only if its answer snapshot is still current.
-- A racing save makes this return false so the server reloads and grades the new snapshot.
create function public.commit_quiz_attempt(p_attempt_id uuid, p_student_id uuid, p_answers jsonb,
  p_grades jsonb, p_score numeric, p_max_score numeric, p_auto boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a public.assessment_attempts%rowtype; current_answers jsonb; title text; n int;
begin
  select * into a from public.assessment_attempts where id = p_attempt_id and student_id = p_student_id for update;
  if not found then raise exception 'Attempt not found.'; end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student' and active) then
    raise exception 'Student account is inactive.'; end if;
  if a.status = 'submitted' then return true; end if;
  select coalesce(jsonb_object_agg(question_version_id::text, to_jsonb(selected_option_ids)), '{}'::jsonb)
    into current_answers from public.attempt_answers where attempt_id = a.id;
  if current_answers is distinct from p_answers then return false; end if;
  select count(*) into n from public.assessment_questions where assessment_id = a.assessment_id;
  if n = 0 or jsonb_array_length(p_grades) <> n or
     (select count(distinct g ->> 'question_version_id') from jsonb_array_elements(p_grades) g) <> n or
     exists (select 1 from jsonb_array_elements(p_grades) g where not exists (
       select 1 from public.assessment_questions where assessment_id = a.assessment_id
         and question_version_id = (g ->> 'question_version_id')::uuid
         and marks = (g ->> 'max_marks')::numeric)) then
    raise exception 'Quiz grading data is incomplete.'; end if;
  insert into public.attempt_grades (attempt_id, question_version_id, is_correct, awarded_marks, max_marks)
    select a.id, (g ->> 'question_version_id')::uuid, (g ->> 'is_correct')::boolean,
      (g ->> 'awarded_marks')::numeric, (g ->> 'max_marks')::numeric
    from jsonb_array_elements(p_grades) g
  on conflict (attempt_id, question_version_id) do update set is_correct = excluded.is_correct,
    awarded_marks = excluded.awarded_marks, max_marks = excluded.max_marks;
  update public.assessment_attempts set status = 'submitted', submitted_at = now(),
    auto_submitted = p_auto or (a.deadline_at is not null and clock_timestamp() > a.deadline_at),
    score = p_score, max_score = p_max_score where id = a.id;
  select assessments.title into strict title from public.assessments where id = a.assessment_id;
  insert into public.notifications (recipient_id, type, title, body, link, reference_id)
    select id, 'quiz_submitted', 'Quiz submitted: ' || title,
      case when p_auto then 'Submitted automatically when the timer ran out.' else 'Score ' || p_score || '/' || p_max_score end,
      '/admin/submissions/quiz/' || a.id, a.id from public.profiles where role = 'admin';
  return true;
end $$;

alter table public.code_submissions add column claim_token uuid;

-- Serialize admission per student, before any runner resources are consumed.
create function public.reserve_code_run(p_student_id uuid, p_version_id uuid, p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('code-admission:' || p_student_id::text, 0));
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student' and active) then
    raise exception 'Student account is inactive.'; end if;
  if (select count(*) from public.code_runs where student_id = p_student_id and created_at >= now() - interval '1 minute') >= 8 then
    raise exception 'Run rate limit exceeded.'; end if;
  insert into public.code_runs (student_id, question_version_id, source_code)
    values (p_student_id, p_version_id, p_code) returning id into result;
  return result;
end $$;

create function public.enqueue_code_submission(p_student_id uuid, p_version_id uuid, p_code text,
  p_language text, p_key text, p_max_marks numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.code_submissions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('code-admission:' || p_student_id::text, 0));
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student' and active) then
    raise exception 'Student account is inactive.'; end if;
  select * into s from public.code_submissions where student_id = p_student_id and idempotency_key = p_key;
  if found then
    if s.source_code <> p_code or s.question_version_id <> p_version_id or s.language <> p_language then
      raise exception 'Idempotency key belongs to a different submission.'; end if;
    return jsonb_build_object('id', s.id, 'status', s.status, 'duplicate', true);
  end if;
  if (select count(*) from public.code_submissions where student_id = p_student_id and submitted_at >= now() - interval '10 minutes') >= 12 then
    raise exception 'Submission rate limit exceeded.'; end if;
  insert into public.code_submissions (student_id, question_version_id, source_code, language, idempotency_key, max_marks)
    values (p_student_id, p_version_id, p_code, p_language, p_key, p_max_marks) returning * into s;
  return jsonb_build_object('id', s.id, 'status', s.status, 'duplicate', false);
end $$;

-- Retry the whole batch after a lost response without duplicating questions. All writes roll back together.
create table public.import_batches (
  id uuid primary key,
  created_by uuid not null references public.profiles(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
grant select, insert on public.import_batches to service_role;
create function public.commit_import_batch(p_batch_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare previous public.import_batches%rowtype; item jsonb; saved jsonb; result jsonb := '[]'::jsonb;
begin
  perform public.assert_admin();
  perform pg_advisory_xact_lock(hashtextextended('import-batch:' || p_batch_id::text, 0));
  select * into previous from public.import_batches where id = p_batch_id;
  if found then
    if previous.created_by <> auth.uid() or previous.payload <> p_items then raise exception 'Import retry does not match the original batch.'; end if;
    return previous.result;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Invalid import batch.'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if item ->> 'type' = 'mcq' then saved := public.save_mcq_draft(item -> 'payload');
    elsif item ->> 'type' = 'coding' then saved := public.save_coding_draft(item -> 'payload');
    else raise exception 'Invalid question type.'; end if;
    result := result || jsonb_build_array(jsonb_build_object('questionId', saved ->> 'question_id',
      'type', item ->> 'type', 'title', item -> 'payload' ->> 'title'));
  end loop;
  update public.imports set status = 'imported' where status = 'parsed' and id in (
    select nullif(entry.value -> 'payload' ->> 'import_id', '')::uuid from jsonb_array_elements(p_items) as entry(value));
  insert into public.import_batches (id, created_by, payload, result) values (p_batch_id, auth.uid(), p_items, result);
  return result;
end $$;

-- Published feedback remains readable while the admin edits a private revision.
create table public.review_drafts (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  content jsonb not null
);
alter table public.review_drafts enable row level security;
create policy review_drafts_admin on public.review_drafts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.review_drafts to authenticated, service_role;
create function public.save_review(p_payload jsonb, p_publish boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing public.reviews%rowtype; rid uuid; content jsonb;
  cid uuid := nullif(p_payload ->> 'code_submission_id', '')::uuid;
  aid uuid := nullif(p_payload ->> 'attempt_id', '')::uuid;
begin
  perform public.assert_admin();
  if (cid is null) = (aid is null) then raise exception 'Select one review target.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('review:' || coalesce(cid, aid)::text, 0));
  select * into existing from public.reviews where code_submission_id = cid or attempt_id = aid;
  content := p_payload || jsonb_build_object('reviewer_id', auth.uid());
  if existing.published_at is not null and not p_publish then
    insert into public.review_drafts (review_id, content) values (existing.id, content)
      on conflict (review_id) do update set content = excluded.content;
    return jsonb_build_object('publishedAt', existing.published_at, 'hasDraft', true);
  end if;
  rid := coalesce(existing.id, gen_random_uuid());
  insert into public.reviews (id, code_submission_id, attempt_id, reviewer_id, status,
    marks, max_marks, comments, suggestions, explanation, published_at)
  values (rid, cid, aid, auth.uid(), content ->> 'status', (content ->> 'marks')::numeric,
    (content ->> 'max_marks')::numeric, content ->> 'comments', content ->> 'suggestions', content ->> 'explanation',
    case when p_publish then now() else null end)
  on conflict (id) do update set reviewer_id = excluded.reviewer_id, status = excluded.status,
    marks = excluded.marks, max_marks = excluded.max_marks, comments = excluded.comments,
    suggestions = excluded.suggestions, explanation = excluded.explanation, published_at = excluded.published_at;
  delete from public.review_drafts where review_id = rid;
  return jsonb_build_object('publishedAt', case when p_publish then now() else null end, 'hasDraft', false);
end $$;

revoke all on function public.save_quiz_answer(uuid, uuid, uuid, uuid[], boolean),
  public.commit_quiz_attempt(uuid, uuid, jsonb, jsonb, numeric, numeric, boolean),
  public.reserve_code_run(uuid, uuid, text), public.enqueue_code_submission(uuid, uuid, text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.save_quiz_answer(uuid, uuid, uuid, uuid[], boolean),
  public.commit_quiz_attempt(uuid, uuid, jsonb, jsonb, numeric, numeric, boolean),
  public.reserve_code_run(uuid, uuid, text), public.enqueue_code_submission(uuid, uuid, text, text, text, numeric)
  to service_role;
revoke all on function public.commit_import_batch(uuid, jsonb), public.save_review(jsonb, boolean) from public, anon;
grant execute on function public.commit_import_batch(uuid, jsonb), public.save_review(jsonb, boolean) to authenticated, service_role;

-- Apply the same active-student gate to work, feedback, notifications and images as to content.
drop policy drafts_own on public.code_drafts;
create policy drafts_own on public.code_drafts for all to authenticated
  using (student_id = auth.uid() and public.is_student())
  with check (student_id = auth.uid() and public.is_student() and public.student_can_see_version(question_version_id));
drop policy runs_read on public.code_runs;
create policy runs_read on public.code_runs for select to authenticated
  using (public.is_admin() or (student_id = auth.uid() and public.is_student()));
drop policy submissions_read on public.code_submissions;
create policy submissions_read on public.code_submissions for select to authenticated
  using (public.is_admin() or (student_id = auth.uid() and public.is_student()));
drop policy reviews_student_read on public.reviews;
create policy reviews_student_read on public.reviews for select to authenticated
  using (public.is_student() and published_at is not null and (
    exists (select 1 from public.code_submissions where id = code_submission_id and student_id = auth.uid()) or
    exists (select 1 from public.assessment_attempts where id = attempt_id and student_id = auth.uid())));
drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = auth.uid() and (public.is_admin() or public.is_student()));
drop policy notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid() and (public.is_admin() or public.is_student()))
  with check (recipient_id = auth.uid() and (public.is_admin() or public.is_student()));
drop policy assets_read on storage.objects;
create policy assets_read on storage.objects for select to authenticated
  using (bucket_id = 'question-assets' and (public.is_admin() or (public.is_student() and exists (
    select 1 from public.question_versions where image_path = storage.objects.name
      and published_at is not null and public.student_can_see_version(id)))));
