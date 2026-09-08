import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { READ_VALUE_SCHEMA_REFS } from "@bdp/protocol";
import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalJson,
  deriveReadSchemaProjectionRoots,
  type ExecutableScenarioManifest,
  loadExecutableScenarioManifestJson,
  projectReadSchemaBundle,
  ReadSchemaProjectionError,
  serializeReadCohortArtifact,
} from "./index.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const ID = "https://schemas.example/test-bundle.json";
const SHA256_HEX = /^[0-9a-f]{64}$/;

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
      laterProfileOnly: { type: "object", properties: { seq: { $ref: "#/$defs/a" } } },
      unreachable: { type: "string" },
    },
  };
}

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

function digestOf(value: Json, roots: readonly string[] = ["envelope"]): string {
  return projectReadSchemaBundle(value, roots).digest;
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

describe("Read schema projection", () => {
  it("reaches definitions through every applicator and ignores instance data", () => {
    const projection = projectReadSchemaBundle(bundle(), ["envelope"]);
    expect(projection.roots).toEqual(["envelope"]);
    expect(projection.definitions).toEqual(REACHABLE);
    expect(projection.digest).toMatch(SHA256_HEX);
    expect(projection.digest).toBe(createHash("sha256").update(projection.bytes).digest("hex"));
    // The sub-bundle carries the headers and exactly the reachable definitions.
    const projected = JSON.parse(new TextDecoder().decode(projection.bytes)) as Json;
    expect(Object.keys(projected).sort()).toEqual(["$defs", "$id", "$schema"]);
    expect(projected.$id).toBe(ID);
    expect(projected.$schema).toBe(SCHEMA);
    expect(Object.keys(defs(projected)).sort()).toEqual(REACHABLE);
  });

  it("leaves the digest unchanged for definitions only a later profile reaches, bundle prose, and member order", () => {
    const baseline = digestOf(bundle());

    const laterProfile = bundle();
    defs(laterProfile).readUpdateSequence = {
      type: "object",
      properties: { operations: { type: "array", items: { $ref: "#/$defs/envelope" } } },
    };
    expect(digestOf(laterProfile)).toBe(baseline);

    const prose = bundle();
    prose.title = "renamed bundle";
    prose.description = "rewritten prose";
    expect(digestOf(prose)).toBe(baseline);

    expect(digestOf(reversedMembers(bundle()) as Json)).toBe(baseline);

    const unreachableChanged = bundle();
    (defs(unreachableChanged).unreachable as Json).type = "integer";
    expect(digestOf(unreachableChanged)).toBe(baseline);
  });

  it("moves the digest when a reachable definition changes or a definition becomes reachable", () => {
    const baseline = digestOf(bundle());

    const leafChanged = bundle();
    (defs(leafChanged).a as Json).type = "integer";
    expect(digestOf(leafChanged)).not.toBe(baseline);

    const rootChanged = bundle();
    ((defs(rootChanged).envelope as Json).properties as Json).added = { type: "string" };
    expect(digestOf(rootChanged)).not.toBe(baseline);

    const newlyReachable = bundle();
    ((defs(newlyReachable).envelope as Json).properties as Json).viaNew = {
      $ref: "#/$defs/unreachable",
    };
    expect(digestOf(newlyReachable)).not.toBe(baseline);

    expect(digestOf(bundle(), ["envelope", "unreachable"])).not.toBe(baseline);

    const headerChanged = bundle();
    headerChanged.$id = "https://schemas.example/other-bundle.json";
    expect(digestOf(headerChanged)).not.toBe(baseline);
  });

  it("fails closed on references it cannot follow, missing roots, and empty roots", () => {
    const dangling = bundle();
    (defs(dangling).a as Json).$ref = "#/$defs/missing";
    expect(() => projectReadSchemaBundle(dangling, ["envelope"])).toThrow(
      /references '#\/\$defs\/missing', which the bundle does not define/,
    );

    const nonLocal = bundle();
    (defs(nonLocal).a as Json).$ref = "https://elsewhere.example/schema.json#/$defs/a";
    expect(() => projectReadSchemaBundle(nonLocal, ["envelope"])).toThrow(
      /not a bundle-local '#\/\$defs\/<name>' reference/,
    );

    const anchored = bundle();
    (defs(anchored).a as Json).$ref = "#anchor";
    expect(() => projectReadSchemaBundle(anchored, ["envelope"])).toThrow(
      ReadSchemaProjectionError,
    );

    const dynamic = bundle();
    (defs(dynamic).a as Json).$dynamicRef = "#meta";
    expect(() => projectReadSchemaBundle(dynamic, ["envelope"])).toThrow(
      /\$dynamicRef is a reference form the Read projection does not follow/,
    );

    expect(() => projectReadSchemaBundle(bundle(), ["envelope", "absent"])).toThrow(
      /root 'absent' is not a definition of the bundle/,
    );
    expect(() => projectReadSchemaBundle(bundle(), [])).toThrow(/at least one envelope root/);

    const headerless = bundle();
    delete headerless.$id;
    expect(() => projectReadSchemaBundle(headerless, ["envelope"])).toThrow(
      /schema bundle \$id must be a non-empty string/,
    );
    expect(() => projectReadSchemaBundle("not a bundle", ["envelope"])).toThrow(
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
      Object.values(READ_VALUE_SCHEMA_REFS).map((ref) => ref.replace("#/$defs/", "")),
    );
    expected.add("beadRecord");
    expected.add("properties");
    expect(deriveReadSchemaProjectionRoots(manifest)).toEqual([...expected].sort());

    expect(() =>
      deriveReadSchemaProjectionRoots(manifestWith({}), [
        "https://elsewhere.example/schema.json#/$defs/beadRecord",
      ]),
    ).toThrow(/Read envelope root .* is not a bundle-local/);
    expect(() => deriveReadSchemaProjectionRoots(manifestWith({}), [])).toThrow(
      /no Read envelope roots were derived/,
    );
  });

  it("projects the committed bundle from the committed manifest's derived roots", () => {
    const manifestPath = "packages/conformance/matrices/read-v1.json";
    const manifest = loadExecutableScenarioManifestJson(
      readFileSync(path.join(workspaceRoot, manifestPath), "utf8"),
      manifestPath,
    );
    const committed = JSON.parse(
      readFileSync(path.join(workspaceRoot, "schemas", "bdp-v0.schema.json"), "utf8"),
    ) as Json;
    const roots = deriveReadSchemaProjectionRoots(manifest);
    expect(roots).toEqual([
      "beadCollection",
      "beadRecord",
      "linkCollection",
      "linkRecord",
      "properties",
      "readDiscovery",
      "readProblem",
      "typeDescriptor",
      "typeSummary",
      "typesInventory",
    ]);

    const projection = projectReadSchemaBundle(committed, roots);
    expect(projection.digest).toMatch(SHA256_HEX);
    expect(projection.definitions).toEqual(expect.arrayContaining([...roots]));
    // Nothing in Read references the profile token enum: discovery pins the
    // constant `read`. It is the one definition outside the projection, and a
    // later profile adding a token there does not force a Read re-seal.
    const outside = Object.keys(defs(committed)).filter(
      (name) => !projection.definitions.includes(name),
    );
    expect(outside).toEqual(["protocolProfile"]);
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
