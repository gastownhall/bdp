import { describe, expect, it } from "vitest";

import {
  parseBeadCollection,
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseLinkRecord,
  parsePropertiesRecord,
  parseReadDiscovery,
  parseReadProblem,
  parseTypeDescriptor,
  parseTypeSummary,
  resolveCanonicalLocalResourceId,
  type AbsoluteHttpUrl,
  type Endpoint,
  type ExternalEndpointPolicy,
  type TypeDescriptor,
} from "./index.js";

// Compile-time contract: a reference is a URI string, or the external
// citation object with exactly uri and revision.
const _plainReference: Endpoint = "https://scope.example/acme/beads/demo-a";
const _externalPolicies: readonly ExternalEndpointPolicy[] = ["none", "opaque", "bead"];
// @ts-expect-error — the policy union is exactly none | opaque | bead
const _invalidPolicy: ExternalEndpointPolicy = "always";
void _externalPolicies;
void _invalidPolicy;
const _externalCitation: Endpoint = { uri: "urn:external:cited", revision: "cited-1" };
const _citationRejectsExtras: Endpoint = {
  uri: "urn:external:cited",
  revision: "cited-1",
  // @ts-expect-error — the citation object carries exactly uri and revision
  type: "https://work.example/types/task",
};
void _plainReference;
void _externalCitation;
void _citationRejectsExtras;

const scope = "https://scope.example/acme/" as AbsoluteHttpUrl;

describe("Read envelope parsing", () => {
  it("snapshots and closes Read discovery", () => {
    const source = {
      bdpVersion: "0",
      profile: "read",
      scope,
      beads: `${scope}beads/`,
      links: `${scope}links/`,
      types: `${scope}types/`,
      limits: { page: { defaultItems: 10, maximumItems: 100 } },
    };
    const parsed = parseReadDiscovery(source);
    source.beads = "https://attacker.example/";

    expect(parsed.beads).toBe(`${scope}beads/`);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.limits?.page)).toBe(true);
    expect(() => parseReadDiscovery({ ...source, profile: "transactional" })).toThrow();
    expect(() => parseReadDiscovery({ ...source, extra: true })).toThrow();
    expect(() =>
      parseReadDiscovery({ ...source, limits: { page: { defaultItems: 0 } } }),
    ).toThrow();
  });

  it("enforces the closed Problem mapping", () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    };
    expect(parseReadProblem(problem)).toEqual(problem);
    expect(() => parseReadProblem({ ...problem, type: "https://evil.example/problem" })).toThrow();
    expect(() => parseReadProblem({ ...problem, retry: "never" })).toThrow();
    expect(() => parseReadProblem({ ...problem, status: 200 })).toThrow();
  });

  it("uses the canonical URL rules for Scope and Resource paths", () => {
    expect(parseCanonicalScope(scope)).toBe(scope);
    expect(parseCanonicalHttpUrl(`${scope}beads/a:b`)).toBe(`${scope}beads/a:b`);
    expect(parseCanonicalHttpUrl("https://types.example/descriptors/a%2Fb")).toBe(
      "https://types.example/descriptors/a%2Fb",
    );
    expect(parseCanonicalHttpUrl("https://types.example/%E2%82%AC?cursor=a%2Fb")).toBe(
      "https://types.example/%E2%82%AC?cursor=a%2Fb",
    );
    expect(parseCanonicalHttpUrl("https://types.example/types/?cursor=%74oken%2fpart")).toBe(
      "https://types.example/types/?cursor=%74oken%2fpart",
    );
    expect(() => parseCanonicalHttpUrl("https://types.example/types/%74ask")).toThrow(
      "must not percent-encode an unreserved character",
    );
    expect(() => parseCanonicalHttpUrl("https://types.example/types/a%2fb")).toThrow(
      "must use uppercase complete percent escapes",
    );
    expect(() => parseCanonicalHttpUrl("https://types.example/types/%ZZ")).toThrow(
      "must use complete percent escapes",
    );
    expect(() => parseCanonicalHttpUrl("https://types.example/types/?cursor=%ZZ")).toThrow(
      "must use complete percent escapes",
    );
    expect(() => resolveCanonicalLocalResourceId(scope, "bead", "a%3Ab")).toThrow();
    expect(() => parseCanonicalScope("https://scope.example/acme/?view=other")).toThrow();
  });

  it("closes and freezes Resource records and collection pages", () => {
    const bead = {
      id: `${scope}beads/a`,
      type: "https://work.example/types/task",
      revision: "1",
      properties: { title: "A" },
    };
    const link = {
      id: `${scope}links/blocks-a-b`,
      type: "https://work.example/types/blocks",
      revision: "1",
      source: `${scope}beads/a`,
      target: { uri: "urn:external:b", revision: "cited-1" },
      properties: {},
    };
    const parsed = parseBeadCollection({ items: [bead], next: null });

    expect(parseBeadRecord(bead)).toEqual(bead);
    expect(parseLinkRecord(link)).toEqual(link);
    expect(Object.isFrozen(parsed.items[0]?.properties)).toBe(true);
    expect(() => parseBeadRecord({ ...bead, revision: "" })).toThrow();
    expect(() => parseBeadRecord({ ...bead, extra: true })).toThrow();
    expect(() =>
      parseLinkRecord({
        ...link,
        target: { uri: "urn:external:b" },
      }),
    ).toThrow();
    expect(() =>
      parseLinkRecord({
        ...link,
        source: { uri: `${scope}beads/a`, revision: "cited-1", extra: true },
      }),
    ).toThrow();
  });
});

describe("Resource properties parsing", () => {
  it("returns an unaliased deeply frozen JSON snapshot", () => {
    const source = {
      title: "Snapshot",
      metadata: { priority: 1, labels: ["reviewed"] },
    };

    const parsed = parsePropertiesRecord(source, "fixture.properties");
    source.title = "mutated";
    source.metadata.priority = 2;
    source.metadata.labels.push("late");

    expect(parsed).toEqual({
      title: "Snapshot",
      metadata: { priority: 1, labels: ["reviewed"] },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.metadata)).toBe(true);
    expect(
      Object.isFrozen((parsed.metadata as { readonly labels: readonly string[] }).labels),
    ).toBe(true);
  });

  it("rejects cycles, non-JSON values, non-finite numbers, and oversized containers", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => parsePropertiesRecord(cyclic)).toThrow("must not contain a cycle");
    expect(() => parsePropertiesRecord({ value: undefined })).toThrow(
      "must contain only JSON values",
    );
    expect(() => parsePropertiesRecord({ value: Number.NaN })).toThrow(
      "must contain a finite JSON number",
    );
    expect(() =>
      parsePropertiesRecord({ values: Array.from({ length: 10_001 }, () => 0) }),
    ).toThrow("must not exceed 10000 entries");
  });

  it("bounds primitive depth and aggregate node count", () => {
    let tooDeep: unknown = 0;
    for (let depth = 0; depth < 128; depth += 1) tooDeep = [tooDeep];
    expect(() => parsePropertiesRecord({ value: tooDeep })).toThrow("must not exceed depth 128");

    const tooManyNodes = Array.from({ length: 101 }, () => Array(1_000).fill(0));
    expect(() => parsePropertiesRecord({ values: tooManyNodes })).toThrow(
      "must not exceed 100000 values",
    );
  });
});

describe("canonical local Resource IDs", () => {
  it("accepts nested canonical Bead, Link, and Type paths", () => {
    expect(resolveCanonicalLocalResourceId(scope, "bead", "beads/projects/alpha/task-42")).toBe(
      `${scope}beads/projects/alpha/task-42`,
    );
    expect(resolveCanonicalLocalResourceId(scope, "link", "links/blocks/%E2%82%AC")).toBe(
      `${scope}links/blocks/%E2%82%AC`,
    );
    expect(resolveCanonicalLocalResourceId(scope, "type", "types/domain/%E2%82%AC")).toBe(
      `${scope}types/domain/%E2%82%AC`,
    );
  });

  it.each([
    ["bead", "links/x"],
    ["link", "beads/x"],
    ["type", "beads/x"],
    ["type", "types/"],
    ["type", "types/%61"],
    ["type", "types/a%2Fb"],
    ["bead", "beads/"],
    ["bead", "beads//x"],
    ["bead", "beads/."],
    ["bead", "beads/.."],
    ["bead", "beads/%2E"],
    ["bead", "beads/%2E%2E"],
    ["bead", "beads/a\\b"],
    ["bead", "beads/a%5Cb"],
    ["bead", "beads/a%2Fb"],
    ["bead", "beads/a?view=1"],
    ["bead", "beads/a#fragment"],
    ["bead", "beads/a\u0001b"],
    ["bead", "beads/%41"],
    ["bead", "beads/%e2%82%ac"],
    ["bead", "beads/%"],
    ["bead", "beads/€"],
  ] as const)("rejects a noncanonical %s ID %s", (resource, localId) => {
    expect(() => resolveCanonicalLocalResourceId(scope, resource, localId)).toThrow();
  });
});

describe("Type artifact parsing", () => {
  it("validates discovery multiplicity Type IDs as descriptor identities", () => {
    const discovery = {
      bdpVersion: "0",
      profile: "read",
      scope,
      beads: `${scope}beads/`,
      links: `${scope}links/`,
      types: `${scope}types/`,
      maximumEndpointMultiplicity: [
        { linkConformsTo: "https://work.example/types/blocks", endpoint: "source", max: 1 },
      ],
    };

    expect(parseReadDiscovery(discovery)).toEqual(discovery);
    expect(() =>
      parseReadDiscovery({
        ...discovery,
        maximumEndpointMultiplicity: [
          {
            linkConformsTo: "https://user:pw@work.example/types/blocks#fragment",
            endpoint: "source",
            max: 1,
          },
        ],
      }),
    ).toThrow("canonical credential-free HTTP(S) URL");
  });

  it("keeps the static Type Descriptor contract discriminated by resource kind", () => {
    const bead = {
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
      conformsTo: [],
    } as const satisfies TypeDescriptor;
    const link = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
      conformsTo: [],
      source: { conformsTo: [] },
      target: { conformsTo: [] },
    } as const satisfies TypeDescriptor;
    expect([bead.describes, link.describes]).toEqual(["bead", "link"]);

    // @ts-expect-error Link descriptors require both endpoint constraints.
    const invalidLink: TypeDescriptor = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
      conformsTo: [],
    };
    // @ts-expect-error Bead descriptors cannot carry Link endpoint constraints.
    const invalidBead: TypeDescriptor = {
      ...bead,
      source: { conformsTo: [] },
      target: { conformsTo: [] },
    };
    expect([invalidLink.describes, invalidBead.describes]).toEqual(["link", "bead"]);
  });

  it("round-trips endpoint-constraint external policies and rejects unknown tokens", () => {
    const descriptor = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      describes: "link",
      conformsTo: [],
      source: { conformsTo: [], external: "none" },
      target: { conformsTo: [], external: "bead" },
    };
    expect(parseTypeDescriptor(descriptor)).toEqual(descriptor);
    expect(
      parseTypeDescriptor({ ...descriptor, target: { conformsTo: [], external: "opaque" } }),
    ).toEqual({ ...descriptor, target: { conformsTo: [], external: "opaque" } });
    expect(() =>
      parseTypeDescriptor({ ...descriptor, source: { conformsTo: [], external: "always" } }),
    ).toThrow();
  });

  it("preserves every optional member of a closed Link Type Descriptor", () => {
    const descriptor = {
      id: "https://work.example/types/blocks",
      name: "Blocks",
      description: "A blocking relationship",
      describes: "link",
      conformsTo: ["https://work.example/types/dependency"],
      propertiesSchema: "https://work.example/schemas/blocks.json",
      source: { conformsTo: ["https://work.example/types/work-item"] },
      target: { conformsTo: [] },
    } as const;

    expect(parseTypeDescriptor(descriptor)).toEqual(descriptor);
  });

  it("validates and returns one immutable snapshot of accessor-bearing inputs", () => {
    let summaryNameReads = 0;
    const summary = {
      id: "https://work.example/types/task",
      get name(): unknown {
        summaryNameReads += 1;
        return summaryNameReads === 1 ? "Task" : 42;
      },
      describes: "bead",
    };
    const parsedSummary = parseTypeSummary(summary);
    expect(parsedSummary).toEqual({
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
    });
    expect(summaryNameReads).toBe(1);
    expect(Object.isFrozen(parsedSummary)).toBe(true);

    let descriptorNameReads = 0;
    const descriptor = {
      id: "https://work.example/types/blocks",
      get name(): unknown {
        descriptorNameReads += 1;
        return descriptorNameReads === 1 ? "Blocks" : 42;
      },
      describes: "link",
      conformsTo: ["https://work.example/types/dependency"],
      source: { conformsTo: ["https://work.example/types/work-item"] },
      target: { conformsTo: [] },
    };
    const parsedDescriptor = parseTypeDescriptor(descriptor);
    expect(parsedDescriptor.name).toBe("Blocks");
    expect(descriptorNameReads).toBe(1);
    expect(Object.isFrozen(parsedDescriptor)).toBe(true);
    expect(Object.isFrozen(parsedDescriptor.conformsTo)).toBe(true);
    if (parsedDescriptor.describes !== "link") throw new Error("expected Link descriptor");
    expect(Object.isFrozen(parsedDescriptor.source)).toBe(true);
  });

  it("captures array length once before enforcing snapshot bounds and copying", () => {
    let lengthReads = 0;
    const conformsTo = new Proxy(["https://work.example/types/base"], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 10_001;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const parsed = parseTypeDescriptor({
      id: "https://work.example/types/task",
      name: "Task",
      describes: "bead",
      conformsTo,
    });
    expect(parsed.conformsTo).toEqual(["https://work.example/types/base"]);
    expect(lengthReads).toBe(1);
    expect(Object.isFrozen(parsed.conformsTo)).toBe(true);
  });

  it("closes summaries, descriptors, and endpoint constraints", () => {
    expect(() =>
      parseTypeSummary({
        id: "https://work.example/types/task",
        name: "Task",
        describes: "bead",
        extra: true,
      }),
    ).toThrow("additional properties");
    expect(() =>
      parseTypeDescriptor({
        id: "https://work.example/types/task",
        name: "Task",
        describes: "bead",
        conformsTo: [],
        extra: true,
      }),
    ).toThrow("additional properties");
    expect(() =>
      parseTypeDescriptor({
        id: "https://work.example/types/blocks",
        name: "Blocks",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], extra: true },
        target: { conformsTo: [] },
      }),
    ).toThrow("additional properties");
  });

  it("requires both Link endpoint constraints and forbids them on Bead descriptors", () => {
    expect(() =>
      parseTypeDescriptor({
        id: "https://work.example/types/blocks",
        name: "Blocks",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [] },
      }),
    ).toThrow();
    expect(() =>
      parseTypeDescriptor({
        id: "https://work.example/types/task",
        name: "Task",
        describes: "bead",
        conformsTo: [],
        source: { conformsTo: [] },
      }),
    ).toThrow();
  });

  it("requires unique canonical HTTP(S) Type IDs", () => {
    expect(() =>
      parseTypeDescriptor({
        id: "https://work.example/types/task",
        name: "Task",
        describes: "bead",
        conformsTo: ["https://work.example/types/base", "https://work.example/types/base"],
      }),
    ).toThrow("duplicate items");
    expect(() =>
      parseTypeDescriptor({
        id: "https://work.example/types/task",
        name: "Task",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: "urn:example:schema",
      }),
    ).toThrow("pattern");
  });

  it("preserves schema-valid noncanonical propertiesSchema URLs", () => {
    expect(
      parseTypeDescriptor({
        id: "https://work.example/types/task",
        name: "Task",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: "https://work.example:443/schema",
      }),
    ).toMatchObject({ propertiesSchema: "https://work.example:443/schema" });
  });
});
