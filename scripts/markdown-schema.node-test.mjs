import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  definitionAnchor,
  dialect,
  formatVersion,
  parseSchema,
  renderSchema,
  SchemaMarkdownError,
} from "./markdown-schema.mjs";

const root = new URL("../", import.meta.url);
const text = (name) => readFileSync(new URL(name, root), "utf8");
const load = (name) => JSON.parse(text(name));
const roundTrip = (schema) => {
  const rendered = renderSchema(schema);
  assert.deepStrictEqual(parseSchema(rendered), schema);
  assert.equal(renderSchema(parseSchema(rendered)), rendered);
  return rendered;
};
const refuses = (action, code) =>
  assert.throws(
    action,
    (error) => error instanceof SchemaMarkdownError && (!code || error.code === code),
  );
const fence = String.fromCharCode(96).repeat(3);

// Source projection only: no JSON Schema instance evaluator, provider, HTTP,
// Type admission, schema fetch, storage engine or protocol runtime is exercised.
test("complete unchanged common212-definition bundle projects losslessly", () => {
  const path = "specs/profiles/core/bdp-v0.1.schema.json";
  const before = text(path);
  const schema = JSON.parse(before);
  assert.equal(Object.keys(schema.$defs).length, 212);
  const markdown = roundTrip(schema);
  assert.equal(parseSchema(markdown).$id, schema.$id);
  assert.equal(text(path), before);
  assert(markdown.includes("| Name | Type | Required | Defined by | Meaning |"));
  assert(markdown.includes('ref "#/$defs/'));
  assert(!markdown.includes('"$defs": {'), "root definitions must not be a raw wrapper");
});

for (const name of ["bead-type-definition", "link-type-definition", "refines", "type-definition"])
  test("intrinsic2 " + name + " preserves comments, resources and external references", () => {
    roundTrip(load("specs/profiles/types/intrinsic-2/" + name + ".properties.schema.json"));
  });

test("hand-authored field table has exact lowering and canonical rendering", () => {
  const schema = load("fixtures/markdown-schema/simple.json");
  const markdown = text("fixtures/markdown-schema/simple.md");
  assert.deepStrictEqual(parseSchema(markdown), schema);
  assert.equal(renderSchema(schema), markdown);
});

test("hard-clause fixture keeps identity, maps, conditionals and evaluated closure", () => {
  const schema = load("fixtures/markdown-schema/feature-bundle.json");
  const markdown = roundTrip(schema);
  assert(markdown.includes("### Advanced"));
  assert(markdown.includes('"unevaluatedProperties": false'));
  assert(markdown.includes('"contains"'));
  assert(markdown.includes("| dependentRequired |"));
  const parsed = parseSchema(markdown);
  assert.equal(parsed.$defs.false.$id, "nested/resource.json");
  assert.equal(parsed.$defs.false.allOf[0].$ref, "../common.json#/$defs/value");
  assert.equal(parsed.properties.items.items.$ref, "external.json#name");
});

test("arbitrary names and all string annotation distinctions survive", () => {
  const names = [
    "",
    "__proto__",
    "constructor",
    "a|b\\c",
    "#/$defs/key",
    "line\nname",
    "é",
    "e\u0301",
    "\ud800",
  ];
  const props = Object.fromEntries(
    names.map((name, i) => [
      name,
      {
        type: "string",
        title: i % 2 ? "" : "—",
        description: " \n|\\" + name,
        "x-definedBy": i % 2 ? "" : { raw: name },
      },
    ]),
  );
  const schema = {
    title: "# title\n| arbitrary",
    description: "",
    "x-annotation\n|name": { value: "literal" },
    type: "object",
    properties: props,
    $defs: Object.fromEntries(names.map((name) => [name, false])),
  };
  const rendered = roundTrip(schema);
  assert.equal(new Set(names.map(definitionAnchor)).size, names.length);
  assert.equal(Object.hasOwn(parseSchema(rendered).properties, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});

test("absence, empty values and explicit booleans never normalize", () => {
  for (const schema of [
    true,
    false,
    {},
    { properties: {} },
    { required: [] },
    { properties: {}, required: [] },
    { additionalProperties: true },
    { additionalProperties: false },
    { $defs: {} },
    { type: ["null", "string"] },
    { default: false, const: -0, examples: [null, false, "", -0], "x-any": {} },
  ])
    roundTrip(schema);
});

test("required order, unknown local required name and inference stay explicit", () => {
  const schema = {
    properties: { b: { type: "number" }, a: { type: "string" } },
    required: ["b", "outside", "a"],
  };
  const rendered = roundTrip(schema);
  assert(rendered.includes('Required order: ["b","outside","a"]'));
  const inferred = renderSchema({ properties: { a: { type: "string" } } }).replace(
    '| "a" | text | no |',
    '| "a" | text | yes |',
  );
  assert.deepStrictEqual(parseSchema(inferred).required, ["a"]);
  refuses(
    () => parseSchema(rendered.replace('| "a" | text | yes |', '| "a" | text | no |')),
    "E_REQUIRED",
  );
});

test("union nesting, array precedence and simple named syntax do not flatten", () => {
  roundTrip({
    properties: {
      nested: { anyOf: [{ type: "string" }, { anyOf: [{ type: "number" }, { type: "null" }] }] },
      array: { type: "array", items: { anyOf: [{ type: "string" }, true] } },
      any: {},
      open: true,
      closed: false,
    },
  });
  const source = renderSchema({
    properties: { a: { type: "string" } },
    $defs: { Token: { type: "string" } },
  });
  const named = source.replace('| "a" | text |', '| "a" | Token |');
  assert.deepStrictEqual(parseSchema(named).properties.a, { $ref: "#/$defs/Token" });
});

test("literal recursive and external refs are preserved without fetching or rebasing", () => {
  roundTrip({
    $id: "https://schemas.invalid/root.json",
    $defs: {
      Node: {
        $id: "node.json",
        $anchor: "node",
        properties: {
          next: { $ref: "#node" },
          remote: { $ref: "https://elsewhere.invalid/schema.json#/$defs/X" },
        },
      },
    },
    $ref: "#/$defs/Node",
  });
  roundTrip({
    $dynamicAnchor: "meta",
    $dynamicRef: "#meta",
    $vocabulary: { "https://vocab.invalid/example": true },
  });
});

test("title override changes only display, never the schema title", () => {
  const schema = { title: "Original\n—", type: "string" };
  assert.deepStrictEqual(parseSchema(renderSchema(schema, { title: "Display | only" })), schema);
  refuses(() => renderSchema(schema, { unknown: true }), "E_OPTIONS");
});

test("missing or wrong version marker and prose refuse", () => {
  const source = renderSchema({ type: "string" });
  refuses(() => parseSchema(source.replace("/0.6", "/0.5")), "E_VERSION");
  refuses(() => parseSchema(source.replace("Format: markdown-json-schema/0.6", "")), "E_VERSION");
  refuses(() => parseSchema(source + "Execute this prose.\n"), "E_DOCUMENT");
  assert.equal(formatVersion, "0.6");
  assert.equal(dialect, "https://json-schema.org/draft/2020-12/schema");
});

test("unsupported and malformed schema shapes refuse instead of dropping keywords", () => {
  for (const schema of [
    { unknownValidation: true },
    { $schema: "http://json-schema.org/draft-07/schema#" },
    { items: [] },
    { allOf: [] },
    { required: ["x", "x"] },
    { dependentRequired: { x: "y" } },
    { type: ["string", "string"] },
    { enum: [1, 1] },
    { enum: [0, -0] },
    {
      enum: [
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ],
    },
    { minLength: -1 },
    { multipleOf: 0 },
    { description: false },
    { examples: {} },
    { properties: { x: null } },
  ])
    refuses(() => renderSchema(schema));
  refuses(() => renderSchema({ default: undefined }), "E_JSON");
});

test("malformed tables, duplicate field ownership and wrong closure ownership refuse", () => {
  const source = renderSchema({ properties: { a: { type: "string" } } });
  refuses(
    () =>
      parseSchema(
        source.replace(
          "| Name | Type | Required | Defined by | Meaning |",
          "| Wrong | Type | Required | Defined by | Meaning |",
        ),
      ),
    "E_TABLE",
  );
  refuses(
    () =>
      parseSchema(
        source.replace(
          '| "a" | text | no | — | — |',
          '| "a" | text | no | — | — |\n| "a" | number | no | — | — |',
        ),
      ),
    "E_DUPLICATE",
  );
  refuses(() => parseSchema(source.replace('| "a" | text |', '| "a" | schema |')), "E_OWNERSHIP");
  refuses(
    () =>
      parseSchema(
        source +
          "\n### Advanced\n\n" +
          fence +
          "json-schema\n" +
          '{"$defs":{"Replacement":{}}}' +
          "\n" +
          fence +
          "\n",
      ),
    "E_OWNERSHIP",
  );
  refuses(
    () =>
      parseSchema(
        renderSchema({ additionalProperties: false }) +
          "\n### Advanced\n\n" +
          fence +
          "json-schema\n" +
          '{"additionalProperties":true}' +
          "\n" +
          fence +
          "\n",
      ),
    "E_DUPLICATE",
  );
});

test("decoded duplicate JSON keys and orphan complex fields refuse", () => {
  const source = renderSchema({ allOf: [{}] });
  const duplicated = source.replace(
    '{\n  "allOf": [\n    {}\n  ]\n}',
    '{"allOf":[{}],"all\\u004ff":[{}]}',
  );
  refuses(() => parseSchema(duplicated), "E_DUPLICATE");
  const field = renderSchema({ properties: { a: { minLength: 1 } } });
  refuses(() => parseSchema(field.replace('| "a" | schema | no | — | — |\n', "")), "E_OWNERSHIP");
});

test("duplicate definition, mismatched anchor and boolean object sections refuse", () => {
  const source = renderSchema({ $defs: { x: false } });
  const tail = source.slice(source.indexOf('<a id="' + definitionAnchor("x")));
  refuses(() => parseSchema(source + tail), "E_DUPLICATE");
  refuses(
    () => parseSchema(source.replace(definitionAnchor("x"), definitionAnchor("y"))),
    "E_NAME",
  );
  refuses(() => parseSchema(renderSchema(false) + "\nOther fields: allowed\n"), "E_SCHEMA");
});

test("authored numeric literals refuse precision loss in cells and nested clauses", () => {
  const cell = renderSchema({ const: 0 });
  const advanced = renderSchema({ allOf: [{ minimum: 0 }], default: { nested: [0] } });
  for (const literal of [
    "1e-400",
    "9007199254740993",
    "-9007199254740993",
    "0.10000000000000001",
    "1e400",
    "1e-999999999999999999999999",
  ]) {
    refuses(
      () => parseSchema(cell.replace("| const | 0 |", "| const | " + literal + " |")),
      "E_PRECISION",
    );
    refuses(
      () => parseSchema(advanced.replace('"minimum": 0', '"minimum": ' + literal)),
      "E_PRECISION",
    );
    refuses(
      () => parseSchema(advanced.replace('{"nested":[0]}', '{"nested":[' + literal + "]}")),
      "E_PRECISION",
    );
  }
  for (const literal of [
    "1.0",
    "1e0",
    "0.1",
    "9007199254740992",
    "1e+21",
    "5e-324",
    "0e999999999999999999999999",
  ]) {
    assert.equal(
      parseSchema(cell.replace("| const | 0 |", "| const | " + literal + " |")).const,
      Number(literal),
    );
  }
  for (const literal of ["-0", "-0.0", "-0e999999999999999999999999"]) {
    assert(
      Object.is(
        parseSchema(cell.replace("| const | 0 |", "| const | " + literal + " |")).const,
        -0,
      ),
    );
  }
  assert.equal(
    parseSchema(cell.replace("| const | 0 |", '| const | "9007199254740993" |')).const,
    "9007199254740993",
  );
  // API input is already parsed: precision lost before renderSchema is unknowable.
  roundTrip({ const: Number("9007199254740993") });
});

test("Type expressions enforce length, recursion and parse-node limits before work", () => {
  const source = renderSchema({ properties: { x: { type: "string" } } });
  const authored = (expression) => source.replace('| "x" | text |', '| "x" | ' + expression + " |");
  assert.deepStrictEqual(
    parseSchema(authored("(".repeat(128) + "text" + ")".repeat(128))).properties.x,
    { type: "string" },
  );
  refuses(() => parseSchema(authored("(".repeat(129) + "text" + ")".repeat(129))), "E_LIMIT");
  assert.equal(parseSchema(authored("array of ".repeat(125) + "text")).properties.x.type, "array");
  refuses(() => parseSchema(authored("array of ".repeat(129) + "text")), "E_LIMIT");
  assert.equal(
    parseSchema(authored("array of ".repeat(63) + "(".repeat(63) + "text" + ")".repeat(63)))
      .properties.x.type,
    "array",
  );
  refuses(
    () => parseSchema(authored("array of ".repeat(64) + "(".repeat(65) + "text" + ")".repeat(65))),
    "E_LIMIT",
  );
  assert.equal(
    parseSchema(authored(Array(4095).fill("text").join(" OR "))).properties.x.anyOf.length,
    4095,
  );
  refuses(() => parseSchema(authored(Array(4096).fill("text").join(" OR "))), "E_LIMIT");
  assert.equal(
    parseSchema(authored('ref "' + "a".repeat(65530) + '"')).properties.x.$ref.length,
    65530,
  );
  refuses(() => parseSchema(authored('ref "' + "a".repeat(65531) + '"')), "E_LIMIT");
  // Larger inline expressions retain the schema through the existing Advanced form.
  const broad = {
    properties: { x: { anyOf: Array.from({ length: 4096 }, () => ({ type: "string" })) } },
  };
  assert(roundTrip(broad).includes('| "x" | schema |'));
});

test("assembled JSON depth includes the enclosing schema and properties map", () => {
  const source = renderSchema({ properties: { x: { type: "string" } } });
  const authored = (count) =>
    source.replace('| "x" | text |', '| "x" | ' + "array of ".repeat(count) + "text |");
  const accepted = parseSchema(authored(125));
  roundTrip(accepted);
  refuses(() => parseSchema(authored(126)), "E_LIMIT");
});
