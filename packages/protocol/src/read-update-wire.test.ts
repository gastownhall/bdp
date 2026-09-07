import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { BDP_PROBLEM_FAMILY_PREFIX, BDP_V0_SCHEMA_ID, READ_PROBLEM_DEFINITIONS } from "./index.js";
import { isJsonSchemaUri } from "./schema-formats.js";

/**
 * The drafted Read+Update wire artifacts, held in lockstep from three sides:
 * the specification's Problem-details table, the bundle's definitions, and
 * the checked-in `fixtures/read-update` exchanges. This checks structural,
 * table, and example consistency — the rows mirror the bundle's branches,
 * the fixtures validate, results align with their members, retained
 * dispositions are byte-identical wherever they are replayed, and the
 * shapes the council found the schema admitting are now rejected. It
 * establishes none of the behavior the decisions describe: fixture
 * conditions are narrated assumptions, not observations, and none of this
 * is conformance evidence.
 */
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(
  readFileSync(path.join(workspaceRoot, "schemas", "bdp-v0.schema.json"), "utf8"),
) as SchemaRecord;
const specification = readFileSync(path.join(workspaceRoot, "docs", "specs", "bdp.md"), "utf8");
const fixturesDirectory = path.join(workspaceRoot, "fixtures", "read-update");

type SchemaRecord = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

/** The rows this draft adds; the specification table and the bundle must both agree. */
const READ_UPDATE_PROBLEM_ROWS: readonly (readonly [string, string, number, string])[] = [
  ["unsupported-media-type", "request", 415, "never"],
  ["binding-unavailable", "request", 400, "never"],
  ["validation-failed", "validation", 422, "never"],
  ["type-not-installed", "validation", 422, "after-state-change"],
  ["identity-taken", "conflict", 409, "never"],
  ["revision-mismatch", "conflict", 409, "after-state-change"],
  ["incident-links-exist", "conflict", 409, "after-state-change"],
  ["aggregate-constraint-violation", "conflict", 409, "after-state-change"],
  ["idempotency-conflict", "conflict", 409, "never"],
  ["idempotency-in-progress", "conflict", 409, "after-delay"],
  ["idempotency-expired", "gone", 410, "never"],
];

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,256}$/;
const LINK_OPERATIONS = new Set(["createLink", "updateLinkProperties", "deleteLink"]);
/** The reference domain's only owned Link Type: `decision` owns `cites`. */
const OWNED_LINK_TYPE = "https://work.example/types/cites";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addSchema(schema);

/** One retained disposition: entry `index` of exchange `from`, expected at `at` (or as the whole body). */
interface RetainedEntry {
  /** An exchange id in this fixture, or `<fixture id>/<exchange id>` in another. */
  readonly from: string;
  readonly index: number;
  readonly at?: number;
}

interface FixtureExchange {
  readonly id: string;
  /** A narrated precondition — an assumption the example rests on, never an observation. */
  readonly condition?: string;
  /** A canonical Scope URL other than the fixture's, for a restored-Scope example. */
  readonly scope?: string;
  readonly retained?: readonly RetainedEntry[];
  readonly request: {
    readonly method: string;
    readonly target: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly schema?: string;
    readonly body?: JsonRecord;
    readonly rawBody?: string;
  };
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly schema: string;
    readonly body: JsonRecord;
  };
}

interface ReadUpdateFixture {
  readonly fixtureVersion: number;
  readonly id: string;
  readonly description: string;
  readonly scope: string;
  readonly exchanges: readonly FixtureExchange[];
}

const fixtures: readonly ReadUpdateFixture[] = readdirSync(fixturesDirectory)
  .filter((entry) => entry.endsWith(".json"))
  .sort()
  .map(
    (entry) =>
      JSON.parse(readFileSync(path.join(fixturesDirectory, entry), "utf8")) as ReadUpdateFixture,
  );

describe("Read+Update problem rows", () => {
  const tableRows = problemTableRows(markdownSection(specification, "Problem details"));

  it("keeps the Read table closed and unchanged ahead of the Read+Update rows", () => {
    expect(tableRows.slice(0, READ_PROBLEM_DEFINITIONS.length)).toEqual(
      READ_PROBLEM_DEFINITIONS.map(({ code, family, status, retry }) => [
        code,
        family,
        status,
        retry,
      ]),
    );
  });

  it("adds exactly the drafted rows to the specification table", () => {
    expect(tableRows.slice(READ_PROBLEM_DEFINITIONS.length)).toEqual(READ_UPDATE_PROBLEM_ROWS);
  });

  it("mirrors the table in the bundle's readUpdateProblem branches", () => {
    expect(def("readUpdateProblemCode")).toEqual({
      enum: [
        ...READ_PROBLEM_DEFINITIONS.map(({ code }) => code),
        ...READ_UPDATE_PROBLEM_ROWS.map(([code]) => code),
      ],
    });
    const branches = def("readUpdateProblem").allOf as SchemaRecord[];
    expect(branches[0]).toEqual({
      if: { properties: { code: { $ref: "#/$defs/readProblemCode" } }, required: ["code"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then vocabulary
      then: { $ref: "#/$defs/readProblem" },
    });
    for (const [index, [code, family, status, retry]] of READ_UPDATE_PROBLEM_ROWS.entries()) {
      expect(branches[index + 1]).toEqual({
        if: { properties: { code: { const: code } }, required: ["code"] },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then vocabulary
        then: {
          properties: {
            type: { const: `${BDP_PROBLEM_FAMILY_PREFIX}${family}` },
            status: { const: status },
            retry: { const: retry },
          },
        },
      });
    }
    expect((propertiesOf("readUpdateProblem").status as SchemaRecord).enum).toEqual([
      400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 503,
    ]);
  });

  it("keeps the Read Problem definition byte-for-byte the closed Read table", () => {
    expect(propertiesOf("readProblem").code).toEqual({ $ref: "#/$defs/readProblemCode" });
    expect((def("readProblem").allOf as SchemaRecord[]).length).toBe(
      READ_PROBLEM_DEFINITIONS.length + 2,
    );
  });
});

describe("Read+Update wire fixtures", () => {
  it("cover discovery, every singleton target, the sequence cases, and the recovery cases", () => {
    expect(fixtures.map(({ id }) => id)).toEqual([
      "read-update-carrier-rejections",
      "read-update-discovery",
      "read-update-idempotency-recovery",
      "read-update-semantic-identity",
      "read-update-sequence-dependent-bindings",
      "read-update-sequence-idempotency-dispositions",
      "read-update-sequence-idempotent-retry",
      "read-update-sequence-partial-failure",
      "read-update-sequence-positive",
      "read-update-singletons",
    ]);
    const targets = new Set(
      fixtures.flatMap(({ exchanges }) => exchanges.map(({ request }) => request.target)),
    );
    expect([...targets].sort()).toEqual([
      "bdp.json",
      "operations/",
      "operations/create-bead",
      "operations/create-link",
      "operations/delete-bead",
      "operations/delete-link",
      "operations/sequence",
      "operations/update-bead-properties",
      "operations/update-link-properties",
    ]);
  });

  for (const fixture of fixtures) {
    describe(fixture.id, () => {
      it("is a version-1 fixture whose exchanges validate against the bundle", () => {
        expect(fixture.fixtureVersion).toBe(1);
        expect(fixture.scope).toBe("https://beads.example/acme/");
        expect(fixture.description).toContain("not evidence");
        expect(new Set(fixture.exchanges.map(({ id }) => id)).size).toBe(fixture.exchanges.length);
        for (const exchange of fixture.exchanges) {
          if (exchange.request.schema !== undefined)
            expectValid(exchange.request.schema, exchange.request.body, exchange.id);
          expectValid(exchange.response.schema, exchange.response.body, exchange.id);
        }
      });

      it("pairs every mutation response with its HTTP status, media type, and cache policy", () => {
        for (const exchange of fixture.exchanges) {
          const { request, response } = exchange;
          if (request.method !== "POST") continue;
          expect(response.headers["cache-control"], exchange.id).toBe("private, no-store");
          if (isDirectProblem(exchange)) {
            expect(response.headers["content-type"], exchange.id).toBe("application/problem+json");
            expect(response.body.status, exchange.id).toBe(response.status);
            expectProblemRow(response.body, exchange.id);
          } else {
            expect(response.status, exchange.id).toBe(200);
            expect(response.headers["content-type"], exchange.id).toBe("application/json");
          }
          const key = request.headers["idempotency-key"];
          if (request.target === "operations/sequence") {
            // A stray field is itself a carrier rejection; an admitted sequence never carries one.
            if (response.body.code !== "malformed-request")
              expect(key, exchange.id).toBeUndefined();
          } else if (response.body.code !== "malformed-request") {
            expect(key, exchange.id).toMatch(IDEMPOTENCY_KEY);
          }
        }
      });

      it("branches direct carrier rejections from admitted sequences", () => {
        for (const exchange of fixture.exchanges) {
          if (exchange.request.target !== "operations/sequence") continue;
          if (isDirectProblem(exchange)) {
            // Rejected before execution: a direct problem, no results, nothing claimed.
            expect(exchange.response.status, exchange.id).not.toBe(200);
            expect(exchange.response.body.results, exchange.id).toBeUndefined();
            expect(["malformed-request", "limit-exceeded"], exchange.id).toContain(
              exchange.response.body.code,
            );
          } else {
            expect(exchange.response.schema, exchange.id).toBe("#/$defs/sequenceResponse");
          }
        }
      });

      it("keeps sequence members and results aligned member by member", () => {
        for (const exchange of fixture.exchanges) {
          if (exchange.request.target !== "operations/sequence" || isDirectProblem(exchange))
            continue;
          const operations = exchange.request.body?.operations as readonly JsonRecord[];
          const results = exchange.response.body.results as readonly JsonRecord[];
          expect(results.length, exchange.id).toBe(operations.length);
          const keys = operations.map((member) => member.idempotencyKey as string);
          expect(new Set(keys).size, exchange.id).toBe(keys.length);
          for (const key of keys) expect(key, exchange.id).toMatch(IDEMPOTENCY_KEY);
          const scope = exchange.scope ?? fixture.scope;
          for (const [index, entry] of results.entries()) {
            const member = operations[index] as JsonRecord;
            const label = `${exchange.id}[${index}]`;
            expect(entry.operationIndex, label).toBe(index);
            expect(entry.operationName, label).toEqual(member.name);
            if ("outcome" in entry) {
              expectResultShape(entry, member, label);
              expectResultCorrespondence(entry, member, results.slice(0, index), scope, label);
            } else {
              expect(entry.outcome, label).toBeUndefined();
              expectProblemRow(entry, label);
            }
          }
        }
      });

      it("shapes every singleton result like the corresponding sequence member's", () => {
        for (const exchange of fixture.exchanges) {
          const operation = SINGLETON_OPERATIONS.get(exchange.request.target);
          if (operation === undefined || isDirectProblem(exchange)) continue;
          const member = { ...exchange.request.body, operation } as JsonRecord;
          expectResultShape(exchange.response.body, member, exchange.id);
          expectResultCorrespondence(
            exchange.response.body,
            member,
            [],
            fixture.scope,
            exchange.id,
          );
        }
      });

      it("returns retained dispositions unchanged, repositioned by the present member", () => {
        for (const exchange of fixture.exchanges) {
          for (const retained of exchange.retained ?? []) {
            const label = `${exchange.id} <- ${retained.from}[${retained.index}]`;
            const original = resolveExchange(fixture, retained.from);
            const originalEntry = retainedEntry(original, retained.index);
            if (originalEntry === undefined) throw new Error(`${label}: no such entry`);
            if (retained.at === undefined) {
              expect(exchange.response.body, label).toEqual(disposition(originalEntry));
            } else {
              const retried = (exchange.response.body.results as readonly JsonRecord[])[
                retained.at
              ];
              expect(disposition(retried), label).toEqual(disposition(originalEntry));
              expect(retried?.operationIndex, label).toBe(retained.at);
            }
          }
        }
      });
    });
  }
});

describe("shapes the bundle now rejects", () => {
  const scope = "https://beads.example/acme/";
  const bead = {
    id: `${scope}beads/1`,
    type: "https://t.example/t",
    revision: "r1",
    properties: {},
  };
  const discovery = {
    bdpVersion: "0",
    profile: "read-update",
    scope,
    beads: `${scope}beads/`,
    links: `${scope}links/`,
    types: `${scope}types/`,
    operations: `${scope}operations/`,
  };
  const validationFailed = {
    type: `${BDP_PROBLEM_FAMILY_PREFIX}validation`,
    code: "validation-failed",
    status: 422,
    retry: "never",
  };
  const rejected: readonly (readonly [string, string, unknown])[] = [
    ["deleteBeadRequest", "a singleton @name binding", { bead: "@x" }],
    [
      "createLinkRequest",
      "a singleton pinned @name endpoint",
      { type: "https://t.example/t", source: { uri: "@x", revision: "r" }, target: "beads/2" },
    ],
    ["createBeadRequest", "a supplied @name id", { id: "@x", type: "https://t.example/t" }],
    [
      "updateBeadPropertiesRequest",
      "a patch path that is not a JSON Pointer",
      { bead: "beads/1", change: [{ op: "remove", path: "not-a-pointer" }] },
    ],
    [
      "updateBeadPropertiesRequest",
      "a patch path with an invalid escape",
      { bead: "beads/1", change: [{ op: "remove", path: "/~2" }] },
    ],
    [
      "mutationResult",
      "a Bead postimage carrying sourceRevision",
      { outcome: "created", resource: bead, source: `${scope}beads/1`, sourceRevision: "r9" },
    ],
    [
      "mutationResult",
      "sourceRevision without source",
      { outcome: "deleted", deleted: `${scope}links/1`, sourceRevision: "r9" },
    ],
    [
      "readUpdateDiscovery",
      "a transaction limits group",
      { ...discovery, limits: { transaction: { operations: 1 } } },
    ],
    [
      "readUpdateDiscovery",
      "a receipt retention limit",
      { ...discovery, limits: { retention: { receipt: "P1D" } } },
    ],
    [
      "readUpdateDiscovery",
      "a replay retention limit",
      { ...discovery, limits: { retention: { replay: "P1D" } } },
    ],
    ["readUpdateProblem", "validation-failed without diagnostics", validationFailed],
    [
      "readUpdateProblem",
      "validation-failed with empty diagnostics",
      { ...validationFailed, diagnostics: [] },
    ],
    [
      "validationDiagnostic",
      "a Type without its schema location",
      { message: "m", type: "https://t.example/t" },
    ],
    [
      "readUpdateProblem",
      "retryAfter on a problem that is not after-delay",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "revision-mismatch",
        status: 409,
        retry: "after-state-change",
        retryAfter: 1,
      },
    ],
  ];
  for (const [definition, label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(compiledDefinition(`#/$defs/${definition}`)(value)).toBe(false);
    });
  }
  it("still admits sequence-member bindings, escaped pointers, and owned-Link results", () => {
    expectValid(
      "#/$defs/sequenceRequest",
      {
        operations: [
          {
            operation: "createLink",
            idempotencyKey: "k",
            type: "https://t.example/t",
            source: { uri: "@x", revision: "r" },
            target: "beads/2",
          },
        ],
      },
      "sequence pinned @name",
    );
    expectValid(
      "#/$defs/updateBeadPropertiesRequest",
      { bead: "beads/1", change: [{ op: "remove", path: "/a~1b/~0c" }] },
      "escaped pointer",
    );
    expectValid(
      "#/$defs/readUpdateDiscovery",
      {
        ...discovery,
        limits: { retention: { idempotency: "P7D", maximumSnapshotLifetime: "PT300S" } },
      },
      "Read+Update retention limits",
    );
    expectValid(
      "#/$defs/sequenceMemberProblem",
      {
        type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
        code: "idempotency-in-progress",
        status: 409,
        retry: "after-delay",
        retryAfter: 2,
        operationIndex: 0,
      },
      "member-level retryAfter",
    );
  });
});

const SINGLETON_OPERATIONS: ReadonlyMap<string, string> = new Map([
  ["operations/create-bead", "createBead"],
  ["operations/update-bead-properties", "updateBeadProperties"],
  ["operations/delete-bead", "deleteBead"],
  ["operations/create-link", "createLink"],
  ["operations/update-link-properties", "updateLinkProperties"],
  ["operations/delete-link", "deleteLink"],
]);

function isDirectProblem(exchange: FixtureExchange): boolean {
  return exchange.response.schema === "#/$defs/readUpdateProblem";
}

/** `from` names an exchange in this fixture or `<fixture id>/<exchange id>` in another. */
function resolveExchange(fixture: ReadUpdateFixture, from: string): FixtureExchange {
  const slash = from.indexOf("/");
  const source = slash < 0 ? fixture : fixtures.find(({ id }) => id === from.slice(0, slash));
  const exchangeId = slash < 0 ? from : from.slice(slash + 1);
  const exchange = source?.exchanges.find(({ id }) => id === exchangeId);
  if (exchange === undefined) throw new Error(`unknown exchange ${from}`);
  return exchange;
}

/** Entry `index` of a sequence response, or a singleton body itself as entry 0. */
function retainedEntry(exchange: FixtureExchange, index: number): JsonRecord | undefined {
  const results = exchange.response.body.results as readonly JsonRecord[] | undefined;
  if (results !== undefined) return results[index];
  return index === 0 ? exchange.response.body : undefined;
}

/** A semantic no-op: the update's result keeps the revision its guard named. */
function isSemanticNoOp(entry: JsonRecord, member: JsonRecord): boolean {
  const resource = entry.resource as JsonRecord | undefined;
  return (
    entry.outcome === "updated" &&
    member.expectedRevision !== undefined &&
    resource?.revision === member.expectedRevision
  );
}

function expectResultShape(entry: JsonRecord, member: JsonRecord, label: string): void {
  const operation = member.operation as string;
  const outcome = entry.outcome as string;
  if (operation.startsWith("delete")) {
    expect(outcome, label).toBe("deleted");
    expect(typeof entry.deleted, label).toBe("string");
    expect(entry.resource, label).toBeUndefined();
  } else {
    expect(outcome, label).toBe(operation.startsWith("create") ? "created" : "updated");
    const resource = entry.resource as JsonRecord;
    expect(entry.deleted, label).toBeUndefined();
    if (member.type !== undefined) expect(resource.type, label).toBe(member.type);
    if (isSemanticNoOp(entry, member)) {
      // A no-op mints no version and records no attribution: the retained
      // version keeps whatever attribution it already carried, so the input
      // attribution is not expected on the postimage.
      expect(resource.revision, label).toBe(member.expectedRevision);
    } else if (member.attribution !== undefined) {
      expect(resource.attribution, label).toEqual(member.attribution);
    }
  }
  if (!LINK_OPERATIONS.has(operation)) {
    expect(entry.source, label).toBeUndefined();
    expect(entry.sourceRevision, label).toBeUndefined();
  } else if (member.type === OWNED_LINK_TYPE) {
    expect(typeof entry.source, label).toBe("string");
    expect(typeof entry.sourceRevision, label).toBe("string");
    const resource = entry.resource as JsonRecord | undefined;
    if (resource !== undefined) expect(entry.source, label).toBe(resource.source);
  } else if (member.type !== undefined) {
    expect(entry.source, label).toBeUndefined();
    expect(entry.sourceRevision, label).toBeUndefined();
  }
}

/**
 * Result/request correspondence the schema cannot express: a durable in-Scope
 * endpoint spelling resolves against the Scope, and a `@name` endpoint resolves
 * to the identity the named earlier member created.
 */
function expectResultCorrespondence(
  entry: JsonRecord,
  member: JsonRecord,
  earlier: readonly JsonRecord[],
  scope: string,
  label: string,
): void {
  const resource = entry.resource as JsonRecord | undefined;
  if (resource === undefined || member.operation !== "createLink") return;
  for (const endpoint of ["source", "target"] as const) {
    const spelled = member[endpoint];
    const written = typeof spelled === "string" ? spelled : (spelled as JsonRecord).uri;
    if (typeof written !== "string") throw new Error(`${label}: unreadable ${endpoint}`);
    const resolved = resource[endpoint];
    const resolvedUri = typeof resolved === "string" ? resolved : (resolved as JsonRecord).uri;
    if (written.startsWith("@")) {
      const creator = earlier.find((candidate) => candidate.operationName === written.slice(1));
      const created = creator?.resource as JsonRecord | undefined;
      if (created !== undefined) {
        expect(created.id, `${label}: ${written}`).toBe(resolvedUri);
      } else {
        // The only creator without a result that still binds: an expired
        // creation, whose tombstone keeps the identity it allocated (D24).
        expect(creator?.code, `${label}: ${written} has no binding`).toBe("idempotency-expired");
      }
    } else if (written.startsWith("beads/") || written.startsWith("links/")) {
      expect(resolvedUri, `${label}: ${endpoint}`).toBe(`${scope}${written}`);
    } else {
      expect(resolvedUri, `${label}: ${endpoint}`).toBe(written);
    }
  }
}

function expectProblemRow(problem: JsonRecord, label: string): void {
  const code = problem.code as string;
  const readRow = READ_PROBLEM_DEFINITIONS.find((definition) => definition.code === code);
  const row =
    readRow === undefined
      ? READ_UPDATE_PROBLEM_ROWS.find(([candidate]) => candidate === code)
      : ([readRow.code, readRow.family, readRow.status, readRow.retry] as const);
  if (row === undefined) throw new Error(`${label}: unknown problem code ${code}`);
  expect(problem.type, label).toBe(`${BDP_PROBLEM_FAMILY_PREFIX}${row[1]}`);
  expect(problem.status, label).toBe(row[2]);
  expect(problem.retry, label).toBe(row[3]);
}

/** A member's disposition: its result or problem without the positional members. */
function disposition(entry: JsonRecord | undefined): JsonRecord {
  if (entry === undefined) throw new Error("missing retried entry");
  const { operationIndex: _index, operationName: _name, ...rest } = entry;
  return rest;
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
