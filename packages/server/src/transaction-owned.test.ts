import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseTypeDescriptor, isJsonSchemaUri, isJsonSchemaDateTime } from "@bdp/protocol";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import * as batch from "./transaction-batch.js";
import * as evaluator from "./resource-evaluator.js";
import { openTransactionStore, type TransactionReceipt } from "./transaction-store.js";

const scope = "https://example.test/owned/",
  bead = `${scope}types/bead`,
  target = `${scope}types/target`,
  link = `${scope}types/link`;
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
function descriptors(owns: Record<string, { max: number }> = { [link]: { max: 4 } }) {
  return [
    parseTypeDescriptor({
      id: bead,
      name: "Owner",
      describes: "bead",
      conformsTo: [],
      ownsOutgoing: owns,
    }),
    parseTypeDescriptor({ id: target, name: "Target", describes: "bead", conformsTo: [] }),
    parseTypeDescriptor({
      id: link,
      name: "Link",
      describes: "link",
      conformsTo: [],
      source: { conformsTo: [bead], external: "none" },
      target: { conformsTo: [], external: "none" },
    }),
  ];
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(new URL("../../../specs/profiles/core/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(bundle);
const receiptSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const groupSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/changeGroup` });
type RecordBody = evaluator.ResourceRecord;
type Result = {
  operationIndex: number;
  outcome: string;
  count?: number;
  source?: string;
  sourceRevision?: string;
  resource?: RecordBody;
};
type Event = {
  type: string;
  subject: string;
  subjectType: string;
  source: string;
  ordinal: number;
  data: Record<string, unknown>;
};
type Group = { events: Event[]; changes: { operation: string; resource: RecordBody }[] };
function results(r: TransactionReceipt) {
  return r.results as Result[];
}
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-owned-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    file: path.join(directory, "owner.sqlite"),
    scope,
    types: descriptors(),
    create: true,
    receiptMaximumItems: 2,
    ...extra,
  };
  let owner = openTransactionStore(options);
  cleanup.push(() => owner.close());
  return {
    get owner() {
      return owner;
    },
    options,
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    admit(operations: unknown[], key = "key", singleton = false) {
      return owner.admit(
        "p",
        key,
        batch.prepareTransactionSetCore(scope, JSON.stringify({ operations }), singleton),
      );
    },
    run(operations: unknown[], key = "key") {
      const admitted = this.admit(operations, key);
      if (admitted.kind !== "owned") throw new Error("expected new admission");
      const receipt = owner.execute(admitted.claim);
      expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
      const group = owner.inspect().groups.at(-1);
      if (group) expect(groupSchema(group), JSON.stringify(groupSchema.errors)).toBe(true);
      return receipt;
    },
    record(id: string): RecordBody {
      const found = owner.inspect().resources.find((r) => (r as RecordBody).id === `${scope}${id}`);
      if (!found) throw new Error(`missing ${id}`);
      return found as RecordBody;
    },
    group() {
      return owner.inspect().groups.at(-1) as Group;
    },
  };
}
const create = (id = "a", type = bead) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { n: 0 },
});
const edge = (id = "l", source = "beads/a", to = "beads/b") => ({
  operation: "createLink",
  id: `links/${id}`,
  type: link,
  source,
  target: to,
  properties: { n: 0 },
  metadata: { note: "old" },
});
const patch = (n: number, id = "l") => ({
  operation: "updateLink",
  link: `links/${id}`,
  propertiesChange: [{ op: "replace", path: "/n", value: n }],
});
const remove = (id = "l") => ({ operation: "deleteLink", link: `links/${id}` });
function seed(f: ReturnType<typeof fixture>) {
  f.run([create(), create("b", target)], "seed");
}
function inline(record: RecordBody) {
  if ("source" in record) throw new Error("expected owner");
  return record.ownedLinks;
}
const provenance = { actor: { id: "writer", basis: "writer-supplied" } };

it("projects owned lifecycle, property and metadata deltas with exact source versions and provenance", () => {
  const f = fixture();
  seed(f);
  const targetBefore = f.record("beads/b");
  let previous = f.record("beads/a");
  const created = f.run([{ ...edge(), revisionProvenance: provenance }], "create");
  let current = f.record("beads/a"),
    linked = f.record("links/l");
  expect(results(created)[0]).toEqual({
    operationIndex: 0,
    outcome: "created",
    resource: linked,
    source: current.id,
    sourceRevision: current.revision,
  });
  expect(inline(current)?.[link]).toEqual([linked]);
  expect(f.group().events.map((e) => [e.type, e.subject])).toEqual([
    ["created", linked.id],
    ["linked", linked.id],
    ["linked", linked.id],
    ["updated", current.id],
  ]);
  expect(f.group().events.at(-1)?.data).toEqual({
    previousRevision: previous.revision,
    revision: current.revision,
    revisionProvenance: provenance,
    ownedLink: { operation: "created", link: linked },
  });
  for (const [key, mutation] of [
    ["properties", patch(1)],
    [
      "metadata",
      {
        operation: "updateLink",
        link: "links/l",
        metadataChange: [{ op: "replace", path: "/note", value: "new" }],
      },
    ],
    [
      "combined",
      {
        ...patch(2),
        metadataChange: [{ op: "remove", path: "/note" }],
        revisionProvenance: provenance,
      },
    ],
  ] as const) {
    previous = current;
    const oldLink = linked;
    const updated = f.run([mutation], key);
    current = f.record("beads/a");
    linked = f.record("links/l");
    expect(results(updated)[0]).toEqual({
      operationIndex: 0,
      outcome: "updated",
      resource: linked,
      source: current.id,
      sourceRevision: current.revision,
    });
    expect(f.group().changes).toEqual([
      { operation: "upsert", resourceKind: "link", resource: linked },
      { operation: "upsert", resourceKind: "bead", resource: current },
    ]);
    const events = f.group().events;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ subject: linked.id, type: "updated" });
    expect(events[1]).toMatchObject({
      subject: current.id,
      type: "updated",
      data: {
        previousRevision: previous.revision,
        revision: current.revision,
        ownedLink: {
          operation: "updated",
          link: {
            id: linked.id,
            type: link,
            previousRevision: oldLink.revision,
            revision: linked.revision,
          },
        },
      },
    });
    const sourceEvent = events[1];
    if (!sourceEvent) throw new Error("missing source Event");
    const nested = (sourceEvent.data.ownedLink as { link: Record<string, unknown> }).link;
    const delta = {
      previousRevision: oldLink.revision,
      revision: linked.revision,
      ...("propertiesChange" in mutation ? { change: mutation.propertiesChange } : {}),
      ...("metadataChange" in mutation ? { metadataChange: mutation.metadataChange } : {}),
      ...(linked.revisionProvenance ? { revisionProvenance: linked.revisionProvenance } : {}),
    };
    // Closed Event shape is a materialization premise: no previous Resource body.
    expect(events[0]?.data).toEqual(delta);
    expect(sourceEvent.data).toEqual({
      previousRevision: previous.revision,
      revision: current.revision,
      ownedLink: { operation: "updated", link: { id: linked.id, type: link, ...delta } },
      ...(current.revisionProvenance ? { revisionProvenance: current.revisionProvenance } : {}),
    });
    expect(nested).toEqual({ id: linked.id, type: link, ...delta });
    expect(nested).not.toHaveProperty("properties");
    expect(nested.change !== undefined || nested.metadataChange !== undefined).toBe(true);
    expect(events[1]?.data).not.toHaveProperty("change");
    expect(events[1]?.data).not.toHaveProperty("metadataChange");
    expect(inline(current)?.[link]).toEqual([linked]);
    expect(current.revisionProvenance).toEqual(linked.revisionProvenance);
    if (key !== "combined") expect(current.revisionProvenance).toBeUndefined();
  }
  previous = current;
  const deleted = f.run([remove()], "delete");
  current = f.record("beads/a");
  expect(results(deleted)[0]).toEqual({
    operationIndex: 0,
    outcome: "deleted",
    deleted: {
      resourceKind: "link",
      resource: { id: linked.id, type: linked.type, revision: linked.revision },
    },
    source: current.id,
    sourceRevision: current.revision,
  });
  expect(inline(current)?.[link]).toEqual([]);
  expect(f.group().events.map((e) => e.type)).toEqual([
    "deleted",
    "unlinked",
    "unlinked",
    "updated",
  ]);
  expect(f.group().events.at(-1)?.data).toEqual({
    previousRevision: previous.revision,
    revision: current.revision,
    ownedLink: {
      operation: "deleted",
      link: { id: linked.id, type: link, revision: linked.revision },
    },
  });
  expect(f.group().changes).toContainEqual({
    operation: "tombstone",
    resourceKind: "link",
    resource: { id: linked.id, type: link, revision: linked.revision },
  });
  expect(f.record("beads/b")).toEqual(targetBefore);
  for (const group of f.owner.inspect().groups as Group[]) {
    expect(group.events.map((e) => e.ordinal)).toEqual(group.events.map((_, i) => i));
    expect(group.events.every((e) => e.source === `${scope}events/`)).toBe(true);
  }
});

it("orders both self-Link incidences and preserves explicit versus wildcard empty buckets", () => {
  for (const owns of [{ [link]: { max: 1 } }, { "*": { max: 1 } }]) {
    const f = fixture({ types: descriptors(owns) });
    f.run([create()], "seed");
    const before = f.record("beads/a");
    f.run([edge("l", "beads/a", "beads/a")], "create");
    const after = f.record("beads/a"),
      events = f.group().events;
    expect(events).toHaveLength(4);
    expect(events.slice(1, 3).map((e) => e.data.endpoint)).toEqual(["source", "target"]);
    expect(events[3]?.data).toMatchObject({
      previousRevision: before.revision,
      revision: after.revision,
    });
    expect(f.group().changes).toHaveLength(2);
    expect(Object.keys(inline(after) ?? {})).toEqual([link]);
    const failed = f.run([edge("second", "beads/a", "beads/a")], "max");
    expect(failed.status).toBe("failed");
    expect(f.record("beads/a")).toEqual(after);
    f.run([remove()], "delete");
    expect(inline(f.record("beads/a"))).toEqual("*" in owns ? {} : { [link]: [] });
  }
});

it("keeps intermediate source revision chains and reversal facts but one final canonical postimage", () => {
  const f = fixture();
  seed(f);
  const initial = f.record("beads/a");
  const receipt = f.run([
    edge("z"),
    edge("a"),
    patch(1, "z"),
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 3 }],
    },
    patch(0, "z"),
  ]);
  const sourceEvents = f.group().events.filter((e) => e.subject === initial.id);
  expect(sourceEvents).toHaveLength(5);
  let revision = initial.revision;
  for (const e of sourceEvents) {
    expect(e.data.previousRevision).toBe(revision);
    revision = e.data.revision as string;
  }
  expect(revision).toBe(f.record("beads/a").revision);
  expect(
    results(receipt)
      .filter((r) => r.sourceRevision)
      .map((r) => r.sourceRevision),
  ).toEqual(sourceEvents.filter((e) => e.data.ownedLink).map((e) => e.data.revision));
  expect(f.record("links/z").properties).toEqual({ n: 0 });
  expect(
    f
      .group()
      .changes.map((c) => c.resource.id)
      .sort(),
  ).toEqual([`${scope}beads/a`, `${scope}links/a`, `${scope}links/z`]);
  expect(f.group().changes.find((c) => c.resource.id === initial.id)?.resource).toEqual(
    f.record("beads/a"),
  );
});

it("preserves owned no-op versions and provenance with no group or effect position", () => {
  const f = fixture();
  seed(f);
  f.run([{ ...edge(), revisionProvenance: provenance }], "edge");
  const source = f.record("beads/a"),
    original = f.record("links/l"),
    groups = f.owner.inspect().groups.length;
  const receipt = f.run([
    { ...patch(0), revisionProvenance: { actor: { id: "other", basis: "writer-supplied" } } },
  ]);
  expect(receipt.effectPosition).toBeUndefined();
  expect(f.owner.inspect().groups).toHaveLength(groups);
  expect(results(receipt)[0]).toMatchObject({
    resource: original,
    sourceRevision: source.revision,
  });
  expect(f.record("beads/a")).toEqual(source);
  f.run([patch(0), patch(1)], "mixed");
  expect(f.group().events).toHaveLength(2);
});

it("normalizes labeled creation/deletion to final tombstones while retaining intermediate facts", () => {
  const f = fixture();
  const receipt = f.run([
    { ...create(), name: "a" },
    { ...create("b", target), name: "b" },
    { ...edge(), name: "l", source: "@a", target: "@b" },
    { ...patch(1), link: "@l" },
    { ...remove(), link: "@l" },
    { operation: "deleteBead", bead: "@a" },
  ]);
  expect(receipt.status).toBe("completed");
  expect(results(receipt)).toHaveLength(6);
  expect(
    f
      .group()
      .changes.filter((c) => c.operation === "tombstone")
      .map((c) => c.resource.id)
      .sort(),
  ).toEqual([`${scope}beads/a`, `${scope}links/l`]);
  expect(f.owner.inspect().resources).toHaveLength(1);
  expect(
    f
      .group()
      .events.filter((e) => e.subject === `${scope}links/l`)
      .map((e) => e.type),
  ).toEqual(["created", "linked", "linked", "updated", "deleted", "unlinked", "unlinked"]);
});

it("guards the addressed Link or Bead against staged revisions and rolls both Resources back", () => {
  const f = fixture();
  seed(f);
  f.run([edge()], "edge");
  const oldSource = f.record("beads/a"),
    oldLink = f.record("links/l"),
    before = f.owner.inspect();
  for (const [key, tail] of [
    ["link-guard", { ...patch(2), expectedRevision: oldLink.revision }],
    [
      "bead-guard",
      {
        operation: "updateBead",
        bead: "beads/a",
        expectedRevision: oldSource.revision,
        propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
      },
    ],
    ["incident", { operation: "deleteBead", bead: "beads/a" }],
  ] as const) {
    expect(f.run([patch(1), tail], key)).toMatchObject({
      status: "failed",
      problem: { operationIndex: 1 },
    });
    expect(f.owner.inspect().resources).toEqual(before.resources);
    expect(f.owner.inspect().groups).toEqual(before.groups);
  }
  expect(
    f.run(
      [
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
        },
        { ...patch(1), expectedRevision: oldLink.revision },
      ],
      "current-link",
    ).status,
  ).toBe("completed");
});

it("expands owned sets in canonical order, versions shared source per member and persists receipt pages", () => {
  const f = fixture();
  seed(f);
  f.run([edge("z"), edge("a")], "edges");
  const operations = [
    {
      operation: "updateWhere",
      collection: "links",
      selector: "$[?@.properties.n == 0]",
      change: [{ op: "replace", path: "/n", value: 1 }],
      revisionProvenance: provenance,
    },
  ];
  const admission = f.admit(operations);
  if (admission.kind !== "owned") throw new Error("owner");
  const observed = f.owner.executeObserved(admission.claim),
    full = f.owner.receipt("p", observed.receipt.id);
  if (!full) throw new Error("receipt");
  expect(results(full).map((r) => r.count ?? r.resource?.id)).toEqual([
    2,
    `${scope}links/a`,
    `${scope}links/z`,
  ]);
  expect(f.group().events).toHaveLength(4);
  expect(f.group().events[3]?.data.previousRevision).toBe(f.group().events[1]?.data.revision);
  const next = observed.receipt.next;
  if (typeof next !== "string") throw new Error("page");
  const page = f.owner.readReceiptPage("p", next);
  expect(page).toMatchObject({ kind: "page", page: { results: [results(full)[2]], next: null } });
  f.run(
    [{ operation: "deleteWhere", collection: "links", selector: "$[?@.properties.n == 1]" }],
    "delete",
  );
  expect(f.group().events).toHaveLength(8);
  expect(inline(f.record("beads/a"))?.[link]).toEqual([]);
  f.reopen();
  expect(f.owner.readReceiptPage("p", next)).toMatchObject({
    kind: "page",
    page: (page as { page: unknown }).page,
  });
  expect(f.admit(operations)).toMatchObject({ kind: "existing", receipt: full });
});

it("carries native attribution through owned creation, update and both deletion carriers", () => {
  let now = Date.parse("2026-10-13T12:00:00Z");
  const f = fixture({ clock: () => now });
  seed(f);
  for (const [name, operation] of [
    ["create", edge()],
    ["update", patch(1)],
    ["delete", remove()],
  ] as const) {
    now += 1000;
    const expected = {
      committedAt: { state: "present", value: new Date(now).toISOString() },
      agent: { state: "present", value: `agent-${name}` },
      message: { state: "present", value: name },
    };
    const receipt = f.run(
      [{ ...operation, revisionProvenance: { agent: `agent-${name}`, message: name } }],
      name,
    );
    const source = f.record("beads/a"),
      events = f.group().events,
      sourceEvent = events.at(-1);
    if (!sourceEvent) throw new Error("missing source Event");
    const nested = (sourceEvent.data.ownedLink as { link: Record<string, unknown> }).link;
    expect(source.revisionProvenance).toEqual(expected);
    expect(sourceEvent?.data.revisionProvenance).toEqual(expected);
    expect(results(receipt)[0]?.sourceRevision).toBe(source.revision);
    if (name === "delete") {
      expect(nested).toEqual({
        id: `${scope}links/l`,
        type: link,
        revision: events[0]?.data.revision,
      });
      expect(events[0]?.data).not.toHaveProperty("revisionProvenance");
    } else {
      expect(f.record("links/l").revisionProvenance).toEqual(expected);
      expect(nested.revisionProvenance).toEqual(expected);
      expect(events[0]?.data.revisionProvenance).toEqual(expected);
    }
  }
  f.run([edge("a"), edge("z")], "set-seed");
  const before = f.record("beads/a");
  now += 1000;
  const receipt = f.run(
    [
      {
        operation: "deleteWhere",
        collection: "links",
        selector: "$[?@.properties.n == 0]",
        revisionProvenance: { agent: "set-worker", message: "delete-set" },
      },
    ],
    "delete-set",
  );
  const expected = {
    committedAt: { state: "present", value: new Date(now).toISOString() },
    agent: { state: "present", value: "set-worker" },
    message: { state: "present", value: "delete-set" },
  };
  const sourceEvents = f.group().events.filter((event) => event.subject === before.id);
  expect(sourceEvents).toHaveLength(2);
  expect(results(receipt).map((result) => result.outcome)).toEqual([
    "matched",
    "deleted",
    "deleted",
  ]);
  for (const [index, event] of sourceEvents.entries()) {
    expect(event.data.revisionProvenance).toEqual(expected);
    expect(event.data.previousRevision).toBe(
      index === 0 ? before.revision : sourceEvents[index - 1]?.data.revision,
    );
    expect(results(receipt)[index + 1]?.sourceRevision).toBe(event.data.revision);
    expect((event.data.ownedLink as { link: unknown }).link).not.toHaveProperty(
      "revisionProvenance",
    );
  }
  expect(f.record("beads/a").revisionProvenance).toEqual(expected);
  expect(inline(f.record("beads/a"))?.[link]).toEqual([]);
});

it("preserves mixed set no-ops and each staged owned source version across later operations", () => {
  const f = fixture();
  seed(f);
  f.run([{ ...edge("a"), properties: { n: 1 } }, edge("z")], "edges");
  const initial = f.record("beads/a"),
    unchanged = f.record("links/a");
  const receipt = f.run([
    {
      operation: "updateWhere",
      collection: "links",
      selector: "$[?@.properties.n >= 0]",
      change: [{ op: "replace", path: "/n", value: 1 }],
    },
    {
      operation: "updateWhere",
      collection: "links",
      selector: "$[?@.properties.n == 1]",
      change: [{ op: "replace", path: "/n", value: 2 }],
      cardinality: { min: 2, max: 2 },
    },
    patch(3, "a"),
  ]);
  const entries = results(receipt),
    events = f.group().events,
    sourceEvents = events.filter((event) => event.subject === initial.id);
  expect(
    entries.map((entry) => [
      entry.operationIndex,
      entry.outcome,
      entry.count ?? entry.resource?.id,
    ]),
  ).toEqual([
    [0, "matched", 2],
    [0, "updated", `${scope}links/a`],
    [0, "updated", `${scope}links/z`],
    [1, "matched", 2],
    [1, "updated", `${scope}links/a`],
    [1, "updated", `${scope}links/z`],
    [2, "updated", `${scope}links/a`],
  ]);
  expect(entries[1]?.resource).toEqual(unchanged);
  expect(entries[1]?.sourceRevision).toBe(initial.revision);
  expect(events).toHaveLength(8);
  expect(sourceEvents).toHaveLength(4);
  expect(
    events.filter((event) => event.subject !== initial.id).map((event) => event.subject),
  ).toEqual([`${scope}links/z`, `${scope}links/a`, `${scope}links/z`, `${scope}links/a`]);
  for (const [index, receiptIndex] of [2, 4, 5, 6].entries()) {
    expect(entries[receiptIndex]?.sourceRevision).toBe(sourceEvents[index]?.data.revision);
    expect(sourceEvents[index]?.data.previousRevision).toBe(
      index === 0 ? initial.revision : sourceEvents[index - 1]?.data.revision,
    );
  }
  expect(
    entries.filter((entry) => entry.resource).map((entry) => entry.resource?.properties.n),
  ).toEqual([1, 1, 2, 2, 3]);
  expect(f.record("links/a").properties.n).toBe(3);
  expect(f.record("links/z").properties.n).toBe(2);
  expect(f.record("beads/a").revision).toBe(sourceEvents.at(-1)?.data.revision);
  expect(f.group().changes).toHaveLength(3);
  for (const change of f.group().changes)
    expect(change.resource).toEqual(f.record(change.resource.id.slice(scope.length)));
});

it("charges the source fact to the same total Event cap and retains atomic failure across retry", () => {
  const f = fixture();
  seed(f);
  const before = f.owner.inspect();
  const original = batch.evaluateTransaction;
  const spy = vi
    .spyOn(batch, "evaluateTransaction")
    .mockImplementation((normalized, tx, options, ...args) =>
      original(normalized, tx, { ...options, maximumInducedEvents: 3 }, ...args),
    );
  const failed = f.run([edge()]);
  expect(failed).toMatchObject({
    status: "failed",
    problem: { code: "limit-exceeded", limit: "transaction.inducedEvents" },
  });
  expect(failed.problem).not.toHaveProperty("operationIndex");
  expect(f.owner.inspect().resources).toEqual(before.resources);
  expect(f.owner.inspect().groups).toEqual(before.groups);
  spy.mockRestore();
  f.run([edge()], "later");
  f.reopen();
  expect(f.admit([edge()])).toMatchObject({ kind: "existing", receipt: failed });
});

it("uses owned visibility closure for selection and refuses source writes without partial effects", () => {
  const f = fixture();
  seed(f);
  f.run([edge()], "edge");
  const before = f.owner.inspect();
  const original = batch.evaluateTransaction;
  const hidden = vi
    .spyOn(batch, "evaluateTransaction")
    .mockImplementation((normalized, tx, options, ...args) =>
      original(
        normalized,
        tx,
        { ...options, policy: { ...options.policy, canRead: (r) => r.id !== `${scope}beads/b` } },
        ...args,
      ),
    );
  const receipt = f.run(
    [
      {
        operation: "updateWhere",
        collection: "beads",
        selector: "$[?@.properties.n == 0]",
        change: [{ op: "replace", path: "/n", value: 1 }],
      },
    ],
    "hidden",
  );
  expect(results(receipt)).toEqual([{ operationIndex: 0, outcome: "matched", count: 0 }]);
  expect(f.owner.inspect().resources).toEqual(before.resources);
  hidden.mockRestore();
  vi.spyOn(evaluator, "evaluateResourceMutation").mockImplementation((tx, mutation, options) =>
    evaluatorOriginal(tx, mutation, {
      ...options,
      policy: { ...options.policy, canWrite: (r) => r.id !== `${scope}beads/a` },
    }),
  );
  expect(f.run([patch(1)], "denied")).toMatchObject({
    status: "failed",
    problem: { code: "forbidden" },
  });
  expect(f.owner.inspect().resources).toEqual(before.resources);
  expect(
    f.run(
      [
        {
          operation: "updateWhere",
          collection: "links",
          selector: "$[?@.properties.n == 0]",
          cardinality: { min: 1, max: 1 },
          change: [{ op: "replace", path: "/n", value: 1 }],
        },
      ],
      "selected-denied",
    ),
  ).toMatchObject({ status: "failed", problem: { code: "forbidden" } });
  expect(f.owner.inspect().resources).toEqual(before.resources);
});
const evaluatorOriginal = evaluator.evaluateResourceMutation;

it("shares singleton/batch replay without new source versions after same-version restart", () => {
  const f = fixture();
  seed(f);
  const admitted = f.admit([edge()], "edge", true);
  if (admitted.kind !== "owned") throw new Error("owner");
  const receipt = f.owner.execute(admitted.claim),
    state = f.owner.inspect();
  f.reopen();
  expect(f.admit([edge()], "edge")).toMatchObject({ kind: "existing", receipt });
  expect(f.owner.inspect().resources).toEqual(state.resources);
  expect(f.owner.inspect().groups).toEqual(state.groups);
});

it("withholds transitive cyclic owned closure from visible set cardinality", () => {
  const f = fixture();
  f.run(
    [
      create(),
      create("b"),
      create("c", target),
      edge("ab", "beads/a", "beads/b"),
      edge("ba", "beads/b", "beads/a"),
      edge("ac", "beads/a", "beads/c"),
    ],
    "seed",
  );
  const before = f.owner.inspect(),
    original = batch.evaluateTransaction;
  vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...args) =>
    original(
      normalized,
      tx,
      { ...options, policy: { ...options.policy, canRead: (r) => r.id !== `${scope}beads/c` } },
      ...args,
    ),
  );
  const receipt = f.run([
    {
      operation: "deleteWhere",
      collection: "links",
      selector: "$[?@.properties.n == 0]",
      cardinality: { min: 0, max: 0 },
    },
  ]);
  expect(results(receipt)).toEqual([{ operationIndex: 0, outcome: "matched", count: 0 }]);
  expect(f.owner.inspect().resources).toEqual(before.resources);
  expect(f.owner.inspect().groups).toEqual(before.groups);
});

it.each(["after-effects", "after-terminal"] as const)(
  "recovers a killed owned transition at %s without partial source, Link or page facts",
  (stage) => {
    const f = fixture();
    seed(f);
    const before = f.owner.inspect();
    f.owner.close();
    const storeModule = new URL("../dist/transaction-store.js", import.meta.url).href;
    const batchModule = new URL("../dist/transaction-batch.js", import.meta.url).href;
    const script = `import {openTransactionStore} from ${JSON.stringify(storeModule)};
    import {prepareTransaction} from ${JSON.stringify(batchModule)};
    const owner=openTransactionStore({...${JSON.stringify({ ...f.options, create: false })},fault(stage){if(stage===${JSON.stringify(stage)})process.kill(process.pid,"SIGKILL")}});
    const admitted=owner.admit("p","crash",prepareTransaction(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify({ operations: [edge()] }))}));
    if(admitted.kind!=="owned")throw Error("owner");owner.execute(admitted.claim);throw Error("did not kill");`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 5000,
    });
    expect(child.error).toBeUndefined();
    expect(child.signal, child.stderr).toBe("SIGKILL");
    f.reopen();
    expect(f.owner.inspect().resources).toEqual(before.resources);
    expect(f.owner.inspect().groups).toEqual(before.groups);
    expect(f.owner.inspect().identities).toEqual(before.identities);
    expect(f.run([edge()], "crash").status).toBe("completed");
    expect(inline(f.record("beads/a"))?.[link]).toEqual([f.record("links/l")]);
  },
);

it("serves complete compiled owned records and atomically retains inherited-schema failure over actual HTTP", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-owned-http-"));
  const parent = `${scope}types/link-base`,
    schema = `${scope}schemas/link-properties`;
  const descriptorInputs = descriptors().map((d) =>
    d.id === link ? { ...d, conformsTo: [parent] } : d,
  );
  descriptorInputs.push(
    parseTypeDescriptor({
      ...descriptors()[2],
      id: parent,
      name: "Link base",
      propertiesSchema: schema,
    }),
  );
  const options = {
    directory,
    scope,
    create: true,
    port: 0,
    credentials: [{ token: "a".repeat(32), principal: "p", canMutate: true }],
    artifacts: {
      limits: CONTRACT_ARTIFACT_CEILINGS,
      descriptors: descriptorInputs.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
      schemas: [
        {
          retrievalUri: schema,
          utf8: JSON.stringify({
            $id: schema,
            type: "object",
            required: ["n"],
            properties: { n: { type: "integer", minimum: 0 } },
          }),
        },
      ],
    },
  };
  const emitted = (await import(
    new URL("../dist/transaction-runtime.js", import.meta.url).href
  )) as typeof import("./transaction-runtime.js");
  let runtime = await emitted.startTransactionRuntime(options);
  async function request(route: string, operations?: unknown[], key?: string) {
    const response = await fetch(new URL(new URL(route, scope).pathname, runtime.listenUrl), {
      method: operations ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${"a".repeat(32)}`,
        ...(operations
          ? { "content-type": "application/json", "idempotency-key": key ?? "key" }
          : {}),
      },
      ...(operations ? { body: JSON.stringify({ operations }) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  try {
    expect(await request(bead)).toMatchObject({
      status: 200,
      body: { ownsOutgoing: { [link]: { max: 4 } } },
    });
    const created = await request(
      runtime.targets.batch,
      [create(), create("b", target), edge()],
      "seed",
    );
    expect(created).toMatchObject({ status: 200, body: { status: "completed" } });
    const owner = await request("beads/a"),
      firstClass = await request("links/l");
    expect(owner).toMatchObject({
      status: 200,
      body: { ownedLinks: { [link]: [firstClass.body] } },
    });
    const failed = await request(runtime.targets.batch, [patch(1), patch(-1)], "failed");
    expect(failed).toMatchObject({
      status: 200,
      body: { status: "failed", problem: { code: "validation-failed", operationIndex: 1 } },
    });
    expect(await request("beads/a")).toEqual(owner);
    expect(await request("links/l")).toEqual(firstClass);
    await request(runtime.targets.batch, [patch(2)], "later");
    await runtime.close();
    runtime = await emitted.startTransactionRuntime({ ...options, create: false });
    expect(await request(runtime.targets.batch, [patch(1), patch(-1)], "failed")).toEqual(failed);
    expect(await request((failed.body as { id: string }).id)).toEqual(failed);
    const currentLink = await request("links/l");
    expect(await request("beads/a")).toMatchObject({
      status: 200,
      body: { ownedLinks: { [link]: [currentLink.body] } },
    });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("observes 128/129 real Events under a lowered evaluator cap within the 32-match owner", () => {
  const f = fixture({ types: descriptors({ [link]: { max: 32 } }), receiptMaximumItems: 32 });
  // One Link per source avoids testing unrelated high-fanout closure cost.
  // Every body stays small; the boundary is a fact count, not a byte allowance.
  for (let start = 0; start < 33; start += 16) {
    const operations: unknown[] = [];
    for (let index = start; index < Math.min(start + 16, 33); index++) {
      const id = `owner${index}`;
      operations.push(create(id), {
        ...edge(`edge${index}`, `beads/${id}`, `beads/${id}`),
        properties: { n: index === 32 ? 1 : 0 },
      });
    }
    f.run(operations, `seed${start}`);
  }
  // The former 64-match/256-Event boundary is historical. This lower evaluator
  // bound observes the same retained Event-count refusal without overriding M.
  const evaluate = batch.evaluateTransaction;
  vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
    evaluate(normalized, tx, { ...options, maximumInducedEvents: 128 }, ...rest),
  );
  const before = f.owner.inspect();
  const all = [
    {
      operation: "updateBead",
      bead: "beads/owner32",
      propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
    },
    { operation: "deleteWhere", collection: "links", selector: "$[?@.properties.n == 0]" },
  ];
  const failed = f.run(all, "too-many");
  expect(failed).toMatchObject({
    status: "failed",
    problem: {
      status: 413,
      code: "limit-exceeded",
      retry: "never",
      limit: "transaction.inducedEvents",
    },
  });
  expect(failed.problem).not.toHaveProperty("operationIndex");
  expect(f.owner.inspect().resources).toEqual(before.resources);
  expect(f.owner.inspect().groups).toEqual(before.groups);
  const exact = [all[1]];
  const passed = f.run(exact, "exact");
  expect(passed.status).toBe("completed");
  expect(results(passed)).toHaveLength(33);
  expect(f.group().events).toHaveLength(128);
  expect(f.group().events.at(-1)?.ordinal).toBe(127);
  expect(f.group().changes).toHaveLength(64);
  expect(f.admit(all, "too-many")).toEqual({ kind: "existing", receipt: failed });
  expect(f.admit(exact, "too-many")).toEqual({ kind: "conflict" });
  expect(f.run(all, "fresh-after-delete").status).toBe("completed");
  f.reopen();
  expect(f.admit(all, "too-many")).toEqual({ kind: "existing", receipt: failed });
}, 30000);
