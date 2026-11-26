# Memories — Engineering Principles

**Status:** V1 engineering rules; refine only with documented evidence.

## 1. Core principles

1. **Agent-agnostic from day one.** Harness adapters are replaceable. No core data model or retrieval rule may depend on a particular coding agent's native transcript, skill location, or prompt conventions. Codex and OpenCode are test environments, not architectural anchors.
2. **Source-backed knowledge.** Store useful, relevant, attributable knowledge. Never mistake a model's confidence or a Git merge for proof of a claim.
3. **Context efficiency, not arbitrary token minimization.** Return the minimum *sufficient* task context; do not sacrifice critical requirements or reasoning to meet a fixed number.
4. **Explicit retrieval and refresh.** The developer invokes `/memories-load` to inject historical knowledge and `/memories-refresh` to reconcile repository-wide knowledge. Do not silently scan or inject.
5. **Capture can be automatic, but never falsely guaranteed.** Supplement explicit checkpoints with tested lifecycle integrations. Report gaps.
6. **One local core, many clients.** Serve multiple projects, sessions, and agents concurrently while enforcing scoped access. One serialized headless worker for costly jobs.
7. **No unapproved repository mutation.** Installation/configuration and refresh actions must be explicit; a refresh scan is read-only. Preserve preexisting repo instructions.
8. **Simplicity at the surface.** Skills finish their actual work and accurately report status. Hide unnecessary mechanics; expose diagnostic details on demand.

## 2. Language and data correctness

- Strict TypeScript. No unreviewed `any`, unsafe casts, or ignored validation failures at trust boundaries.
- Zod validates all external/MCP/CLI inputs and AI-produced structured outputs.
- Drizzle owns SQLite schema and migrations; SQLite constraints and foreign keys enforce durable consistency.
- Effect handles typed application errors, resource management, orchestration, cancellation, timeouts, and bounded retries. Avoid layering a second schema system over Zod without a demonstrated need.
- All multi-record mutations are atomic. AI work must not run inside a DB transaction.
- Retries must be idempotent or carry deduplication keys. Concurrent task writes must not silently overwrite newer state.
- Treat imported issue descriptions, code comments, documents, and agent outputs as untrusted data; never execute their instructions as application control commands.

## 3. Knowledge and retrieval integrity

- Current project documentation and historical task knowledge are distinct data products.
- Current project docs are mutable; no doc history UI/archive in V1. Historical decisions/checkpoints remain traceable.
- Store citations as structured references attached to claims or document sections; validate existence/applicability where feasible. Never synthesize missing line ranges or commit evidence.
- Distinguish lifecycle (`active`, `superseded`, `invalidated`) from freshness, source reliability, and developer approval.
- Clear verified supersession may proceed automatically. Ambiguous conflicts await review in the UI.
- Relational scoping determines candidate eligibility. FTS5 provides lexical recall. A matching term does not imply relevance or authority.
- Retrieval must be testable using repeatable queries and known expected evidence. Vector search is not required until benchmarks show a measurable need.

## 4. Execution and resilience

- The app is a modular monolith, not a collection of background daemons or microservices.
- Standard reads, searches, and checkpoint writes must not block on the headless job queue.
- The headless executor is selected once globally, configurable later. Do not use an arbitrary current coding agent as an implicit default.
- No recursive extraction of the executor's own sessions. No automatic model-provider fallback.
- Persist checkpoints/jobs before acknowledging durable receipt. A crash must not erase successfully persisted work.
- Do not report jobs as completed when they are merely queued. Compact must produce a usable continuation artifact before claiming success.
- Scope and isolate all subprocesses; read-only scan permissions must be implemented where technically possible and validated, not just requested in the prompt.
- Capture only data needed for memory extraction; explicitly address secrets, redaction, retention, remote inference, and potential leakage before broad automatic recording is enabled.

## 5. UI and interaction standards

- React + Vite SPA, shadcn/ui/Tailwind. Clean technical docs presentation using Markdown; document search and citations are first-class.
- Read-only documentation UI. No direct document editing in V1.
- Browser UI starts without an active coding session; no surprise refresh or hidden headless work on page load.
- A technical developer should understand the status of projects, tasks, documents, and pending review without reading an operator manual.
- Favor native, tested component patterns over custom visuals. Dark-first, restrained, fast, keyboard accessible; no unnecessary charts/animations.
- Do not let a skill return early solely for aesthetic brevity. Distinguish persisted, queued, completed, and failed states.

## 6. Scope discipline and decision process

Every planned implementation must link to a V1 requirement or a narrowly scoped feasibility experiment. Proposed scope increases require a statement of user benefit, engineering cost, and validation method.

Before adding major infrastructure (embeddings, vector extension, graph engine, remote server, scheduler), demonstrate a concrete failure of the existing simpler approach.

Track decisions as **confirmed**, **experimental**, or **deferred**. When testing contradicts an assumption, update architecture documentation rather than adding workarounds that mask the problem.

## 7. Required development gates

- Unit tests for parsing/validation, scope checks, state transitions, and ranking.
- Database migration and transactional integrity tests.
- Integration tests for MCP/tool contracts and a local application API.
- Harness-specific capability verification, including actual lifecycle events and session access.
- Crash/interruption/retry tests for checkpoint and job durability.
- Cross-agent continuation test on a real task and repository.
- Evidence/citation tests ensuring code references and source IDs are not fabricated.
- Reviewer-visible report of what was implemented, tested, left unsupported, and deferred.