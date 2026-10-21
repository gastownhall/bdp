import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "../dist/transaction-store.js";
const [file, nativeRestore, stage] = process.argv.slice(2);
if (!file || !nativeRestore || !["before-restore-commit", "after-restore-commit"].includes(stage))
  throw new Error("exact native restore crash inputs required");
const scope = "https://restore.test/s/";
const owner = openTransactionStore({
  file,
  nativeRestore,
  scope,
  create: false,
  clock: () => 1000,
  types: [
    parseTypeDescriptor({
      id: `${scope}types/task`,
      name: "Task",
      describes: "bead",
      conformsTo: [],
    }),
  ],
  fault(actual) {
    if (actual === stage) {
      process.stdout.write(JSON.stringify({ actual, exit: 79 }) + "\n");
      process.exit(79);
    }
  },
});
owner.close();
process.exitCode = 82;
