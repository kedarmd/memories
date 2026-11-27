import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const Id = z.string().min(1).max(100);
const QuerySchema = z.object({
  projectId: Id,
  taskId: Id,
  query: z.string().trim().min(1).max(300),
  limit: z.number().int().min(1).max(10).default(5),
  historical: z.boolean().default(false),
}).strict();

export type RetrievalRecord = {
  id: string; projectId: string; taskId: string | null;
  kind: "project-doc" | "decision" | "blocker" | "checkpoint";
  lifecycle: "active" | "superseded" | "invalidated";
  text: string; source: string | null; sourceExists: boolean; updatedAt: string;
};

export type RetrievalResult = RetrievalRecord & { score: number; uncertainty: string };

/** Spike-only, synchronous, read-only-after-seeding SQLite/FTS5 retrieval. */
export class F4Retrieval {
  readonly #db: DatabaseSync;
  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT,
        kind TEXT NOT NULL, lifecycle TEXT NOT NULL, text TEXT NOT NULL,
        source TEXT, source_exists INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_scope ON records(project_id, task_id, lifecycle);
      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(id UNINDEXED, text, tokenize='unicode61');
    `);
  }

  seed(records: RetrievalRecord[]): void {
    const insert = this.#db.prepare(`INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const fts = this.#db.prepare(`INSERT INTO records_fts(id,text) VALUES (?,?)`);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of records) {
        insert.run(r.id, r.projectId, r.taskId, r.kind, r.lifecycle, r.text, r.source, Number(r.sourceExists), r.updatedAt);
        fts.run(r.id, r.text);
      }
      this.#db.exec("COMMIT");
    } catch (e) { this.#db.exec("ROLLBACK"); throw e; }
  }

  search(input: unknown): RetrievalResult[] {
    const q = QuerySchema.parse(input);
    // unicode61 tokenization; quote every token to avoid FTS syntax injection.
    const terms = q.query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (terms.length === 0 || terms.length > 40) return [];
    const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    const life = q.historical ? "1=1" : "r.lifecycle='active'";
    // Eligibility is enforced in SQL before candidate ranking. Task-wide is exact;
    // project docs (task_id NULL) apply across tasks in that project.
    const rows = this.#db.prepare(`
      SELECT r.*, bm25(records_fts, 0, 1.0) AS lexical
      FROM records_fts JOIN records r ON r.id=records_fts.id
      WHERE records_fts MATCH ? AND r.project_id=?
        AND (r.task_id IS NULL OR r.task_id=?) AND ${life}
      ORDER BY lexical ASC, r.id ASC LIMIT 50
    `).all(match, q.projectId, q.taskId) as Array<Record<string, string | number | null>>;
    const newest = Math.max(0, ...rows.map((r) => Date.parse(String(r.updated_at))));
    const ranked = rows.map((r) => {
      // Relative fixture freshness keeps scoring reproducible without a clock dependency.
      const freshness = Math.max(0, 1 - Math.max(0, newest - Date.parse(String(r.updated_at))) / (365 * 86400000));
      // FTS5 BM25 is negative; lower (more negative) is the stronger lexical match.
      // Keep its raw order primary. Other signals break lexical ties only.
      const lexical = Number(r.lexical);
      const lifecycle = r.lifecycle === "active" ? 1 : 0;
      const evidence = r.source && Number(r.source_exists) ? 1 : 0;
      return { id: String(r.id), projectId: String(r.project_id), taskId: r.task_id as string | null,
        kind: String(r.kind) as RetrievalRecord["kind"], lifecycle: String(r.lifecycle) as RetrievalRecord["lifecycle"],
        text: String(r.text), source: r.source as string | null, sourceExists: Boolean(r.source_exists),
        updatedAt: String(r.updated_at), score: -lexical, uncertainty: "Lexical match only; source existence is checked, claim truth is not verified.",
        _lexical: lexical, _lifecycle: lifecycle, _evidence: evidence, _freshness: freshness };
    });
    return ranked
      .sort((a, b) => a._lexical - b._lexical || b._lifecycle - a._lifecycle || b._evidence - a._evidence || b._freshness - a._freshness || a.id.localeCompare(b.id))
      .slice(0, q.limit)
      .map(({ _lexical: _l, _lifecycle: _lc, _evidence: _e, _freshness: _f, ...result }) => result);
  }

  close(): void { this.#db.close(); }
}
