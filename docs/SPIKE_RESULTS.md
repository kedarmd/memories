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
