import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const validator = new URL("./validate-checkpoint.mjs", import.meta.url);
const fixture = readFileSync(new URL("./checkpoint-example.json", import.meta.url), "utf8");

function validate(input) {
  return spawnSync(process.execPath, [validator.pathname], {
    input,
    encoding: "utf8",
  });
}

test("validates an explicit checkpoint without claiming persistence", () => {
  const result = validate(fixture);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "validated-only");
  assert.equal(parsed.checkpoint.coverage, "explicit-checkpoint");
});

test("rejects unknown fields at the boundary", () => {
  const value = JSON.parse(fixture);
  value.transcript = "must not be accepted implicitly";
  const result = validate(JSON.stringify(value));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown field/);
});

test("rejects payloads larger than the bounded probe contract", () => {
  const result = validate(" ".repeat(16 * 1024 + 1));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds 16384 bytes/);
});
