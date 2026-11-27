import { appendFileSync } from "node:fs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

const event = JSON.parse(raw);
const summary = {
  event: event.hook_event_name,
  sessionIdPresent: typeof event.session_id === "string",
  promptPresent: typeof event.prompt === "string",
  transcriptPathPresent: typeof event.transcript_path === "string",
  source: typeof event.source === "string" ? event.source : undefined,
  reason: typeof event.reason === "string" ? event.reason : undefined,
};

if (!process.env.F1_PROBE_LOG) {
  throw new Error("F1_PROBE_LOG must point to a local probe log");
}

appendFileSync(process.env.F1_PROBE_LOG, `${JSON.stringify(summary)}\n`, {
  mode: 0o600,
});
