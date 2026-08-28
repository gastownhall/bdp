import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createConformanceArtifactBundle, ConformanceArtifactBundleError } from "./index.js";

const catalogValue = {
  catalogVersion: 1,
  scenarios: [
    {
      id: "read.discovery",
      title: "Scope discovery",
      kind: "normative",
      requiredProfile: "read",
      requirements: [
        {
          source: "docs/specs/bdp.md",
          anchor: "#scope-discovery-and-human-documentation",
          selectedText: "service-desc",
        },
      ],
    },
  ],
} as const;

const manifestValue = {
  manifestVersion: 1,
  catalogId: "read-v1",
  scenarios: [
    {
      id: "read.discovery",
      requiredProfile: "read",
      setup: { fixture: "reference-read-v1", requires: ["public-http"] },
      applicability: { requires: [] },
      requests: [
        {
          id: "scope",
          method: "GET",
          target: { binding: "scope" },
          headers: {},
          captures: [],
          assertions: [{ id: "status", kind: "status", equals: 204 }],
        },
      ],
      cleanup: { resetFixture: true },
    },
  ],
} as const;

const fixtureValue = {
  fixtureVersion: 1,
  id: "reference-read-v1",
  seed: 0,
  capabilities: ["public-http"],
  bindings: { resource: "beads/demo-a" },
  records: [{ id: "demo-a" }],
} as const;

const encode = (value: unknown, space?: number): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, undefined, space)}\n`);

function createBundle(
  overrides: {
    readonly catalog?: Uint8Array;
    readonly manifest?: Uint8Array;
    readonly fixture?: Uint8Array;
  } = {},
) {
  return createConformanceArtifactBundle({
    catalog: { bytes: overrides.catalog ?? encode(catalogValue), label: "catalog.json" },
    manifest: { bytes: overrides.manifest ?? encode(manifestValue), label: "manifest.json" },
    fixture: { bytes: overrides.fixture ?? encode(fixtureValue), label: "fixture.json" },
  });
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("conformance artifact bundle", () => {
  it("binds parsed artifacts to the exact copied source bytes", () => {
    const catalog = encode(catalogValue, 2);
    const manifest = encode(manifestValue, 2);
    const fixture = encode(fixtureValue, 2);
    const bundle = createBundle({ catalog, manifest, fixture });

    expect(bundle.catalog).toEqual(catalogValue);
    expect(bundle.manifest).toEqual(manifestValue);
    expect(bundle.fixture).toEqual(fixtureValue);
    expect(bundle.digests).toEqual({
      catalogDigest: sha256(catalog),
      manifestDigest: sha256(manifest),
      fixtureDigest: sha256(fixture),
    });

    const compact = createBundle();
    expect(compact.catalog).toEqual(bundle.catalog);
    expect(compact.manifest).toEqual(bundle.manifest);
    expect(compact.fixture).toEqual(bundle.fixture);
    expect(compact.digests.catalogDigest).not.toBe(bundle.digests.catalogDigest);
    expect(compact.digests.manifestDigest).not.toBe(bundle.digests.manifestDigest);
    expect(compact.digests.fixtureDigest).not.toBe(bundle.digests.fixtureDigest);
  });

  it("cannot be changed by mutating caller-owned bytes or parsed values", () => {
    const catalog = encode(catalogValue);
    const bundle = createBundle({ catalog });
    const digest = bundle.digests.catalogDigest;
    catalog.fill(0);

    expect(bundle.digests.catalogDigest).toBe(digest);
    expect(bundle.catalog.scenarios[0]?.id).toBe("read.discovery");
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.catalog.scenarios)).toBe(true);
    expect(Object.isFrozen(bundle.fixture.bindings)).toBe(true);
    expect(() => {
      (bundle.fixture.bindings as Record<string, string>).resource = "beads/swapped";
    }).toThrow();
  });

  it("freezes deeply nested extensible fixture data without recursive stack growth", () => {
    const depth = 100;
    const fixture = new TextEncoder().encode(
      `{"fixtureVersion":1,"id":"reference-read-v1","seed":0,"capabilities":["public-http"],"bindings":{},"nested":${"[".repeat(depth)}0${"]".repeat(depth)}}\n`,
    );
    const bundle = createBundle({ fixture });
    let nested: unknown = bundle.fixture.nested;
    for (let index = 0; index < depth; index += 1) {
      expect(Object.isFrozen(nested)).toBe(true);
      nested = (nested as readonly unknown[])[0];
    }
    expect(nested).toBe(0);
  });

  it("bounds source bytes and JSON depth, node count, and container width", () => {
    expect(() => createBundle({ fixture: new Uint8Array(1_048_577) })).toThrow(
      "fixture source must not exceed 1048576 bytes",
    );

    const tooDeep = new TextEncoder().encode(
      `{"fixtureVersion":1,"id":"reference-read-v1","seed":0,"capabilities":["public-http"],"bindings":{},"nested":${"[".repeat(129)}0${"]".repeat(129)}}\n`,
    );
    expect(() => createBundle({ fixture: tooDeep })).toThrow("JSON must not exceed depth 128");

    const tooWide = {
      ...fixtureValue,
      records: Array.from({ length: 10_001 }, (_, index) => index),
    };
    expect(() => createBundle({ fixture: encode(tooWide) })).toThrow(
      "a JSON container must not exceed 10000 entries",
    );

    const tooManyNodes = {
      ...fixtureValue,
      records: Array.from({ length: 10_000 }, () => Array(10).fill(0)),
    };
    expect(() => createBundle({ fixture: encode(tooManyNodes) })).toThrow(
      "JSON must not exceed 100000 nodes",
    );
  });

  it("captures source bytes once before enforcing the size limit", () => {
    let reads = 0;
    const fixtureSource = { label: "fixture.json" } as {
      readonly bytes: Uint8Array;
      readonly label: string;
    };
    Object.defineProperty(fixtureSource, "bytes", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? new Uint8Array(1_048_577) : encode(fixtureValue);
      },
    });

    expect(() =>
      createConformanceArtifactBundle({
        catalog: { bytes: encode(catalogValue), label: "catalog.json" },
        manifest: { bytes: encode(manifestValue), label: "manifest.json" },
        fixture: fixtureSource,
      }),
    ).toThrow("fixture source must not exceed 1048576 bytes");
    expect(reads).toBe(1);
  });

  it("uses typed-array intrinsic size and copy semantics", () => {
    class DeceptiveSize extends Uint8Array {
      override get byteLength(): number {
        return 0;
      }

      override *[Symbol.iterator](): ArrayIterator<number> {
        yield* super.values();
      }
    }

    expect(() => createBundle({ fixture: new DeceptiveSize(1_048_577) })).toThrow(
      "fixture source must not exceed 1048576 bytes",
    );

    class DeceptiveIterator extends Uint8Array {
      override *[Symbol.iterator](): ArrayIterator<number> {
        yield 0xff;
      }
    }
    const fixture = new DeceptiveIterator(encode(fixtureValue));
    expect(createBundle({ fixture }).fixture).toEqual(fixtureValue);
    expect(createBundle({ fixture: Buffer.from(encode(fixtureValue)) }).fixture).toEqual(
      fixtureValue,
    );

    for (const bytes of [
      new Uint16Array(0),
      new Int8Array(0),
      new Uint8ClampedArray(0),
      new DataView(new ArrayBuffer(0)),
      new Proxy(new Uint8Array(0), {}),
    ]) {
      expect(() =>
        createConformanceArtifactBundle({
          catalog: { bytes: bytes as Uint8Array },
          manifest: { bytes: encode(manifestValue) },
          fixture: { bytes: encode(fixtureValue) },
        }),
      ).toThrow("catalog source bytes must be a Uint8Array");
    }
  });

  it.each(["1e1000", "-1e1000"])("rejects overflowing JSON number %s", (number) => {
    const fixture = new TextEncoder().encode(
      `{"fixtureVersion":1,"id":"reference-read-v1","seed":0,"capabilities":["public-http"],"bindings":{},"records":[${number}]}\n`,
    );
    expect(() => createBundle({ fixture })).toThrow("fixture.json: JSON numbers must be finite");
  });

  it("rejects malformed UTF-8 without applying replacement characters", () => {
    expect(() => createBundle({ fixture: Uint8Array.of(0xff) })).toThrow(
      "fixture.json: source is not valid UTF-8",
    );
  });

  it("rejects a manifest that names a fixture other than the bound source", () => {
    const mismatchedManifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          setup: { fixture: "silently-swapped", requires: ["public-http"] },
        },
      ],
    };
    expect(() => createBundle({ manifest: encode(mismatchedManifest) })).toThrow(
      "names fixture 'silently-swapped' instead of the bound fixture",
    );
  });

  it("rejects a manifest whose catalog id does not bind the catalog version", () => {
    expect(() =>
      createBundle({ manifest: encode({ ...manifestValue, catalogId: "read-v2" }) }),
    ).toThrow("manifest catalogId does not match the bound catalog source");
  });

  it("rejects a missing fixture oracle before target execution", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "target-resource",
                  kind: "json-equals",
                  fixturePointer: "/oracles/resource",
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = { ...fixtureValue, oracles: {} };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "fixture oracle pointer did not resolve",
    );
  });

  it("requires a bounded string at each private raw-wire sentinel pointer", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "redacted",
                  kind: "wire-not-contains",
                  fixturePointer: "/private/internalFaultSentinel",
                },
              ],
            },
          ],
        },
      ],
    };

    for (const internalFaultSentinel of [0, "", "x".repeat(257)])
      expect(() =>
        createBundle({
          manifest: encode(manifest),
          fixture: encode({ ...fixtureValue, private: { internalFaultSentinel } }),
        }),
      ).toThrow("private wire sentinel must be a non-empty string no larger than 256 UTF-8 bytes");
    expect(() =>
      createBundle({
        manifest: encode(manifest),
        fixture: encode({
          ...fixtureValue,
          private: { internalFaultSentinel: "private-sentinel" },
        }),
      }),
    ).not.toThrow();
  });

  it("rejects an array-set fixture oracle with the wrong shape before target execution", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "target-resources",
                  kind: "json-array-set",
                  pointer: "/items",
                  itemPointer: "/id",
                  fixturePointer: "/oracles/resource-ids",
                  normalize: "scope-relative-url",
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = { ...fixtureValue, oracles: { "resource-ids": "beads/demo-a" } };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "json-array-set fixture oracle must be an array",
    );
  });

  it("rejects non-string normalized values in an array-set fixture oracle", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "target-resources",
                  kind: "json-array-set",
                  pointer: "/items",
                  itemPointer: "/id",
                  fixturePointer: "/oracles/resource-ids",
                  normalize: "scope-relative-url",
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = { ...fixtureValue, oracles: { "resource-ids": [7] } };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "normalized json-array-set fixture oracle values must be strings",
    );
  });

  it("rejects noncanonical timestamp-normalized fixture oracle pointers", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "properties",
                  kind: "json-equals",
                  fixturePointer: "/oracles/properties",
                  normalize: "iso-timestamps",
                  timestampPointers: ["/created_at"],
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = {
      ...fixtureValue,
      oracles: { properties: { created_at: "2026-99-99T99:99:99Z" } },
    };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "timestamp-normalized fixture oracle pointers must resolve to canonical ISO timestamps",
    );
  });

  it("rejects tuple fixture oracles that do not match the projection width", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "target-links",
                  kind: "json-array-tuples",
                  pointer: "/items",
                  projections: [
                    { pointer: "/id", normalize: "scope-relative-url" },
                    { pointer: "/target/id", normalize: "scope-relative-or-absolute-uri" },
                  ],
                  fixturePointer: "/oracles/link-tuples",
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = { ...fixtureValue, oracles: { "link-tuples": [["links/one"]] } };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "json-array-tuples fixture oracle must match the projection shape",
    );
  });

  it("rejects non-string normalized cells in a tuple fixture oracle", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "target-links",
                  kind: "json-array-tuples",
                  pointer: "/items",
                  projections: [
                    { pointer: "/id", normalize: "scope-relative-url" },
                    { pointer: "/properties" },
                  ],
                  fixturePointer: "/oracles/link-tuples",
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = {
      ...fixtureValue,
      oracles: { "link-tuples": [[7, { purpose: "dependency" }]] },
    };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "normalized json-array-tuples fixture oracle cells must be strings",
    );
  });

  it("rejects a non-string normalized JSON-pointer fixture oracle", () => {
    const manifest = {
      ...manifestValue,
      scenarios: [
        {
          ...manifestValue.scenarios[0],
          requests: [
            {
              ...manifestValue.scenarios[0].requests[0],
              assertions: [
                {
                  id: "target-resource",
                  kind: "json-pointer",
                  pointer: "/id",
                  exists: true,
                  fixturePointer: "/oracles/resource-id",
                  normalize: "scope-relative-url",
                },
              ],
            },
          ],
        },
      ],
    };
    const fixture = { ...fixtureValue, oracles: { "resource-id": 7 } };

    expect(() => createBundle({ manifest: encode(manifest), fixture: encode(fixture) })).toThrow(
      "normalized json-pointer fixture oracle must be a string",
    );
  });

  it("validates fixture identity, capabilities, bindings, and seed at the byte boundary", () => {
    for (const fixture of [
      { ...fixtureValue, id: "Bearer SECRET" },
      { ...fixtureValue, seed: -1 },
      { ...fixtureValue, capabilities: ["public-http", "public-http"] },
      { ...fixtureValue, bindings: { "Bearer SECRET": "beads/a" } },
    ]) {
      expect(() => createBundle({ fixture: encode(fixture) })).toThrow(
        ConformanceArtifactBundleError,
      );
    }
  });
});
