import { appendFileSync } from "node:fs";
import { Plugin } from "@opencode/plugin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default Plugin.define({
  id: "memories-f1-capture-probe",
  setup(ctx) {
    const logPath = process.env.F1_PROBE_LOG;
    if (!logPath) throw new Error("F1_PROBE_LOG must point to a local probe log");

    const controller = new AbortController();
    void (async () => {
      const types = [
        "session.created",
        "session.execution.started",
        "session.execution.succeeded",
        "session.execution.failed",
        "session.execution.interrupted",
        "session.compaction.started",
        "session.compaction.ended",
        "session.compaction.failed",
        "session.text.ended",
        "session.tool.called",
      ] as const;

      for await (const event of ctx.event.subscribe({
        signal: controller.signal,
        types: [...types],
      })) {
        const data: unknown = "data" in event ? event.data : undefined;
        const record = isRecord(data) ? data : {};
        appendFileSync(
          logPath,
          `${JSON.stringify({
            type: event.type,
            sessionIdPresent: typeof record.sessionID === "string",
            messageIdPresent: typeof record.messageID === "string",
            contentPresent: typeof record.text === "string",
          })}\n`,
          { mode: 0o600 },
        );
      }
    })().catch((error: unknown) => {
      appendFileSync(
        logPath,
        `${JSON.stringify({ probeError: error instanceof Error ? error.name : "unknown" })}\n`,
        { mode: 0o600 },
      );
    });

    return () => controller.abort();
  },
});
