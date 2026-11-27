# F6 — V1 Feasibility Decision

**Status:** Recommendation for owner decision; this document does not authorize implementation.
**Date:** 2026-11-28
**Recommendation:** **CONDITIONAL GO** for one narrow V1 continuity slice, subject to the owner accepting the conditions below. A conditional go is not approval to create or start a V1 implementation issue. The owner makes the final GO / CONDITIONAL GO / NO-GO decision and separately approves any implementation issue.

## Executive decision

F1–F5 establish that several core mechanisms are feasible in bounded Linux fixtures: explicit attributed checkpoints, isolated schema-valid extraction proposals, a checkpoint-specific cross-agent continuation, scoped SQLite/FTS5 retrieval, and an on-demand core with serialized fake work per configured data root. Together they justify a narrow attempt to build the explicit continuity path.

They do **not** establish production correctness, real MCP interoperability, reliable automatic capture, claim verification, useful retrieval quality on representative projects, safe real executor side effects, or supported operation beyond Linux. The experiments are independent feasibility probes, not an integrated V1 system. F6 therefore does not recommend an unconditional V1 GO.

For V1, choose one user-level application data root containing one logical SQLite knowledge database and one coordinated on-demand core for the installation. All registered projects share that database and core; every query, checkpoint, memory, and job must carry and enforce project scope, with task scope where applicable. F5's per-data-root core is supporting lifecycle evidence only; it does not prove this user-wide topology or its multi-project isolation. Prove two independent MCP/CLI clients and two projects against the proposed topology before expanding beyond the first continuity slice.

Keep automatic capture optional and capability-specific. Make explicit task creation/association, durable checkpoints, accurate saved/queued/proposal statuses, source-linked task loading, and real MCP/CLI interoperability the first product path. FTS5 remains the initial retrieval mechanism. Do not add embeddings or a semantic reranker on the current evidence.

## Evidence and claim strength

“Verified” means observed within the named experiment's bounds; it is not a production guarantee. Spike-only artifacts are not production-ready implementations.

| Area | Verified within bounded setup | Inferred for V1 | Unverified / excluded from claims | Evidence |
|---|---|---|---|---|
| F1 session capture | Codex and OpenCode produced explicit structured foreground checkpoints attributed to sessions; lifecycle metadata was observed for tested versions. | A foreground explicit checkpoint is a viable portable fallback, with harness adapters kept at the edge. | Complete/automatic transcript capture, durable coverage across compaction/crash, semantic correctness, stable provider APIs, and cross-platform behavior. | Issue [#3](https://github.com/kedarmd/memories/issues/3), PR [#4](https://github.com/kedarmd/memories/pull/4); [SPIKE_RESULTS.md](SPIKE_RESULTS.md). |
| F2 extraction | One independently launched Codex executor produced bounded schema-valid proposals; source references were allowlisted; a Linux fixture remained read-only and subprocess cleanup was observed. | A bounded isolated executor can produce candidates for later verification. | Factual/source-support verification, production integration, broad providers/platforms, robust adversarial isolation, and proposal-to-current-knowledge promotion. | Issue [#5](https://github.com/kedarmd/memories/issues/5), PR [#6](https://github.com/kedarmd/memories/pull/6); [SPIKE_RESULTS.md](SPIKE_RESULTS.md). |
| F3 continuation | A Codex-authored checkpoint was durable before handoff; controlled OpenCode vs no-packet continuation showed one checkpoint-specific constraint carried into work. | Explicit checkpoint loading can preserve useful task context across tested agents. | General transfer quality, representative tasks/repos, reverse direction, statistical reliability, and native thread-ID binding. | Issue [#7](https://github.com/kedarmd/memories/issues/7), PR [#8](https://github.com/kedarmd/memories/pull/8); [SPIKE_RESULTS.md](SPIKE_RESULTS.md). |
| F4 retrieval | SQLite FTS5 ranking and relational project/task/lifecycle filtering worked on a synthetic fixture; recall@3 was 9/11 and recall@5 10/11; no wrong-scope rows leaked. | Scoped lexical retrieval is a reasonable measurable default if weak/empty results remain visible. | Reliable zero-overlap paraphrases, high precision, citation support verification, production-scale context quality, and any need for embeddings. Broad OR queries had substantial false positives. | Issue [#9](https://github.com/kedarmd/memories/issues/9), PR [#10](https://github.com/kedarmd/memories/pull/10); [SPIKE_RESULTS.md](SPIKE_RESULTS.md). |
| F5 runtime | Linux CLI-style processes shared one core per configured data root, serialized one fake executor, kept a small read responsive during asynchronous fake work, and recovered controlled crash/idle scenarios. Scoped job idempotency was verified. | A coordinated on-demand local core and durable queue are plausible V1 mechanisms. | Actual MCP framing/tool lifecycle, two real MCP clients, one core across projects under one user data root, real extractor effects, non-Linux process supervision, hostile same-user isolation, long synchronous DB operations, and exactly-once side effects. | Issue [#11](https://github.com/kedarmd/memories/issues/11), PR [#12](https://github.com/kedarmd/memories/pull/12); [SPIKE_RESULTS.md](SPIKE_RESULTS.md). |

Full historical measurements, fixture details, reproduction commands, and limitations remain in [SPIKE_RESULTS.md](SPIKE_RESULTS.md); this decision summarizes them without changing those results.

## Decisions and alternatives

### Core topology and data

**Decision for V1:** one user-level application data root, one logical SQLite knowledge database, and one coordinated on-demand core per installed user instance. The database contains multiple registered projects with mandatory relational project scope. Coordination metadata may use a separate small file/database if needed, but it is not a second knowledge store. A per-project data root/core is not the V1 default.

This follows the PRD's one shared core and database, multi-project installation, and the engineering principle “one local core, many clients.” F5 demonstrated only one instance per configured root and a distinct isolated second root. It did not choose or validate the production ownership boundary. The first runtime acceptance gate must test shared multi-project topology, including project/task isolation and simultaneous MCP/CLI access.

Alternative considered: one core/database per repository or configured root. It maps more directly to F5, but multiplies workers and coordination domains for a single user installation and conflicts with the PRD's shared-core model. Revisit only with concrete isolation or operational evidence and an owner-approved architecture change.

### Minimum continuity path

**Decision:** prioritize explicit `task-create` / task association, `update` for durable attributed checkpoint persistence, and `load` for bounded source-linked scoped context. Verify the deterministic path before adding AI extraction. The portable path starts or continues a fresh agent session and explicitly loads the task. Native in-place compaction and automatic capture remain optional.

Real MCP and CLI interoperability is an early prerequisite, not a late packaging milestone: at least two independent MCP/CLI clients must exercise the same core and database. The two MCP clients must use the real protocol implementation; F5 JSON IPC does not satisfy this gate.

### Memory status, provenance, and verification

**Decision:** persist distinct statuses with observable transitions:

| Status | Meaning |
|---|---|
| `saved` | Checkpoint payload and attribution are durably committed. No extraction claim is implied. |
| `queued` | An extraction job is durably accepted and awaits work. |
| `proposed-unverified` | Executor output passed boundary/schema validation but its factual claims and source support have not been verified. It is not current knowledge. |
| `verified` | A claim has evidence checked against its cited source by a deterministic verifier where feasible, or an explicitly identified human reviewer. Verification method and sources are recorded. |
| `superseded` | A previously current claim was replaced with recorded evidence and a relation to its successor. |
| `failed` | Persistence or processing did not complete; error and retry state are inspectable. |
| `review-required` | Conflict, insufficient evidence, unsupported citation, or ambiguous change blocks automatic promotion. |

An LLM may propose claims, never self-certify them. Schema validity, citation presence, an agent assertion, and a Git merge are not verification. Unsupported or missing references stay attached as unresolved evidence and prevent promotion to `verified`; a human may explicitly approve a documented judgment, but must not relabel it as code-level verification. `verified` concerns a specific claim against named evidence and does not imply it remains fresh forever. Currentness/supersession and freshness remain separate properties.

### Retrieval policy

**Decision:** scoped relational eligibility first, then SQLite FTS5 lexical ranking and bounded attributed results. Exclude superseded/invalidated records from normal retrieval; historical mode is explicit and labels old lifecycle state. Empty or weak matches return no confident context and invite refinement rather than broadening scope or inventing semantic matches.

Carry forward F4's zero-overlap paraphrase miss and broad-OR false positives as known failures. Before retrieval is treated as acceptable, measure against a larger labeled task corpus, including cross-project/task negatives, zero-overlap paraphrases, citation support, precision/recall at fixed k, and weak-result behavior. No embeddings or semantic reranker are justified until a repeatable important miss remains after low-cost lexical/query improvements and the owner approves the added complexity.

### Executor, runtime, and privacy boundary

**Decision:** Linux is the only initially evidenced execution platform. Product support declarations must follow actual validation; macOS/Windows support is not inferred. Any executor process must receive bounded inputs, have enforced read-only repository access for read-only work, timeouts and process-group termination, and recursion prevention implemented outside prompts. Record that real executor side effects can occur before a crash is recorded. Queue retries are at-least-once when side effects are possible; do not claim exactly-once behavior.

Job identities must be scoped and idempotent. Failed/running-on-crash jobs remain inspectable; uncertain side effects require explicit retry or review. Local IPC permissions restrict other OS users, but same-user processes are not a hostile boundary. Secrets and captured session content require documented data minimization, redaction, retention/deletion behavior, and permissions. Before any external inference, disclose what data is sent, to which configured provider, and obtain user consent/configuration; no provider fallback is implicit. These are acceptance gates, not F1–F5 accomplishments.

### MCP and packaging

**Decision:** the first integrated runtime proof must connect two independent MCP clients plus a CLI client to one user-level core, exercise discovery and task/checkpoint/load operations, verify protocol error/cancellation/lifecycle behavior, and prove project/task isolation across at least two projects. Only then can packaging or UI milestones depend on a production MCP contract. F5's JSON proxy is not protocol evidence.

## Risk register

Likelihood and impact are qualitative planning estimates, not measured frequencies. Acceptance owner means the human who must accept the evidence before the relevant implementation scope expands.

| Risk | Likelihood / impact | Mitigation | Acceptance evidence / owner |
|---|---|---|---|
| User-wide core/database topology introduces cross-project leakage or coordination defects. | Medium / High | One explicit user data root; scope every request/job; test two projects and concurrent clients. | Two MCP clients plus CLI, isolation negatives, startup/recovery tests pass; owner accepts before expanding runtime scope. |
| Capture gaps are mistaken for complete history. | High / High | Explicit checkpoint is guaranteed path; adapters advertise measured capability and gaps. | Missing event/compaction/crash cases leave visible incomplete status; owner accepts each supported adapter claim. |
| Plausible extraction proposals become false current knowledge. | Medium / High | Separate proposal from verification; source checks; unresolved citations block promotion; review conflicts. | Tests show unsupported references cannot become verified/current without recorded human review; owner accepts promotion policy. |
| Retrieval returns irrelevant context or misses paraphrases. | High / Medium | Scope before ranking; conservative empty/weak behavior; benchmark quality on representative labeled corpus. | Agreed precision/recall and leakage thresholds on reviewable corpus; owner accepts before broad rollout. |
| Executor crash/retry repeats external side effects. | Medium / High | Enforced read-only mode where applicable, bounded process, scoped idempotency, explicit failed/review state; state at-least-once semantics. | Fault injection around side-effect/completion boundary and documented retry behavior; owner accepts residual risk. |
| Session/source data exposes secrets or is sent to an external provider unexpectedly. | Medium / High | Minimize capture, redact, define retention/deletion, disclose provider/data before inference, require consent/configuration. | Redaction/retention tests and observable consent/configuration path; owner accepts privacy behavior before real inference. |
| Non-Linux IPC/runtime behavior differs from Linux fixture. | High / Medium | Declare Linux-first validation; add platform-specific implementation and test evidence before claiming support. | Per-platform startup, IPC, permissions, crash/recovery checks; owner accepts each platform claim. |
| FTS5 weak results are mistaken for semantic retrieval. | High / Medium | Label lexical behavior, expose source/uncertainty, permit empty result, keep embeddings deferred. | Paraphrase and broad-query benchmark meets explicit threshold or documented fallback; owner accepts retrieval quality. |

## Minimum V1 gates

No production implementation starts until the owner explicitly accepts this decision and separately approves a single first-slice issue. The slice is limited to the deterministic continuity path and its real client contract.

1. **Topology and protocol:** one user-level data root and one knowledge DB; two independent real MCP clients and one CLI client share one core; discovery, request, error, cancellation, and shutdown behavior are tested.
2. **Scope and durability:** two registered projects and multiple tasks; every read/write/job is explicitly scoped; negative tests show no cross-project/task result or job access; checkpoint attribution and durable receipt survive core restart.
3. **Status truthfulness:** the first slice reports a persisted checkpoint as `saved`. It has no extraction path and therefore must not report `queued` or extraction completion. A later extraction milestone must report `queued` only after durable job acceptance; invalid output, unsupported references, and failures remain visible and cannot be promoted silently.
4. **Continuity utility:** on a real, non-sensitive task, one harness saves a checkpoint and a second independent client loads it; source references resolve and the next step is attributable. This is a workflow acceptance check, not a claim of universal transfer quality.
5. **Retrieval quality:** labeled corpus includes direct and zero-overlap paraphrase queries, broad OR queries, cross-scope negatives, lifecycle cases, and citation support. Thresholds and minimum acceptable precision are owner-approved before the benchmark; weak/empty cases remain conservative.
6. **Execution and privacy:** before enabling real extraction, prove read-only enforcement, timeout/process-group cleanup, recursion prevention, crash/retry semantics, redaction and retention behavior, and provider disclosure/consent. Fake-worker F5 evidence cannot satisfy this gate.
7. **Platform claims:** Linux-only claims are explicit until macOS/Windows suites pass. No multi-platform promise based on Node portability alone.

## Annotated first implementation slice (proposal only)

**Outcome:** a developer can create/associate a task, durably save an attributed checkpoint, and explicitly load bounded, source-linked task/project context through CLI and real MCP clients sharing the V1 user-level core.

**Prerequisites:** owner accepts the F6 recommendation; owner approves a separate issue; the issue freezes the initial status/provenance contract and the real MCP test harness; data-root permissions and Linux-only initial validation are stated. The issue must not bundle UI, automatic capture, AI extraction, refresh, embeddings, or broad packaging.

**Observable acceptance:** two independent MCP clients and CLI reach one core; operations persist/reload across restart; two-project/task isolation tests pass; persisted checkpoints report `saved` and this extraction-free slice makes no `queued` or completion claim; unsupported source references are marked and never described as verified; a second client can load a useful checkpoint from a real non-sensitive fixture task; exact commands, versions, results, and limitations are recorded in the PR.

This is a candidate boundary for review, not an implementation issue or authorization. No V1 issue is created by F6.

## No-go triggers and remaining unknowns

Return to NO-GO or reduce scope if the shared user-level core cannot enforce project/task isolation, actual MCP interoperability cannot be made reliable without violating the one-core model, durable checkpoints cannot be acknowledged truthfully, read-only executor isolation is unenforceable for the proposed operation, or privacy/provider disclosure cannot be made understandable and controllable. Reopen the decision if representative retrieval misses critical context while returning misleading weak matches, or if supported harnesses cannot provide a usable explicit checkpoint path.

Still unknown: representative cross-agent continuation quality; durable production schema/migrations; source-claim verification cost and coverage; real executor runtime and side effects; multi-project shared-core recovery; MCP transport/version compatibility; same-user threat assumptions; redaction/retention requirements; query quality and thresholds; worktree/branch freshness; and macOS/Windows behavior.

## Related documents

- [Architecture](ARCHITECTURE.md) records the selected V1 topology and conditional constraints.
- [Implementation plan](IMPLEMENTATION_PLAN.md) places the real-client continuity slice first and retains provisional downstream work.
- [Spike plan](SPIKE_PLAN.md) describes F1–F5 experiment scopes.
- [Spike results](SPIKE_RESULTS.md) remains the historical evidence record.
