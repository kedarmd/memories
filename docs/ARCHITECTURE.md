# Memories — V1 Technical Architecture

**Status:** Proposed architecture, subject to feasibility spike outcomes.  
**Guiding rule:** Agent-agnostic core; harness integration at the edges.

## 1. Shape of the application

Memories is a **globally installed local application**, not a per-project npm dependency or hosted SaaS. It exposes a CLI, an MCP-facing integration surface, a local browser UI, and a single shared core. Its backend serves built React/Vite static assets and local APIs from the same application process.

```text
coding harness A ─ stdio/adapter ┐
coding harness B ─ stdio/adapter ├── local shared core ── SQLite (+ FTS5)
CLI ──────────────────────────────┤         │
Browser UI ─ local HTTP/API ──────┘         └── durable job queue ── 1 headless executor
```

Multiple lightweight MCP adapters/processes are acceptable, but **one coordinated core and at most one AI-intensive headless job** should run per user installation. Connectivity, session discovery, lifecycle capture, and skill installation must not leak harness-specific assumptions into the core.

## 2. Technology choices

- Node.js LTS and strict TypeScript.
- SQLite as the **only database**; Drizzle for relational schema and migrations; FTS5 for lexical search.
- Zod for validation at trust boundaries including AI-produced structured output.
- Effect for orchestration, explicit errors, service lifetimes, cancellation, bounded retries, and worker concurrency. Do not duplicate Zod schemas with Effect Schema without a specific need.
- MCP for standardized coding-agent operations, alongside a local HTTP API for the UI and CLI-facing application services.
- React SPA + Vite + Tailwind CSS + shadcn/ui + Lucide. The backend serves the production UI. No SSR. Keep routing and API cache libraries optional until justified.
- A separately configurable **global default headless coding executor** for application-initiated model work. No per-project override in V1.

Effect makes workflow behavior explicit and testable; it does **not** make LLM reasoning deterministic.

## 3. Modules and boundaries

Suggested logical modules (modular monolith; not microservices):

| Module | Owns | Must not own |
|---|---|---|
| Project/workspace registry | Stable IDs, repo roots, worktrees, primary branch | Harness-specific parsing |
| Task/session registry | Stable task/session IDs and associations | External issue authentication |
| Knowledge store | Current docs, task memories, checkpoints, provenance, freshness | LLM prompt construction |
| Retrieval | Scoped SQL/FTS5, deduplication, evidence packaging | Agent-specific tool syntax |
| Job coordinator | Durable jobs, single-worker arbitration, cancellation/retry | Git mutation |
| Extraction/reconciliation | Structured proposals, evidence linkage, doc maintenance | Direct unvalidated DB writes |
| Git evidence | Read-only diffs, ancestry/commit/source checking | Project memory authority by itself |
| MCP/agent adapters | Harness integration, capability detection, event normalization | Core storage logic |
| UI/API | Read-only explorer, search, chat, job/review status | Duplicate business rules |
| CLI/setup | Global config, project registration, explicit integration installation | Automatic modification of repo files during init |

Start with simple interfaces and cohesive modules; don't implement a generic plugin runtime before needed.

## 4. Identifiers and scope

- **Project:** stable Memories-issued ID. Git remotes and paths are hints; worktrees and directory renames must not silently split or merge projects.
- **Workspace:** a checkout/worktree and its current Git state. Store path, branch name (display hint), relevant commit SHA, and dirty-state signals where available.
- **Session:** a harness session, mapped to a stable internal ID and recorded with source-agent metadata. The session may exist without a task.
- **Task:** stable Memories ID, optional external issue provider/key/URL and objective. A session has at most one *active task association* at a time, but may have task history across checkpoints.

For an explicit task-create operation, an agent with authorized issue access may fetch and normalize task details; the core accepts provider-independent data. Branch matching is a hint. Ask on ambiguous matches. No automatic context injection on session startup.

Project documents on the primary branch represent current verified shared knowledge. Branch-specific observations remain traceable to their workspace/commit. The UI can show all branches with tags; routine agent retrieval stays task-centric and current-workspace aware.

## 5. Storage model (conceptual, not final DDL)

All durable records live in **one SQLite database** in a user-level application data directory. Candidate tables:

- `projects`, `workspaces`, `repository_aliases`
- `sessions`, `tasks`, `session_task_associations`
- `session_events` (only events available and approved for capture), `checkpoints`
- `memories` (current memory identity/content/scope/status), `memory_sources`, `memory_relations`
- `project_documents`, `document_sections`, `section_sources`
- `jobs`, `job_attempts`, `pending_reviews`
- FTS5 virtual tables/indexes over appropriate memory/document-section text.

**Project documents:** current-state, structured Markdown content (potentially assembled from individually identified sections); updated in place with transactional replacement; no historical document-version archive in V1. Keep verified commit and freshness metadata.

**Task memories:** focused records plus durable checkpoints. Keep historical decisions and supersession chains. Large raw transcripts are not automatically permanent knowledge; capture/retention policy must be validated and disclosed. Do not assume every harness can export the full transcript.

**Sources/citations:** first-class references to file/repository/commit and line/section when verifiable, session event/checkpoint, or external issue/document. Support many-to-many references; never fabricate missing citations. Preserve source confidence/freshness separately from the user's review status.

Use SQLite WAL, foreign keys, indexed scopes, short transactions, and a busy timeout. Heavy inference and repository scanning occur outside DB transactions. Persist job/checkpoint state before acknowledging it.

## 6. Retrieval design

1. Resolve an explicit project and (when appropriate) task/workspace; never use the last visited project as a default for server-side job scope.
2. Select eligible active memories/current documents with relational constraints. Historical retrieval is opt-in. Warn about applicable potentially stale records.
3. Retrieve candidates via SQLite FTS5 and direct task/document relationships.
4. Deterministically rank eligible results by relevance, scoped associations, authority/evidence, and freshness; deduplicate.
5. Return a compact context packet with source references and sufficient context, rather than every matching memory. Allow progressively refined lookup.

**No mandatory embeddings in V1.** Build a search-provider boundary so semantic/vector candidates can be introduced if benchmark results justify them. Do not automatically spawn an AI ranking agent on every retrieval.

The UI's simple search is deterministic and no-LLM. Memory-only chat can call the global executor to synthesize sourced answers from retrieved records; it cannot inspect the repository.

## 7. Capture, skills, and execution contract

| Skill | Frontend behavior | Background behavior |
|---|---|---|
| `/memories-task-create` | Resolve/import objective; create/reuse task; link session; return relevant project context | None required for deterministic path |
| `/memories-load` | Retrieve/filter/deliver task and project context | None required for deterministic path |
| `/memories-update` | Persist a checkpoint and report durable receipt | Queue extraction/reconciliation via shared worker |
| `/memories-compact` | Ensure a durable and usable continuation checkpoint/briefing before success | May use isolated extraction to generate it; native in-place compaction is optional |
| `/memories-refresh` | Explicitly request refresh and report queued/running/completed accurately | Headless read-only Git-aware repository scan and document reconciliation |

**Automatic capture:** Attempt checkpoints using existing agent instructions and native lifecycle events where supported. Per-adapter coverage is a measured capability, not a universal guarantee. A foreground coding agent may supply structured current-session checkpoints if its raw conversation cannot be accessed.

**Single-worker policy:** normal HTTP/MCP retrieval and checkpoint writes remain concurrent. AI-intensive extraction and refresh jobs share one durable, serialized queue. Never launch duplicate workers from multiple MCP adapters or re-capture the memory executor's own sessions.

**Completeness:** `saved`, `queued`, `running`, `verified`, `completed`, `failed`, and `review_required` must not be conflated in user-visible states. A queued extraction is not a completed memory update. Compact only reports success when a continuation artifact is usable.

## 8. Knowledge reconciliation and Git

- The configured primary branch is the default source for current project-wide implementation knowledge.
- A merge/squash/fast-forward into that branch establishes integration evidence, **not** universal truth about the semantics of the change.
- Automatic supersession is allowed when evidence establishes a clear replacement, with traceable sources. Uncertain, conflicting, or partial changes become UI review items.
- Project documentation reflects current verified state, updated transactionally; historical reasoning stays in task/decision memories.
- Distinguish active/superseded/invalidated lifecycle from verified/potentially-stale/unverified freshness and confidence.
- `memories-refresh` is explicit. No always-on Git watchers or surprise repository scans. If the currently active development session changes code, normal checkpoint extraction can capture that without requesting a separate refresh.
- Refresh analysis must be read-only with respect to the repository. Never advance the success checkpoint after a failed or incomplete refresh.
- When an old memory appears stale, return a warning. The coding agent may suggest explicit refresh, but does not autonomously trigger it.

## 9. Runtime and packaging

- One machine-wide `memories` installation provides CLI and built frontend assets.
- `memories init` registers a repo only; other explicit commands install skills or integration instructions, preserve existing files, and avoid duplicates.
- A local UI command can start/connect to the core without any coding agent running.
- On-demand startup must coordinate simultaneous callers, re-use the existing core, handle stale locks/crashes, and stay alive while clients or pending jobs require it. Shut down when idle with no outstanding work. Exact IPC/HTTP port/locking strategy is a spike outcome.
- The core and database stay usable if the default headless agent is unavailable; AI-dependent jobs show actionable errors, without silently switching providers.
- Respect project isolation on every request and every background job. Limit local network exposure; authenticate/authorize local API access as justified by the host threat model. Never assume localhost alone solves all security concerns.

## 10. Explicitly deferred

Separate vector database; embedding service/model distribution; graph DB; interactive graph/Mermaid UI; SSR/full-stack React framework; remote team server; background Git watcher; generic plugin marketplace; persistent developer-chat history; per-project headless executor selection; fully automatic cross-harness session capture guarantee.

## 11. Design uncertainties to test before freezing interfaces

Lifecycle events and content access in supported harnesses; headless executor command and non-interactive permissions; secure session redaction and retention; code citation verification across commits; cross-platform single-instance service coordination; performance and quality of FTS5 retrieval; mixed branch/worktree correctness.