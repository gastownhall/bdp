import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  HISTORY_VALUE_SCHEMA_REFS,
  HISTORY_WRITE_VALUE_SCHEMA_REFS,
  HistoryQueryError,
  hasHistoryQueryIntent,
  historyUnretainedProblem,
  parseChangeContext,
  parseChangeContextInput,
  parseHistoricalBeadRecord,
  parseHistoricalLinkRecord,
  parseHistoryCapability,
  parseHistoryMissing,
  parseHistoryQuery,
  parseHistoryVersionsPage,
  parseReadProblem,
  parseRevisionAllocationUnsafeProblem,
  ProtocolArtifactValidationError,
} from "./index.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

type RecordValue = Record<string, unknown>;
const root = new URL("../../../", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("schemas/bdp-v0.schema.json", root), "utf8"));
const fixture = JSON.parse(readFileSync(new URL("fixtures/history/wire.json", root), "utf8")) as {
  examples: { id: string; schema: string; condition: string; body: RecordValue }[];
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
ajv.addSchema(schema);
const validate = (name: string, value: unknown) =>
  ajv.validate(`${schema.$id}#/$defs/${name}`, value);
function example(id: string): RecordValue {
  const found = fixture.examples.find((item) => item.id === id);
  if (!found) throw new Error(`Missing independent illustration ${id}`);
  return structuredClone(found.body);
}
const subject = "https://work.example/scope/beads/decision";
const link = "https://work.example/scope/links/citation";

// These are structural, parser and protocol-table checks, not observed History behavior.
describe("History wire illustrations", () => {
  for (const item of fixture.examples)
    it(`accepts narrated ${item.id}`, () => {
      expect(item.condition.length).toBeGreaterThan(0);
      expect(
        ajv.validate(`${schema.$id}${item.schema}`, item.body),
        JSON.stringify(ajv.errors),
      ).toBe(true);
    });

  it("keeps parser roots explicit and write roots outside the History Read registry", () => {
    expect(HISTORY_VALUE_SCHEMA_REFS).toEqual({
      capability: "#/$defs/historyCapability",
      context: "#/$defs/changeContext",
      missing: "#/$defs/historyMissing",
      versions: "#/$defs/historyVersionsPage",
      bead: "#/$defs/historicalBeadRecord",
      link: "#/$defs/historicalLinkRecord",
    });
    expect(HISTORY_WRITE_VALUE_SCHEMA_REFS).toEqual({
      contextInput: "#/$defs/changeContextInput",
      allocation: "#/$defs/revisionAllocationUnsafeProblem",
    });
  });

  it("admits complete capability on each profile and rejects deferred advertisement", () => {
    expect(parseHistoryCapability({ version: 1 })).toEqual({ version: 1 });
    for (const name of ["readDiscovery", "readUpdateDiscovery", "transactionalDiscovery"]) {
      const profile =
        name === "readDiscovery"
          ? "read"
          : name === "readUpdateDiscovery"
            ? "read-update"
            : "transactional";
      const discovery = example(`discovery-${profile}`);
      expect(validate(name, discovery)).toBe(true);
      for (const historicalResolution of [
        false,
        {},
        { version: 2 },
        { version: 1, hold: true },
        { version: 1, retainedCount: 5 },
      ])
        expect(validate(name, { ...discovery, historicalResolution })).toBe(false);
      expect(validate(name, { ...discovery, profile: "history" })).toBe(false);
      delete discovery.historicalResolution;
      expect(validate(name, discovery)).toBe(true);
    }
  });
});

describe("History exact-address query syntax", () => {
  it("decodes opaque tokens once, including reserved, Unicode and encoded-percent bytes", () => {
    for (const revision of ["r /?&雪", 'quote"', "%2F", "\u0000", "bdp-b64:reserved", "a+b"])
      expect(parseHistoryQuery(`?revision=${encodeURIComponent(revision)}`, true)).toEqual({
        kind: "revision",
        revision,
      });
    expect(parseHistoryQuery("revision=%252F", true)).not.toEqual(
      parseHistoryQuery("revision=%2F", true),
    );
  });
  for (const query of [
    "revision=",
    "revision=r&revision=r",
    "revision=r&include=links",
    "revision=r&view=properties",
    "revision=r&limit=1",
    "revision=r&selector=x",
    "revision=r&x=1",
    "revision=%FF",
    "revision=%",
    "view=versions&revision=r",
    "view=versions&view=versions",
    "view=versions&cursor=",
    "view=versions&limit=0",
    "view=versions&limit=1e2",
  ])
    it(`refuses malformed or mixed ${query}`, () => {
      try {
        parseHistoryQuery(query, true);
        throw new Error("accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(HistoryQueryError);
        expect((error as HistoryQueryError).code).toBe("invalid-parameter");
      }
    });
  it("refuses unsupported capability and preserves alias404, including malformed queries", () => {
    expect(() => parseHistoryQuery("revision=r", false)).toThrow(HistoryQueryError);
    for (const query of ["revision=r", "revision=", "revision=%FF", "view=versions"])
      try {
        parseHistoryQuery(query, false, true);
        throw new Error("accepted alias");
      } catch (error) {
        expect((error as HistoryQueryError).code).toBe("resource-not-found");
      }
  });
  it("keeps ordinary Read dispatch outside this dedicated parser", () => {
    for (const query of [
      "",
      "view=properties",
      "view=links",
      "view=events",
      "include=links&direction=both",
      "limit=2&cursor=c",
    ])
      expect(hasHistoryQueryIntent(query), query).toBe(false);
    for (const query of [
      "revision=r",
      "revision=",
      "view=versions",
      "view=properties&view=versions",
      "revision=r&include=links",
    ])
      expect(hasHistoryQueryIntent(query), query).toBe(true);
    expect(() => parseHistoryQuery("revision=r", false)).toThrow(HistoryQueryError);
  });
  it("preserves exact oversized positive limits for the authority's limit-exceeded decision", () => {
    for (const limit of ["2000", "9007199254740992", "9007199254740993", "9".repeat(100)])
      expect(parseHistoryQuery(`view=versions&limit=${limit}`, true)).toEqual({
        kind: "versions",
        limit,
      });
  });
  it("uses form-query spaces and preserves an encoded literal plus", () => {
    expect(parseHistoryQuery("revision=a+b", true)).toEqual({ kind: "revision", revision: "a b" });
    expect(parseHistoryQuery("revision=a%20b", true)).toEqual({
      kind: "revision",
      revision: "a b",
    });
    expect(parseHistoryQuery("revision=a%2Bb", true)).toEqual({
      kind: "revision",
      revision: "a+b",
    });
  });
  it("parses the separate stable-page operation without a revision fallback", () => {
    expect(parseHistoryQuery("view=versions&limit=2&cursor=a%2Bb", true)).toEqual({
      kind: "versions",
      limit: "2",
      cursor: "a+b",
    });
  });
});

describe("Historical records and pages", () => {
  it("checks exact identity/revision and preserves historical owned records without traversal", () => {
    const input = example("exact-bead");
    const record = parseHistoricalBeadRecord(input, { id: subject, revision: "r /?&雪" });
    expect(record.ownedLinks?.["https://work.example/types/cites"]?.[0]?.target).toEqual({
      uri: "https://work.example/scope/beads/target",
      revision: "target%2Fold",
    });
    expect(record.ownedLinks?.["https://work.example/types/cites"]?.[0]?.properties).toEqual({
      opaque: { $ref: "not-a-protocol-reference" },
    });
    expect(Object.isFrozen(record.changeContext)).toBe(true);
    expect(() => parseHistoricalBeadRecord(input, { id: subject, revision: "current" })).toThrow(
      ProtocolArtifactValidationError,
    );
    expect(() =>
      parseHistoricalBeadRecord(input, { id: `${subject}-other`, revision: "r /?&雪" }),
    ).toThrow(ProtocolArtifactValidationError);
    expect(() => parseHistoricalBeadRecord({ ...input, links: { items: [], next: null } })).toThrow(
      ProtocolArtifactValidationError,
    );
    expect(
      parseHistoricalLinkRecord(example("exact-link"), { id: link, revision: "link-old" }).revision,
    ).toBe("link-old");
    expect(parseHistoricalLinkRecord(example("legacy-link")).changeContext).toBeUndefined();
  });
  it("rejects wrong inline source, Type grouping and incomplete record shapes", () => {
    const input = example("exact-bead");
    const owned = input.ownedLinks as Record<string, RecordValue[]>;
    const item = owned["https://work.example/types/cites"]?.[0];
    if (!item) throw new Error("missing inline fixture");
    item.source = `${subject}-wrong`;
    expect(() => parseHistoricalBeadRecord(input)).toThrow(ProtocolArtifactValidationError);
    item.source = subject;
    item.type = "https://work.example/types/wrong";
    expect(() => parseHistoricalBeadRecord(input)).toThrow(ProtocolArtifactValidationError);
    const incomplete = example("exact-link");
    delete incomplete.properties;
    expect(() => parseHistoricalLinkRecord(incomplete)).toThrow(ProtocolArtifactValidationError);
  });
  it("preserves replaced and incomplete membership without equating complete with serviceable", () => {
    const page = parseHistoryVersionsPage(example("versions-replacement"), subject);
    expect(page.items.map((row) => [row.revision, row.lineage, row.body])).toEqual([
      ["r4", "current", "complete"],
      ["r3", "replaced", "complete"],
      ["r2", "replaced", "incomplete"],
      ["r1", "current", "complete"],
    ]);
    expect(Object.isFrozen(page.items)).toBe(true);
    expect(() =>
      parseHistoryVersionsPage({
        ...example("versions-replacement"),
        participation: "undetermined",
      }),
    ).toThrow(ProtocolArtifactValidationError);
    expect(() =>
      parseHistoryVersionsPage(example("versions-replacement"), `${subject}-wrong`),
    ).toThrow(ProtocolArtifactValidationError);
  });
  it("rejects page payload leakage, duplicate revisions and foreign continuation", () => {
    const original = example("versions-replacement");
    const items = original.items as RecordValue[];
    for (const row of [
      { ...items[0], properties: {} },
      { ...items[0], body: "erased" },
      { ...items[0], lineage: "branch" },
    ])
      expect(() => parseHistoryVersionsPage({ ...original, items: [row] })).toThrow(
        ProtocolArtifactValidationError,
      );
    expect(() => parseHistoryVersionsPage({ ...original, items: [items[0], items[0]] })).toThrow(
      ProtocolArtifactValidationError,
    );
    expect(() =>
      parseHistoryVersionsPage({
        ...original,
        next: "https://foreign.example/beads/x?view=versions&cursor=p2",
      }),
    ).toThrow(ProtocolArtifactValidationError);
    // Empty visible rows do not imply a non-advancing snapshot cursor.
    expect(parseHistoryVersionsPage(example("versions-empty-visible-page"))).toMatchObject({
      items: [],
      next: expect.stringContaining("cursor=page-2"),
    });
    expect(() =>
      parseHistoryVersionsPage({
        ...original,
        window: { newest: null, oldest: null, complete: true },
      }),
    ).toThrow(ProtocolArtifactValidationError);
    expect(parseHistoryVersionsPage(example("versions-first-page")).next).toContain(
      "cursor=page-2",
    );
    expect(parseHistoryVersionsPage(example("versions-replacement")).next).toBeNull();
  });
});

describe("History response corruption boundary", () => {
  it("reports malformed next queries as response artifacts rather than request refusals", () => {
    for (const suffix of [
      "view=versions&cursor=",
      "view=versions&cursor=%FF",
      "view=versions&cursor=x&cursor=y",
    ]) {
      try {
        parseHistoryVersionsPage({
          ...example("versions-first-page"),
          next: `${subject}?${suffix}`,
        });
        throw new Error("accepted malformed continuation");
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolArtifactValidationError);
        expect(error).not.toBeInstanceOf(HistoryQueryError);
        expect((error as Error).message).toBe("History continuation query is malformed");
      }
    }
  });
});

describe("History diagnosis boundaries", () => {
  const rows = [
    ["revision-unknown", "not-found", 404],
    ["revision-unretained", "conflict", 409],
    ["revision-reorganized", "gone", 410],
    ["revision-not-tracked", "conflict", 409],
    ["revision-unrepresentable", "conflict", 409],
  ] as const;
  for (const [code, family, status] of rows)
    it(`keeps ${code} exact across read-capable profiles but out of receipts`, () => {
      const problem = example(code);
      expect(parseReadProblem(problem)).toMatchObject({
        code,
        type: `https://github.com/gastownhall/bdp/problems/${family}`,
        status,
        retry: "after-state-change",
      });
      for (const definition of ["readProblem", "readUpdateProblem", "transactionalProblem"]) {
        expect(validate(definition, problem)).toBe(true);
        for (const change of [
          { status: 503 },
          { retry: "after-delay" },
          { type: "https://github.com/gastownhall/bdp/problems/request" },
          { window: {} },
          { resource: example("exact-bead") },
          { mayChangeAfterSync: true },
        ])
          expect(validate(definition, { ...problem, ...change }), JSON.stringify(change)).toBe(
            false,
          );
      }
      const member = { ...problem, operationIndex: 0 };
      expect(validate("receiptProblem", member)).toBe(false);
      for (const definition of ["sequenceMemberProblem", "transactionalSequenceMemberProblem"])
        expect(validate(definition, member), definition).toBe(false);
      for (const definition of ["sequenceResponse", "transactionalSequenceResponse"])
        expect(validate(definition, { results: [member] }), definition).toBe(false);
    });
  it("requires explicit bounded missing diagnostics with valid property pointers and no values", () => {
    const problem = example("revision-unretained");
    delete problem.missing;
    expect(() => parseReadProblem(problem)).toThrow(ProtocolArtifactValidationError);
    for (const missing of [
      { complete: true, items: [] },
      { complete: true, items: [{ kind: "property", pointer: "/revision" }] },
      {
        complete: true,
        items: [{ kind: "property", pointer: "/ownedLinks/type/00/properties/x" }],
      },
      { complete: true, items: [{ kind: "property", pointer: "/properties/~2" }] },
      { complete: true, items: [{ kind: "record", value: "secret" }] },
      {
        complete: false,
        items: Array.from({ length: 65 }, (_, i) => ({
          kind: "property",
          pointer: `/properties/${i}`,
        })),
      },
    ])
      expect(() => parseHistoryMissing(missing)).toThrow(ProtocolArtifactValidationError);
    expect(parseHistoryMissing({ complete: false, items: [] })).toEqual({
      complete: false,
      items: [],
    });
    for (const code of ["resource-erased", "revision-unrepresentable", "revision-unknown"])
      expect(() =>
        parseReadProblem({ ...example(code), missing: { complete: false, items: [] } }),
      ).toThrow(ProtocolArtifactValidationError);
    expect(() => parseReadProblem({ ...example("resource-erased"), pointer: "/secret" })).toThrow(
      ProtocolArtifactValidationError,
    );
  });
  it("constructs Unretained only from a validated immutable missing inventory", () => {
    expect(() => historyUnretainedProblem({ complete: true, items: [] })).toThrow(
      ProtocolArtifactValidationError,
    );
    const input = { complete: false, items: [] };
    const problem = historyUnretainedProblem(input);
    input.complete = true;
    expect(problem.missing).toEqual({ complete: false, items: [] });
    expect(Object.isFrozen(problem.missing)).toBe(true);
    expect(parseReadProblem(problem)).toMatchObject({
      code: "revision-unretained",
      missing: { complete: false, items: [] },
    });
  });
  it("admits persistent allocation failure only in applicable write contexts", () => {
    const problem = example("allocation-ru-direct");
    expect(parseRevisionAllocationUnsafeProblem(problem).code).toBe("revision-allocation-unsafe");
    expect(validate("readProblem", problem)).toBe(false);
    for (const definition of [
      "readUpdateProblem",
      "transactionalProblem",
      "receiptProblem",
      "sequenceMemberProblem",
      "transactionalSequenceMemberProblem",
    ])
      expect(validate(definition, { ...problem, operationIndex: 0 })).toBe(true);
    for (const definition of ["sequenceResponse", "transactionalSequenceResponse"])
      expect(
        validate(definition, { results: [{ ...problem, operationIndex: 0 }] }),
        definition,
      ).toBe(true);
    expect(() =>
      parseRevisionAllocationUnsafeProblem({ ...problem, pointer: "/identity" }),
    ).toThrow(ProtocolArtifactValidationError);
    expect(() =>
      parseRevisionAllocationUnsafeProblem({ ...problem, status: 503, retry: "after-delay" }),
    ).toThrow(ProtocolArtifactValidationError);
    expect(() => parseRevisionAllocationUnsafeProblem(example("revision-unknown"))).toThrow(
      ProtocolArtifactValidationError,
    );
  });
});

describe("Immutable context wire boundary", () => {
  it("distinguishes values, known absence and uncertainty without accepting forged time", () => {
    const context = example("native-context");
    expect(parseChangeContext(context).message).toEqual({ state: "absent" });
    for (const change of [
      { committedAt: { state: "present", value: "not-a-time" } },
      { committedAt: { state: "absent" } },
      { agent: { state: "present", value: "" } },
      { message: { state: "absent", value: "leak" } },
      { actor: "different" },
    ])
      expect(() => parseChangeContext({ ...context, ...change })).toThrow(
        ProtocolArtifactValidationError,
      );
    expect(parseChangeContextInput({ agent: null, message: "" })).toEqual({
      agent: null,
      message: "",
    });
    for (const input of [
      { committedAt: "2026-09-09T14:00:00Z" },
      { actor: "different" },
      { agent: "" },
      { agent: { state: "undetermined" } },
    ])
      expect(() => parseChangeContextInput(input)).toThrow(ProtocolArtifactValidationError);
  });
  it("accepts version-bearing Event/owned-delta context but rejects tombstone/alias/reference additions", () => {
    const context = example("native-context");
    expect(
      validate("ownedLinkDelta", {
        id: link,
        type: "https://work.example/types/cites",
        previousRevision: "r1",
        revision: "r2",
        change: [{ op: "replace", path: "/title", value: "changed" }],
        changeContext: context,
      }),
    ).toBe(true);
    expect(validate("createdData", { revision: "r", properties: {}, changeContext: context })).toBe(
      true,
    );
    for (const [definition, value] of [
      [
        "resourceIdentity",
        { id: subject, type: "https://work.example/types/decision", revision: "r" },
      ],
      ["pinnedReference", { uri: subject, revision: "r" }],
      ["deletedData", { revision: "r" }],
      ["putAliasRequest", { alias: "now", target: subject }],
      ["deleteBeadRequest", { bead: subject }],
    ] as const) {
      expect(validate(definition, value), definition).toBe(true);
      expect(validate(definition, { ...value, changeContext: context }), definition).toBe(false);
    }
    const batch = example("batch-inputs");
    expect(validate("batchRequest", { ...batch, changeContext: {} })).toBe(false);
    const record = example("exact-link");
    delete record.changeContext;
    expect(validate("linkRecord", record)).toBe(true);
    expect(validate("linkRecord", { ...record, changeContext: context })).toBe(true);
  });
  it("keeps context on both updated Event branches and singleton update inputs", () => {
    for (const id of ["updated-owned-event-context", "updated-properties-event-context"])
      expect(example(id).changeContext).toEqual(example("native-context"));
    const ownedUpdate = example("updated-owned-event-context");
    expect(
      validate("updatedData", {
        ...ownedUpdate,
        change: [{ op: "replace", path: "/title", value: "x" }],
      }),
    ).toBe(false);
    for (const [id, definition] of [
      ["update-bead-input-context", "updateBeadPropertiesRequest"],
      ["update-link-input-context", "updateLinkPropertiesRequest"],
    ] as const) {
      expect(validate(definition, example(id))).toBe(true);
      expect(
        validate(definition, { ...example(id), changeContext: example("native-context") }),
      ).toBe(false);
    }
  });
  it("has independent parser snapshots and rejects cycles before schema traversal", () => {
    const input = example("native-context");
    const parsed = parseChangeContext(input);
    (input.agent as RecordValue).value = "changed after parsing";
    expect(parsed.agent).toEqual({ state: "present", value: "assistant-a" });
    input.cycle = input;
    expect(() => parseChangeContext(input)).toThrow(ProtocolArtifactValidationError);
    expect(parseChangeContext(example("native-context"))).toEqual(example("native-context"));
  });
});

describe("Narrated History HTTP parity", () => {
  const fixture = JSON.parse(readFileSync(new URL("fixtures/history/http.json", root), "utf8")) as {
    exchanges: {
      id: string;
      condition: string;
      request: { method: string; target: string; schema?: string; body?: unknown };
      response: {
        status: number;
        headers: Record<string, string>;
        schema?: string;
        body?: unknown;
      };
    }[];
  };
  it("keeps HEAD status/headers equal to GET while omitting every body", () => {
    for (const [getId, headId] of [
      ["get-exact", "head-exact"],
      ["get-unretained", "head-unretained"],
    ]) {
      const get = fixture.exchanges.find((item) => item.id === getId);
      const head = fixture.exchanges.find((item) => item.id === headId);
      if (!get || !head) throw new Error("missing HTTP parity illustration");
      expect(head.request.target).toBe(get.request.target);
      expect(head.response).toEqual({ status: get.response.status, headers: get.response.headers });
      expect(head.response).not.toHaveProperty("body");
    }
  });
  it("distinguishes pre-admission direct allocation409 from admitted-member200 projection", () => {
    const before = fixture.exchanges.find(
      (item) => item.id === "sequence-allocation-before-admission",
    );
    const after = fixture.exchanges.find(
      (item) => item.id === "sequence-allocation-after-admission",
    );
    if (!before || !after) throw new Error("missing allocation placement illustrations");
    expect(before.request).toEqual(after.request);
    expect(before.response.status).toBe(409);
    expect(before.response.body).not.toHaveProperty("operationIndex");
    expect(after.response.status).toBe(200);
    expect(after.response.body).toEqual({
      results: [{ ...(before.response.body as RecordValue), operationIndex: 0 }],
    });
  });
  it("validates only represented bodies and query syntax, without claiming HTTP execution", () => {
    for (const item of fixture.exchanges) {
      expect(item.condition.length).toBeGreaterThan(0);
      if (item.request.method === "POST") {
        expect(new URL(item.request.target).pathname).toBe("/scope/operations/sequence");
        expect(item.request.schema).toBe("#/$defs/sequenceRequest");
        expect(ajv.validate(`${schema.$id}${item.request.schema}`, item.request.body)).toBe(true);
      } else {
        expect(() => parseHistoryQuery(new URL(item.request.target).search, true)).not.toThrow();
      }
      expect(item.response.headers["Cache-Control"]).toBe("private, no-store");
      if (item.response.schema)
        expect(ajv.validate(`${schema.$id}${item.response.schema}`, item.response.body)).toBe(true);
    }
  });
});
