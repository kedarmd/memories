import { readFile } from "node:fs/promises";

const [jsonlPath] = process.argv.slice(2);
if (!jsonlPath) throw new Error("usage: node probes/assert-f3-save-before-handoff.mjs <codex-events.jsonl>");

const events = (await readFile(jsonlPath, "utf8"))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const completedTurn = events.findIndex((event) => event.type === "turn.completed");
if (completedTurn < 0) throw new Error("Codex turn completion event is missing");
const saveReceipt = events.findIndex((event) => {
  if (event.type !== "item.completed" || event.item?.type !== "command_execution") return false;
  const command = event.item.command ?? "";
  const output = event.item.aggregated_output ?? "";
  if (!command.includes("continuation-store.ts") || !/\bsave\b/u.test(command)) return false;
  return /"state"\s*:\s*"saved"/u.test(output) && event.item.exit_code === 0;
});
if (saveReceipt < 0) throw new Error("No successful checkpoint save receipt was found in Codex tool events");
if (saveReceipt >= completedTurn) throw new Error("Checkpoint save receipt did not precede Codex turn completion");

const match = events[saveReceipt].item.aggregated_output.match(/\{[^\r\n]*"state"\s*:\s*"saved"[^\r\n]*\}/u);
const receipt = match ? JSON.parse(match[0]) : undefined;
console.log(JSON.stringify({
  codexThreadPresent: events.some((event) => event.type === "thread.started"),
  saveReceiptEventIndex: saveReceipt,
  turnCompletedEventIndex: completedTurn,
  savedBeforeHandoff: true,
  receiptId: receipt?.id,
  state: receipt?.state,
}));
