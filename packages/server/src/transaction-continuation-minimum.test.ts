import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isReadProblem, parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import type { ReadObservation } from "./authority-read.js";
import { requestFromUrl } from "./read-request.js";
import { prepareTransaction } from "./transaction-batch.js";
import {
  createTransactionReadPlane,
  TransactionContinuationMinimumUnsupported,
  transactionReadContexts,
} from "./transaction-read.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://continuation.test/s/",
  bead = `${scope}types/bead`,
  link = `${scope}types/link`;
const clean: (() => unknown)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const close of clean.splice(0).reverse()) {
    try {
      close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Continuation test cleanup failed");
});
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-continuation-minimum-"));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const owner = openTransactionStore({
    file: path.join(dir, "store.sqlite"),
    scope,
    create: true,
    types: [
      parseTypeDescriptor({ id: bead, name: "Bead", describes: "bead", conformsTo: [] }),
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [bead], external: "none" },
        target: { conformsTo: [bead], external: "none" },
      }),
    ],
  });
  clean.push(() => owner.close());
  let clock = 1000,
    token = 0,
    key = 0;
  const plane = createTransactionReadPlane(owner, {
    selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
    advertisedLimits: {
      page: { defaultItems: 1, maximumItems: 10 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 1000,
    },
    pagination: {
      scope,
      defaultPageItems: 1,
      maxPageItems: 10,
      cursorTtlMs: 1000,
      retainedStateCapacity: 100,
      maxRetainedCursorPositionsPerSnapshot: 20,
      retainedSnapshotByteCapacity: 100_000,
      retainedSnapshotNodeCapacity: 10_000,
      maxOpaqueTokenLength: 64,
      tokenGenerationAttempts: 3,
      idleCleanup: "on-demand",
      clock: () => clock,
      generateOpaqueToken: () => `cursor_${++token}`,
    },
  });
  clean.push(() => plane.close());
  const principal = { kind: "anonymous" } as const;
  const write = (operations: unknown[]) => {
    const claim = owner.admit(
      "writer",
      `key_${++key}`,
      prepareTransaction(scope, JSON.stringify({ operations })),
    );
    if (claim.kind !== "owned") throw Error("fresh claim required");
    expect(owner.execute(claim.claim).status).toBe("completed");
  };
  const minimum = (position = "pos-1") => ({
    scopeEpoch: owner.scopeEpoch,
    authorizationView: "development-all-visible",
    minimumPosition: position,
  });
  return {
    owner,
    plane,
    principal,
    write,
    minimum,
    facet: plane.readFor(principal),
    advance: (value: number) => {
      clock = value;
    },
  };
}
function successful(value: unknown) {
  if (!value || typeof value !== "object" || !("body" in value) || !("observation" in value))
    throw Error("successful page required");
  return value as {
    body: { items: Record<string, unknown>[]; next: string | null };
    observation: ReadObservation;
  };
}
const seed = [
  ...["a", "b", "c"].map((id) => ({
    operation: "createBead",
    id: `beads/${id}`,
    type: bead,
    properties: { title: id },
  })),
  ...["a", "b", "c"].map((id) => ({
    operation: "createLink",
    id: `links/${id}`,
    type: link,
    source: "beads/a",
    target: "beads/b",
    properties: { title: id },
  })),
];
it.each(["beads", "links"] as const)(
  "serves satisfied %s continuation minima from saved rows after current state advances",
  async (collection) => {
    const f = setup();
    f.write(seed);
    const first = successful(await f.facet.perform({ kind: "collection", collection, limit: 1 }));
    const request = requestFromUrl(new URL(String(first.body.next)), scope);
    if (isReadProblem(request)) throw Error("issued continuation required");
    const original = successful(await f.facet.perform(request));
    f.write([
      {
        operation: collection === "beads" ? "updateBead" : "updateLink",
        [collection === "beads" ? "bead" : "link"]: `${collection}/b`,
        propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
      },
    ]);
    for (const position of ["genesis", "pos-0", "pos-1"]) {
      const result = successful(
        await f.plane.minimumFor(f.principal, f.minimum(position)).perform(request),
      );
      expect(result.body).toBe(original.body);
      expect(result.body.items[0]?.properties).toEqual({ title: "b" });
      expect(transactionReadContexts(result.observation)).toEqual({
        current: {
          scopeEpoch: f.owner.scopeEpoch,
          authorizationView: "development-all-visible",
          scopePosition: "pos-2",
        },
        snapshot: {
          scopeEpoch: f.owner.scopeEpoch,
          authorizationView: "development-all-visible",
          scopePosition: "pos-1",
        },
      });
    }
  },
);

it("keeps higher, opaque, foreign and unissued continuation minima explicitly unselected", async () => {
  const f = setup();
  f.write(seed);
  const first = successful(
    await f.facet.perform({ kind: "collection", collection: "beads", limit: 1 }),
  );
  const request = requestFromUrl(new URL(String(first.body.next)), scope);
  if (isReadProblem(request)) throw Error("issued continuation required");
  const original = successful(await f.facet.perform(request));
  f.write([
    {
      operation: "updateBead",
      bead: "beads/b",
      propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
    },
  ]);
  for (const minimum of [
    f.minimum("pos-2"),
    f.minimum("opaque"),
    { ...f.minimum(), scopeEpoch: "foreign" },
    { ...f.minimum(), authorizationView: "foreign" },
  ]) {
    await expect(f.plane.minimumFor(f.principal, minimum).perform(request)).rejects.toBeInstanceOf(
      TransactionContinuationMinimumUnsupported,
    );
    expect(successful(await f.facet.perform(request)).body).toBe(original.body);
  }
  const unknown = requestFromUrl(new URL(`${scope}beads/?cursor=unissued`), scope);
  if (isReadProblem(unknown)) throw Error("well-shaped cursor required");
  await expect(
    f.plane.minimumFor(f.principal, f.minimum()).perform(unknown),
  ).rejects.toBeInstanceOf(TransactionContinuationMinimumUnsupported);
});

it("satisfied minimum replays retain the original absolute cursor expiry", async () => {
  const f = setup();
  f.write(seed);
  const first = successful(
    await f.facet.perform({ kind: "collection", collection: "beads", limit: 1 }),
  );
  const request = requestFromUrl(new URL(String(first.body.next)), scope);
  if (isReadProblem(request)) throw Error("issued continuation required");
  const before = successful(await f.facet.perform(request));
  f.advance(1999);
  expect(successful(await f.plane.minimumFor(f.principal, f.minimum()).perform(request)).body).toBe(
    before.body,
  );
  f.advance(2000);
  expect(await f.facet.perform(request)).toMatchObject({
    kind: "problem",
    problem: { code: "cursor-expired" },
  });
  await expect(
    f.plane.minimumFor(f.principal, f.minimum()).perform(request),
  ).rejects.toBeInstanceOf(TransactionContinuationMinimumUnsupported);
});

it("retained minimum does not bypass whole-copy erasure or saved-source publication fences", async () => {
  const f = setup();
  f.write(seed);
  const first = successful(
    await f.facet.perform({ kind: "collection", collection: "beads", limit: 1 }),
  );
  const request = requestFromUrl(new URL(String(first.body.next)), scope);
  if (isReadProblem(request)) throw Error("issued continuation required");
  const old = successful(await f.plane.minimumFor(f.principal, f.minimum()).perform(request));
  const saved = transactionReadContexts(old.observation).snapshot;
  if (!saved) throw Error("saved source required");
  f.write([
    {
      operation: "updateBead",
      bead: "beads/b",
      propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
    },
  ]);
  f.owner.eraseHistoricalVersions([
    { subject: `${scope}beads/b`, revision: String(old.body.items[0]?.revision) },
  ]);
  expect(() => f.owner.assertPublication(saved)).toThrow("response predates erasure publication");
  await expect(
    f.plane.minimumFor(f.principal, f.minimum()).perform(request),
  ).rejects.toBeInstanceOf(TransactionContinuationMinimumUnsupported);
  expect(await f.facet.perform(request)).toMatchObject({
    kind: "problem",
    problem: { code: "cursor-expired" },
  });
});
