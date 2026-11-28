import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import test from 'node:test';
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
    const db = new DatabaseSync(join(root, 'memories.sqlite'));
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(readFileSync(resolve('drizzle/0000_initial.sql'), 'utf8'));
    db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('0000_initial_6e51056', Date.now());
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

    const db = new DatabaseSync(join(root, 'memories.sqlite'));
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
