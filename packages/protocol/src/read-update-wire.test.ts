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
 * the checked-in `fixtures/read-update` exchanges. None of this is
 * conformance evidence — the fixtures are illustrative wire examples — but
 * a drift between prose, schema, and example fails here rather than in an
 * implementation wave.
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

interface FixtureExchange {
  readonly id: string;
  readonly retainedFrom?: string;
  readonly retainedOffset?: number;
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
  it("cover discovery, every singleton target, and the four sequence cases", () => {
    expect(fixtures.map(({ id }) => id)).toEqual([
      "read-update-discovery",
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
          if (response.schema === "#/$defs/readUpdateProblem") {
            expect(response.headers["content-type"], exchange.id).toBe("application/problem+json");
            expect(response.body.status, exchange.id).toBe(response.status);
            expectProblemRow(response.body, exchange.id);
          } else {
            expect(response.status, exchange.id).toBe(200);
            expect(response.headers["content-type"], exchange.id).toBe("application/json");
          }
          if (request.target === "operations/sequence") {
            expect(request.headers["idempotency-key"], exchange.id).toBeUndefined();
          } else if (response.body.code !== "malformed-request") {
            expect(request.headers["idempotency-key"], exchange.id).toMatch(IDEMPOTENCY_KEY);
          }
        }
      });

      it("keeps sequence members and results aligned member by member", () => {
        for (const exchange of fixture.exchanges) {
          if (exchange.request.target !== "operations/sequence") continue;
          const operations = exchange.request.body?.operations as readonly JsonRecord[];
          const results = exchange.response.body.results as readonly JsonRecord[];
          expect(results.length, exchange.id).toBe(operations.length);
          const keys = operations.map((member) => member.idempotencyKey as string);
          expect(new Set(keys).size, exchange.id).toBe(keys.length);
          for (const key of keys) expect(key, exchange.id).toMatch(IDEMPOTENCY_KEY);
          for (const [index, entry] of results.entries()) {
            const member = operations[index] as JsonRecord;
            const label = `${exchange.id}[${index}]`;
            expect(entry.operationIndex, label).toBe(index);
            expect(entry.operationName, label).toEqual(member.name);
            if ("outcome" in entry) expectResultShape(entry, member, label);
            else {
              expect(entry.outcome, label).toBeUndefined();
              expectProblemRow(entry, label);
            }
          }
        }
      });

      it("returns retained dispositions unchanged, repositioned by the present member", () => {
        for (const exchange of fixture.exchanges) {
          if (exchange.retainedFrom === undefined) continue;
          const original = fixture.exchanges.find(({ id }) => id === exchange.retainedFrom);
          if (original === undefined) throw new Error(`unknown exchange ${exchange.retainedFrom}`);
          const offset = exchange.retainedOffset ?? 0;
          const originalResults = original.response.body.results as readonly JsonRecord[];
          const retriedResults = exchange.response.body.results as readonly JsonRecord[];
          for (const [index, originalEntry] of originalResults.entries()) {
            const retried = retriedResults[index + offset];
            expect(disposition(retried), `${exchange.id}[${index + offset}]`).toEqual(
              disposition(originalEntry),
            );
            expect(retried?.operationIndex).toBe(index + offset);
          }
        }
      });
    });
  }
});

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
    if (member.attribution !== undefined)
      expect(resource.attribution, label).toEqual(member.attribution);
  }
  if (!LINK_OPERATIONS.has(operation)) {
    expect(entry.sourceRevision, label).toBeUndefined();
  } else if (member.type === OWNED_LINK_TYPE) {
    expect(typeof entry.sourceRevision, label).toBe("string");
  } else if (member.type !== undefined) {
    expect(entry.sourceRevision, label).toBeUndefined();
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
