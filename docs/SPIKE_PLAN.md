# Memories — Feasibility Spike Plan

**Status:** Ready for implementation planning  
**Purpose:** Validate the high-risk mechanisms before committing to the full V1 application.  
**Approach:** Small executable experiments, documented evidence, no ornamental UI.

## 1. Questions to answer

**Spike A — Capture:** Can we reliably identify a coding session and acquire enough authorized data to create useful checkpoints? What do Codex and OpenCode *actually* expose through MCP, hooks/plugins, and their session stores? How do gaps appear after compaction, abrupt exit, or a missing event?

**Spike B — Isolated extraction:** Can a separately launched, configurable headless coding agent turn a checkpoint/event sample into valid, source-backed structured memories without modifying repository files, recursively capturing itself, or blocking the active session?

**Spike C — Cross-agent continuation:** Can work begun in one coding harness be continued in another using a shared task ID, a durable checkpoint, and `/memories-load`, without copying native chat transcripts?

**Spike D — Retrieval:** Do SQL scoping, relationships, and FTS5 recover the right project/task knowledge under exact and paraphrased queries? Where specifically do they fail?

**Spike E — Runtime:** Can multiple MCP subprocesses/CLI/UI clients coordinate a single on-demand core and one headless worker, with safe startup and cleanup? This is a targeted experiment, not a fully polished service manager.

## 2. Spike boundaries

Implement only enough Node.js/TypeScript, Effect, Zod, Drizzle, SQLite, MCP, and CLI functionality to run the experiments. Keep the core agent-independent. Use Codex and OpenCode as test environments, not as core dependencies. No React UI, knowledge graph, embedding model, extensive task scheduler, team sync, or full Git-aware docs generator in the spike.

Use an isolated sample repository with non-sensitive content. Do not transmit private project code or full transcripts to remote inference without explicit approval. Log which tools/models/data sources are used during tests.

## 3. Minimum experimental contract

- Stable internal project/task/session IDs; explicit project registration.
- A simple source-independent `CheckpointInput` schema validated with Zod.
- Durable checkpoint write, source event references where available, and idempotency key.
- A headless-executor adapter interface that accepts a bounded extraction request and returns validated structured memory proposals.
- A retrieval interface that scopes by project and task, searches with SQL/FTS5, and emits source-linked results.
- Minimal MCP operations for task association, checkpoint submission, and retrieval (exact tool names can be finalized during the spike).
- Job/worker prototype demonstrating single-flight extraction and recoverable failure.

## 4. Experiment sequence

### A. Verify harness capabilities before implementing adapters

1. Inspect official, current Codex/OpenCode docs and actual installed version capabilities.
2. Record supported MCP transports, session identifiers, lifecycle signals, access to message/tool content, headless CLI operation, and permissions.
3. Implement the thinnest possible adapter for one capture path in each harness.
4. Test normal start/exit, prolonged idle, compaction if available, abrupt termination, and agent resume.
5. Report confirmed events versus unsupported assumptions. Don't infer full transcript access from a lifecycle notification.

**Pass evidence:** real event samples (sanitized), adapter capability matrix, and a clear description of missing coverage.

### B. Test structured extraction

1. Create a representative session including a decision, implementation result, failed attempt, and unresolved blocker.
2. Persist a checkpoint, then invoke the globally configured headless executor in isolation.
3. Request small structured memories with source evidence, applicability, and uncertainty; validate with Zod.
4. Repeat the same extraction request and check for duplicate handling; simulate invalid output and subprocess failure.
5. Check that repository files remain unchanged and the extraction session is excluded from capture.

**Pass evidence:** validated records, provenance, error-handling log, no repository mutation, no recursive captures.

### C. Prove cross-agent continuation

1. Start a real sample feature in harness A and establish a task ID.
2. Make a meaningful partial implementation and persist a verified checkpoint.
3. End harness A; start harness B in the same repository and explicitly load that task.
4. Ask harness B to continue from the checkpoint, inspect code state, and complete a testable next step.
5. Repeat in the other direction if feasible, noting any adapter-specific limitations.

**Pass evidence:** test results, what knowledge was actually carried over, what the second agent rediscovered, and how much irrelevant context it received.

### D. Benchmark initial retrieval

Prepare a small, human-labeled fixture set containing current project documents, task decisions, obsolete decisions, overlapping modules, and cross-session checkpoints. Include direct searches and deliberately paraphrased queries.

Evaluate:
- Relevant records found in the returned set (recall at a fixed result count).
- Irrelevant or wrong-task records returned.
- Historical/superseded leakage into normal retrieval.
- Citation presence and verifiability.
- Tokens/characters delivered and timing.

**Decision gate:** if lexical retrieval repeatedly fails on important paraphrases, document the failures and estimate whether embeddings would solve them. Do not add vector search during the spike solely because it sounds desirable.

### E. Validate service lifecycle

1. Start two MCP clients concurrently and confirm they reach one core instance.
2. Queue two extraction jobs and confirm the headless executor has maximum concurrency one while regular reads still work.
3. Disconnect one client, then all clients; ensure outstanding work is persisted/finished appropriately.
4. Simulate stale locks/process crashes, reconnect, and confirm no duplicate core or lost durable checkpoint.

**Pass evidence:** logs/test traces for startup, concurrency, recovery, and shutdown.

## 5. Exit criteria

The spike is complete only when:

- Actual agent capabilities are recorded rather than assumed.
- At least one supported path durably captures a meaningful checkpoint and processes it in an isolated executor.
- A second coding agent retrieves and uses that checkpoint to continue work in a reproducible test.
- SQLite schema, MCP contracts, and retrieval path are demonstrably agent-independent.
- Failures and limitations are documented honestly, including unsupported or partial automatic capture.
- No uncontrolled/background agent multiplication or repository mutation occurs.

A failed experiment is a valid outcome if it identifies the constraint and a lower-complexity fallback. Do not ship unsupported behavior behind reassuring UI labels.

## 6. Deliverables

- `docs/SPIKE_RESULTS.md`: environment, harness versions, experiments, evidence, pass/fail, outstanding risks.
- A minimal executable implementation and tests suitable for re-use in V1, or explicit throwaway designation for experiments.
- Updated `ARCHITECTURE.md` with only verified integration constraints.
- A go/no-go recommendation for V1 implementation milestones and any required scope changes.

## 7. Suggested first coding-agent instruction

> Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ENGINEERING_PRINCIPLES.md`, and `docs/SPIKE_PLAN.md`. Before writing substantial code, inspect current harness documentation and prepare an implementation plan for Spike A only. Report supported capabilities and explicit unknowns. Do not implement deferred V1 features, introduce embeddings/vector databases, or create the React UI. Keep the core agent-agnostic and provide test evidence for every claimed integration capability.