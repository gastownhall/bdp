import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  READ_VALUE_SCHEMA_REFS,
  HISTORY_VALUE_SCHEMA_REFS,
  READ_UPDATE_VALUE_SCHEMA_REFS,
  JsonNumberLiteral,
  JsonSyntaxError,
  ReadUpdateCarrierError,
  ProtocolArtifactValidationError,
  parseReadUpdateRequest,
  parseReadUpdateSequenceRequest,
  admitReadUpdateOperationNumbers,
  parseReadUpdateMutationResult,
  parseReadUpdateAliasResult,
  parseReadUpdateSequenceResponse,
  parseReadUpdateDiscovery,
  parseReadUpdateOperationDirectory,
  parseReadUpdateProblem,
  parseReadUpdateSequenceMemberProblem,
  type ReadUpdateOperation,
} from "./index.js";

const type = "https://types.example/task";
const bead = { id: "https://example.test/s/beads/a", type, revision: "r1", properties: {} };
const problem = {
  type: "https://github.com/gastownhall/bdp/problems/validation",
  code: "validation-failed",
  status: 422,
  retry: "never",
  diagnostics: [{ instanceLocation: "/properties/n", message: "inadmissible number" }],
};
const sequence = (operations: unknown[]): string => JSON.stringify({ operations });
const create = { operation: "createBead", idempotencyKey: "create", name: "a", type };

describe("RU unadmitted carriers", () => {
  it.each([
    ["createBead", { type, changeContext: { agent: null, message: "" } }],
    [
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "replace", path: "/n", value: 1 }] },
    ],
    ["deleteBead", { bead: "beads/a" }],
    ["createLink", { type, source: "beads/a", target: { uri: "urn:outside", revision: "old" } }],
    ["updateLinkProperties", { link: "links/a", change: [{ op: "remove", path: "/n" }] }],
    ["deleteLink", { link: "links/a", changeContext: { message: "removed" } }],
    ["putAlias", { alias: "alias/a", target: "beads/a" }],
    ["deleteAlias", { alias: "alias/a" }],
  ] as const)("parses %s using its actual singleton schema", (kind, input) => {
    const result = parseReadUpdateRequest(kind, JSON.stringify(input));
    expect(admitReadUpdateOperationNumbers(result)).toEqual({ ok: true, input });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.input)).toBe(true);
  });
  it("keeps per-operation bad numbers lossless after carrier validation", () => {
    const parsed = parseReadUpdateSequenceRequest(
      `{"operations":[{"operation":"createBead","idempotencyKey":"one","type":"${type}","properties":{"n":1}},{"operation":"createBead","idempotencyKey":"two","type":"${type}","properties":{"n":9007199254740993,"overflow":1e9999}}]}`,
    );
    const [first, second] = parsed.operations;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;
    expect(admitReadUpdateOperationNumbers(first).ok).toBe(true);
    expect(second.input.properties).toEqual({
      n: new JsonNumberLiteral("9007199254740993"),
      overflow: new JsonNumberLiteral("1e9999"),
    });
    expect(admitReadUpdateOperationNumbers(second)).toEqual({
      ok: false,
      offending: [
        { pointer: "/properties/n", literal: "9007199254740993" },
        { pointer: "/properties/overflow", literal: "1e9999" },
      ],
    });
  });
  it("reports patch value pointers without turning semantic number refusal into syntax", () => {
    const parsed = parseReadUpdateRequest(
      "updateBeadProperties",
      '{"bead":"beads/a","change":[{"op":"add","path":"/x","value":{"a/b":[1e-9999]}}]}',
    );
    expect(admitReadUpdateOperationNumbers(parsed)).toEqual({
      ok: false,
      offending: [{ pointer: "/change/0/value/a~1b/0", literal: "1e-9999" }],
    });
  });
  it.each([
    [create, { ...create, name: "b" }],
    [create, { ...create, idempotencyKey: "other" }],
    [{ operation: "deleteBead", idempotencyKey: "d", bead: "@a" }, create],
    [create, { operation: "deleteLink", idempotencyKey: "d", link: "@a" }],
    [
      {
        operation: "createLink",
        idempotencyKey: "l",
        name: "self",
        type,
        source: "@self",
        target: "urn:x",
      },
    ],
    [
      create,
      {
        operation: "createLink",
        idempotencyKey: "l",
        type,
        source: { uri: "@unknown", revision: "p" },
        target: "@a",
      },
    ],
  ])(
    "rejects all statically invalid keys/names/bindings %# before member admission",
    (...members) => {
      expect(() => parseReadUpdateSequenceRequest(sequence(members))).toThrow(
        ReadUpdateCarrierError,
      );
    },
  );
  it("allows earlier right-kind bare and pinned bindings without resolving state", () => {
    const members = [
      create,
      {
        operation: "createLink",
        idempotencyKey: "l",
        name: "edge",
        type,
        source: "@a",
        target: { uri: "@a", revision: "expected" },
      },
      { operation: "deleteLink", idempotencyKey: "d", link: "@edge" },
      { operation: "putAlias", idempotencyKey: "p", alias: "alias/lead", target: "@a" },
    ];
    expect(parseReadUpdateSequenceRequest(sequence(members)).operations).toHaveLength(4);
  });
  it("does not scan arbitrary properties strings as local bindings", () => {
    expect(
      parseReadUpdateSequenceRequest(sequence([{ ...create, properties: { quoted: "@unknown" } }]))
        .operations,
    ).toHaveLength(1);
  });
  it.each([
    ["deleteBead", { bead: "beads/a", changeContext: {} }],
    ["putAlias", { alias: "alias/a", target: "beads/a", changeContext: {} }],
    ["deleteBead", { bead: "@a" }],
    ["createBead", { type, name: "a" }],
    ["createBead", { type, operation: "createBead" }],
    ["createBead", { type, idempotencyKey: "body-key" }],
    ["createBead", { type, changeContext: { committedAt: "now" } }],
    [
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "add", path: "/bad~2", value: 1 }] },
    ],
    ["updateBeadProperties", { bead: "beads/a", change: [{ op: "test", path: "/n", value: 1 }] }],
  ] as const)("rejects closed/static singleton syntax %#", (kind, input) => {
    expect(() => parseReadUpdateRequest(kind, JSON.stringify(input))).toThrow(
      ReadUpdateCarrierError,
    );
  });
  it("late Unicode/duplicate faults reject the whole sequence even after a good member", () => {
    const prefix = `{"operations":[${JSON.stringify(create)},`;
    expect(() =>
      parseReadUpdateSequenceRequest(
        `${prefix}{"operation":"deleteBead","idempotencyKey":"d","bead":"beads/a","bead":"beads/b"}]}`,
      ),
    ).toThrow(JsonSyntaxError);
    expect(() =>
      parseReadUpdateSequenceRequest(
        `${prefix}{"operation":"deleteBead","idempotencyKey":"d","bead":"\\ud800"}]}`,
      ),
    ).toThrow(JsonSyntaxError);
  });
  it("does not invent numeric admission or a default from context omission", () => {
    const omitted = parseReadUpdateRequest("createBead", JSON.stringify({ type }));
    const empty = parseReadUpdateRequest("createBead", JSON.stringify({ type, changeContext: {} }));
    const absent = parseReadUpdateRequest(
      "createBead",
      JSON.stringify({ type, changeContext: { agent: null } }),
    );
    expect(omitted.input).not.toHaveProperty("changeContext");
    expect(empty.input.changeContext).toEqual({});
    expect(absent.input.changeContext).toEqual({ agent: null });
    // Default/equality normalization belongs to the authority, not wire parsing.
    expect(() =>
      admitReadUpdateOperationNumbers({ operation: "createBead", input: { type } }),
    ).toThrow(TypeError);
  });
  it("handles a deeply nested raw property without inheriting artifact-reader depth limits", () => {
    const result = parseReadUpdateRequest(
      "createBead",
      `{"type":"${type}","properties":{"deep":${"[".repeat(10000)}0${"]".repeat(10000)}}}`,
    );
    expect(admitReadUpdateOperationNumbers(result).ok).toBe(true);
  });
});

describe("RU parser boundary regressions", () => {
  it.each([
    "alias/a//b",
    "alias/../a",
    "alias/%2f",
    "alias/%61",
    "/alias/a",
    "alias/a/",
    "alias/a?x=1",
    "https://example.test/s/alias/a?x=1",
  ])("rejects invalid alias path syntax %s", (alias) => {
    expect(() => parseReadUpdateRequest("deleteAlias", JSON.stringify({ alias }))).toThrow(
      ReadUpdateCarrierError,
    );
  });
  it("leaves well-formed wrong-root aliases for member-time resource-not-found", () => {
    expect(parseReadUpdateRequest("deleteAlias", '{"alias":"beads/a"}').input.alias).toBe(
      "beads/a",
    );
  });
  it("rejects invalid Unicode in a received nested response extension", () => {
    expect(() => parseReadUpdateProblem({ ...problem, trace: { bad: "\ud800" } })).toThrow(
      ProtocolArtifactValidationError,
    );
  });
});

describe("canonical RU response parsers", () => {
  it("keeps RU roots separate from existing Read surfaces", () => {
    expect(Object.values(READ_UPDATE_VALUE_SCHEMA_REFS)).toContain("#/$defs/sequenceRequest");
    expect(Object.values(READ_VALUE_SCHEMA_REFS)).not.toContain("#/$defs/sequenceRequest");
    expect(Object.values(HISTORY_VALUE_SCHEMA_REFS)).not.toContain("#/$defs/sequenceRequest");
  });
  it("snapshots nested result values and parses actual History context", () => {
    const input = {
      outcome: "created",
      resource: {
        ...bead,
        properties: { n: { x: 1 } },
        changeContext: {
          committedAt: { state: "present", value: "2026-09-10T00:00:00Z" },
          agent: { state: "undetermined" },
          message: { state: "absent" },
        },
      },
    };
    const parsed = parseReadUpdateMutationResult(input);
    input.resource.properties.n.x = 2;
    expect(parsed.resource?.properties.n).toEqual({ x: 1 });
    expect(Object.isFrozen(parsed.resource?.properties.n)).toBe(true);
    expect(() =>
      parseReadUpdateMutationResult({ ...input, source: bead.id, sourceRevision: "r2" }),
    ).toThrow(ProtocolArtifactValidationError);
  });
  it("validates sequence order/count/names against the request without runtime grants", () => {
    const request = parseReadUpdateSequenceRequest(sequence([create]));
    const entry = { outcome: "created", resource: bead, operationIndex: 0, operationName: "a" };
    expect(parseReadUpdateSequenceResponse({ results: [entry] }, request).results).toHaveLength(1);
    expect(() =>
      parseReadUpdateSequenceResponse({ results: [{ ...entry, operationIndex: 1 }] }, request),
    ).toThrow(/indexes/);
    expect(() =>
      parseReadUpdateSequenceResponse({ results: [{ ...entry, operationName: "wrong" }] }, request),
    ).toThrow(/name/);
    expect(() =>
      parseReadUpdateSequenceResponse(
        { results: [entry, { ...entry, operationIndex: 1 }] },
        request,
      ),
    ).toThrow(/count/);
  });
  it("preserves Problem extensions but enforces diagnostics, retry and erased-pointer law", () => {
    expect(parseReadUpdateProblem({ ...problem, trace: { token: "opaque" } })).toHaveProperty(
      "trace.token",
      "opaque",
    );
    expect(() => parseReadUpdateProblem({ ...problem, diagnostics: [] })).toThrow(
      ProtocolArtifactValidationError,
    );
    expect(() => parseReadUpdateProblem({ ...problem, status: 400 })).toThrow(
      ProtocolArtifactValidationError,
    );
    expect(() => parseReadUpdateProblem({ ...problem, retryAfter: 2 })).toThrow(
      ProtocolArtifactValidationError,
    );
    const erased = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "resource-erased",
      status: 410,
      retry: "never",
    };
    expect(parseReadUpdateProblem({ ...erased, trace: "harmless" })).toHaveProperty("trace");
    expect(() => parseReadUpdateProblem({ ...erased, pointer: "/private" })).toThrow(
      ProtocolArtifactValidationError,
    );
  });
  it("allows write allocation member failure but excludes all five History read diagnoses", () => {
    const allocation = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "revision-allocation-unsafe",
      status: 409,
      retry: "after-state-change",
      operationIndex: 0,
    };
    expect(parseReadUpdateSequenceMemberProblem(allocation).code).toBe(
      "revision-allocation-unsafe",
    );
    expect(() => parseReadUpdateSequenceMemberProblem({ ...allocation, pointer: "/n" })).toThrow();
    for (const [code, family, status, retry] of [
      ["revision-unknown", "not-found", 404, "after-state-change"],
      ["revision-unretained", "conflict", 409, "after-state-change"],
      ["revision-reorganized", "gone", 410, "after-state-change"],
      ["revision-not-tracked", "conflict", 409, "after-state-change"],
      ["revision-unrepresentable", "conflict", 409, "after-state-change"],
    ]) {
      const direct = {
        type: `https://github.com/gastownhall/bdp/problems/${family}`,
        code,
        status,
        retry,
        ...(code === "revision-unretained"
          ? { missing: { complete: true, items: [{ kind: "record" }] } }
          : {}),
      };
      expect(parseReadUpdateProblem(direct).code).toBe(code);
      expect(() =>
        parseReadUpdateSequenceResponse({ results: [{ ...direct, operationIndex: 0 }] }),
      ).toThrow(ProtocolArtifactValidationError);
    }
  });
  it("requires RU aliases/operations and exact directory names", () => {
    const input = {
      bdpVersion: "0.1",
      profile: "read-update",
      scope: "https://example.test/s/",
      beads: "https://example.test/s/beads/",
      links: "https://example.test/s/links/",
      types: "https://example.test/s/types/",
      operations: "https://example.test/s/operations/",
      aliases: "https://example.test/s/alias/",
    };
    // Take the actual version from the canonical bundle, not a duplicated version policy.
    const bundle = JSON.parse(
      readFileSync(new URL("../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
    );
    input.bdpVersion = bundle.$defs.bdpVersion.const;
    expect(parseReadUpdateDiscovery(input).profile).toBe("read-update");
    expect(() => parseReadUpdateDiscovery({ ...input, aliases: undefined })).toThrow();
    const directory = Object.fromEntries(
      Object.entries(bundle.$defs.readUpdateOperationDirectory.properties).map(([key, value]) => [
        key,
        (value as { const: string }).const,
      ]),
    );
    expect(parseReadUpdateOperationDirectory(directory)).toEqual(directory);
    expect(() => parseReadUpdateOperationDirectory({ ...directory, sequence: "batch" })).toThrow();
    expect(
      parseReadUpdateAliasResult({ outcome: "deleted", alias: "https://example.test/s/alias/a" }),
    ).toHaveProperty("outcome", "deleted");
  });
  it("parses every positive canonical RU fixture exchange using the shipped APIs", () => {
    const dir = new URL("../../../fixtures/read-update/", import.meta.url);
    let requests = 0;
    let responses = 0;
    for (const name of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const fixture = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
      for (const exchange of fixture.exchanges ?? []) {
        const req = exchange.request;
        const res = exchange.response;
        // Narrated negative fixtures deliberately carry invalid request bodies.
        if (req.schema && req.body && res.status === 200) {
          const definition = req.schema.split("/").at(-1);
          if (definition === "sequenceRequest")
            parseReadUpdateSequenceRequest(JSON.stringify(req.body));
          else {
            const operation = Object.entries(READ_UPDATE_VALUE_SCHEMA_REFS).find(
              ([, ref]) => ref === req.schema,
            )?.[0];
            if (
              operation &&
              [
                "createBead",
                "updateBeadProperties",
                "deleteBead",
                "createLink",
                "updateLinkProperties",
                "deleteLink",
                "putAlias",
                "deleteAlias",
              ].includes(operation)
            )
              parseReadUpdateRequest(operation as ReadUpdateOperation, JSON.stringify(req.body));
          }
          requests++;
        }
        const parsers: Record<string, (value: unknown) => unknown> = {
          mutationResult: parseReadUpdateMutationResult,
          aliasResult: parseReadUpdateAliasResult,
          sequenceResponse: parseReadUpdateSequenceResponse,
          readUpdateProblem: parseReadUpdateProblem,
          readUpdateDiscovery: parseReadUpdateDiscovery,
          readUpdateOperationDirectory: parseReadUpdateOperationDirectory,
        };
        const parser = parsers[res.schema?.split("/").at(-1)];
        if (parser) {
          parser(res.body);
          responses++;
        }
      }
    }
    expect(requests).toBeGreaterThan(20);
    expect(responses).toBeGreaterThan(20);
  });
});
