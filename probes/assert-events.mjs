import { readFile } from "node:fs/promises";

const [harness, filePath] = process.argv.slice(2);
const requireInterrupted = process.argv.includes("--interrupted");
if (!filePath || (harness !== "codex" && harness !== "opencode")) {
  throw new Error("usage: node assert-events.mjs <codex|opencode> <sanitized-event-log.jsonl> [--interrupted]");
}

const events = (await readFile(filePath, "utf8"))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const typeOf = (event) => (harness === "codex" ? event.event : event.type);
const attributed = (event) =>
  harness === "codex" ? event.sessionIdPresent === true : event.sessionIdPresent === true || event.sessionIDPresent === true;
const required =
  harness === "codex"
    ? ["SessionStart", "UserPromptSubmit", "SessionEnd"]
    : ["session.execution.started", "session.text.ended", "session.execution.succeeded"];

for (const expectedType of required) {
  const matching = events.filter((event) => typeOf(event) === expectedType);
  if (matching.length === 0) throw new Error(`missing event type: ${expectedType}`);
  if (!matching.some(attributed)) throw new Error(`event lacks session attribution: ${expectedType}`);
}
if (requireInterrupted) {
  const interrupted = events.filter((event) => typeOf(event) === "session.execution.interrupted");
  if (!interrupted.some(attributed)) {
    throw new Error("missing attributed event type: session.execution.interrupted");
  }
}
if (harness === "codex" && !events.some((event) => typeOf(event) === "UserPromptSubmit" && event.promptPresent)) {
  throw new Error("UserPromptSubmit did not report prompt presence");
}

process.stdout.write(`${JSON.stringify({
  status: "events-asserted",
  harness,
  requiredTypes: requireInterrupted ? [...required, "session.execution.interrupted"] : required,
})}\n`);
