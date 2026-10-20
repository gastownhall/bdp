import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  BDP_V0_SCHEMA_ID,
  parseReadUpdateRequest,
  parseReadUpdateSequenceRequest,
  prepareReadUpdateSingleton,
} from "./index.js";

// Carrier/schema evidence only: no mutation, historical resolution or Event
// application implementation is exercised by these cases.
const schema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../specs/profiles/core/bdp-v0.schema.json", import.meta.url)),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
ajv.addSchema(schema);
const validate = (name: string, value: unknown) => {
  const validator = ajv.getSchema(`${BDP_V0_SCHEMA_ID}#/$defs/${name}`);
  if (validator === undefined) throw new Error(`missing schema ${name}`);
  return validator(value);
};
const scope = "https://example.test/s/";
const endpoint = `${scope}beads/a`;
const link = `${scope}links/l`;
const type = "https://types.example/link";
const patch = [{ op: "add", path: "/note", value: "changed" }];

describe("proposed same-ID endpoint re-pin carriers", () => {
  it.each([
    { source: { uri: "beads/a", revision: "opaque@r7" } },
    { target: "beads/a" },
    { source: "beads/a", target: { uri: "beads/a", revision: "r8" }, propertiesChange: patch },
  ])("accepts endpoint-only presence and combined edits %j", (members) => {
    const input = { link: "links/l", ...members };
    expect(parseReadUpdateRequest("updateLink", JSON.stringify(input)).input).toEqual(input);
    expect(
      prepareReadUpdateSingleton(scope, "updateLink", JSON.stringify(input), "key").operations[0]
        ?.input,
    ).toEqual(input);
  });

  it.each([
    { link },
    { link, target: null },
    { link, target: { uri: endpoint, revision: "" } },
    { link, target: { uri: endpoint, revision: "r7", extra: true } },
    { link, targetRevision: "r7" },
  ])("refuses malformed or unselected request members %j", (input) => {
    expect(() => parseReadUpdateRequest("updateLink", JSON.stringify(input))).toThrow();
  });

  it("keeps updateBead closed to endpoint edits", () => {
    expect(() =>
      parseReadUpdateRequest("updateBead", JSON.stringify({ bead: endpoint, source: endpoint })),
    ).toThrow();
  });

  it.each(["source", "target"])(
    "preflights newly admitted %s references against the receiving Scope",
    (field) => {
      const input = { link: "links/l", [field]: { uri: `${scope}beads/%61`, revision: "r7" } };
      expect(() =>
        prepareReadUpdateSingleton(scope, "updateLink", JSON.stringify(input), "key"),
      ).toThrow();
      const external = {
        link: "links/l",
        [field]: { uri: "urn:example:opaque", revision: "current" },
      };
      expect(
        prepareReadUpdateSingleton(scope, "updateLink", JSON.stringify(external), "key")
          .operations[0]?.input,
      ).toEqual(external);
    },
  );

  it("preserves sequence kind/order checks and ordinary omitted endpoint members", () => {
    const operations = [
      {
        operation: "createBead",
        idempotencyKey: "one",
        name: "a",
        type: "https://types.example/bead",
      },
      {
        operation: "createLink",
        idempotencyKey: "two",
        name: "l",
        type,
        source: "@a",
        target: "@a",
      },
      { operation: "updateLink", idempotencyKey: "three", link: "@l", source: "@a" },
      { operation: "updateLink", idempotencyKey: "four", link: "@l", propertiesChange: patch },
    ];
    expect(() => parseReadUpdateSequenceRequest(JSON.stringify({ operations }))).not.toThrow();
    const wrongKind = operations.map((operation, index) =>
      index === 2 ? { ...operation, source: "@l" } : operation,
    );
    expect(() =>
      parseReadUpdateSequenceRequest(JSON.stringify({ operations: wrongKind })),
    ).toThrow();
  });

  it.each(["source", "target"])(
    "admits complete changed %s state in direct and owned deltas",
    (field) => {
      const effect = { [field]: { uri: endpoint, revision: "r7" } };
      expect(validate("updatedData", { previousRevision: "l1", revision: "l2", ...effect })).toBe(
        true,
      );
      expect(
        validate("ownedLinkDelta", {
          id: link,
          type,
          previousRevision: "l1",
          revision: "l2",
          ...effect,
        }),
      ).toBe(true);
      expect(
        validate("updatedData", { previousRevision: "l1", revision: "l2", [field]: endpoint }),
      ).toBe(true);
    },
  );

  it("preserves all emitted-effect presence and nonempty-array guards", () => {
    for (const name of ["updatedData", "ownedLinkDelta"]) {
      const base = {
        previousRevision: "l1",
        revision: "l2",
        ...(name === "ownedLinkDelta" ? { id: link, type } : {}),
      };
      expect(validate(name, base)).toBe(false);
      for (const field of ["change", "metadataChange"]) {
        expect(validate(name, { ...base, [field]: [] })).toBe(false);
        expect(validate(name, { ...base, [field]: [], target: endpoint })).toBe(false);
        expect(validate(name, { ...base, [field]: patch })).toBe(true);
      }
    }
  });

  it("excludes direct endpoint effects from the owning Bead transition envelope", () => {
    const ownedLink = {
      operation: "updated",
      link: {
        id: link,
        type,
        previousRevision: "l1",
        revision: "l2",
        target: { uri: endpoint, revision: "r7" },
      },
    };
    expect(validate("updatedData", { previousRevision: "b1", revision: "b2", ownedLink })).toBe(
      true,
    );
    for (const field of ["source", "target"]) {
      expect(
        validate("updatedData", {
          previousRevision: "b1",
          revision: "b2",
          ownedLink,
          [field]: endpoint,
        }),
      ).toBe(false);
    }
  });
});
