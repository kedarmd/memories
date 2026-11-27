import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const Ref = z.string().min(1).max(300);
const CheckpointSchema = z.object({
  projectId: Ref,
  taskId: Ref,
  session: z.object({ id: Ref, agent: z.enum(["codex", "opencode", "other"]), workspace: Ref }).strict(),
  objective: z.string().min(1).max(2000),
  completed: z.array(z.string().min(1).max(500)).max(20),
  decisions: z.array(z.string().min(1).max(500)).max(20),
  blockers: z.array(z.string().min(1).max(500)).max(20),
  next: z.array(z.string().min(1).max(500)).max(10),
  evidence: z.array(z.object({ kind: z.enum(["file", "checkpoint"]), ref: Ref }).strict()).max(30),
  coverage: z.enum(["explicit-checkpoint", "partial"]),
  createdAt: z.string().datetime(),
}).strict();

export type ContinuationCheckpoint = z.infer<typeof CheckpointSchema>;

export class ContinuationStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tasks (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        workspace TEXT NOT NULL,
        body TEXT NOT NULL,
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS checkpoints_scope ON checkpoints(project_id, task_id, created_at);
    `);
  }

  registerTask(projectId: string, taskId: string, objective: string): void {
    const project = Ref.parse(projectId);
    const task = Ref.parse(taskId);
    const description = z.string().min(1).max(2000).parse(objective);
    this.#db.prepare("INSERT INTO tasks(project_id, task_id, objective) VALUES (?, ?, ?) ON CONFLICT(project_id, task_id) DO UPDATE SET objective=excluded.objective").run(project, task, description);
  }

  save(checkpoint: unknown): { id: string; state: "saved" } {
    const parsed = CheckpointSchema.parse(checkpoint);
    const body = JSON.stringify(parsed);
    const digest = createHash("sha256").update(body).digest("hex");
    const id = createHash("sha256").update(`${parsed.projectId}\0${parsed.taskId}\0${parsed.session.id}\0${digest}`).digest("hex");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db.prepare("SELECT digest FROM checkpoints WHERE id = ?").get(id) as { digest: string } | undefined;
      if (existing && existing.digest !== digest) throw new Error("checkpoint id conflict");
      this.#db.prepare("INSERT OR IGNORE INTO checkpoints(id, project_id, task_id, session_id, agent, workspace, body, digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, parsed.projectId, parsed.taskId, parsed.session.id, parsed.session.agent, parsed.session.workspace, body, digest, parsed.createdAt);
      this.#db.exec("COMMIT");
      return { id, state: "saved" };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  load(projectId: string, taskId: string): { projectId: string; taskId: string; objective: string; checkpoints: ContinuationCheckpoint[]; limitations: string[] } | undefined {
    const project = Ref.parse(projectId);
    const task = Ref.parse(taskId);
    const taskRow = this.#db.prepare("SELECT objective FROM tasks WHERE project_id = ? AND task_id = ?").get(project, task) as { objective: string } | undefined;
    if (!taskRow) return undefined;
    const rows = this.#db.prepare("SELECT body FROM checkpoints WHERE project_id = ? AND task_id = ? ORDER BY created_at, id").all(project, task) as { body: string }[];
    return {
      projectId: project,
      taskId: task,
      objective: taskRow.objective,
      checkpoints: rows.map(({ body }) => CheckpointSchema.parse(JSON.parse(body))),
      limitations: ["Explicit checkpoint coverage only; native conversation history is not stored or loaded.", "Evidence references are attributed, not independently verified by this store."],
    };
  }

  close(): void { this.#db.close(); }
}
