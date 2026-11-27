const MAX_BYTES = 16 * 1024;
const MAX_LIST_ITEMS = 20;
const MAX_TEXT_LENGTH = 1_000;

let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    throw new Error(`checkpoint exceeds ${MAX_BYTES} bytes`);
  }
}

const input = JSON.parse(raw);
const object = (value, name, allowedKeys) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`${name} has unknown field: ${key}`);
  }
  return value;
};
const text = (value, name, max = MAX_TEXT_LENGTH) => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(`${name} must be non-empty text no longer than ${max} characters`);
  }
  return value.trim();
};
const textList = (value, name) => {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${name} must be an array with at most ${MAX_LIST_ITEMS} entries`);
  }
  return value.map((item, index) => text(item, `${name}[${index}]`));
};

const root = object(input, "checkpoint", [
  "schemaVersion",
  "capturedAt",
  "session",
  "objective",
  "decisions",
  "completed",
  "failedAttempts",
  "blockers",
  "evidence",
  "coverage",
]);
if (root.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
if (typeof root.capturedAt !== "string" || Number.isNaN(Date.parse(root.capturedAt))) {
  throw new Error("capturedAt must be a valid timestamp");
}
if (root.coverage !== "explicit-checkpoint") {
  throw new Error('coverage must be "explicit-checkpoint"');
}

const session = object(root.session, "session", ["harness", "sessionId"]);
if (!["codex", "opencode", "other"].includes(session.harness)) {
  throw new Error('session.harness must be "codex", "opencode", or "other"');
}
const evidence = root.evidence;
if (!Array.isArray(evidence) || evidence.length > MAX_LIST_ITEMS) {
  throw new Error(`evidence must be an array with at most ${MAX_LIST_ITEMS} entries`);
}
const normalizedEvidence = evidence.map((entry, index) => {
  const item = object(entry, `evidence[${index}]`, ["kind", "ref"]);
  if (!["session-event", "session-export", "manual", "file"].includes(item.kind)) {
    throw new Error(`evidence[${index}].kind is unsupported`);
  }
  return { kind: item.kind, ref: text(item.ref, `evidence[${index}].ref`, 500) };
});

const checkpoint = {
  schemaVersion: 1,
  capturedAt: new Date(root.capturedAt).toISOString(),
  session: {
    harness: session.harness,
    sessionId: text(session.sessionId, "session.sessionId", 128),
  },
  objective: text(root.objective, "objective"),
  decisions: textList(root.decisions, "decisions"),
  completed: textList(root.completed, "completed"),
  failedAttempts: textList(root.failedAttempts, "failedAttempts"),
  blockers: textList(root.blockers, "blockers"),
  evidence: normalizedEvidence,
  coverage: "explicit-checkpoint",
};

process.stdout.write(`${JSON.stringify({ status: "validated-only", checkpoint }, null, 2)}\n`);
