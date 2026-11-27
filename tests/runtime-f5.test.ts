import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { ContinuationStore } from '../src/continuation.ts';

type Json = Record<string, any>;
const entry = resolve('src/runtime-f5.ts');

function client(root: string, request: Json, idleMs: number, events: string): Promise<Json> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', entry, 'client', root, JSON.stringify(request), String(idleMs), events], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('client timed out')); }, 10_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { out += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`client exit ${String(code)}: ${err}`)); return; }
      try { resolvePromise(JSON.parse(out.trim()) as Json); } catch { reject(new Error(`invalid client output: ${out}; ${err}`)); }
    });
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
  assert.deepEqual(new Set(jobEvents.filter((e) => e.type === 'executor_start').map((e) => e.input)), new Set(['distinguishable input alpha', 'distinguishable input beta']));

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
  const recovered = await client(root, { op: 'status', ...scope }, idleMs, eventsFile);
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
