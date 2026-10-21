import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isReadProblem, parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import type { ReadObservation } from "./authority-read.js";
import { requestFromUrl } from "./read-request.js";
import { prepareTransaction } from "./transaction-batch.js";
import { createTransactionHttpHandler } from "./transaction-http.js";
import { transactionReadContexts } from "./transaction-read.js";
import { createTransactionService } from "./transaction-service.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://continuation.test/s/",
  bead = `${scope}types/bead`,
  link = `${scope}types/link`;
const clean: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const close of clean.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Continuation test cleanup failed");
});
function setup(onWait: (elapsed: number) => void = () => {}) {
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
  let elapsed = 0;
  const service = createTransactionService(owner, {
    ownerLifetime: "service",
    minimumReads: {
      budgetMs: 20,
      now: () => elapsed,
      wait: async (ms) => {
        elapsed += ms;
        onWait(elapsed);
      },
    },
    read: {
      selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
      advertisedLimits: {
        page: { defaultItems: 1, maximumItems: 32 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 1000,
      },
      pagination: {
        scope,
        defaultPageItems: 1,
        maxPageItems: 32,
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
    },
  });
  clean.push(() => service.close());
  const principal = { kind: "authenticated", principal: { id: "p" } } as const;
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
    service,
    elapsed: () => elapsed,
    principal,
    write,
    minimum,
    facet: service.readFor(principal),
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

async function saved(f: ReturnType<typeof setup>, collection: "beads" | "links" = "beads") {
  f.write(seed);
  const first = successful(await f.facet.perform({ kind: "collection", collection, limit: 1 }));
  const request = requestFromUrl(new URL(String(first.body.next)), scope);
  if (isReadProblem(request)) throw Error("issued continuation required");
  const before = successful(await f.facet.perform(request));
  f.write([
    {
      operation: "updateBead",
      bead: "beads/b",
      propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
    },
  ]);
  return { request, before, url: String(first.body.next) };
}
it.each(["beads", "links"] as const)(
  "times out higher %s minima at one fixed deadline with current error context",
  async (collection) => {
    const f = setup();
    const { request, before } = await saved(f, collection);
    await expect(
      f.service.readAtMinimum(f.principal, f.minimum("pos-2")).perform(request),
    ).rejects.toMatchObject({ reason: "catch-up-timeout", context: { scopePosition: "pos-2" } });
    expect(f.elapsed()).toBe(20);
    const after = successful(await f.facet.perform(request));
    expect(after.body).toBe(before.body);
    expect(transactionReadContexts(after.observation).snapshot?.scopePosition).toBe("pos-1");
  },
);
it("uses native expiry when the original cursor expires during the higher-minimum wait", async () => {
  const f = setup(() => f.advance(2000));
  const { request } = await saved(f);
  expect(
    await f.service.readAtMinimum(f.principal, f.minimum("pos-2")).perform(request),
  ).toMatchObject({ kind: "problem", problem: { code: "cursor-expired" } });
  expect(f.elapsed()).toBe(5);
});
it("rechecks whole-copy erasure and never republishes a bound retained page after erasure", async () => {
  let erased = false;
  const f = setup(() => {
    if (!erased) {
      erased = true;
      f.owner.eraseHistoricalVersions([
        { subject: `${scope}beads/b`, revision: String(before.body.items[0]?.revision) },
      ]);
    }
  });
  const { request, before } = await saved(f);
  expect(
    await f.service.readAtMinimum(f.principal, f.minimum("pos-2")).perform(request),
  ).toMatchObject({ kind: "problem", problem: { code: "cursor-expired" } });
  expect(erased).toBe(true);
  const context = transactionReadContexts(before.observation).snapshot;
  if (!context) throw Error("saved source required");
  expect(() => f.owner.assertPublication(context)).toThrow("response predates erasure publication");
});
it.each(["GET", "HEAD"])(
  "maps a bound higher continuation minimum to native bounded timeout for %s before conditionals",
  async (method) => {
    const f = setup();
    const { url } = await saved(f);
    const response = await createTransactionHttpHandler(f.service, scope).handle(
      new Request(url, {
        method,
        headers: {
          "bdp-scope-epoch": f.owner.scopeEpoch,
          "bdp-authorization-view": "development-all-visible",
          "bdp-minimum-scope-position": "pos-2",
          "if-none-match": "*",
        },
      }),
      { kind: "authenticated", principal: "p", canMutate: false },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
    if (method === "GET")
      expect(response.body).toMatchObject({ code: "catch-up-timeout", retry: "after-delay" });
    else expect(response.body).toBeUndefined();
    expect(f.elapsed()).toBe(20);
  },
);
