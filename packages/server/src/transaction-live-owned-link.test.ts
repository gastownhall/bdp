import { spawnSync } from "node:child_process";
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

const scope = "https://live-owned-link.test/s/",
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
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-owned-link-")),
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
    correction(
      before: ResourceRecord,
      changes: unknown = {
        propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
        metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
      },
    ) {
      return request("updateLink", {
        link: before.id,
        expectedRevision: before.revision,
        ...(changes as object),
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

function digest(record: ResourceRecord) {
  return {
    subject: record.id,
    revision: record.revision,
    digest: {
      scheme: "sha-256-jcs",
      value: createHash("sha256").update(erasureCanonicalJson(record)).digest("hex"),
    },
  };
}
it.each(["properties", "metadata", "both"] as const)(
  "corrects owned Link %s with complete source replacement and safe nested delta",
  (field) => {
    const f = fixture(),
      created = f.seed(),
      before = created.resource,
      sourceBefore = f.resource("beads/a")!;
    const sibling = f.run("createLink", {
      id: "links/other",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: { healthy: true },
    }).resource;
    const sourcePrior = f.resource("beads/a")!,
      targetBefore = f.resource("beads/b");
    const result = f.owner.correctLiveLinkVersion(
      before.id,
      before.revision,
      f.correction(before, {
        ...(field === "metadata"
          ? {}
          : { propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
        ...(field === "properties"
          ? {}
          : { metadataChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
      }),
    );
    const after = f.current()!,
      source = f.resource("beads/a")!;
    expect(result.group.changes).toHaveLength(2);
    expect(result.group.changes.find((x) => x.resource.id === source.id)?.resource).toEqual(source);
    expect(source.revision).not.toBe(sourcePrior.revision);
    expect(source.properties).toEqual(sourcePrior.properties);
    expect(source.metadata).toEqual(sourcePrior.metadata);
    expect(("source" in source ? undefined : source.ownedLinks)?.[link]).toEqual([after, sibling]);
    expect(f.resource("beads/b")).toEqual(targetBefore);
    expect(result.group.erasures).toEqual(
      expect.arrayContaining([digest(before), digest(sourceBefore), digest(sourcePrior)]),
    );
    expect(result.group.erasures).toHaveLength(3);
    expect(result.group.events.map((x) => [x.subject, x.type])).toEqual([
      [before.id, "updated"],
      [source.id, "updated"],
    ]);
    const linkData = result.group.events[0]!.data;
    expect(linkData).toEqual({
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
    const sourceData = result.group.events[1]!.data;
    expect(sourceData).toEqual({
      previousRevision: sourcePrior.revision,
      revision: source.revision,
      ownedLink: {
        operation: "updated",
        link: { id: before.id, type: before.type, ...(linkData as object) },
      },
      ...(source.revisionProvenance ? { revisionProvenance: source.revisionProvenance } : {}),
    });
    expect(result).not.toHaveProperty("receipt");
    expect(f.owner.readRetainedVersion(sourcePrior.id, sourcePrior.revision).kind).toBe("erased");
    expect(f.owner.readReceipt("p", created.receipt.id).receipt?.results).toMatchObject([
      { outcome: "erased" },
    ]);
    f.reopen();
    expect(f.current()).toEqual(after);
    expect(f.resource("beads/a")).toEqual(source);
    const raw = f.raw();
    if (field !== "metadata") expect(raw).not.toContain("link-private");
    if (field !== "properties") expect(raw).not.toContain("link-metadata");
  },
);
it.each(["explicit", "wildcard"] as const)(
  "tombstones %s owned Link with new empty source set and last-version graph withholding",
  (mode) => {
    const f = fixture({
      types: [
        parseTypeDescriptor({
          id: bead,
          name: "Task",
          describes: "bead",
          conformsTo: [],
          ownsOutgoing: { [mode === "explicit" ? link : "*"]: { max: 4 } },
        }),
        types[1]!,
      ],
    });
    const before = f.seed().resource,
      sourceBefore = f.resource("beads/a")!,
      target = f.resource("beads/b");
    const events = f.owner.readEvents(scope + "events/");
    if (events.kind !== "page") throw Error("events");
    const cursor = events.page.events.find((x) => x.type === "linked")!.id;
    const result = f.owner.tombstoneLiveLinkVersion(before.id, before.revision),
      source = f.resource("beads/a")!;
    expect(f.current()).toBeNull();
    expect(source.revision).not.toBe(sourceBefore.revision);
    expect("source" in source ? undefined : source.ownedLinks).toEqual(
      mode === "explicit" ? { [link]: [] } : {},
    );
    expect(f.resource("beads/b")).toEqual(target);
    expect(result.group.erasures).toEqual([digest(before), digest(sourceBefore)]);
    expect(result.group.changes).toHaveLength(2);
    expect(result.group.events.map((x) => [x.subject, x.type])).toEqual([
      [before.id, "deleted"],
      [source.id, "updated"],
    ]);
    expect(result.group.events[1]!.data).toMatchObject({
      previousRevision: sourceBefore.revision,
      revision: source.revision,
      ownedLink: {
        operation: "deleted",
        link: { id: before.id, type: before.type, revision: before.revision },
      },
    });
    expect(result.group.events[1]!.data).not.toHaveProperty("change");
    const page = f.owner.readEvents(scope + "events/", cursor);
    if (page.kind !== "page") throw Error("cursor");
    expect(page.page.events.map((x) => x.type)).toEqual(["deleted", "updated"]);
    f.reopen();
    expect(f.current()).toBeNull();
    expect(f.resource("beads/a")).toEqual(source);
    expect(f.raw()).not.toContain("link-private");
  },
);
it("keeps graph facts while another historical owned Link version survives", () => {
  const f = fixture(),
    old = f.seed().resource;
  const newer = f.run("updateLink", {
    link: old.id,
    propertiesChange: [{ op: "replace", path: "", value: { later: true } }],
  }).resource;
  const result = f.owner.tombstoneLiveLinkVersion(newer.id, newer.revision);
  expect(result.group.events.map((x) => x.type)).toEqual([
    "deleted",
    "unlinked",
    "unlinked",
    "updated",
  ]);
  expect(f.owner.readRetainedVersion(old.id, old.revision).kind).toBe("retained");
});
it.each(["unchanged", "stale", "endpoint", "partial"] as const)(
  "rejects owned %s correction atomically",
  (kind) => {
    const f = fixture(),
      before = f.seed().resource,
      raw = f.raw();
    const input = {
      link: before.id,
      expectedRevision: kind === "stale" ? "stale" : before.revision,
      propertiesChange: [
        {
          op: "replace",
          path: kind === "partial" ? "/secret" : "",
          value: kind === "unchanged" ? before.properties : { corrected: true },
        },
      ],
      ...(kind === "endpoint" ? { target: "beads/a" } : {}),
    };
    expect(() =>
      f.owner.correctLiveLinkVersion(before.id, before.revision, f.request("updateLink", input)),
    ).toThrow();
    expect(f.raw()).toBe(raw);
    expect(f.owner.erasureLedger()).toEqual([]);
  },
);
it.each(["correction", "tombstone"] as const)(
  "rolls back the complete owned %s transition before commit",
  (kind) => {
    let armed = false;
    const f = fixture({
        fault: (stage) => {
          if (armed && stage === "before-erasure-commit") throw Error("owned injected rollback");
        },
      }),
      before = f.seed().resource,
      raw = f.raw();
    armed = true;
    expect(() =>
      kind === "correction"
        ? f.owner.correctLiveLinkVersion(before.id, before.revision, f.correction(before))
        : f.owner.tombstoneLiveLinkVersion(before.id, before.revision),
    ).toThrow("owned injected rollback");
    armed = false;
    expect(f.raw()).toBe(raw);
    expect(f.owner.erasureLedger()).toEqual([]);
  },
);
it.each(["correction", "tombstone"] as const)(
  "reopens owned %s across actual before/after commit SIGKILL",
  (kind) => {
    for (const stage of ["before-erasure-commit", "after-erasure-commit"] as const) {
      const f = fixture(),
        before = f.seed().resource,
        source = f.resource("beads/a");
      f.close();
      const child = spawnSync(
        process.execPath,
        [
          "packages/server/test-support/live-owned-link-crash.mjs",
          f.file,
          before.id,
          before.revision,
          kind,
          stage,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      console.log(
        "OWNED_LINK_CRASH " +
          JSON.stringify({
            kind,
            stage,
            status: child.status,
            signal: child.signal,
            error: child.error?.message,
            stdout: child.stdout,
            stderr: child.stderr,
          }),
      );
      expect(child.error).toBeUndefined();
      expect(child.signal).toBe("SIGKILL");
      expect(JSON.parse(child.stdout)).toEqual({ kind, stage });
      f.reopen();
      if (stage === "before-erasure-commit") {
        expect(f.current()).toEqual(before);
        expect(f.resource("beads/a")).toEqual(source);
        expect(f.owner.erasureLedger()).toEqual([]);
      } else {
        expect(f.owner.erasureLedger()).toHaveLength(2);
        expect(f.resource("beads/a")!.revision).not.toBe(source!.revision);
        expect(
          kind === "tombstone" ? f.current() === null : f.current()!.revision !== before.revision,
        ).toBe(true);
        expect(f.raw()).not.toContain("link-private");
      }
    }
  },
);

it("corrects wildcard ownership with a pinned external target then tombstones without inventing an external graph fact", () => {
  const external = "https://elsewhere.test/beads/target";
  const f = fixture({
    types: [
      parseTypeDescriptor({
        id: bead,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { "*": { max: 4 } },
      }),
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "bead" },
      }),
    ],
  });
  f.run("createBead", { id: "beads/a", type: bead, properties: { safe: true } });
  const before = f.run("createLink", {
    id: "links/l",
    type: link,
    source: "beads/a",
    target: { uri: external, revision: "external-pin" },
    properties: { secret: "external-owned" },
  }).resource;
  const corrected = f.owner.correctLiveLinkVersion(
    before.id,
    before.revision,
    f.correction(before),
  );
  const after = f.current()!;
  expect("source" in after && after.target).toEqual({ uri: external, revision: "external-pin" });
  expect(corrected.group.changes).toHaveLength(2);
  const deleted = f.owner.tombstoneLiveLinkVersion(after.id, after.revision);
  expect(deleted.group.events.map((event) => [event.type, event.ordinal])).toEqual([
    ["deleted", 0],
    ["updated", 2],
  ]);
  expect(() => f.owner.readChanges("genesis")).toThrow("cursor-expired");
  f.reopen();
  expect(f.current()).toBeNull();
  expect(f.raw()).not.toContain("external-owned");
});

it.each(["correction", "tombstone"] as const)(
  "fences uncertain owned %s after commit and reopens complete source and ledger",
  (kind) => {
    let armed = false;
    const f = fixture({
        fault(stage) {
          if (armed && stage === "after-erasure-commit")
            throw Error("owned postcommit uncertainty");
        },
      }),
      before = f.seed().resource,
      sourceBefore = f.resource("beads/a")!;
    armed = true;
    expect(() =>
      kind === "correction"
        ? f.owner.correctLiveLinkVersion(before.id, before.revision, f.correction(before))
        : f.owner.tombstoneLiveLinkVersion(before.id, before.revision),
    ).toThrow();
    expect(() => f.current()).toThrow();
    f.reopen();
    expect(f.owner.erasureLedger()).toHaveLength(2);
    expect(f.resource("beads/a")!.revision).not.toBe(sourceBefore.revision);
    expect(
      kind === "tombstone" ? f.current() === null : f.current()!.revision !== before.revision,
    ).toBe(true);
    expect(f.raw()).not.toContain("link-private");
  },
);

it("refuses an invalid owned-Link replacement through the actual installed property schema without partial source writes", () => {
  const schema = `${scope}schemas/link`;
  const artifact = (retrievalUri: string, value: unknown) => ({
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
      }),
      artifact(link, {
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
        propertiesSchema: schema,
      }),
    ],
    schemas: [
      artifact(schema, {
        $id: schema,
        type: "object",
        required: ["secret"],
        properties: { secret: { type: "string" } },
      }),
    ],
    limits: { ...CONTRACT_ARTIFACT_CEILINGS },
  });
  const f = fixture({ types: contracts.descriptors, contracts }),
    old = f.seed().resource,
    before = f.raw();
  let caught: unknown;
  try {
    f.owner.correctLiveLinkVersion(
      old.id,
      old.revision,
      f.correction(old, { propertiesChange: [{ op: "replace", path: "", value: { secret: 7 } }] }),
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    message: "live correction validation refused",
    cause: { code: "validation-failed", operationIndex: 0 },
  });
  expect(f.raw()).toBe(before);
});
