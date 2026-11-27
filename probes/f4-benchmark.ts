import { F4Retrieval } from "../src/retrieval-f4.ts";
import { queries, records } from "./f4-fixture.ts";

const db = new F4Retrieval();
db.seed(records);
const k = 5;
const started = performance.now();
const rows = queries.map((query) => {
  const before = performance.now();
  const { id, expected: _expected, ...input } = query;
  const results = db.search({ ...input, limit: k });
  const latencyMs = performance.now() - before;
  const expected = [...query.expected];
  const actual = results.map((r) => r.id);
  const hits = expected.filter((id) => actual.includes(id)).length;
  const falsePositives = actual.filter((id) => !expected.includes(id)).length;
  return {
    id, expected, actual, hits, expectedCount: expected.length, falsePositives,
    recall: expected.length ? hits / expected.length : null,
    latencyMs: Number(latencyMs.toFixed(3)),
    chars: results.reduce((n, r) => n + r.text.length, 0),
    tokenEstimate: Math.ceil(results.reduce((n, r) => n + r.text.length, 0) / 4),
    citationsPresent: results.filter((r) => Boolean(r.source)).length,
    citationsValid: results.filter((r) => Boolean(r.source && r.sourceExists)).length,
    wrongScope: results.filter((r) => r.projectId !== query.projectId || (r.taskId !== null && r.taskId !== query.taskId)).length,
    lifecycleLeak: !("historical" in query && query.historical) ? results.filter((r) => r.lifecycle !== "active").length : 0,
  };
});
const nonEmpty = rows.filter((r) => r.expectedCount > 0);
const hitCount = nonEmpty.reduce((n, r) => n + r.hits, 0);
const expectedCount = nonEmpty.reduce((n, r) => n + r.expectedCount, 0);
const report = {
  environment: { node: process.version, sqlite: process.versions.sqlite, fts5: "available; unicode61 tokenizer" },
  config: { k, candidateLimit: 50, queryMode: "unicode letters/numbers split into quoted OR terms", scoring: "BM25 lexical + active lifecycle + existing citation + relative freshness; id tie-break" },
  metrics: {
    recallAt5: expectedCount ? hitCount / expectedCount : 0,
    precisionAt5: rows.reduce((n, r) => n + r.hits, 0) / Math.max(1, rows.reduce((n, r) => n + r.actual.length, 0)),
    labeledRelevant: expectedCount, retrievedRelevant: hitCount,
    falsePositiveResults: rows.reduce((n, r) => n + r.falsePositives, 0),
    wrongScope: rows.reduce((n, r) => n + r.wrongScope, 0),
    lifecycleLeak: rows.reduce((n, r) => n + r.lifecycleLeak, 0),
    citationsPresent: rows.reduce((n, r) => n + r.citationsPresent, 0),
    citationsValid: rows.reduce((n, r) => n + r.citationsValid, 0),
    totalCharacters: rows.reduce((n, r) => n + r.chars, 0),
    approximateTokens: rows.reduce((n, r) => n + r.tokenEstimate, 0),
    queryLatencyMs: { mean: Number((rows.reduce((n, r) => n + r.latencyMs, 0) / rows.length).toFixed(3)), total: Number((performance.now() - started).toFixed(3)) },
  }, queries: rows,
};
console.log(JSON.stringify(report, null, 2));
db.close();
