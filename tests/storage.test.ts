import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { Readable } from 'node:stream';
import test from 'node:test';
import { MAX_INPUT_BYTES, readStructuredInput } from '../src/cli-input.ts';
import { defaultDataRoot, MemoriesStore } from '../src/storage.ts';

function fixture(): string { return mkdtempSync(join(tmpdir(), 'memories-stage1-')); }
function project(id: string, name = id, gitRoot?: string) {
  return { id, name, ...(gitRoot === undefined ? {} : { gitRoot }) };
}
function task(projectId: string, id: string, objective = 'Implement continuity') { return { projectId, id, objective }; }
function checkpoint(projectId: string, taskId: string, dedupeKey = 'attempt-1', summary = 'Partial implementation') {
  return {
    projectId, taskId, dedupeKey, summary, details: 'Added a bounded persistence slice.',
    sessionAgent: 'test-harness', sessionId: 'session-1', workspace: '/tmp/worktree',
    coverage: { status: 'partial', notes: 'Tests remain.' },
    sources: [{ reference: 'src/storage.ts', kind: 'file' as const, note: 'Caller supplied reference.' }],
  };
}

test('two projects and tasks persist with stable IDs in one user database after reopen', () => {
  const root = fixture();
  try {
    let store = new MemoriesStore(root);
    store.registerProject(project('project-a', 'Alpha'));
    store.registerProject(project('project-b', 'Beta'));
    store.createTask(task('project-a', 'task-a'));
    store.createTask(task('project-b', 'task-b', 'Fix isolation'));
    store.saveCheckpoint(checkpoint('project-a', 'task-a'));
    store.close();

    store = new MemoriesStore(root);
    const a = store.loadTask({ projectId: 'project-a', taskId: 'task-a' });
    const b = store.loadTask({ projectId: 'project-b', taskId: 'task-b' });
    assert.equal(a?.task.id, 'task-a');
    assert.equal(a?.checkpoints.length, 1);
    assert.equal(b?.task.id, 'task-b');
    assert.equal(b?.checkpoints.length, 0);
    assert.equal(store.loadTask({ projectId: 'project-b', taskId: 'task-a' }), null);
    assert.equal(readdirSync(root).some((name) => name.endsWith('.sqlite')), true);
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Linux data root defaults to XDG or ~/.local/share and creates a private directory', () => {
  assert.equal(defaultDataRoot({ XDG_DATA_HOME: '/tmp/user-data' }), resolve('/tmp/user-data/memories'));
  assert.equal(defaultDataRoot({ HOME: '/tmp/home' }), resolve('/tmp/home/.local/share/memories'));
  const root = fixture();
  try {
    const store = new MemoriesStore(join(root, 'private-root'));
    if (process.platform !== 'win32') assert.equal(statSync(store.dataRoot).mode & 0o777, 0o700);
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('existing unsafe data roots are rejected without changing their permissions', () => {
  const parent = fixture();
  const sharedRoot = join(parent, 'shared-root');
  try {
    mkdirSync(sharedRoot, { mode: 0o700 });
    chmodSync(sharedRoot, 0o750);
    assert.throws(() => new MemoriesStore(sharedRoot), /Data root must be private/);
    assert.equal(statSync(sharedRoot).mode & 0o777, 0o750);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('stdin is destroyed on overflow and oversized files are rejected before reading', async () => {
  let emittedChunks = 0;
  const input = new Readable({
    read() {
      emittedChunks += 1;
      this.push(Buffer.alloc(16_384, 0x61));
    },
  });
  await assert.rejects(readStructuredInput('-', input), /exceeds 128000 bytes/);
  assert.equal(input.destroyed, true);
  assert.ok(emittedChunks < 20, `read only ${emittedChunks} bounded chunks before closing input`);

  const root = fixture();
  const oversizedFile = join(root, 'oversized.json');
  try {
    writeFileSync(oversizedFile, Buffer.alloc(MAX_INPUT_BYTES + 1));
    await assert.rejects(readStructuredInput(oversizedFile, Readable.from([])), /exceeds 128000 bytes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI returns a bounded error for oversized stdin and file inputs without opening a database', () => {
  const root = fixture();
  const cli = resolve('src/cli.ts');
  const dataRoot = join(root, 'data');
  const oversizedFile = join(root, 'oversized.json');
  writeFileSync(oversizedFile, Buffer.alloc(MAX_INPUT_BYTES + 1));
  try {
    const stdinResult = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'register-project', '--data-dir', dataRoot], {
      input: Buffer.alloc(MAX_INPUT_BYTES + 1), encoding: 'utf8',
    });
    assert.equal(stdinResult.status, 1);
    assert.match(stdinResult.stderr, /Structured input exceeds 128000 bytes/);
    assert.equal(stdinResult.stdout, '');
    assert.equal(existsSync(dataRoot), false);

    const fileResult = spawnSync(process.execPath, ['--experimental-strip-types', cli, 'register-project', '--input', oversizedFile, '--data-dir', dataRoot], { encoding: 'utf8' });
    assert.equal(fileResult.status, 1);
    assert.match(fileResult.stderr, /Structured input exceeds 128000 bytes/);
    assert.equal(fileResult.stdout, '');
    assert.equal(existsSync(dataRoot), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('first write wins per project/task/key while identical keys in another scope stay private', () => {
  const root = fixture();
  try {
    const store = new MemoriesStore(root);
    store.registerProject(project('p1'));
    store.registerProject(project('p2'));
    store.createTask(task('p1', 't1'));
    store.createTask(task('p2', 't2'));
    const first = store.saveCheckpoint(checkpoint('p1', 't1', 'same-key', 'first'));
    const retry = store.saveCheckpoint(checkpoint('p1', 't1', 'same-key', 'retry with changed text'));
    const distinct = store.saveCheckpoint(checkpoint('p1', 't1', 'new-key', 'a distinct checkpoint'));
    const otherScope = store.saveCheckpoint(checkpoint('p2', 't2', 'same-key', 'other project'));
    assert.equal(first.id, retry.id);
    assert.equal(retry.summary, 'first');
    assert.notEqual(first.id, distinct.id);
    assert.notEqual(first.id, otherScope.id);
    assert.deepEqual(store.loadTask({ projectId: 'p2', taskId: 't2' })?.checkpoints.map((item) => item.summary), ['other project']);
    assert.deepEqual(store.loadTask({ projectId: 'p1', taskId: 't1' })?.checkpoints[0]?.sources[0], {
      reference: 'src/storage.ts', kind: 'file', note: 'Caller supplied reference.', verification: 'unverified',
    });
    assert.equal(first.status, 'saved');
    assert.equal(first.verification, 'unverified');
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migration upgrade preserves existing identity and checkpoint rows and is repeatable', () => {
  const root = fixture();
  try {
    const db = new Database(join(root, 'memories.sqlite'));
    db.pragma('foreign_keys=ON');
    const initialSql = readFileSync(resolve('drizzle/0000_initial.sql'), 'utf8');
    db.exec(initialSql);
    db.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    const journal = JSON.parse(readFileSync(resolve('drizzle/meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string; when: number }> };
    const initialMigration = journal.entries.find((entry) => entry.tag === '0000_initial');
    assert.ok(initialMigration);
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(createHash('sha256').update(initialSql).digest('hex'), initialMigration.when);
    db.prepare('INSERT INTO projects (id, name, git_root, created_at) VALUES (?, ?, ?, ?)').run('p-old', 'Old', null, '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO tasks (id, project_id, objective, created_at) VALUES (?, ?, ?, ?)').run('t-old', 'p-old', 'Keep this task', '2026-01-01T00:00:00.000Z');
    db.prepare(`INSERT INTO checkpoints (id, project_id, task_id, dedupe_key, summary, details, session_agent, session_id, workspace, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('cp-old', 'p-old', 't-old', 'old-key', 'Preserve me', 'Existing durable data', 'agent-old', 'session-old', '/old/root', '2026-01-01T00:00:00.000Z');
    db.close();

    let store = new MemoriesStore(root);
    const packet = store.loadTask({ projectId: 'p-old', taskId: 't-old' });
    assert.equal(packet?.task.id, 't-old');
    assert.equal(packet?.checkpoints[0]?.id, 'cp-old');
    assert.deepEqual(packet?.checkpoints[0]?.coverage, { status: 'unknown', notes: 'Migration backfill; coverage was not recorded.' });
    assert.deepEqual(packet?.checkpoints[0]?.sources, []);
    store.close();
    store = new MemoriesStore(root);
    assert.equal(store.loadTask({ projectId: 'p-old', taskId: 't-old' })?.checkpoints[0]?.id, 'cp-old');
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SQLite enforces cross-project task/checkpoint foreign keys and unique registration constraints', () => {
  const root = fixture();
  try {
    const store = new MemoriesStore(root);
    store.registerProject(project('p1', 'One', '/repo/one'));
    assert.equal(store.registerProject(project('p1', 'One', '/repo/one')).id, 'p1');
    store.registerProject(project('p2', 'Two', '/repo/two'));
    store.createTask(task('p1', 't1'));
    assert.throws(() => store.createTask(task('missing-project', 't2')), /Unknown project/);
    assert.throws(() => store.registerProject(project('p3', 'Collision', '/repo/one')), /use that project ID to reuse it/);
    assert.throws(() => store.saveCheckpoint(checkpoint('p2', 't1')), /Unknown task/);
    store.close();

    const db = new Database(join(root, 'memories.sqlite'));
    db.exec('PRAGMA foreign_keys=ON');
    assert.throws(() => db.prepare(`INSERT INTO projects (id, name, git_root, created_at) VALUES ('p3', 'Collision', '/repo/one', 'now')`).run());
    assert.throws(() => db.prepare(`INSERT INTO tasks (id, project_id, objective, created_at) VALUES ('bad-task', 'missing', 'x', 'now')`).run());
    assert.throws(() => db.prepare(`INSERT INTO checkpoints (id, project_id, task_id, dedupe_key, summary, details, session_agent, workspace, coverage, sources, created_at)
      VALUES ('bad-cp', 'p2', 't1', 'k', 'x', 'x', 'a', 'w', '{}', '[]', 'now')`).run());
    assert.throws(() => db.prepare(`INSERT INTO tasks (id, project_id, objective, created_at) VALUES ('t1', 'p2', 'duplicate ID', 'now')`).run());
    db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Zod rejects malformed, oversized, and unsafe scope input', () => {
  const root = fixture();
  try {
    const store = new MemoriesStore(root);
    assert.throws(() => store.registerProject({ id: "p1' OR 1=1 --", name: 'unsafe' }));
    assert.throws(() => store.registerProject({ id: 'p1', name: '' }));
    assert.throws(() => store.saveCheckpoint({ ...checkpoint('p1', 't1'), details: 'x'.repeat(20_001) }));
    assert.throws(() => store.loadTask({ projectId: 'p1 OR 1=1', taskId: 't1' }));
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('checkpoint saved in one CLI process loads in a separate process after DB reopen', () => {
  const root = fixture();
  const cli = resolve('src/cli.ts');
  const workspace = join(root, 'checkout');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'AGENTS.md'), 'preserve this fixture\n');
  const command = (name: string, input: unknown) => spawnSync(process.execPath, ['--experimental-strip-types', cli, name, '--data-dir', root], {
    input: JSON.stringify(input), encoding: 'utf8', cwd: workspace,
  });
  const invoke = (name: string, input: unknown) => {
    const result = command(name, input);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { result: unknown };
  };
  try {
    invoke('register-project', project('p-cli'));
    invoke('task-create', task('p-cli', 't-cli'));
    const saved = invoke('checkpoint-save', checkpoint('p-cli', 't-cli'));
    const loaded = invoke('task-load', { projectId: 'p-cli', taskId: 't-cli' });
    const result = loaded.result as { checkpoints: Array<{ id: string; status: string; sources: Array<{ verification: string }> }> };
    assert.equal(result.checkpoints[0]?.id, (saved.result as { id: string }).id);
    assert.equal(result.checkpoints[0]?.status, 'saved');
    assert.equal(result.checkpoints[0]?.sources[0]?.verification, 'unverified');
    assert.equal(readFileSync(join(workspace, 'AGENTS.md'), 'utf8'), 'preserve this fixture\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('concurrent first-run CLI processes serialize migration and retain both registrations', async () => {
  const root = fixture();
  const cli = resolve('src/cli.ts');
  const run = (id: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', cli, 'register-project', '--data-dir', root], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(project(id)));
  });
  try {
    const results = await Promise.all([run('parallel-a'), run('parallel-b')]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const store = new MemoriesStore(root);
    assert.equal(store.registerProject(project('parallel-a')).id, 'parallel-a');
    assert.equal(store.registerProject(project('parallel-b')).id, 'parallel-b');
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('concurrent CLI task and checkpoint retries return the same durable records', async () => {
  const root = fixture();
  const cli = resolve('src/cli.ts');
  const run = (command: string, input: unknown) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', cli, command, '--data-dir', root], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
  const resultOf = (result: { code: number | null; stdout: string; stderr: string }) => {
    assert.equal(result.code, 0, result.stderr);
    return (JSON.parse(result.stdout) as { result: Record<string, unknown> }).result;
  };
  try {
    const registrations = await Promise.all([
      run('register-project', project('concurrent-project')),
      run('register-project', project('concurrent-project')),
    ]);
    const registered = registrations.map(resultOf);
    assert.equal(registered[0]?.id, registered[1]?.id);

    const taskResults = await Promise.all([
      run('task-create', task('concurrent-project', 'task-race-a', 'One shared objective')),
      run('task-create', task('concurrent-project', 'task-race-b', 'One shared objective')),
    ]);
    const createdTasks = taskResults.map(resultOf);
    assert.equal(createdTasks[0]?.id, createdTasks[1]?.id);

    const taskId = String(createdTasks[0]?.id);
    const savedResults = await Promise.all([
      run('checkpoint-save', checkpoint('concurrent-project', taskId, 'same-key', 'payload A')),
      run('checkpoint-save', checkpoint('concurrent-project', taskId, 'same-key', 'payload B')),
    ]);
    const saved = savedResults.map(resultOf);
    assert.equal(saved[0]?.id, saved[1]?.id);
    assert.equal(saved[0]?.summary, saved[1]?.summary);
    assert.ok(saved[0]?.summary === 'payload A' || saved[0]?.summary === 'payload B');

    const loadResult = await run('task-load', { projectId: 'concurrent-project', taskId });
    const packet = resultOf(loadResult) as { checkpoints: Array<{ id: string; summary: string }> };
    assert.equal(packet.checkpoints.length, 1);
    assert.equal(packet.checkpoints[0]?.id, saved[0]?.id);
    assert.equal(packet.checkpoints[0]?.summary, saved[0]?.summary);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
