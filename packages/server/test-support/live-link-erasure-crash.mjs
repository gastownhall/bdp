// NEW source-owned abrupt Link administration fixture; actual compiled store.
import { writeSync } from "node:fs";
import { parseTypeDescriptor } from "@bdp/protocol";
import { prepareTransactionSingleton } from "../dist/transaction-batch.js";
import { openTransactionStore } from "../dist/transaction-store.js";

const [file, subject, revision, kind, stage] = process.argv.slice(2);
if (
  !file ||
  !subject ||
  !revision ||
  !["correction", "tombstone"].includes(kind) ||
  !["before-erasure-commit", "after-erasure-commit"].includes(stage)
)
  throw Error("exact Link crash arguments required");
const scope = "https://live-link.test/s/";
const types = [
  parseTypeDescriptor({
    id: scope + "types/task",
    name: "Task",
    describes: "bead",
    conformsTo: [],
  }),
  parseTypeDescriptor({
    id: scope + "types/link",
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  }),
];
const owner = openTransactionStore({
  file,
  scope,
  types,
  create: false,
  clock: () => 1000,
  fault(actual) {
    if (actual === stage) {
      writeSync(1, JSON.stringify({ kind, stage }) + "\n");
      process.kill(process.pid, "SIGKILL");
    }
  },
});
if (kind === "correction")
  owner.correctLiveLinkVersion(
    subject,
    revision,
    prepareTransactionSingleton(
      scope,
      "updateLink",
      JSON.stringify({
        link: subject,
        expectedRevision: revision,
        propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
        metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
      }),
    ),
  );
else owner.tombstoneLiveLinkVersion(subject, revision);
throw Error("crash hook did not execute");
