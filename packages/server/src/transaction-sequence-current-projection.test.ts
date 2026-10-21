/** Current public sequence presentation; genuine owner facts remain private. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { prepareTransactionSequence } from "./transaction-batch.js";
import { createTransactionHttpHandler } from "./transaction-http.js";
import { createTransactionService } from "./transaction-service.js";
import { projectCurrentSequenceEntry, runTransactionSequence } from "./transaction-sequence.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://sequence-projection.test/s/",
  bead = `${scope}types/bead`,
  link = `${scope}types/link`;
const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "sequence projection cleanup failed");
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-sequence-projection-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000,
    token = 0;
  const owner = openTransactionStore({
    file: path.join(directory, "store.sqlite"),
    scope,
    create: true,
    clock: () => now,
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
  let service: ReturnType<typeof createTransactionService> | undefined;
  cleanup.push(() => (service ? service.close() : owner.close()));
  service = createTransactionService(owner, {
    ownerLifetime: "service",
    read: {
      selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
      advertisedLimits: {
        page: { defaultItems: 2, maximumItems: 32 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 1000,
      },
      pagination: {
        scope,
        defaultPageItems: 2,
        maxPageItems: 32,
        cursorTtlMs: 1000,
        retainedStateCapacity: 100,
        maxRetainedCursorPositionsPerSnapshot: 20,
        retainedSnapshotByteCapacity: 100000,
        retainedSnapshotNodeCapacity: 10000,
        maxOpaqueTokenLength: 64,
        tokenGenerationAttempts: 3,
        idleCleanup: "on-demand",
        clock: () => now,
        generateOpaqueToken: () => `cursor_${++token}`,
      },
    },
  });
  return {
    owner,
    service,
    expire: () => {
      now += 86400001;
    },
  };
}
const creator = (name = "creator") => ({
  operation: "createBead",
  idempotencyKey: "create",
  name,
  id: "beads/a",
  type: bead,
  properties: { title: "original" },
});
const alias = {
  operation: "putAlias",
  idempotencyKey: "alias",
  alias: "alias/work",
  target: "beads/a",
};
const update = {
  operation: "updateBead",
  idempotencyKey: "update",
  bead: "beads/a",
  propertiesChange: [{ op: "replace", path: "/title", value: "successor" }],
};
const prepared = (members: unknown[]) =>
  prepareTransactionSequence(scope, JSON.stringify({ operations: members }));
const forbidden = (index: number, name?: string) => ({
  type: "https://github.com/gastownhall/bdp/problems/authorization",
  code: "forbidden",
  status: 403,
  retry: "after-state-change",
  operationIndex: index,
  ...(name ? { operationName: name } : {}),
});

it("projects withheld available Resource entries as current forbidden problems without changing alias facts", async () => {
  const f = fixture(),
    carrier = prepared([creator(), update, alias]);
  const original = await runTransactionSequence(f.owner, "p", carrier);
  const before = f.owner.inspect();
  f.owner.replaceAuthorizationPolicy();
  const policy = f.owner.withRead((reader) =>
    f.owner.captureReadAuthorization(reader, { kind: "authenticated", principal: { id: "p" } }),
  );
  if (policy.kind !== "read") throw new Error("policy observation refused");
  const result = {
    body: {
      results: original.results.map((entry) =>
        projectCurrentSequenceEntry(entry, policy.value.readPolicy),
      ),
    },
  };
  expect(result.body.results).toEqual([
    forbidden(0, "creator"),
    forbidden(1),
    {
      operationIndex: 2,
      outcome: "created",
      alias: `${scope}alias/work`,
      target: `${scope}beads/a`,
    },
  ]);
  expect(f.owner.inspect()).toEqual(before);
  expect(JSON.stringify(result.body)).not.toContain("successor");
});

it("projects erased available entries as forbidden without inventing subject-history authorization", async () => {
  const f = fixture();
  const created = await f.service.sequenceObserved("p", prepared([creator()]));
  const resource = created.body.results[0]!.resource as { revision: string };
  await f.service.sequenceObserved("p", prepared([update]));
  f.owner.eraseHistoricalVersions([{ subject: `${scope}beads/a`, revision: resource.revision }]);
  const before = f.owner.inspect();
  const replay = await f.service.sequenceObserved("p", prepared([creator("present")]));
  expect(replay.body.results).toEqual([forbidden(0, "present")]);
  expect(JSON.stringify(replay.body)).not.toContain("resource-erased");
  expect(f.owner.inspect()).toEqual(before);
  const dependent = {
    operation: "createLink",
    idempotencyKey: "erased-dependent",
    name: "child",
    id: "links/l",
    type: link,
    source: "@present",
    target: "@present",
  };
  const bound = await f.service.sequenceObserved("p", prepared([creator("present"), dependent]));
  expect(bound.body.results[0]).toEqual(forbidden(0, "present"));
  expect(bound.body.results[1]).toMatchObject({
    outcome: "created",
    resource: { source: `${scope}beads/a`, target: `${scope}beads/a` },
  });
  expect(f.owner.inspect().position).toBe("4");
});

it("projects expired creations to exactly disclosed or withheld allocation and never adds it to update or alias", async () => {
  const f = fixture(),
    carrier = prepared([creator(), update, alias]);
  await f.service.sequenceObserved("p", carrier);
  f.expire();
  const visible = await f.service.sequenceObserved("p", carrier);
  expect(visible.body.results[0]!.allocated).toEqual({ id: `${scope}beads/a`, type: bead });
  for (const entry of visible.body.results) expect(entry.code).toBe("idempotency-expired");
  expect(visible.body.results[1]).not.toHaveProperty("allocated");
  expect(visible.body.results[2]).not.toHaveProperty("allocated");
  f.owner.replaceAuthorizationPolicy();
  const hidden = {
    body: {
      results: visible.body.results.map((entry) => projectCurrentSequenceEntry(entry, "empty")),
    },
  };
  expect(hidden.body.results[0]!.allocated).toEqual({ withheld: true });
  expect(hidden.body.results[1]).not.toHaveProperty("allocated");
  expect(hidden.body.results[2]).not.toHaveProperty("allocated");
  expect(JSON.stringify(hidden.body)).not.toContain(`${scope}beads/a`);
});

it("keeps private expired creator binding and independently authorizes a new dependent", async () => {
  const f = fixture();
  await f.service.sequenceObserved("p", prepared([creator()]));
  f.expire();
  const dependent = {
    operation: "createLink",
    idempotencyKey: "dependent",
    name: "child",
    id: "links/l",
    type: link,
    source: "@creator",
    target: "@creator",
  };
  const result = await f.service.sequenceObserved("p", prepared([creator(), dependent]));
  expect(result.body.results[0]!.allocated).toEqual({ id: `${scope}beads/a`, type: bead });
  expect(result.body.results[1]).toMatchObject({
    outcome: "created",
    resource: { source: `${scope}beads/a`, target: `${scope}beads/a` },
  });
  f.owner.replaceAuthorizationPolicy();
  const before = f.owner.inspect();
  await expect(
    f.service.sequenceObserved(
      "p",
      prepared([creator(), { ...dependent, idempotencyKey: "denied" }]),
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(f.owner.inspect()).toEqual(before);
});

it("serves current forbidden sequence members in the public HTTP envelope rather than a receipt entry or a carrier500", async () => {
  const f = fixture();
  await f.service.sequenceObserved("p", prepared([creator()]));
  const first = f.owner.inspect().resources[0]!;
  await f.service.sequenceObserved("p", prepared([update]));
  f.owner.eraseHistoricalVersions([
    { subject: `${scope}beads/a`, revision: (first as { revision: string }).revision },
  ]);
  const response = await createTransactionHttpHandler(f.service, scope).handle(
    new Request(`${scope}operations/sequence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operations: [creator("present")] }),
    }),
    { kind: "authenticated", principal: "p", canMutate: true },
    { text: JSON.stringify({ operations: [creator("present")] }) },
  );
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ results: [forbidden(0, "present")] });
  expect(response.headers.get("bdp-authorization-view")).toBeTruthy();
});
