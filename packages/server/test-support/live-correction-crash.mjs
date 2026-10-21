// NEW administrative correction crash fixture. No historical test runner.
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "../dist/transaction-store.js";
import { prepareTransactionSingleton } from "../dist/transaction-batch.js";
const [file, subject, revision, stage] = process.argv.slice(2);
if (
  !file ||
  !subject ||
  !revision ||
  !["before-erasure-commit", "after-erasure-commit"].includes(stage)
)
  throw new Error("exact correction crash arguments required");
const scope = "https://live-correction.test/s/";
const owner = openTransactionStore({
  file,
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
      process.stdout.write(JSON.stringify({ stage: actual, abruptExit: 79 }) + "\n");
      process.exit(79); // Deliberately no close/rollback.
    }
  },
});
owner.correctLiveBeadVersion(
  subject,
  revision,
  prepareTransactionSingleton(
    scope,
    "updateBead",
    JSON.stringify({
      bead: subject,
      propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
    }),
  ),
);
owner.close();
process.exitCode = 82;
