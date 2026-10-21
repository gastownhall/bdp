// NEW erasure-only crash fixture; no old transaction/stage runner is invoked.
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "../dist/transaction-store.js";
const [file, subject, revision, stage] = process.argv.slice(2);
if (
  !file ||
  !subject ||
  !revision ||
  !["before-erasure-commit", "after-erasure-commit"].includes(stage)
)
  throw new Error("exact erasure crash arguments required");
const scope = "https://erasure.test/s/";
const owner = openTransactionStore({
  file,
  scope,
  create: false,
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
      process.stdout.write(JSON.stringify({ stage: actual, abruptExit: 79 }) + "\n");
      process.exit(79); // Deliberately no DB close/rollback cleanup.
    }
  },
});
owner.eraseHistoricalVersions([{ subject, revision }]);
owner.close();
process.exitCode = 82; // The selected fault must have terminated first.
