/** NEW bounded regressions for concrete erasure review findings, not a corruption matrix. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { prepareTransaction } from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import { planHistoricalErasure, transactionErasureSchema } from "./transaction-erasure.js";
import { projectTransactionChangeGroup } from "./transaction-changefeed.js";
import { projectTransactionEventGroup } from "./transaction-events.js";
const scope = "https://erasure-review.example/s/",
  type = scope + "types/task";
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-erasure-review-")),
    file = path.join(directory, "store.sqlite");
  const options = {
    file,
    scope,
    types: [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })],
  };
  let owner = openTransactionStore({ ...options, create: true }),
    closed = false,
    number = 0;
  return {
    get owner() {
      return owner;
    },
    execute(operations: unknown[]) {
      const request = prepareTransaction(scope, JSON.stringify({ operations })),
        admission = owner.admit("p", `k${number++}`, request);
      if (admission.kind !== "owned") throw Error("fresh owner required");
      const receipt = owner.execute(admission.claim);
      expect(receipt.status).toBe("completed");
      return receipt;
    },
    inspect<T>(run: (db: DatabaseSync) => T): T {
      owner.close();
      closed = true;
      const db = new DatabaseSync(file);
      try {
        return run(db);
      } finally {
        try {
          db.close();
        } finally {
          owner = openTransactionStore({ ...options, create: false });
          closed = false;
        }
      }
    },
    close() {
      try {
        if (!closed) owner.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { secret: `secret-${id}` },
  metadata: {},
});
const resource = (receipt: unknown) =>
  (
    (receipt as { results: unknown }).results as { resource: { id: string; revision: string } }[]
  )[0]!.resource;
it("NEW erasure leaves unrelated group bytes and contiguous framing untouched", () => {
  const f = fixture();
  try {
    const old = resource(f.execute([create("a")]));
    f.execute([
      {
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/secret", value: "healthy-successor" }],
      },
    ]);
    f.execute([create("b")]);
    const before = f.inspect((db) =>
      String(db.prepare("SELECT body FROM groups WHERE position=3").get()!.body),
    );
    f.owner.eraseHistoricalVersions([{ subject: old.id, revision: old.revision }]);
    const groups = f.inspect((db) =>
      db.prepare("SELECT position,body FROM groups ORDER BY position").all(),
    );
    expect(groups[2]!.body).toBe(before);
    const untouched = JSON.parse(String(groups[2]!.body));
    expect(untouched).not.toHaveProperty("erasurePruned");
    for (const row of groups.slice(0, 2)) {
      const g = JSON.parse(String(row.body));
      expect(g.erasurePruned).toBe(true);
      expect(g.originalEventCount).toBe(1);
      expect(g.events).toEqual([]);
    }
  } finally {
    f.close();
  }
});
it.each([1, "yes", null])(
  "NEW rejects nonboolean erasure marker %s in both projections and retained owner reader",
  (marker) => {
    const f = fixture();
    try {
      f.execute([create("a")]);
      const original = f.inspect((db) =>
        JSON.parse(String(db.prepare("SELECT body FROM groups WHERE position=1").get()!.body)),
      );
      const malformed = { ...original, erasurePruned: marker };
      const context = {
        scopeEpoch: original.scopeEpoch,
        authorizationView: original.authorizationView,
        scopePosition: "pos-1",
      };
      expect(() =>
        projectTransactionEventGroup(
          malformed,
          context,
          { kind: "scope", url: scope + "events/" },
          scope,
          1,
        ),
      ).toThrow();
      expect(() => projectTransactionChangeGroup(malformed, scope, context, 1)).toThrow();
      f.inspect((db) =>
        db.prepare("UPDATE groups SET body=? WHERE position=1").run(JSON.stringify(malformed)),
      );
      expect(() => f.owner.readEvents(scope + "events/")).toThrow(/erasure.*framing/i);
    } finally {
      f.close();
    }
  },
);
it("NEW rejects a foreign-scope cascade body before slicing or accepting its live guard", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      transactionErasureSchema +
        ";CREATE TABLE resources(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;",
    );
    const link = {
      id: scope + "links/x",
      type: scope + "types/relationship",
      revision: "link-r",
      source: scope + "beads/a",
      target: scope + "beads/b",
      properties: { secret: "x" },
      metadata: {},
    };
    const foreign = {
      id: "https://other.example/beads/a",
      type,
      revision: "source-r",
      properties: {},
      metadata: {},
      ownedLinks: { relationship: [link] },
    };
    const put = db.prepare("INSERT INTO retained_versions VALUES(?,?,?)");
    put.run(link.id, link.revision, JSON.stringify(link));
    put.run(foreign.id, foreign.revision, JSON.stringify(foreign));
    expect(() =>
      planHistoricalErasure(db, scope, [{ subject: link.id, revision: link.revision }]),
    ).toThrow(/canonical.*scope|scope.*canonical/i);
    expect(db.prepare("SELECT count(*) AS n FROM erasure_ledger").get()!.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM retained_versions").get()!.n).toBe(2);
  } finally {
    db.close();
  }
});
it("NEW completes missing erasure backfill once then skips repeat insert attempts on reopen", () => {
  const f = fixture();
  try {
    const old = resource(f.execute([create("a")]));
    f.execute([
      {
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/secret", value: "new" }],
      },
    ]);
    f.inspect((db) => {
      db.exec(
        "DELETE FROM retained_versions;DELETE FROM metadata WHERE name='erasureVersionBackfill';",
      );
    });
    f.inspect((db) => {
      expect(db.prepare("SELECT count(*) AS n FROM retained_versions").get()!.n).toBe(2);
      expect(
        db.prepare("SELECT value FROM metadata WHERE name='erasureVersionBackfill'").get()?.value,
      ).toBe("retained-postimages-1");
      db.exec(
        "CREATE TRIGGER refuse_repeated_backfill BEFORE INSERT ON retained_versions BEGIN SELECT RAISE(ABORT,'backfill repeated'); END;",
      );
    });
    expect(f.owner.readRetainedVersion(old.id, old.revision)).toMatchObject({ kind: "retained" });
  } finally {
    f.close();
  }
});
