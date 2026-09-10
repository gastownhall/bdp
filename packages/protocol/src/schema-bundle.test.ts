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

  it("contains the discovery, Read, drafted Read+Update, and drafted Transactional definitions", () => {
    expect(Object.keys(defs()).sort()).toEqual([
      "absoluteHttpUrl",
      "absoluteUri",
      "advertisedLimits",
      "aliasResult",
      "aliasResultMembers",
      "allocatedIdentity",
      "attribution",
      "batchOperation",
      "batchRequest",
      "bdpVersion",
      "beadCollection",
      "beadRecord",
      "cardinality",
      "changeGroup",
      "changefeedPage",
      "createBeadMembers",
      "createBeadOperation",
      "createBeadRequest",
      "createLinkMembers",
      "createLinkOperation",
      "createLinkRequest",
      "createdData",
      "dateTime",
      "deleteAliasMembers",
      "deleteAliasRequest",
      "deleteBeadMembers",
      "deleteBeadOperation",
      "deleteBeadRequest",
      "deleteLinkMembers",
      "deleteLinkOperation",
      "deleteLinkRequest",
      "deleteWhereMembers",
      "deleteWhereOperation",
      "deleteWhereRequest",
      "deletedData",
      "deletedIdentity",
      "directProblemCode",
      "durableInputPinnedReference",
      "durableInputReference",
      "durableResourceReference",
      "endpointConstraint",
      "erasureDigest",
      "erasureRecord",
      "event",
      "eventPage",
      "eventType",
      "expectedRevision",
      "idempotencyKey",
      "inputPinnedReference",
      "inputReference",
      "iso8601Duration",
      "jsonPointer",
      "linkCollection",
      "linkDeltaData",
      "linkRecord",
      "localBindingReference",
      "localName",
      "maximumEndpointMultiplicityPolicy",
      "mutationOutcome",
      "mutationReceipt",
      "mutationReceiptPage",
      "mutationResult",
      "mutationResultMembers",
      "ownedLinkChange",
      "ownedLinkDeclaration",
      "ownedLinkDelta",
      "ownedWildcardDeclaration",
