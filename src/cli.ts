#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { stdin, stdout, stderr } from 'node:process';
import { Effect } from 'effect';
import { MemoriesStore, defaultDataRoot } from './storage.ts';

const help = `Memories Stage 1 CLI — migration-backed, explicitly scoped local persistence

Usage:
  memories <command> [--input <file|->] [--data-dir <directory>]

Commands:
  register-project   Register or reuse a project
  task-create        Create or reuse a task by project and objective
  checkpoint-save    Save an attributed checkpoint (returns status: saved after commit)
  task-load          Load a bounded packet for an explicit project and task

Structured JSON is read from --input FILE or stdin. Each command accepts one JSON object.
Set MEMORIES_DATA_DIR (or XDG_DATA_HOME) to choose an isolated data root.
Linux default: ~/.local/share/memories; the data directory is created with mode 0700.

Examples:
  memories register-project --input project.json
  cat checkpoint.json | memories checkpoint-save
  memories task-load --input scope.json --data-dir /tmp/memories-test
`;

type ParsedArgs = { command: string; inputFile?: string; dataDir?: string };
function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] ?? 'help';
  let inputFile: string | undefined;
  let dataDir: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { command: 'help' };
    if (arg === '--input') {
      const value = args[++i];
      if (!value) throw new Error('--input requires a file path or -');
      inputFile = value;
    } else if (arg === '--data-dir') {
      const value = args[++i];
      if (!value) throw new Error('--data-dir requires a directory path');
      dataDir = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, ...(inputFile === undefined ? {} : { inputFile }), ...(dataDir === undefined ? {} : { dataDir }) };
}

async function readInput(file?: string): Promise<unknown> {
  const content = file === undefined || file === '-' ? await new Promise<string>((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > 128_000) reject(new Error('Structured input exceeds 128 KB'));
    });
    stdin.on('end', () => resolve(data));
    stdin.on('error', reject);
  }) : readFileSync(file, 'utf8');
  if (content.length > 128_000) throw new Error('Structured input exceeds 128 KB');
  try { return JSON.parse(content) as unknown; }
  catch { throw new Error('Input must be one valid JSON object'); }
}

async function run(): Promise<void> {
  let store: MemoriesStore | undefined;
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === 'help' || args.command === '--help') {
      stdout.write(help);
      return;
    }
    const input = await readInput(args.inputFile);
    store = new MemoriesStore(args.dataDir ?? defaultDataRoot());
    const result = Effect.runSync(Effect.try({
      try: () => {
        switch (args.command) {
          case 'register-project': return store!.registerProject(input);
          case 'task-create': return store!.createTask(input);
          case 'checkpoint-save': return store!.saveCheckpoint(input);
          case 'task-load': return store!.loadTask(input);
          default: throw new Error(`Unknown command: ${args.command}. Run memories --help for usage.`);
        }
      },
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }));
    stdout.write(`${JSON.stringify({ ok: true, command: args.command, result }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('Unknown project') || message.includes('Unknown task') ? 'scope_error' :
      message.includes('already exists') || message.includes('already in use') ? 'conflict' :
      message.startsWith('[') || message.includes('validation') || message.includes('Invalid input') ? 'invalid_input' : 'error';
    stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

await run();
