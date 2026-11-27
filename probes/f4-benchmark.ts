import { F4Retrieval } from "../src/retrieval-f4.ts";
import { queries, records } from "./f4-fixture.ts";

const db = new F4Retrieval();
db.seed(records);
const started = performance.now();
const rows = queries.map((query) => {
  const before = performance.now();
  const { id, expected: _expected, ...input } = query;
  const results5 = db.search({ ...input, limit: 5 });
  const latencyMs = performance.now() - before;
  const expected = [...query.expected];
  const actual3 = results5.slice(0, 3).map((r) => r.id);
  const actual5 = results5.map((r) => r.id);
  const hits3 = expected.filter((id) => actual3.includes(id)).length;
  const hits5 = expected.filter((id) => actual5.includes(id)).length;
  const falsePositives3 = actual3.filter((recordId) => !expected.includes(recordId)).length;
  const falsePositives5 = actual5.filter((recordId) => !expected.includes(recordId)).length;
  return {
    id, expected, actual3, actual5, hits3, hits5, expectedCount: expected.length,
    falsePositives3, falsePositives5,
    recall3: expected.length ? hits3 / expected.length : null,
    recall5: expected.length ? hits5 / expected.length : null,
    latencyMs: Number(latencyMs.toFixed(3)),
    chars: results5.reduce((n, r) => n + r.text.length, 0),
    tokenEstimate: Math.ceil(results5.reduce((n, r) => n + r.text.length, 0) / 4),
    citationsPresent: results5.filter((r) => Boolean(r.source)).length,
    citationsValid: results5.filter((r) => Boolean(r.source && r.sourceExists)).length,
    wrongScope: results5.filter((r) => r.projectId !== query.projectId || (r.taskId !== null && r.taskId !== query.taskId)).length,
    lifecycleLeak: !("historical" in query && query.historical) ? results5.filter((r) => r.lifecycle !== "active").length : 0,
  };
});
const nonEmpty = rows.filter((r) => r.expectedCount > 0);
const hitCount3 = nonEmpty.reduce((n, r) => n + r.hits3, 0);
const hitCount5 = nonEmpty.reduce((n, r) => n + r.hits5, 0);
const expectedCount = nonEmpty.reduce((n, r) => n + r.expectedCount, 0);
const retrieved3 = rows.reduce((n, r) => n + r.actual3.length, 0);
const retrieved5 = rows.reduce((n, r) => n + r.actual5.length, 0);
const report = {
  environment: { node: process.version, sqlite: process.versions.sqlite, fts5: "available; unicode61 tokenizer" },
  config: { k: [3, 5], candidateLimit: 50, queryMode: "unicode letters/numbers split into quoted OR terms", scoring: "ascending raw BM25 (more-negative first); lifecycle/evidence/freshness only break BM25 ties; id final tie-break" },
  metrics: {
    recallAt3: expectedCount ? hitCount3 / expectedCount : 0,
    precisionAt3: hitCount3 / Math.max(1, retrieved3),
    recallAt5: expectedCount ? hitCount5 / expectedCount : 0,
    precisionAt5: hitCount5 / Math.max(1, retrieved5),
    labeledRelevant: expectedCount, retrievedRelevantAt3: hitCount3, retrievedRelevantAt5: hitCount5,
    falsePositiveResultsAt3: rows.reduce((n, r) => n + r.falsePositives3, 0),
    falsePositiveResultsAt5: rows.reduce((n, r) => n + r.falsePositives5, 0),
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
