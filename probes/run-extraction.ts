import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { extractCheckpoint } from '../src/extraction.ts';

const [checkpointPath, sampleRepo] = process.argv.slice(2);
if (!checkpointPath || !sampleRepo) {
  throw new Error('usage: node --experimental-strip-types probes/run-extraction.ts <checkpoint.json> <sample-repo>');
}
const checkpoint: unknown = JSON.parse(await readFile(checkpointPath, 'utf8'));
const result = await Effect.runPromise(extractCheckpoint(checkpoint, {
  command: 'codex',
  args: ['exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--json', '-m', 'gpt-6-luna', '-C', sampleRepo],
  cwd: sampleRepo,
  timeoutMs: 90_000,
}));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
