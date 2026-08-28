import { describe, expect, it } from "vitest";

import { createJsonSchemaValidator } from "./index.js";
import schemaBundle from "../../../schemas/bdp-v0.schema.json" with { type: "json" };

describe("offline schema validator", () => {
  it("requires the bundle to declare its own schema identity", () => {
    expect(() => createJsonSchemaValidator({ type: "object" })).toThrow(
      "schema bundle must declare a non-empty $id",
    );
  });

  it("enforces URI format annotations and resolves references before a run", () => {
    const validator = createJsonSchemaValidator({
      $id: "https://example.test/schema.json",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: {
        uri: { type: "string", format: "uri" },
      },
    });
    expect(() => validator.resolve("#/$defs/uri")).not.toThrow();
    expect(validator.validate("#/$defs/uri", "not a URI")).not.toHaveLength(0);
    expect(validator.validate("#/$defs/uri", "https://example.test/%zz")).not.toHaveLength(0);
    expect(validator.validate("#/$defs/uri", "urn:example:value")).toEqual([]);
  });

  it("enforces closed records in the canonical Read schema bundle", () => {
    const validator = createJsonSchemaValidator(schemaBundle);
    expect(
      validator.validate("#/$defs/beadRecord", {
        id: "https://scope.example/beads/a",
        type: "https://work.example/types/task",
        revision: "1",
        properties: {},
        unexpected: true,
      }),
    ).not.toHaveLength(0);
    expect(
      validator.validate("#/$defs/readDiscovery", {
        bdpVersion: "0",
        profile: "read",
        scope: "https://scope.example/",
        beads: "https://scope.example/beads/",
        links: "https://scope.example/links/",
        types: "https://scope.example/types/",
        operations: "https://scope.example/operations/",
      }),
    ).not.toHaveLength(0);
  });
});
