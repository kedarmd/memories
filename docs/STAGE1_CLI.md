# Stage 1 persistence and CLI

Stage 1 provides a local SQLite database for explicitly registered projects, tasks, and saved checkpoints. It does not start a shared core, expose MCP, inspect Git repositories, call a model, or modify repository files.

## Data location

On Linux the default root is `~/.local/share/memories`. `XDG_DATA_HOME` changes this to `$XDG_DATA_HOME/memories`, and `MEMORIES_DATA_DIR` selects an exact root. Every command accepts `--data-dir` as a convenient isolated override. A newly created app-specific root is set to mode `0700`; an existing root is never chmodded. Existing roots must be a directory owned by the current user with no group/other permission bits and owner access to read, write, and traverse, or startup fails with the actual mode in the error. The database is `memories.sqlite` inside it. One root holds one logical knowledge database shared by all registered projects. A small SQLite lock file serializes migrations and contains no project/task/checkpoint records.

## Commands

Run the local TypeScript CLI with `npm run memories -- <command>`. Commands accept one JSON object from stdin or `--input FILE` (`--input -` also reads stdin), and print a JSON success object to stdout. Input is limited to 128,000 bytes before JSON parsing. Stdin is destroyed at the first oversized chunk; files are checked by size before opening and streamed with a hard byte cap if they grow after the check. Errors are JSON objects on stderr and exit nonzero. Run `npm run memories -- --help` for usage.

```sh
export MEMORIES_DATA_DIR="$HOME/.local/share/memories"

npm run memories -- register-project --input project.json
npm run memories -- task-create --input task.json
npm run memories -- checkpoint-save --input checkpoint.json
npm run memories -- task-load --input scope.json
```

`register-project` input:

```json
{"id":"memories-project-1","name":"Example","gitRoot":"/work/example"}
```

`gitRoot` is optional and is only a reuse hint; the explicit Memories project ID is authoritative. Repeating the project ID with the same registration returns the existing record. If a root hint is already associated with a different project ID, registration returns a conflict and tells the caller which ID to use; it never silently replaces or chooses an identity based on the path.

`task-create` input:

```json
{"projectId":"memories-project-1","id":"task-15","objective":"Implement the persistence foundation"}
```

A task is reused by `(projectId, objective)`. Its ID remains stable after database reopen. The project must already exist.

`checkpoint-save` input:

```json
{
  "projectId":"memories-project-1",
  "taskId":"task-15",
  "dedupeKey":"session-7-checkpoint-2",
  "summary":"Added project registration and migration tests",
  "details":"Registration, task creation, and SQLite constraints are implemented.",
  "sessionAgent":"codex",
  "sessionId":"session-7",
  "workspace":"/work/example",
  "coverage":{"status":"partial","notes":"CLI error cases remain."},
  "sources":[{"reference":"src/storage.ts","kind":"file","note":"Caller supplied reference."}]
}
```

`coverage.status` is `complete`, `partial`, or `unknown`. `sources` may be empty. Supported source kinds are `file`, `commit`, `session`, `ticket`, `url`, and `other`. References are stored as attributed strings with `verification: unverified`; source presence is not evidence that a reference exists or supports a claim. Input is bounded to 128 KiB per command, 2,000 characters per summary, 20,000 per details field, 50 sources, and 2,000 characters per source reference. Idempotency is first-write-wins within `(projectId, taskId, dedupeKey)`; the same key in another scope is independent.

The save response reports `status: saved` only after SQLite returns from the durable insert. It does not mean the checkpoint was extracted, queued, or verified.

`task-load` input:

```json
{"projectId":"memories-project-1","taskId":"task-15"}
```

It returns at most 20 checkpoints for that exact project/task, with attribution, caller-reported coverage, source verification labels, and limitations. An unknown or wrong-project task returns `result: null`; a save against an unknown task returns a controlled scope error. No other project or task is searched.

## Migrations

The Drizzle schema lives in `src/schema.ts`, configured by `drizzle.config.ts`. Generate migrations with `npm run db:generate`; validate the checked-in journal/snapshots with `npm run db:check`. Generated SQL, `_journal.json`, and schema snapshots live in `drizzle/` and are consumed by Drizzle's SQLite migrator at runtime. Migration `0000` creates the initial identity/scope schema. Migration `0001` adds checkpoint coverage and source provenance with conservative backfill values. Drizzle applies pending migrations and its journal updates in a transaction. A separate small SQLite lock serializes migrator startup because Drizzle reads its journal before opening that transaction. Opening a new or existing database is repeatable.

Validated environment for this Stage 1 work: Linux x86_64, Node.js `v24.22.3`, better-sqlite3 `13.2.0`, SQLite `3.54.1`. Other operating systems have not been tested.
