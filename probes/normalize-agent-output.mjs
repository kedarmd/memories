import { createInterface } from "node:readline";

const harness = process.argv[2];
if (harness !== "codex" && harness !== "opencode") {
  throw new Error("usage: node normalize-agent-output.mjs <codex|opencode>");
}

const checkpointFields = ["objective", "decision", "completed", "failed_attempt", "blocker", "evidence"];
let sessionId;
let response;

for await (const line of createInterface({ input: process.stdin })) {
  try {
    const event = JSON.parse(line);
    const eventSessionId = harness === "codex" ? event.thread_id : event.sessionID;
    if (typeof eventSessionId === "string") sessionId = eventSessionId;

    const isAgentMessage = harness === "codex" && event.item?.type === "agent_message";
    const isTextMessage = harness === "opencode" && event.type === "text";
    const text = isAgentMessage ? event.item.text : isTextMessage ? event.part?.text : undefined;
    if (typeof text !== "string") continue;

    const candidate = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    if (!checkpointFields.every((field) => Object.hasOwn(candidate, field))) continue;
    response = candidate;
  } catch {
    // Ignore startup notices, non-JSON events, and non-JSON response items.
  }
}

if (!sessionId) throw new Error(`${harness} output did not include a session identifier`);
if (!response) throw new Error(`${harness} output did not include all checkpoint fields as JSON`);

function asTextList(value, field) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${field} must contain non-empty text`);
  }
  return values.map((item) => item.trim());
}

function normalizeEvidence(value) {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) throw new Error("evidence must include at least one reference");
  return items.map((item) => {
    if (typeof item === "string") return { kind: "file", ref: item.trim() };
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("evidence entries must be text or objects");
    }
    const ref = typeof item.ref === "string" ? item.ref : item.path;
    if (typeof ref !== "string" || ref.trim() === "") {
      throw new Error("evidence entry must contain a ref or path");
    }
    const kind = ["session-event", "session-export", "manual", "file"].includes(item.kind)
      ? item.kind
      : "file";
    return { kind, ref: ref.trim() };
  });
}

const normalized = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  session: { harness, sessionId },
  objective: asTextList(response.objective, "objective").join(" "),
  decisions: asTextList(response.decision, "decision"),
  completed: asTextList(response.completed, "completed"),
  failedAttempts: asTextList(response.failed_attempt, "failed_attempt"),
  blockers: asTextList(response.blocker, "blocker"),
  evidence: normalizeEvidence(response.evidence),
  coverage: "explicit-checkpoint",
};

process.stdout.write(`${JSON.stringify(normalized)}\n`);
