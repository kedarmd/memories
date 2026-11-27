import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContinuationStore, type ContinuationCheckpoint } from "../src/continuation.ts";

describe("durable task continuation", () => {
  let directory: string;
  let database: string;
  let store: ContinuationStore;
  const checkpoint: ContinuationCheckpoint = {
    projectId: "project-a", taskId: "task-1",
    session: { id: "session-codex", agent: "codex", workspace: "/tmp/fixture" },
    objective: "Implement the requested feature",
    completed: ["Added the partial parser"],
    decisions: ["Quoted separators are data and must not split fields"],
    blockers: ["Escaped quotes remain unresolved"],
    next: ["Handle doubled quote escapes and add a focused test"],
    evidence: [{ kind: "file", ref: "src/parser.ts" }],
    coverage: "partial", createdAt: "2026-11-27T12:00:00.000Z",
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "memories-f3-"));
    database = join(directory, "continuation.sqlite");
    store = new ContinuationStore(database);
    store.registerTask("project-a", "task-1", checkpoint.objective);
  });
  afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

  it("survives closing and reopening the database and returns the explicit context packet", () => {
    const saved = store.save(checkpoint);
    assert.equal(saved.state, "saved");
    store.close();
    store = new ContinuationStore(database);
    const packet = store.load("project-a", "task-1");
    assert.equal(packet?.checkpoints[0]?.decisions[0], checkpoint.decisions[0]);
    assert.deepEqual(packet?.limitations, [
      "Explicit checkpoint coverage only; native conversation history is not stored or loaded.",
      "Evidence references are attributed, not independently verified by this store.",
    ]);
  });

  it("does not duplicate an identical retry", () => {
    const first = store.save(checkpoint);
    const second = store.save(checkpoint);
    assert.deepEqual(second, first);
    assert.equal(store.load("project-a", "task-1")?.checkpoints.length, 1);
  });

  it("isolates projects and tasks and reports unknown tasks", () => {
    store.registerTask("project-b", "task-1", "Other project task");
    store.registerTask("project-a", "task-2", "Other task");
    store.save(checkpoint);
    assert.deepEqual(store.load("project-b", "task-1")?.checkpoints, []);
    assert.deepEqual(store.load("project-a", "task-2")?.checkpoints, []);
    assert.equal(store.load("project-missing", "task-1"), undefined);
    assert.equal(store.load("project-a", "task-missing"), undefined);
  });

  it("rejects checkpoints for unregistered tasks and accepts partial coverage with no evidence", () => {
    assert.throws(() => store.save({ ...checkpoint, taskId: "unknown" }));
    const partial = { ...checkpoint, session: { ...checkpoint.session, id: "session-partial" }, evidence: [] };
    assert.equal(store.save(partial).state, "saved");
    assert.equal(store.load("project-a", "task-1")?.checkpoints[0]?.evidence.length, 0);
  });

  it("rejects malformed external checkpoint fields", () => {
    assert.throws(() => store.save({ ...checkpoint, surprise: "not allowed" }));
  });
});
