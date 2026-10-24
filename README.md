# Wizard PT

A private coding + MCQ practice platform for two people: an **administrator** who writes and publishes questions, and a **student** who solves them in a LeetCode-style workspace. Java code is compiled and run in an isolated sandbox, graded against public and hidden tests, and reviewed by the admin.

```
admin pastes / uploads a question → reviews it → publishes → student receives it live
→ student runs / submits → system grades it → admin reviews code and gives feedback
```

**Live:** https://wizard-pt.vercel.app (private; sign-in only, no public registration)

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind 4 · Monaco · Supabase (Postgres, Auth, RLS, Realtime, Storage) · Judge0 CE (or a local Docker sandbox for development) · Vitest · Playwright.

---

## Quick start (local)

Prerequisites: Node 20+, pnpm, Docker (OrbStack/Docker Desktop), internet access (Monaco loads from a CDN and the JDK image is pulled once).

```bash
pnpm install
docker pull eclipse-temurin:21-jdk       # Java sandbox image (local runner)

pnpm db:start                            # local Supabase (Postgres, Auth, Realtime, Storage)
pnpm exec supabase status -o env         # copy API_URL / PUBLISHABLE_KEY / SECRET_KEY
cp .env.example .env.local               # then fill in the values (see below)
pnpm db:reset                            # applies supabase/migrations
```

In `.env.local` for local development set `RUNNER_PROVIDER=docker`, the three Supabase values, and the bootstrap credentials (`ADMIN_*`, `STUDENT_*`).

```bash
pnpm bootstrap                           # creates the two accounts (see "Accounts")
pnpm seed                                # optional demo content (verified in the sandbox)
pnpm dev                                 # http://localhost:3000
```

Sign in with the credentials you set. The admin lands on `/admin`, the student on `/student`.

### Accounts

Public sign-up is disabled (`supabase/config.toml` → `[auth] enable_signup = false`, and users have no way to create profiles). `pnpm bootstrap` is the only provisioning path: it reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STUDENT_EMAIL`, `STUDENT_PASSWORD` from the environment (or prompts for them), creates/updates both users with the service-role key, and writes their `profiles` row (role lives **only** in `profiles`, and users cannot change it). No credentials are committed or hardcoded; remove them from your env after running it. Re-running resets the passwords to the supplied values.

### Adding a problem from a written spec

`pnpm problem:add scripts/problems/scrambled-twin-codes.ts` creates a problem as the admin, runs its **reference solution against every test** in the Docker sandbox, and publishes it only if all pass (`--draft` saves it as a draft; `--env .env.cloud --accounts` targets the cloud project). A problem file has the same shape as the seed problems (`scripts/seed/problems.ts`); `scripts/problems/scrambled-twin-codes.ts` is a worked example whose hidden-test answers are computed by an independent implementation.

### Demo data

`pnpm seed` creates 6 Java problems (including **Reverse Only the Letters**, a full-program problem, public + hidden tests), 8 MCQs and a sample timed quiz, all flagged `is_seed`. Every reference solution is executed against every test in the sandbox before the problem is published; if the sandbox is unavailable the problems stay drafts. `pnpm seed --draft` creates drafts only. `pnpm seed:remove` deletes seed content and any work done on it.

---

## How it works

| Area | Behaviour |
|---|---|
| **Create** | Manual form, pasted raw text (deterministic parser), or PDF upload (text PDFs; scanned PDFs are reported as *OCR required*). Imports always land as editable **drafts** with unresolved parts flagged; answer keys, reference solutions and hidden tests are never invented. |
| **Coding modes** | *Function-only* (default): admin gives a Java signature; the platform generates the `Main` wrapper, input parsing and printing; the student edits only the method (or only the body). *Full program*: student writes `Main` and uses stdin/stdout. Admin can instead paste a full boilerplate with `// ==== STUDENT CODE START/END ====` markers. |
| **Trusted composition** | The server rebuilds the program as `stored prefix + student code + stored suffix` — no search-and-replace, and the API accepts only `{versionId, code}`. Unbalanced brackets, marker lines etc. are rejected. |
| **Typed harness** | `String, int, long, double, boolean, char, int[], long[], double[], boolean[], String[]` params/returns, plus `ArrayList<String>` / `List<String>` as parameters only (a count line, then one line of space-separated items). Encoding documented in `src/lib/coding/signature.ts`. Nothing else is advertised. |
| **Run vs Submit** | *Run* executes public tests (or custom input), stores nothing but a rate-limit record. *Submit* creates an immutable snapshot, grades public + hidden tests asynchronously (poll + stall recovery), scores by test weight, notifies the admin. Student sees counts for hidden tests, never their data (unless a problem opts in). |
| **Output comparison** | Explicit per problem: `exact` (default; only trailing whitespace/newlines ignored), `trim`, `tokens`, `float` (tolerance). Case and ordering always matter. |
| **Failure safety** | Runner down, queue timeout, or JVM start failure → verdict `system_error` ("not evaluated"), never *Accepted*; the student can retry the same snapshot. |
| **Versioning** | Questions have immutable versions. Editing a published question creates a new draft version; the student keeps v1 (and drafts/attempts on it) until v2 is published. Quizzes freeze their questions and settings on publish. |
| **Quizzes** | Single/multi-answer MCQs, timer (server-clock based), attempts, shuffle, negative marking, optional partial credit, navigator, mark-for-review, autosave with offline retry, auto-submit at timer end. Score/answer visibility: *immediately*, *after you release*, or *never*. |
| **Realtime** | Publishing, submissions, feedback and releases write `notifications` rows; each user subscribes only to their own rows (RLS-filtered). On every event and every reconnect the page re-reads the database — realtime is a hint, the DB is the truth. |
| **Review** | Automatic verdict and the admin's manual status (*Reviewed / Needs improvement / Accepted / Rejected*, marks, feedback) are separate. Feedback is invisible to the student until published. Compare attempts with a line diff. |

---

## Code execution

Student code **never runs in the Next.js process.**

* **`RUNNER_PROVIDER=judge0`** (production). Configure `JUDGE0_URL` plus either a RapidAPI key (`JUDGE0_RAPIDAPI_KEY`, hosted, free tier is ~50 runs/day) or your own instance with `JUDGE0_AUTH_TOKEN`. Each test case is one Judge0 submission (batched, polled with backoff). Credentials stay server-side. `GET /languages` shows the Java id (62 on Judge0 CE 1.13.x).
  *Self-hosting:* Judge0 1.13.x needs **cgroup v1** (many current distros/Docker Desktop/OrbStack use v2 — it will answer, but every job fails with `No such file … /box/Main.java`, which this app reports as "not evaluated"). Use a VM with `systemd.unified_cgroup_hierarchy=0`, an older Ubuntu image, or the hosted API.
* **`RUNNER_PROVIDER=docker`** (local dev / single self-hosted box). One locked-down container per compile and per test: no network, read-only root, all capabilities dropped, no-new-privileges, pids/memory/CPU limits, hard kill on timeout. It is refused when `NODE_ENV=production` unless `RUNNER_ALLOW_DOCKER=1`. Not usable on Vercel.

Java version differs by runner (JDK 21 in Docker, JDK 13 on Judge0 CE): avoid newer language features if you deploy on Judge0 CE.

Limits: per-test time/memory per problem, `RUNNER_MAX_CONCURRENCY` (default 2), 8 runs/min and 12 submissions/10 min per student, 64 KB source size.

* **`RUNNER_PROVIDER=manual`** (external-runner mode, no execution service needed). The site never runs code. In the workspace the student presses **Copy program** (the complete `Main.java`), runs it in any online Java compiler using the sample inputs, pastes her final code back and presses **Submit for review**. The submission is saved exactly as submitted and stays *queued*; the admin is notified and either reviews the code by hand, or runs **`pnpm grade`** on a machine with Docker. `pnpm grade` reads the cloud credentials (`vercel env pull .env.cloud --environment production`), runs every queued submission against all public and hidden tests in the local sandbox, writes the verdict, and notifies the student (`pnpm grade --watch` keeps polling). Run/Custom input are disabled in this mode. Switching to `judge0` later needs only the env change.

Check the connection in **Admin → Settings → Test connection**.

---

## Security model

* **RLS everywhere, deny by default.** Students can read only published, non-secret content and their own drafts/submissions/notifications. Hidden tests, answer keys, wrapper code, reference solutions, grades and attempts have **no student policy**. Role changes are blocked by column privileges.
* **Server authority.** Pages use `requireAdmin/requireStudent`; actions and route handlers re-check (`assertAdmin/assertStudent`) and validate with zod. The service-role key is used only in server modules, always scoped by the authenticated user's id.
* **Immutability** is enforced in Postgres triggers (published versions and their children, assessment structure, submitted code).
* **Private files:** PDFs are stored in a private bucket; imported Markdown is rendered with raw HTML disabled and sanitized.
* **Idempotent writes:** submissions require an idempotency key; attempt start/finalize and submission processing use atomic claims.

---

## Tests

```bash
pnpm test               # unit + integration (needs local Supabase + Docker sandbox)
pnpm build && pnpm test:e2e   # Playwright against the production build
pnpm lint && pnpm typecheck
```

Covered: signature/harness/composition/comparison/scoring; text and PDF importers (real PDFs incl. scanned and corrupt); MCQ grading and visibility; **real Java compile/run** through the sandbox (correct, wrong, compile error, exception, infinite loop, memory hog, `System.exit`, noisy stdout); Judge0 client against a protocol fake; RLS/immutability/versioning/realtime against the real database; quiz lifecycle (autosave, limits, timer, concurrency, release rules); submission pipeline (claiming, hidden-data hiding, dead-runner → `system_error` → retry); browser flows for the coding path, the quiz path, PDF import, auth boundaries and API tampering/rate-limits.

---

## Deployment

1. **Supabase project:** create it, then `pnpm exec supabase link --project-ref …` and `pnpm db:push` (applies migrations, creates the buckets, adds `notifications` to the realtime publication). In *Authentication → Providers → Email* keep email sign-in on and **disable "Allow new users to sign up"**. Optionally set a password policy.
2. **Provision users:** with `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY` pointing at the cloud project and the `ADMIN_*`/`STUDENT_*` variables set, run `pnpm bootstrap`.
3. **Runner:** self-host Judge0 on a cgroup-v1 Linux VM or use a hosted Judge0 plan, or set `RUNNER_PROVIDER=manual` (see *Code execution*) to deploy without an execution service.
4. **Vercel:** import the repo, set the variables from `.env.example` (`RUNNER_PROVIDER=judge0`, `JUDGE0_*`, the Supabase trio, `NEXT_PUBLIC_APP_NAME`). The submit route uses `after()` and `maxDuration` — a plan/Fluid-compute setting that allows ≥ 60 s is recommended; the poll endpoint also re-kicks stalled jobs, so a shorter limit degrades gracefully.
5. In Supabase **Auth → URL configuration** set the site URL to your Vercel domain.

---

## Known limitations

* **Live Judge0 grading was not verified end-to-end** in the development environment (the host uses cgroup v2). The client is tested against Judge0's real API surface (health, languages, submit/poll, failure handling) and a protocol fake; all real compile/run verification used the Docker sandbox. Run **Settings → Test connection** and one seeded problem after configuring Judge0.
* Supported Java types are limited to those listed above (lists only of `String` and only as parameters; no nested arrays or custom classes).
* Only Java; the runner interface (`src/lib/runner`) and config columns are language-ready but no other language is implemented.
* PDF import needs a text layer; there is no OCR. Question detection is heuristic, which is why everything passes through an editable review step.
* Monaco is loaded from a CDN at runtime.
* Memory usage is reported only where the runner provides it (Judge0); the Docker runner reports time only.
* Copy-paste/proctoring/plagiarism detection are out of scope (private two-person use).

## Final verification checklist

- [ ] `pnpm db:reset && pnpm bootstrap && pnpm seed` succeeds; seed log shows reference solutions passing every test.
- [ ] Admin can sign in; student cannot open `/admin/*` (redirects to *unauthorized*).
- [ ] Paste the "Reverse Only the Letters" text → Parse → add hidden tests → *Validate with reference solution* → Publish.
- [ ] Student (already on *Assessments*) sees it appear without refresh, runs samples, submits, sees counts but no hidden data.
- [ ] Admin receives the notification, reviews the exact submitted code, publishes feedback; student sees it.
- [ ] Upload `tests/fixtures/mcq-text.pdf` → 3 MCQs with answer keys; scanned PDF says *OCR required*.
- [ ] Build a quiz, publish, take it as the student (refresh mid-quiz), submit; answers stay hidden until **Release answers**.
- [ ] Stop Docker/Judge0 and submit: result is *Evaluation unavailable*, never *Accepted*; retry works once back.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all green.
