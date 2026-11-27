import { createInterface } from "node:readline";

for await (const line of createInterface({ input: process.stdin })) {
  try {
    const event = JSON.parse(line);
    const summary = { type: event.type };
    if (typeof event.sessionID === "string") summary.sessionIdPresent = true;
    if (event.part && typeof event.part.type === "string") {
      summary.partType = event.part.type;
      const content = typeof event.part.text === "string" ? event.part.text : undefined;
      summary.contentPresent = content !== undefined;
      if (content !== undefined) {
        try {
          const parsed = JSON.parse(content);
          const fields = ["objective", "decision", "completed", "failed_attempt", "blocker", "evidence"];
          summary.structuredFieldsPresent = fields.filter((field) => Object.hasOwn(parsed, field));
          summary.sourcePathPresent =
            typeof parsed.evidence === "string" && parsed.evidence.includes("src/counter.ts");
        } catch {
          summary.structuredFieldsPresent = [];
          summary.sourcePathPresent = false;
        }
      }
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    // Ignore startup notices; never echo raw event content into the report.
  }
}
