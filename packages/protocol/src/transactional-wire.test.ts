import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { BDP_PROBLEM_FAMILY_PREFIX, BDP_V0_SCHEMA_ID, READ_PROBLEM_DEFINITIONS } from "./index.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

/**
 * The drafted Transactional wire artifacts, held in lockstep from three
 * sides: the specification's Problem-details table, the bundle's
 * definitions, and the checked-in `fixtures/transactional` exchanges. This
 * checks structural, table, and example consistency — the three
 * Transactional rows mirror the bundle's branches and the direct and
 * receipt contexts are closed, the fixtures validate, receipt entries
 * align with the operations that produced them, change groups and
 * snapshots keep the invariants the text states, the recorded digest
 * vectors reproduce from their recorded serializations, and the shapes the
 * packet's negative fixtures name are rejected. It establishes none of the
 * behavior the decisions describe: fixture conditions are narrated
 * assumptions, not observations, and none of this is conformance evidence.
 */
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(
  readFileSync(path.join(workspaceRoot, "schemas", "bdp-v0.schema.json"), "utf8"),
) as SchemaRecord;
const specification = readFileSync(path.join(workspaceRoot, "docs", "specs", "bdp.md"), "utf8");
const fixturesDirectory = path.join(workspaceRoot, "fixtures", "transactional");

type SchemaRecord = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

/** The rows this draft adds; the specification table and the bundle must both agree. */
const TRANSACTIONAL_PROBLEM_ROWS: readonly (readonly [string, string, number, string])[] = [
  ["cardinality-violated", "conflict", 409, "after-state-change"],
  ["event-history-expired", "gone", 410, "never"],
  ["catch-up-timeout", "unavailable", 503, "after-delay"],
];
/** The Read+Update rows precede these in the table; the Read+Update lockstep test owns them. */
const READ_UPDATE_ROW_COUNT = 12;

const WIRE_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const SCOPE = "https://beads.example/acme/";
const PAGINATION_SCOPE = "https://beads.example/receipt-pagination/";
/** The reference domain's only owned Link Type: `decision` owns `cites`. */
const OWNED_LINK_TYPE = "https://work.example/types/cites";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
ajv.addSchema(schema);

interface FixtureExchange {
  readonly id: string;
  /** A narrated precondition — an assumption the example rests on, never an observation. */
  readonly condition?: string;
  /** An exchange in this fixture whose response body this one repeats byte for byte. */
  readonly sameReceiptAs?: string;
  /** Explicit before-state oracle for a semantic no-op. */
  readonly priorResources?: readonly JsonRecord[];
  readonly request: {
    readonly method: string;
    readonly target: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly schema?: string;
    readonly body?: JsonRecord;
    /** Exact invalid I-JSON wire text, kept unparsed to preserve the fault. */
    readonly bodyText?: string;
  };
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly schema: string;
    readonly body: JsonRecord;
  };
}

interface TransactionalFixture {
  readonly fixtureVersion: number;
  readonly id: string;
  readonly description: string;
  readonly scope: string;
  readonly exchanges: readonly FixtureExchange[];
  /** Committed group shapes; these are not finite HTTP replay responses. */
  readonly groupExamples?: readonly {
    readonly id: string;
    readonly schema: string;
    /** Canonical Scope override for an independent committed-group example. */
    readonly scope?: string;
    readonly body: JsonRecord;
  }[];
}

interface DigestVector {
  readonly label: string;
  readonly record: JsonRecord;
  readonly jcs: string;
  readonly sha256: string;
}

interface DigestVectorsFixture {
  readonly fixtureVersion: number;
  readonly id: string;
  readonly description: string;
  readonly vectors: readonly DigestVector[];
}

const fixtureFiles = readdirSync(fixturesDirectory)
  .filter((entry) => entry.endsWith(".json"))
  .sort()
  .map(
    (entry) => JSON.parse(readFileSync(path.join(fixturesDirectory, entry), "utf8")) as JsonRecord,
  );
const fixtures = fixtureFiles.filter((candidate): candidate is JsonRecord & TransactionalFixture =>
  Array.isArray(candidate.exchanges),
);
const digestVectors = fixtureFiles.find(
  (candidate) => candidate.id === "transactional-erasure-digest-vectors",
) as DigestVectorsFixture | undefined;

describe("Transactional problem rows", () => {
  const tableRows = problemTableRows(markdownSection(specification, "Problem details"));
  const inheritedRowCount = READ_PROBLEM_DEFINITIONS.length + READ_UPDATE_ROW_COUNT;

  it("adds exactly the three drafted rows after the Read and Read+Update rows", () => {
    expect(tableRows.length).toBe(inheritedRowCount + TRANSACTIONAL_PROBLEM_ROWS.length);
    expect(tableRows.slice(inheritedRowCount)).toEqual(TRANSACTIONAL_PROBLEM_ROWS);
  });

  it("mirrors the rows in the bundle's Transactional problem branches", () => {
    expect(def("transactionalOnlyProblemCode")).toEqual({
      enum: TRANSACTIONAL_PROBLEM_ROWS.map(([code]) => code),
    });
    expect(def("transactionalProblemCode")).toEqual({
      anyOf: [
        { $ref: "#/$defs/readUpdateProblemCode" },
        { $ref: "#/$defs/transactionalOnlyProblemCode" },
      ],
    });
    const direct = def("transactionalProblem").allOf as SchemaRecord[];
    const receipt = def("receiptProblem").allOf as SchemaRecord[];
    for (const branches of [direct, receipt]) {
      // Every shared code routes through the Read+Update definition by
      // reference, so the inherited rows are stated once.
      expect(branches[0]).toEqual({
        if: { properties: { code: { $ref: "#/$defs/readUpdateProblemCode" } }, required: ["code"] },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then vocabulary
        then: { $ref: "#/$defs/readUpdateProblem" },
      });
    }
    const rowBranch = (code: string, family: string, status: number, retry: string) => ({
      if: { properties: { code: { const: code } }, required: ["code"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then vocabulary
      then: {
        properties: {
          diagnostics: false,
          diagnosticsTruncated: false,
          type: { const: `${BDP_PROBLEM_FAMILY_PREFIX}${family}` },
          status: { const: status },
          retry: { const: retry },
        },
      },
    });
    expect(direct[1]).toEqual(rowBranch("event-history-expired", "gone", 410, "never"));
    expect(direct[2]).toEqual(rowBranch("catch-up-timeout", "unavailable", 503, "after-delay"));
    expect(receipt[1]).toEqual(
      rowBranch("cardinality-violated", "conflict", 409, "after-state-change"),
    );
    expect((propertiesOf("transactionalProblem").status as SchemaRecord).enum).toEqual(
      (propertiesOf("readUpdateProblem").status as SchemaRecord).enum,
    );
  });

  it("closes the direct and receipt contexts to their codes", () => {
    const readUpdateCodes = new Set(def("readUpdateProblemCode").enum as string[]);
    const transactionalOnly = new Set(TRANSACTIONAL_PROBLEM_ROWS.map(([code]) => code));
    const direct = def("directProblemCode").enum as string[];
    const receipt = def("receiptProblemCode").enum as string[];
    for (const code of [...direct, ...receipt]) {
      expect(readUpdateCodes.has(code) || transactionalOnly.has(code), code).toBe(true);
    }
    for (const definition of READ_PROBLEM_DEFINITIONS) expect(direct).toContain(definition.code);
    expect(direct).toEqual(
      expect.arrayContaining([
        "unsupported-media-type",
        "idempotency-conflict",
        "event-history-expired",
        "catch-up-timeout",
      ]),
    );
    // The receipt context reuses exactly three Read codes and the Read+Update
    // rows a failed transaction can carry; the transient and key-disposition
    // codes never enter a receipt, and the receipt codes are never direct.
    expect(direct.filter((code) => receipt.includes(code)).sort()).toEqual([
      "forbidden",
      "limit-exceeded",
      "resource-not-found",
    ]);
    for (const code of ["temporarily-unavailable", "idempotency-conflict", "rate-limited"]) {
      expect(receipt, code).not.toContain(code);
    }
    for (const code of ["idempotency-in-progress", "idempotency-expired", "binding-unavailable"]) {
      expect(direct, code).not.toContain(code);
    }
    expect(receipt).toEqual(
      expect.arrayContaining([
        "validation-failed",
        "type-not-installed",
        "identity-taken",
        "alias-path-taken",
        "revision-mismatch",
        "incident-links-exist",
        "aggregate-constraint-violation",
        "cardinality-violated",
        "binding-unavailable",
      ]),
    );
    expect(receipt).not.toContain("event-history-expired");
    expect(receipt).not.toContain("catch-up-timeout");
    expect(def("receiptProblem").required).toEqual(["type", "code", "status", "retry"]);
  });
});

describe("Transactional wire fixtures", () => {
  it("cover discovery, batch, receipts, the set targets, direct problems, sequence, Events, the changefeed, and snapshots", () => {
    expect(fixtures.map(({ id }) => id)).toEqual([
      "transactional-aliases",
      "transactional-batch",
      "transactional-changefeed",
      "transactional-direct-problems",
      "transactional-discovery",
      "transactional-events",
      "transactional-receipt-pagination",
      "transactional-receipts",
      "transactional-sequence",
      "transactional-set-singletons",
      "transactional-snapshots",
    ]);
    const targets = new Set(
      fixtures.flatMap(({ exchanges }) => exchanges.map(({ request }) => request.target)),
    );
    expect([...targets].sort()).toEqual([
      "bdp.json",
      "beads/dec-11?view=events&after=ckpt-52_0",
      "beads/dec-9?view=events",
      "beads/dec-9?view=events&after=ckpt-43_4",
      "changes/?after=ckpt-42",
      "changes/?after=ckpt-43",
      "changes/?after=ckpt-44",
      "changes/?after=ckpt-46",
      "operations/",
      "operations/batch",
      "operations/delete-alias",
      "operations/delete-where",
      "operations/put-alias",
      "operations/sequence",
      "operations/update-bead-properties",
      "operations/update-where",
      "receipts/",
      "receipts/rcpt-0",
      "receipts/rcpt-7",
      "receipts/rcpt-8",
      "receipts/rcpt-9?page=2",
      "snapshot",
    ]);
  });

  it("keeps every available receipt and page within its own Scope's advertised bound", () => {
    for (const fixture of fixtures) {
      const discovery = fixtures
        .filter((candidate) => candidate.scope === fixture.scope)
        .flatMap((candidate) => candidate.exchanges)
        .find((exchange) => exchange.response.schema === "#/$defs/transactionalDiscovery");
      if (discovery === undefined) throw new Error(`${fixture.id}: missing Scope discovery`);
      const pageLimits = (discovery.response.body.limits as JsonRecord).page as JsonRecord;
      expectReceiptPagination(fixture, pageLimits.maximumItems as number);
    }
  });

  for (const fixture of fixtures) {
    describe(fixture.id, () => {
      it("is a version-1 fixture whose exchanges validate against the bundle", () => {
        expect(fixture.fixtureVersion).toBe(1);
        expect(fixture.scope).toBe(
          fixture.id === "transactional-receipt-pagination" ? PAGINATION_SCOPE : SCOPE,
        );
        expect(fixture.description).toContain("not evidence");
        expect(new Set(fixture.exchanges.map(({ id }) => id)).size).toBe(fixture.exchanges.length);
        for (const exchange of fixture.exchanges) {
          if (exchange.request.schema !== undefined)
            expectValid(exchange.request.schema, exchange.request.body, exchange.id);
          expectValid(exchange.response.schema, exchange.response.body, exchange.id);
        }
      });

      it("pairs every response with its status, media type, cache policy, and response fields", () => {
        for (const exchange of fixture.exchanges) {
          const { request, response } = exchange;
          expect(response.headers["cache-control"], exchange.id).toBe("private, no-store");
          if (isDirectProblem(exchange)) {
            expect(response.headers["content-type"], exchange.id).toBe("application/problem+json");
            expect(response.body.status, exchange.id).toBe(response.status);
            expectProblemRow(response.body, exchange.id);
            if (response.body.retry === "after-delay")
              expect(response.headers["retry-after"], exchange.id).toBeDefined();
          } else {
            expect([200, 202], exchange.id).toContain(response.status);
            expect(response.headers["content-type"], exchange.id).toBe("application/json");
            // The three fields are the serving request's own observation.
            for (const field of [
              "bdp-scope-epoch",
              "bdp-authorization-view",
              "bdp-scope-position",
            ]) {
              expect(response.headers[field], `${exchange.id}: ${field}`).toMatch(WIRE_TOKEN);
            }
          }
          if (request.method !== "POST") continue;
          const key = request.headers["idempotency-key"];
          if (request.target === "operations/sequence") {
            expect(key, exchange.id).toBeUndefined();
          } else if (response.body.code !== "malformed-request") {
            expect(key, exchange.id).toMatch(WIRE_TOKEN);
          }
        }
      });

      it("keeps every Mutation Receipt aligned with the request that produced it", () => {
        for (const exchange of fixture.exchanges) {
          if (exchange.response.schema !== "#/$defs/mutationReceipt") continue;
          const receipt = exchange.response.body;
          expectReceiptRepresentation(receipt, exchange, fixture.scope);
          const operations = requestOperations(exchange);
          if (
            operations === undefined ||
            receipt.status !== "completed" ||
            receipt.detail !== "available"
          )
            continue;
          const entries = receiptEntries(fixture, exchange);
          expectEntriesCorrespond(
            entries,
            operations,
            exchange.id,
            exchange.priorResources,
            fixture.scope,
          );
        }
      });

      it("repeats a retained receipt byte for byte when an identical retry is answered", () => {
        for (const exchange of fixture.exchanges) {
          if (exchange.sameReceiptAs === undefined) continue;
          const original = fixture.exchanges.find(({ id }) => id === exchange.sameReceiptAs);
          if (original === undefined) throw new Error(`${exchange.id}: unknown original`);
          expect(exchange.response.body, exchange.id).toEqual(original.response.body);
          expect(exchange.request.body, exchange.id).toEqual(original.request.body);
          expect(exchange.request.headers["idempotency-key"], exchange.id).toBe(
            original.request.headers["idempotency-key"],
          );
        }
      });

      it("keeps change groups, Event pages, and snapshots to their stated invariants", () => {
        for (const example of fixture.groupExamples ?? []) {
          expectValid(example.schema, example.body, example.id);
          expectChangeGroup(example.body, example.id);
          expectGroupScope(example.body, example.scope ?? fixture.scope, example.id);
        }
        for (const exchange of fixture.exchanges) {
          const body = exchange.response.body;
          if (exchange.response.schema === "#/$defs/changefeedPage") {
            for (const group of body.groups as readonly JsonRecord[]) {
              expectChangeGroup(group, exchange.id);
              // A finite replay from before an erasure cannot return that
              // erasure: its cursor is already fenced by the committed group.
              expect(group.erasures, exchange.id).toEqual([]);
            }
          } else if (exchange.response.schema === "#/$defs/eventPage") {
            const events = body.events as readonly JsonRecord[];
            for (const event of events) expect(event.source, exchange.id).toBe(body.source);
            expectOrdinalsIncrease(events, exchange.id);
          } else if (exchange.response.schema === "#/$defs/snapshotManifest") {
            expectClosedSnapshot(body, exchange.id, fixture.scope);
          }
        }
      });
    });
  }
});

describe("operator-ruled alias and live-erasure illustrations", () => {
  it("keeps alias results closed and excludes alias batch members", () => {
    const put = {
      operationIndex: 0,
      outcome: "created",
      alias: `${SCOPE}alias/release/latest`,
      target: `${SCOPE}beads/task-42`,
    };
    const deleted = { operationIndex: 0, outcome: "deleted", alias: put.alias };
    for (const entry of [put, { ...put, outcome: "updated" }, deleted])
      expectValid("#/$defs/receiptResult", entry, "alias result");
    for (const entry of [
      { ...put, operationIndex: 1 },
      { ...put, operationName: "alias" },
      { ...put, resource: {} },
      { ...deleted, target: put.target },
      { ...deleted, outcome: "created" },
      { ...put, outcome: "matched", count: 1 },
    ])
      expect(compiledDefinition("#/$defs/receiptResult")(entry), JSON.stringify(entry)).toBe(false);
    for (const operation of [
      { operation: "putAlias", alias: "release/latest", target: "beads/task-42" },
      { operation: "deleteAlias", alias: "release/latest" },
    ])
      expect(compiledDefinition("#/$defs/batchOperation")(operation)).toBe(false);
    const fixture = fixtures.find(({ id }) => id === "transactional-aliases");
    for (const exchange of fixture?.exchanges ?? []) {
      if (exchange.response.schema !== "#/$defs/mutationReceipt") continue;
      expect(exchange.response.body.effectPosition).toBeUndefined();
      expect(exchange.response.body.requiredPosition).toBe("pos-49");
    }
  });

  it("ties the narrated live publication to one complete committed group and both disconnect outcomes", () => {
    const fixture = fixtureFiles.find(({ id }) => id === "transactional-changefeed") as JsonRecord;
    const examples = fixture.livePublicationExamples as JsonRecord[];
    expect(examples.length).toBe(2);
    const caughtUp = examples[0] as JsonRecord;
    const lagging = examples[1] as JsonRecord;
    const group = (fixture.groupExamples as JsonRecord[]).find(
      ({ id }) => id === caughtUp.publicationGroup,
    )?.body as JsonRecord;
    const sse = caughtUp.sse as JsonRecord;
    expectValid("#/$defs/changeGroup", sse.data, "live erasure publication");
    expect(sse).toEqual({ id: group.checkpoint, event: "change-group", data: group });
    expect((group.erasures as unknown[]).length).toBeGreaterThan(0);
    expect(caughtUp.minimumReplayPosition).toBe(group.position);
    expect(caughtUp.disconnectCases).toEqual([
      {
        id: "disconnect-before-complete-application",
        durableCheckpoint: caughtUp.lastEmittedCheckpoint,
        reconnect: "cursor-expired",
        recovery: "fresh-snapshot",
      },
      {
        id: "disconnect-after-complete-application",
        durableCheckpoint: group.checkpoint,
        reconnect: "exclusive-after-checkpoint",
        recovery: "ordinary-replay",
      },
    ]);
    expect(lagging.sse).toBeNull();
    expect(lagging.minimumReplayPosition).toBe(group.position);
    // The finite replay examples remain fenced; this is a narrated live
    // schedule, not a scheduler implementation or conformance observation.
  });
});

describe("Transactional sequence problem extensions", () => {
  const expired = {
    type: `${BDP_PROBLEM_FAMILY_PREFIX}gone`,
    code: "idempotency-expired",
    status: 410,
    retry: "never",
    operationIndex: 0,
  };

  it.each([
    42,
    {},
    { id: "not-a-url", type: 7 },
    { withheld: false },
    { withheld: true, id: `${SCOPE}beads/task-42`, type: "https://work.example/types/task" },
  ])("rejects malformed allocated identity %j", (allocated) => {
    expect(
      compiledDefinition("#/$defs/transactionalSequenceMemberProblem")({ ...expired, allocated }),
    ).toBe(false);
  });

  it("permits the disclosed expired-creation identity and keeps it out of other codes", () => {
    const allocated = { id: `${SCOPE}beads/task-42`, type: "https://work.example/types/task" };
    expectValid(
      "#/$defs/transactionalSequenceMemberProblem",
      { ...expired, allocated },
      "expired creation",
    );
    const forbidden = {
      ...expired,
      type: `${BDP_PROBLEM_FAMILY_PREFIX}authorization`,
      code: "forbidden",
      status: 403,
      retry: "after-state-change",
    };
    expectValid("#/$defs/transactionalSequenceMemberProblem", forbidden, "forbidden projection");
    expect(
      compiledDefinition("#/$defs/transactionalSequenceMemberProblem")({ ...forbidden, allocated }),
    ).toBe(false);
  });

  it("accepts only the closed withheld allocation on an expired projection", () => {
    expectValid(
      "#/$defs/transactionalSequenceMemberProblem",
      { ...expired, allocated: { withheld: true } },
      "withheld allocation",
    );
    expect(
      compiledDefinition("#/$defs/transactionalSequenceMemberProblem")({
        ...expired,
        code: "resource-erased",
        allocated: { withheld: true },
      }),
    ).toBe(false);
  });

  it("illustrates re-authorization without changing retained keys or disclosing an unauthorized dependent", () => {
    const fixture = fixtures.find(({ id }) => id === "transactional-sequence");
    const revoked = fixture?.exchanges.find(({ id }) => id === "expired-allocation-view-revoked");
    const granted = fixture?.exchanges.find(({ id }) => id === "expired-allocation-view-granted");
    expect(revoked).toBeDefined();
    expect(granted).toBeDefined();
    expect(revoked?.request.body).toEqual(granted?.request.body);
    const revokedResults = revoked?.response.body.results as JsonRecord[];
    const grantedResults = granted?.response.body.results as JsonRecord[];
    expect(revokedResults[0]?.allocated).toEqual({ withheld: true });
    expect(grantedResults[0]?.allocated).toEqual({
      id: `${SCOPE}beads/task-77`,
      type: "https://work.example/types/task",
    });
    for (const results of [revokedResults, grantedResults]) {
      expect(results[1]).toEqual({
        operationIndex: 1,
        type: `${BDP_PROBLEM_FAMILY_PREFIX}authorization`,
        code: "forbidden",
        status: 403,
        retry: "after-state-change",
      });
    }
    expect(JSON.stringify(revoked?.response.body)).not.toContain(`${SCOPE}beads/task-77`);
  });

  it("rejects an erasure pointer in the sequence path", () => {
    const erased = { ...expired, code: "resource-erased" };
    expectValid("#/$defs/transactionalSequenceMemberProblem", erased, "erased projection");
    expect(
      compiledDefinition("#/$defs/transactionalSequenceMemberProblem")({
        ...erased,
        pointer: "/properties/title",
      }),
    ).toBe(false);
  });
});

describe("erasure digest vectors", () => {
  const vectors = digestVectors?.vectors ?? [];

  it("record the served records the fixtures carry, with their serialization and digest", () => {
    expect(digestVectors?.fixtureVersion).toBe(1);
    expect(digestVectors?.description).toContain("not evidence");
    expect(vectors.map(({ label }) => label)).toEqual([
      "task-42-r7",
      "task-42-r8",
      "9c1e-r1",
      "2d4f-r1",
      "dec-9-r2",
      "vec-1-r1",
      "vec-2-r1",
      "rel-5-r1",
    ]);
  });

  for (const vector of vectors) {
    it(`reproduces the ${vector.label} digest from its recorded RFC 8785 serialization`, () => {
      // No RFC 8785 serializer is in the repository (recorded as a known gap):
      // the canonicalization is the packet's, and what is checked is that
      // the serialization is the record and that SHA-256 over it is the
      // recorded digest.
      expect(JSON.parse(vector.jcs)).toEqual(vector.record);
      expect(createHash("sha256").update(vector.jcs, "utf8").digest("hex")).toBe(vector.sha256);
      expect(vector.sha256).toMatch(HEX_DIGEST);
      // Member names are in UTF-16 code-unit order at every level.
      expectSortedMembers(JSON.parse(vector.jcs), vector.label);
    });
  }

  it("agree with the records and erasure digests the fixtures serve", () => {
    const served = new Map<string, JsonRecord>();
    const erased = new Map<string, string>();
    for (const fixture of fixtures) {
      const bodies = [
        ...fixture.exchanges.map(({ response }) => response.body),
        ...(fixture.groupExamples ?? []).map(({ body }) => body),
      ];
      for (const body of bodies) {
        for (const record of servedRecords(body)) {
          const key = `${record.id}@${record.revision}`;
          const previous = served.get(key);
          if (previous !== undefined) expect(record, key).toEqual(previous);
          served.set(key, record);
        }
        for (const record of erasureRecords(body)) {
          erased.set(
            `${record.subject}@${record.revision}`,
            (record.digest as JsonRecord).value as string,
          );
        }
      }
    }
    expect(served.size).toBeGreaterThan(0);
    const vectorKeys = new Set(vectors.map(({ record }) => `${record.id}@${record.revision}`));
    for (const key of erased.keys()) expect(vectorKeys.has(key), key).toBe(true);
    for (const vector of vectors) {
      const key = `${vector.record.id}@${vector.record.revision}`;
      const record = served.get(key);
      if (record !== undefined) expect(record, vector.label).toEqual(vector.record);
      const digest = erased.get(key);
      if (digest !== undefined) expect(digest, vector.label).toBe(vector.sha256);
    }
    expect(erased.get(`${SCOPE}beads/task-42@task-42-r7`)).toBe(vectors[0]?.sha256);
    expect(erased.get(`${SCOPE}beads/task-42@task-42-r8`)).toBe(vectors[1]?.sha256);
  });
});

describe("Transactional discovery and limits", () => {
  const SHARED_GROUPS = ["page", "request", "resource", "selector", "patch", "sequence"];

  it("requires the alias root and pins the profile", () => {
    expect(propertiesOf("transactionalDiscovery").profile).toEqual({ const: "transactional" });
    const required = def("transactionalDiscovery").required as readonly string[];
    for (const member of [
      ...(def("readUpdateDiscovery").required as readonly string[]),
      "scopeEpoch",
      "authorizationView",
      "headPosition",
      "minimumReplayPosition",
      "receipts",
      "snapshot",
      "changes",
      "events",
    ]) {
      expect(required, member).toContain(member);
    }
    expect(propertiesOf("transactionalDiscovery").limits).toEqual({
      $ref: "#/$defs/transactionalAdvertisedLimits",
    });
  });

  it("restates the shared groups, carries validation and transaction, and closes retention without idempotency", () => {
    const groups = propertiesOf("transactionalAdvertisedLimits");
    const shared = propertiesOf("advertisedLimits");
    expect(def("transactionalAdvertisedLimits").additionalProperties).toBe(false);
    expect(Object.keys(groups)).toEqual([
      ...SHARED_GROUPS,
      "validation",
      "transaction",
      "retention",
    ]);
    for (const group of [...SHARED_GROUPS, "transaction"])
      expect(groups[group], group).toEqual(shared[group]);
    expect(groups.validation).toEqual(propertiesOf("readUpdateAdvertisedLimits").validation);
    const retention = requiredRecord(groups.retention, "retention");
    expect(Object.keys(requiredRecord(retention.properties, "retention.properties"))).toEqual([
      "receipt",
      "maximumSnapshotLifetime",
      "replay",
    ]);
    expect(retention.additionalProperties).toBe(false);
  });

  it("pins all twelve Operation Directory targets", () => {
    const entries = [
      ["createBead", "create-bead"],
      ["updateBeadProperties", "update-bead-properties"],
      ["deleteBead", "delete-bead"],
      ["createLink", "create-link"],
      ["updateLinkProperties", "update-link-properties"],
      ["deleteLink", "delete-link"],
      ["putAlias", "put-alias"],
      ["deleteAlias", "delete-alias"],
      ["sequence", "sequence"],
      ["updateWhere", "update-where"],
      ["deleteWhere", "delete-where"],
      ["batch", "batch"],
    ];
    const directory = def("transactionalOperationDirectory");
    expect(directory.required).toEqual(entries.map(([key]) => key));
    expect(directory.additionalProperties).toBe(false);
    expect(propertiesOf("transactionalOperationDirectory")).toEqual(
      Object.fromEntries(entries.map(([key, target]) => [key, { const: target }])),
    );
  });

  it("composes the eight operation records from the Read+Update member mixins", () => {
    const union = (def("batchOperation").oneOf as SchemaRecord[]).map(
      (branch) => branch.$ref as string,
    );
    expect(union).toEqual([
      "#/$defs/createBeadOperation",
      "#/$defs/updateBeadPropertiesOperation",
      "#/$defs/deleteBeadOperation",
      "#/$defs/createLinkOperation",
      "#/$defs/updateLinkPropertiesOperation",
      "#/$defs/deleteLinkOperation",
      "#/$defs/updateWhereOperation",
      "#/$defs/deleteWhereOperation",
    ]);
    for (const ref of union) {
      const name = ref.slice("#/$defs/".length);
      const record = def(name);
      expect(record.allOf, name).toEqual([
        { $ref: `#/$defs/${name.replace(/Operation$/, "Members")}` },
      ]);
      expect(record.unevaluatedProperties, name).toBe(false);
      expect(record.required, name).toEqual(["operation"]);
    }
    expect(propertiesOf("createBeadOperation").name).toEqual({ $ref: "#/$defs/localName" });
    expect(propertiesOf("updateBeadPropertiesOperation").name).toBeUndefined();
    // The receipt entry's deleted identity is the Read+Update record (X1).
    expect(propertiesOf("receiptResult").deleted).toEqual({ $ref: "#/$defs/deletedIdentity" });
    expect(propertiesOf("receiptResult").erased).toEqual({ $ref: "#/$defs/resourceIdentity" });
  });
});

describe("shapes the bundle now rejects", () => {
  const scope = SCOPE;
  const receiptBase = {
    id: `${scope}receipts/rcpt-7`,
    idempotencyKey: "client-key-0001",
    scopeEpoch: "epoch-1",
    authorizationView: "view-a",
    transaction: "txn-0a1b",
    requiredPosition: "pos-43",
  };
  const failedProblem = {
    type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
    code: "revision-mismatch",
    status: 409,
    retry: "after-state-change",
    operationIndex: 2,
  };
  const eventBase = {
    id: "ckpt-43_9",
    ordinal: 9,
    type: "updated",
    source: `${scope}events/`,
    subject: `${scope}beads/dec-9`,
    subjectType: "https://work.example/types/decision",
    transaction: "txn-0a1b",
    time: "2026-09-07T18:04:12Z",
  };
  const deletedLinkIdentity = {
    id: `${scope}links/9c1e`,
    type: OWNED_LINK_TYPE,
    revision: "9c1e-r1",
  };
  const linkRecord = {
    ...deletedLinkIdentity,
    source: `${scope}beads/dec-11`,
    target: `${scope}beads/task-42`,
    properties: { role: "primary" },
  };
  const discovery = {
    bdpVersion: "0",
    profile: "transactional",
    scope,
    scopeEpoch: "epoch-1",
    authorizationView: "view-a",
    headPosition: "pos-42",
    minimumReplayPosition: "pos-17",
    beads: `${scope}beads/`,
    links: `${scope}links/`,
    types: `${scope}types/`,
    operations: `${scope}operations/`,
    aliases: `${scope}alias/`,
    receipts: `${scope}receipts/`,
    snapshot: `${scope}snapshot`,
    changes: `${scope}changes/`,
    events: `${scope}events/`,
  };
  const advance = {
    scopeEpoch: "epoch-1",
    authorizationView: "view-b",
    checkpoint: "ckpt-44",
    position: "pos-44",
    previousPosition: "pos-43",
    projectionAdvance: true,
    eventCount: 0,
    changes: [],
    erasures: [],
    events: [],
  };
  const rejected: readonly (readonly [string, string, unknown])[] = [
    [
      "event",
      "an updated delta carrying both a Property Change and an owned-Link change",
      {
        ...eventBase,
        data: {
          previousRevision: "dec-9-r1",
          revision: "dec-9-r2",
          change: [{ op: "replace", path: "/status", value: "accepted" }],
          ownedLink: { operation: "deleted", link: deletedLinkIdentity },
        },
      },
    ],
    [
      "event",
      "an updated owned-Link transition carrying the Link's record instead of its delta",
      {
        ...eventBase,
        data: {
          previousRevision: "dec-11-r4",
          revision: "dec-11-r5",
          ownedLink: { operation: "updated", link: linkRecord },
        },
      },
    ],
    [
      "event",
      "an Event whose time is not a calendar instant",
      {
        ...eventBase,
        type: "deleted",
        time: "2026-99-99T99:99:99+99:99",
        data: { revision: "task-42-r9" },
      },
    ],
    [
      "event",
      "an Event whose time names a day that does not exist",
      { ...eventBase, type: "deleted", time: "2026-02-30T00:00:00Z", data: { revision: "r" } },
    ],
    [
      "batchRequest",
      "a body-level idempotencyKey",
      {
        idempotencyKey: "client-key-0001",
        operations: [
          { operation: "createBead", type: "https://work.example/types/task", properties: {} },
        ],
      },
    ],
    [
      "batchRequest",
      "a per-operation idempotencyKey",
      {
        operations: [
          {
            operation: "createBead",
            idempotencyKey: "member-key-1",
            type: "https://work.example/types/task",
          },
        ],
      },
    ],
    [
      "batchRequest",
      "a supplied id spelled with a leading @",
      {
        operations: [{ operation: "createBead", id: "@not-a-label", type: "https://t.example/t" }],
      },
    ],
    ["batchRequest", "an empty operation list", { operations: [] }],
    [
      "updateWhereRequest",
      "a set-operation singleton body carrying the batch discriminator",
      {
        operation: "updateWhere",
        collection: "beads",
        selector: '$[?@.properties.status == "ready"]',
        change: [{ op: "replace", path: "/status", value: "claimed" }],
      },
    ],
    [
      "mutationReceipt",
      "a completed receipt with available detail but no results",
      {
        ...receiptBase,
        status: "completed",
        detail: "available",
        next: null,
        expiresAt: "2026-09-14T18:04:12Z",
      },
    ],
    [
      "mutationReceipt",
      "an expired completed receipt without allocated",
      { ...receiptBase, status: "completed", detail: "expired", effectPosition: "pos-43" },
    ],
    [
      "mutationReceipt",
      "a failed receipt with expired detail (T47: failed receipts are forgotten, never expired)",
      { ...receiptBase, status: "failed", detail: "expired" },
    ],
    [
      "mutationReceipt",
      "a failed receipt with withheld detail",
      { ...receiptBase, status: "failed", detail: "withheld" },
    ],
    [
      "mutationReceipt",
      "a failed receipt carrying an effectPosition",
      {
        ...receiptBase,
        status: "failed",
        detail: "available",
        effectPosition: "pos-43",
        problem: failedProblem,
        expiresAt: "2026-09-14T18:04:12Z",
      },
    ],
    [
      "mutationReceipt",
      "a pending receipt carrying detail",
      { ...receiptBase, status: "pending", detail: "available" },
    ],
    [
      "receiptProblem",
      "a receipt problem without the failure's would-be status",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "revision-mismatch",
        retry: "after-state-change",
        operationIndex: 2,
      },
    ],
    [
      "receiptProblem",
      "a receipt problem carrying a direct-only code",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
        operationIndex: 0,
      },
    ],
    [
      "transactionalProblem",
      "a direct problem carrying a receipt-only code",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "revision-mismatch",
        status: 409,
        retry: "after-state-change",
      },
    ],
    [
      "receiptProblem",
      "a validation-failed receipt problem without diagnostics",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}validation`,
        code: "validation-failed",
        status: 422,
        retry: "never",
        operationIndex: 2,
      },
    ],
    [
      "receiptProblem",
      "an operation-level receipt problem without operationIndex",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "revision-mismatch",
        status: 409,
        retry: "after-state-change",
      },
    ],
    [
      "receiptProblem",
      "a limit on a problem that is not limit-exceeded",
      { ...failedProblem, limit: "transaction.duration" },
    ],
    [
      "transactionalProblem",
      "a resource-erased problem carrying a pointer",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}gone`,
        code: "resource-erased",
        status: 410,
        retry: "never",
        pointer: "/properties/title",
      },
    ],
    [
      "transactionalProblem",
      "retryAfter on a problem that is not after-delay",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
        retryAfter: 1,
      },
    ],
    [
      "receiptResult",
      "a deleted entry carrying sourceRevision without source",
      {
        operationIndex: 0,
        outcome: "deleted",
        deleted: { resourceKind: "link", resource: deletedLinkIdentity },
        sourceRevision: "dec-9-r3",
      },
    ],
    [
      "receiptResult",
      "a deleted Bead entry carrying the owned-source pair",
      {
        operationIndex: 1,
        outcome: "deleted",
        deleted: {
          resourceKind: "bead",
          resource: { id: `${scope}beads/task-42`, type: "https://t.example/t", revision: "r9" },
        },
        source: `${scope}beads/dec-9`,
        sourceRevision: "dec-9-r3",
      },
    ],
    [
      "receiptResult",
      "a deleted identity spelled as the bare lineage marker",
      { operationIndex: 0, outcome: "deleted", deleted: deletedLinkIdentity },
    ],
    [
      "receiptResult",
      "a matched entry carrying an operationName",
      { operationIndex: 0, operationName: "x", outcome: "matched", count: 2 },
    ],
    [
      "receiptResult",
      "a withheld entry carrying a record",
      { operationIndex: 0, outcome: "withheld", resource: { ...linkRecord } },
    ],
    [
      "receiptResult",
      "a Bead postimage carrying the owned-source pair",
      {
        operationIndex: 0,
        outcome: "created",
        resource: {
          id: `${scope}beads/dec-9`,
          type: "https://work.example/types/decision",
          revision: "r1",
          properties: {},
        },
        source: `${scope}beads/dec-9`,
        sourceRevision: "r2",
      },
    ],
    [
      "allocatedIdentity",
      "an allocated identity both withheld and identified",
      {
        operationIndex: 0,
        id: `${scope}beads/dec-9`,
        type: "https://work.example/types/decision",
        withheld: true,
      },
    ],
    [
      "changeGroup",
      "a projection advance that names a transaction",
      { ...advance, transaction: "adm-e1" },
    ],
    [
      "changeGroup",
      "a visible group that carries nothing",
      { ...advance, authorizationView: "view-a", projectionAdvance: false, transaction: "adm-e1" },
    ],
    [
      "changeGroup",
      "a visible group without a transaction",
      { ...advance, projectionAdvance: false, erasures: [erasureRecord()] },
    ],
    [
      "transactionalDiscovery",
      "a Transactional discovery document advertising retention.idempotency",
      { ...discovery, limits: { retention: { idempotency: "P1D", receipt: "P7D" } } },
    ],
    [
      "transactionalDiscovery",
      "a Transactional discovery document without aliases",
      Object.fromEntries(Object.entries(discovery).filter(([key]) => key !== "aliases")),
    ],
    [
      "transactionalDiscovery",
      "a Transactional discovery document without its history members",
      Object.fromEntries(Object.entries(discovery).filter(([key]) => key !== "headPosition")),
    ],
    [
      "erasureRecord",
      "a digest whose hexadecimal is not lowercase",
      {
        ...erasureRecord(),
        digest: {
          scheme: "sha-256-jcs",
          value: "5C9DB2F807BBED90617EC1A01F3C4C86E44967C703BF6E480CA97C2CE4FAE832",
        },
      },
    ],
    [
      "erasureRecord",
      "an unregistered digest scheme",
      { ...erasureRecord(), digest: { scheme: "sha-512", value: "0".repeat(64) } },
    ],
    [
      "snapshotManifest",
      "a manifest without its ledger",
      {
        id: `${scope}snapshot?snapshot=snapshot-42`,
        scope,
        scopeEpoch: "epoch-1",
        authorizationView: "view-a",
        scopePosition: "pos-42",
        checkpoint: "ckpt-42",
        expiresAt: "2026-09-07T19:22:00Z",
        beads: { items: [], next: null },
        links: { items: [], next: null },
      },
    ],
    [
      "transactionalOperationDirectory",
      "a directory without the alias targets",
      {
        createBead: "create-bead",
        updateBeadProperties: "update-bead-properties",
        deleteBead: "delete-bead",
        createLink: "create-link",
        updateLinkProperties: "update-link-properties",
        deleteLink: "delete-link",
        sequence: "sequence",
        updateWhere: "update-where",
        deleteWhere: "delete-where",
        batch: "batch",
      },
    ],
  ];
  for (const [definition, label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(compiledDefinition(`#/$defs/${definition}`)(value)).toBe(false);
    });
  }

  it("still admits the lowercase RFC 3339 forms a client accepts, pinned labels, and the five receipt representations", () => {
    expectValid(
      "#/$defs/event",
      {
        ...eventBase,
        type: "deleted",
        time: "2026-09-07t18:04:12.5+02:00",
        data: { revision: "r" },
      },
      "lowercase t with a fraction and an offset",
    );
    expectValid(
      "#/$defs/batchRequest",
      {
        operations: [
          { name: "d", operation: "createBead", type: "https://work.example/types/decision" },
          {
            operation: "createLink",
            type: OWNED_LINK_TYPE,
            source: { uri: "@d", revision: "pin" },
            target: "beads/task-42",
          },
        ],
      },
      "a pinned @label endpoint",
    );
    expectValid(
      "#/$defs/mutationReceipt",
      { ...receiptBase, status: "completed", detail: "withheld", effectPosition: "pos-43" },
      "a wholly withheld completed receipt",
    );
    expectValid(
      "#/$defs/mutationReceipt",
      {
        ...receiptBase,
        status: "completed",
        detail: "expired",
        allocated: [{ operationIndex: 0, withheld: true }],
      },
      "an expired receipt whose allocated identity is withheld",
    );
    expectValid(
      "#/$defs/receiptProblem",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}size`,
        code: "limit-exceeded",
        status: 413,
        retry: "never",
        limit: "transaction.inducedEvents",
      },
      "a transaction-level limit without an operationIndex",
    );
    expectValid(
      "#/$defs/receiptProblem",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}request`,
        code: "binding-unavailable",
        status: 400,
        retry: "never",
        operationIndex: 1,
      },
      "a sequence member's binding-unavailable receipt problem",
    );
    expectValid(
      "#/$defs/receiptProblem",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "alias-path-taken",
        status: 409,
        retry: "after-state-change",
        operationIndex: 0,
        pointer: "/operations/0/id",
      },
      "a Bead creation on a live alias path inside a receipt",
    );
  });

  function erasureRecord(): JsonRecord {
    return {
      subject: `${scope}beads/task-42`,
      revision: "task-42-r7",
      digest: {
        scheme: "sha-256-jcs",
        value: "5c9db2f807bbed90617ec1a01f3c4c86e44967c703bf6e480ca97c2ce4fae832",
      },
    };
  }
});

const SINGLETON_OPERATIONS: ReadonlyMap<string, string> = new Map([
  ["operations/create-bead", "createBead"],
  ["operations/update-bead-properties", "updateBeadProperties"],
  ["operations/delete-bead", "deleteBead"],
  ["operations/create-link", "createLink"],
  ["operations/update-link-properties", "updateLinkProperties"],
  ["operations/delete-link", "deleteLink"],
  ["operations/update-where", "updateWhere"],
  ["operations/delete-where", "deleteWhere"],
  ["operations/put-alias", "putAlias"],
  ["operations/delete-alias", "deleteAlias"],
]);

function isDirectProblem(exchange: FixtureExchange): boolean {
  return exchange.response.schema === "#/$defs/transactionalProblem";
}

/** The operation records a receipt's entries answer: a batch's list, or the singleton body as one record. */
function requestOperations(exchange: FixtureExchange): readonly JsonRecord[] | undefined {
  const { request } = exchange;
  if (request.method !== "POST" || request.body === undefined) return undefined;
  if (request.target === "operations/batch")
    return request.body.operations as readonly JsonRecord[];
  const operation = SINGLETON_OPERATIONS.get(request.target);
  if (operation === undefined) return undefined;
  return [{ ...request.body, operation }];
}

/** The receipt's inline entries followed by every page the fixture continues into. */
function receiptEntries(
  fixture: TransactionalFixture,
  exchange: FixtureExchange,
): readonly JsonRecord[] {
  const entries = [
    ...((exchange.response.body.results as readonly JsonRecord[] | undefined) ?? []),
  ];
  let next = exchange.response.body.next;
  const visited = new Set<string>();
  while (typeof next === "string") {
    expect(visited.has(next), `${exchange.id}: repeated page URL`).toBe(false);
    visited.add(next);
    expect(next.startsWith(fixture.scope), exchange.id).toBe(true);
    const target = next.slice(fixture.scope.length);
    const page = fixture.exchanges.find(
      (candidate) =>
        candidate.request.target === target &&
        candidate.response.schema === "#/$defs/mutationReceiptPage",
    );
    if (page === undefined) throw new Error(`${exchange.id}: missing receipt page ${target}`);
    expect(page.response.body.receipt, exchange.id).toBe(exchange.response.body.id);
    entries.push(...(page.response.body.results as readonly JsonRecord[]));
    next = page.response.body.next;
  }
  return entries;
}

/** Check the complete illustrative page chain against this Scope's discovery bound. */
function expectReceiptPagination(fixture: TransactionalFixture, maximumItems: number): void {
  for (const exchange of fixture.exchanges) {
    if (exchange.response.schema === "#/$defs/mutationReceiptPage") {
      expect(
        (exchange.response.body.results as readonly unknown[]).length,
        exchange.id,
      ).toBeLessThanOrEqual(maximumItems);
      continue;
    }
    if (
      exchange.response.schema !== "#/$defs/mutationReceipt" ||
      exchange.response.body.status !== "completed" ||
      exchange.response.body.detail !== "available"
    )
      continue;
    const receipt = exchange.response.body;
    const inline = receipt.results as readonly JsonRecord[];
    const all = [...inline];
    expect(inline.length, exchange.id).toBeLessThanOrEqual(maximumItems);
    let next = receipt.next;
    const visited = new Set<string>();
    while (typeof next === "string") {
      expect(next.startsWith(fixture.scope), exchange.id).toBe(true);
      expect(visited.has(next), `${exchange.id}: page cycle`).toBe(false);
      visited.add(next);
      const target = next.slice(fixture.scope.length);
      const page = fixture.exchanges.find(
        (candidate) =>
          candidate.request.target === target &&
          candidate.response.schema === "#/$defs/mutationReceiptPage",
      );
      expect(page, `${exchange.id}: missing page ${target}`).toBeDefined();
      const body = page?.response.body as JsonRecord;
      expect(body.receipt, exchange.id).toBe(receipt.id);
      const results = body.results as readonly JsonRecord[];
      expect(results.length, exchange.id).toBeGreaterThan(0);
      expect(results.length, exchange.id).toBeLessThanOrEqual(maximumItems);
      all.push(...results);
      next = body.next;
    }
    expect(next, `${exchange.id}: terminal next`).toBeNull();
    if (all.length <= maximumItems) {
      expect(receipt.next, `${exchange.id}: all entries fit inline`).toBeNull();
      expect(inline, exchange.id).toEqual(all);
    } else {
      expect(typeof receipt.next, `${exchange.id}: entries exceed inline bound`).toBe("string");
    }
  }
}

function expectReceiptRepresentation(
  receipt: JsonRecord,
  exchange: FixtureExchange,
  scope = SCOPE,
): void {
  const label = exchange.id;
  expect(typeof receipt.id, label).toBe("string");
  expect((receipt.id as string).startsWith(`${scope}receipts/`), label).toBe(true);
  if (exchange.request.method === "POST")
    expect(receipt.idempotencyKey, label).toBe(exchange.request.headers["idempotency-key"]);
  if (receipt.status === "pending") {
    expect(exchange.response.status, label).toBe(exchange.request.method === "POST" ? 202 : 200);
    if (exchange.request.method === "POST")
      expect(exchange.response.headers["retry-after"], label).toBeDefined();
    expect(receipt.detail, label).toBeUndefined();
    return;
  }
  expect(exchange.response.status, label).toBe(200);
  if (receipt.status === "failed") {
    expect(receipt.detail, label).toBe("available");
    expect(receipt.effectPosition, label).toBeUndefined();
    expect(typeof receipt.expiresAt, label).toBe("string");
    const problem = receipt.problem as JsonRecord;
    expectProblemRow(problem, `${label}: problem`);
    expect(def("receiptProblemCode").enum as string[], label).toContain(problem.code);
    return;
  }
  expect(receipt.status, label).toBe("completed");
  if (receipt.detail === "expired") {
    expect(receipt.results, label).toBeUndefined();
    expect(Array.isArray(receipt.allocated), label).toBe(true);
  } else if (receipt.detail === "withheld") {
    expect(receipt.results, label).toBeUndefined();
    expect(receipt.allocated, label).toBeUndefined();
  } else {
    expect(receipt.detail, label).toBe("available");
    expect(Array.isArray(receipt.results), label).toBe(true);
    expect(typeof receipt.expiresAt, label).toBe("string");
  }
}

/**
 * Entry/operation correspondence the schema cannot express: every entry names
 * an operation of the request, entries appear in operation order, a set
 * operation's `matched` count is the number of per-Resource entries that
 * follow it, and an entry's outcome, record type, deleted kind, and
 * owned-source pair follow from the operation that produced it.
 */
function expectEntriesCorrespond(
  entries: readonly JsonRecord[],
  operations: readonly JsonRecord[],
  label: string,
  priorResources: readonly JsonRecord[] = [],
  scope = SCOPE,
): void {
  // This helper receives the whole page chain of a completed, available
  // receipt. Check every requested operation, not just entries that survived.
  for (const [index, operation] of operations.entries()) {
    const results = entries.filter((entry) => entry.operationIndex === index);
    const operationLabel = `${label}: operation ${index}`;
    if ((operation.operation as string).endsWith("Where")) {
      const matched = results.filter((entry) => entry.outcome === "matched");
      expect(matched.length, operationLabel).toBe(1);
      expect(results[0], operationLabel).toBe(matched[0]);
      expect(results.length, operationLabel).toBe(1 + (matched[0]?.count as number));
      const identities = results.slice(1).flatMap((entry) => {
        // Withheld entries disclose no identity; count them, but do not
        // invent a uniqueness oracle for undisclosed Resource identities.
        if (entry.outcome === "withheld") return [];
        const identity =
          entry.resource ?? entry.erased ?? (entry.deleted as JsonRecord | undefined)?.resource;
        return [(identity as JsonRecord).id];
      });
      expect(new Set(identities).size, operationLabel).toBe(identities.length);
    } else {
      expect(results.length, operationLabel).toBe(1);
      expect(results[0]?.outcome, operationLabel).not.toBe("matched");
    }
  }
  let lastIndex = -1;
  for (const [position, entry] of entries.entries()) {
    const index = entry.operationIndex as number;
    const entryLabel = `${label}[${position}]`;
    expect(index, entryLabel).toBeGreaterThanOrEqual(lastIndex);
    expect(index, entryLabel).toBeLessThan(operations.length);
    lastIndex = index;
    const operation = operations[index] as JsonRecord;
    const kind = operation.operation as string;
    if (entry.outcome === "matched") {
      expect(kind, entryLabel).toMatch(/Where$/);
      const following = entries
        .slice(position + 1)
        .filter((candidate) => candidate.operationIndex === index);
      expect(following.length, entryLabel).toBe(entry.count);
      expect(entry.operationName, entryLabel).toBeUndefined();
      continue;
    }
    expect(entry.operationName, entryLabel).toEqual(operation.name);
    if (entry.outcome === "withheld") continue;
    if (entry.outcome === "erased") {
      expect(kind, entryLabel).not.toMatch(/^delete/);
      const identity = entry.erased as JsonRecord;
      const isBead =
        kind === "createBead" ||
        kind === "updateBeadProperties" ||
        (kind === "updateWhere" && operation.collection === "beads");
      // Kind comes from the originating operation; ownership comes from
      // this fixture domain's declared Type, never from a new wire member.
      if (!isBead && identity.type === OWNED_LINK_TYPE) {
        expect(typeof entry.source, entryLabel).toBe("string");
        expect(typeof entry.sourceRevision, entryLabel).toBe("string");
      } else {
        expect(entry.source, entryLabel).toBeUndefined();
        expect(entry.sourceRevision, entryLabel).toBeUndefined();
      }
      continue;
    }
    if (kind === "putAlias" || kind === "deleteAlias") {
      expect(entry.alias, entryLabel).toBe(new URL(`alias/${operation.alias}`, scope).href);
      expect(entry.resource, entryLabel).toBeUndefined();
      expect(entry.deleted, entryLabel).toBeUndefined();
      if (kind === "putAlias") {
        expect(["created", "updated"], entryLabel).toContain(entry.outcome);
        expect(entry.target, entryLabel).toBe(new URL(operation.target as string, scope).href);
      } else {
        expect(entry.outcome, entryLabel).toBe("deleted");
        expect(entry.target, entryLabel).toBeUndefined();
      }
      continue;
    }
    if (kind.startsWith("delete")) {
      expect(entry.outcome, entryLabel).toBe("deleted");
      const deleted = entry.deleted as JsonRecord;
      const expectedKind =
        kind === "deleteBead" || (kind === "deleteWhere" && operation.collection === "beads")
          ? "bead"
          : "link";
      expect(deleted.resourceKind, entryLabel).toBe(expectedKind);
      const identity = deleted.resource as JsonRecord;
      if (operation.expectedRevision !== undefined)
        expect(identity.revision, entryLabel).toBe(operation.expectedRevision);
      if (identity.type === OWNED_LINK_TYPE) {
        expect(typeof entry.source, entryLabel).toBe("string");
        expect(typeof entry.sourceRevision, entryLabel).toBe("string");
      } else {
        expect(entry.source, entryLabel).toBeUndefined();
      }
      continue;
    }
    expect(entry.outcome, entryLabel).toBe(kind.startsWith("create") ? "created" : "updated");
    const resource = entry.resource as JsonRecord;
    if (operation.type !== undefined) expect(resource.type, entryLabel).toBe(operation.type);
    const subject = operation.bead ?? operation.link;
    const prior =
      typeof subject === "string"
        ? priorResources.find((record) => record.id === new URL(subject, scope).href)
        : undefined;
    if (prior !== undefined) {
      // These explicit before-state fixtures use same-value replacements.
      // Prove the request is a no-op before examining the returned revision.
      expect(kind, entryLabel).toMatch(/^update/);
      expect(operation.expectedRevision, entryLabel).toBe(prior.revision);
      const patches = operation.change as readonly JsonRecord[];
      expect(patches.length, entryLabel).toBeGreaterThan(0);
      for (const patch of patches) {
        expect(patch.op, entryLabel).toBe("replace");
        let value: unknown = prior.properties;
        const pointer = patch.path as string;
        for (const token of pointer === "" ? [] : pointer.slice(1).split("/")) {
          const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
          expect(Object.hasOwn(value as object, key), entryLabel).toBe(true);
          value = (value as JsonRecord)[key];
        }
        expect(patch.value, entryLabel).toEqual(value);
      }
      expect(resource, entryLabel).toEqual(prior);
    } else {
      if (entry.outcome === "updated" && operation.expectedRevision !== undefined)
        expect(resource.revision, `${entryLabel}: no-op needs a before-state oracle`).not.toBe(
          operation.expectedRevision,
        );
      if (operation.attribution !== undefined)
        expect(resource.attribution, entryLabel).toEqual(operation.attribution);
    }
    if (resource.type === OWNED_LINK_TYPE) {
      expect(entry.source, entryLabel).toBe(resource.source);
      expect(typeof entry.sourceRevision, entryLabel).toBe("string");
    } else {
      expect(entry.source, entryLabel).toBeUndefined();
      expect(entry.sourceRevision, entryLabel).toBeUndefined();
    }
  }
}

/** Committed-group example metadata supplies its own canonical Scope. */
function expectGroupScope(group: JsonRecord, scope: string, label: string): void {
  expect(isJsonSchemaUri(scope), label).toBe(true);
  expect(scope.endsWith("/"), label).toBe(true);
  for (const event of group.events as readonly JsonRecord[]) {
    expect(event.source, label).toBe(`${scope}events/`);
    expect((event.subject as string).startsWith(scope), label).toBe(true);
  }
  for (const change of group.changes as readonly JsonRecord[]) {
    const identity = (change.resource ?? change) as JsonRecord;
    expect((identity.id as string).startsWith(scope), label).toBe(true);
  }
  for (const record of erasureRecords(group))
    expect((record.subject as string).startsWith(scope), label).toBe(true);
  for (const record of servedRecords(group)) {
    expect((record.id as string).startsWith(scope), label).toBe(true);
    if (typeof record.source === "string")
      expect(record.source.startsWith(scope), label).toBe(true);
  }
}

function expectChangeGroup(group: JsonRecord, label: string): void {
  const events = group.events as readonly JsonRecord[];
  const changes = group.changes as readonly JsonRecord[];
  const erasures = group.erasures as readonly JsonRecord[];
  expect(group.eventCount, label).toBe(events.length);
  expectOrdinalsIncrease(events, label);
  for (const record of erasures) {
    expect((record.digest as JsonRecord).value, label).toMatch(HEX_DIGEST);
  }
  if (group.projectionAdvance === true) {
    expect(group.transaction, label).toBeUndefined();
    expect([events.length, changes.length, erasures.length], label).toEqual([0, 0, 0]);
    return;
  }
  expect(typeof group.transaction, label).toBe("string");
  expect(events.length + changes.length + erasures.length, label).toBeGreaterThan(0);
  for (const event of events) {
    expect(event.transaction, label).toBe(group.transaction);
    expect(isJsonSchemaDateTime(event.time as string), label).toBe(true);
    if (event.type === "created" || event.type === "updated") {
      const data = event.data as JsonRecord;
      const postimage = changes.find(
        (change) =>
          change.operation === "upsert" &&
          (change.resource as JsonRecord).id === event.subject &&
          (change.resource as JsonRecord).revision === data.revision,
      )?.resource as JsonRecord | undefined;
      // Groups contain all ordered Events, but only final postimages;
      // compare attribution only when the exact version is present.
      if (postimage !== undefined) {
        expect(data.attribution, `${label}: Event attribution`).toEqual(postimage.attribution);
      }
      const owned = data.ownedLink as JsonRecord | undefined;
      if (owned !== undefined && owned.operation !== "deleted") {
        const link = owned.link as JsonRecord;
        const linkPostimage = changes.find(
          (change) =>
            change.operation === "upsert" &&
            (change.resource as JsonRecord).id === link.id &&
            (change.resource as JsonRecord).revision === link.revision,
        )?.resource as JsonRecord | undefined;
        if (linkPostimage !== undefined)
          expect(link.attribution, `${label}: nested Link attribution`).toEqual(
            linkPostimage.attribution,
          );
      }
    }
  }
  // An owning source's postimage and its owned Links' postimages describe
  // one graph: the inline record and the first-class record agree.
  const linkUpserts = new Map<string, JsonRecord>();
  for (const change of changes) {
    if (change.operation === "upsert" && change.resourceKind === "link")
      linkUpserts.set((change.resource as JsonRecord).id as string, change.resource as JsonRecord);
  }
  for (const change of changes) {
    if (change.operation !== "upsert" || change.resourceKind !== "bead") continue;
    const owned = (change.resource as JsonRecord).ownedLinks as
      | Readonly<Record<string, readonly JsonRecord[]>>
      | undefined;
    for (const [type, links] of Object.entries(owned ?? {})) {
      for (const link of links) {
        expect(link.type, label).toBe(type);
        expect(link.source, label).toBe((change.resource as JsonRecord).id);
        const firstClass = linkUpserts.get(link.id as string);
        if (firstClass !== undefined) expect(link, `${label}: ${link.id}`).toEqual(firstClass);
      }
    }
  }
}

function expectOrdinalsIncrease(events: readonly JsonRecord[], label: string): void {
  // Ordinals belong to authority transaction groups. An Event Source page
  // can span several groups, each retaining its own projected ordinal gaps.
  const lastByTransaction = new Map<string, number>();
  for (const event of events) {
    const transaction = event.transaction as string;
    expect(event.ordinal as number, label).toBeGreaterThan(
      lastByTransaction.get(transaction) ?? -1,
    );
    lastByTransaction.set(transaction, event.ordinal as number);
  }
}

/** A snapshot is a closed projection: in-Scope endpoints present, inline owned Links agreeing. */
function expectClosedSnapshot(manifest: JsonRecord, label: string, scope = SCOPE): void {
  const beads = (manifest.beads as JsonRecord).items as readonly JsonRecord[];
  const links = (manifest.links as JsonRecord).items as readonly JsonRecord[];
  const beadIds = new Set(beads.map((bead) => bead.id as string));
  const linkById = new Map(links.map((link) => [link.id as string, link] as const));
  for (const link of links) {
    for (const endpoint of ["source", "target"] as const) {
      const reference = link[endpoint];
      const uri = typeof reference === "string" ? reference : (reference as JsonRecord).uri;
      if (typeof uri === "string" && uri.startsWith(`${scope}beads/`))
        expect(beadIds.has(uri), `${label}: ${link.id} ${endpoint}`).toBe(true);
    }
  }
  for (const bead of beads) {
    const owned = bead.ownedLinks as Readonly<Record<string, readonly JsonRecord[]>> | undefined;
    for (const inline of Object.values(owned ?? {}).flat()) {
      const firstClass = linkById.get(inline.id as string);
      expect(firstClass, `${label}: ${inline.id} missing from the links stream`).toBeDefined();
      expect(inline, `${label}: ${inline.id}`).toEqual(firstClass);
    }
  }
  for (const record of manifest.erasures as readonly JsonRecord[])
    expect((record.digest as JsonRecord).value, label).toMatch(HEX_DIGEST);
}

/** Every complete Resource record a response body serves, wherever it appears. */
function servedRecords(body: JsonRecord): readonly JsonRecord[] {
  const found: JsonRecord[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as JsonRecord;
    if (
      typeof record.id === "string" &&
      typeof record.type === "string" &&
      typeof record.revision === "string" &&
      typeof record.properties === "object"
    ) {
      found.push(record);
    }
    for (const member of Object.values(record)) visit(member);
  };
  visit(body);
  return found;
}

function erasureRecords(body: JsonRecord): readonly JsonRecord[] {
  const found: JsonRecord[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as JsonRecord;
    if (typeof record.subject === "string" && typeof record.digest === "object") found.push(record);
    for (const member of Object.values(record)) visit(member);
  };
  visit(body);
  return found;
}

/** Object member names in UTF-16 code-unit order, recursively — what RFC 8785 requires. */
function expectSortedMembers(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    for (const item of value) expectSortedMembers(item, label);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const keys = Object.keys(value);
  const sorted = [...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  expect(keys, label).toEqual(sorted);
  for (const member of Object.values(value)) expectSortedMembers(member, label);
}

function expectProblemRow(problem: JsonRecord, label: string): void {
  const code = problem.code as string;
  const readRow = READ_PROBLEM_DEFINITIONS.find((definition) => definition.code === code);
  const readUpdateRows = problemTableRows(markdownSection(specification, "Problem details")).slice(
    READ_PROBLEM_DEFINITIONS.length,
  );
  const row =
    readRow === undefined
      ? readUpdateRows.find(([candidate]) => candidate === code)
      : ([readRow.code, readRow.family, readRow.status, readRow.retry] as const);
  if (row === undefined) throw new Error(`${label}: unknown problem code ${code}`);
  expect(problem.type, label).toBe(`${BDP_PROBLEM_FAMILY_PREFIX}${row[1]}`);
  expect(problem.status, label).toBe(row[2]);
  expect(problem.retry, label).toBe(row[3]);
}

function expectValid(schemaRef: string, value: unknown, label: string): void {
  const validate = compiledDefinition(schemaRef);
  expect(validate(value), `${label}: ${JSON.stringify(validate.errors, null, 2)}`).toBe(true);
}

function compiledDefinition(schemaRef: string): ValidateFunction {
  const validate = ajv.getSchema(`${BDP_V0_SCHEMA_ID}${schemaRef}`);
  if (validate === undefined) throw new Error(`schema definition not found: ${schemaRef}`);
  return validate;
}

function def(name: string): SchemaRecord {
  return requiredRecord(requiredRecord(schema.$defs, "$defs")[name], `$defs.${name}`);
}

function propertiesOf(name: string): SchemaRecord {
  return requiredRecord(def(name).properties, `$defs.${name}.properties`);
}

function requiredRecord(value: unknown, pathLabel: string): SchemaRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${pathLabel} must be a record`);
  return value as SchemaRecord;
}

/** The Markdown from a `###` heading to the next heading of level three or higher. */
function markdownSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n### ${heading}\n`);
  if (start < 0) throw new Error(`missing specification section: ${heading}`);
  const rest = markdown.slice(start + 1);
  const bodyStart = rest.indexOf("\n") + 1;
  const end = rest.slice(bodyStart).search(/^#{1,3} /m);
  return end < 0 ? rest : rest.slice(0, bodyStart + end);
}

/** Every `| \`code\` | \`family\` | status | \`retry\` |` row, in document order. */
function problemTableRows(section: string): readonly (readonly [string, string, number, string])[] {
  return [
    ...section.matchAll(/^\| `([a-z-]+)` \| `([a-z-]+)` \| (\d{3}) \| `([a-z-]+)` \|$/gm),
  ].map((match) => [match[1] ?? "", match[2] ?? "", Number(match[3]), match[4] ?? ""] as const);
}

describe("Transactional correction regression probes", () => {
  it("accepts a same-source Event page whose ordinals restart in the next transaction", () => {
    const fixture = fixtures.find(({ id }) => id === "transactional-events");
    const creation = fixture?.exchanges.find(({ id }) => id === "dec-9-after-owned-link-created")
      ?.response.body as JsonRecord;
    const deletion = fixture?.exchanges.find(({ id }) => id === "dec-9-after-owned-link-deleted")
      ?.response.body as JsonRecord;
    const events = [...(creation.events as JsonRecord[]), ...(deletion.events as JsonRecord[])];
    const page = { ...deletion, events };
    expectValid("#/$defs/eventPage", page, "same-source multi-transaction history");
    expect(events.map(({ ordinal }) => ordinal)).toEqual([0, 2, 4, 1, 3]);
    expect(new Set(events.map(({ source }) => source))).toEqual(new Set([creation.source]));
    expect(new Set(events.map(({ transaction }) => transaction)).size).toBe(2);
    expectOrdinalsIncrease(events, "same-source multi-transaction history");
    const reversedWithinTransaction = [...events];
    [reversedWithinTransaction[3], reversedWithinTransaction[4]] = [
      events[4] as JsonRecord,
      events[3] as JsonRecord,
    ];
    expect(() =>
      expectOrdinalsIncrease(reversedWithinTransaction, "reversed deletion ordinals"),
    ).toThrow();
  });

  it.each(TRANSACTIONAL_PROBLEM_ROWS)(
    "rejects validation diagnostics on %s",
    (code, family, status, retry) => {
      const definition =
        code === "cardinality-violated" ? "receiptProblem" : "transactionalProblem";
      const valid = {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}${family}`,
        code,
        status,
        retry,
        ...(code === "cardinality-violated" ? { operationIndex: 0 } : {}),
      };
      const validate = ajv.getSchema(
        `${BDP_V0_SCHEMA_ID}#/$defs/${definition}`,
      ) as ValidateFunction;
      expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
      expect(
        validate({ ...valid, diagnostics: [{ message: "valid diagnostic on wrong code" }] }),
      ).toBe(false);
      expect(validate({ ...valid, diagnosticsTruncated: true })).toBe(false);
    },
  );

  it("rejects a no-op response that mints a revision or replaces prior attribution", () => {
    const fixture = fixtures.find((candidate) =>
      candidate.exchanges.some(
        (exchange) => exchange.id === "no-op-preserves-existing-attribution",
      ),
    ) as TransactionalFixture;
    const exchange = fixture.exchanges.find(
      (candidate) => candidate.id === "no-op-preserves-existing-attribution",
    ) as FixtureExchange;
    const operations = requestOperations(exchange) as readonly JsonRecord[];
    const entries = receiptEntries(fixture, exchange);
    expect(() =>
      expectEntriesCorrespond(entries, operations, "valid no-op", exchange.priorResources),
    ).not.toThrow();
    for (const mutation of [
      { revision: "noop-r2" },
      { attribution: operations[0]?.attribution },
      { revision: "noop-r2", attribution: operations[0]?.attribution },
    ]) {
      const corrupt = structuredClone(entries) as JsonRecord[];
      corrupt[0] = {
        ...corrupt[0],
        resource: { ...(corrupt[0]?.resource as JsonRecord), ...mutation },
      };
      expect(() =>
        expectEntriesCorrespond(corrupt, operations, "corrupt no-op", exchange.priorResources),
      ).toThrow();
    }
  });

  it("rejects omitted attribution in either successor Event and its nested Link delta", () => {
    const example = fixtures
      .flatMap((fixture) => fixture.groupExamples ?? [])
      .find((candidate) => candidate.id === "isolated-live-owned-link-erasure");
    expect(example).toBeDefined();
    const group = example?.body as JsonRecord;
    expect(() => expectChangeGroup(group, "valid erasure successor")).not.toThrow();
    // Equality is required only when attribution was recorded. Omitting it
    // consistently is valid too; this probe imposes no administrative policy.
    const unattributed = JSON.parse(JSON.stringify(group), (key, value: unknown) =>
      key === "attribution" ? undefined : value,
    ) as JsonRecord;
    expect(() => expectChangeGroup(unattributed, "no attribution recorded")).not.toThrow();
    for (const target of ["link", "source", "nested"]) {
      const corrupt = structuredClone(group);
      const events = corrupt.events as JsonRecord[];
      const data = events[target === "link" ? 0 : 1]?.data as JsonRecord;
      if (target === "nested")
        delete ((data.ownedLink as JsonRecord).link as JsonRecord).attribution;
      else delete data.attribution;
      expect(() => expectChangeGroup(corrupt, `missing ${target} attribution`)).toThrow();
    }
  });

  it("rejects unnecessary pagination and over-bound inline or page results", () => {
    const fixture = fixtures.find(
      (candidate) => candidate.id === "transactional-receipt-pagination",
    ) as TransactionalFixture;
    expect(() => expectReceiptPagination(fixture, 3)).not.toThrow();
    // The original acme defect: all five entries fit, yet next still points to a page.
    expect(() => expectReceiptPagination(fixture, 200)).toThrow();
    const inlineOverflow = structuredClone(fixture);
    const receipt = inlineOverflow.exchanges.find(
      (exchange) => exchange.id === "pagination-batch-original",
    )?.response.body as JsonRecord;
    const results = receipt.results as JsonRecord[];
    results.push(...structuredClone(results));
    expect(() => expectReceiptPagination(inlineOverflow, 3)).toThrow();
    const pageOverflow = structuredClone(fixture);
    const page = pageOverflow.exchanges.find(
      (exchange) => exchange.response.schema === "#/$defs/mutationReceiptPage",
    )?.response.body as JsonRecord;
    (page.results as JsonRecord[]).push(
      structuredClone((page.results as JsonRecord[])[0] as JsonRecord),
    );
    expect(() => expectReceiptPagination(pageOverflow, 3)).toThrow();
  });

  it("compares attribution only for the Event's exact version, including nested Link versions", () => {
    const example = fixtures
      .flatMap((fixture) => fixture.groupExamples ?? [])
      .find((candidate) => candidate.id === "isolated-live-owned-link-erasure");
    const group = structuredClone(example?.body as JsonRecord);
    const finalEvents = group.events as JsonRecord[];
    const earlierEvents = structuredClone(finalEvents);
    for (const event of earlierEvents) {
      const data = event.data as JsonRecord;
      event.id = `${event.id}-earlier`;
      data.previousRevision = `${data.previousRevision}-before`;
      data.revision = `${data.revision}-intermediate`;
      data.attribution = { principal: "human:earlier-author", status: "claimed" };
      const owned = data.ownedLink as JsonRecord | undefined;
      if (owned !== undefined) {
        const link = owned.link as JsonRecord;
        link.previousRevision = `${link.previousRevision}-before`;
        link.revision = `${link.revision}-intermediate`;
        link.attribution = data.attribution;
      }
    }
    // Only the final postimages appear in changes; ordered earlier facts
    // retain their own version's attribution and must not be compared to them.
    for (const [index, event] of finalEvents.entries()) {
      const data = event.data as JsonRecord;
      const earlier = (earlierEvents[index] as JsonRecord).data as JsonRecord;
      data.previousRevision = earlier.revision;
      const owned = data.ownedLink as JsonRecord | undefined;
      if (owned !== undefined)
        (owned.link as JsonRecord).previousRevision = (
          (earlier.ownedLink as JsonRecord).link as JsonRecord
        ).revision;
    }
    group.events = [...earlierEvents, ...finalEvents].map((event, ordinal) => ({
      ...event,
      ordinal,
    }));
    group.eventCount = 4;
    expect(() => expectChangeGroup(group, "intermediate attribution")).not.toThrow();
  });

  it("rejects missing or duplicate singleton outcomes across the complete receipt page chain", () => {
    for (const fixtureId of ["transactional-batch", "transactional-receipt-pagination"]) {
      const fixture = fixtures.find(
        (candidate) => candidate.id === fixtureId,
      ) as TransactionalFixture;
      const exchange = fixture.exchanges.find(
        (candidate) =>
          candidate.id === "batch-2-original" || candidate.id === "pagination-batch-original",
      ) as FixtureExchange;
      const entries = receiptEntries(fixture, exchange);
      const operations = requestOperations(exchange) as readonly JsonRecord[];
      expect(() =>
        expectEntriesCorrespond(entries, operations, "complete batch", [], fixture.scope),
      ).not.toThrow();
      const deletedBead = entries.find((entry) => entry.operationIndex === 1) as JsonRecord;
      for (const corrupt of [
        entries.filter((entry) => entry.operationIndex !== 1),
        [
          ...entries.filter((entry) => (entry.operationIndex as number) < 2),
          deletedBead,
          ...entries.filter((entry) => entry.operationIndex === 2),
        ],
      ]) {
        for (const entry of corrupt)
          expectValid("#/$defs/receiptResult", entry, "shape-valid incomplete receipt");
        expect(() =>
          expectEntriesCorrespond(
            corrupt,
            operations,
            "missing or duplicate outcome",
            [],
            fixture.scope,
          ),
        ).toThrow();
      }
    }
    const fixture = fixtures.find((candidate) =>
      candidate.exchanges.some(
        (exchange) => exchange.id === "no-op-preserves-existing-attribution",
      ),
    ) as TransactionalFixture;
    const exchange = fixture.exchanges.find(
      (candidate) => candidate.id === "no-op-preserves-existing-attribution",
    ) as FixtureExchange;
    expect(() =>
      expectEntriesCorrespond(
        [],
        requestOperations(exchange) as readonly JsonRecord[],
        "missing no-op result",
        exchange.priorResources,
      ),
    ).toThrow();
  });

  it("rejects a missing or duplicate set matched entry and duplicate Resource outcomes", () => {
    const fixture = fixtures.find(
      (candidate) => candidate.id === "transactional-receipt-pagination",
    ) as TransactionalFixture;
    const exchange = fixture.exchanges.find(
      (candidate) => candidate.id === "pagination-batch-original",
    ) as FixtureExchange;
    const entries = receiptEntries(fixture, exchange);
    const operations = requestOperations(exchange) as readonly JsonRecord[];
    const matched = entries[0] as JsonRecord;
    const firstDeleted = entries[1] as JsonRecord;
    const tail = entries.filter((entry) => entry.operationIndex !== 0);
    for (const corrupt of [
      entries.slice(1),
      [{ ...matched, count: 3 }, matched, ...entries.slice(1)],
      [matched, firstDeleted, firstDeleted, ...tail],
      [{ ...matched, count: 3 }, firstDeleted, firstDeleted, entries[2] as JsonRecord, ...tail],
      entries.filter((_, index) => index !== 2),
    ]) {
      for (const entry of corrupt)
        expectValid("#/$defs/receiptResult", entry, "shape-valid set mismatch");
      expect(() =>
        expectEntriesCorrespond(corrupt, operations, "bad set result", [], fixture.scope),
      ).toThrow();
    }
    const zeroMatch = [{ operationIndex: 0, outcome: "matched", count: 0 }];
    expect(() =>
      expectEntriesCorrespond(
        zeroMatch,
        [operations[0] as JsonRecord],
        "valid zero match",
        [],
        fixture.scope,
      ),
    ).not.toThrow();
  });

  it("uses the original request to check erased identity ownership context", () => {
    const original = fixtures
      .find((fixture) => fixture.id === "transactional-batch")
      ?.exchanges.find((exchange) => exchange.id === "batch-1-original") as FixtureExchange;
    const projected = fixtures
      .find((fixture) => fixture.id === "transactional-receipts")
      ?.exchanges.find((exchange) => exchange.id === "receipt-7-after-erasure") as FixtureExchange;
    const operations = requestOperations(original) as readonly JsonRecord[];
    const entries = projected.response.body.results as readonly JsonRecord[];
    expect(() =>
      expectEntriesCorrespond(entries, operations, "retained erasure projection"),
    ).not.toThrow();
    const corrupt = structuredClone(entries) as JsonRecord[];
    const erasedBead = corrupt.find((entry) => entry.outcome === "erased") as JsonRecord;
    erasedBead.source = `${SCOPE}beads/dec-9`;
    erasedBead.sourceRevision = "dec-9-r2";
    // The bare lineage shape deliberately has no Resource kind; the
    // contextual check supplies information unavailable to this schema.
    expectValid("#/$defs/receiptResult", erasedBead, "structurally valid, wrong context");
    expect(() => expectEntriesCorrespond(corrupt, operations, "erased Bead with source")).toThrow();
    const erasedOwned = structuredClone(entries) as JsonRecord[];
    const linkEntry = erasedOwned[1] as JsonRecord;
    const link = linkEntry.resource as JsonRecord;
    linkEntry.outcome = "erased";
    linkEntry.erased = { id: link.id, type: link.type, revision: link.revision };
    delete linkEntry.resource;
    expectValid("#/$defs/receiptResult", linkEntry, "erased owned Link");
    expect(() =>
      expectEntriesCorrespond(erasedOwned, operations, "erased owned Link"),
    ).not.toThrow();
    delete linkEntry.source;
    delete linkEntry.sourceRevision;
    expectValid("#/$defs/receiptResult", linkEntry, "missing contextual owned-source pair");
    expect(() =>
      expectEntriesCorrespond(erasedOwned, operations, "erased owned Link missing source"),
    ).toThrow();
  });

  it("records a forgotten-key execution's own current fence instead of the original failed receipt's", () => {
    const original = fixtures
      .find((fixture) => fixture.id === "transactional-batch")
      ?.exchanges.find(
        (exchange) => exchange.id === "batch-1-new-key-fails-whole",
      ) as FixtureExchange;
    const fresh = fixtures
      .find((fixture) => fixture.id === "transactional-receipts")
      ?.exchanges.find(
        (exchange) => exchange.id === "forgotten-key-executes-as-new",
      ) as FixtureExchange;
    // The condition names this fresh execution's observed head and states
    // no intervening commit before delivery. Tokens are opaque, not sortable.
    const check = (candidate: FixtureExchange): void => {
      expect(candidate.request, "same request after forgetting").toEqual(original.request);
      expect(candidate.response.body.status).toBe("failed");
      expect(candidate.response.body.id).not.toBe(original.response.body.id);
      expect(candidate.response.body.transaction).not.toBe(original.response.body.transaction);
      expect(candidate.response.body.effectPosition).toBeUndefined();
      expect(candidate.response.body.requiredPosition).toBe("pos-48");
      expect(candidate.response.headers["bdp-scope-position"]).toBe("pos-48");
    };
    expect(original.response.body.requiredPosition).toBe("pos-43");
    expect(() => check(fresh)).not.toThrow();
    const corrupt = structuredClone(fresh);
    corrupt.response.body.requiredPosition = original.response.body.requiredPosition;
    expectValid("#/$defs/mutationReceipt", corrupt.response.body, "old fence in new receipt");
    expect(() => check(corrupt)).toThrow();
  });

  it("rejects an incomplete or cyclic receipt page chain", () => {
    const fixture = fixtures.find(
      (candidate) => candidate.id === "transactional-receipt-pagination",
    ) as TransactionalFixture;
    for (const next of [
      `${fixture.scope}receipts/missing-page`,
      `${fixture.scope}receipts/rcpt-9?page=2`,
    ]) {
      const corrupt = structuredClone(fixture);
      const page = corrupt.exchanges.find(
        (exchange) => exchange.response.schema === "#/$defs/mutationReceiptPage",
      ) as FixtureExchange;
      page.response.body.next = next;
      expectValid("#/$defs/mutationReceiptPage", page.response.body, "shape-valid broken chain");
      const receipt = corrupt.exchanges.find(
        (exchange) => exchange.id === "pagination-batch-original",
      ) as FixtureExchange;
      expect(() => receiptEntries(corrupt, receipt)).toThrow();
    }
  });

  it("keeps the two raw I-JSON examples well-formed JSON with their intended string/object faults", () => {
    const raw = fixtures
      .flatMap((fixture) => fixture.exchanges)
      .filter((exchange) => exchange.request.bodyText !== undefined);
    expect(raw.map(({ id }) => id).sort()).toEqual([
      "batch-duplicate-decoded-member",
      "batch-unpaired-surrogate",
    ]);
    for (const exchange of raw) expectIJsonIllustration(exchange);
    const surrogate = structuredClone(
      raw.find((exchange) => exchange.id === "batch-unpaired-surrogate") as FixtureExchange,
    );
    const repaired = JSON.parse(surrogate.request.bodyText as string) as JsonRecord;
    (((repaired.operations as JsonRecord[])[0] as JsonRecord).properties as JsonRecord).title =
      "valid scalar string";
    expect(() =>
      expectIJsonIllustration({
        ...surrogate,
        request: { ...surrogate.request, bodyText: JSON.stringify(repaired) },
      }),
    ).toThrow();
    const duplicate = raw.find(
      (exchange) => exchange.id === "batch-duplicate-decoded-member",
    ) as FixtureExchange;
    expect(() =>
      expectIJsonIllustration({
        ...duplicate,
        request: {
          ...duplicate.request,
          bodyText: JSON.stringify(JSON.parse(duplicate.request.bodyText as string)),
        },
      }),
    ).toThrow();
  });

  it("rejects an empty terminal available receipt while preserving the unspecified continued-prefix length", () => {
    const fixture = fixtures.find(
      (candidate) => candidate.id === "transactional-receipt-pagination",
    ) as TransactionalFixture;
    const exchange = fixture.exchanges.find(
      (candidate) => candidate.id === "pagination-batch-original",
    ) as FixtureExchange;
    const receipt = { ...exchange.response.body, results: [] };
    // The wire text bounds a prefix without requiring it to be nonempty.
    expectValid("#/$defs/mutationReceipt", receipt, "empty continued prefix");
    expect(compiledDefinition("#/$defs/mutationReceipt")({ ...receipt, next: null })).toBe(false);
  });

  it("rejects an owned snapshot record absent from or unequal to its first-class Link", () => {
    const fixture = fixtures.find(
      (candidate) => candidate.id === "transactional-changefeed",
    ) as TransactionalFixture;
    const exchange = fixture.exchanges[0] as FixtureExchange;
    const changes = ((exchange.response.body.groups as JsonRecord[])[0] as JsonRecord)
      .changes as JsonRecord[];
    const source = changes.find(
      (change) => (change.resource as JsonRecord).id === `${SCOPE}beads/dec-9`,
    )?.resource as JsonRecord;
    const link = changes.find(
      (change) => (change.resource as JsonRecord).id === `${SCOPE}links/9c1e`,
    )?.resource as JsonRecord;
    const original = fixtures
      .find((fixture) => fixture.id === "transactional-batch")
      ?.exchanges.find((exchange) => exchange.id === "batch-1-original") as FixtureExchange;
    const target = (original.response.body.results as JsonRecord[]).find(
      (entry) => (entry.resource as JsonRecord).id === `${SCOPE}beads/task-42`,
    )?.resource as JsonRecord;
    // A closed graph projection assembled from the known pos-43 records;
    // this is an invariant probe, not a newly published snapshot manifest.
    const graph = { beads: { items: [source, target] }, links: { items: [link] }, erasures: [] };
    expect(() => expectClosedSnapshot(graph, "matching owned projection")).not.toThrow();
    const absent = structuredClone(graph);
    absent.links.items = [];
    expect(() => expectClosedSnapshot(absent, "missing first-class Link")).toThrow();
    const unequal = structuredClone(graph);
    (unequal.links.items[0] as JsonRecord).properties = { role: "inconsistent" };
    expect(() => expectClosedSnapshot(unequal, "unequal first-class Link")).toThrow();
  });

  it("isolates the owned-erasure group's identities and digest vectors from acme", () => {
    const fixture = fixtures.find(
      (candidate) => candidate.id === "transactional-changefeed",
    ) as TransactionalFixture;
    const example = fixture.groupExamples?.find(
      (candidate) => candidate.id === "isolated-live-owned-link-erasure",
    );
    expect(example?.scope).toBe("https://beads.example/owned-erasure/");
    expect(example?.scope).not.toBe(fixture.scope);
    const group = example?.body as JsonRecord;
    expect(() =>
      expectGroupScope(group, example?.scope as string, "independent Scope"),
    ).not.toThrow();
    expect(() => expectGroupScope(group, fixture.scope, "wrong Scope")).toThrow();
    for (const erasure of group.erasures as JsonRecord[]) {
      const vector = digestVectors?.vectors.find(
        ({ record }) => record.id === erasure.subject && record.revision === erasure.revision,
      );
      expect(vector).toBeDefined();
      expect((erasure.digest as JsonRecord).value).toBe(vector?.sha256);
    }
  });
});

/** These two authored examples are illustrations, not an I-JSON admission parser. */
function expectIJsonIllustration(exchange: FixtureExchange): void {
  const raw = exchange.request.bodyText as string;
  expect(typeof raw, exchange.id).toBe("string");
  expect(exchange.request.schema, exchange.id).toBeUndefined();
  expect(exchange.request.body, exchange.id).toBeUndefined();
  const parsed = JSON.parse(raw) as JsonRecord;
  const properties = ((parsed.operations as JsonRecord[])[0] as JsonRecord)
    .properties as JsonRecord;
  expect(exchange.response.body.code, exchange.id).toBe("malformed-request");
  expect(exchange.response.body.pointer, exchange.id).toBe("/operations/0/properties/title");
  if (exchange.id === "batch-unpaired-surrogate") {
    const title = properties.title as string;
    expect(title.length).toBe(1);
    expect(title.charCodeAt(0)).toBeGreaterThanOrEqual(0xd800);
    expect(title.charCodeAt(0)).toBeLessThanOrEqual(0xdfff);
  } else {
    expect(exchange.id).toBe("batch-duplicate-decoded-member");
    // This authored properties object contains only string-valued members;
    // count its raw name tokens before JSON.parse discards the duplicate.
    const objectText = raw.match(/"properties"\s*:\s*(\{[^{}]*\})/)?.[1] as string;
    expect(typeof objectText).toBe("string");
    const names = [...objectText.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map((match) =>
      JSON.parse(match[1] as string),
    );
    expect(names).toEqual(["title", "title"]);
    expect(names.length).toBeGreaterThan(Object.keys(properties).length);
    expect(Object.keys(properties)).toEqual(["title"]);
  }
}
