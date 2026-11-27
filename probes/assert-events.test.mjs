import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const assertScript = new URL("./assert-events.mjs", import.meta.url).pathname;

function runAssertion(harness, records) {
  const directory = mkdtempSync(join(tmpdir(), "memories-events-"));
  const log = join(directory, "events.jsonl");
  try {
    writeFileSync(log, records.map((record) => JSON.stringify(record)).join("\n"));
    return spawnSync(process.execPath, [assertScript, harness, log], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("asserts Codex event presence and attribution without ordering assumptions", () => {
  const result = runAssertion("codex", [
    { event: "SessionEnd", sessionIdPresent: true },
    { event: "UserPromptSubmit", sessionIdPresent: true, promptPresent: true },
    { event: "SessionStart", sessionIdPresent: true },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /events-asserted/);
});

test("asserts OpenCode event presence and attribution without ordering assumptions", () => {
  const result = runAssertion("opencode", [
    { type: "session.execution.succeeded", sessionIDPresent: true },
    { type: "session.text.ended", sessionIDPresent: true },
    { type: "session.execution.started", sessionIDPresent: true },
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a present OpenCode event without session attribution", () => {
  const result = runAssertion("opencode", [
    { type: "session.execution.started", sessionIDPresent: false },
    { type: "session.text.ended", sessionIDPresent: true },
    { type: "session.execution.succeeded", sessionIDPresent: true },
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lacks session attribution/);
});

test("requires attribution for the controlled interruption event when requested", () => {
  const directory = mkdtempSync(join(tmpdir(), "memories-events-"));
  const log = join(directory, "events.jsonl");
  try {
    writeFileSync(
      log,
      [
        { type: "session.execution.started", sessionIdPresent: true },
        { type: "session.text.ended", sessionIdPresent: true },
        { type: "session.execution.succeeded", sessionIdPresent: true },
        { type: "session.execution.interrupted", sessionIdPresent: true },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );
    const result = spawnSync(process.execPath, [assertScript, "opencode", log, "--interrupted"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /session.execution.interrupted/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
