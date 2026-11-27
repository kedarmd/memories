# Memories — Sequential Implementation Plan

**Status:** Proposed execution plan (review before creating GitHub Issues)  
**Source of product requirements:** [PRD](PRD.md)  
**Source of proposed design:** [Architecture](ARCHITECTURE.md)  
**Feasibility protocol:** [Spike Plan](SPIKE_PLAN.md)  
**Working agreement:** [Engineering Principles](ENGINEERING_PRINCIPLES.md) and [AGENTS.md](../AGENTS.md)

## 1. Intent and sources of truth

Build Memories as one reviewable capability at a time. This roadmap defines **order, dependencies, and decision gates**; the PRD defines required outcomes; the architecture describes the current proposed approach; GitHub Issues define **the currently approved unit of work**; PRs hold implementation and verification evidence.

Do not duplicate an issue's evolving progress in this roadmap. Record progress in GitHub Issues/PRs. Update this document only when sequencing, scope, or a decision gate changes. Future work below is **provisional**, not permission to implement it.

A task is a coherent outcome that can be implemented, verified, and manually reviewed in one PR, including its tests and documentation. Avoid trivial issues for individual functions/tables, but split a task if it contains independently risky outcomes or its diff becomes difficult to review.

## 2. Serial execution contract

1. **Plan:** Create a GitHub Issue from the feasibility or implementation template. Cite the relevant document sections, dependencies, scope exclusions, and observable acceptance criteria.
2. **Approve:** The owner selects **one** issue to work on and approves the scope. An issue existing in GitHub is not automatically authorization to start it.
3. **Implement:** Codex uses `gh` to fetch the issue and PR state; verifies prerequisites; works on a dedicated branch; implements only the approved issue.
4. **Verify:** Run appropriate tests and manual experiments; attach reproducible, sanitized evidence; make limitations and untested cases explicit.
5. **Review:** Open one PR referring to that issue and use the PR template. While this PR is being reviewed or revised, do not start another implementation task.
6. **Merge:** The owner decides whether to merge. Only after that merge and issue acceptance may the next issue be approved. Codex must not auto-merge, self-approve, or silently rewrite the issue scope.
7. **Adapt:** If evidence contradicts architecture or a prerequisite, record the finding and obtain a new decision before proceeding. Amend the issue or roadmap through review; do not hide changes inside code.

A single active implementation task applies **globally to the repository**, across milestones. Research required to clarify that active task is allowed; starting a separate future task in parallel is not. The owner can explicitly authorize a deviation, but the default is strict serial execution.

GitHub provides an audit trail, not a hard concurrency lock. `AGENTS.md` is advisory, not an access-control mechanism; use branch protection and permissions if enforcement is required.

## 3. Issue/PR sizing and completion

**Good size:** one demonstrable workflow, integration capability, or bounded experiment that a human can understand from one PR.

**Too small:** only create one interface/table/function without an independent review result.

**Too large:** capture + extraction + retrieval + UI in a single PR; or a diff whose evidence cannot be reviewed together.

Each issue must specify an outcome, scope, non-goals, prerequisite merged issues, acceptance criteria, reproducible validation, and deliverables. A spike additionally specifies its hypothesis and pass/fail/inconclusive decision. Do not declare a spike passed from documentation review alone; a negative result is acceptable if its evidence and fallback are explicit.

A PR is complete only when acceptance evidence is reviewable, failures are reported, and any required documents are updated. Do **not** infer success merely from code compiling or the existence of a GitHub merge. Use `Refs #N` rather than an automatic issue-closing keyword until the owner confirms the acceptance check.

## 4. Milestone F — Feasibility experiments (detail these issues first)

These five tasks follow the experiments in [SPIKE_PLAN.md](SPIKE_PLAN.md). Create only these issue drafts after the plan is reviewed; activate them **in order**. If a failure blocks the next task, revise the approach rather than continuing the sequence mechanically.

| Order | Candidate issue | Depends on | Reviewable output and acceptance gate |
| --- | --- | --- | --- |
| F1 | **Session capture capabilities — Codex and OpenCode** | Foundation PR merged | Reproducible event/session-access probes in each harness; versions and environment captured; sanitized event evidence; lifecycle/compaction/crash coverage matrix; distinguish confirmed vs unsupported access; no claim of universal transcript capture. |
| F2 | **Isolated headless memory extraction** | F1 findings accepted | Bounded input and normalized checkpoint contract, independent subprocess experiment, Zod-validated proposals with provenance/uncertainty, repeat/failure cases, repo remains unchanged, no recursive capture; explicit fallback for missing source data. |
| F3 | **Cross-agent task continuation** | F1 + F2 accepted | Minimal persistent checkpoint/task association and explicit retrieval integration; reproducible work-in-Codex → continue-in-OpenCode demonstration without copying original chat; measure omissions and irrelevant context. Reusing a tiny SQLite fixture is allowed; no production-grade service. |
| F4 | **Scoped lexical retrieval benchmark** | F3 minimal memory records | SQLite/FTS5 fixture with active, unrelated, superseded, and paraphrased cases; labeled expected hits, reproducible ranking/precision/recall checks, citation and task-isolation tests; documented gaps and vector-search decision, not embeddings implementation. |
| F5 | **Single on-demand core and worker coordination** | F2 + F3 contract, F4 if needed | Two simultaneous MCP/CLI callers reuse one core, at most one AI-intensive worker, reads remain responsive, durable checkpoints survive crashes, stale-startup recovery and idle exit demonstrated; report OS-specific uncertainties. |

**F1 scope explicitly excludes:** full transcript ingestion, production database schema, full plugin framework, service lifecycle, UI, and the memory extraction engine.

**F2 scope explicitly excludes:** broad document generation, complete task lifecycle and full project refresh. Keep the extractor read-only with verifiable filesystem checks, not prompts alone.

**F3 scope explicitly excludes:** automatic task inference, complete agent onboarding, UI and polished memory search.

**F4 scope explicitly excludes:** embedding indexes, vector infrastructure, AI relevance adjudication per query.

**F5 scope explicitly excludes:** full production packaging and broad cross-platform certification.

**Feasibility gate (F6, review decision; not necessarily a code issue):** Consolidate the recommendation in `docs/FEASIBILITY_DECISION.md`; preserve `docs/SPIKE_RESULTS.md` as the historical experiment record; record verified capabilities, failed assumptions, security/privacy conditions, and resulting changes to `docs/ARCHITECTURE.md`. Owner approves go/no-go or revised scope before V1 implementation. Do not label this gate complete simply because F1–F5 PRs merged.

**F6 recommendation:** See [FEASIBILITY_DECISION.md](FEASIBILITY_DECISION.md). The proposed outcome is CONDITIONAL GO only for a narrow explicit continuity slice, subject to owner decision and separate issue approval. V1 topology is one user-level data root/database/core; F5 did not validate that topology. Real MCP interoperability and multi-project isolation are first-slice gates.

## 5. Provisional V1 implementation backlog (do not create detailed issues yet)

The ordering is a working hypothesis, **not a frozen implementation specification**. Refine it using F1–F5 evidence and the [PRD acceptance criteria](PRD.md#7-v1-acceptance-criteria). Some areas may need merging or splitting to keep PRs human-reviewable.

### M1 — Core continuity (reordered by F6 recommendation; provisional)

- **First slice — continuity contract and real client proof:** establish the user-level data root and shared core; expose the minimum explicit task-create/associate, durable attributed checkpoint update, and source-linked load operations to CLI and real MCP clients. Prove two MCP clients plus CLI share one core, with multi-project/task isolation, protocol lifecycle/error behavior, and restart durability. Keep one reviewable issue; do not create it until F6 is accepted.
- **Next, only after first-slice review:** complete the Drizzle schema/migrations and stable project/workspace registry needed by observed workflow; harden idempotency, provenance, lifecycle/freshness, and scoped SQL/FTS5 retrieval against labeled quality gates. Split into separate issues only when reviewably independent and approved serially.

### M2 — Capture and knowledge maintenance (provisional; gated on continuity)

- **M2.1** Durable single-worker queue and configurable headless executor with recovery and accurate job status.
- **M2.2** Verified harness-specific capture integration and compact/continuation skill, with coverage/fallback documentation.
- **M2.3** Explicit Git-aware read-only refresh and current-state documentation generation with traceable citations.
- **M2.4** Memory reconciliation, freshness, supersession rules, and review-required conflict persistence.

### M3 — Local developer experience and release (provisional; runtime/MCP contract first)

- **M3.1** Global CLI and explicit skills/integration installer plus secure on-demand local service packaging.
- **M3.2** React/Vite project/task/checkpoint explorer and read-only documentation browser with FTS5 search.
- **M3.3** Memory-only temporary chat, developer conflict review UI, and integrated release validation.

Expect to revise these candidate chunks after the feasibility gate and first-slice evidence. The final V1 must validate cross-project isolation, concurrent sessions, privacy boundaries, failures, and real cross-agent continuation. Real MCP interoperability is brought forward into the first slice rather than deferred to late packaging. These are acceptance gates across tasks, not optional cleanup.

## 6. Scope boundaries

**Included when justified by milestones:** cross-agent memory continuity; explicitly invoked skills; evidence-aware checkpointing and capture; SQLite and lexical retrieval; current technical documentation; simple local CLI/UI; safe and observable background work.

**Deferred:** vectors/embeddings, interactive knowledge graph, sophisticated automatic task inference, team/cloud sync, persistent chat, per-project executor override, generic adapter marketplace, automatic Git watchers, documentation version archive.

Do not interpret a deferred item as an implied prerequisite. Add it only after a documented failure of the simpler design and owner approval.

## 7. Codex + GitHub CLI operating procedure

When the owner says "Implement issue #N":

1. Run `gh auth status` (do not disclose tokens), `gh repo view`, `gh issue view N --json title,body,state,labels`, and inspect open PRs; stop if repository identity/permission is wrong.
2. Read this plan, the issue, and relevant repository docs; verify that dependencies have been **merged**, not merely opened.
3. Confirm that the issue is approved/current and no unrelated implementation PR is in progress; if ambiguous, ask before editing.
4. Use a dedicated branch off updated `main`. Limit code/docs to the issue. Do not implement future milestones opportunistically.
5. Run the exact agreed checks and collect sanitized test evidence. Never silently skip a test; state why it wasn't run.
6. Open a PR with `gh pr create --body-file ...` following the PR template, referencing the issue without premature auto-closure.
7. Report PR URL, changed behavior, evidence, risks, and gaps. Stop. No autonomous merge or next-issue start.

Use `gh issue create --body-file ...` when Codex creates approved issue drafts programmatically; Issue Forms are for UI entry, and CLI-created Markdown issues must contain the same fields. Avoid creating issue dependencies by guessing their numbers before GitHub assigns them.

## 8. Decision log and review gates

- **Approved foundation:** Agent-agnostic modular monolith, local SQLite/FTS5, explicit retrieval, hybrid capture with verified adapter coverage, single headless worker, sequential owner review.
- **Experimental:** Native session data availability, read-only isolated extraction, cross-agent continuation fidelity, retrieval quality, shared-core coordination.
- **Deferred pending measured need:** Embeddings, interactive graph, advanced auto-task inference and broad adapter support.

After the feasibility gate, update this roadmap and the architecture where experiments require it. Retain a traceable rationale for major decisions. The owner controls final scope and merges.
