import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

// Literal acceptance oracles, not a CLI compiler, transport, service or replay test.
const root = new URL("../../../", import.meta.url);
const schemaBytes = readFileSync(new URL("specs/profiles/core/bdp-v0.1.schema.json", root));
const schema = JSON.parse(schemaBytes.toString());
const table = JSON.parse(readFileSync(new URL("fixtures/client-handoff/cases.json", root), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(schema);
function valid(name: string, value: unknown) {
  const check = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!check) throw new Error(`Missing root ${name}`);
  expect(check(value), JSON.stringify(check.errors)).toBe(true);
}

describe("client handoff authored artifact correspondence; no consumer execution", () => {
  it("pins actual unchanged accepted schema and unique finite case identities", () => {
    expect(table.acceptedReceiver).toBe("e23aec722763e967d3bde08caf96657069b39ead");
    expect(createHash("sha256").update(schemaBytes).digest("hex")).toBe(table.schemaSha256);
    expect(schema.$id).toBe(table.schemaId);
    expect(new Set(table.cases.map((c: { id: string }) => c.id)).size).toBe(table.cases.length);
    expect(table.cases.length).toBe(57);
  });

  for (const c of table.cases) {
    it(`${c.id}: checks authored carrier/result and boundary`, () => {
      const frozen = JSON.stringify(c);
      const directory = ajv.getSchema(`${schema.$id}#/$defs/writeOperationDirectory`);
      if (!directory) throw new Error("Missing writeOperationDirectory");
      expect(directory(c.discovery.operationDirectory)).toBe(c.discoveryExpectation !== "invalid");
      if (c.argv.includes("--file")) {
        const name = c.argv[c.argv.indexOf("--file") + 1];
        const bytes = c.scopeContext.files[name];
        expect(typeof bytes).toBe("string");
        if (c.typedRequest) {
          const decoded = c.argv.includes("--input-format")
            ? JSON.parse(bytes)
            : {
                capabilityVersion: "1",
                operations: bytes
                  .trim()
                  .split("\n")
                  .map((line: string) => JSON.parse(line)),
              };
          expect(decoded).toEqual(c.typedRequest.body);
        }
      }
      if (c.typedRequest) {
        const batch = c.typedRequest.intentKind === "atomic-batch";
        valid(batch ? "batchRequest" : `${c.typedRequest.operation}Request`, c.typedRequest.body);
        expect(c.wire.method).toBe("POST");
        expect(c.wire.jsonBody).toEqual(c.typedRequest.body);
        expect(c.wire.headers.Accept).toBe(table.mediaType);
        expect(c.wire.headers["Content-Type"]).toBe(table.mediaType);
        expect(c.wire.headers["Idempotency-Key"]).toBe(c.typedRequest.idempotencyKey);
        const route = batch
          ? c.discovery.document.capabilities[
              "https://github.com/gastownhall/bdp/capabilities/atomic-batch"
            ]["1"].operation
          : c.discovery.operationDirectory[c.typedRequest.operation];
        expect(c.wire.url).toBe(route);
        if (!batch) {
          expect(c.typedRequest.body).not.toHaveProperty("operation");
          expect(c.typedRequest.body).not.toHaveProperty("name");
        }
      }
      if (c.mustNotDispatch && c.wire) expect(c.wire.method).toBe("GET");
      if (c.nativeInput) {
        const check = ajv.getSchema(`${schema.$id}#/$defs/batchRequest`);
        if (!check) throw new Error("Missing batchRequest");
        expect(check(c.nativeInput)).toBe(false);
      }
      const e = c.expectedResultOrProblem;
      if (e.kind === "mutationResult") {
        valid("mutationResult", e.body);
        if (e.body.resource) expect(e.body.resource).toHaveProperty("metadata");
      }
      if (e.kind === "atomicBatchResult") valid("atomicBatchResult", e.body);
      if (e.kind === "writeProblem") {
        valid(
          c.typedRequest?.intentKind === "atomic-batch"
            ? "atomicBatchProblem"
            : "readUpdateProblem",
          e.body,
        );
        expect(e.body.status).toBe(e.httpStatus);
      }
      if (c.family === "batch1") {
        expect(c.providerAcceptance).toBe("NOT_SUPPORTED_BY_FROZEN_REFERENCE");
      }
      expect(JSON.stringify(c)).toBe(frozen);
    });
  }

  it("keeps preview GET, emission and uncertain transport distinct from write success", () => {
    const get = (id: string) => table.cases.find((c: { id: string }) => c.id === id);
    expect(get("delete-bead-preview").wire.method).toBe("GET");
    expect(get("member-emission-is-not-wire-dispatch").wire).toBeNull();
    expect(get("transport-loss-retains-uncertainty").expectedResultOrProblem.mutationOutcome).toBe(
      "unknown",
    );
    expect(
      get("noop-complete-original-envelope").expectedResultOrProblem.body.resource,
    ).not.toHaveProperty("revisionProvenance");
    const exact = get("merge-null-nested-and-exact-numbers").wire.jsonBody.propertiesChange;
    expect(exact[0].value).toBeNull();
    expect(exact[1].value).toBe(9007199254740992);
    expect(get("guard-local-ordinal-resolved-once").wire.jsonBody.expectedRevision).toBe(
      "opaque-from-authority",
    );
    expect(get("guard-local-ordinal-unavailable").mustNotDispatch).toBe(true);
  });
});
