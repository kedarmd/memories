import { createInterface } from "node:readline";

for await (const line of createInterface({ input: process.stdin })) {
  try {
    const event = JSON.parse(line);
    const summary = { type: event.type };
    if (typeof event.thread_id === "string") summary.sessionIdPresent = true;
    if (event.item && typeof event.item.type === "string") {
      summary.itemType = event.item.type;
      const content =
        typeof event.item.text === "string"
          ? event.item.text
          : typeof event.item.message === "string"
            ? event.item.message
            : undefined;
      summary.contentPresent = content !== undefined;
      if (content !== undefined) {
        try {
          const parsed = JSON.parse(content);
          const fields = ["objective", "decision", "completed", "failed_attempt", "blocker", "evidence"];
          summary.structuredFieldsPresent = fields.filter((field) => Object.hasOwn(parsed, field));
          summary.sourcePathPresent = JSON.stringify(parsed.evidence ?? "").includes("src/counter.ts");
        } catch {
          summary.structuredFieldsPresent = [];
          summary.sourcePathPresent = false;
        }
      }
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    // Codex may print a non-JSON startup notice before the JSONL stream.
  }
}
