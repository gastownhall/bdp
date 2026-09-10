import { describe, expect, it } from "vitest";
import { READ_UPDATE_VALUE_SCHEMA_REFS } from "./read-update-values.js";
import { readCanonicalSchemaBundle } from "./read-values.js";

const roots = [
  "createBead",
  "updateBeadProperties",
  "deleteBead",
  "createLink",
  "updateLinkProperties",
  "deleteLink",
  "putAlias",
  "deleteAlias",
  "sequenceRequest",
] as const;
const numericKeywords = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);

// Carrier placeholders are safe only while every reachable request schema
// leaves numbers unconstrained. Follow refs transitively, including conditional
// schemas; do not treat annotation examples/defaults as validation constraints.
function numericConstraints(bundle: Record<string, unknown>, refs: readonly string[]): string[] {
  type Role = "schema" | "schema-map";
  const schemaMaps = new Set([
    "$defs",
    "definitions",
    "properties",
    "patternProperties",
    "dependentSchemas",
    "dependencies",
  ]);
  const pending: { value: unknown; role: Role }[] = refs.map(($ref) => ({
    value: { $ref },
    role: "schema",
  }));
  const visited: Record<Role, Set<unknown>> = { schema: new Set(), "schema-map": new Set() };
  const violations: string[] = [];
  const hasNumber = (value: unknown): boolean => {
    const values = [value];
    while (values.length) {
      const item = values.pop();
      if (typeof item === "number") return true;
      if (item && typeof item === "object") values.push(...Object.values(item));
    }
    return false;
  };
  while (pending.length) {
    const task = pending.pop();
    if (!task) continue;
    const { value, role } = task;
    if (!value || typeof value !== "object" || visited[role].has(value)) continue;
    visited[role].add(value);
    // Map keys are user-selected names, even when spelled like schema keywords.
    if (role === "schema-map") {
      for (const child of Object.values(value)) pending.push({ value: child, role: "schema" });
      continue;
    }
    const schema = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(schema)) {
      if (key === "$ref" || key === "$dynamicRef") {
        if (typeof child !== "string" || !child.startsWith("#/"))
          throw new Error(`unclassified schema reference ${child}`);
        let target: unknown = bundle;
        for (const part of child.slice(2).split("/"))
          target = (target as Record<string, unknown>)[
            part.replace(/~1/g, "/").replace(/~0/g, "~")
          ];
        if (target === undefined) throw new Error(`missing schema reference ${child}`);
        pending.push({ value: target, role: "schema" });
      } else if (numericKeywords.has(key) && typeof child === "number") violations.push(key);
      else if (
        key === "type" &&
        (child === "number" ||
          child === "integer" ||
          (Array.isArray(child) && child.some((type) => type === "number" || type === "integer")))
      )
        violations.push("type");
      else if ((key === "enum" || key === "const") && hasNumber(child)) violations.push(key);
      else if (!["examples", "default", "enum", "const"].includes(key))
        pending.push({ value: child, role: schemaMaps.has(key) ? "schema-map" : "schema" });
    }
  }
  return violations;
}

describe("RU numeric carrier placeholder schema invariant", () => {
  it.each(roots)("keeps %s and all transitively reachable constraints number-neutral", (root) => {
    expect(
      numericConstraints(readCanonicalSchemaBundle(), [READ_UPDATE_VALUE_SCHEMA_REFS[root]]),
    ).toEqual([]);
  });
  it.each([
    ...[...numericKeywords].map((key) => ({ [key]: 1 })),
    { type: "number" },
    { type: ["null", "integer"] },
    { enum: [1] },
    { const: { n: 2 } },
  ])("detects a future reachable numeric constraint %j", (constraint) => {
    const bundle = {
      $defs: { root: { properties: { n: { $ref: "#/$defs/nested" } } }, nested: constraint },
    };
    expect(numericConstraints(bundle, ["#/$defs/root"])).not.toEqual([]);
  });
  for (const map of [
    "properties",
    "patternProperties",
    "dependentSchemas",
    "$defs",
    "definitions",
    "dependencies",
  ]) {
    it.each(["default", "examples", "enum", "const", "type", "$ref"])(
      `checks schemas named %s inside ${map} as schemas, not annotations`,
      (name) => {
        const bundle = { $defs: { root: { [map]: { [name]: { type: "number", minimum: 1 } } } } };
        expect(numericConstraints(bundle, ["#/$defs/root"])).toEqual(["type", "minimum"]);
      },
    );
  }
  it.each(["default", "examples"])(
    "follows a constraint through a property and definition named %s",
    (name) => {
      const bundle = {
        $defs: {
          root: { properties: { [name]: { $ref: `#/$defs/${name}` } } },
          [name]: { allOf: [{ properties: { examples: { maximum: 2 } } }] },
        },
      };
      expect(numericConstraints(bundle, ["#/$defs/root"])).toEqual(["maximum"]);
    },
  );
  it("ignores schema-shaped annotation data while checking the adjacent named property", () => {
    const bundle = {
      $defs: {
        root: {
          examples: [{ properties: { examples: { minimum: 1 } } }],
          default: { properties: { default: { maximum: 2 } } },
          properties: { default: { type: "string", examples: [1], default: 2 } },
        },
      },
    };
    expect(numericConstraints(bundle, ["#/$defs/root"])).toEqual([]);
  });

  it("ignores unreachable numeric definitions and annotation-only numbers", () => {
    const bundle = {
      $defs: {
        root: { type: "object", examples: [{ n: 1 }], default: { n: 2 } },
        unrelated: { minimum: 1 },
      },
    };
    expect(numericConstraints(bundle, ["#/$defs/root"])).toEqual([]);
  });
});
