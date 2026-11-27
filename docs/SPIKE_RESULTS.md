# Feasibility Spike Results — F1 Session Capture

| Environment | Value |
|---|---|
| Run date | 2026-11-27 |
| Host | Linux x86_64, kernel `7.3.5-arch1-1` |
| Runtime | Node.js `v24.22.3` |
| Codex | `codex-cli 0.172.0` |
| OpenCode | `v2.4.1` |

## Scope and decision

F1 tested short, synthetic interactions in a disposable Git repository containing only a counter example. Model requests used non-sensitive sample code and asked the agents not to modify files. Probe output deliberately records event types, a few lifecycle enum values, and field-presence flags, not prompts, assistant text, tool arguments, filesystem paths, or raw session IDs.

**F1 result: bounded pass on this Linux host.** Both installed harnesses produced attributable session activity, and the explicit foreground checkpoint fallback accepts a bounded source-attributed payload. This establishes feasibility for the tested versions and host only. It does not establish complete capture, crash durability, or cross-platform support.

No architecture amendment is needed: the evidence supports the existing proposal to keep capture adapters at the edge, treat native capture as capability-specific, and retain explicit foreground checkpoints as the portable fallback. The fallback shape below is a probe contract only; it does not freeze F2's `CheckpointInput` contract.

## Environment and data handling

The sample repository was created under `/tmp`, initialized with Git, and contained `src/counter.ts` with one pure `add` function. The probes ran read-only prompts. `codex exec` used `--sandbox read-only`; the OpenCode prompts requested no tools or edits. OpenCode session exports used `--sanitize`. No user project files, raw transcripts, API credentials, or session IDs were committed. Probe logs contain event names, limited lifecycle enum values, and field-presence booleans.

The agent calls use the locally configured model providers. No private source was supplied. A developer reproducing the calls should use an equally disposable repository and confirm their provider's data handling before sending any non-public content.

## Capability matrix

| Capability | Codex 0.172.0 | OpenCode 2.4.1 |
|---|---|---|
| MCP configuration | CLI exposes `codex mcp`; not connected to a Memories server in F1 | CLI exposes `opencode mcp`; not connected to a Memories server in F1 |
| Session identity and resume | Observed JSONL `thread.started` with an ID; temp project hooks received a session ID. `codex exec resume` is available in CLI help; resume was not exercised in this disposable run. | Observed session ID in JSON events; `session list` found both normal and interrupted runs; `run --session <id>` resumed them and sanitized export returned messages. |
| Lifecycle / execution events | Observed `SessionStart` (`source=startup`), `UserPromptSubmit`, and `SessionEnd` hooks. Hook inputs reported a session ID and prompt presence. | Observed `session.execution.started`, `session.text.ended`, and `session.execution.succeeded`, each with a session ID in the plugin event payload. |
| Message / tool content | Observed `codex exec --json` agent-message items with text. The probe discarded the text. Hook `transcript_path` was absent in the ephemeral run; official docs describe it as optional and its format as unstable. | Observed response text in JSONL and `session.text.ended`; the probe discarded text. Sanitized CLI export returned a projected transcript (six messages after the resume probe). |
| Structured handoff shape | A read-only sample prompt produced the expected six JSON field names (`objective`, `decision`, `completed`, `failed_attempt`, `blocker`, `evidence`) and a source-path reference; the summarizer retained only field-presence flags. | A read-only sample prompt produced the same six JSON field names and a `src/counter.ts` reference; the summarizer retained only field-presence flags. |
| Compaction | Not triggered. Current hooks docs list `PreCompact`, `PostCompact`, and `SessionStart` with `source=compact`; runtime not verified. | Compaction API request returned an accepted `delivery=steer` response. Completion was not observed, so compaction success and event delivery remain unverified. |
| Normal end | `SessionEnd` observed for the ephemeral `codex exec` process. | `session.execution.succeeded` observed and `opencode run` returned; no separate session-end event was observed. |
| Abrupt termination | A 3-second TERM timeout was attempted against `codex exec --ephemeral`. The process emitted thread/turn-start JSONL events and exited with timeout status 124, but no hook summary was written before termination. This did not establish session recovery or crash behavior. | A 3-second TERM timeout produced `session.execution.interrupted` with a session ID present. The same listed session was then resumed by ID and sanitized export returned messages. This verifies interruption/resume for this run, not recovery from an OS crash or power loss. |
| Prolonged idle / idle resume | Not exercised. | Not exercised. |
| Permissions | Codex request ran with read-only sandbox. The disposable project was trusted with `--trust`, and its test hook used `--dangerously-bypass-hook-trust` to avoid interactive hook review. Both are limited to the isolated fixture. | Prompt did not invoke a tool. The standalone server's API was bound to `127.0.0.1`; a local test password was used and not retained in the repository. |
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

OpenCode `run --format json` and Codex `exec --json` also emitted structured response items. `summarize-*-jsonl.mjs` records only the item type, a fixed allowlist of JSON field names, and whether the source reference matched the disposable sample path. The content itself was not copied into evidence.

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
codex exec --ephemeral --trust --dangerously-bypass-hook-trust --sandbox read-only --json -C "$probe_dir/sample" \
  'Inspect src/counter.ts for a proposed decrement function. Do not modify files or run tools. Return a compact checkpoint with objective, decision, completed status, failed approach, unresolved blocker, and source path. Do not claim tests were run.' \
  | node /absolute/path/to/memories/probes/summarize-codex-jsonl.mjs
cat "$F1_PROBE_LOG"
```

For OpenCode, copy `probes/opencode-event-probe.ts` to `$probe_dir/sample/.opencode/plugins/`, then run:

```sh
export F1_PROBE_LOG="$probe_dir/opencode-events.jsonl"
cd "$probe_dir/sample"
opencode run --standalone --format json \
  'Inspect src/counter.ts for a proposed decrement function. Do not modify files or run tools. Return a compact checkpoint with objective, decision, completed status, failed approach, unresolved blocker, and source path. Do not claim tests were run.' \
  | node /absolute/path/to/memories/probes/summarize-opencode-jsonl.mjs
cat "$F1_PROBE_LOG"
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

In this run, `timeout` returned status `124`; the plugin observed `session.execution.interrupted`, after which the listed session resumed and sanitized export contained messages. Codex's corresponding timeout emitted `thread.started` and `turn.started` before status `124`, but produced no hook summary and was ephemeral, so it did not demonstrate recovery.

The exact run performed for Codex and OpenCode used a disposable fixture and both returned successful agent-message/text items. Codex also emitted two JSONL error items whose message bodies were intentionally not retained; the turn completed. Their causes were not independently identified. This is an unresolved observation, not evidence of a successful capture path for those errors.

## Explicit foreground checkpoint fallback

When a harness cannot expose authorized, stable session content, the active agent can submit a structured checkpoint directly. `probes/validate-checkpoint.mjs` bounds JSON input to 16 KiB, rejects unknown fields, requires a session reference and explicit coverage label, and validates decisions, outcomes, blockers, and source references. It emits `validated-only`; it does not persist, extract, or claim that a checkpoint was saved.

Reproduce the validation and tests:

```sh
node probes/validate-checkpoint.mjs < probes/checkpoint-example.json
node --test probes/checkpoint.test.mjs
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

Proceed to owner review of F1. Candidate F2 boundary: accept explicit structured checkpoints universally; treat Codex lifecycle hooks/JSONL and OpenCode events/export as optional adapter evidence, with coverage marked partial whenever data is absent, the stream disconnects, or a supported event was not observed. F2 must not read Codex's undocumented transcript format as a required dependency. Compaction completion and abrupt termination remain explicit coverage gaps.
