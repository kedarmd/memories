import { readFile } from "node:fs/promises";
import { ContinuationStore } from "../src/continuation.ts";

const [command, databasePath, ...args] = process.argv.slice(2);
if (!command || !databasePath) throw new Error("usage: continuation-store.ts <register|save|load> <db> [args]");
const store = new ContinuationStore(databasePath);
try {
  if (command === "register" && args.length === 3) {
    store.registerTask(args[0]!, args[1]!, args[2]!);
    console.log(JSON.stringify({ state: "registered", projectId: args[0], taskId: args[1] }));
  } else if (command === "save" && args.length === 1) {
    console.log(JSON.stringify(store.save(JSON.parse(await readFile(args[0]!, "utf8")))));
  } else if (command === "load" && args.length === 2) {
    const packet = store.load(args[0]!, args[1]!);
    if (!packet) {
      console.log(JSON.stringify({ state: "not-found", projectId: args[0], taskId: args[1] }));
      process.exitCode = 2;
    } else console.log(JSON.stringify({ state: "loaded", ...packet }));
  } else throw new Error("invalid command arguments");
} finally {
  store.close();
}
