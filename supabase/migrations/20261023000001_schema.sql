-- Wizard PT — core schema.
-- Design notes:
--  * Content is versioned: question_versions are immutable once published_at is set.
--  * Secrets (answer keys, wrapper code, reference solutions, hidden grading details) live in
--    separate admin-only tables so no broad student query can ever return them.
--  * Real-time messages are notifications only; these tables stay the source of truth.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role         text not null check (role in ('admin', 'student')),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- imports
create table public.imports (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('text', 'pdf')),
  file_name           text,
  storage_path        text,
  status              text not null check (status in ('parsed', 'needs_ocr', 'failed', 'imported')),
  page_count          int,
  raw_text            text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- questions
-- `questions` carries identity + lifecycle only. All human-readable content lives in
-- question_versions so draft edits can never leak through this table.
create table public.questions (
  id                   uuid primary key default gen_random_uuid(),
  seq                  bigint generated always as identity,
  type                 text not null check (type in ('coding', 'mcq')),
  status               text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version_id   uuid,   -- latest version (draft or published); admin use
  published_version_id uuid,   -- version students see for standalone coding problems
  import_id            uuid references public.imports(id) on delete set null,
  is_seed              boolean not null default false,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.question_versions (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null references public.questions(id) on delete cascade,
  version          int  not null check (version >= 1),
  title            text not null check (char_length(title) between 1 and 200),
  difficulty       text not null default 'easy' check (difficulty in ('easy', 'medium', 'hard')),
  topic            text,
  tags             text[] not null default '{}',
  company          text,
  statement_md     text not null default '',
  input_format     text,
  output_format    text,
  constraints_md   text,
  examples         jsonb not null default '[]'::jsonb,   -- [{input, output, explanation?}]
  code_snippet     text,                                  -- optional snippet shown with an MCQ
  image_path       text,                                  -- optional image in storage bucket question-assets
  marks            numeric(7, 2) not null default 10 check (marks >= 0),
  est_minutes      int check (est_minutes is null or est_minutes > 0),
  mcq_multi        boolean not null default false,        -- multiple-correct MCQ
  review_flags     jsonb not null default '[]'::jsonb,    -- import fields still needing admin review
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (question_id, version)
);

alter table public.questions
  add constraint questions_current_version_fk   foreign key (current_version_id)   references public.question_versions(id) on delete set null,
  add constraint questions_published_version_fk foreign key (published_version_id) references public.question_versions(id) on delete set null;

-- Private per-version text (revealed to students only through server code after release).
create table public.question_secrets (
  question_version_id uuid primary key references public.question_versions(id) on delete cascade,
  explanation_md      text
);

-- ---------------------------------------------------------------- MCQ
create table public.mcq_options (
  id                  uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.question_versions(id) on delete cascade,
  option_text         text not null check (char_length(option_text) >= 1),
  display_order       int  not null,
  unique (question_version_id, display_order)
);

-- Answer key: one row per correct option. Admin only.
create table public.mcq_correct_options (
  option_id           uuid primary key references public.mcq_options(id) on delete cascade,
  question_version_id uuid not null references public.question_versions(id) on delete cascade
);

-- ---------------------------------------------------------------- coding
create table public.coding_configs (
  question_version_id uuid primary key references public.question_versions(id) on delete cascade,
  language            text not null default 'java' check (language in ('java')),
  execution_mode      text not null default 'function' check (execution_mode in ('function', 'program')),
  grading_mode        text not null default 'auto' check (grading_mode in ('auto', 'manual')),
  function_signature  text,
  editable_scope      text not null default 'method' check (editable_scope in ('method', 'body')),
  starter_code        text not null,
  time_limit_ms       int  not null default 2000 check (time_limit_ms between 100 and 15000),
  memory_limit_mb     int  not null default 256  check (memory_limit_mb between 32 and 1024),
  compare_mode        text not null default 'exact' check (compare_mode in ('exact', 'trim', 'tokens', 'float')),
  float_tolerance     double precision not null default 1e-6,
  allow_custom_input  boolean not null default true,
  reveal_hidden       boolean not null default false     -- show hidden input/expected after submit
);

-- Trusted wrapper code, reference solution, editorial. Admin only.
create table public.coding_secrets (
  question_version_id uuid primary key references public.question_versions(id) on delete cascade,
  template_prefix     text not null default '',
  template_suffix     text not null default '',
  boilerplate_source  text,
  reference_solution  text,
  last_validation     jsonb
);

create table public.test_cases (
  id                  uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.question_versions(id) on delete cascade,
  input               text not null default '',
  expected_output     text not null default '',
  visibility          text not null default 'hidden' check (visibility in ('public', 'hidden')),
  weight              numeric(7, 2) not null default 1 check (weight > 0),
  ordering            int not null default 0,
  label               text,
  created_at          timestamptz not null default now()
);
create index test_cases_version_idx on public.test_cases (question_version_id, ordering);

-- ---------------------------------------------------------------- assessments (quizzes)
create table public.assessments (
  id                   uuid primary key default gen_random_uuid(),
  seq                  bigint generated always as identity,
  type                 text not null default 'quiz' check (type in ('quiz')),
  title                text not null check (char_length(title) between 1 and 200),
  description          text,
  status               text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  settings             jsonb not null default '{}'::jsonb,
  published_at         timestamptz,
  results_released_at  timestamptz,
  answers_released_at  timestamptz,
  is_seed              boolean not null default false,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.assessment_questions (
  assessment_id       uuid not null references public.assessments(id) on delete cascade,
  question_version_id uuid not null references public.question_versions(id) on delete restrict,
  ordering            int not null,
  marks               numeric(7, 2) not null default 1 check (marks >= 0),
  primary key (assessment_id, question_version_id)
);

create table public.assessment_attempts (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  student_id    uuid not null references public.profiles(id),
  attempt_no    int  not null default 1,
  status        text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  started_at    timestamptz not null default now(),
  deadline_at   timestamptz,
  submitted_at  timestamptz,
  auto_submitted boolean not null default false,
  question_order uuid[] not null default '{}',   -- per-attempt (possibly shuffled) order of question_version_ids
  score         numeric(8, 2),
  max_score     numeric(8, 2),
  unique (assessment_id, student_id, attempt_no)
);
create unique index one_open_attempt_idx on public.assessment_attempts (assessment_id, student_id) where status = 'in_progress';

create table public.attempt_answers (
  attempt_id          uuid not null references public.assessment_attempts(id) on delete cascade,
  question_version_id uuid not null references public.question_versions(id) on delete restrict,
  selected_option_ids uuid[] not null default '{}',
  marked_for_review   boolean not null default false,
  option_order        uuid[],
  updated_at          timestamptz not null default now(),
  primary key (attempt_id, question_version_id)
);

-- Per-question grading outcome. Admin only; students get it via server code after release.
create table public.attempt_grades (
  attempt_id          uuid not null references public.assessment_attempts(id) on delete cascade,
  question_version_id uuid not null references public.question_versions(id) on delete restrict,
  is_correct          boolean not null,
  awarded_marks       numeric(7, 2) not null,
  max_marks           numeric(7, 2) not null,
  primary key (attempt_id, question_version_id)
);

-- ---------------------------------------------------------------- coding work
create table public.code_drafts (
  student_id          uuid not null references public.profiles(id) on delete cascade,
  question_version_id uuid not null references public.question_versions(id) on delete cascade,
  source_code         text not null,
  updated_at          timestamptz not null default now(),
  primary key (student_id, question_version_id)
);

create table public.code_runs (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.profiles(id),
  question_version_id uuid not null references public.question_versions(id) on delete restrict,
  source_code         text not null,
  verdict             text,
  created_at          timestamptz not null default now()
);
create index code_runs_rate_idx on public.code_runs (student_id, created_at desc);

create table public.code_submissions (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references public.profiles(id),
  question_version_id   uuid not null references public.question_versions(id) on delete restrict,
  source_code           text not null,
  language              text not null default 'java',
  idempotency_key       text not null,
  status                text not null default 'queued' check (status in ('queued', 'running', 'completed', 'system_error')),
  verdict               text check (verdict in ('accepted', 'partial', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'memory_limit', 'system_error', 'manual')),
  score_pct             numeric(6, 2),
  marks_awarded         numeric(7, 2),
  max_marks             numeric(7, 2),
  passed_public         int,
  total_public          int,
  passed_hidden         int,
  total_hidden          int,
  exec_time_ms          int,
  memory_kb             int,
  compile_output        text,
  results               jsonb not null default '[]'::jsonb,  -- student-visible per-test results
  error_message         text,
  attempts_count        int not null default 0,
  claimed_at            timestamptz,
  submitted_at          timestamptz not null default now(),
  completed_at          timestamptz,
  unique (student_id, idempotency_key)
);
create index code_submissions_student_idx on public.code_submissions (student_id, submitted_at desc);
create index code_submissions_version_idx on public.code_submissions (question_version_id);

-- Hidden-test detail (actual output etc.) for the admin only.
create table public.code_submission_private (
  submission_id  uuid primary key references public.code_submissions(id) on delete cascade,
  detailed_results jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------- reviews
create table public.reviews (
  id                 uuid primary key default gen_random_uuid(),
  code_submission_id uuid unique references public.code_submissions(id) on delete cascade,
  attempt_id         uuid unique references public.assessment_attempts(id) on delete cascade,
  reviewer_id        uuid not null references public.profiles(id),
  status             text not null check (status in ('reviewed', 'needs_improvement', 'accepted', 'rejected')),
  marks              numeric(7, 2),
  max_marks          numeric(7, 2),
  comments           text,
  suggestions        text,
  explanation        text,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((code_submission_id is not null)::int + (attempt_id is not null)::int = 1)
);

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  reference_id uuid,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
