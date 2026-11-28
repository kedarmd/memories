import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const MAX_SUMMARY_LENGTH = 2_000;
export const MAX_DETAILS_LENGTH = 20_000;
export const MAX_SOURCES = 50;

const idSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeText = (max: number) => z.string().trim().min(1).max(max);

export const registerProjectInput = z.object({
  id: idSchema,
  name: safeText(160),
  gitRoot: z.string().trim().min(1).max(2_000).optional(),
}).strict();
export const createTaskInput = z.object({
  projectId: idSchema,
  id: idSchema,
  objective: safeText(2_000),
}).strict();
const sourceSchema = z.object({
  reference: safeText(2_000),
  kind: z.enum(['file', 'commit', 'session', 'ticket', 'url', 'other']),
  note: z.string().max(1_000).optional(),
}).strict();
export const saveCheckpointInput = z.object({
  projectId: idSchema,
  taskId: idSchema,
  dedupeKey: idSchema,
  summary: safeText(MAX_SUMMARY_LENGTH),
  details: safeText(MAX_DETAILS_LENGTH),
  sessionAgent: safeText(100),
  sessionId: idSchema.optional(),
  workspace: safeText(2_000),
  coverage: z.object({
    status: z.enum(['complete', 'partial', 'unknown']),
    notes: z.string().trim().max(2_000).default(''),
  }).strict(),
  sources: z.array(sourceSchema).max(MAX_SOURCES),
}).strict();
export const loadTaskInput = z.object({ projectId: idSchema, taskId: idSchema }).strict();

export type RegisterProject = z.infer<typeof registerProjectInput>;
export type CreateTask = z.infer<typeof createTaskInput>;
export type SaveCheckpoint = z.infer<typeof saveCheckpointInput>;
export type LoadTask = z.infer<typeof loadTaskInput>;

export type ProjectRecord = RegisterProject & { createdAt: string };
export type TaskRecord = CreateTask & { createdAt: string };
export type CheckpointRecord = SaveCheckpoint & {
  id: string;
  status: 'saved';
  createdAt: string;
  sources: Array<SaveCheckpoint['sources'][number] & { verification: 'unverified' }>;
  verification: 'unverified';
};
export type TaskPacket = {
  projectId: string;
  task: TaskRecord;
  checkpoints: CheckpointRecord[];
  limitations: string[];
};

type SqlRow = Record<string, string | number | bigint | null | Uint8Array>;
const timestamp = (): string => new Date().toISOString();

export function defaultDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MEMORIES_DATA_DIR) return resolve(env.MEMORIES_DATA_DIR);
  const xdg = env.XDG_DATA_HOME;
  const home = env.HOME ?? homedir();
  return resolve(xdg ? join(xdg, 'memories') : join(home, '.local', 'share', 'memories'));
}

export class MemoriesStore {
  readonly dataRoot: string;
  readonly databasePath: string;
  readonly #db: DatabaseSync;

  constructor(dataRoot = defaultDataRoot()) {
    this.dataRoot = resolve(dataRoot);
    mkdirSync(this.dataRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(this.dataRoot, 0o700);
    this.databasePath = join(this.dataRoot, 'memories.sqlite');
    this.#db = new DatabaseSync(this.databasePath);
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void { this.#db.close(); }

  migrate(): void {
    this.#db.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )`);
    const migrationDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));
    const migrations = [
      { hash: '0000_initial_6e51056', file: '0000_initial.sql' },
      { hash: '0001_checkpoint_provenance_2e8ef30', file: '0001_checkpoint_provenance.sql' },
    ].map((migration) => ({ ...migration, sql: readFileSync(join(migrationDirectory, migration.file), 'utf8') }));
    for (const migration of migrations) {
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const applied = this.#db.prepare('SELECT hash FROM __drizzle_migrations WHERE hash = ?').get(migration.hash);
        if (applied) {
          this.#db.exec('COMMIT');
          continue;
        }
        this.#db.exec(migration.sql);
        this.#db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, Date.now());
        this.#db.exec('COMMIT');
      } catch (error) {
        this.#db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  registerProject(raw: unknown): ProjectRecord {
    const input = registerProjectInput.parse(raw);
    const existing = this.#db.prepare('SELECT * FROM projects WHERE id = ?').get(input.id) as SqlRow | undefined;
    if (existing) {
      if (existing.name !== input.name || existing.git_root !== (input.gitRoot ?? null)) throw new Error(`Project ID ${input.id} already exists with different registration data`);
      return this.#projectFromRow(existing);
    }
    const rootMatch = input.gitRoot
      ? this.#db.prepare('SELECT id FROM projects WHERE git_root = ?').get(input.gitRoot) as SqlRow | undefined
      : undefined;
    if (rootMatch) throw new Error(`Git root is already associated with project ID ${String(rootMatch.id)}; use that project ID to reuse it`);
    this.#db.prepare('INSERT INTO projects (id, name, git_root, created_at) VALUES (?, ?, ?, ?)').run(input.id, input.name, input.gitRoot ?? null, timestamp());
    return this.#projectFromRow(this.#db.prepare('SELECT * FROM projects WHERE id = ?').get(input.id) as SqlRow);
  }

  createTask(raw: unknown): TaskRecord {
    const input = createTaskInput.parse(raw);
    const project = this.#db.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    const existing = this.#db.prepare('SELECT * FROM tasks WHERE project_id = ? AND objective = ?').get(input.projectId, input.objective) as SqlRow | undefined;
    if (existing) return this.#taskFromRow(existing);
    const idUsed = this.#db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(input.id) as SqlRow | undefined;
    if (idUsed) throw new Error(`Task ID ${input.id} is already in use`);
    this.#db.prepare('INSERT INTO tasks (id, project_id, objective, created_at) VALUES (?, ?, ?, ?)').run(input.id, input.projectId, input.objective, timestamp());
    return this.#taskFromRow(this.#db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(input.id, input.projectId) as SqlRow);
  }

  saveCheckpoint(raw: unknown): CheckpointRecord {
    const input = saveCheckpointInput.parse(raw);
    const task = this.#db.prepare('SELECT id FROM tasks WHERE id = ? AND project_id = ?').get(input.taskId, input.projectId);
    if (!task) throw new Error(`Unknown task ${input.taskId} in project ${input.projectId}`);
    const prior = this.#db.prepare('SELECT * FROM checkpoints WHERE project_id = ? AND task_id = ? AND dedupe_key = ?')
      .get(input.projectId, input.taskId, input.dedupeKey) as SqlRow | undefined;
    if (prior) return this.#checkpointFromRow(prior);
    const checkpointId = `cp_${createHash('sha256').update(`${input.projectId}\0${input.taskId}\0${input.dedupeKey}`).digest('hex').slice(0, 24)}`;
    this.#db.prepare(`INSERT INTO checkpoints
      (id, project_id, task_id, dedupe_key, status, summary, details, session_agent, session_id, workspace, coverage, sources, created_at)
      VALUES (?, ?, ?, ?, 'saved', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(checkpointId, input.projectId, input.taskId, input.dedupeKey, input.summary, input.details, input.sessionAgent,
        input.sessionId ?? null, input.workspace, JSON.stringify(input.coverage), JSON.stringify(input.sources.map((source) => ({ ...source, verification: 'unverified' }))), timestamp());
    const row = this.#db.prepare('SELECT * FROM checkpoints WHERE project_id = ? AND task_id = ? AND dedupe_key = ?')
      .get(input.projectId, input.taskId, input.dedupeKey) as SqlRow;
    return this.#checkpointFromRow(row);
  }

  loadTask(raw: unknown): TaskPacket | null {
    const input = loadTaskInput.parse(raw);
    const taskRow = this.#db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(input.taskId, input.projectId) as SqlRow | undefined;
    if (!taskRow) return null;
    const checkpointRows = this.#db.prepare(`SELECT * FROM checkpoints WHERE project_id = ? AND task_id = ? ORDER BY created_at DESC, id LIMIT 20`)
      .all(input.projectId, input.taskId) as SqlRow[];
    return {
      projectId: input.projectId,
      task: this.#taskFromRow(taskRow),
      checkpoints: checkpointRows.map((row) => this.#checkpointFromRow(row)),
      limitations: [
        'Source references are recorded caller metadata and have not been independently verified.',
        'Saved checkpoints preserve the caller-reported coverage; partial or unknown coverage may omit work.',
        'No extraction, semantic search, or automatic task association is performed.',
      ],
    };
  }

  #projectFromRow(row: SqlRow): ProjectRecord {
    return { id: String(row.id), name: String(row.name), ...(row.git_root === null ? {} : { gitRoot: String(row.git_root) }), createdAt: String(row.created_at) };
  }
  #taskFromRow(row: SqlRow): TaskRecord {
    return { id: String(row.id), projectId: String(row.project_id), objective: String(row.objective), createdAt: String(row.created_at) };
  }
  #checkpointFromRow(row: SqlRow): CheckpointRecord {
    const sources = JSON.parse(String(row.sources)) as Array<z.infer<typeof sourceSchema> & { verification: 'unverified' }>;
    return {
      id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id), dedupeKey: String(row.dedupe_key),
      status: 'saved', summary: String(row.summary), details: String(row.details), sessionAgent: String(row.session_agent),
      ...(row.session_id === null ? {} : { sessionId: String(row.session_id) }), workspace: String(row.workspace),
      coverage: JSON.parse(String(row.coverage)) as SaveCheckpoint['coverage'], sources, createdAt: String(row.created_at), verification: 'unverified',
    };
  }
}
