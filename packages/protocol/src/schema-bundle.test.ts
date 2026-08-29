import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  BDP_PROBLEM_FAMILY_PREFIX,
  BDP_V0_SCHEMA_ID,
  PROTOCOL_PROFILES,
  READ_PROBLEM_DEFINITIONS,
} from "./index.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = path.join(workspaceRoot, "schemas", "bdp-v0.schema.json");
const schemaText = readFileSync(schemaPath, "utf8");
const packagedSchemaPath = path.join(
  workspaceRoot,
  "packages",
  "protocol",
  "schemas",
  "bdp-v0.schema.json",
);
const packagedSchemaText = readFileSync(packagedSchemaPath, "utf8");
const schema = JSON.parse(schemaText) as SchemaRecord;

type SchemaRecord = Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
ajv.addSchema(schema);

describe("BDP v0 schema bundle", () => {
  it("is the canonical JSON Schema 2020-12 bundle at the protocol id", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(BDP_V0_SCHEMA_ID);
  });

  it("ships the package schema copy without drifting from the canonical artifact", () => {
    expect(packagedSchemaText).toBe(schemaText);
  });

  it("contains the initial discovery and Read definitions", () => {
    expect(Object.keys(defs()).sort()).toEqual([
      "absoluteHttpUrl",
      "absoluteUri",
      "advertisedLimits",
      "bdpVersion",
      "beadCollection",
      "beadRecord",
      "endpoint",
      "endpointConstraint",
      "iso8601Duration",
      "linkCollection",
      "linkRecord",
      "maximumEndpointMultiplicityPolicy",
      "positiveInteger",
      "properties",
      "protocolProfile",
      "readDiscovery",
      "readProblem",
      "readProblemCode",
      "retryDisposition",
      "typeDescriptor",
      "typeIdArray",
      "typeSummary",
      "typesInventory",
    ]);
  });

  it("requires HTTP(S) URLs for discovery, Resource, Type, schema, and next links", () => {
    expect(def("absoluteHttpUrl")).toMatchObject({
      type: "string",
      format: "uri",
      pattern: "^https?://.+",
    });

    const readDiscoveryProperties = propertiesOf("readDiscovery");
    for (const member of ["scope", "beads", "links", "types"]) {
      expect(readDiscoveryProperties[member]).toEqual({ $ref: "#/$defs/absoluteHttpUrl" });
    }

    const beadProperties = propertiesOf("beadRecord");
    expect(beadProperties.id).toEqual({ $ref: "#/$defs/absoluteHttpUrl" });
    expect(beadProperties.type).toEqual({ $ref: "#/$defs/absoluteHttpUrl" });

    const descriptorProperties = propertiesOf("typeDescriptor");
    expect(descriptorProperties.id).toEqual({ $ref: "#/$defs/absoluteHttpUrl" });
    expect(descriptorProperties.propertiesSchema).toEqual({
      $ref: "#/$defs/absoluteHttpUrl",
    });

    expect(nullableOneOfRefs("typesInventory", "next")).toContain("#/$defs/absoluteHttpUrl");
    expect(nullableOneOfRefs("beadCollection", "next")).toContain("#/$defs/absoluteHttpUrl");
    expect(nullableOneOfRefs("linkCollection", "next")).toContain("#/$defs/absoluteHttpUrl");
  });

  it("defines the current discovery schema as Read-only until later profiles land", () => {
    expect(propertiesOf("readDiscovery").profile).toEqual({ const: "read" });
    expect(def("protocolProfile")).toEqual({ enum: PROTOCOL_PROFILES });
  });

  it("defines paginated types inventory summaries as exactly id, name, and describes", () => {
    expect(def("typesInventory")).toMatchObject({
      type: "object",
      required: ["items", "next"],
      additionalProperties: false,
    });
    expect(def("typeSummary")).toMatchObject({
      type: "object",
      required: ["id", "name", "describes"],
      additionalProperties: false,
    });
    expect(Object.keys(propertiesOf("typeSummary")).sort()).toEqual(["describes", "id", "name"]);
  });

  it("closes Type Descriptor and endpoint objects without inventing extra name bounds", () => {
    expect(def("typeDescriptor")).toMatchObject({
      type: "object",
      required: ["id", "name", "describes", "conformsTo"],
      additionalProperties: false,
    });
    expect(def("endpointConstraint")).toMatchObject({
      type: "object",
      required: ["conformsTo"],
      additionalProperties: false,
    });
    expect(propertiesOf("typeDescriptor").name).toEqual({ type: "string", minLength: 1 });
    expect(def("typeIdArray")).toMatchObject({
      type: "array",
      uniqueItems: true,
    });
    expect(def("typeIdArray")).not.toHaveProperty("minItems");
  });

  it("keeps direct RFC 9457 Read Problem status optional and extension members allowed", () => {
    const readProblem = def("readProblem");
    expect(readProblem).toMatchObject({
      type: "object",
      required: ["type", "code", "retry"],
    });
    expect(readProblem).not.toHaveProperty("additionalProperties");
    expect((readProblem.required as readonly string[]).includes("status")).toBe(false);
  });

  it("keeps the schema Read problem rows in lockstep with protocol exports", () => {
    expect(def("readProblemCode")).toEqual({
      enum: READ_PROBLEM_DEFINITIONS.map((definition) => definition.code),
    });

    for (const definition of READ_PROBLEM_DEFINITIONS) {
      expect(definition.type).toBe(`${BDP_PROBLEM_FAMILY_PREFIX}${definition.family}`);
      const branch = readProblemBranchFor(definition.code);
      expect(branch.if).toEqual({
        properties: { code: { const: definition.code } },
        required: ["code"],
      });
      expect(branch.then).toEqual({
        properties: {
          type: { const: definition.type },
          status: { const: definition.status },
          retry: { const: definition.retry },
        },
      });
      expect(Object.keys(branch).sort()).toEqual(["if", "then"]);
    }
  });

  it("validates representative Read documents through Ajv 2020", () => {
    expectValid("readDiscovery", readDiscovery());
    expectValid("beadRecord", beadRecord());
    expectValid("beadRecord", { ...beadRecord(), links: linkCollection([]) });
    expectValid("linkRecord", linkRecord());
    expectValid("beadCollection", { items: [], next: null });
    expectValid("linkCollection", linkCollection([]));
    expectValid("typesInventory", { items: [], next: null });
    expectValid("typeDescriptor", beadTypeDescriptor());
    expectValid("typeDescriptor", linkTypeDescriptor());
    expectValid("readProblem", {
      type: `${BDP_PROBLEM_FAMILY_PREFIX}gone`,
      code: "cursor-expired",
      retry: "after-state-change",
      traceId: "extension-members-are-allowed",
    });
  });

  it("rejects Read documents that would reopen accepted decisions", () => {
    expectInvalid("readDiscovery", {
      ...readDiscovery(),
      beads: "https://",
    });
    expectInvalid("readDiscovery", {
      ...readDiscovery(),
      limits: { page: { defaultItems: "banana" } },
    });
    expectInvalid("readDiscovery", {
      ...readDiscovery(),
      maximumEndpointMultiplicity: [{}],
    });
    expectInvalid("typesInventory", {
      items: [
        { id: "https://work.example/types/task", name: "Task", describes: "bead", extra: true },
      ],
      next: null,
    });
    expectInvalid("typeDescriptor", {
      ...beadTypeDescriptor(),
      conformsTo: ["https://work.example/types/work-item", "https://work.example/types/work-item"],
    });
    // A reference is a URI string, or exactly { uri, revision } for an
    // external citation: the old object-with-type spelling, a citation
    // missing its revision, and an empty citation must all fail.
    // Endpoint-constraint external policy: the three tokens are accepted,
    // omission is accepted (meaning opaque), and unknown tokens fail.
    for (const external of ["none", "opaque", "bead"] as const)
      expectValid("endpointConstraint", { conformsTo: [], external });
    expectValid("endpointConstraint", { conformsTo: [] });
    expectInvalid("endpointConstraint", { conformsTo: [], external: "always" });
    expectInvalid("endpointConstraint", { conformsTo: [], external: true });
    expectValid("endpoint", "https://beads.example/acme/beads/demo-a");
    expectValid("endpoint", "urn:external:123");
    expectValid("endpoint", { uri: "urn:external:123", revision: "cited-9f2c" });
    expectInvalid("endpoint", {
      id: "urn:external:123",
      type: "https://work.example/types/task",
    });
    expectInvalid("endpoint", { uri: "urn:external:123" });
    expectInvalid("endpoint", { uri: "urn:external:123", revision: "" });
    expectInvalid("endpoint", {
      uri: "urn:external:123",
      revision: "cited-9f2c",
      type: "https://work.example/types/task",
    });
    expectInvalid("readProblem", {
      type: `${BDP_PROBLEM_FAMILY_PREFIX}gone`,
      status: 400,
      code: "cursor-expired",
      retry: "after-state-change",
    });
  });
});

function readDiscovery(): SchemaRecord {
  return {
    bdpVersion: "0",
    profile: "read",
    scope: "https://beads.example/acme/",
    beads: "https://beads.example/acme/beads/",
    links: "https://beads.example/acme/links/",
    types: "https://beads.example/acme/types/",
    limits: {
      page: { defaultItems: 50, maximumItems: 200 },
    },
    maximumEndpointMultiplicity: [
      {
        linkConformsTo: "https://work.example/types/parent-child",
        endpoint: "source",
        max: 1,
      },
    ],
  };
}

function beadRecord(): SchemaRecord {
  return {
    id: "https://beads.example/acme/beads/task-42",
    type: "https://work.example/types/task",
    revision: "opaque-task-revision",
    properties: { title: "Specify BDP mutation", status: "open" },
  };
}

function linkRecord(): SchemaRecord {
  return {
    id: "https://beads.example/acme/links/assigned-to-81",
    type: "https://work.example/types/assigned-to",
    revision: "opaque-link-revision",
    source: "https://beads.example/acme/beads/task-42",
    target: { uri: "urn:person:7", revision: "cited-9f2c" },
    properties: { since: "2026-08-04" },
  };
}

function linkCollection(items: readonly SchemaRecord[]): SchemaRecord {
  return { items, next: null };
}

function beadTypeDescriptor(): SchemaRecord {
  return {
    id: "https://work.example/types/task",
    name: "Task",
    describes: "bead",
    conformsTo: ["https://work.example/types/work-item"],
    propertiesSchema: "https://work.example/schemas/task-properties-v1",
  };
}

function linkTypeDescriptor(): SchemaRecord {
  return {
    id: "https://work.example/types/assigned-to",
    name: "Assigned To",
    describes: "link",
    conformsTo: [],
    propertiesSchema: "https://work.example/schemas/assigned-to-properties-v1",
    source: { conformsTo: ["https://work.example/types/work-item"] },
    target: { conformsTo: [] },
  };
}

function expectValid(definitionName: string, value: unknown): void {
  const validate = compiledDefinition(definitionName);
  expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true);
}

function expectInvalid(definitionName: string, value: unknown): void {
  const validate = compiledDefinition(definitionName);
  expect(validate(value)).toBe(false);
}

function compiledDefinition(definitionName: string): ValidateFunction {
  const validate = ajv.getSchema(`${BDP_V0_SCHEMA_ID}#/$defs/${definitionName}`);
  if (validate === undefined) throw new Error(`schema definition not found: ${definitionName}`);
  return validate;
}

function defs(): SchemaRecord {
  return requiredRecord(schema.$defs, "$defs");
}

function def(name: string): SchemaRecord {
  return requiredRecord(defs()[name], `$defs.${name}`);
}

function propertiesOf(definitionName: string): SchemaRecord {
  return requiredRecord(def(definitionName).properties, `$defs.${definitionName}.properties`);
}

function nullableOneOfRefs(definitionName: string, propertyName: string): readonly string[] {
  const property = requiredRecord(
    propertiesOf(definitionName)[propertyName],
    `$defs.${definitionName}.properties.${propertyName}`,
  );
  const oneOf = property.oneOf;
  if (!Array.isArray(oneOf)) throw new Error(`${definitionName}.${propertyName}.oneOf missing`);
  return oneOf
    .map((candidate) => requiredRecord(candidate, `${definitionName}.${propertyName}.oneOf[]`).$ref)
    .filter((value): value is string => typeof value === "string");
}

function readProblemBranchFor(code: string): SchemaRecord {
  const allOf = def("readProblem").allOf;
  if (!Array.isArray(allOf)) throw new Error("readProblem.allOf missing");
  const branch = allOf.find((candidate) => {
    const record = requiredRecord(candidate, "readProblem.allOf[]");
    return (
      (
        requiredRecord(requiredRecord(record.if, "if").properties, "if.properties").code as
          | SchemaRecord
          | undefined
      )?.const === code
    );
  });
  if (branch === undefined) throw new Error(`missing readProblem branch for ${code}`);
  return requiredRecord(branch, `readProblem.allOf.${code}`);
}

function requiredRecord(value: unknown, pathLabel: string): SchemaRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be a record`);
  }
  return value as SchemaRecord;
}
