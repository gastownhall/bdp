import { ProtocolArtifactValidationError } from "@bdp/protocol";
import { describe, expect, it } from "vitest";

import {
  type AbsoluteHttpUrl,
  createPortableReferenceFixturePort,
  createReferenceFixturePort,
} from "./index.js";

const scope = "https://scope.example/acme/" as AbsoluteHttpUrl;
const options = { signal: new AbortController().signal };

describe("reference fixture Scope port", () => {
  it("matches Beads and Types by their full canonical identity", async () => {
    const port = createReferenceFixturePort(scope);

    await expect(
      port.perform(
        { kind: "resource", resource: "bead", id: `${scope}beads/nested/demo-a` },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
    await expect(
      port.perform(
        { kind: "resource", resource: "type", id: "https://other.example/types/task" },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
    await expect(
      port.perform(
        { kind: "resource", resource: "type", id: "https://work.example/types/task" },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: { id: "https://work.example/types/task", name: "Task" },
    });
  });

  it("returns resource-not-found for missing properties and incident-Link views", async () => {
    const port = createReferenceFixturePort(scope);

    await expect(
      port.perform({ kind: "properties", resource: "bead", id: `${scope}beads/missing` }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
    await expect(
      port.perform({ kind: "properties", resource: "link", id: `${scope}links/missing` }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
    await expect(
      port.perform(
        { kind: "bead-links", bead: `${scope}beads/missing`, direction: "both" },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", status: 404 },
    });
  });

  it("serves a deeply immutable built-in fixture snapshot", async () => {
    const port = createReferenceFixturePort(scope);
    const beadsResult = await port.perform({ kind: "collection", collection: "beads" }, options);
    const linksResult = await port.perform({ kind: "collection", collection: "links" }, options);
    if (beadsResult.kind !== "success" || linksResult.kind !== "success")
      throw new Error("built-in fixture collections must succeed");
    const beads = beadsResult.body;
    const links = linksResult.body;
    const beadItems = beads.items as readonly { readonly properties: unknown }[];
    const linkItems = links.items as readonly {
      readonly source: unknown;
      readonly target: unknown;
    }[];

    expect(Object.isFrozen(beads)).toBe(true);
    expect(Object.isFrozen(beads.items)).toBe(true);
    expect(Object.isFrozen(beadItems[0])).toBe(true);
    expect(Object.isFrozen(beadItems[0]?.properties)).toBe(true);
    expect(Object.isFrozen(links.items)).toBe(true);
    expect(Object.isFrozen(linkItems[0])).toBe(true);
    expect(Object.isFrozen(linkItems[0]?.source)).toBe(true);
    expect(Object.isFrozen(linkItems[0]?.target)).toBe(true);
  });

  it("serves an explicitly supplied portable fixture instead of the built-in copy", async () => {
    const task = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    };
    const port = createPortableReferenceFixturePort(scope, {
      types: [task],
      typeDescriptors: [{ ...task, conformsTo: [] }],
      beads: [
        {
          localId: "beads/reviewed",
          type: task.id,
          revision: "7",
          properties: { title: "Reviewed fixture", status: "open" },
        },
      ],
      links: [],
    });

    await expect(
      port.perform({ kind: "collection", collection: "beads" }, options),
    ).resolves.toEqual({
      kind: "success",
      body: {
        items: [
          {
            id: `${scope}beads/reviewed`,
            type: task.id,
            revision: "7",
            properties: { title: "Reviewed fixture", status: "open" },
          },
        ],
        next: null,
      },
    });
  });

  it("combines structural predicates over declared and effective Types", async () => {
    const workItem = {
      id: "https://work.example/types/work-item",
      name: "Work Item",
      describes: "bead",
    } as const;
    const task = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    } as const;
    const decision = {
      id: "https://work.example/types/decision",
      name: "Decision",
      describes: "bead",
    } as const;
    const blocks = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
    } as const;
    const port = createPortableReferenceFixturePort(scope, {
      types: [workItem, task, decision, blocks],
      typeDescriptors: [
        { ...workItem, conformsTo: [] },
        { ...task, conformsTo: [workItem.id] },
        { ...decision, conformsTo: [] },
        {
          ...blocks,
          conformsTo: [],
          source: { conformsTo: [] },
          target: { conformsTo: [] },
        },
      ],
      beads: [
        { localId: "beads/a", type: task.id, revision: "1", properties: { title: "A" } },
        {
          localId: "beads/b",
          type: decision.id,
          revision: "1",
          properties: { title: "B" },
        },
      ],
      links: [
        {
          localId: "links/a-b",
          type: blocks.id,
          revision: "1",
          source: "beads/a",
          target: "beads/b",
          properties: {},
        },
      ],
    });

    await expect(
      port.perform({ kind: "collection", collection: "beads", conformsTo: workItem.id }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ properties: { title: "A" } }], next: null },
    });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "beads",
          type: decision.id,
          conformsTo: workItem.id,
        },
        options,
      ),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "links",
          type: blocks.id,
          source: `${scope}beads/a`,
          endpoint: `${scope}beads/b`,
        },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: { items: [{ id: `${scope}links/a-b` }], next: null },
    });
    await expect(
      port.perform(
        {
          kind: "collection",
          collection: "links",
          conformsTo: workItem.id,
        },
        options,
      ),
    ).resolves.toEqual({ kind: "success", body: { items: [], next: null } });
  });

  it("owns a bounded immutable snapshot of portable fixture properties", async () => {
    const task = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    } as const;
    const properties = { title: "Original", metadata: { labels: ["reviewed"] } };
    const fixture = {
      types: [task],
      typeDescriptors: [{ ...task, conformsTo: [] }],
      beads: [
        {
          localId: "beads/reviewed",
          type: task.id,
          revision: "1",
          properties,
        },
      ],
      links: [],
    };
    const port = createPortableReferenceFixturePort(scope, fixture);

    properties.title = "Mutated";
    properties.metadata.labels.push("late");
    const resultOutcome = await port.perform(
      { kind: "resource", resource: "bead", id: `${scope}beads/reviewed` },
      options,
    );
    const collectionOutcome = await port.perform(
      { kind: "collection", collection: "beads" },
      options,
    );
    if (resultOutcome.kind !== "success" || collectionOutcome.kind !== "success")
      throw new Error("portable fixture reads must succeed");
    const result = resultOutcome.body;
    const collection = collectionOutcome.body;

    expect(result).toMatchObject({
      properties: { title: "Original", metadata: { labels: ["reviewed"] } },
    });
    if (!("properties" in result)) throw new Error("expected a Bead record");
    const resultProperties = result.properties as { readonly metadata: unknown };
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(resultProperties)).toBe(true);
    expect(Object.isFrozen(resultProperties.metadata)).toBe(true);
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.items)).toBe(true);
    expect((collection.items as readonly unknown[])[0]).toBe(result);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      createPortableReferenceFixturePort(scope, {
        ...fixture,
        beads: [{ ...fixture.beads[0], properties: cyclic }],
      }),
    ).toThrow("must not contain a cycle");
  });

  it("serves complete descriptors while matching an independently ordered inventory", async () => {
    const task = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    } as const;
    const blocks = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
    } as const;
    const dependency = {
      id: "https://work.example/types/dependency",
      name: "Dependency",
      describes: "link",
    } as const;
    const descriptor = {
      ...blocks,
      description: "A blocking relationship",
      conformsTo: ["https://work.example/types/dependency"],
      propertiesSchema: "https://work.example/schemas/blocks.json",
      source: { conformsTo: [task.id] },
      target: { conformsTo: [] },
    };
    const port = createPortableReferenceFixturePort(scope, {
      types: [task, blocks, dependency],
      typeDescriptors: [
        descriptor,
        { ...task, conformsTo: [] },
        {
          ...dependency,
          conformsTo: [],
          source: { conformsTo: [] },
          target: { conformsTo: [] },
        },
      ],
      beads: [
        {
          localId: "beads/projects/alpha/task-42",
          type: task.id,
          revision: "1",
          properties: {},
        },
      ],
      links: [],
    });

    await expect(
      port.perform({ kind: "resource", resource: "type", id: blocks.id }, options),
    ).resolves.toEqual({ kind: "success", body: descriptor });
    await expect(
      port.perform(
        { kind: "resource", resource: "bead", id: `${scope}beads/projects/alpha/task-42` },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      body: { id: `${scope}beads/projects/alpha/task-42` },
    });
  });

  it("rejects a supplied fixture whose records escape Scope or reference unknown Types", () => {
    const type = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    };
    const fixture = (localId: string, typeId: string) => ({
      types: [type],
      typeDescriptors: [{ ...type, conformsTo: [] }],
      beads: [
        {
          localId,
          type: typeId,
          revision: "1",
          properties: {},
        },
      ],
      links: [],
    });
    expect(() =>
      createPortableReferenceFixturePort(scope, fixture("../outside", type.id)),
    ).toThrow();
    try {
      createPortableReferenceFixturePort(scope, fixture("../outside", type.id));
      throw new Error("expected invalid fixture ID");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolArtifactValidationError);
      expect((error as Error).cause).toBeInstanceOf(ProtocolArtifactValidationError);
    }
    expect(() =>
      createPortableReferenceFixturePort(scope, fixture("links/not-a-bead", type.id)),
    ).toThrow("must begin with beads/");
    expect(() => createPortableReferenceFixturePort(scope, fixture("beads/..", type.id))).toThrow(
      "forbidden segment",
    );
    expect(() =>
      createPortableReferenceFixturePort(
        scope,
        fixture("beads/demo-a", "https://work.example/types/unknown"),
      ),
    ).toThrow("must name a declared bead Type");
    expect(() =>
      createPortableReferenceFixturePort(scope, {
        ...fixture("beads/demo-a", type.id),
        typeDescriptors: [{ ...type, conformsTo: ["https://work.example/types/missing-parent"] }],
      }),
    ).toThrow(ProtocolArtifactValidationError);
  });

  it("validates Link IDs and endpoint references as canonical IDs of the expected kind", () => {
    const task = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    } as const;
    const blocks = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
    } as const;
    const fixture = (localId: string, source = "beads/a") => ({
      types: [task, blocks],
      typeDescriptors: [
        { ...task, conformsTo: [] },
        {
          ...blocks,
          conformsTo: [],
          source: { conformsTo: [] },
          target: { conformsTo: [] },
        },
      ],
      beads: [
        { localId: "beads/a", type: task.id, revision: "1", properties: {} },
        { localId: "beads/b", type: task.id, revision: "1", properties: {} },
      ],
      links: [
        {
          localId,
          type: blocks.id,
          revision: "1",
          source,
          target: "beads/b",
          properties: {},
        },
      ],
    });

    expect(() => createPortableReferenceFixturePort(scope, fixture("beads/not-a-link"))).toThrow(
      "must begin with links/",
    );
    expect(() =>
      createPortableReferenceFixturePort(scope, fixture("links/blocks", "links/a")),
    ).toThrow("must begin with beads/");
  });

  it("preserves exact external endpoint identities in either Link orientation", async () => {
    const task = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    } as const;
    const blocks = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
    } as const;
    const external = "external:beads:mol-run-assignee";
    const port = createPortableReferenceFixturePort(scope, {
      types: [task, blocks],
      typeDescriptors: [
        { ...task, conformsTo: [] },
        {
          ...blocks,
          conformsTo: [],
          source: { conformsTo: [] },
          target: { conformsTo: [] },
        },
      ],
      beads: [{ localId: "beads/a", type: task.id, revision: "1", properties: {} }],
      links: [
        {
          localId: "links/outbound",
          type: blocks.id,
          revision: "1",
          source: "beads/a",
          target: external,
          properties: {},
        },
        {
          localId: "links/inbound",
          type: blocks.id,
          revision: "1",
          source: external,
          target: "beads/a",
          properties: {},
        },
      ],
    });

    await expect(
      port.perform({ kind: "collection", collection: "links", endpoint: external }, options),
    ).resolves.toEqual({
      kind: "success",
      body: {
        items: [
          expect.objectContaining({
            id: `${scope}links/outbound`,
            target: external,
          }),
          expect.objectContaining({
            id: `${scope}links/inbound`,
            source: external,
          }),
        ],
        next: null,
      },
    });
  });

  it.each([
    ["uppercase scheme", "HTTPS://scope.example/acme/beads/alias"],
    ["default-port alias", "https://scope.example:443/acme/beads/alias"],
    ["percent-encoded Scope path", "https://scope.example/%61cme/beads/alias"],
  ] as const)("rejects a canonical local Scope alias using %s", (_label, external) => {
    expect(() =>
      createPortableReferenceFixturePort(scope, externalEndpointFixture(external)),
    ).toThrow("in-Scope Link endpoint");
  });

  it.each(["javascript:alert(1)", "file:///tmp/private-bead"])(
    "rejects the unsafe external endpoint identity %s",
    (external) => {
      expect(() =>
        createPortableReferenceFixturePort(scope, externalEndpointFixture(external)),
      ).toThrow("safe canonical absolute URI");
    },
  );

  it.each(["source", "target"] as const)(
    "accepts a canonical external HTTP endpoint in the %s orientation",
    async (orientation) => {
      const external = "https://outside.example/beads/reviewed";
      const port = createPortableReferenceFixturePort(
        scope,
        externalEndpointFixture(external, orientation),
      );

      await expect(
        port.perform({ kind: "collection", collection: "links", endpoint: external }, options),
      ).resolves.toMatchObject({
        kind: "success",
        body: {
          items: [orientation === "source" ? { source: external } : { target: external }],
          next: null,
        },
      });
    },
  );

  it("round-trips the optional pin from the object authoring form", async () => {
    const external = "urn:external:cited";
    const port = createPortableReferenceFixturePort(
      scope,
      externalEndpointFixture({ uri: external, revision: "cited-1" }),
    );
    await expect(
      port.perform({ kind: "collection", collection: "links", endpoint: external }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [
          {
            target: { uri: external, revision: "cited-1" },
          },
        ],
        next: null,
      },
    });
  });

  it("round-trips a pin on an in-Scope fixture endpoint", async () => {
    const port = createPortableReferenceFixturePort(
      scope,
      externalEndpointFixture("urn:external:bare", "target", {
        uri: "beads/a",
        revision: "pinned-3",
      }),
    );
    await expect(
      port.perform({ kind: "collection", collection: "links" }, options),
    ).resolves.toMatchObject({
      kind: "success",
      body: {
        items: [{ source: { uri: `${scope}beads/a`, revision: "pinned-3" } }],
        next: null,
      },
    });
  });

  it("rejects an endpoint object with members beyond id and revision", () => {
    expect(() =>
      createPortableReferenceFixturePort(
        scope,
        externalEndpointFixture({
          uri: "urn:external:cited",
          revision: "cited-1",
          extra: true,
        } as never),
      ),
    ).toThrow();
  });

  it("rejects an empty pin", () => {
    expect(() =>
      createPortableReferenceFixturePort(
        scope,
        externalEndpointFixture({ uri: "urn:external:cited", revision: "" }),
      ),
    ).toThrow("must be a non-empty string");
  });

  it("serves the owned-Links plane: declared-empty entries, ordering, bound, and properties-view exclusion", async () => {
    const decision = {
      id: "https://work.example/types/decision",
      name: "Decision",
      describes: "bead",
    } as const;
    const cites = {
      id: "https://work.example/types/cites",
      name: "Cites",
      describes: "link",
    } as const;
    const base = {
      types: [decision, cites],
      typeDescriptors: [
        {
          ...decision,
          conformsTo: [],
          ownsOutgoing: { [cites.id]: { label: "cites", max: 2 } },
        },
        { ...cites, conformsTo: [], source: { conformsTo: [] }, target: { conformsTo: [] } },
      ],
      beads: [
        { localId: "beads/d", type: decision.id, revision: "1", properties: { title: "D" } },
        { localId: "beads/e", type: decision.id, revision: "1", properties: { title: "E" } },
      ],
      links: [
        {
          localId: "links/one",
          type: cites.id,
          revision: "1",
          source: "beads/d",
          target: "beads/e",
          properties: {},
        },
        {
          localId: "links/two",
          type: cites.id,
          revision: "1",
          source: "beads/d",
          target: { uri: "urn:external:w", revision: "w-9" },
          properties: {},
        },
      ],
    };
    const port = createPortableReferenceFixturePort(scope, base);
    const beads = await port.perform({ kind: "collection", collection: "beads" }, options);
    if (beads.kind !== "success") throw new Error("beads collection must succeed");
    const [d, e] = beads.body.items as readonly {
      readonly ownedLinks?: Readonly<Record<string, readonly unknown[]>>;
      readonly properties: unknown;
    }[];
    // Complete owned Link records in ascending code-unit id order; the pin
    // survives; the second owning bead gets its declared entry even with
    // zero owned Links.
    expect(d?.ownedLinks).toEqual({
      [cites.id]: [
        {
          id: `${scope}links/one`,
          type: cites.id,
          revision: "1",
          source: `${scope}beads/d`,
          target: `${scope}beads/e`,
          properties: {},
        },
        {
          id: `${scope}links/two`,
          type: cites.id,
          revision: "1",
          source: `${scope}beads/d`,
          target: { uri: "urn:external:w", revision: "w-9" },
          properties: {},
        },
      ],
    });
    expect(e?.ownedLinks).toEqual({ [cites.id]: [] });
    // The properties view stays authored JSON alone.
    await expect(
      port.perform({ kind: "properties", resource: "bead", id: `${scope}beads/d` }, options),
    ).resolves.toEqual({ kind: "success", body: { title: "D" } });
    // The declared bound is enforced.
    expect(() =>
      createPortableReferenceFixturePort(scope, {
        ...base,
        links: [
          ...base.links,
          {
            localId: "links/three",
            type: cites.id,
            revision: "1",
            source: "beads/d",
            target: "beads/e",
            properties: {},
          },
        ],
      }),
    ).toThrow("exceed the declared bound");
  });

  it("hardens the disclosure loader: shapes, duplicates, and live overlap all refuse", () => {
    const base = {
      types: [{ id: "https://work.example/types/task", name: "Task", describes: "bead" }],
      typeDescriptors: [
        { id: "https://work.example/types/task", name: "Task", describes: "bead", conformsTo: [] },
      ],
      beads: [
        {
          localId: "beads/live",
          type: "https://work.example/types/task",
          revision: "1",
          properties: {},
        },
      ],
      links: [],
    };
    const withDisclosures = (disclosures: unknown) => () =>
      createPortableReferenceFixturePort(scope, { ...base, disclosures });
    // String-form archivedAt is a valid Reference; junk shapes are not.
    expect(
      withDisclosures([
        { localId: "beads/gone", code: "resource-pruned", archivedAt: "urn:archive:relic" },
      ]),
    ).not.toThrow();
    expect(
      withDisclosures([{ localId: "beads/gone", code: "resource-pruned", archivedAt: {} }]),
    ).toThrow();
    expect(
      withDisclosures([
        { localId: "beads/gone", code: "resource-pruned", archivedAt: { banana: 42 } },
      ]),
    ).toThrow();
    // Duplicates and live overlap refuse.
    expect(
      withDisclosures([
        { localId: "beads/gone", code: "resource-erased" },
        { localId: "beads/gone", code: "resource-pruned" },
      ]),
    ).toThrow("duplicates");
    expect(withDisclosures([{ localId: "beads/live", code: "resource-erased" }])).toThrow(
      "gone or live",
    );
    // Unknown codes and erased-with-pointer refuse.
    expect(withDisclosures([{ localId: "beads/gone", code: "cursor-expired" }])).toThrow();
    expect(
      withDisclosures([
        { localId: "beads/gone", code: "resource-erased", archivedAt: "urn:archive:x" },
      ]),
    ).toThrow("condition-specific");
  });

  it("discloses across record, properties, bead-links, and Link subjects", async () => {
    const port = createPortableReferenceFixturePort(scope, {
      types: [
        { id: "https://work.example/types/task", name: "Task", describes: "bead" },
        { id: "https://work.example/types/blocks", name: "Blocks", describes: "link" },
      ],
      typeDescriptors: [
        { id: "https://work.example/types/task", name: "Task", describes: "bead", conformsTo: [] },
        {
          id: "https://work.example/types/blocks",
          name: "Blocks",
          describes: "link",
          conformsTo: [],
          source: { conformsTo: [] },
          target: { conformsTo: [] },
        },
      ],
      beads: [],
      links: [],
      disclosures: [
        {
          localId: "beads/gone",
          code: "resource-pruned",
          archivedAt: { uri: "urn:archive:gone", revision: "arch-1" },
        },
        { localId: "links/gone-edge", code: "resource-erased" },
      ],
    });
    const pruned = { code: "resource-pruned", status: 410 };
    await expect(
      port.perform({ kind: "resource", resource: "bead", id: `${scope}beads/gone` }, options),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { ...pruned, archivedAt: { uri: "urn:archive:gone", revision: "arch-1" } },
    });
    await expect(
      port.perform({ kind: "properties", resource: "bead", id: `${scope}beads/gone` }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: pruned });
    await expect(
      port.perform({ kind: "bead-links", bead: `${scope}beads/gone`, direction: "both" }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: pruned });
    await expect(
      port.perform({ kind: "resource", resource: "link", id: `${scope}links/gone-edge` }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: { code: "resource-erased" } });
    // A cross-kind request never leaks the disclosure: the wrong plane at
    // the same address answers the uniform not-found.
    const notFound = { code: "resource-not-found", status: 404 };
    await expect(
      port.perform({ kind: "resource", resource: "bead", id: `${scope}links/gone-edge` }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: notFound });
    await expect(
      port.perform({ kind: "resource", resource: "link", id: `${scope}beads/gone` }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: notFound });
    await expect(
      port.perform(
        { kind: "properties", resource: "bead", id: `${scope}links/gone-edge` },
        options,
      ),
    ).resolves.toMatchObject({ kind: "problem", problem: notFound });
    await expect(
      port.perform({ kind: "properties", resource: "link", id: `${scope}beads/gone` }, options),
    ).resolves.toMatchObject({ kind: "problem", problem: notFound });
    await expect(
      port.perform(
        { kind: "bead-links", bead: `${scope}links/gone-edge`, direction: "both" },
        options,
      ),
    ).resolves.toMatchObject({ kind: "problem", problem: notFound });
    // The correct plane still discloses, properties included.
    await expect(
      port.perform(
        { kind: "properties", resource: "link", id: `${scope}links/gone-edge` },
        options,
      ),
    ).resolves.toMatchObject({
      kind: "problem",
      problem: { code: "resource-erased", status: 410 },
    });
  });

  it("rejects fixture Links with two external endpoints", () => {
    const blocks = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
    } as const;
    expect(() =>
      createPortableReferenceFixturePort(scope, {
        types: [blocks],
        typeDescriptors: [
          {
            ...blocks,
            conformsTo: [],
            source: { conformsTo: [] },
            target: { conformsTo: [] },
          },
        ],
        beads: [],
        links: [
          {
            localId: "links/external-only",
            type: blocks.id,
            revision: "1",
            source: "external:alpha:one",
            target: "external:beta:two",
            properties: {},
          },
        ],
      }),
    ).toThrow("at least one local Bead endpoint");
  });
});

function externalEndpointFixture(
  external: string | { uri: string; revision: string },
  orientation: "source" | "target" = "target",
  local: string | { uri: string; revision: string } = "beads/a",
) {
  const task = {
    id: "https://work.example/types/task",
    name: "Task",
    describes: "bead",
  } as const;
  const blocks = {
    id: "https://work.example/types/blocks",
    name: "Blocks",
    describes: "link",
  } as const;
  return {
    types: [task, blocks],
    typeDescriptors: [
      { ...task, conformsTo: [] },
      {
        ...blocks,
        conformsTo: [],
        source: { conformsTo: [] },
        target: { conformsTo: [] },
      },
    ],
    beads: [{ localId: "beads/a", type: task.id, revision: "1", properties: {} }],
    links: [
      {
        localId: "links/external",
        type: blocks.id,
        revision: "1",
        source: orientation === "source" ? external : local,
        target: orientation === "target" ? external : local,
        properties: {},
      },
    ],
  };
}
