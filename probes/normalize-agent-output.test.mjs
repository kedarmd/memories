import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const normalizer = new URL("./normalize-agent-output.mjs", import.meta.url).pathname;
const summarizer = new URL("./summarize-opencode-jsonl.mjs", import.meta.url).pathname;
const response = {
  objective: "Add a decrement operation to the sample counter",
  decision: "Use a pure subtraction function",
  completed: "Inspected src/counter.ts without changes",
  failed_attempt: "No implementation attempt was made",
  blocker: "Confirm behavior for negative decrement amounts",
  evidence: [{ kind: "file", ref: "src/counter.ts" }],
};

function run(harness, event) {
  return spawnSync(process.execPath, [normalizer, harness], {
    input: `${JSON.stringify(event)}\n`,
    encoding: "utf8",
  });
}

test("normalizes a Codex agent message and preserves source evidence", () => {
  const result = run("codex", {
    type: "item.completed",
    thread_id: "thread-fixture",
    item: { type: "agent_message", text: JSON.stringify(response) },
  });
  assert.equal(result.status, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.session.harness, "codex");
  assert.deepEqual(checkpoint.evidence, [{ kind: "file", ref: "src/counter.ts" }]);
  assert.deepEqual(checkpoint.blockers, [response.blocker]);
});

test("normalizes an OpenCode text event with array-shaped evidence", () => {
  const result = run("opencode", {
    type: "text",
    sessionID: "session-fixture",
    part: { text: JSON.stringify(response) },
  });
  assert.equal(result.status, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.session.harness, "opencode");
  assert.deepEqual(checkpoint.evidence, [{ kind: "file", ref: "src/counter.ts" }]);
});

test("OpenCode response summarizer detects source paths in evidence arrays", () => {
  const result = spawnSync(process.execPath, [summarizer], {
    input: `${JSON.stringify({
      type: "text",
      sessionID: "session-fixture",
      part: {
        type: "text",
        text: JSON.stringify({ evidence: [{ kind: "file", ref: "src/counter.ts" }] }),
      },
    })}\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sourcePathPresent, true);
});
