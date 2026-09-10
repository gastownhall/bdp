import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HISTORY_VALUE_SCHEMA_REFS,
  HISTORY_WRITE_VALUE_SCHEMA_REFS,
  READ_VALUE_SCHEMA_REFS,
} from "@bdp/protocol";
import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalJson,
  deriveReadSchemaProjectionRoots,
  type ExecutableScenarioManifest,
  loadExecutableScenarioManifestJson,
  projectReadSchemaBundle,
  READ_SCHEMA_SEALED_DEFINITIONS,
  ReadSchemaProjectionError,
  serializeReadCohortArtifact,
} from "./index.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const ID = "https://schemas.example/test-bundle.json";
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * RP1: the digest of the committed bundle's sealed definition set — the value
 * the successor cohort must observe and bind as `schemaReadProjection`.
 * This pin is a schema regression check, not evidence. It moves only when the
 * text of one of the 42 sealed definitions, or the sealed list itself, changes;
 * a failure here is the re-seal trigger, seen before the gate sees it.
 */
const COMMITTED_READ_SCHEMA_PROJECTION =
  "0feaa86a2ba5180d6396e1b52b0b2ee339b0a79a0650ecc0c0e6045b17d053e7";

type Json = Record<string, unknown>;

/** A bundle whose one Read root reaches definitions through every applicator the walk must handle. */
function bundle(): Json {
  return {
    $schema: SCHEMA,
    $id: ID,
    title: "test bundle",
    description: "prose about the file, not about any definition",
    $defs: {
      envelope: {
        type: "object",
        properties: {
          viaProperties: { $ref: "#/$defs/a" },
          viaItems: { type: "array", items: { $ref: "#/$defs/b" } },
          viaAnyOf: { anyOf: [{ type: "null" }, { $ref: "#/$defs/c" }] },
          viaAdditionalProperties: { type: "object", additionalProperties: { $ref: "#/$defs/d" } },
          viaPropertyNames: { type: "object", propertyNames: { $ref: "#/$defs/e" } },
          viaPrefixItems: { type: "array", prefixItems: [{ $ref: "#/$defs/k" }] },
          viaNot: { not: { $ref: "#/$defs/l" } },
          viaPatternProperties: {
            type: "object",
            patternProperties: { "^x-": { $ref: "#/$defs/m" } },
          },
          viaDependentSchemas: {
            type: "object",
            dependentSchemas: { flag: { $ref: "#/$defs/n" } },
          },
          viaContains: { type: "array", contains: { $ref: "#/$defs/o" } },
          // A property literally named $ref is a name, not a reference.
          $ref: { type: "string" },
        },
        allOf: [
          // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then vocabulary
          { if: { $ref: "#/$defs/f" }, then: { $ref: "#/$defs/g" }, else: { $ref: "#/$defs/h" } },
        ],
        oneOf: [{ $ref: "#/$defs/i" }],
        // Instance data may look like a reference without being one.
        examples: [{ $ref: "#/$defs/notADefinition" }],
        default: { $ref: "#/$defs/notADefinition" },
      },
      a: { type: "string" },
      b: { type: "integer" },
      c: { $ref: "#/$defs/j" },
      d: { type: "boolean" },
      e: { type: "string", minLength: 1 },
      f: { const: { $ref: "#/$defs/notADefinition" } },
      g: { type: "number" },
      h: { enum: [{ $ref: "#/$defs/notADefinition" }] },
      i: { type: "null" },
      j: { type: "string" },
      k: { type: "string" },
      l: { type: "string" },
      m: { type: "string" },
      n: { type: "string" },
      o: { type: "string" },
      // Sealed, but nothing in Read references it: the `protocolProfile` shape.
      unreachable: { type: "string" },
      // Added to the bundle after the seal, by a later profile; reaches a sealed definition.
      laterProfileOnly: { type: "object", properties: { seq: { $ref: "#/$defs/a" } } },
    },
  };
}

/**
 * The synthetic seal, in the bundle's declaration order: everything Read
 * reaches plus `unreachable`, and not `laterProfileOnly`.
 */
const SEALED = [
  "envelope",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "unreachable",
];

const REACHABLE = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "envelope",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
];

function defs(value: Json): Json {
  return value.$defs as Json;
}

function digestOf(
  value: Json,
  roots: readonly string[] = ["envelope"],
  sealed: readonly string[] = SEALED,
): string {
  return projectReadSchemaBundle(value, roots, sealed).digest;
}

/** Rebuild a value with every object's members in reverse order. */
function reversedMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedMembers);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reversedMembers(entry)]),
    );
  }
  return value;
}

/** The smallest manifest shape the root derivation reads. */
function manifestWith(schemaRefs: {
  readonly requests?: readonly string[];
  readonly actions?: readonly string[];
}): ExecutableScenarioManifest {
  const assertion = (schema: string) => ({ id: `schema-${schema}`, kind: "json-schema", schema });
  return {
    manifestVersion: 1,
    catalogId: "read-v1",
    scenarios: [
      {
        id: "read.requests",
        requiredProfile: "read",
        setup: { fixture: "reference-read-v1", requires: [] },
        applicability: { requires: [] },
        requests: [
          {
            id: "get",
            method: "GET",
            target: { binding: "scope" },
            captures: [],
            assertions: (schemaRefs.requests ?? []).map(assertion),
          },
        ],
        cleanup: { resetFixture: true },
      },
      {
        id: "read.actions",
        requiredProfile: "read",
        setup: { fixture: "reference-read-v1", requires: [] },
        applicability: { requires: [] },
        actions: [
          {
            id: "act",
            family: "client",
            operation: "read",
            input: {},
            captures: [],
            assertions: (schemaRefs.actions ?? []).map(assertion),
          },
        ],
        cleanup: { resetFixture: true },
      },
    ],
  } as unknown as ExecutableScenarioManifest;
}

function committedBundle(): Json {
  return JSON.parse(
    readFileSync(path.join(workspaceRoot, "schemas", "bdp-v0.schema.json"), "utf8"),
  ) as Json;
}

function committedRoots(): readonly string[] {
  const manifestPath = "packages/conformance/matrices/read-v1.json";
  const manifest = loadExecutableScenarioManifestJson(
    readFileSync(path.join(workspaceRoot, manifestPath), "utf8"),
    manifestPath,
  );
  return deriveReadSchemaProjectionRoots(manifest);
}

describe("Read schema projection", () => {
  it("digests the sealed definitions by name, in sealed order, and nothing else", () => {
    const projection = projectReadSchemaBundle(bundle(), ["envelope"], SEALED);
    expect(projection.definitions).toEqual(SEALED);
    expect(projection.roots).toEqual(["envelope"]);
    // The coverage walk reaches through every applicator and treats instance
    // data as opaque: the `$ref`-shaped values under `examples`, `default`,
    // `const`, and `enum` would otherwise be dangling references.
    expect(projection.reachable).toEqual(REACHABLE);
    expect(projection.digest).toMatch(SHA256_HEX);
    expect(projection.digest).toBe(createHash("sha256").update(projection.bytes).digest("hex"));
    // The bytes are the `[name, definition]` pairs in sealed order — no bundle
    // header, no metadata, no unsealed definition.
    const projected = JSON.parse(new TextDecoder().decode(projection.bytes)) as [string, Json][];
    expect(Array.isArray(projected)).toBe(true);
    expect(projected.map(([name]) => name)).toEqual(SEALED);
    expect(projected[0]?.[1]).toEqual(defs(bundle()).envelope);
    expect(projected.at(-1)?.[1]).toEqual({ type: "string" });
  });

  it("leaves the digest unchanged by anything outside the sealed definitions' text", () => {
    const baseline = digestOf(bundle());

    // Top-level bundle metadata is outside the digest, whatever it is called.
    const metadata = bundle();
    metadata.$schema = "https://json-schema.org/draft/2019-09/schema";
    metadata.$id = "https://schemas.example/other-bundle.json";
    metadata.title = "renamed bundle";
    metadata.description = "rewritten prose";
    metadata["x-vendor"] = { note: "added after the seal" };
    expect(digestOf(metadata)).toBe(baseline);
    const headerless = bundle();
    delete headerless.$schema;
    delete headerless.$id;
    delete headerless.title;
    delete headerless.description;
    expect(digestOf(headerless)).toBe(baseline);

    // Definitions the seal does not name: added, changed, or reaching sealed ones.
    const laterProfile = bundle();
    defs(laterProfile).readUpdateSequence = {
      type: "object",
      properties: { operations: { type: "array", items: { $ref: "#/$defs/envelope" } } },
    };
    ((defs(laterProfile).laterProfileOnly as Json).properties as Json).added = { type: "string" };
    expect(digestOf(laterProfile)).toBe(baseline);

    // Member order and definition order.
    expect(digestOf(reversedMembers(bundle()) as Json)).toBe(baseline);

    // Reachability: a sealed definition that becomes a Read root — newly
    // reachable — changes nothing, and neither does a root that stops being one.
    expect(digestOf(bundle(), ["envelope", "unreachable"])).toBe(baseline);
    expect(digestOf(bundle(), ["a", "envelope"])).toBe(baseline);
  });

  it("moves the digest when any sealed definition's text changes, reachable or not, or the sealed list changes", () => {
    const baseline = digestOf(bundle());

    const leafChanged = bundle();
    (defs(leafChanged).a as Json).type = "integer";
    expect(digestOf(leafChanged)).not.toBe(baseline);

    const rootChanged = bundle();
    ((defs(rootChanged).envelope as Json).properties as Json).added = { type: "string" };
    expect(digestOf(rootChanged)).not.toBe(baseline);

    // The finding behind RP1: sealed, referenced by nothing in Read, and still
    // inside the digest.
    const unreachableChanged = bundle();
    (defs(unreachableChanged).unreachable as Json).type = "integer";
    expect(digestOf(unreachableChanged)).not.toBe(baseline);

    const proseChanged = bundle();
    (defs(proseChanged).a as Json).description = "a definition's own prose is inside it";
    expect(digestOf(proseChanged)).not.toBe(baseline);

    // The list is part of the seal: a name dropped or the order changed moves it.
    expect(digestOf(bundle(), ["envelope"], SEALED.slice(0, -1))).not.toBe(baseline);
    expect(digestOf(bundle(), ["envelope"], [...SEALED].reverse())).not.toBe(baseline);
  });

  it("fails closed: a sealed name the bundle lacks, a Read reach outside the seal, references it cannot follow, and empty sets", () => {
    const missing = bundle();
    delete defs(missing).unreachable;
    expect(() => projectReadSchemaBundle(missing, ["envelope"], SEALED)).toThrow(
      /sealed definition 'unreachable' is missing from the bundle/,
    );

    // The seal must cover the Read surface: a root outside it, or a sealed
    // definition referencing outside it, is an error rather than a digest that
    // silently ignores the definition.
    expect(() =>
      projectReadSchemaBundle(bundle(), ["envelope", "laterProfileOnly"], SEALED),
    ).toThrow(
      /Read reaches \$defs\/laterProfileOnly \(a Read envelope root\), which the sealed definition set does not include/,
    );
    const widened = bundle();
    ((defs(widened).envelope as Json).properties as Json).viaNew = {
      $ref: "#/$defs/laterProfileOnly",
    };
    expect(() => projectReadSchemaBundle(widened, ["envelope"], SEALED)).toThrow(
      /Read reaches \$defs\/laterProfileOnly \(referenced from \$defs\/envelope\), which the sealed definition set does not include/,
    );

    const dangling = bundle();
    (defs(dangling).a as Json).$ref = "#/$defs/missing";
    expect(() => projectReadSchemaBundle(dangling, ["envelope"], SEALED)).toThrow(
      /references '#\/\$defs\/missing', which the bundle does not define/,
    );

    const nonLocal = bundle();
    (defs(nonLocal).a as Json).$ref = "https://elsewhere.example/schema.json#/$defs/a";
    expect(() => projectReadSchemaBundle(nonLocal, ["envelope"], SEALED)).toThrow(
      /not a bundle-local '#\/\$defs\/<name>' reference/,
    );

    const anchored = bundle();
    (defs(anchored).a as Json).$ref = "#anchor";
    expect(() => projectReadSchemaBundle(anchored, ["envelope"], SEALED)).toThrow(
      ReadSchemaProjectionError,
    );

    const dynamic = bundle();
    (defs(dynamic).a as Json).$dynamicRef = "#meta";
    expect(() => projectReadSchemaBundle(dynamic, ["envelope"], SEALED)).toThrow(
      /\$dynamicRef is a reference form the Read projection does not follow/,
    );

    expect(() => projectReadSchemaBundle(bundle(), ["envelope", "absent"], SEALED)).toThrow(
      /root 'absent' is not a definition of the bundle/,
    );
    expect(() => projectReadSchemaBundle(bundle(), [], SEALED)).toThrow(
      /at least one envelope root/,
    );
    expect(() => projectReadSchemaBundle(bundle(), ["envelope"], [])).toThrow(
      /sealed definition set is empty/,
    );
    expect(() => projectReadSchemaBundle(bundle(), ["envelope"], [...SEALED, "a"])).toThrow(
      /sealed definition 'a' is listed more than once/,
    );

    expect(() => projectReadSchemaBundle({ $defs: [] }, ["envelope"], SEALED)).toThrow(
      /schema bundle \$defs must be a record/,
    );
    expect(() => projectReadSchemaBundle("not a bundle", ["envelope"], SEALED)).toThrow(
      /schema bundle must be a record/,
    );
  });

  it("derives the roots from manifest json-schema assertions at every site and the protocol parse table", () => {
    const manifest = manifestWith({
      requests: ["#/$defs/beadRecord", "#/$defs/beadRecord"],
      actions: ["#/$defs/properties"],
    });
    expect(deriveReadSchemaProjectionRoots(manifest, ["#/$defs/typeDescriptor"])).toEqual([
      "beadRecord",
      "properties",
      "typeDescriptor",
    ]);
    // The default protocol table is every definition @bdp/protocol parses through.
    const expected = new Set(
      [...Object.values(READ_VALUE_SCHEMA_REFS), ...Object.values(HISTORY_VALUE_SCHEMA_REFS)].map(
        (ref) => ref.replace("#/$defs/", ""),
      ),
    );
    expected.add("beadRecord");
    expected.add("properties");
    expect(deriveReadSchemaProjectionRoots(manifest)).toEqual([...expected].sort());
    for (const ref of Object.values(HISTORY_WRITE_VALUE_SCHEMA_REFS))
      expect(deriveReadSchemaProjectionRoots(manifest)).not.toContain(ref.replace("#/$defs/", ""));

    expect(() =>
      deriveReadSchemaProjectionRoots(manifestWith({}), [
        "https://elsewhere.example/schema.json#/$defs/beadRecord",
      ]),
    ).toThrow(/Read envelope root .* is not a bundle-local/);
    expect(() => deriveReadSchemaProjectionRoots(manifestWith({}), [])).toThrow(
      /no Read envelope roots were derived/,
    );
  });

  it("projects the committed bundle: the 42 sealed definitions, the derived roots, and the pinned digest", () => {
    const committed = committedBundle();
    const roots = committedRoots();
    expect(roots).toEqual([
      "beadCollection",
      "beadRecord",
      "changeContext",
      "historicalBeadRecord",
      "historicalLinkRecord",
      "historyCapability",
      "historyMissing",
      "historyVersionsPage",
      "linkCollection",
      "linkRecord",
      "properties",
      "readDiscovery",
      "readProblem",
      "typeDescriptor",
      "typeSummary",
      "typesInventory",
    ]);

    // The sealed list: 42 distinct names, every one a definition of the
    // committed bundle, digested in this order.
    expect(READ_SCHEMA_SEALED_DEFINITIONS).toHaveLength(42);
    expect(new Set(READ_SCHEMA_SEALED_DEFINITIONS).size).toBe(42);
    expect(Object.keys(defs(committed))).toEqual(
      expect.arrayContaining([...READ_SCHEMA_SEALED_DEFINITIONS]),
    );

    const projection = projectReadSchemaBundle(committed, roots);
    expect(projection.definitions).toEqual(READ_SCHEMA_SEALED_DEFINITIONS);
    expect(projection.digest).toBe(COMMITTED_READ_SCHEMA_PROJECTION);

    // The finding behind RP1: Read reaches 41 of the 42 sealed definitions.
    // Nothing references the profile token enum — discovery pins the constant
    // `read` — yet it is sealed, so a token added there moves the digest.
    expect(projection.reachable).toHaveLength(41);
    expect(projection.reachable).toEqual(expect.arrayContaining([...roots]));
    expect(
      READ_SCHEMA_SEALED_DEFINITIONS.filter((name) => !projection.reachable.includes(name)),
    ).toEqual(["protocolProfile"]);
  });

  it("over the committed bundle, only a sealed definition's text moves the pinned digest", () => {
    const roots = committedRoots();
    const digest = (value: Json): string => projectReadSchemaBundle(value, roots).digest;

    const tokenAdded = committedBundle();
    (defs(tokenAdded).protocolProfile as { enum: string[] }).enum.push("read-update-v2");
    expect(digest(tokenAdded)).not.toBe(COMMITTED_READ_SCHEMA_PROJECTION);

    const metadata = committedBundle();
    metadata.$schema = "https://json-schema.org/draft/2019-09/schema";
    metadata.$id = "https://schemas.example/moved.json";
    metadata.title = "renamed";
    metadata.description = "Rewritten since the seal.";
    metadata["x-note"] = "outside $defs";
    expect(digest(metadata)).toBe(COMMITTED_READ_SCHEMA_PROJECTION);

    const laterProfile = committedBundle();
    defs(laterProfile).updateSequence = {
      type: "object",
      properties: { operations: { type: "array", items: { $ref: "#/$defs/beadRecord" } } },
    };
    expect(digest(laterProfile)).toBe(COMMITTED_READ_SCHEMA_PROJECTION);

    const removed = committedBundle();
    delete defs(removed).protocolProfile;
    expect(() => digest(removed)).toThrow(
      /sealed definition 'protocolProfile' is missing from the bundle/,
    );
  });
});

describe("canonical JSON (RFC 8785)", () => {
  it("reproduces the RFC 8785 section 3.2.3 example", () => {
    // The RFC's input and output texts, assembled at run time so that nothing
    // but JSON.parse decodes an escape sequence: `u(hex)` spells the
    // six-character backslash-u escape the RFC text uses.
    const u = (hex: string): string => `${String.fromCharCode(92)}u${hex}`;
    const input: unknown = JSON.parse(
      [
        '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],',
        `"string":"${u("20ac")}$${u("000F")}${u("000a")}A'${u("0042")}${u("0022")}${u("005c")}`,
        String.raw`\\\"\/",`,
        '"literals":[null,true,false]}',
      ].join(""),
    );
    const expected = [
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],',
      `"string":"€$${u("000f")}`,
      String.raw`\nA'B\"\\\\\"/"}`,
    ].join("");
    expect(canonicalJson(input)).toBe(expected);
  });

  it("is the artifact serializer's algorithm, so the two cannot drift", () => {
    const value = { z: [1, { b: "x", a: null }], a: { nested: true, "": "empty key" } };
    expect(new TextDecoder().decode(serializeReadCohortArtifact(value as never))).toBe(
      `${canonicalJson(value)}\n`,
    );
  });

  it("omits undefined members and refuses what JSON cannot spell", () => {
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/must be finite/);
    expect(() => canonicalJson(() => undefined)).toThrow(/cannot serialize function/);
  });
});
