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

const scope = "https://type-incident-minimum.test/s/",
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
    allocations: () => token,
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

type Family = "types" | "incident";
function initial(family: Family) {
  return family === "types"
    ? ({ kind: "collection", collection: "types", limit: 1 } as const)
    : ({
        kind: "bead-links",
        bead: (scope + "beads/a") as `https://${string}`,
        direction: "outbound",
        limit: 1,
      } as const);
}
async function saved(f: ReturnType<typeof setup>, family: Family) {
  f.write(seed);
  const first = successful(await f.facet.perform(initial(family)));
  const request = requestFromUrl(new URL(String(first.body.next)), scope);
  if (isReadProblem(request)) throw Error("issued cursor");
  const before = successful(await f.facet.perform(request));
  f.write([
    {
      operation: "updateLink",
      link: "links/b",
      propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
    },
    {
      operation: "createLink",
      id: "links/d",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: { title: "new" },
    },
  ]);
  return { first, request, before, url: String(first.body.next) };
}
it.each(["types", "incident"] as const)(
  "serves matched satisfied %s minimum from the original query prefix after real commit",
  async (family) => {
    const f = setup(),
      { request, before } = await saved(f, family),
      allocations = f.allocations();
    const current = successful(
      await f.service.readAtMinimum(f.principal, f.minimum()).perform(request),
    );
    expect(current.body).toBe(before.body);
    expect(transactionReadContexts(current.observation)).toMatchObject({
      snapshot: { scopePosition: "pos-1" },
      current: { scopePosition: "pos-2" },
    });
    expect(f.elapsed()).toBe(0);
    expect(f.allocations()).toBe(allocations);
    if (family === "incident") expect(current.body.items[0]!.properties).toEqual({ title: "b" });
    f.advance(2000);
    await expect(
      f.service.readAtMinimum(f.principal, f.minimum()).perform(request),
    ).rejects.toThrow();
    expect(await f.facet.perform(request)).toMatchObject({
      kind: "problem",
      problem: { code: "cursor-expired" },
    });
  },
);
it.each(["types", "incident"] as const)(
  "times out higher %s minimum using fixed saved prefix despite newer live head",
  async (family) => {
    const f = setup(),
      { request, before } = await saved(f, family),
      allocations = f.allocations();
    await expect(
      f.service.readAtMinimum(f.principal, f.minimum("pos-2")).perform(request),
    ).rejects.toMatchObject({ reason: "catch-up-timeout", context: { scopePosition: "pos-2" } });
    expect(f.elapsed()).toBe(20);
    expect(f.allocations()).toBe(allocations);
    expect(successful(await f.facet.perform(request)).body).toBe(before.body);
  },
);
it.each(["types", "incident"] as const)(
  "preserves native %s expiry during the one higher-minimum wait",
  async (family) => {
    const f = setup(() => f.advance(2000)),
      { request } = await saved(f, family);
    expect(
      await f.service.readAtMinimum(f.principal, f.minimum("pos-2")).perform(request),
    ).toMatchObject({ kind: "problem", problem: { code: "cursor-expired" } });
    expect(f.elapsed()).toBe(5);
  },
);
it.each(["types", "incident"] as const)(
  "keeps %s erasure and saved publication fences while minimum waits",
  async (family) => {
    let erased = false;
    const f = setup(() => {
      if (!erased) {
        erased = true;
        f.owner.eraseHistoricalVersions([
          { subject: scope + "links/b", revision: String(linkBefore.body.items[0]!.revision) },
        ]);
      }
    });
    // Obtain actual old Link revision separately; Types snapshots still belong to
    // the view-wide erasure publication fence and must not be relabelled livehead.
    f.write(seed);
    const linkFirst = successful(
      await f.facet.perform({ kind: "collection", collection: "links", limit: 1 }),
    );
    const linkRequest = requestFromUrl(new URL(String(linkFirst.body.next)), scope);
    if (isReadProblem(linkRequest)) throw Error("link cursor");
    const linkBefore = successful(await f.facet.perform(linkRequest));
    const first = successful(await f.facet.perform(initial(family))),
      request = requestFromUrl(new URL(String(first.body.next)), scope);
    if (isReadProblem(request)) throw Error("family cursor");
    const actual = successful(await f.facet.perform(request));
    const source = transactionReadContexts(actual.observation).snapshot!;
    f.write([
      {
        operation: "updateLink",
        link: "links/b",
        propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
      },
    ]);
    expect(
      await f.service.readAtMinimum(f.principal, f.minimum("pos-2")).perform(request),
    ).toMatchObject({ kind: "problem", problem: { code: "cursor-expired" } });
    expect(erased).toBe(true);
    expect(() => f.owner.assertPublication(source)).toThrow(
      "response predates erasure publication",
    );
  },
);
it.each(["types", "incident"] as const)(
  "does not select new first-invalid/foreign/unknown %s cursor semantics",
  async (family) => {
    const f = setup(),
      { request, url } = await saved(f, family);
    for (const minimum of [
      { ...f.minimum(), minimumPosition: "opaque-unknown" },
      { ...f.minimum(), authorizationView: "foreign" },
      { ...f.minimum(), scopeEpoch: "foreign" },
    ])
      await expect(
        f.service.readAtMinimum(f.principal, minimum).perform(request),
      ).rejects.toThrow();
    const forged = new URL(url);
    forged.searchParams.set("cursor", "not-issued");
    const invalid = requestFromUrl(forged, scope);
    if (isReadProblem(invalid)) throw Error("structural cursor");
    await expect(
      f.service.readAtMinimum(f.principal, f.minimum()).perform(invalid),
    ).rejects.toThrow();
    expect(f.elapsed()).toBe(0);
  },
);
it.each(["types", "incident"] as const)(
  "maps higher %s minimum GET/HEAD timeout before conditional shortcuts",
  async (family) => {
    const f = setup(),
      { url } = await saved(f, family);
    const handler = createTransactionHttpHandler(f.service, scope);
    let length: string | null = null;
    for (const method of ["GET", "HEAD"]) {
      const response = await handler.handle(
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
      if (method === "GET") {
        expect(response.body).toMatchObject({ code: "catch-up-timeout", retry: "after-delay" });
        length = String(Buffer.byteLength(JSON.stringify(response.body)));
      } else {
        expect(response.body).toBeUndefined();
        expect(response.headers.get("content-length")).toBe(length);
      }
    }
    expect(f.elapsed()).toBe(40);
  },
);
