import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { ContinuationStore } from '../src/continuation.ts';
import { f5SocketPath } from '../src/runtime-f5.ts';

type Json = Record<string, any>;
const entry = resolve('src/runtime-f5.ts');

function runClient(root: string, request: Json, idleMs: number, events: string): Promise<{ code: number | null; stdout: string; stderr: string; elapsedMs: number }> {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['--experimental-strip-types', entry, 'client', root, JSON.stringify(request), String(idleMs), events], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('client timed out')); }, 10_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { out += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout: out, stderr: err, elapsedMs: Date.now() - startedAt });
    });
  });
}
async function client(root: string, request: Json, idleMs: number, events: string): Promise<Json> {
  const result = await runClient(root, request, idleMs, events);
  if (result.code !== 0) throw new Error(`client exit ${String(result.code)}: ${result.stderr}`);
  try { return JSON.parse(result.stdout.trim()) as Json; }
  catch { throw new Error(`invalid client output: ${result.stdout}; ${result.stderr}`); }
}
function awaitListening(server: ReturnType<typeof createServer>, path: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(path, () => { server.removeListener('error', reject); resolvePromise(); });
  });
}
function canConnect(path: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect(path);
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.once('error', () => resolvePromise(false));
  });
}

async function eventsAt(path: string): Promise<Json[]> {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Json); }
  catch { return []; }
}
async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error('condition not reached before deadline');
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

test('concurrent clients never replace a live but unresponsive socket owner', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memories-f5-unresponsive-'));
  const eventsFile = join(root, 'events.jsonl');
  const socketPath = await f5SocketPath(root);
  let fakeConnections = 0;
  const fakeOwner = createServer((socket) => { fakeConnections++; socket.on('data', () => {}); });
  await awaitListening(fakeOwner, socketPath);
  t.after(async () => {
    await new Promise<void>((resolvePromise) => fakeOwner.close(() => resolvePromise()));
    try { await unlink(socketPath); } catch { /* already removed */ }
    await rm(root, { recursive: true, force: true });
  });

  const results = await Promise.all([
    runClient(root, { op: 'identity' }, 500, eventsFile),
    runClient(root, { op: 'identity' }, 500, eventsFile),
  ]);
  for (const result of results) {
    assert.notEqual(result.code, 0, 'client fails boundedly when the owning endpoint never answers');
    assert.match(result.stderr, /occupied but unresponsive endpoint is not replaced/);
    assert.ok(result.elapsedMs >= 200 && result.elapsedMs < 7000, `client retry elapsed ${result.elapsedMs}ms`);
  }
  assert.equal(fakeOwner.listening, true);
  const priorConnections = fakeConnections;
  assert.equal(await canConnect(socketPath), true);
  await delay(20);
  assert.equal(fakeConnections, priorConnections + 1, 'the original listener still owns the socket pathname');
  const rows = await eventsAt(eventsFile);
  const rejectedCandidates = rows.filter((row) => row.type === 'core_candidate_reused' && row.endpoint === 'accepting');
  assert.equal(rejectedCandidates.length, 2, 'each independent client launched one bounded contender');
  for (const candidate of rejectedCandidates) {
    assert.equal(typeof candidate.pid, 'number');
    await waitFor(async () => ({ alive: alive(candidate.pid) }), (state) => !state.alive, 2000);
  }
  assert.equal(rows.filter((row) => row.type === 'core_start').length, 0, 'no duplicate core bound the live pathname');
});

test('independent clients share one on-demand core, serialize jobs, serve reads, and recover after crash', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memories-f5-test-'));
  const otherRoot = await mkdtemp(join(tmpdir(), 'memories-f5-other-root-'));
  const eventsFile = join(root, 'events.jsonl');
  const idleMs = 1200;
  t.after(async () => { await rm(otherRoot, { recursive: true, force: true }); });

  const store = new ContinuationStore(join(root, 'memories-f5.sqlite'));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.registerTask('project-synthetic', 'task-synthetic', 'Validate the F5 shared-core prototype.');
  const checkpoint = {
    projectId: 'project-synthetic', taskId: 'task-synthetic',
    session: { id: 'session-client-a', agent: 'other', workspace: 'fixture' },
    objective: 'Validate the F5 shared-core prototype.', completed: ['Persist a checkpoint before crash.'],
    decisions: ['One core owns the local extraction queue.'], blockers: [], next: ['Inspect recovered job state.'],
    evidence: [{ kind: 'checkpoint', ref: 'f5-synthetic-input' }], coverage: 'explicit-checkpoint', createdAt: new Date().toISOString(),
  };
  // Simultaneous cold callers each launch an independent client process.
  const [a, b] = await Promise.all([
    client(root, { op: 'identity' }, idleMs, eventsFile),
    client(root, { op: 'identity' }, idleMs, eventsFile),
  ]);
  assert.equal(a.pid, b.pid);
  assert.equal(a.instanceId, b.instanceId);
  assert.equal(a.root, b.root);
  assert.equal((await eventsAt(eventsFile)).filter((e) => e.type === 'core_start').length, 1);
  const saved = await client(root, { op: 'checkpoint', value: checkpoint }, idleMs, eventsFile);
  assert.equal(saved.receipt.state, 'saved');

  const [jobA, jobB] = await Promise.all([
    client(root, { op: 'submit', idempotencyKey: 'job-A', projectId: 'project-synthetic', taskId: 'task-synthetic', input: 'distinguishable input alpha', durationMs: 1500, fail: false }, idleMs, eventsFile),
    client(root, { op: 'submit', idempotencyKey: 'job-B', projectId: 'project-synthetic', taskId: 'task-synthetic', input: 'distinguishable input beta', durationMs: 1500, fail: false }, idleMs, eventsFile),
  ]);
  const dup = await client(root, { op: 'submit', idempotencyKey: 'job-A', projectId: 'project-synthetic', taskId: 'task-synthetic', input: 'different duplicate payload', durationMs: 650, fail: false }, idleMs, eventsFile);
  assert.equal(dup.job.id, jobA.job.id, 'duplicate idempotency key returns the original durable job');
  assert.equal(dup.duplicate, true, 'duplicate submission is explicitly reported');
  assert.equal(dup.job.input, 'distinguishable input alpha', 'first payload remains durable for a duplicate key');
  assert.notEqual(jobA.job.id, jobB.job.id);

  const otherScope = { projectId: 'project-other', taskId: 'task-other' };
  const otherScopeSubmission = await client(root, { op: 'submit', idempotencyKey: 'job-A', ...otherScope, input: 'scope-B unique input', durationMs: 0, fail: false }, idleMs, eventsFile);
  assert.equal(otherScopeSubmission.duplicate, false, 'the same caller key in another scope creates an independent job');
  assert.notEqual(otherScopeSubmission.job.id, jobA.job.id);
  assert.deepEqual([otherScopeSubmission.job.projectId, otherScopeSubmission.job.taskId, otherScopeSubmission.job.input], ['project-other', 'task-other', 'scope-B unique input']);
  const otherScopeRetry = await client(root, { op: 'submit', idempotencyKey: 'job-A', ...otherScope, input: 'later scope-B payload', durationMs: 0, fail: false }, idleMs, eventsFile);
  assert.equal(otherScopeRetry.duplicate, true, 'same-scope retry remains idempotent in the second scope');
  assert.equal(otherScopeRetry.job.id, otherScopeSubmission.job.id);
  assert.equal(otherScopeRetry.job.input, 'scope-B unique input');
  const crossScopeLookup = await client(root, { op: 'job', id: jobA.job.id, ...otherScope }, idleMs, eventsFile);
  assert.equal(crossScopeLookup.job, null, 'scoped lookup does not reveal another task job');

  const scope = { projectId: 'project-synthetic', taskId: 'task-synthetic' };
  const running = await waitFor(() => client(root, { op: 'status', ...scope }, idleMs, eventsFile), (r) => r.jobs.some((j: Json) => j.state === 'running'));
  const startedAt = Date.now();
  const loaded = await client(root, { op: 'load', projectId: 'project-synthetic', taskId: 'task-synthetic' }, idleMs, eventsFile);
  const readLatencyMs = Date.now() - startedAt;
  assert.ok(readLatencyMs < 1200, `checkpoint client round-trip took ${readLatencyMs}ms during a slow job`);
  assert.ok(loaded.coreLatencyMs < 100, `core read handler took ${loaded.coreLatencyMs}ms during a slow job`);
  assert.equal(loaded.packet.checkpoints.length, 1);
  assert.equal(running.instanceId, a.instanceId);
  t.diagnostic(`read during executor: client round-trip=${readLatencyMs}ms, core handler=${loaded.coreLatencyMs}ms; executor duration=1500ms`);

  const otherIdentity = await client(otherRoot, { op: 'identity' }, idleMs, eventsFile);
  assert.notEqual(otherIdentity.instanceId, a.instanceId);
  assert.notEqual(otherIdentity.root, a.root);
  const isolatedLoad = await client(otherRoot, { op: 'load', projectId: 'project-synthetic', taskId: 'task-synthetic' }, idleMs, eventsFile);
  assert.equal(isolatedLoad.packet, null, 'a distinct data root has a separate empty store');
  await waitFor(async () => eventsAt(eventsFile), (rows) => rows.some((e) => e.type === 'core_idle_stop' && e.instanceId === otherIdentity.instanceId));
  await waitFor(async () => ({ alive: alive(otherIdentity.pid) }), (r) => !r.alive, 2000);

  await waitFor(() => client(root, { op: 'status', ...scope }, idleMs, eventsFile), (r) => r.jobs.filter((j: Json) => j.state === 'completed').length === 2);
  const [durableA, durableB] = await Promise.all([
    client(root, { op: 'job', id: jobA.job.id, ...scope }, idleMs, eventsFile),
    client(root, { op: 'job', id: jobB.job.id, ...scope }, idleMs, eventsFile),
  ]);
  assert.deepEqual([durableA.job.projectId, durableA.job.taskId, durableA.job.input], ['project-synthetic', 'task-synthetic', 'distinguishable input alpha']);
  assert.deepEqual([durableB.job.projectId, durableB.job.taskId, durableB.job.input], ['project-synthetic', 'task-synthetic', 'distinguishable input beta']);
  const duplicateEvents = (await eventsAt(eventsFile)).filter((e) => e.type === 'executor_start' && e.jobId === jobA.job.id);
  assert.equal(duplicateEvents.length, 1, 'duplicate submit did not execute twice');
  const jobEvents = (await eventsAt(eventsFile)).filter((e) => e.type === 'executor_start' || e.type === 'executor_end');
  let active = 0;
  let maxActive = 0;
  for (const item of jobEvents) {
    if (item.type === 'executor_start') active++;
    else active--;
    maxActive = Math.max(maxActive, active);
  }
  assert.equal(maxActive, 1);
  assert.deepEqual(new Set(jobEvents.filter((e) => e.type === 'executor_start').map((e) => e.input)), new Set(['distinguishable input alpha', 'distinguishable input beta', 'scope-B unique input']));

  // A deterministic executor failure remains visibly failed and does not block the next queue item.
  const failed = await client(root, { op: 'submit', idempotencyKey: 'job-failure', projectId: 'project-synthetic', taskId: 'task-synthetic', input: 'synthetic failing job', durationMs: 80, fail: true }, idleMs, eventsFile);
  const beforeHold = await client(root, { op: 'identity' }, idleMs, eventsFile);
  const hold = client(root, { op: 'hold', durationMs: 2000 }, idleMs, eventsFile);
  await waitFor(() => client(root, { op: 'job', id: failed.job.id, ...scope }, idleMs, eventsFile), (r) => r.job.state === 'failed');

  // Hold one client connection while a second client comes and goes.
  const whileHeld = await client(root, { op: 'identity' }, idleMs, eventsFile);
  assert.equal(whileHeld.instanceId, beforeHold.instanceId);
  await hold;
  await waitFor(async () => eventsAt(eventsFile), (rows) => rows.some((e) => e.type === 'core_idle_stop' && e.instanceId === beforeHold.instanceId));
  await waitFor(async () => ({ alive: alive(beforeHold.pid) }), (r) => !r.alive, 2000);
  // A fresh client starts a new core after idle exit, then SIGKILL leaves a stale socket.
  const restarted = await client(root, { op: 'identity' }, idleMs, eventsFile);
  assert.notEqual(restarted.instanceId, beforeHold.instanceId);
  t.diagnostic(`idle shutdown: pid ${beforeHold.pid} exited; fresh client received instance ${restarted.instanceId}`);
  const crashJob = await client(root, { op: 'submit', idempotencyKey: 'job-crash', projectId: 'project-synthetic', taskId: 'task-synthetic', input: 'crash-window input', durationMs: 5000, fail: false }, idleMs, eventsFile);
  await waitFor(() => client(root, { op: 'job', id: crashJob.job.id, ...scope }, idleMs, eventsFile), (r) => r.job.state === 'running');
  const queuedJob = await client(root, { op: 'submit', idempotencyKey: 'job-after-crash', projectId: 'project-synthetic', taskId: 'task-synthetic', input: 'queued behind interrupted job', durationMs: 80, fail: false }, idleMs, eventsFile);
  const startsBeforeCrash = (await eventsAt(eventsFile)).filter((e) => e.type === 'core_start' && e.root === a.root).length;
  process.kill(restarted.pid, 'SIGKILL');
  await waitFor(async () => ({ alive: alive(restarted.pid) }), (r) => !r.alive, 2000);
  const [recovered, recoveredIdentity] = await Promise.all([
    client(root, { op: 'status', ...scope }, idleMs, eventsFile),
    client(root, { op: 'identity' }, idleMs, eventsFile),
  ]);
  assert.equal(recovered.instanceId, recoveredIdentity.instanceId);
  assert.equal(recovered.pid, recoveredIdentity.pid);
  assert.notEqual(recovered.instanceId, restarted.instanceId);
  assert.equal(recovered.jobs.find((j: Json) => j.id === crashJob.job.id).state, 'failed');
  assert.match(recovered.jobs.find((j: Json) => j.id === crashJob.job.id).error, /terminated during execution/);
  const queuedAfterRecovery = await waitFor(() => client(root, { op: 'job', id: queuedJob.job.id, ...scope }, idleMs, eventsFile), (r) => r.job.state === 'completed');
  assert.equal(queuedAfterRecovery.job.input, 'queued behind interrupted job');
  const crashJobState = await client(root, { op: 'job', id: crashJob.job.id, ...scope }, idleMs, eventsFile);
  const packetAfterCrash = await client(root, { op: 'load', projectId: 'project-synthetic', taskId: 'task-synthetic' }, idleMs, eventsFile);
  assert.equal(packetAfterCrash.packet.checkpoints[0].session.id, 'session-client-a');
  assert.equal(crashJobState.job.result, null, 'interrupted work was not falsely committed');
  assert.equal((await eventsAt(eventsFile)).filter((e) => e.type === 'core_start' && e.root === a.root).length, startsBeforeCrash + 1);
  t.diagnostic(`crash recovery: killed pid ${restarted.pid}; replacement pid ${recovered.pid} marked in-flight job ${crashJob.job.id} failed, resumed queued job ${queuedJob.job.id}, and loaded the saved checkpoint; max executor concurrency=${maxActive}`);
  t.diagnostic(`environment: ${process.platform}/${process.arch}, Node ${process.version}, SQLite ${process.versions.sqlite ?? 'unknown'}`);
  await waitFor(async () => eventsAt(eventsFile), (rows) => rows.some((e) => e.type === 'core_idle_stop' && e.instanceId === recovered.instanceId));
  await waitFor(async () => ({ alive: alive(recovered.pid) }), (r) => !r.alive, 2000);
  t.diagnostic(`resource cleanup: replacement pid ${recovered.pid} exited after final disconnect and idle grace`);
});
