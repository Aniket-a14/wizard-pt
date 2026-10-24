# MASTER IMPLEMENTATION PROMPT — PRIVATE CODING & MCQ PRACTICE PLATFORM

## 1. Your Role and Mission

Act as a senior full-stack software engineer, system architect, product designer, and QA engineer.

Your objective is to design, architect, implement, test, and prepare for deployment a complete, functional private web application for two users.

This is a personal coding and multiple-choice-question practice platform.

It is NOT intended to become a commercial SaaS application, a public learning management system, or an enterprise-grade examination service.

Avoid unnecessary complexity while maintaining sound architecture, security, reliability, and extensibility.

The platform must function as a private online-assessment environment similar in interaction to LeetCode, HackerRank, and coding rounds conducted by companies such as Accenture, TCS, Capgemini, Cognizant, and other IT organizations.

There will initially be only two users:

1. **Administrator:** Me. I create questions, upload materials, manage assessments, inspect answers, and provide feedback.
2. **Student:** My friend. She receives the questions, practices coding, answers MCQs, runs code, submits solutions, and reviews feedback.

The central principle is:

**I should be able to upload or paste a question with minimal formatting effort, configure its evaluation details, publish it, and immediately make it available to my friend.**

The complete cycle from publishing to submission review must work reliably.

Do not build only attractive screens. Build working systems with persistent data, actual execution, real authentication, accurate grading, and proper integration.

---

## 2. Discovery and Planning

Before implementing, inspect the available repository and development environment.

If an existing project exists:
- Understand its structure and dependencies.
- Reuse suitable existing functionality.
- Avoid unnecessary rewrites.

If no project exists, initialize a clean repository.

Ask me a small, focused set of important questions covering:
- Website name and branding.
- Whether Java should be the only supported language initially.
- Authentication preference.
- Hosting/deployment preference.
- Whether assessments should have timers.
- Whether the student can view correct answers immediately or only after review.
- Whether external code-execution services are acceptable.

Recommend sensible defaults so that I do not have to make every technical decision.

Do not ask dozens of questions about trivial features or implementation details.

Once the essential choices are resolved, create a concise architecture and implementation plan, then proceed with development.

If Codex CLI is installed and available, you may use it to delegate independent implementation, review, and testing tasks. However, maintain ownership of architectural decisions, integration, final validation, and delivery.

## 3. Product Scope and Core Modules

The application should contain these primary modules:

**Authentication and Role Management**
- Private login
- Admin role
- Student role

**Admin Dashboard**
- Question management
- PDF/text imports
- MCQ creator
- Coding problem creator
- Code templates and boilerplates
- Test case management
- Publishing
- Submissions and evaluation
- Progress monitoring

**Student Dashboard**
- Available problems
- MCQ assessments
- Coding assessments
- Integrated code editor
- Code execution
- Submission history
- Results and feedback
- Progress tracking

**Shared Infrastructure**
- Database
- File storage
- Real-time updates
- Secure code execution
- Submission records
- Error handling

Every module must be integrated into the complete user flow.

---

# PART A — AUTHENTICATION AND USERS

## 4. Account System

Implement two separate, restricted accounts.

### Administrator

The administrator must have exclusive permissions to:
- Create, edit, archive, and delete questions.
- Upload PDF documents.
- Import or paste questions.
- Manage coding templates.
- Add public and hidden test cases.
- Configure correct MCQ answers.
- Publish or unpublish assessments.
- Inspect submissions.
- Review submitted source code.
- Assign marks and feedback.
- Monitor student progress.
- Configure assessment settings.

### Student

The student must be able to:
- Log in independently.
- View published assessments.
- Access available problems.
- Write and run code.
- Submit solutions.
- Answer MCQs.
- Track assessment status.
- Review previous attempts.
- View permitted results and feedback.

The student must NOT be able to:
- Access admin routes.
- Modify questions.
- Publish assessments.
- Read hidden test cases.
- Inspect unpublished problems.
- Access answer keys before their configured release.
- Change assessment scores.
- Modify other users' records.

Use server-side authorization and database-level controls, not merely client-side route hiding.

Disable public account registration by default.

Create a documented, secure bootstrap process for provisioning the two users without hardcoding passwords or committing credentials.

---

# PART B — ADMIN DASHBOARD

## 5. Admin Dashboard Overview

Build a clean and functional dashboard displaying:

- Total coding questions
- Total MCQ questions
- Published assessments
- Draft assessments
- Pending submissions
- Completed assessments
- Student performance
- Recent activity

Provide prominent actions for:

**Create Coding Problem**

**Create MCQ / Quiz**

**Upload PDF**

**Paste Questions**

**Review Submissions**

Do not make creating a question a cumbersome process.

The administrator should ideally be able to prepare and publish an ordinary question in a few interactions.

## 6. Question Import System

This is a particularly important module.

Support three primary ways of creating questions.

### Method 1 — Manual Creation

Provide structured fields for:
- Question title
- Description
- Question type
- Difficulty
- Topic
- Tags
- Company (optional)
- Problem statement
- Examples
- Constraints
- Explanation
- Marks

For coding questions, include language, method signature, editor template, execution wrapper, and test cases.

For MCQs, include answer choices and grading configuration.

### Method 2 — Paste Raw Text

I should be able to paste lengthy, imperfectly formatted text into a large text area.

The application should parse it into a structured question preview.

For instance, I may paste:

> Problem 2 — Reverse Only the Letters [Easy | Strings + Two Pointers]
>
> An Accenture security team masks product codes before sharing them with a vendor.
>
> Masking reverses the order of the LETTERS in the code, while every non-letter stays exactly where it is.
>
> Function signature:
>
> public static String maskCode(String code)
>
> Input format:
> One line containing the code.
>
> Output format:
> The masked code.
>
> Constraints:
> 1 ≤ code.length() ≤ 100000
>
> Example 1:
> Input: AB-12-CD
> Output: DC-12-BA
>
> Example 2:
> Input: Ja#va-21
> Output: av#aJ-21
>
> Example 3:
> Input: 1234
> Output: 1234
>
> Example 4:
> Input: x-Y
> Output: Y-x

The system should identify, when possible:
- Title
- Difficulty
- Topic
- Description
- Function signature
- Input/output requirements
- Constraints
- Examples
- Explanations

Convert the raw content into the application's structured question format.

Maintain code formatting, symbols, line breaks, examples, and indentation.

Do not silently change the meaning of problem statements.

The parser should support deterministic text processing first.

Optionally support AI-assisted extraction through a replaceable provider interface, but do not make a paid AI API mandatory.

If a section cannot be identified reliably, leave it editable and explicitly flag it for administrator review.

Never invent missing answer keys, reference solutions, or hidden test cases and present them as verified.

### Method 3 — PDF Upload

Allow uploading one or multiple PDFs.

Examples:
- Company placement question papers
- Coding practice sheets
- MCQ documents
- Interview preparation material
- Custom assessments

Workflow:

1. Administrator uploads the PDF.
2. Backend extracts available text.
3. System attempts to identify individual questions.
4. Questions are categorized into MCQs and coding problems.
5. Administrator receives an editable import preview.
6. Administrator corrects formatting, answers, and test configurations.
7. Approved questions are added to the question bank.
8. Administrator publishes selected questions.

Support text-based PDFs in the initial implementation.

For scanned/image-only PDFs, provide a clear OCR-required status. OCR may be an optional additional feature if a reliable solution is available.

Never pretend that an unreadable scanned PDF was successfully processed.

Store the original uploaded PDF and associate imported questions with the source document.

A single PDF may contain multiple questions.

The administrator must be able to select which extracted questions to import.

**Critical requirement:** Imported content must always pass through a review stage before publication.

---

# PART C — CODING ASSESSMENT ENGINE

## 7. Coding Problem Creation

Coding problems are the highest-priority feature.

Create a dedicated admin interface containing:

### Problem Metadata
- Title
- Problem ID
- Difficulty
- Company
- Topic
- Tags
- Estimated time
- Marks
- Publication status

### Problem Description
- Rich-text or Markdown editor
- Constraints
- Input format
- Output format
- Example inputs
- Example outputs
- Example explanations

Support fenced code blocks and mathematical notation when appropriate.

### Execution Configuration
- Programming language
- Java method signature
- Starter code
- Editable code region
- Hidden implementation scaffolding
- Execution mode
- Time limits
- Memory limits
- Public test cases
- Hidden test cases

### Optional Reference Solution
Allow me to provide a verified correct implementation.

Reference solutions must be stored privately.

If provided, permit administrators to validate the configured tests against the reference solution before publishing.

## 8. Boilerplate / Template System

This functionality must closely resemble company online assessments.

I want to paste a complete Java boilerplate, but the student should only need to implement the intended method or function body.

Support two execution modes.

### Mode A — Function-Only (Default)

I configure:

```java
public static String maskCode(String code)
```

The student sees an editor containing:

```java
public static String maskCode(String code) {
    // Write your solution here
}
```

Alternatively, for a stricter function-body mode, show the fixed method signature as non-editable scaffolding and expose only the body as editable code.

She should not need to:
- Write the Main class.
- Implement input parsing.
- Implement output printing.
- Configure Java compilation.
- Add the executable entry point.

The platform manages these operations.

On execution, the backend constructs a complete Java program using the administrator-defined template and submitted implementation.

For example:

```java
public class Main {
    public static String maskCode(String code) {
        // Student implementation
    }

    public static void main(String[] args) {
        java.util.Scanner sc =
            new java.util.Scanner(System.in);

        String code = sc.nextLine();

        System.out.println(maskCode(code));
    }
}
```

The administrator should be able to configure the required method interface and associated runner.

Do not use brittle text replacement that could accidentally alter the wrong portion of the template.

Define validated editable-region boundaries and deterministic code composition.

Reconstruct the complete program on the trusted server using the stored template.

The client must never be allowed to replace the trusted execution wrapper simply by modifying an API request.

### Mode B — Full Program

For questions requiring complete programs, allow the student to write or edit the entire relevant Java source.

This is optional per problem.

The administrator chooses which mode applies.

## 9. Integrated Code Editor

Use Monaco Editor or another mature browser-based code editor.

Desired capabilities:
- Java syntax highlighting
- Line numbers
- Automatic indentation
- Bracket pairing
- Code folding
- Find and replace
- Editor font-size controls
- Dark/light theme support
- Keyboard shortcuts
- Clear compilation errors
- Reset-to-starter-code action
- Automatic draft saving

Keep the student coding interface similar in function to established online judges.

On desktop, provide a split layout:

**Left:** Problem description, examples, and constraints.

**Right:** Code editor, execution controls, and test results.

Allow resizing the panels.

Support tabs for:
- Description
- Submissions
- Test Results

Provide accessible responsive alternatives for smaller screens.

## 10. Real Java Code Execution

This is non-negotiable.

The platform must actually compile and execute the submitted code.

Do not create simulated execution results.

Investigate and select a dependable isolated code-execution backend.

Preferred starting option: Judge0 CE through a configured service.

An equivalent isolated execution provider is acceptable if justified.

Do not execute untrusted student code directly inside the Next.js server process.

Do not use unrestricted child_process, eval, or similar in-process execution techniques to run student submissions.

Execution pipeline:

1. Student clicks Run.
2. Frontend sends the editable code and problem identifier.
3. Backend authenticates the student.
4. Backend retrieves the trusted problem template.
5. Backend reconstructs a complete compilable program.
6. Backend selects permitted test inputs.
7. Code is sent to an isolated execution service.
8. Execution results are retrieved.
9. Backend compares outputs.
10. Frontend displays the result.

Support:
- Compilation errors
- Runtime errors
- Timeouts
- Memory-limit failures
- Wrong answers
- Accepted solutions
- Execution duration
- Memory usage, where available

Execution should have strict resource limits and rate limiting.

Do not expose execution-provider credentials to the browser.

Use asynchronous submission processing when the execution provider requires it.

Handle service failures, queued jobs, retries, and unavailable runtimes without pretending the code passed.

## 11. Public and Hidden Test Cases

Every coding problem should support two classes of test cases.

### Public Test Cases

Visible to the student.

For the example problem:

| Input | Expected Output |
|---|---|
| AB-12-CD | DC-12-BA |
| Ja#va-21 | av#aJ-21 |
| 1234 | 1234 |
| x-Y | Y-x |

These can be imported from the supplied examples, subject to review.

### Hidden Test Cases

Only the administrator can configure or inspect these before answer release.

They should evaluate:
- Edge cases
- Boundary conditions
- Special characters
- Minimum input length
- Maximum valid input length
- All-letter inputs
- No-letter inputs
- Mixed uppercase/lowercase
- Algorithmic efficiency

For this particular problem, consider scenarios such as:
- A single letter
- An empty set of letters within a nonempty string
- Letters separated by symbols
- Long strings approaching the maximum length
- Strings containing only supported symbols

Configure test cases with expected outputs, points, and visibility.

Require valid test configuration before an automatically graded coding question can be published.

### Run vs Submit

Implement two distinct actions.

**Run Code**
- Execute public sample tests.
- Optionally support custom input where the problem's runner permits it.
- Show detailed visible results.
- Do not create a final submission.
- Optionally record run history separately.

**Submit Code**
- Create a permanent, immutable submission snapshot.
- Evaluate against public and hidden tests.
- Store execution verdicts.
- Calculate the score.
- Return permitted feedback.
- Notify the administrator.
- Preserve the exact code as submitted.

Do not reveal hidden input or expected output to the student unless explicitly permitted by assessment settings.

Allow the student to see a summary such as:

```text
Submission Result: Partially Accepted

Public Tests: 4/4 Passed
Hidden Tests: 6/8 Passed

Total: 10/12 Passed
Score: 83.33%

Execution Time: 120 ms
```

These numbers are an illustrative interface example, not hardcoded output.

Use actual test results.

Implement an explicit output-comparison policy. Do not silently ignore meaningful differences in case, ordering, spacing, or output contents.

## 12. Avoid Fragile Testing Architecture

Do not assume that every programming question can be tested by giving the program plain-text stdin.

Design two execution strategies.

**Function-based execution**

The backend generates a trusted test harness that invokes the configured method with typed arguments.

This is appropriate for online assessments where students implement one function.

**Standard-input execution**

The backend feeds configured stdin to the complete program and compares stdout.

This is appropriate for conventional competitive programming problems.

For the initial version, prioritize Java problems using strings, numbers, and common array parameters.

Design typed input serialization and test invocation carefully.

Do not advertise support for complex Java structures unless the corresponding execution and serialization code has been implemented and tested.

Make the execution system extensible to C++, Python, and other languages in the future without requiring them for the initial release.

---

# PART D — MCQ ASSESSMENTS

## 13. MCQ Creation System

The administrator should be able to create MCQs manually or import them from pasted text and PDFs.

Support:

- Single-correct-answer MCQs
- Multiple-correct-answer MCQs
- Four options by default
- Configurable number of options
- Question marks
- Correct answers
- Explanations
- Difficulty
- Topics
- Company tags
- Optional code snippets
- Optional images

For example:

Question:

Which data structure follows FIFO?

A. Stack  
B. Queue  
C. Tree  
D. Graph

Correct answer: B.

Explanation:

A queue processes elements in First In, First Out order.

The admin should be able to configure the answer and explanation.

For automatically graded MCQs, valid answer keys are mandatory before publication.

## 14. Quiz Builder

Allow multiple MCQs to be grouped into one quiz.

Configurations:
- Quiz title
- Description
- Selected questions
- Question order
- Total marks
- Optional timer
- Number of attempts
- Negative marking (optional)
- Randomization (optional)
- Result-visibility settings
- Publish/draft status

The student should be able to navigate between questions.

Features:
- Next and previous
- Question navigator
- Answered/unanswered indicators
- Mark for review
- Clear answer
- Submit quiz
- Submission confirmation

Autosave answers.

Do not lose progress on accidental refreshes.

On final submission:
- Persist all answers.
- Grade using configured answer keys.
- Compute obtained marks.
- Apply negative marking only when explicitly configured.
- Store submission timestamps.
- Respect configured result-visibility rules.

Provide a review screen when results become visible.

---

# PART E — REAL-TIME SYNCHRONIZATION

## 15. Real-Time Publishing and Updates

This is one of the most important requirements.

When I publish a question from my admin account, my friend's student dashboard should update without requiring a manual refresh.

Example workflow:

1. I open Admin Dashboard.
2. I paste a coding question.
3. The parser generates an editable problem.
4. I configure Java boilerplate and tests.
5. I click Publish.
6. The database saves the published version.
7. The student receives the new problem in her dashboard.
8. She opens it and begins solving.

Use Supabase Realtime or another appropriate authenticated real-time mechanism.

Support notifications for:
- Newly published problems
- Newly published MCQ quizzes
- Updated assignments
- Submission received
- Admin feedback published
- Assessment result released

Use private authenticated subscriptions.

Never broadcast hidden test cases, private grading data, or answer keys to the student.

### Versioning Requirement

Changes to a published question must not silently alter an assessment that the student has already started.

Implement a clear policy using versioned problem records or immutable assessment snapshots.

Draft edits should never become visible to the student until published.

Ensure reconnects and refreshes recover the correct database state.

Real-time messages are notifications; persistent database records remain the source of truth.

---

# PART F — SUBMISSIONS AND ADMIN EVALUATION

## 16. Submission Review Dashboard

After the student submits a coding solution, I should see the submission inside my administrator account.

Show:
- Student identity
- Problem title
- Submission date/time
- Programming language
- Submitted source code
- Test results
- Score
- Runtime
- Memory usage if available
- Compilation errors if present
- Evaluation status

Provide a read-only code viewer with syntax highlighting.

Allow viewing previous attempts and comparing submissions.

Support these review states:
- Pending Review
- Reviewed
- Needs Improvement
- Accepted
- Rejected

Keep automated execution verdicts distinct from manual review decisions.

For example, "Accepted" by the code runner and "Reviewed" by the administrator should be separate concepts.

## 17. Manual Feedback

Allow me to add:
- Numeric marks
- Written feedback
- Suggestions
- Explanation
- Final review status

Example feedback:

"Your two-pointer logic is correct, but the implementation unnecessarily creates multiple intermediate strings. Try using a character array to reduce allocations."

Save this feedback persistently.

Notify the student when feedback is published.

Allow the student to see:
- Submitted code
- Automatic evaluation
- Admin comments
- Final awarded marks
- Submission time
- Previous attempts

Do not overwrite old submission snapshots when new solutions are submitted.

## 18. Performance Tracking

Create a lightweight but useful analytics dashboard.

For the student:
- Total questions attempted
- Completed questions
- Coding acceptance rate
- MCQ accuracy
- Average quiz score
- Topic-wise performance
- Difficulty-wise completion
- Recent activity
- Pending feedback

For the administrator:
- Total submitted assessments
- Questions solved correctly
- Areas of difficulty
- Frequently failed problems
- Progress over time
- Pending manual reviews

Use real database queries rather than fabricated dashboard metrics.

Since only one student initially exists, avoid unnecessary multi-tenant analytics systems.

---

# PART G — PRODUCT DESIGN AND USER EXPERIENCE

## 19. Design Philosophy

Create a clean, professional, practical web application.

I do not want generic AI-generated dashboard design.

Avoid:
- Excessive gradients
- Random glowing elements
- Unnecessary decorative cards
- Repeated generic icons
- Large hero sections inside dashboards
- Excessive animation
- Oversized spacing
- Complicated navigation
- Decorative charts with no practical value

Aim for the visual discipline and usability found in professional coding tools.

Study established patterns from:
- LeetCode coding workspace
- HackerRank assessments
- Codeforces problem navigation
- Modern development environments
- Established quiz interfaces

Do not copy any platform's branding or proprietary assets.

### Suggested Visual Direction

Use:
- Restrained typography
- Consistent spacing
- Dark mode for the editor
- Optional application-wide light/dark mode
- Clear difficulty indicators
- Compact navigation
- Neutral color foundations
- One restrained accent color
- High-contrast code output
- Visible focus states
- Responsive layout

The interface should prioritize productivity over decoration.

## 20. Required Pages

Design and implement:

### Public/Authentication
- Login
- Unauthorized access
- Not found

### Administrator
- Admin overview
- Question bank
- Import questions
- Create/edit coding question
- Create/edit MCQ
- Quiz builder
- Assessment management
- Coding submissions
- MCQ submissions
- Submission details
- Analytics
- Settings

### Student
- Student overview
- Available assessments
- Coding problem workspace
- MCQ quiz workspace
- Submission history
- Results and feedback
- Progress
- Profile/settings

Do not create meaningless pages merely to increase page count.

Every page should have useful functionality and functional navigation.

---

# PART H — TECHNICAL ARCHITECTURE

## 21. Preferred Technology Stack

I suggest the following stack, but you may propose alternatives with clear reasons.

### Frontend
- Next.js (stable current release)
- React
- Tailwind CSS
- shadcn/ui for foundational primitives
- Monaco Editor
- TypeScript where appropriate

### Backend
- Next.js server routes/actions or another lightweight server layer
- Server-side validation
- Centralized authorization
- Code execution integration
- Import processing

### Database and Authentication
- Supabase PostgreSQL
- Supabase Auth
- Row Level Security
- Supabase Realtime
- Supabase Storage for uploaded PDFs

### Code Execution
- Judge0 CE or another appropriately isolated code execution provider

### Deployment
- Vercel for the web application, if suitable
- Managed Supabase project
- Separately configured code-execution provider

Verify current SDK compatibility and provider limitations before implementation.

Prioritize free or low-cost options suitable for two users.

Do not introduce Redis, Kubernetes, message brokers, microservices, or heavyweight orchestration without a demonstrated requirement.

Where external infrastructure is required, provide setup documentation and environment-variable configuration.

Never hardcode credentials.

## 22. Database Design

Create a properly normalized schema.

Consider entities such as:

**profiles**
- id
- display_name
- role
- created_at

**questions**
- id
- title
- type
- difficulty
- topic
- tags
- status
- created_by
- created_at
- updated_at

**question_versions**
- id
- question_id
- version
- statement
- constraints
- examples
- configuration
- published_at

**mcq_options**
- id
- question_version_id
- option_text
- display_order
- correct_answer

**coding_configurations**
- id
- question_version_id
- language
- execution_mode
- function_signature
- starter_code
- template_prefix
- template_suffix
- evaluation_limits

**test_cases**
- id
- question_version_id
- input
- expected_output
- visibility
- weight
- ordering

**assessments**
- id
- title
- type
- status
- settings
- published_at

**assessment_questions**
- assessment_id
- question_version_id
- ordering
- marks

**assessment_attempts**
- id
- assessment_id
- student_id
- started_at
- submitted_at
- status
- score

**submissions**
- id
- student_id
- question_version_id
- assessment_attempt_id
- source_code or MCQ answer
- submitted_at
- evaluation_status

**code_runs**
- id
- submission_id or draft reference
- runner_job_id
- execution_status
- results
- created_at

**reviews**
- id
- submission_id
- reviewer_id
- comments
- marks
- status
- reviewed_at

**imports**
- id
- source_file
- import_status
- extraction_metadata
- created_at

**notifications**
- id
- recipient_id
- type
- reference_id
- read_at

You may optimize the schema where appropriate.

Do not blindly create all proposed tables if a simpler model provides equivalent correctness.

Important:
- Protect sensitive fields with appropriate backend boundaries.
- Do not expose correct answers or hidden tests through broad database queries.
- Configure RLS correctly.
- Use migrations.
- Preserve referential integrity.
- Track question versions and submissions.
- Prevent accidental loss of historical results.

## 23. API and Data Flow

Design clear application interfaces for:

- Authentication
- Question CRUD
- PDF/text import
- Problem publication
- Assessment retrieval
- MCQ answer autosave
- Coding draft autosave
- Run code
- Submit code
- Retrieve execution status
- Grade submissions
- Retrieve student results
- Save admin feedback
- Notifications

Validate all incoming input.

Implement server-side permission checks for every privileged action.

Use type-safe schemas and predictable errors.

The frontend must never directly obtain privileged database credentials or code-runner secrets.

## 24. Security and Reliability

Since this system executes code, treat the execution boundary as high risk.

Requirements:

1. Isolate all untrusted code execution.
2. Enforce CPU/time and memory limits.
3. Limit execution concurrency.
4. Rate-limit submissions.
5. Validate uploaded file size and type.
6. Store PDFs privately.
7. Sanitize rendered imported content.
8. Use server-side authentication.
9. Apply database RLS.
10. Keep hidden tests and answer keys private.
11. Prevent unauthorized access to submitted code and feedback.
12. Prevent duplicate final submissions on repeated clicks.
13. Handle network failures cleanly.
14. Implement retry-safe operations where necessary.
15. Preserve user drafts.
16. Prevent real-time permission leaks.
17. Avoid exposing stack traces or secrets to end users.
18. Ensure a failed code-runner request never produces a false Accepted result.

Keep the implementation proportional to a two-person application.

---

# PART I — IMPORTANT USER FLOWS

## 25. End-to-End Coding Workflow

Implement and verify this exact scenario:

**Administrator:**
1. Logs in.
2. Clicks Create Coding Problem.
3. Pastes the "Reverse Only the Letters" problem.
4. Clicks Parse.
5. Reviews the extracted fields.
6. Selects Java.
7. Selects Function-Only mode.
8. Configures the `maskCode` signature.
9. Adds or pastes the code template.
10. Configures public tests.
11. Adds verified hidden tests.
12. Validates the testing configuration.
13. Clicks Publish.

**Student:**
1. Logs in.
2. Receives the new question automatically.
3. Opens it.
4. Reads the description.
5. Finds the prepared Java method in the editor.
6. Writes the method implementation.
7. Clicks Run.
8. Sees the public test results.
9. Corrects any errors.
10. Clicks Submit.
11. Sees the permitted final evaluation result.

**Administrator:**
1. Receives the submission notification.
2. Opens the submitted solution.
3. Reviews the code.
4. Inspects test results.
5. Adds written feedback.
6. Publishes feedback.

**Student:**
1. Receives the review notification.
2. Opens the results page.
3. Reads the feedback.
4. Can review the exact code previously submitted.

Every step must work with real persisted data.

## 26. End-to-End MCQ Workflow

**Administrator:**
1. Uploads an MCQ PDF.
2. Extracts its questions.
3. Corrects any parsing errors.
4. Configures answers.
5. Selects 20 questions.
6. Creates a quiz.
7. Configures optional time limit and marking.
8. Publishes.

**Student:**
1. Sees the new quiz.
2. Opens it.
3. Answers the questions.
4. Navigates backward and forward.
5. Marks questions for review.
6. Submits the quiz.
7. Sees the result when permitted.

**Administrator:**
1. Sees the completed quiz.
2. Checks individual responses.
3. Reviews accuracy and total marks.

All data must persist across logouts, reloads, and devices.

---

# PART J — IMPLEMENTATION METHODOLOGY

## 27. Development Phases

Divide implementation into manageable phases.

### Phase 1 — Architecture and Project Setup

- Inspect environment
- Select stack
- Initialize project
- Configure database
- Define schemas
- Configure authentication
- Establish project structure
- Create environmental configuration
- Set up linting and tests

### Phase 2 — Authentication and Dashboards

- Two role-based accounts
- Route authorization
- Admin layout
- Student layout
- Shared UI primitives
- Basic dashboard navigation

### Phase 3 — Question Management

- Question bank
- Manual question creation
- Raw text imports
- PDF extraction
- Editing and preview
- Publishing
- Realtime question notifications

### Phase 4 — Coding Engine

- Monaco Editor
- Function-only templates
- Full-code templates
- Java execution provider
- Public test cases
- Hidden test cases
- Run and Submit operations
- Result processing
- Draft persistence

This is the highest-priority engineering phase.

Give it sufficient testing attention.

### Phase 5 — MCQ Engine

- MCQ editor
- Quiz creation
- MCQ importing
- Student quiz interface
- Timers if enabled
- Automatic marking
- Results

### Phase 6 — Submission Review and Analytics

- Admin submission inbox
- Code inspection
- Feedback
- Student history
- Performance metrics
- Realtime updates

### Phase 7 — Testing, Hardening and Deployment

- End-to-end tests
- Security checks
- Execution boundary validation
- Database permission checks
- Error handling
- Responsive testing
- Deployment configuration
- Documentation

Work incrementally but maintain end-to-end functionality throughout.

Do not leave disconnected UI features or nonfunctional placeholder buttons.

---

# PART K — TESTING AND QUALITY ASSURANCE

## 28. Automated Testing

Write actual tests for the critical logic.

At minimum, test:

**Authentication**
- Admin access
- Student access
- Unauthorized route access
- Incorrect permissions

**Question Import**
- Plain-text coding questions
- Multiple MCQs
- Incorrectly formatted pasted content
- Text PDF imports
- Unreadable PDFs
- Invalid files

**Coding Engine**
- Java compilation
- Valid function-body insertion
- Template immutability
- Public tests
- Hidden tests
- Correct answers
- Wrong answers
- Compilation errors
- Runtime errors
- Infinite loops/timeouts
- Failed runner requests
- Score calculations

**MCQ Engine**
- Correct answers
- Incorrect answers
- Multiple-answer scoring
- Unanswered questions
- Negative marking
- Autosaving
- Final submission

**Persistence**
- Refresh during coding
- Refresh during quiz
- Reconnection after network loss
- Previous submissions
- Draft recovery

**Realtime**
- Admin publishes question
- Student receives update
- Student submits assessment
- Admin receives notification
- Admin publishes feedback
- Student receives result

**Security**
- Student cannot read hidden tests.
- Student cannot read unreleased answer keys.
- Student cannot perform admin mutations.
- User cannot submit another person's assessment.
- Untrusted code never runs in the main web process.

Use Playwright for browser-based end-to-end testing where appropriate.

Unit-test complex grading, parsing, template composition, and permission logic.

## 29. Seed Data and Demo

Provide realistic sample data.

Include:
- The complete Reverse Only the Letters Java problem
- Several additional Java coding problems
- A small MCQ question bank
- A sample quiz
- Public and hidden test cases
- Sample submissions where useful

Seed data must be clearly identifiable and removable.

Do not use simulated values in live production dashboards.

### Example Coding Solution for Validation

The following may be used privately to validate the Reverse Only the Letters problem:

```java
public static String maskCode(String code) {
    char[] chars = code.toCharArray();
    int left = 0;
    int right = chars.length - 1;

    while (left < right) {
        if (!Character.isLetter(chars[left])) {
            left++;
        } else if (!Character.isLetter(chars[right])) {
            right--;
        } else {
            char temp = chars[left];
            chars[left] = chars[right];
            chars[right] = temp;
            left++;
            right--;
        }
    }

    return new String(chars);
}
```

Note that the provided input constraints specify ASCII letters and selected ASCII symbols. Define the intended letter semantics explicitly in the problem configuration rather than assuming all Unicode characters are permitted.

This implementation should pass all valid configured tests.

Test both the reference solution and deliberately incorrect implementations to verify grading.

---

# PART L — DELIVERY REQUIREMENTS

## 30. Definition of Done

The project is complete only when:

- Admin can log in.
- Student can log in.
- Admin can create MCQs.
- Admin can create coding problems.
- Admin can paste raw question text.
- Admin can import text-based PDFs.
- Admin can edit imported questions.
- Admin can add Java starter code.
- Admin can manage public and hidden test cases.
- Admin can publish questions.
- Student receives published questions.
- Student can answer MCQs.
- Student can write Java methods in the editor.
- Actual Java compilation and execution work through a configured runner.
- Test case evaluation produces accurate results.
- Student can submit code.
- Admin can inspect the exact submitted code.
- Admin can write feedback.
- Student can see released feedback.
- Data persists in the database.
- Permission controls are enforced.
- All primary user flows are tested.
- Application can be run locally with documented prerequisites.

A visually complete website with fake backend functionality does NOT meet this definition.

If external service credentials are unavailable, fully implement the integration and clearly identify the blocked live verification steps.

Do not claim successful real execution without having tested a real execution provider.

## 31. Deliverables

Provide:

1. Complete source code.
2. Database schema and migrations.
3. Authentication and role configuration.
4. Functional admin dashboard.
5. Functional student dashboard.
6. Coding execution implementation.
7. MCQ assessment implementation.
8. PDF and text import functionality.
9. Realtime synchronization.
10. Automated tests.
11. A usable README.
12. `.env.example`.
13. Local setup instructions.
14. Deployment instructions.
15. Required external-service configuration.
16. Known limitations.
17. Final verification checklist.

Do not create unnecessary documentation files or long technical reports without practical value.

Use concise documentation that helps operate and maintain the project.

## 32. Final Engineering Instructions

Treat this as a real software product, despite its small user base.

Prioritize functionality in this order:

1. Reliable coding assessment and evaluation
2. Simple admin question creation
3. Real-time publishing and synchronization
4. MCQ examination functionality
5. Persistent student submissions
6. Admin review and feedback
7. Clean, practical UI
8. Progress tracking and optional enhancements

Do not build unnecessary advanced features before the core workflows function.

Avoid:
- Mock execution logic
- Fake progress statistics
- UI-only functionality
- Hardcoded sample assessments as the sole source of data
- Exposing hidden tests
- Overengineered infrastructure
- Unnecessary subscriptions
- Overly complicated configuration
- Unverified feature-completion claims

Make the platform comfortable for daily practice.

The key experience should be:

**Administrator pastes or uploads a question → reviews its configuration → publishes it → student receives it → solves it → runs or submits it → system evaluates it → administrator reviews the solution and provides feedback.**

Build the entire workflow, verify it, and leave the system in a deployable and maintainable state.

**Begin by inspecting the environment, presenting your recommended architecture, and asking only the essential product questions before implementation.**