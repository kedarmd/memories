import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { extractCheckpoint, type CheckpointInput, type ExecutorConfig, ExtractionError } from '../src/extraction.ts';

const input: CheckpointInput = {
  schemaVersion: 1,
  projectId: 'project-demo',
  taskId: 'task-1',
  sessionRef: 'session-1',
  checkpoint: 'Decided to use a 30 second TTL. Implemented the bounded cache. First tried an unbounded map; expired keys remained. Blocked on production invalidation semantics.',
  sourceLinks: [{ kind: 'file', ref: 'src/cache-policy.md' }, { kind: 'session-event', ref: 'session-1#checkpoint' }],
  coverage: 'partial',
  uncertainty: 'Only a disposable fixture was exercised.',
};

function event(proposals: unknown): string {
  return `${JSON.stringify({ item: { type: 'agent_message', text: JSON.stringify(proposals) } })}\n`;
}

function command(script: string, options: Partial<ExecutorConfig> = {}): ExecutorConfig {
  return { command: process.execPath, args: ['--input-type=module', '-e', script], cwd: tmpdir(), ...options };
}

const validProposal = {
  proposals: [{
    category: 'decision',
    claim: 'Use a 30 second TTL for the cache.',
    scope: { projectId: 'project-demo', taskId: 'task-1' },
    evidenceRefs: ['src/cache-policy.md'],
    uncertainty: 'Observed in the disposable fixture; not independently verified for production.',
  }],
};

async function rejectedCode(effect: ReturnType<typeof extractCheckpoint>): Promise<string> {
  const result = await Effect.runPromise(Effect.either(effect));
  assert.equal(result._tag, 'Left', 'expected extraction to fail');
  assert.ok(result.left instanceof ExtractionError);
  return result.left.code;
}

async function waitForPids(dir: string, names: string[]): Promise<number[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await Promise.all(names.map(async (name) => Number(await readFile(join(dir, name), 'utf8'))));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.fail(`child pid files were not written: ${names.join(', ')}`);
}

function pidIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function assertPidsExited(pids: number[]): Promise<void> {
  assert.deepEqual(pids.map(pidIsAlive), pids.map(() => false), 'executor process group must be gone before extraction settles');
}

async function forceCleanup(pids: number[]): Promise<void> {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
  }
}

function parentAndGrandchildScript(dir: string, outputLimit = false, detachGrandchild = false): string {
  const grandchild = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(dir, 'grandchild.pid'))}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { spawn } from 'node:child_process';",
    `writeFileSync(${JSON.stringify(join(dir, 'parent.pid'))}, String(process.pid));`,
    "process.on('SIGTERM', () => {});",
    `spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit', detached: ${detachGrandchild} });`,
    outputLimit ? "setTimeout(() => process.stdout.write('x'.repeat(1024)), 100);" : '',
    'setInterval(() => {}, 1000);',
  ].filter(Boolean).join('\n');
}

async function readPids(dir: string): Promise<number[]> {
  const pids: number[] = [];
  for (const name of ['parent.pid', 'grandchild.pid']) {
    try { pids.push(Number(await readFile(join(dir, name), 'utf8'))); } catch { /* child may not have started */ }
  }
  return pids;
}

test('validates the bounded input before starting a process', async () => {
  assert.equal(await rejectedCode(extractCheckpoint({ ...input, ignored: true }, command('process.exit(0)'))), 'INVALID_INPUT');
  assert.equal(await rejectedCode(extractCheckpoint({ ...input, checkpoint: 'x'.repeat(8_001) }, command('process.exit(0)'))), 'INVALID_INPUT');
  assert.equal(await rejectedCode(extractCheckpoint({ ...input, sourceLinks: Array.from({ length: 20 }, (_, index) => ({ kind: 'file' as const, ref: `${index}${'x'.repeat(500)}` })) }, command('process.exit(0)'))), 'INVALID_INPUT');
  assert.equal(await rejectedCode(extractCheckpoint(input, command('process.exit(0)', { timeoutMs: 120_001 }))), 'INVALID_INPUT');
});

test('validates and marks proposals unverified; identical input has a stable idempotency key', async () => {
  const config = command(`process.stdout.write(${JSON.stringify(event(validProposal))})`);
  const first = await Effect.runPromise(extractCheckpoint(input, config));
  const second = await Effect.runPromise(extractCheckpoint(input, config));
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.proposals[0]?.status, 'proposed-unverified');
  assert.equal(first.proposals[0]?.evidenceRefs[0], 'src/cache-policy.md');
});

test('rejects fabricated source references and mismatched task scope', async () => {
  const fabricated = structuredClone(validProposal);
  fabricated.proposals[0]!.evidenceRefs = ['src/imaginary.ts'];
  assert.equal(await rejectedCode(extractCheckpoint(input, command(`process.stdout.write(${JSON.stringify(event(fabricated))})`))), 'UNSUPPORTED_EVIDENCE');
  const wrongScope = structuredClone(validProposal);
  wrongScope.proposals[0]!.scope.taskId = 'another-task';
  assert.equal(await rejectedCode(extractCheckpoint(input, command(`process.stdout.write(${JSON.stringify(event(wrongScope))})`))), 'UNSUPPORTED_EVIDENCE');
});

test('reports malformed output, missing CLI, and nonzero exit distinctly', async () => {
  assert.equal(await rejectedCode(extractCheckpoint(input, command("process.stdout.write('not JSON')"))), 'INVALID_OUTPUT');
  assert.equal(await rejectedCode(extractCheckpoint(input, command(`process.stdout.write(${JSON.stringify(event({ proposals: [] }))})`))), 'INVALID_OUTPUT');
  assert.equal(await rejectedCode(extractCheckpoint(input, { command: '/missing/codex-cli', cwd: tmpdir() })), 'UNAVAILABLE');
  assert.equal(await rejectedCode(extractCheckpoint(input, command('process.exit(7)'))), 'NONZERO_EXIT');
});

test('timeout waits for a TERM-ignoring executor and its descendant to exit', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memories-timeout-'));
  let pids: number[] = [];
  try {
    const effect = extractCheckpoint(input, command(parentAndGrandchildScript(dir), { cwd: dir, timeoutMs: 300 }));
    const running = Effect.runPromise(Effect.either(effect));
    pids = await waitForPids(dir, ['parent.pid', 'grandchild.pid']);
    const result = await running;
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left.code, 'TIMEOUT');
    await assertPidsExited(pids);
  } finally {
    await forceCleanup(pids.length > 0 ? pids : await readPids(dir));
    await rm(dir, { recursive: true, force: true });
  }
});

test('output limit waits for a TERM-ignoring executor and its descendant to exit', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memories-output-limit-'));
  let pids: number[] = [];
  try {
    const effect = extractCheckpoint(input, command(parentAndGrandchildScript(dir, true), { cwd: dir, maxOutputBytes: 128 }));
    const running = Effect.runPromise(Effect.either(effect));
    pids = await waitForPids(dir, ['parent.pid', 'grandchild.pid']);
    const result = await running;
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left.code, 'OUTPUT_LIMIT');
    await assertPidsExited(pids);
    assert.equal(await rejectedCode(extractCheckpoint(input, command("process.stderr.write('x'.repeat(1000))", { maxOutputBytes: 128 }))), 'OUTPUT_LIMIT');
  } finally {
    await forceCleanup(pids.length > 0 ? pids : await readPids(dir));
    await rm(dir, { recursive: true, force: true });
  }
});

test('reports bounded cleanup failure when a detached descendant keeps output pipes open', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memories-cleanup-failure-'));
  let pids: number[] = [];
  try {
    const effect = extractCheckpoint(input, command(parentAndGrandchildScript(dir, false, true), { cwd: dir, timeoutMs: 300 }));
    const running = Effect.runPromise(Effect.either(effect));
    pids = await waitForPids(dir, ['parent.pid', 'grandchild.pid']);
    const result = await running;
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left') assert.equal(result.left.code, 'CLEANUP_FAILED');
    assert.equal(pidIsAlive(pids[0]!), false, 'executor in the owned process group should have exited');
    assert.equal(pidIsAlive(pids[1]!), true, 'bounded cleanup failure must not report the detached descendant as cleaned');
  } finally {
    await forceCleanup(pids.length > 0 ? pids : await readPids(dir));
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancellation waits for a TERM-ignoring executor and its descendant to exit', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memories-extraction-'));
  const controller = new AbortController();
  let pids: number[] = [];
  try {
    const config = command(parentAndGrandchildScript(dir), { cwd: dir });
    const running = Effect.runPromise(extractCheckpoint(input, config), { signal: controller.signal });
    pids = await waitForPids(dir, ['parent.pid', 'grandchild.pid']);
    controller.abort();
    await assert.rejects(running, /interrupted/i);
    await assertPidsExited(pids);
  } finally {
    await forceCleanup(pids.length > 0 ? pids : await readPids(dir));
    await rm(dir, { recursive: true, force: true });
  }
});
