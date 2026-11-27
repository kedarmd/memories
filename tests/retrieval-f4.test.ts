import assert from "node:assert/strict";
import test from "node:test";
import { F4Retrieval } from "../src/retrieval-f4.ts";
import { queries, records } from "../probes/f4-fixture.ts";

function seeded(): F4Retrieval { const db = new F4Retrieval(); db.seed(records); return db; }

test("F4 benchmark has deterministic, scoped, lifecycle-aware results", () => {
  const db = seeded();
  try {
    let expectedAt3 = 0;
    let expectedAt5 = 0;
    let labeled = 0;
    for (const q of queries) {
      const { id: _id, expected, ...input } = q;
      const first = db.search({ ...input, limit: 5 });
      const second = db.search({ ...input, limit: 5 });
      assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id), q.id);
      if (expected.length > 0) {
        labeled += expected.length;
        expectedAt3 += expected.filter((id) => first.slice(0, 3).some((r) => r.id === id)).length;
        expectedAt5 += expected.filter((id) => first.some((r) => r.id === id)).length;
      }
      assert.deepEqual(first.filter((r) => r.projectId !== q.projectId || (r.taskId !== null && r.taskId !== q.taskId)), []);
      if (!("historical" in q && q.historical)) assert.ok(first.every((r) => r.lifecycle === "active"));
      assert.ok(first.every((r) => r.uncertainty.length > 0));
      assert.ok(first.every((r) => !r.source || typeof r.sourceExists === "boolean"));
      assert.ok(expected.every((id) => typeof id === "string"));
    }
    assert.ok(db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"no expiration", historical:true }).some((r) => r.id === "t1-old-ttl"));
    assert.equal(db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"network retry" }).length, 0);
    assert.equal(expectedAt3, 9);
    assert.equal(expectedAt5, 10);
    assert.equal(labeled, 11);
  } finally { db.close(); }
});

test("F4 query validation, empty tokens, and result/candidate bounds", () => {
  const db = seeded();
  try {
    assert.deepEqual(db.search({ projectId:"proj-atlas", taskId:"task-cache", query:" !!! " }), []);
    assert.throws(() => db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"" }));
    assert.throws(() => db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"x".repeat(301) }));
    assert.throws(() => db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"cache", limit:11 }));
    assert.ok(db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"cache", limit:10 }).length <= 10);
    assert.deepEqual(db.search({ projectId:"proj-atlas", taskId:"task-cache", query:"cache OR *" }).length >= 0, true);
  } finally { db.close(); }
});

test("F4 ties use stable ID ordering and returned records carry citation status and uncertainty", () => {
  const db = new F4Retrieval();
  try {
    db.seed([
      { id:"z",projectId:"p",taskId:"t",kind:"decision",lifecycle:"active",text:"alpha beta",source:null,sourceExists:false,updatedAt:"2026-01-01T00:00:00.000Z" },
      { id:"a",projectId:"p",taskId:"t",kind:"decision",lifecycle:"active",text:"alpha beta",source:"source#section",sourceExists:false,updatedAt:"2026-01-01T00:00:00.000Z" },
    ]);
    const result = db.search({ projectId:"p",taskId:"t",query:"alpha beta",limit:2 });
    assert.deepEqual(result.map((r) => r.id), ["a", "z"]);
    assert.equal(result[0]?.sourceExists, false);
    assert.match(result[0]?.uncertainty ?? "", /not verified/);
  } finally { db.close(); }
});

test("BM25 relevance ranks a stronger lexical match above an equally scoped and cited weaker match", () => {
  const db = new F4Retrieval();
  try {
    db.seed([
      { id:"weak",projectId:"p",taskId:"t",kind:"decision",lifecycle:"active",text:"cache notes mention unrelated behavior",source:"source#same",sourceExists:true,updatedAt:"2026-01-01T00:00:00.000Z" },
      { id:"strong",projectId:"p",taskId:"t",kind:"decision",lifecycle:"active",text:"cache invalidation after account update succeeds",source:"source#same",sourceExists:true,updatedAt:"2026-01-01T00:00:00.000Z" },
    ]);
    const result = db.search({ projectId:"p",taskId:"t",query:"cache invalidation account update",limit:2 });
    assert.deepEqual(result.map((r) => r.id), ["strong", "weak"]);
    assert.ok(result[0]!.score > result[1]!.score);
  } finally { db.close(); }
});
