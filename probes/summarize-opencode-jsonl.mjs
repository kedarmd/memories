import { createInterface } from "node:readline";

export function evidenceContainsPath(evidence, expectedPath) {
  if (typeof evidence === "string") return evidence.includes(expectedPath);
  if (!Array.isArray(evidence)) return false;
  return evidence.some((entry) => {
    if (typeof entry === "string") return entry.includes(expectedPath);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    return [entry.ref, entry.path].some(
      (reference) => typeof reference === "string" && reference.includes(expectedPath),
    );
  });
}

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
          summary.sourcePathPresent = evidenceContainsPath(parsed.evidence, "src/counter.ts");
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
