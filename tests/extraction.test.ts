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

test('terminates an executor at timeout and caps combined stdout/stderr', async () => {
  assert.equal(await rejectedCode(extractCheckpoint(input, command('setTimeout(() => {}, 10000)', { timeoutMs: 30 }))), 'TIMEOUT');
  assert.equal(await rejectedCode(extractCheckpoint(input, command("process.stderr.write('x'.repeat(1000))", { maxOutputBytes: 128 }))), 'OUTPUT_LIMIT');
});

test('reports caller cancellation and terminates the child process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'memories-extraction-'));
  const pidFile = join(dir, 'child.pid');
  const controller = new AbortController();
  try {
    const config = command("import { writeFileSync } from 'node:fs'; writeFileSync('child.pid', String(process.pid)); setTimeout(() => {}, 10000)", { cwd: dir });
    const running = Effect.runPromise(extractCheckpoint(input, config), { signal: controller.signal });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await readFile(pidFile, 'utf8'); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    const pid = Number(await readFile(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);
    controller.abort();
    await assert.rejects(running, /interrupted/i);
    let terminated = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 10)); }
      catch { terminated = true; break; }
    }
    assert.equal(terminated, true, 'cancelled executor child should be terminated');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
