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

const scope = "https://live-link.test/s/",
  bead = `${scope}types/task`,
  link = `${scope}types/link`;
const types = [
  parseTypeDescriptor({ id: bead, name: "Task", describes: "bead", conformsTo: [] }),
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
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-link-")),
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

it.each(["properties", "metadata", "both"] as const)(
  "corrects unowned Link %s preserving endpoints, digest, identity and erased replay",
  (field) => {
    const f = fixture(),
      created = f.seed(),
      old = created.resource;
    const epoch = f.owner.captureSnapshot().manifest.scopeEpoch;
    const result = f.owner.correctLiveLinkVersion(
      old.id,
      old.revision,
      f.correction(old, {
        ...(field === "metadata"
          ? {}
          : { propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
        ...(field === "properties"
          ? {}
          : { metadataChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
      }),
    );
    expect(result.group.changes).toHaveLength(1);
    const next = result.group.changes[0]!.resource;
    expect(next).toMatchObject({
      id: old.id,
      type: old.type,
      ...("source" in old ? { source: old.source, target: old.target } : {}),
    });
    expect(next.revision).not.toBe(old.revision);
    expect(result.group.erasures).toEqual([
      {
        subject: old.id,
        revision: old.revision,
        digest: {
          scheme: "sha-256-jcs",
          value: createHash("sha256").update(erasureCanonicalJson(old)).digest("hex"),
        },
      },
    ]);
    expect(result.group.events).toHaveLength(1);
    expect(result.group.events[0]).toMatchObject({
      type: "updated",
      subject: old.id,
      data: {
        previousRevision: old.revision,
        revision: next.revision,
        ...(field === "metadata"
          ? {}
          : { change: [{ op: "replace", path: "", value: { corrected: true } }] }),
        ...(field === "properties"
          ? {}
          : { metadataChange: [{ op: "replace", path: "", value: { corrected: true } }] }),
      },
    });
    expect(result).not.toHaveProperty("receipt");
    expect(result.context.scopeEpoch).toBe(epoch);
    expect(f.owner.inspect().groups).toHaveLength(4);
    expect(f.owner.readReceipt("p", created.receipt.id).receipt?.results).toEqual([
      {
        operationIndex: 0,
        outcome: "erased",
        erased: { id: old.id, type: old.type, revision: old.revision },
      },
    ]);
    expect(f.owner.admit("p", created.key, created.prepared).kind).toBe("existing");
    expect(f.owner.readRetainedVersion(old.id, old.revision).kind).toBe("erased");
    f.reopen();
    expect(f.current()).toEqual(next);
    expect(f.owner.erasureLedger()).toEqual(result.group.erasures);
    const raw = f.raw();
    if (field !== "metadata") expect(raw).not.toContain("link-private");
    if (field !== "properties") expect(raw).not.toContain("link-metadata");
  },
);

it.each([
  "wrong-revision",
  "missing-expected",
  "partial",
  "wrong-target",
  "alias",
  "wrong-operation",
  "unchanged",
  "endpoint",
  "pin",
] as const)("refuses unsupported Link correction %s before writes", (kind) => {
  const f = fixture(),
    old = f.seed().resource;
  const state = f.raw();
  const input = {
    link: kind === "alias" ? "alias/l" : kind === "wrong-target" ? "links/no" : old.id,
    ...(kind === "missing-expected" ? {} : { expectedRevision: old.revision }),
    propertiesChange: [
      {
        op: "replace",
        path: kind === "partial" ? "/secret" : "",
        value: kind === "unchanged" ? old.properties : { corrected: true },
      },
    ],
    ...(kind === "endpoint" ? { source: "beads/b" } : {}),
    ...(kind === "pin" ? { targetRevision: "forbidden" } : {}),
  };
  expect(() =>
    f.owner.correctLiveLinkVersion(
      old.id,
      kind === "wrong-revision" ? "stale" : old.revision,
      f.request(kind === "wrong-operation" ? "deleteLink" : "updateLink", input),
    ),
  ).toThrow();
  expect(f.raw()).toBe(state);
  expect(f.owner.erasureLedger()).toEqual([]);
});
it("preserves Bead API separation for owned Links", () => {
  const f = fixture({
    types: [
      parseTypeDescriptor({
        id: bead,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [link]: { max: 4 } },
      }),
      types[1]!,
    ],
  });
  const old = f.seed().resource;
  const before = f.raw();
  expect(() => f.owner.correctLiveBeadVersion(old.id, old.revision, f.correction(old))).toThrow();
  expect(() => f.owner.tombstoneLiveBeadVersion(old.id, old.revision)).toThrow();
  expect(f.raw()).toBe(before);
});
it("tombstones last Link version, withholding graph facts while preserving exclusive Event cursors and healthy endpoints", () => {
  const f = fixture(),
    created = f.seed(),
    old = created.resource;
  const before = f.owner.readEvents(`${scope}events/`);
  if (before.kind !== "page") throw Error("events required");
  const cursor = before.page.events.find((event) => event.type === "linked")!.id;
  const result = f.owner.tombstoneLiveLinkVersion(old.id, old.revision);
  expect(result.group.changes).toEqual([
    {
      operation: "tombstone",
      resourceKind: "link",
      resource: { id: old.id, type: old.type, revision: old.revision },
    },
  ]);
  expect(result.group.events).toHaveLength(1);
  expect(result.group.events[0]).toMatchObject({
    type: "deleted",
    data: { revision: old.revision },
  });
  expect(result.group.events[0]!.data).toEqual({ revision: old.revision });
  expect(f.current()).toBeNull();
  const after = f.owner.readEvents(`${scope}events/`, cursor);
  if (after.kind !== "page") throw Error("exclusive cursor required");
  expect(after.page.events.map((event) => event.type)).toEqual(["deleted"]);
  const endpoint = f.owner.readEvents(`${scope}beads/a?view=events`);
  if (endpoint.kind !== "page") throw Error("endpoint required");
  expect(endpoint.page.events.map((event) => event.type)).toEqual(["created"]);
  f.reopen();
  expect(f.current()).toBeNull();
  expect(f.owner.erasureLedger()).toEqual(result.group.erasures);
  expect(f.raw()).not.toContain("link-private");
});
it("retains ordinary unlinked facts while a historical endpoint-bearing version remains, then withholds them when that last version is erased", () => {
  const f = fixture(),
    old = f.seed().resource;
  const next = f.run("updateLink", {
    link: old.id,
    expectedRevision: old.revision,
    propertiesChange: [{ op: "replace", path: "", value: { later: true } }],
  }).resource;
  const result = f.owner.tombstoneLiveLinkVersion(next.id, next.revision);
  expect(result.group.events.map((event) => event.type)).toEqual([
    "deleted",
    "unlinked",
    "unlinked",
  ]);
  expect(f.owner.readRetainedVersion(old.id, old.revision).kind).toBe("retained");
  f.owner.eraseHistoricalVersions([{ subject: old.id, revision: old.revision }]);
  const events = f.owner.readEvents(`${scope}events/`);
  if (events.kind !== "page") throw Error("events required");
  expect(events.page.events.map((event) => event.type)).toEqual(["created", "created", "deleted"]);
});
it.each(["correction", "tombstone"] as const)(
  "rolls back complete %s on before-commit fault",
  (kind) => {
    let armed = false;
    const f = fixture({
        fault(stage) {
          if (armed && stage === "before-erasure-commit") throw Error("new Link rollback");
        },
      }),
      old = f.seed().resource;
    const before = f.raw();
    armed = true;
    expect(() =>
      kind === "correction"
        ? f.owner.correctLiveLinkVersion(old.id, old.revision, f.correction(old))
        : f.owner.tombstoneLiveLinkVersion(old.id, old.revision),
    ).toThrow("new Link rollback");
    expect(f.raw()).toBe(before);
    expect(f.current()).toEqual(old);
  },
);
it.each(["correction", "tombstone"] as const)(
  "abrupt %s before/after atomic commit reopens without partial ledger or state",
  (kind) => {
    for (const stage of ["before-erasure-commit", "after-erasure-commit"] as const) {
      const f = fixture(),
        old = f.seed().resource;
      f.close();
      const subject = new URL("../test-support/live-link-erasure-crash.mjs", import.meta.url)
        .pathname;
      const child = spawnSync(
        process.execPath,
        [subject, f.file, old.id, old.revision, kind, stage],
        { encoding: "utf8", timeout: 10000, maxBuffer: 65536 },
      );
      console.log(
        "LIVE_LINK_CRASH_EVIDENCE " +
          JSON.stringify({
            kind,
            stage,
            status: child.status,
            signal: child.signal,
            error: child.error?.message ?? null,
            stdout: child.stdout,
            stderr: child.stderr,
          }),
      );
      expect(child.error).toBeUndefined();
      expect(child.signal).toBe("SIGKILL");
      expect(JSON.parse(child.stdout).stage).toBe(stage);
      f.reopen();
      if (stage === "before-erasure-commit") {
        expect(f.current()).toEqual(old);
        expect(f.owner.erasureLedger()).toEqual([]);
      } else {
        expect(f.owner.erasureLedger()).toHaveLength(1);
        if (kind === "tombstone") expect(f.current()).toBeNull();
        else expect(f.current()?.properties).toEqual({ corrected: true });
        expect(f.raw()).not.toContain("link-private");
      }
    }
  },
  25000,
);

it("preserves the full pinned target on an unowned Link correction", () => {
  const f = fixture();
  f.run("createBead", { id: "beads/a", type: bead, properties: {} });
  const b = f.run("createBead", { id: "beads/b", type: bead, properties: {} }).resource;
  const old = f.run("createLink", {
    id: "links/l",
    type: link,
    source: "beads/a",
    target: { uri: b.id, revision: b.revision },
    properties: { secret: "link-private" },
  }).resource;
  const result = f.owner.correctLiveLinkVersion(old.id, old.revision, f.correction(old));
  expect(result.group.changes[0]!.resource).toMatchObject({
    source: `${scope}beads/a`,
    target: { uri: b.id, revision: b.revision },
  });
});
function mixedOwnershipFixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const other = `${scope}types/owned`;
  const f = fixture({
    ...extra,
    types: [
      parseTypeDescriptor({
        id: bead,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [other]: { max: 4 } },
      }),
      types[1]!,
      parseTypeDescriptor({
        id: other,
        name: "Owned",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
      }),
    ],
  });
  f.run("createBead", {
    id: "beads/a",
    type: bead,
    properties: { healthy: "source" },
    metadata: { stable: true },
  });
  const target = f.run("createBead", {
    id: "beads/b",
    type: bead,
    properties: { healthy: "target" },
    metadata: {},
  }).resource;
  const selected = f.run("createLink", {
    id: "links/l",
    type: link,
    source: "beads/a",
    target: { uri: target.id, revision: "selected-pin+ %/☃" },
    properties: { secret: "mixed-selected-private" },
    metadata: { secret: "mixed-selected-metadata" },
  });
  const owned = ["z", "a"].map((id) =>
    f.run("createLink", {
      id: `links/owned-${id}`,
      type: other,
      source: "beads/a",
      target: { uri: target.id, revision: `owned-${id}-pin+ %/☃` },
      properties: { untouched: id },
      metadata: { untouched: id },
    }),
  );
  function read(id: string) {
    const result = f.owner.withRead((reader) => {
      const row = reader.resource(id);
      return row ? readStoredResource(row, scope) : null;
    });
    if (result.kind !== "read") throw Error("source/owned read required");
    return result.value;
  }
  const source = read("beads/a");
  if (!source || "source" in source) throw Error("owning Bead required");
  expect(source.ownedLinks).toEqual({ [other]: [owned[1]!.resource, owned[0]!.resource] });
  return { f, selected, owned, source, target, read };
}

it.each(["correction", "tombstone"] as const)(
  "allows mixed-source unowned Link %s without changing its different complete owned set",
  (kind) => {
    const { f, selected, owned, source, target, read } = mixedOwnershipFixture();
    const old = selected.resource,
      epoch = f.owner.readConfiguration().scopeEpoch;
    const unrelatedFacts = () =>
      (f.owner.inspect().groups as { events: { subject: string }[] }[])
        .flatMap((group) => group.events)
        .filter((event) => event.subject !== old.id);
    const priorFacts = unrelatedFacts();
    const result =
      kind === "correction"
        ? f.owner.correctLiveLinkVersion(old.id, old.revision, f.correction(old))
        : f.owner.tombstoneLiveLinkVersion(old.id, old.revision);
    expect(result).not.toHaveProperty("receipt");
    expect(result.context.scopeEpoch).toBe(epoch);
    expect(result.group.changes).toHaveLength(1);
    expect(result.group.changes[0]).toMatchObject({
      resourceKind: "link",
      resource: { id: old.id, type: old.type },
    });
    expect(result.group.erasures).toEqual([
      {
        subject: old.id,
        revision: old.revision,
        digest: {
          scheme: "sha-256-jcs",
          value: createHash("sha256").update(erasureCanonicalJson(old)).digest("hex"),
        },
      },
    ]);
    expect(f.owner.erasureLedger()).toEqual(result.group.erasures);
    expect(read("beads/a")).toEqual(source);
    expect(read("beads/b")).toEqual(target);
    for (const item of owned) {
      expect(read(item.resource.id.slice(scope.length))).toEqual(item.resource);
      expect(f.owner.readRetainedVersion(item.resource.id, item.resource.revision).kind).toBe(
        "retained",
      );
      expect(f.owner.readReceipt("p", item.receipt.id).receipt).toEqual(item.receipt);
    }
    expect(f.owner.readRetainedVersion(source.id, source.revision).kind).toBe("retained");
    expect(f.owner.readRetainedVersion(target.id, target.revision).kind).toBe("retained");
    expect(f.owner.readRetainedVersion(old.id, old.revision).kind).toBe("erased");
    expect(f.owner.readReceipt("p", selected.receipt.id).receipt?.results).toEqual([
      {
        operationIndex: 0,
        outcome: "erased",
        erased: { id: old.id, type: old.type, revision: old.revision },
      },
    ]);
    const replay = f.owner.admit("p", selected.key, selected.prepared);
    expect(replay.kind).toBe("existing");
    if (replay.kind !== "existing") throw Error("same-key replay required");
    expect(replay.receipt).toEqual(f.owner.readReceipt("p", selected.receipt.id).receipt);
    const next = f.current();
    if (kind === "correction") {
      expect(next).toMatchObject({
        id: old.id,
        properties: { corrected: true },
        metadata: { corrected: true },
      });
      if (!next || !("source" in old) || !("source" in next))
        throw Error("Link successor required");
      expect(next.revision).not.toBe(old.revision);
      expect(next.source).toEqual(old.source);
      expect(next.target).toEqual(old.target);
      expect(result.group.events).toEqual([
        expect.objectContaining({ type: "updated", subject: old.id }),
      ]);
    } else {
      expect(next).toBeNull();
      // The selected Link loses its own last endpoint-bearing version. The
      // different owned Links do not restore that erased subject's graph facts.
      expect(result.group.events).toEqual([
        expect.objectContaining({ type: "deleted", data: { revision: old.revision } }),
      ]);
    }
    expect(result.group.events.every((event) => event.subject === old.id)).toBe(true);
    expect(unrelatedFacts()).toEqual(priorFacts);
    f.reopen();
    expect(f.owner.readConfiguration().scopeEpoch).toBe(epoch);
    expect(f.current()).toEqual(next);
    expect(read("beads/a")).toEqual(source);
    expect(read("beads/b")).toEqual(target);
    for (const item of owned)
      expect(read(item.resource.id.slice(scope.length))).toEqual(item.resource);
    expect(f.owner.erasureLedger()).toEqual(result.group.erasures);
    expect(unrelatedFacts()).toEqual(priorFacts);
    const raw = f.raw();
    expect(raw).not.toContain("mixed-selected-private");
    expect(raw).not.toContain("mixed-selected-metadata");
  },
);

it.each(["correction", "tombstone"] as const)(
  "rolls back mixed-source unowned Link %s with complete owned originals intact",
  (kind) => {
    let armed = false;
    const { f, selected, source, target, owned, read } = mixedOwnershipFixture({
      fault(stage) {
        if (armed && stage === "before-erasure-commit") throw Error("mixed-source rollback");
      },
    });
    const before = f.raw();
    armed = true;
    expect(() =>
      kind === "correction"
        ? f.owner.correctLiveLinkVersion(
            selected.resource.id,
            selected.resource.revision,
            f.correction(selected.resource),
          )
        : f.owner.tombstoneLiveLinkVersion(selected.resource.id, selected.resource.revision),
    ).toThrow("mixed-source rollback");
    expect(f.raw()).toBe(before);
    expect(f.current()).toEqual(selected.resource);
    expect(read("beads/a")).toEqual(source);
    expect(read("beads/b")).toEqual(target);
    for (const item of owned)
      expect(read(item.resource.id.slice(scope.length))).toEqual(item.resource);
    expect(f.owner.erasureLedger()).toEqual([]);
  },
);
it("uses the actual installed Link property validator without partial erasure writes", () => {
  const schema = `${scope}schemas/link`;
  const artifact = (retrievalUri: string, value: unknown) => ({
    retrievalUri,
    utf8Bytes: Buffer.from(JSON.stringify(value)),
  });
  const contracts = compileDevelopmentContracts({
    descriptors: [
      artifact(bead, { id: bead, name: "Task", describes: "bead", conformsTo: [] }),
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
it.each(["correction", "tombstone"] as const)(
  "fences uncertain %s after commit and reopens the whole atomic result",
  (kind) => {
    let armed = false;
    const f = fixture({
        fault(stage) {
          if (armed && stage === "after-erasure-commit") throw Error("new postcommit Link fault");
        },
      }),
      old = f.seed().resource;
    armed = true;
    expect(() =>
      kind === "correction"
        ? f.owner.correctLiveLinkVersion(old.id, old.revision, f.correction(old))
        : f.owner.tombstoneLiveLinkVersion(old.id, old.revision),
    ).toThrow();
    expect(() => f.current()).toThrow();
    f.reopen();
    expect(f.owner.erasureLedger()).toHaveLength(1);
    if (kind === "tombstone") expect(f.current()).toBeNull();
    else expect(f.current()?.properties).toEqual({ corrected: true });
  },
);

it("corrects and tombstones a pinned external-source Link with its only local target unchanged", () => {
  const external = { uri: "urn:live-link:source", revision: "opaque-source-pin" };
  const f = fixture({
    types: [
      types[0]!,
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "opaque" },
        target: { conformsTo: [], external: "none" },
      }),
    ],
  });
  const target = f.run("createBead", {
    id: "beads/b",
    type: bead,
    properties: { safe: true },
  }).resource;
  const old = f.run("createLink", {
    id: "links/l",
    type: link,
    source: external,
    target: target.id,
    properties: { secret: "link-private" },
  }).resource;
  const correction = f.owner.correctLiveLinkVersion(old.id, old.revision, f.correction(old));
  const next = correction.group.changes[0]!.resource;
  expect(next).toMatchObject({ source: external, target: target.id });
  const deleted = f.owner.tombstoneLiveLinkVersion(old.id, next.revision);
  expect(deleted.group.events.map((event) => event.type)).toEqual(["deleted"]);
  expect(f.current()).toBeNull();
  f.reopen();
  expect(f.owner.erasureLedger()).toHaveLength(2);
});
