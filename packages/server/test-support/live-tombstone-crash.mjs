// NEW tombstone-only abrupt-exit fixture.
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "../dist/transaction-store.js";
const [file, subject, revision, stage] = process.argv.slice(2);
if (
  !file ||
  !subject ||
  !revision ||
  !["before-erasure-commit", "after-erasure-commit"].includes(stage)
)
  throw new Error("exact tombstone crash arguments required");
const scope = "https://live-tombstone.test/s/";
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
    parseTypeDescriptor({
      id: `${scope}types/link`,
      name: "Link",
      describes: "link",
      conformsTo: [],
      source: { conformsTo: [], external: "none" },
      target: { conformsTo: [], external: "opaque" },
    }),
  ],
  fault(actual) {
    if (actual === stage) {
      process.stdout.write(JSON.stringify({ stage: actual, abruptExit: 79 }) + "\n");
      process.exit(79);
    }
  },
});
owner.tombstoneLiveBeadVersion(subject, revision);
owner.close();
process.exitCode = 82;
