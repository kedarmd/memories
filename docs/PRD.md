# Memories — Product Requirements Document

**Status:** Draft for owner review  
**Target:** V1 (single-developer, local-first)  
**Product:** Memories  
**CLI:** `memories`  
**Priority:** Prove reliable, useful continuity before expanding features.

## 1. Product definition

Memories is a local-first, agent-agnostic knowledge layer for software development. It preserves relevant project and task knowledge across coding sessions and across coding harnesses, while allowing developers to inspect that knowledge in a browser.

**Product promise:** Change coding agents or start a fresh session without having to reconstruct the reasoning and progress of previous work.

**Experience principle:** Powerful underneath; effortless on the surface. Reduce unnecessary interaction, not functionality or correctness.

## 2. Target user and deployment

- One developer per installation in V1, but many registered projects and concurrent coding sessions.
- Installed once on a machine through npm; repositories are registered explicitly with the CLI.
- One shared on-demand local core serves CLI clients, MCP connections, and the browser UI. No permanently running daemon is required.
- One globally selected headless coding executor for application-initiated AI work, configurable at setup and changeable later. It is independent of the agent used for day-to-day coding.
- The application is designed for Linux, macOS, and Windows; supported/tested platforms must be declared based on actual verification, not assumed.
- No cloud account or hosted Memories service. A configured coding agent or external issue provider may require a network connection; the user should know when data is sent outside the machine.

## 3. Scope and workflows

### 3.1 Register a project

`memories init` registers a Git repository with a stable internal project ID. It does **not** silently edit `AGENTS.md`, install skills, or configure coding agents. CLI operations for configuring each integration and installing skills are explicit and idempotent. Existing files must not be overwritten without permission.

Different worktrees/checkouts of a logical repository can map to one project while retaining separate workspace and commit provenance. Project isolation is enforced for all queries and jobs.

### 3.2 Create a development task

The developer explicitly invokes `/memories-task-create`, optionally supplying an external issue or ticket reference. The active coding agent, **if already authorized and capable**, fetches relevant details from GitHub, Jira, or another provider; otherwise the developer supplies an objective directly. Memories accepts a normalized task description without depending on any issue-tracker-specific integration.

The service creates or reuses a stable internal task ID, records external references, and links the active session to the task. It then retrieves relevant **project-level** context even if no task history or code changes exist. Repeating the command for the same external reference and project must not create duplicate tasks.

A session can exist without a task. It has at most one **active** task association at a time, which can be changed explicitly. A Git branch is a task-identification hint, not a task ID. When association is ambiguous, ask the developer instead of guessing.

### 3.3 Load existing knowledge

`/memories-load` is an **explicit** developer-triggered action, not automatic historical-memory injection. It identifies the registered project and intended task, gathers applicable current project documentation and relevant task checkpoints, filters and ranks them, and delivers a compact, evidence-linked briefing to the active coding session.

Loading an existing task may include checkpoints from other sessions and other coding agents. The service must not automatically inject unrelated task/branch histories. Normal retrieval excludes superseded and invalidated knowledge; historical lookups may explicitly include it. Context is adaptive rather than governed by one rigid token count. If task identity is ambiguous, ask the user.

### 3.4 Capture and update memory

- Capture uses a **hybrid** strategy: explicit agent checkpoints plus optional native lifecycle events where integrations demonstrably support them.
- `/memories-update` triggers the existing checkpoint/extraction pipeline immediately, without requiring the developer to specify each change.
- The main coding agent performs minimal handoff work. A single isolated, globally configured headless executor performs AI-intensive extraction, reconciliation, and document generation.
- Session checkpoints are durable before the service claims they are saved. Queued extraction is not reported as completed extraction.
- Capture and extraction are incremental and idempotent where feasible; a missed lifecycle event must not silently be represented as complete capture.
- Failures leave recoverable checkpoints. The user can inspect pending, failed, and completed work.

### 3.5 Compact/continue a long session

`/memories-compact` captures any outstanding session knowledge, ensures the continuation checkpoint is persisted, and prepares a usable compact task briefing. The guaranteed portable path is starting a **fresh agent session** and invoking `/memories-load` for that task. Native in-place context compaction is an optional harness capability and must not be promised universally. Never discard context before a usable checkpoint exists.

### 3.6 Refresh project knowledge

`/memories-refresh` and an explicit UI refresh action request repository-wide knowledge reconciliation. The initial refresh examines the repository; later refreshes use Git commit evidence to narrow analysis where safe. The scan must be read-only with respect to the repository.

- Track the configured primary branch and last successfully verified Git checkpoint; branch names, merge methods, rebases, and worktrees require careful handling.
- No silent scans merely because the UI is opened or a coding agent encounters stale knowledge.
- A coding agent encountering potentially stale **historical** knowledge may recommend an explicit refresh; it should not launch one autonomously.
- When the active coding agent itself implements changes, the normal checkpoint/extraction pipeline **does** capture those changes automatically. This is not a repository-wide refresh.
- Clear, evidenced changes integrated into the primary branch may automatically reconcile current project knowledge. Ambiguous or contradictory interpretations create review items; a merge is evidence of integration, not automatic proof that a decision is obsolete.

### 3.7 Browse and understand project knowledge

The local browser UI opens independently of coding sessions and can start/connect to the shared on-demand core. The landing view is a restrained project list/overview. Within a project, developers can:

- Browse **read-only, current-state** technical documentation, organized into a navigable hierarchy.
- Run traditional full-text search over documentation and applicable memories without an LLM call.
- View tasks, associated sessions/checkpoints, provenance, freshness warnings, extraction/refresh status, and conflict review items.
- Ask questions through a **temporary, memory-only** chat. Chat can use the configured headless executor to synthesize answers from stored memories and must not silently inspect source code. Unanswered questions and missing evidence must be called out.
- Start explicit project refresh, and review ambiguous memory conflicts in the UI.

Project documents are **updated in place** to reflect current verified implementation, not versioned as historical document archives. Task memories and decision records retain the development history. Documents carry source citations and last-verified commit/freshness metadata. Direct manual editing of docs in the UI is out of scope for V1.

A separate interactive knowledge graph and embedded Mermaid/other diagrams are **deferred**. Preserve useful relationships and stable document/entity IDs so a future graph can link to documentation without redesigning storage.

## 4. Memory model and trust

Distinguish two knowledge forms:

1. **Project knowledge:** coherent, structured technical documentation of current architecture, modules, conventions, integrations, and business logic.
2. **Task/session knowledge:** focused checkpoints, decisions, outcomes, failed approaches, blockers, and progress that preserve context across work sessions.

Persist current memory lifecycle (`active`, `superseded`, `invalidated`) separately from freshness and verification status. Historical memories are retained unless explicitly removed under a user-approved policy. Newer timestamp alone does not imply correctness.

**Citation requirement:** Important claims in memories and generated documents have traceable evidence where available: repository/file/commit and line/section location, session/checkpoint, or external ticket/document. Citations are structured metadata associated with claims or document sections. Never invent sources; missing or stale evidence must be visibly marked. Developer approval is not the same as code-level verification.

Project documentation is mutable current-state knowledge; its replacement must be atomic and evidence-informed. Do not silently overwrite important decisions on ambiguous evidence.

## 5. Retrieval and search

V1 uses one SQLite database, conventional relational filters/relationships, and FTS5 lexical search. Prioritize correct project/task applicability, lifecycle, source trust, and deduplication. Handle stale records with warnings instead of unconditionally deleting them or blocking work. Provide relevant sections rather than dumping entire documents.

**No vector index or embedding-model requirement in the initial V1.** The retrieval interface must allow later semantic candidates without changing consumers. No mandatory LLM relevance judge on every request. Evaluate differently worded queries against real fixtures; add embeddings only if measured recall problems justify their operational cost.

User-triggered UI search is not coding-session context injection; `/memories-load` is explicit. Chat answers may use the configured model but are grounded only in stored knowledge.

## 6. Experience and non-functional requirements

- One obvious path for routine operations; no avoidable wizardry or repeated prompts.
- Skills must complete their responsibility reliably, not terminate early merely to appear minimal. Report persisted vs queued vs completed accurately.
- Quiet successful defaults, clear failure/ambiguity indicators, inspectable supporting details.
- Minimal, modern, dark-first developer UI; typographic clarity, keyboard accessibility, no gratuitous metrics or animations.
- Normal reads and task lookup must remain responsive while a headless job runs.
- No unapproved repository modifications; explicit setup commands and refresh operations.
- Source data is local by default; make remote-model exposure, secrets, and retention configurable/transparent.

## 7. V1 acceptance criteria

1. A developer globally installs Memories, explicitly registers two projects, and connects a compatible coding harness without accidental project file changes.
2. Multiple concurrent sessions/agents access one core, with project and task scope isolation, and without a second headless worker being launched.
3. A developer creates a task from an issue or description before any code changes and receives useful existing project context.
4. A checkpoint in one coding agent is retrievable in another without copying native conversation history.
5. `/memories-update` durably saves a checkpoint; extraction reports actual completion and preserves evidence.
6. `/memories-compact` produces a valid continuation checkpoint for a fresh session; session loss does not erase persisted work.
7. Project refresh produces current, cited documentation; incremental refresh avoids unnecessary scans without claiming false freshness.
8. Normal retrieval omits unrelated or invalidated knowledge, explains staleness, and does not invent citations.
9. A developer can browse/search current project docs, inspect task progress, use temporary grounded chat, and review ambiguous changes without running a coding agent.
10. Real-world, repeatable tests show continuity and acceptable precision; unsupported harness capabilities are reported rather than assumed.

## 8. Deferred features

Vector/embedding search; interactive knowledge graph and in-document diagrams; sophisticated automated task inference; team server, multi-user permissions, cloud sync, GitHub Actions publishing; per-project headless-agent overrides; document-history UI; persistent chat sessions; extensive automatic adapters for every coding harness.

## 9. Open questions reserved for feasibility validation

Exact access to live/native session data in each harness; ability to run reliable headless extraction without code mutation; cross-platform on-demand core startup and process coordination; citation/line-range validity across commits; incremental Git refresh safety; safe local retention and redaction of captured session events.