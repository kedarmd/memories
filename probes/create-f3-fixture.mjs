import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "memories-f3-demo-"));
await mkdir(join(root, "src"));
await mkdir(join(root, "test"));
await writeFile(join(root, "package.json"), JSON.stringify({
  name: "f3-label-parser-demo", private: true, type: "module", scripts: { test: "node --test" },
}, null, 2) + "\n");
await writeFile(join(root, "src/labels.mjs"), `// Parse a small comma-separated label list. This starter intentionally lacks quoted-field support.
export function parseLabels(input) {
  if (typeof input !== 'string') throw new TypeError('input must be a string');
  return input.split(',').map((value) => value.trim());
}
`);
await writeFile(join(root, "test/labels.test.mjs"), `import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLabels } from '../src/labels.mjs';

test('parses basic labels', () => {
  assert.deepEqual(parseLabels('red, blue'), ['red', 'blue']);
});
`);
for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=F3", "-c", "user.email=f3@example.invalid", "commit", "-qm", "fixture: start label parser task"]]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}
console.log(root);
