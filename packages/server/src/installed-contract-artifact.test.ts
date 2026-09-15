import { createHash } from "node:crypto";
import * as protocol from "@bdp/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  ContractArtifactError,
  type ContractArtifactInput,
  type ContractArtifactLimits,
  ingestContractArtifacts,
} from "./installed-contract-artifact.js";

const b = "https://types.test/bead";
const l = "https://types.test/link";
const s = "https://schemas.test/properties";
const bead = { id: b, name: "Bead", describes: "bead", conformsTo: [] };
const link = {
  id: l,
  name: "Link",
  describes: "link",
  conformsTo: [],
  source: { conformsTo: [b] },
  target: { conformsTo: [] },
};
function artifact(uri: string, text: string): ContractArtifactInput {
  return { retrievalUri: uri, utf8Bytes: Buffer.from(text) };
}
function descriptor(value: unknown): ContractArtifactInput {
  const row = value as { id: string };
  return artifact(row.id, JSON.stringify(value));
}
function ingest(
  descriptors: readonly ContractArtifactInput[] = [descriptor(bead)],
  schemas: readonly ContractArtifactInput[] = [],
  limits: Partial<ContractArtifactLimits> = {},
) {
  return ingestContractArtifacts({
    descriptors,
    schemas,
    limits: { ...CONTRACT_ARTIFACT_CEILINGS, ...limits },
  });
}
function refuses(action: () => unknown, code: ContractArtifactError["code"]): void {
  try {
    action();
    throw new Error("expected refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(ContractArtifactError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toBe(`contract artifact ingestion refused: ${code}`);
  }
}
/** Independent byte preimage oracle: manual fixed-width hex, no production encoder. */
function oracle(
  descriptors: readonly ContractArtifactInput[],
  schemas: readonly ContractArtifactInput[],
): string {
  const rows = [
    ...descriptors.map((r) => ({ ...r, tag: "00" })),
    ...schemas.map((r) => ({ ...r, tag: "01" })),
  ].sort((a, b) => Buffer.compare(Buffer.from(a.retrievalUri), Buffer.from(b.retrievalUri)));
  const chunks = [
    Buffer.from("bdp-contract-artifacts-1\0"),
    Buffer.from(rows.length.toString(16).padStart(8, "0"), "hex"),
  ];
  for (const row of rows) {
    const uri = Buffer.from(row.retrievalUri);
    chunks.push(
      Buffer.from(row.tag + uri.length.toString(16).padStart(8, "0"), "hex"),
      uri,
      Buffer.from(row.utf8Bytes.length.toString(16).padStart(16, "0"), "hex"),
      Buffer.from(row.utf8Bytes),
    );
  }
  return createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
}

describe("private exact contract artifact candidates", () => {
  it.each([
    "parseCanonicalHttpUrl",
    "decodeJsonDocument",
    "parseTypeDescriptor",
    "createTypeConformanceIndex",
  ] as const)("isolates unexpected %s failures from input refusals", (dependency) => {
    const inputs = [descriptor(bead)];
    const spy = vi.spyOn(protocol, dependency).mockImplementationOnce(() => {
      throw new Error("private dependency path and artifact payload");
    });
    try {
      let failure: unknown;
      try {
        ingest(inputs);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(ContractArtifactError);
      expect(failure).toMatchObject({
        name: "ContractArtifactLocalError",
        code: "local-failure",
        message: "contract artifact ingestion failed locally",
      });
      expect(failure).not.toHaveProperty("cause");
      expect(String(failure)).not.toContain("payload");
    } finally {
      spy.mockRestore();
    }
    expect(ingest(inputs).descriptors[0]).toEqual(bead);
    refuses(() => ingest([descriptor({ ...bead, name: "" })]), "descriptor");
  });
  it("keeps unexpected decoder TypeErrors local without copying exception details", () => {
    const inputs = [descriptor(bead)];
    const spy = vi.spyOn(TextDecoder.prototype, "decode").mockImplementationOnce(() => {
      throw new TypeError("private decoder failure");
    });
    try {
      expect(() => ingest(inputs)).toThrow("contract artifact ingestion failed locally");
    } finally {
      spy.mockRestore();
    }
    expect(ingest(inputs).descriptors[0]).toEqual(bead);
    refuses(() => ingest([], [{ retrievalUri: s, utf8Bytes: new Uint8Array([0xff]) }]), "utf8");
  });
  it("retains immutable nested ownership and shared receipt statistics", () => {
    const result = ingest([
      descriptor({ ...bead, ownsOutgoing: { [l]: { max: 2, label: "owned" }, "*": { max: 3 } } }),
      descriptor(link),
    ]);
    const owner = result.descriptors.find((d) => d.id === b);
    expect(owner?.describes).toBe("bead");
    if (owner?.describes !== "bead") throw new Error("missing owner");
    const declaration = owner.ownsOutgoing?.[l];
    expect(declaration).toEqual({ max: 2, label: "owned" });
    expect(() => Object.assign(declaration ?? {}, { max: 1, label: "changed" })).toThrow(TypeError);
    expect(owner.ownsOutgoing?.[l]).toEqual({ max: 2, label: "owned" });
    for (const value of [
      result,
      result.artifacts,
      result.descriptors,
      result.receipt,
      result.receipt.limits,
      result.conformance,
      result.conformance.statistics,
      owner,
      owner.ownsOutgoing,
      declaration,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(result.receipt.conformance).toBe(result.conformance.statistics);
    expect(result.receipt.conformance).toEqual({
      nodes: 2,
      edges: 0,
      depth: 1,
      memberships: 2,
      unionAttempts: 0,
    });
    expect(() => Object.assign(result.receipt.conformance, { nodes: 99 })).toThrow(TypeError);
    expect(result.receipt.conformance.nodes).toBe(2);
  });
  it("handles long interior and trailing zero coefficients with exact decimal semantics", () => {
    const zeroes = "0".repeat(100_000);
    const input = (number: string) =>
      artifact(
        b,
        JSON.stringify({ ...bead, ownsOutgoing: { "*": { max: "TOKEN" } } }).replace(
          '"TOKEN"',
          number,
        ),
      );
    refuses(() => ingest([input(`1${zeroes}1`)]), "descriptor-number");
    const accepted = input(`1${zeroes}e-100000`);
    const result = ingest([accepted]);
    expect(result.descriptors[0]).toMatchObject({ ownsOutgoing: { "*": { max: 1 } } });
    expect(result.artifacts[0]?.bytesBase64).toBe(
      Buffer.from(accepted.utf8Bytes).toString("base64"),
    );
  });
  it("refuses wide arrays beyond the remaining syntax budget and preserves exact counts", () => {
    const wide = artifact(s, `[${"0,".repeat(100_000)}0]`);
    refuses(() => ingest([], [wide], { syntaxNodes: 1 }), "limit");
    expect(ingest([], [artifact(s, "[0,0,0]")], { syntaxNodes: 4 }).receipt.syntaxNodes).toBe(4);
    refuses(() => ingest([], [artifact(s, "[0,0,0]")], { syntaxNodes: 3 }), "limit");
    expect(ingest([], [artifact(s, "[]")], { syntaxNodes: 1 }).receipt.syntaxNodes).toBe(1);
  });
  it("classifies a detached byte source as invalid input", () => {
    const bytes = new Uint8Array([48]);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    refuses(() => ingest([], [{ retrievalUri: s, utf8Bytes: bytes }]), "input-shape");
  });
  it("pins immutable raw bytes and a separately reconstructed digest across order/duplicates/limits", () => {
    const d = [descriptor(link), descriptor(bead)];
    const schema = artifact(
      s,
      '{ "maximum":9007199254740993,"multipleOf":0.1,"const":1e99999999999999999999999,"x":-0 }',
    );
    const result = ingest(d, [schema]);
    expect(result.sha256).toBe(oracle(d, [schema]));
    expect(ingest([...d].reverse(), [schema]).sha256).toBe(result.sha256);
    expect(ingest([...d, d[0] as ContractArtifactInput], [schema, schema]).sha256).toBe(
      result.sha256,
    );
    expect(ingest(d, [schema], { maxOwnershipMax: 1 }).sha256).toBe(result.sha256);
    const saved = result.artifacts.map((entry) => ({ ...entry }));
    for (const input of [...d, schema]) input.utf8Bytes.fill(0);
    expect(result.artifacts).toEqual(saved);
    for (const entry of result.artifacts) {
      const decoded = Buffer.from(entry.bytesBase64, "base64");
      expect(decoded.length).toBe(entry.byteLength);
      expect(createHash("sha256").update(decoded).digest("hex")).toBe(entry.sha256);
      expect(decoded.toString("base64")).toBe(entry.bytesBase64);
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(Buffer.from(result.artifacts[0]?.bytesBase64 ?? "", "base64").toString()).toContain(
      "9007199254740993",
    );
    expect(() => Object.assign(result, { sha256: "changed" })).toThrow(TypeError);
    expect(() => Object.assign(result.artifacts[0] ?? {}, { bytesBase64: "changed" })).toThrow(
      TypeError,
    );
    expect(() => Object.assign(result.descriptors[0]?.conformsTo ?? {}, { 0: "changed" })).toThrow(
      TypeError,
    );
    expect(result).not.toHaveProperty("get");
    expect(result).not.toHaveProperty("installed");
  });
  it("uses raw identity equality, rejects conflicting bytes/kinds and observes a one-byte difference", () => {
    const original = artifact(s, "true");
    const changed = artifact(s, "true ");
    expect(ingest([], [original]).sha256).not.toBe(ingest([], [changed]).sha256);
    refuses(() => ingest([], [original, changed]), "identity-conflict");
    const d = descriptor(bead);
    refuses(() => ingest([d], [d]), "identity-conflict");
    refuses(() => ingest([d, artifact(b, `${JSON.stringify(bead)} `)]), "identity-conflict");
  });
  it("only admits schema syntax, without reading dialect, references, anchors or keyword values", () => {
    for (const text of [
      "null",
      "42",
      '"not a schema"',
      '{"$schema":"other","$ref":"https://missing.test/","$anchor":2}',
      '{"additionalProperties":false}',
      '{"definitions":{"x":{"$id":"bad"}}}',
    ]) {
      const a = artifact(s, text);
      const result = ingest([], [a]);
      expect(result.artifacts[0]?.bytesBase64).toBe(Buffer.from(text).toString("base64"));
      expect(result.sha256).toBe(oracle([], [a]));
    }
  });
  it.each([
    ["invalid UTF-8", new Uint8Array([0xc0, 0xaf]), "utf8"],
    ["UTF-8 surrogate", new Uint8Array([0xed, 0xa0, 0x80]), "utf8"],
    ["BOM", Buffer.from("\ufeff{}"), "json-syntax"],
    ["duplicate decoded name", Buffer.from('{"a":1,"\\u0061":2}'), "json-syntax"],
    ["lone value surrogate", Buffer.from('"\\ud800"'), "json-syntax"],
    ["lone key surrogate", Buffer.from('{"\\udc00":0}'), "json-syntax"],
    ["malformed JSON", Buffer.from("[1,]"), "json-syntax"],
  ] as const)("refuses %s for both byte classes without exposing payload", (_name, bytes, code) => {
    refuses(() => ingest([], [{ retrievalUri: s, utf8Bytes: bytes }]), code);
    refuses(() => ingest([{ retrievalUri: b, utf8Bytes: bytes }]), code);
  });
  it("passes whole checked descriptors and exact integral spellings through closed validation", () => {
    for (const max of ["1", "1.0", "1e0", "10e-1", "1000e-3", "0.0001e4", "9007199254740991"]) {
      const input = artifact(
        b,
        `{"id":"${b}","name":"B","describes":"bead","conformsTo":[],"ownsOutgoing":{"*":{"max":${max}}}}`,
      );
      const result = ingest([input]);
      expect(result.descriptors[0]).toMatchObject({ ownsOutgoing: { "*": { max: Number(max) } } });
      expect(result.artifacts[0]?.bytesBase64).toBe(
        Buffer.from(input.utf8Bytes).toString("base64"),
      );
    }
    for (const max of [
      "1.1",
      "1e-999999999999999",
      "1e999999999999999",
      "9007199254740992",
      "9007199254740993",
      "-9007199254740992",
    ]) {
      const text = JSON.stringify({ ...bead, ownsOutgoing: { "*": { max: "TOKEN" } } }).replace(
        '"TOKEN"',
        max,
      );
      refuses(() => ingest([artifact(b, text)]), "descriptor-number");
    }
    for (const max of ["0", "-0", "0e99999999999999", "-1"]) {
      const text = JSON.stringify({ ...bead, ownsOutgoing: { "*": { max: "TOKEN" } } }).replace(
        '"TOKEN"',
        max,
      );
      refuses(() => ingest([artifact(b, text)]), "descriptor");
    }
  });
  it("keeps unknown members, category rules, canonical identities and wildcard comparison", () => {
    for (const value of [
      { ...bead, extra: 1 },
      { ...bead, extra: { nested: 1 } },
      { ...bead, ownsOutgoing: { "*": { max: 2, label: "bad" } } },
      { ...bead, ownsOutgoing: { [l]: { max: 1, extra: true } } },
      { ...link, source: { conformsTo: [], extra: 1 } },
      { ...link, ownsOutgoing: { "*": { max: 1 } } },
      { ...bead, source: { conformsTo: [] } },
      { ...bead, conformsTo: [b, b] },
      { ...bead, name: "" },
      { ...bead, ownsOutgoing: { "*": { max: 1 }, [l]: { max: 2 } } },
    ])
      refuses(() => ingest([descriptor(value)]), "descriptor");
    refuses(() => ingest([artifact(b, JSON.stringify({ ...bead, id: l }))]), "descriptor");
    for (const uri of [
      "https://u:p@types.test/bead",
      `${b}#x`,
      "https://types.test:443/bead",
      "https://types.test/%2f",
      "relative",
    ])
      refuses(() => ingest([], [artifact(uri, "true")]), "retrieval-uri");
    expect(
      ingest([descriptor({ ...bead, propertiesSchema: "https://schemas.test:443/p" })])
        .descriptors[0],
    ).toHaveProperty("propertiesSchema", "https://schemas.test:443/p");
  });
  it("resolves descriptor-only dependencies and permits ownership/endpoint dependency cycles", () => {
    const owner = descriptor({
      ...bead,
      ownsOutgoing: { [l]: { max: 2, label: "owned" }, "*": { max: 3 } },
    });
    const result = ingest([owner, descriptor(link)]);
    expect(result.receipt.dependencyReferences).toBe(2);
    expect(result.conformance.statistics.edges).toBe(0);
    expect(result.descriptors[0]).toHaveProperty("ownsOutgoing");
    refuses(() => ingest([owner]), "descriptor-dependency");
    refuses(() => ingest([descriptor(link)]), "descriptor-dependency");
    refuses(
      () => ingest([descriptor({ ...bead, conformsTo: [l] }), descriptor(link)]),
      "descriptor-dependency",
    );
    refuses(
      () => ingest([descriptor({ ...bead, ownsOutgoing: { [b]: { max: 1 } } })]),
      "descriptor-dependency",
    );
    refuses(
      () => ingest([descriptor(bead), descriptor({ ...link, target: { conformsTo: [l] } })]),
      "descriptor-dependency",
    );
    refuses(() => ingest([descriptor({ ...bead, conformsTo: [b] })]), "conformance");
  });
  it("measures exact syntax positions and deep containers without a recursive syntax walk", () => {
    expect(ingest([], [artifact(s, '{"a":[1,true],"b":null}')]).receipt.syntaxNodes).toBe(7);
    const text = `${"[".repeat(4096)}0${"]".repeat(4096)}`;
    const result = ingest([], [artifact(s, text)]);
    expect(result.receipt.syntaxNodes).toBe(4097);
    expect(result.artifacts[0]?.bytesBase64).toBe(Buffer.from(text).toString("base64"));
    refuses(() => ingest([], [artifact(s, `[${text}]`)]), "limit");
    const unknown = `${JSON.stringify(bead).slice(0, -1)},"extra":${"[".repeat(32)}0${"]".repeat(32)}}`;
    refuses(() => ingest([artifact(b, unknown)]), "limit");
  });
  it("counts submitted duplicates and URI bytes separately before deduplication", () => {
    const a = artifact("https://a.test/schema", "0");
    const one = ingest([], [a]);
    expect(one.receipt.submittedBytes).toBe(1);
    expect(one.receipt.submittedUriBytes).toBe(Buffer.byteLength(a.retrievalUri));
    expect(ingest([], [a, a]).sha256).toBe(one.sha256);
    refuses(() => ingest([], [a, a], { schemas: 1 }), "limit");
    refuses(() => ingest([], [a, a], { submittedArtifacts: 1 }), "limit");
    const length = Buffer.byteLength(a.retrievalUri);
    expect(
      ingest([], [a], { artifactBytes: length, totalBytes: length }).receipt.submittedUriBytes,
    ).toBe(length);
    refuses(() => ingest([], [a], { artifactBytes: length - 1 }), "limit");
    expect(ingest([], [a, a], { totalBytes: 2 * length }).receipt.submittedUriBytes).toBe(
      2 * length,
    );
    refuses(() => ingest([], [a, a], { totalBytes: 2 * length - 1 }), "limit");
    expect(one.receipt.submittedBytes).toBe(1); // URI counter did not change raw accounting.
  });
  it("rejects unsupported shapes without invoking getters or caller iterators", () => {
    const bad: unknown[] = [
      null,
      {},
      { descriptors: [], schemas: [], limits: CONTRACT_ARTIFACT_CEILINGS, extra: true },
    ];
    for (const input of bad) refuses(() => ingestContractArtifacts(input as never), "input-shape");
    const input = { descriptors: [], schemas: [], limits: CONTRACT_ARTIFACT_CEILINGS };
    Object.defineProperty(input, "schemas", {
      get() {
        throw new Error("getter invoked");
      },
    });
    refuses(() => ingestContractArtifacts(input), "input-shape");
    refuses(
      () =>
        ingestContractArtifacts(
          new Proxy({ descriptors: [], schemas: [], limits: CONTRACT_ARTIFACT_CEILINGS }, {}),
        ),
      "input-shape",
    );
    refuses(() => ingest([], new Array(1)), "input-shape");
    const bytes = Buffer.from("true");
    Object.defineProperty(bytes, "length", {
      get() {
        throw new Error("length getter invoked");
      },
    });
    Object.defineProperty(bytes, Symbol.iterator, {
      value() {
        throw new Error("iterator invoked");
      },
    });
    expect(ingest([], [{ retrievalUri: s, utf8Bytes: bytes }]).artifacts[0]?.byteLength).toBe(4);
  });
});

describe("independent administrative boundaries", () => {
  // Small but nontrivial input: one parent edge, endpoint refs and a whole-set bound.
  const parent = "https://types.test/parent";
  const descriptors = [
    descriptor({ ...bead, conformsTo: [parent], ownsOutgoing: { "*": { max: 2 } } }),
    descriptor({ ...bead, id: parent }),
    descriptor(link),
  ];
  const schema = artifact(s, '[{"x":1}]');
  const initial = ingest(descriptors, [schema]);
  const measured: ContractArtifactLimits = {
    ...CONTRACT_ARTIFACT_CEILINGS,
    submittedArtifacts: 4,
    descriptors: 3,
    schemas: 1,
    artifactBytes: Math.max(...descriptors.map((a) => a.utf8Bytes.length), schema.utf8Bytes.length),
    totalBytes: initial.receipt.submittedBytes,
    descriptorDepth: 3,
    schemaDepth: 2,
    syntaxNodes: initial.receipt.syntaxNodes,
    dependencyReferences: initial.receipt.dependencyReferences,
    conformanceEdges: initial.conformance.statistics.edges,
    conformanceDepth: initial.conformance.statistics.depth,
    effectiveMemberships: initial.conformance.statistics.memberships,
    unionAttempts: initial.conformance.statistics.unionAttempts,
    maxOwnershipMax: 2,
  };
  it.each(Object.keys(measured) as (keyof ContractArtifactLimits)[])(
    "accepts exact %s and refuses one below",
    (key) => {
      expect(ingest(descriptors, [schema], { [key]: measured[key] }).sha256).toBe(initial.sha256);
      const code = [
        "conformanceEdges",
        "conformanceDepth",
        "effectiveMemberships",
        "unionAttempts",
      ].includes(key)
        ? "conformance"
        : "limit";
      refuses(() => ingest(descriptors, [schema], { [key]: measured[key] - 1 }), code);
    },
  );
  it("rejects every attempted implementation-ceiling raise and invalid primitive", () => {
    for (const key of Object.keys(CONTRACT_ARTIFACT_CEILINGS) as (keyof ContractArtifactLimits)[]) {
      refuses(() => ingest([], [], { [key]: CONTRACT_ARTIFACT_CEILINGS[key] + 1 }), "limit");
      for (const value of [-1, 1.5, NaN, Infinity, "1", undefined])
        refuses(() => ingest([], [], { [key]: value } as never), "limit");
    }
  });
  it("charges broad diamond union attempts rather than only novel ancestors", () => {
    const base = descriptor({ ...bead, id: parent });
    const children = Array.from({ length: 12 }, (_, n) =>
      descriptor({ ...bead, id: `https://types.test/child${n}`, conformsTo: [parent] }),
    );
    const top = descriptor({ ...bead, conformsTo: children.map((a) => a.retrievalUri) });
    const inputs = [top, ...children, base];
    const actual = ingest(inputs);
    expect(actual.conformance.statistics).toEqual({
      nodes: 14,
      edges: 24,
      depth: 3,
      memberships: 39,
      unionAttempts: 36,
    });
    expect(ingest([...inputs].reverse()).sha256).toBe(actual.sha256);
    refuses(() => ingest(inputs, [], { unionAttempts: 35 }), "conformance");
    refuses(() => ingest([...inputs].reverse(), [], { effectiveMemberships: 38 }), "conformance");
  });
});
