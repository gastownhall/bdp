import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { compileDevelopmentContracts } from "./development-contracts.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { type ResourceRecord, readStoredResource } from "./resource-evaluator.js";
import { prepareTransactionSingleton } from "./transaction-batch.js";
import { erasureCanonicalJson } from "./transaction-erasure.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://live-owned-bead.test/s/",
  bead = `${scope}types/task`,
  link = `${scope}types/link`;
const types = [
  parseTypeDescriptor({
    id: bead,
    name: "Task",
    describes: "bead",
    conformsTo: [],
    ownsOutgoing: { [link]: { max: 4 } },
  }),
  parseTypeDescriptor({
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  }),
];
const clean: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const fn of clean.splice(0).reverse()) {
    try {
      fn();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Link fixture finalization failed");
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-owned-bead-")),
    file = path.join(directory, "owner.sqlite");
  const options = { file, scope, types, create: true, clock: () => 1000, ...extra };
  let owner: ReturnType<typeof openTransactionStore>;
  try {
    owner = openTransactionStore(options);
  } catch (error) {
    const errors: unknown[] = [error];
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (cleanup) {
      errors.push(cleanup);
    }
    throw new AggregateError(errors, "Link fixture startup failed");
  }
  let n = 0;
  clean.push(() => {
    const errors: unknown[] = [];
    try {
      owner.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "Link fixture close/removal failed");
  });
  const request = (operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) =>
    prepareTransactionSingleton(scope, operation, JSON.stringify(input));
  function run(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
    const prepared = request(operation, input),
      key = `key-${n++}`,
      admission = owner.admit("p", key, prepared);
    if (admission.kind !== "owned") throw Error("new owner required");
    const receipt = owner.execute(admission.claim);
    expect(receipt.status).toBe("completed");
    return {
      receipt,
      prepared,
      key,
      resource: (receipt.results as { resource: ResourceRecord }[])[0]!.resource,
    };
  }
  return {
    file,
    options,
    request,
    run,
    get owner() {
      return owner;
    },
    seed() {
      run("createBead", { id: "beads/a", type: bead, properties: { safe: true } });
      run("createBead", { id: "beads/b", type: bead, properties: { safe: true } });
      return run("createLink", {
        id: "links/l",
        type: link,
        source: "beads/a",
        target: "beads/b",
        properties: { secret: "link-private" },
        metadata: { secret: "link-metadata" },
      });
    },
    resource(id: string) {
      const r = owner.withRead((reader) => {
        const row = reader.resource(id);
        return row ? readStoredResource(row, scope) : null;
      });
      if (r.kind !== "read") throw Error("read required");
      return r.value;
    },
    current() {
      const r = owner.withRead((reader) => {
        const row = reader.resource("links/l");
        return row ? readStoredResource(row, scope) : null;
      });
      if (r.kind !== "read") throw Error("read required");
      return r.value;
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    raw() {
      owner.close();
      const db = new DatabaseSync(file);
      try {
        return JSON.stringify(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((row) => ({
              table: row.name,
              rows: db.prepare(`SELECT * FROM "${row.name}"`).all(),
            })),
        );
      } finally {
        db.close();
        owner = openTransactionStore({ ...options, create: false });
      }
    },
    close() {
      owner.close();
    },
  };
}

function seedOwned(f: ReturnType<typeof fixture>) {
  const first = f.seed().resource,
    target = f.resource("beads/b")!;
  const second = f.run("createLink", {
    id: "links/other",
    type: link,
    source: "beads/a",
    target: { uri: target.id, revision: target.revision },
    properties: { healthy: "pinned" },
  }).resource;
  if (!("source" in first) || !("source" in second) || "source" in target)
    throw Error("typed seed");
  const marked = f.run("updateBead", {
    bead: "beads/a",
    propertiesChange: [{ op: "replace", path: "", value: { secret: "owned-bead-old-properties" } }],
    metadataChange: [{ op: "replace", path: "", value: { secret: "owned-bead-old-metadata" } }],
  });
  const before = marked.resource;
  if ("source" in before) throw Error("owning Bead required");
  return { before, links: [first, second], target, marked };
}
function correction(
  f: ReturnType<typeof fixture>,
  before: ResourceRecord,
  field: "properties" | "metadata" | "both" = "both",
) {
  return f.request("updateBead", {
    bead: before.id,
    expectedRevision: before.revision,
    ...(field === "metadata"
      ? {}
      : { propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
    ...(field === "properties"
      ? {}
      : { metadataChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
  });
}
it.each(["properties", "metadata", "both"] as const)(
  "directly corrects owning Bead %s without reverse-erasing its unchanged Link versions",
  (field) => {
    const f = fixture(),
      { before, links, target, marked } = seedOwned(f),
      snapshot = f.owner.captureSnapshot().manifest;
    const events = f.owner.readEvents(scope + "events/");
    if (events.kind !== "page") throw Error("events");
    const cursor = events.page.events.find(
      (event) =>
        event.subject === before.id &&
        (event.data as { revision?: string }).revision === before.revision,
    )!.id;
    const result = f.owner.correctLiveBeadVersion(
        before.id,
        before.revision,
        correction(f, before, field),
      ),
      after = f.resource("beads/a")!;
    expect(after.revision).not.toBe(before.revision);
    expect(after.properties).toEqual(
      field === "metadata" ? before.properties : { corrected: true },
    );
    expect(after.metadata).toEqual(field === "properties" ? before.metadata : { corrected: true });
    expect("source" in after ? undefined : after.ownedLinks).toEqual(before.ownedLinks);
    expect(result.group.changes).toEqual([
      { operation: "upsert", resourceKind: "bead", resource: after },
    ]);
    expect(result.group.events).toHaveLength(1);
    expect(result.group.events[0]!.data).toEqual({
      previousRevision: before.revision,
      revision: after.revision,
      ...(field === "metadata"
        ? {}
        : { change: [{ op: "replace", path: "", value: after.properties }] }),
      ...(field === "properties"
        ? {}
        : { metadataChange: [{ op: "replace", path: "", value: after.metadata }] }),
      ...(after.revisionProvenance ? { revisionProvenance: after.revisionProvenance } : {}),
    });
    expect(result.group.events[0]!.data).not.toHaveProperty("ownedLink");
    expect(result.group.erasures).toEqual([
      {
        subject: before.id,
        revision: before.revision,
        digest: {
          scheme: "sha-256-jcs",
          value: createHash("sha256").update(erasureCanonicalJson(before)).digest("hex"),
        },
      },
    ]);
    for (const original of links) {
      expect(f.resource(original.id.slice(scope.length))).toEqual(original);
      expect(f.owner.readRetainedVersion(original.id, original.revision).kind).toBe("retained");
    }
    expect(f.resource("beads/b")).toEqual(target);
    expect(f.owner.readRetainedVersion(before.id, before.revision).kind).toBe("erased");
    expect(f.owner.readReceipt("p", marked.receipt.id).receipt?.results).toMatchObject([
      { outcome: "erased" },
    ]);
    expect(f.owner.admit("p", marked.key, marked.prepared).kind).toBe("existing");
    expect(() => f.owner.readSnapshot(snapshot.id)).toThrow();
    const afterEvents = f.owner.readEvents(scope + "events/", cursor);
    if (afterEvents.kind !== "page") throw Error("exclusive cursor");
    expect(afterEvents.page.events.map((event) => event.type)).toEqual(["updated"]);
    f.reopen();
    expect(f.resource("beads/a")).toEqual(after);
    for (const original of links)
      expect(f.resource(original.id.slice(scope.length))).toEqual(original);
    const raw = f.raw();
    if (field !== "metadata") expect(raw).not.toContain("owned-bead-old-properties");
    if (field !== "properties") expect(raw).not.toContain("owned-bead-old-metadata");
    expect(raw).toContain("link-private");
  },
);
it("preserves the wildcard owner's complete inline set and pins on direct correction", () => {
  const f = fixture({
    types: [
      parseTypeDescriptor({
        id: bead,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { "*": { max: 4 } },
      }),
      types[1]!,
    ],
  });
  const { before, links } = seedOwned(f);
  const result = f.owner.correctLiveBeadVersion(before.id, before.revision, correction(f, before));
  const after = f.resource("beads/a")!;
  expect("source" in after ? undefined : after.ownedLinks).toEqual({ [link]: links });
  expect(result.group.erasures).toHaveLength(1);
  for (const original of links)
    expect(f.resource(original.id.slice(scope.length))).toEqual(original);
});
it.each(["unchanged", "stale", "partial", "supplied-owned-set", "incident-tombstone"] as const)(
  "refuses owning Bead %s without durable changes",
  (kind) => {
    const f = fixture(),
      { before } = seedOwned(f),
      raw = f.raw();
    expect(() => {
      if (kind === "incident-tombstone")
        return f.owner.tombstoneLiveBeadVersion(before.id, before.revision);
      const request = f.request("updateBead", {
        bead: before.id,
        expectedRevision: kind === "stale" ? "stale" : before.revision,
        propertiesChange: [
          {
            op: "replace",
            path: kind === "partial" ? "/secret" : "",
            value: kind === "unchanged" ? before.properties : { corrected: true },
          },
        ],
        ...(kind === "supplied-owned-set" ? { ownedLinks: {} } : {}),
      });
      return f.owner.correctLiveBeadVersion(before.id, before.revision, request);
    }).toThrow();
    expect(f.raw()).toBe(raw);
    expect(f.owner.erasureLedger()).toEqual([]);
  },
);
it("rolls back the entire direct owned-Bead correction before commit", () => {
  let armed = false;
  const f = fixture({
      fault(stage) {
        if (armed && stage === "before-erasure-commit") throw Error("owning Bead rollback");
      },
    }),
    { before, links } = seedOwned(f),
    raw = f.raw();
  armed = true;
  expect(() =>
    f.owner.correctLiveBeadVersion(before.id, before.revision, correction(f, before)),
  ).toThrow("owning Bead rollback");
  armed = false;
  expect(f.raw()).toBe(raw);
  for (const original of links)
    expect(f.resource(original.id.slice(scope.length))).toEqual(original);
});
it("fences an uncertain postcommit direct owned-Bead correction and reopens one whole result", () => {
  let armed = false;
  const f = fixture({
      fault(stage) {
        if (armed && stage === "after-erasure-commit") throw Error("owning Bead uncertain");
      },
    }),
    { before, links } = seedOwned(f);
  armed = true;
  expect(() =>
    f.owner.correctLiveBeadVersion(before.id, before.revision, correction(f, before)),
  ).toThrow();
  expect(() => f.resource("beads/a")).toThrow();
  f.reopen();
  expect(f.owner.erasureLedger()).toHaveLength(1);
  expect(f.resource("beads/a")!.properties).toEqual({ corrected: true });
  for (const original of links)
    expect(f.resource(original.id.slice(scope.length))).toEqual(original);
});
it("uses the installed Bead property validator before committing owned correction", () => {
  const schema = scope + "schemas/task",
    artifact = (retrievalUri: string, value: unknown) => ({
      retrievalUri,
      utf8Bytes: Buffer.from(JSON.stringify(value)),
    });
  const contracts = compileDevelopmentContracts({
    descriptors: [
      artifact(bead, {
        id: bead,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [link]: { max: 4 } },
        propertiesSchema: schema,
      }),
      artifact(link, types[1]),
    ],
    schemas: [
      artifact(schema, { $id: schema, type: "object", properties: { secret: { type: "string" } } }),
    ],
    limits: { ...CONTRACT_ARTIFACT_CEILINGS },
  });
  const f = fixture({ types: contracts.descriptors, contracts }),
    { before } = seedOwned(f),
    raw = f.raw();
  expect(() =>
    f.owner.correctLiveBeadVersion(
      before.id,
      before.revision,
      f.request("updateBead", {
        bead: before.id,
        propertiesChange: [{ op: "replace", path: "", value: { secret: 7 } }],
      }),
    ),
  ).toThrow("live correction validation refused");
  expect(f.raw()).toBe(raw);
});
