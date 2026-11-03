import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import uri from "fast-uri";
import { describe, expect, it } from "vitest";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { buildInstalledSchemaGraph, SCHEMA_GRAPH_POLICY } from "./installed-schema-graph.js";
import { GraphBudget, SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import { resolveSchemaUri } from "./installed-schema-uri.js";

const resolve = (base: string, reference: string) =>
  resolveSchemaUri(base, reference, new GraphBudget(SCHEMA_GRAPH_CEILINGS));
const artifact = (retrievalUri: string, value: unknown) => ({
  retrievalUri,
  utf8Bytes: Buffer.from(JSON.stringify(value)),
});
const graph = (schemas: ReturnType<typeof artifact>[]) =>
  buildInstalledSchemaGraph(
    { descriptors: [], schemas, limits: CONTRACT_ARTIFACT_CEILINGS },
    SCHEMA_GRAPH_CEILINGS,
  );

describe("index3 URI security and compatibility boundaries", () => {
  it("pins both the graph resolver and AJV's actual URI resolver to the reviewed release", () => {
    const require = createRequire(import.meta.url);
    const ajvRequire = createRequire(require.resolve("ajv/package.json"));
    expect(require("fast-uri/package.json").version).toBe("3.1.9");
    expect(ajvRequire("fast-uri/package.json").version).toBe("3.1.9");
    expect(SCHEMA_GRAPH_POLICY).toBe("schema-resource-index-3");
  });

  it("merges query escape hex case without decoding a reserved slash into the path", () => {
    // Actual index2/3.1.5 result was https://host.test/C?X=%2f.
    const lower = resolve("https://Host.test:443/a/b", "../C?X=%2f");
    const upper = resolve("https://host.test/a/b", "../C?X=%2F");
    expect(lower).toEqual(upper);
    expect(lower.resource).toBe("https://host.test/C?X=%2F");
    expect(resolve("https://host.test/a/", "%2f").resource).toBe("https://host.test/a/%2F");
  });

  it.each([
    ["https://a.test/a/b", "../../../../c", "https://a.test/c"],
    ["https://a.test/a/b", "./a:b", "https://a.test/a/a:b"],
    ["https://a.test/", "https://%41.test/X", "https://a.test/X"],
    ["https://a.test/", "https://%61.test/X", "https://a.test/X"],
    ["urn:example:A:B", "#name", "urn:example:A:B#name"],
    ["file:///a/b", "../C", "file:///C"],
    ["https://a.test/a", "#/%252F", "https://a.test/a#/%252F"],
    ["https://a.test/a", "#/%2f", "https://a.test/a#//"],
  ])("preserves the admitted index2 boundary %s + %s", (base, ref, expected) => {
    expect(resolve(base, ref).uri).toBe(expected);
  });

  it.each([
    "http://a@b@evil.example/",
    "http://a\tb.example/",
    "http://a\rb.example/",
    "http://a\nb.example/",
    "https://[1::2::3]/a",
    "https://a.test:123abc/a",
    "https://a.test:65536/a",
    "%68ttps://a.test/",
    "%6Aavascript:alert(1)",
    "%u006Aavascript:alert(1)",
    "https://a%252fb.test/",
    "https://a%2fb.test/",
  ])("retains the graph wrapper's pre-resolution refusal of %s", (reference) => {
    expect(() => resolve("https://a.test/", reference)).toThrow();
  });

  it("qualifies dependency relative normalization separately from the graph's absolute resolution", () => {
    // The wrapper never normalizes a scheme-less reference before resolution.
    for (const [reference, expected] of [
      ["../x", "https://a.test/x"],
      ["a/../b", "https://a.test/dir/b"],
      ["./a:b", "https://a.test/dir/a:b"],
    ] as const) {
      expect(uri.resolve("https://a.test/dir/file", uri.normalize(reference))).toBe(expected);
      expect(uri.resolve("https://a.test/dir/file", reference)).toBe(expected);
    }
    // This non-default dependency mode is not used by the graph wrapper.
    expect(uri.normalize("javascript:alert(1)", { reference: "suffix", scheme: "x" })).toBe(
      "javascript%3Aalert(1)",
    );
  });

  it("refuses an index2-distinct pair that now collides instead of choosing either schema", () => {
    expect(() =>
      graph([
        artifact("https://schema.test/one", {
          $id: "https://schema.test/a?X=%2f",
          type: "integer",
        }),
        artifact("https://schema.test/two", { $id: "https://schema.test/a?X=%2F", type: "string" }),
      ]),
    ).toThrow("resource-collision");
  });

  it("binds a query-case reference only to the selected index3 resource and separates identities", () => {
    const current = graph([
      artifact("https://schema.test/root", { $ref: "a?X=%2F" }),
      artifact("https://schema.test/a?X=%2f", { type: "integer" }),
    ]);
    const reference = current.references.find((entry) => entry.raw === "a?X=%2F");
    expect(reference?.resolvedUri).toBe("https://schema.test/a?X=%2F");
    expect(current.nodes[reference!.target]?.value).toMatchObject({ type: "integer" });
    const oldIdentity = createHash("sha256")
      .update(`schema-resource-index-2\0${current.artifactDigest}\0${current.builtinDigest}`)
      .digest("hex");
    expect(current.identity).not.toBe(oldIdentity);
    expect(current.receipt.policy).toBe("schema-resource-index-3");
  });

  it("keeps AJV's ordinary local $id/$ref validation and rejects the encoded-scheme alias", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema({ $id: "https://a.test/schema", $defs: { value: { type: "integer" } } });
    const validate = ajv.compile({ $ref: "https://a.test/schema#/$defs/value" });
    expect(validate(7)).toBe(true);
    expect(validate("7")).toBe(false);
    // Actual 3.1.5 AJV resolved this malformed alias to the clean https schema.
    expect(() => ajv.compile({ $ref: "%68ttps://a.test/schema#/$defs/value" })).toThrow(
      "URI scheme is malformed",
    );
    expect(() =>
      new Ajv2020({ strict: true }).addSchema({ $id: "%68ttps://a.test/schema", type: "integer" }),
    ).toThrow("URI scheme is malformed");
  });

  it("does not equate AJV's raw registration keys with the graph's canonical resource map", () => {
    const lower = new Ajv2020({ strict: true });
    lower.addSchema({ $id: "https://schema.test/a?X=%2f", type: "integer" });
    // Unlike 3.1.5, even an identically spelled raw reference now normalizes to
    // uppercase escapes before lookup. Do not silently rewrite registration.
    expect(() => lower.compile({ $ref: "https://schema.test/a?X=%2f" })).toThrow(
      "can't resolve reference",
    );
    expect(() => lower.compile({ $ref: "https://schema.test/a?X=%2F" })).toThrow(
      "can't resolve reference",
    );
    const upper = new Ajv2020({ strict: true });
    upper.addSchema({ $id: "https://schema.test/a?X=%2F", type: "integer" });
    const validate = upper.compile({ $ref: "https://schema.test/a?X=%2f" });
    expect(validate(7)).toBe(true);
    expect(validate("7")).toBe(false);
  });
  it("records AJV's silent uppercase preference when raw query-case keys coexist", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema({ $id: "https://schema.test/a?X=%2f", type: "integer" });
    ajv.addSchema({ $id: "https://schema.test/a?X=%2F", type: "string" });
    // Graph admission refuses this pair. AJV retains both raw registrations,
    // but reference normalization silently selects the uppercase registration.
    for (const reference of ["https://schema.test/a?X=%2f", "https://schema.test/a?X=%2F"]) {
      const validate = ajv.compile({ $ref: reference });
      expect(validate(7)).toBe(false);
      expect(validate("7")).toBe(true);
    }
  });
});
