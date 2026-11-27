# Feasibility Spike Results — F1 Session Capture

| Environment | Value |
|---|---|
| Run date | 2026-11-27 |
| Host | Linux x86_64, kernel `7.3.5-arch1-1` |
| Runtime | Node.js `v24.22.3` |
| Codex | `codex-cli 0.172.0` |
| OpenCode | `v2.4.1` |

## Scope and decision

F1 tested short interactions in a disposable Git repository containing one pure counter function. Model requests used non-sensitive sample code. The agent-generated checkpoint responses were piped directly through a harness-specific normalizer and the bounded checkpoint validator; raw responses and IDs were not written to disk or included in this report.

**Verified useful checkpoint path:** Codex and OpenCode each returned a session-attributed JSON checkpoint with an objective, decision, observed work, no-change attempt status, unresolved blocker, and a reference to `src/counter.ts`. Both normalizers converted the actual output to the explicit F1 checkpoint shape, and the validator returned `validated-only`. The source path existed in the disposable fixture. This verifies an explicit foreground handoff for these versions and prompts; it does not verify that the agent's interpretation is correct or that capture is automatic.

**Observed lifecycle metadata:** Codex hooks reported start, prompt-submit, and end metadata. OpenCode events reported execution start, text completion, and execution success; its event probe also observed an interruption in the separate TERM test. Reproducible assertions check event presence and session-ID presence without assuming ordering. These observations do not themselves constitute useful checkpoints.

**Inconclusive:** complete/automatic transcript capture, Codex resume, successful compaction, prolonged idle, and crash recovery. The OpenCode TERM test verified interruption and subsequent session resume, not recovery from a process or machine crash. Codex's ephemeral TERM test ended before a hook summary was written.

F1 is a bounded pass for the explicit agent-generated checkpoint path on this Linux host. It does not establish complete capture, crash durability, or cross-platform support.

No architecture amendment is needed: the evidence supports the existing proposal to keep capture adapters at the edge, treat native capture as capability-specific, and retain explicit foreground checkpoints as the portable fallback. The fallback shape below is a probe contract only; it does not freeze F2's `CheckpointInput` contract.

## Environment and data handling

The sample repository was created under `/tmp`, initialized with Git, and contained `src/counter.ts` with one pure `add` function. The probes ran read-only prompts. `codex exec` used `--sandbox read-only`; the OpenCode prompts requested no tools or edits. OpenCode session exports used `--sanitize`. No user project files, raw transcripts, API credentials, or session IDs were committed. Probe logs contain event names, limited lifecycle enum values, and field-presence booleans.

The agent calls use the locally configured model providers. No private source was supplied. A developer reproducing the calls should use an equally disposable repository and confirm their provider's data handling before sending any non-public content.

## Capability matrix

| Capability | Codex 0.172.0 | OpenCode 2.4.1 |
|---|---|---|
| MCP configuration | CLI exposes `codex mcp`; not connected to a Memories server in F1 | CLI exposes `opencode mcp`; not connected to a Memories server in F1 |
| Session identity and resume | Observed JSONL `thread.started` and hook session-ID presence. `codex exec resume` is available in CLI help; resume was not exercised in this disposable run. | Observed session ID in JSON events; `session list` found normal and TERM-interrupted runs; `run --session <id>` resumed them and sanitized export returned messages. |
| Lifecycle / execution events | Observed `SessionStart` (`source=startup`), `UserPromptSubmit`, and `SessionEnd` hooks. Hook inputs reported a session ID and prompt presence. | Observed `session.execution.started`, `session.text.ended`, and `session.execution.succeeded`, each with a session ID in the plugin event payload. |
| Message / tool content | Observed `codex exec --json` agent-message text and piped it directly into the normalizer/validator. Hook `transcript_path` was absent in the ephemeral run; official docs describe it as optional and its format as unstable. | Observed response text in JSONL and `session.text.ended`; normalized and validated that output. Sanitized CLI export returned a projected transcript (six messages after the earlier resume probe). |
| Useful checkpoint output | Verified actual JSON response normalized and accepted by the validator; sanitized evidence below records its substantive fields with session ID redacted. This proves shape and attribution, not semantic correctness. | Verified actual JSON response normalized and accepted by the validator, including array-shaped `{kind, ref}` evidence; sanitized evidence below records its substantive fields. This proves shape and attribution, not semantic correctness. |
| Compaction | Not triggered. Current hooks docs list `PreCompact`, `PostCompact`, and `SessionStart` with `source=compact`; runtime not verified. | Compaction API request returned an accepted `delivery=steer` response. Completion was not observed, so compaction success and event delivery remain unverified. |
| Normal end | `SessionEnd` observed for the ephemeral `codex exec` process. | `session.execution.succeeded` observed and `opencode run` returned; no separate session-end event was observed. |
| Controlled TERM interruption / crash recovery | A 3-second TERM timeout against `codex exec --ephemeral` exited 124 after thread/turn-start output; no hook summary was written and recovery was not demonstrated. Crash recovery remains inconclusive. | A 3-second TERM timeout produced `session.execution.interrupted` with session attribution; the same listed session resumed and sanitized export returned messages. This verifies controlled interruption/resume, not crash recovery. |
| Prolonged idle / idle resume | Not exercised. | Not exercised. |
| Permissions | Codex request ran with read-only sandbox. The disposable project was trusted with `--trust`, and its test hook used `--dangerously-bypass-hook-trust` to avoid interactive hook review. Both are limited to the isolated fixture. | The prompt requested no tools, but the event probe recorded `session.tool.called`; tool identity/arguments were not retained, so tool-content coverage is unverified. The standalone server API was bound to `127.0.0.1`; its local test password was not retained. |
| Capture confidence | Hooks provide useful lifecycle and prompt signals, and JSONL provides turn output. The run does not establish a stable raw transcript interface or complete transcript capture. | Event stream and export can expose useful session text and IDs. The public event stream is documented as volatile; the experimental session log/export routes and API stability need separate review before production reliance. |

### Sanitized observed samples

Codex hook probe:

```json
{"event":"SessionStart","sessionIdPresent":true,"promptPresent":false,"transcriptPathPresent":false,"source":"startup"}
{"event":"UserPromptSubmit","sessionIdPresent":true,"promptPresent":true,"transcriptPathPresent":false}
{"event":"SessionEnd","sessionIdPresent":true,"promptPresent":false,"transcriptPathPresent":false,"reason":"other"}
```

OpenCode plugin probe:

```json
{"type":"session.execution.started","sessionIdPresent":true,"messageIdPresent":false,"contentPresent":false}
{"type":"session.text.ended","sessionIdPresent":true,"messageIdPresent":false,"contentPresent":true}
{"type":"session.execution.succeeded","sessionIdPresent":true,"messageIdPresent":false,"contentPresent":false}
```

OpenCode interruption probe:

```json
{"type":"session.execution.started","sessionIdPresent":true,"messageIdPresent":false,"contentPresent":false}
{"type":"session.execution.interrupted","sessionIdPresent":true,"messageIdPresent":false,"contentPresent":false}
```

The assertions do not compare timestamps or rely on event order. `assert-events.mjs` checks required event types and whether each has a session-ID field; `--interrupted` adds an attribution check for the interruption event. `summarize-*-jsonl.mjs` records only item type, an allowlist of JSON field names, and source-path presence. The OpenCode summarizer handles evidence as a string or an array of strings/objects with `ref` or `path` fields.

### Sanitized evidence from actual agent responses

The following values came from actual Codex and OpenCode responses for the disposable `src/counter.ts` task. Each was normalized and passed through `validate-checkpoint.mjs`; the session ID value is replaced with a presence flag. The file itself was a one-function sample and was unchanged.

Codex:

```json
{
  "status": "validated-only",
  "checkpoint": {
    "session": { "harness": "codex", "sessionIdPresent": true },
    "objective": "Propose a pure decrement operation for the counter.",
    "decisions": ["Use a function that returns the current count minus the requested amount without mutating the counter."],
    "completed": ["Inspected src/counter.ts."],
    "failedAttempts": ["No implementation attempt was made, as requested."],
    "blockers": ["Behavior for negative decrement amounts is unresolved."],
    "evidence": [{ "kind": "file", "ref": "src/counter.ts" }],
    "coverage": "explicit-checkpoint"
  }
}
```

OpenCode:

```json
{
  "status": "validated-only",
  "checkpoint": {
    "session": { "harness": "opencode", "sessionIdPresent": true },
    "objective": "Propose a pure decrement operation for src/counter.ts.",
    "decisions": ["Model decrement as a pure function like subtract(left: number, right: number): number that returns left - right, mirroring the existing add signature."],
    "completed": ["Inspected src/counter.ts and identified the existing pure add function as the pattern to follow."],
    "failedAttempts": ["No implementation attempt was made."],
    "blockers": ["It is unresolved whether negative decrement amounts should be allowed, rejected, or normalized."],
    "evidence": [{ "kind": "file", "ref": "src/counter.ts" }],
    "coverage": "explicit-checkpoint"
  }
}
```

## Reproduction

These commands require the installed CLIs and their normal provider authentication. Start in a new disposable directory and avoid using a private repository:

```sh
probe_dir="$(mktemp -d /tmp/memories-f1.XXXXXX)"
mkdir -p "$probe_dir/sample/src" "$probe_dir/sample/.codex" "$probe_dir/sample/.opencode/plugins"
git -C "$probe_dir/sample" init
printf '%s\n' 'export function add(a: number, b: number) { return a + b }' > "$probe_dir/sample/src/counter.ts"
```

For Codex, create `$probe_dir/sample/.codex/hooks.json` with these command hooks. The hook script receives JSON on stdin and writes only whitelisted metadata to the local log:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /absolute/path/to/memories/probes/codex-hook-summary.mjs" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /absolute/path/to/memories/probes/codex-hook-summary.mjs" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node /absolute/path/to/memories/probes/codex-hook-summary.mjs" }] }]
  }
}
```

Codex requires a trusted project layer for project hooks and review/trust of command hooks. For reproduction, review the temporary hook in `/hooks`; in the recorded disposable run, the project was trusted with `--trust` and the hook review was bypassed with `--dangerously-bypass-hook-trust`. Use those flags only for an isolated, controlled fixture. The run command was:

```sh
export F1_PROBE_LOG="$probe_dir/codex-events.jsonl"
checkpoint_prompt='Read src/counter.ts in this disposable sample. Propose a pure decrement operation but do not edit files or run tests. State the objective, one decision, what was inspected/completed, that no implementation attempt was made, an unresolved blocker about negative decrement amounts, and cite src/counter.ts. Return only JSON with keys objective, decision, completed, failed_attempt, blocker, and evidence; evidence must be an array of {kind:"file",ref:"src/counter.ts"}.'
codex exec --ephemeral --trust --dangerously-bypass-hook-trust --sandbox read-only --json -C "$probe_dir/sample" "$checkpoint_prompt" 2>&1 \
  | node /absolute/path/to/memories/probes/normalize-agent-output.mjs codex \
  | node /absolute/path/to/memories/probes/validate-checkpoint.mjs \
  | jq '{status, checkpoint: {session: {harness: .checkpoint.session.harness, sessionIdPresent: (.checkpoint.session.sessionId | length > 0)}, objective: .checkpoint.objective, decisions: .checkpoint.decisions, completed: .checkpoint.completed, failedAttempts: .checkpoint.failedAttempts, blockers: .checkpoint.blockers, evidence: .checkpoint.evidence, coverage: .checkpoint.coverage}}'
node /absolute/path/to/memories/probes/assert-events.mjs codex "$F1_PROBE_LOG"
```

For OpenCode, copy `probes/opencode-event-probe.ts` to `$probe_dir/sample/.opencode/plugins/`, then run:

```sh
export F1_PROBE_LOG="$probe_dir/opencode-events.jsonl"
cd "$probe_dir/sample"
checkpoint_prompt='Read src/counter.ts in this disposable sample. Propose a pure decrement operation but do not edit files or run tests. State the objective, one decision, what was inspected/completed, that no implementation attempt was made, an unresolved blocker about negative decrement amounts, and cite src/counter.ts. Return only JSON with keys objective, decision, completed, failed_attempt, blocker, and evidence; evidence must be an array of {kind:"file",ref:"src/counter.ts"}.'
opencode run --standalone --format json "$checkpoint_prompt" \
  | node /absolute/path/to/memories/probes/normalize-agent-output.mjs opencode \
  | node /absolute/path/to/memories/probes/validate-checkpoint.mjs \
  | jq '{status, checkpoint: {session: {harness: .checkpoint.session.harness, sessionIdPresent: (.checkpoint.session.sessionId | length > 0)}, objective: .checkpoint.objective, decisions: .checkpoint.decisions, completed: .checkpoint.completed, failedAttempts: .checkpoint.failedAttempts, blockers: .checkpoint.blockers, evidence: .checkpoint.evidence, coverage: .checkpoint.coverage}}'
node /absolute/path/to/memories/probes/assert-events.mjs opencode "$F1_PROBE_LOG"
```

To exercise OpenCode resume/export, take the session ID from `opencode session list --format json --max-count 1`, then use `opencode run --session <id> ...` and `opencode session export --sanitize <id>`. IDs and exported messages should remain local; do not paste raw exports into issue/PR evidence.

To request compaction in a local OpenCode server, run the server from the sample directory in one terminal and submit the request from another. The sample password is local-only:

```sh
# Terminal 1
cd "$probe_dir/sample"
OPENCODE_PASSWORD=f1-local-probe-only F1_PROBE_LOG="$probe_dir/opencode-compaction-events.jsonl" \
  opencode serve --hostname 127.0.0.1 --port 47822

# Terminal 2
export OPENCODE_PASSWORD=f1-local-probe-only
opencode --server http://127.0.0.1:47822 run --format json \
  'Reply exactly COMPACTION_PROBE_OK. Do not inspect or modify files.' \
  | node /absolute/path/to/memories/probes/summarize-opencode-jsonl.mjs
session_id="$(opencode --server http://127.0.0.1:47822 session list --format json --max-count 1 | jq -r '.[0].id')"
opencode --server http://127.0.0.1:47822 api post "/api/session/$session_id/compact" --data '{}'
```

In this F1 run, the response showed that compaction was queued (`delivery=steer`); no completion event or completed summary was observed. The server was stopped after the check.

To attempt abrupt interruption, use the same disposable project and plugin, then resume the newest session by ID:

```sh
export F1_PROBE_LOG="$probe_dir/opencode-interrupted-events.jsonl"
cd "$probe_dir/sample"
timeout --signal=TERM --kill-after=1s 3s opencode run --standalone --format json \
  'Provide a detailed text-only explanation of a pure decrement function. Do not use tools or modify files. Continue for about 1500 words.' \
  | node /absolute/path/to/memories/probes/summarize-opencode-jsonl.mjs
session_id="$(opencode session list --standalone --format json --max-count 1 | jq -r '.[0].id')"
opencode run --standalone --format json --session "$session_id" \
  'Reply exactly INTERRUPTED_SESSION_RESUMED. Do not use tools or modify files.' \
  | node /absolute/path/to/memories/probes/summarize-opencode-jsonl.mjs
cat "$F1_PROBE_LOG"
opencode session export --standalone --sanitize "$session_id" | jq '{messageCount:(.messages|length)}'
```

In this run, `timeout` returned status `124`; the plugin observed `session.execution.interrupted`, after which the listed session resumed and sanitized export contained messages. For an order-independent attribution assertion, combine the sanitized normal-run and interruption logs and run `node probes/assert-events.mjs opencode combined-events.jsonl --interrupted`. This remains a controlled TERM test, not crash-recovery evidence. Codex's corresponding timeout emitted `thread.started` and `turn.started` before status `124`, but produced no hook summary and was ephemeral, so it did not demonstrate recovery.

The exact run performed for Codex and OpenCode used a disposable fixture and both returned successful agent-message/text items. Codex also emitted two JSONL error items whose message bodies were intentionally not retained; the turn completed. Their causes were not independently identified. This is an unresolved observation, not evidence of a successful capture path for those errors.

## Explicit foreground checkpoint fallback

When a harness cannot expose authorized, stable session content, the active agent can submit a structured checkpoint directly. `probes/validate-checkpoint.mjs` bounds JSON input to 16 KiB, rejects unknown fields, requires a session reference and explicit coverage label, and validates decisions, outcomes, blockers, and source references. It emits `validated-only`; it does not persist, extract, or claim that a checkpoint was saved.

Reproduce the validation and tests:

```sh
node probes/validate-checkpoint.mjs < probes/checkpoint-example.json
node --test probes/*.test.mjs
```

The schema is deliberately a small F1 fixture. F2 must decide the durable, agent-independent checkpoint contract after the F1 evidence is accepted.

## Documentation references

- [Codex hooks](https://developers.openai.com/codex/hooks/): lifecycle events, project hook configuration and trust, hook payload fields, and the warning that `transcript_path` is optional and its transcript format is not stable.
- [Codex CLI](https://developers.openai.com/codex/cli/): non-interactive execution and session continuation interfaces.
- [OpenCode CLI commands](https://opencode.ai/docs/cli/commands/): `run --format json`, session listing, resume, and sanitized session export.
- [OpenCode API](https://opencode.ai/docs/api/): event stream, experimental session log/export endpoints, and lifecycle event types.
- [OpenCode plugin events](https://opencode.ai/docs/build/plugins/server/): plugin event subscription and hooks.
- [OpenCode compaction](https://opencode.ai/docs/compaction/): manual/automatic compaction and completion signals.

## F1 recommendation

Proceed to owner review of F1. Candidate next-step boundary: accept explicit structured checkpoints universally; treat Codex lifecycle hooks/JSONL and OpenCode events/export as optional adapter evidence, with coverage marked partial whenever data is absent, the stream disconnects, or a supported event was not observed. Do not make Codex's unstable transcript format a required dependency. Compaction completion and crash recovery remain explicit coverage gaps.

## F2 — Isolated headless memory extraction

**Date:** 2026-11-27

**Decision:** Bounded pass for one configured Codex CLI executor on this Linux host. A small explicit checkpoint produced four schema-valid, task-scoped, source-referenced proposals covering a decision, completed work, a failed approach, and a blocker. The proposals retain uncertainty and are labeled `proposed-unverified`. The run does not establish factual correctness or production-grade isolation across platforms.

### Environment and data disclosure

- Host: Linux x86_64 (`7.3.5-arch1-1`); Node.js `v24.22.3`; npm `11.19.1`.
- Selected executor: Codex CLI `0.172.0`; OpenCode `2.4.1` was installed but not used for F2.
- Model: `gpt-6-luna`, explicitly selected with `--model`. Codex authentication came from the existing `CODEX_HOME`; provider diagnostics were not emitted by the runner. Inference used the configured Codex service and requires network access.
- The only model input was the synthetic checkpoint JSON, its synthetic project/task/session references, and a disposable repository containing one short cache-policy fixture file. No private source, user conversation, session transcript, credentials, or actual user project data was supplied or committed. The provider received the checkpoint content and references for inference; the fixture directory was available to the sandboxed CLI, though extraction prompts instructed the model not to inspect files.
- The runner used `--ignore-user-config` to prevent inheriting user-level hooks, `--ephemeral` to avoid persisting Codex session files, and `--sandbox read-only`. Project fixture contained no Codex/OpenCode hooks. A separate deliberate write probe received `Read-only file system`; the requested file remained absent.

### Contract and behavior

`src/extraction.ts` defines a spike-only `CheckpointInput` contract with project/task/session references, bounded checkpoint text, one or more source links, a complete/partial coverage label, and required uncertainty. Zod rejects unknown fields and bounds input to 16 KiB. This follows F1's explicit checkpoint and source-attribution concepts; it is an experiment contract, not a frozen production or F1 fixture schema.

The output schema accepts at most eight short proposals. Each proposal has a decision/outcome/failed-approach/blocker category, claim, exact project/task scope, one or more evidence references, and uncertainty. Every output reference must exactly match a supplied input source link; mismatched scope or fabricated references fail the extraction. Accepted records receive `proposed-unverified`. This allowlist check proves only that a reference was supplied: it does not prove the source supports the claim, verify arbitrary repository paths/line ranges, or independently validate the underlying fact.

The subprocess adapter uses Effect for interruptible orchestration and typed failures, Node `spawn` without a shell, and Zod for both external input and model output. It bounds input at 16 KiB, combined stdout/stderr at 32 KiB by default, and execution to at most 120 seconds (90 seconds in the real runner). On POSIX, it starts a separate process group, sends TERM, waits up to 500 ms for `close`, sends KILL to the group if needed, and waits up to 2 seconds for `close` before reporting timeout or output-limit failure. Effect interruption also awaits this termination finalizer. If closure is not observed by the deadline, the operation reports `CLEANUP_FAILED`; cancellation fails its finalizer instead of claiming cleanup. The Windows path signals only the direct child and was not tested. A deliberately detached descendant that does not inherit the executor's pipes can escape group tracking; this spike does not promise cleanup of such processes. It performs no retries. A SHA-256 key over the normalized input is stable for identical input; it is a candidate deduplication key only, with no persistence or durable deduplication in this spike.

The example input is [probes/extraction-input.example.json](../probes/extraction-input.example.json). Reproduce in a disposable, non-sensitive Git repository containing `src/cache-policy.md`:

```sh
node --experimental-strip-types probes/run-extraction.ts /path/to/checkpoint.json /path/to/disposable-repo
```

The runner invokes:

```sh
codex exec --ignore-user-config --ephemeral --sandbox read-only --json \
  --model gpt-6-luna -C /path/to/disposable-repo '<bounded extraction prompt and checkpoint JSON>'
```

Input and output are validated in-process. The runner prints only the idempotency key and validated proposals; it does not persist raw agent JSONL or transcripts.

### Sanitized real extraction evidence

Two repeated runs with the same checkpoint and explicit model had the same input key (`eb4f9262…e26fe`) and the same four proposal categories; wording varied. A third explicit-model run also passed. The accepted trace included:

```json
[
  {"category":"decision","claim":"The checkpoint records a decision to use a bounded in-memory cache with a 30 second TTL.","scope":{"projectId":"project-demo","taskId":"task-cache-policy"},"evidenceRefs":["session-checkpoint-001#checkpoint"],"uncertainty":"This was recorded for one disposable experiment; production workload and invalidation behavior are not verified.","status":"proposed-unverified"},
  {"category":"outcome","claim":"Lookup and expiry behavior were implemented in the disposable fixture.","scope":{"projectId":"project-demo","taskId":"task-cache-policy"},"evidenceRefs":["session-checkpoint-001#checkpoint"],"uncertainty":"The checkpoint does not verify behavior in production.","status":"proposed-unverified"},
  {"category":"failed-approach","claim":"An unbounded map retained expired keys during the first experiment.","scope":{"projectId":"project-demo","taskId":"task-cache-policy"},"evidenceRefs":["session-checkpoint-001#checkpoint"],"uncertainty":"This refers to the first experiment only.","status":"proposed-unverified"},
  {"category":"blocker","claim":"Production invalidation semantics remain undecided.","scope":{"projectId":"project-demo","taskId":"task-cache-policy"},"evidenceRefs":["session-checkpoint-001#checkpoint"],"uncertainty":"The checkpoint says production invalidation behavior is not verified.","status":"proposed-unverified"}
]
```

These are proposals attributed to the supplied checkpoint, not independently verified facts. Although the input also linked `src/cache-policy.md`, the model selected the checkpoint reference for each item; the run did not demonstrate claim-level file citation selection. The fixture file hash was `969eb686bb22f711392754ed695f9399dcf43b452b15adb0b0dab1681a08e63f` before and after. Git status was clean before and after, and the deliberate `write-probe.txt` sandbox test failed with `Read-only file system`; no repository file changed.

### Failure and repeatability evidence

`npm test` covers the following deterministic cases: invalid/oversized checkpoint and executor configuration; schema-valid output; stable input key; fabricated source and mismatched-scope rejection; malformed output; unavailable CLI; nonzero exit; timeout; oversized combined stdout/stderr; and cancellation with child-process termination. There are no retry attempts. The real repeated run confirms stable key and category set, not deterministic wording or semantic correctness.

### Limits and F3 candidate boundary

- Codex's read-only sandbox blocked the tested write attempt on this Linux host. The adapter is only protected when configured with the corresponding harness permission; arbitrary custom executors and other operating systems are not sandboxed or verified by this code. Prompts alone provide no isolation.
- `--ignore-user-config` disabled inherited user hooks in this experiment; the fixture had no project hooks. The runner is invoked explicitly and does not register a capture hook, start a Memories capture service, or feed its own session into extraction. This is evidence for this execution path, not a system-wide recursion guarantee.
- The Node caller awaits extraction, though the child runs independently and does not block the Node event loop. No foreground coding harness or durable worker/queue was running, and foreground-session responsiveness was not measured end-to-end.
- No durable checkpoint/job store, deduplication persistence, retries, provider fallback, arbitrary citation verification, broad harness support, cross-platform guarantee, or complete privacy/retention review was implemented. Model wording and semantic quality remain nondeterministic.
- Before F3, keep the smallest boundary as a validated agent-independent checkpoint plus a configured executor accepting bounded input and returning validated proposals. Make sandbox enforcement an explicit executor capability/configuration and keep proposals separate from independently verified claims. Defer durable scheduling and cross-agent continuation as issue #5 requires.

### Validation result

On the original F2 checkout, `npm test` passed (7 tests), `npm run check` passed, and `npm run build` passed. The real Codex extraction ran three times; the repeated explicit-model runs had stable input IDs, all four expected categories, varied wording, validated references/scope, and no sample repository mutation. The intentional sandbox write was denied. These results support a bounded F2 pass on the tested host; cross-platform enforcement, end-to-end foreground responsiveness, and factual verification remain untested.

### PR #6 subprocess cleanup follow-up

Review reproduced that the original TERM path settled timeout, cancellation, and output-limit outcomes before the child had exited. Regression tests now use TERM-ignoring parent and descendant processes and assert that extraction does not settle until the POSIX process group closes. The tests also cover a detached descendant that holds inherited pipes open beyond the cleanup deadline; that case reports `CLEANUP_FAILED` rather than a timeout success/failure that implies cleanup completed. This follow-up changes only the F2 subprocess boundary and tests; it adds no durable worker or scheduler.

Validation after the review correction: `npm test` passes (9 total tests: 8 extraction cases and the scaffold smoke test), `npm run check` passes, and `npm run build` passes. The subprocess lifecycle tests also pass directly with `node --experimental-strip-types --test tests/extraction.test.ts`. They cover timeout, cancellation, output limit, TERM-to-KILL escalation, group closure, and explicit bounded cleanup failure. Cross-platform process-tree termination remains unverified.

## F3 — Cross-agent task continuation

**Date:** 2026-11-27
**Decision:** Bounded pass on Linux x86_64. A real Codex session partially implemented a synthetic feature, saved a structured checkpoint to SQLite, and ended. A separate OpenCode session explicitly loaded that task packet and completed the next testable feature step. It received the store-produced packet as an attachment; it did not receive Codex's native conversation history. This establishes feasibility for explicit checkpoint continuity in this experiment, not automatic capture or general continuation quality.

### Environment and data handling

- Host: Linux x86_64 (`7.3.5-arch1-1`); Node.js `v24.22.3`.
- Codex CLI `0.172.0`: `--ephemeral --sandbox workspace-write --json`.
- OpenCode `v2.4.1`: `--standalone --auto --format json --file <loaded-packet>`.
- The synthetic repository came from `node probes/create-f3-fixture.mjs`; it contained a small label parser and one baseline test. No user source, private task data, or credentials were used. Providers received only synthetic task/checkpoint/fixture content. Provider/model identity was not captured in sanitized evidence.
- Codex's native session was ephemeral. Its JSONL and final response were temporary files outside the fixture and deleted before OpenCode started. The SQLite database and checkpoint were also outside the fixture. OpenCode received the result of an explicit project/task `load` as an attachment. No Codex transcript was made available to it.
- Checkpoint statements are attributed to Codex and source paths, not independently verified facts. The store reports `saved`, not extracted or verified.

### Minimal boundary and observed continuation

`src/continuation.ts` is a spike-only SQLite store with Zod validation. It records the exact project/task key, objective, session agent/workspace, explicit coverage, bounded progress/decisions/blockers/next steps, and source references. `save` commits before returning `saved`; identical retries are idempotent. `load(projectId, taskId)` returns only the requested scope with explicit limitations. Unknown tasks return no packet. It does not store native messages, verify source truth, or implement a production registry.

This is direct checkpoint persistence and retrieval. The F2 headless extraction runner is not used as the active Codex session, persistence layer, or continuation manager; no extraction is claimed.

`probes/continuation-store.ts` exposes `register`, `save`, and `load`; `save -` reads checkpoint JSON from stdin so the active agent can submit it directly. Automated tests cover close/reopen durability, duplicate retry, project/task isolation, unknown task, foreign-key rejection, partial coverage without evidence, and malformed input. `probes/assert-f3-save-before-handoff.mjs` verifies that Codex JSONL contains a successful `saved` receipt from a checkpoint-save command before `turn.completed`.

In the follow-up run, the registered task objective was intentionally generic. The real Codex session implemented quoted-comma parsing and one focused test. Before its turn ended, it authored a structured checkpoint from the work it had just done and piped it into `save -`. The Codex tool event recorded receipt `8dc043674cf9d4e7fd6b085bf61922dca9e59f8614246f3f7bc6b78ddceeb90d`; the trace assertion found the save receipt at event index 19 and `turn.completed` at index 21. After Codex exited, a separate CLI process loaded the SQLite database and returned one checkpoint in a 2,002-byte packet. The Codex native session was ephemeral; its raw JSONL and final message were deleted before either OpenCode run. The checkpoint uses the explicit experiment alias `codex-f3-origin-01`, not a native Codex thread ID; the event trace ties the save command to the Codex turn that completed afterward.

The checkpoint included a task-specific decision absent from both the registered objective and fixture: legacy labels beginning with `@` are opaque text and must be preserved exactly. It also recorded the unresolved doubled-quote blocker and next step. To test whether the loaded packet contributed information, I ran a no-packet control in a copy of the exact post-Codex fixture with the same neutral OpenCode prompt. That agent inferred quoted-field behavior from the source and tests, added general edge-case tests, and did not mention or test the `@` constraint. In the separate target run, OpenCode received the explicit `load` packet with the same neutral prompt. Before editing, it attributed the doubled-quote next step and the `@` preservation decision to the checkpoint; it then added a focused `@literal` regression alongside the escaped-quote test. Thus the no-packet control did not recover the distinguishing decision, while the loaded run stated and tested it. This supports a bounded causal contribution from the retrieved checkpoint; it does not prove the model could never guess the rule.

The fixture suite passed 2/2 after Codex, 7/7 in the no-packet control copy, and 4/4 in the packet-loaded continuation. The target fixture changed only `src/labels.mjs` and `test/labels.test.mjs`. Reverse OpenCode → Codex continuation was not run.

### Reproduction

Requires Node.js 22+ with `node:sqlite`, Git, `jq`, both CLIs, and configured providers. Run at the repository root in a disposable environment. This records a checkpoint from within the live Codex session, verifies the saved receipt precedes turn completion, and compares a neutral OpenCode run with and without the loaded packet.

```sh
set -eu
repo="$(git rev-parse --show-toplevel)"
demo="$(node probes/create-f3-fixture.mjs)"
evidence="$(mktemp -d /tmp/memories-f3.XXXXXX)"
db="$evidence/continuation.sqlite"
node --experimental-strip-types "$repo/probes/continuation-store.ts" register "$db" \
  f3-label-parser-causal-demo task-f3-checkpoint-causal \
  'Implement a comma-separated label parser in the disposable F3 fixture.'

cd "$demo"
codex exec --ignore-user-config --ephemeral --sandbox workspace-write \
  --add-dir "$evidence" --json -C "$demo" -o "$evidence/codex-last.txt" \
  "Implement quoted-comma parsing and one focused test in this fixture. Full behavior also requires preserving quoted whitespace, trimming unquoted values, decoding doubled quotes, preserving empty fields, and treating a leading @ as ordinary label text without normalization. Leave doubled-quote escaping unresolved. Do not commit. Before ending this same session, build a partial source-attributed checkpoint from the work and tests you actually performed. Save it to registered project f3-label-parser-causal-demo, task task-f3-checkpoint-causal by running: node --experimental-strip-types $repo/probes/continuation-store.ts save $db -. Send the JSON on stdin; use session id codex-f3-origin-01 and workspace disposable-git-fixture. Include the @ preservation decision, unresolved blocker, next step, and file references. Wait for and report the saved receipt before ending. Do not claim unperformed tests or work." \
  > "$evidence/codex-events.jsonl"
```

The Codex prompt tells the active session to author JSON from its observed work and submit it on stdin; it does not use `probes/continuation-checkpoint.example.json`. `--add-dir` grants access to the external evidence directory. After Codex exits, assert the ordering and retrieve the durable record through a new CLI process:

```sh
cd "$repo"
node probes/assert-f3-save-before-handoff.mjs "$evidence/codex-events.jsonl" \
  > "$evidence/save-before-handoff.json"
node --experimental-strip-types probes/continuation-store.ts load "$db" \
  f3-label-parser-causal-demo task-f3-checkpoint-causal > "$evidence/load-packet.json"
cat "$evidence/save-before-handoff.json"
wc -c "$evidence/load-packet.json"
```

Delete the raw Codex JSONL and final response before either OpenCode run. Use this exact neutral request in both sessions; the control receives no packet, and the target receives the explicit `load` output as an attachment:

```sh
node -e 'const fs=require("node:fs"); for(const p of process.argv.slice(1)) fs.unlinkSync(p)' \
  "$evidence/codex-events.jsonl" "$evidence/codex-last.txt"
control="$evidence/no-packet-fixture"
cp -a "$demo" "$control"
open_prompt='Continue this task using the available context and the current workspace. Inspect the repository, decide what to do next, implement it, and run relevant tests. Before editing, briefly state the specific task requirement guiding your change and where that requirement came from. Do not consult or reconstruct prior conversation.'
cd "$control"
opencode run --standalone --auto --format json "$open_prompt" > "$evidence/no-packet.jsonl"
npm test
cd "$demo"
opencode run --standalone --auto --format json --file "$evidence/load-packet.json" \
  "$open_prompt" > "$evidence/loaded-packet.jsonl"
npm test
git diff --check
```

Review the two responses and diffs. In this run, the no-packet session relied on repository evidence and did not recover or test the opaque-`@` rule. The packet-loaded session attributed that rule and the next step to the checkpoint, then added a regression for the rule. The two fixture copies start from the same post-Codex files; raw OpenCode logs should remain local and be removed after recording sanitized results.

### Validation and limits

On this checkout, `npm test` passes (15 tests: 6 continuation-store, 8 extraction, 1 scaffold); `npm run check` and `npm run build` pass. The live feature tests passed 2/2 after Codex, 7/7 in the no-packet control, and 4/4 in the loaded-packet run; fixture `git diff --check` passed. The trace assertion reported `savedBeforeHandoff: true`, and the later process loaded one checkpoint from SQLite.

This is not a production design. There was no reverse-direction run, native capture, automatic task association, source-claim verification, crash test beyond database close/reopen, FTS/search, or production migration. The built-in `node:sqlite` implementation was verified only on this Linux host. The checkpoint session ID is an experiment alias, not the harness-native thread ID; event-order evidence links the save to the originating Codex turn. A no-packet agent may still independently discover implementation work; this control specifically failed to surface the checkpoint-only `@` rule. Agent wording/diffs can vary. No architecture amendment is proposed; F4 should measure retrieval beyond exact project/task loading.
