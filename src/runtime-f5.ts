import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { chmod, mkdir, realpath, unlink } from 'node:fs/promises';
import { createServer, connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Effect } from 'effect';
import { z } from 'zod';
import { ContinuationStore } from './continuation.ts';

const RequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('identity') }).strict(),
  z.object({ op: z.literal('status'), projectId: z.string().min(1).max(128), taskId: z.string().min(1).max(128) }).strict(),
  z.object({ op: z.literal('submit'), idempotencyKey: z.string().min(1).max(200), projectId: z.string().min(1).max(128), taskId: z.string().min(1).max(128), input: z.string().min(1).max(2000), durationMs: z.number().int().min(0).max(10_000), fail: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('job'), id: z.string().min(1).max(200), projectId: z.string().min(1).max(128), taskId: z.string().min(1).max(128) }).strict(),
  z.object({ op: z.literal('checkpoint'), value: z.unknown() }).strict(),
  z.object({ op: z.literal('load'), projectId: z.string().min(1).max(128), taskId: z.string().min(1).max(128) }).strict(),
  z.object({ op: z.literal('hold'), durationMs: z.number().int().min(0).max(10_000) }).strict(),
]);
type Request = z.infer<typeof RequestSchema>;

const ArgsSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('core'), root: z.string(), idleMs: z.coerce.number().int().min(50).max(10_000), events: z.string() }),
  z.object({ mode: z.literal('client'), root: z.string(), request: z.string(), idleMs: z.coerce.number().int().min(50).max(10_000), events: z.string() }),
]);

function event(path: string, data: Record<string, unknown>): void {
  // The event file contains synthetic IDs, state transitions, and timings only.
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...data })}\n`;
  appendFileSync(path, line, { mode: 0o600 });
}

async function paths(rootArg: string): Promise<{ root: string; dir: string; socket: string; db: string; ownerDb: string }> {
  const root = await realpath(resolve(rootArg));
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 32);
  const dir = join(tmpdir(), `memories-f5-${process.getuid?.() ?? 'user'}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return {
    root,
    dir,
    socket: join(dir, `${digest}.sock`),
    db: join(root, 'memories-f5.sqlite'),
    ownerDb: join(root, 'memories-f5-core-owner.sqlite'),
  };
}

export async function f5SocketPath(rootArg: string): Promise<string> {
  return (await paths(rootArg)).socket;
}

function write(socket: Socket, value: unknown): void { socket.write(`${JSON.stringify(value)}\n`); }

async function startCore(rootArg: string, idleMs: number, events: string): Promise<void> {
  if (process.platform === 'win32') throw new Error('F5 IPC experiment supports Unix-domain sockets on Linux/macOS only');
  const p = await paths(rootArg);
  const ownerLock = new DatabaseSync(p.ownerDb);
  ownerLock.exec('PRAGMA busy_timeout = 250');
  try { ownerLock.exec('BEGIN IMMEDIATE'); }
  catch (error) {
    if (error instanceof Error && /busy|locked/i.test(error.message)) {
      event(events, { type: 'core_candidate_reused', pid: process.pid, endpoint: 'owner-lock' });
      ownerLock.close();
      process.exit(17);
    }
    ownerLock.close();
    throw error;
  }
  const db = new DatabaseSync(p.db);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS f5_jobs (
      id TEXT PRIMARY KEY, idem TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
      input TEXT NOT NULL, duration_ms INTEGER NOT NULL, fail INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed')),
      result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS f5_jobs_queue ON f5_jobs(state, created_at, id);`);
  const instanceId = randomUUID();
  const store = new ContinuationStore(p.db);
  let clients = 0;
  let active = false;
  let closing = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const socketServer = createServer((socket) => {
    clients++;
    if (idleTimer) clearTimeout(idleTimer);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 64 * 1024) { socket.destroy(); return; }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line) void handle(socket, line);
    });
    socket.on('close', () => { clients--; scheduleIdle(); });
  });
  const scheduleIdle = () => {
    if (closing || clients || active) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (clients || active) return;
      closing = true;
      event(events, { type: 'core_idle_stop', pid: process.pid, instanceId });
      socketServer.close(async () => {
        try { await unlink(p.socket); } catch { /* socket may already have been removed */ }
        releaseOwnerLock(ownerLock);
        store.close();
        db.close();
        process.exit(0);
      });
    }, idleMs);
  };
  const handle = async (socket: Socket, line: string) => {
    const startedAt = performance.now();
    const respond = (value: Record<string, unknown>) => write(socket, { ...value, coreLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100 });
    try {
      const req = RequestSchema.parse(JSON.parse(line) as unknown);
      switch (req.op) {
        case 'identity': respond({ ok: true, pid: process.pid, instanceId, root: p.root }); break;
        case 'status': {
          const jobs = db.prepare('SELECT id, project_id as projectId, task_id as taskId, state, error, created_at as createdAt FROM f5_jobs WHERE project_id=? AND task_id=? ORDER BY created_at, id').all(req.projectId, req.taskId);
          respond({ ok: true, pid: process.pid, instanceId, clients, active, jobs }); break;
        }
        case 'submit': {
          const scopedIdempotencyKey = JSON.stringify([req.projectId, req.taskId, req.idempotencyKey]);
          const id = createHash('sha256').update(`f5-job\0${scopedIdempotencyKey}`).digest('hex');
          const now = new Date().toISOString();
          const inserted = db.prepare("INSERT OR IGNORE INTO f5_jobs(id, idem, project_id, task_id, input, duration_ms, fail, state, created_at, updated_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)")
            .run(id, scopedIdempotencyKey, req.projectId, req.taskId, req.input, req.durationMs, Number(req.fail), now, now);
          const job = db.prepare('SELECT id, project_id as projectId, task_id as taskId, input, state FROM f5_jobs WHERE idem=?').get(scopedIdempotencyKey);
          respond({ ok: true, job, duplicate: inserted.changes === 0 });
          void worker();
          break;
        }
        case 'job': respond({ ok: true, job: db.prepare('SELECT id, project_id as projectId, task_id as taskId, input, state, result, error FROM f5_jobs WHERE id=? AND project_id=? AND task_id=?').get(req.id, req.projectId, req.taskId) ?? null }); break;
        case 'checkpoint': respond({ ok: true, receipt: store.save(req.value) }); break;
        case 'load': respond({ ok: true, packet: store.load(req.projectId, req.taskId) ?? null }); break;
        case 'hold': await new Promise((r) => setTimeout(r, req.durationMs)); respond({ ok: true, heldMs: req.durationMs }); break;
      }
    } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  };
  const worker = () => Effect.runPromise(Effect.tryPromise({ try: async () => {
    if (active || closing) return;
    active = true;
    try {
      while (!closing) {
        const job = db.prepare("SELECT * FROM f5_jobs WHERE state='queued' ORDER BY created_at, id LIMIT 1").get() as { id: string; project_id: string; task_id: string; input: string; duration_ms: number; fail: number } | undefined;
        if (!job) break;
        db.prepare("UPDATE f5_jobs SET state='running', updated_at=? WHERE id=? AND state='queued'").run(new Date().toISOString(), job.id);
        event(events, { type: 'executor_start', jobId: job.id, input: job.input, projectId: job.project_id, taskId: job.task_id, active: 1, pid: process.pid, instanceId });
        await new Promise((r) => setTimeout(r, job.duration_ms));
        if (job.fail) {
          db.prepare("UPDATE f5_jobs SET state='failed', error='instrumented executor failure', updated_at=? WHERE id=?").run(new Date().toISOString(), job.id);
          event(events, { type: 'executor_end', jobId: job.id, outcome: 'failed', active: 0, pid: process.pid, instanceId });
        } else {
          const result = JSON.stringify({ acceptedInput: job.input, projectId: job.project_id, taskId: job.task_id, executor: 'deterministic-fake' });
          db.prepare("UPDATE f5_jobs SET state='completed', result=?, updated_at=? WHERE id=?").run(result, new Date().toISOString(), job.id);
          event(events, { type: 'executor_end', jobId: job.id, outcome: 'completed', active: 0, pid: process.pid, instanceId });
        }
      }
    } finally { active = false; scheduleIdle(); }
  }, catch: (error) => error }));

  // The separate SQLite owner transaction remains held for the process lifetime.
  // It serializes all cooperating bind/recovery contenders and is released by
  // SQLite after a crash without blocking writes to the queue/checkpoint DB.
  try { await listen(socketServer, p.socket); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
      releaseOwnerLock(ownerLock); db.close(); store.close(); throw error;
    }
    const endpoint = await probeSocket(p.socket, 250);
    if (endpoint !== 'refused') {
      // A connectable endpoint owns the pathname even if its identity response
      // is slow or absent. Unknown probe results are also treated as occupied.
      event(events, { type: 'core_candidate_reused', pid: process.pid, endpoint });
      releaseOwnerLock(ownerLock); db.close(); store.close(); process.exit(17);
    }
    try { await unlink(p.socket); }
    catch { releaseOwnerLock(ownerLock); db.close(); store.close(); process.exit(17); }
    try { await listen(socketServer, p.socket); }
    catch (retryError) {
      releaseOwnerLock(ownerLock); db.close(); store.close();
      process.exit((retryError as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 17 : 1);
    }
  }
  await chmod(p.socket, 0o600);
  // Only the socket owner may recover interrupted work. Losing startup racers
  // must not mutate the active core's running job rows.
  const interrupted = db.prepare("SELECT id FROM f5_jobs WHERE state = 'running'").all() as { id: string }[];
  db.prepare("UPDATE f5_jobs SET state='failed', error='core terminated during execution; safe to explicitly retry', updated_at=? WHERE state='running'").run(new Date().toISOString());
  for (const job of interrupted) event(events, { type: 'job_recovered_failed', jobId: job.id });
  event(events, { type: 'core_start', pid: process.pid, instanceId, root: p.root, socketMode: '0600' });
  void worker();
  scheduleIdle();
}

function releaseOwnerLock(ownerLock: DatabaseSync): void {
  try { ownerLock.exec('ROLLBACK'); } catch { /* transaction may already have been released */ }
  ownerLock.close();
}

function listen(server: ReturnType<typeof createServer>, path: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(path, () => { server.removeListener('error', reject); resolvePromise(); });
  });
}

type SocketProbe = 'accepting' | 'refused' | 'unknown';

function probeSocket(path: string, timeoutMs: number): Promise<SocketProbe> {
  return new Promise((resolvePromise) => {
    const socket = connect(path);
    let settled = false;
    const finish = (result: SocketProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolvePromise(result);
    };
    const timer = setTimeout(() => finish('unknown'), timeoutMs);
    socket.once('connect', () => finish('accepting'));
    socket.once('error', (error) => finish((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'refused' : 'unknown'));
  });
}

function request(socketPath: string, req: Request, timeoutMs = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('IPC response timeout')); }, timeoutMs);
    socket.once('error', (e) => { clearTimeout(timer); reject(e); });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer);
      socket.end();
      try { resolvePromise(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>); }
      catch { reject(new Error('invalid IPC response')); }
    });
    socket.once('connect', () => socket.write(`${JSON.stringify(req)}\n`));
  });
}

async function ensureCore(root: string, idleMs: number, events: string): Promise<string> {
  const p = await paths(root);
  const entry = process.argv[1];
  if (!entry) throw new Error('runtime entrypoint unavailable');
  const deadline = Date.now() + 2500;
  let launched = false;
  while (Date.now() < deadline) {
    try { await request(p.socket, { op: 'identity' }, 250); return p.socket; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!launched) {
        const child = spawn(process.execPath, ['--experimental-strip-types', entry, 'core', root, String(idleMs), events], {
          detached: true,
          stdio: 'ignore',
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? tmpdir() },
        });
        child.unref();
        launched = true;
      }
      if (code !== 'ENOENT' && code !== 'ECONNREFUSED' && code !== 'ECONNRESET') await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  throw new Error('could not connect to a shared core within 2500ms; an occupied but unresponsive endpoint is not replaced');
}

async function runClient(root: string, requestText: string, idleMs: number, events: string): Promise<void> {
  const socketPath = await ensureCore(root, idleMs, events);
  const req = RequestSchema.parse(JSON.parse(requestText) as unknown);
  const response = await request(socketPath, req, 15_000);
  process.stdout.write(`${JSON.stringify(response)}\n`);
  if (req.op === 'hold') await new Promise((r) => setTimeout(r, 0));
}

async function main(): Promise<void> {
  const args = ArgsSchema.parse({ mode: process.argv[2], root: process.argv[3], ...(process.argv[2] === 'core' ? { idleMs: process.argv[4], events: process.argv[5] } : { request: process.argv[4], idleMs: process.argv[5], events: process.argv[6] }) });
  if (args.mode === 'core') await startCore(args.root, args.idleMs, args.events);
  else await runClient(args.root, args.request, args.idleMs, args.events);
}

if (process.argv[1]?.endsWith('runtime-f5.ts')) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
