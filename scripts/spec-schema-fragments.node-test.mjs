import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkFragments,
  collectProfileFragments,
  extractSchemaFragments,
  prepareBundle,
  prepareProfileBundle,
  serializeSchemaJSON,
} from "./spec-schema-fragments.mjs";

const fragment = (
  name = "example",
  body = 'Value: object\n\n#### Keywords\n\n| Keyword | JSON value |\n| --- | --- |\n| description | "A readable constraint." |\n| type | "string" |',
) =>
  `<!-- bdp-schema:start ${name} -->\n### Schema: ${JSON.stringify(name)}\n\n${body}\n<!-- bdp-schema:end ${name} -->`;

test("visible fragments use the existing codec and preserve descriptions", () => {
  assert.deepEqual(extractSchemaFragments(`# Prose\n\n${fragment()}\n\nMore prose.`), {
    example: { description: "A readable constraint.", type: "string" },
  });
});

test("fenced examples cannot create authoring fragments", () => {
  assert.throws(
    () => extractSchemaFragments(`~~~markdown\n${fragment()}\n~~~`),
    /No schema fragments/,
  );
  assert.equal(
    Object.keys(extractSchemaFragments(`~~~markdown\n${fragment("fake")}\n~~~\n${fragment()}`))
      .length,
    1,
  );
});

test("bad boundary and ownership shapes fail closed", () => {
  for (const input of [
    `${fragment()}\n${fragment()}`,
    fragment().replace("bdp-schema:end example", "bdp-schema:end wrong"),
    fragment().replace("<!-- bdp-schema:end example -->", ""),
    fragment().replace("Value: object", fragment("nested")),
    fragment().replace("bdp-schema:start example", "bdp-schema:start  example"),
    fragment().replace('Schema: "example"', 'Schema: "other"'),
    fragment("example", "Value: object\n\nArbitrary ignored prose is forbidden."),
  ])
    assert.throws(() => extractSchemaFragments(input));
});

test("JSON-schema fences retain literal delimiter-like annotation data", () => {
  const body =
    'Value: object\n\n#### Advanced\n\n```json-schema\n{ "allOf": [{ "description": "<!-- bdp-schema:start fake -->", "type": "string" }] }\n```';
  assert.equal(
    extractSchemaFragments(fragment("example", body)).example.allOf[0].description,
    "<!-- bdp-schema:start fake -->",
  );
});

test("missing, changed and structurally different generated schemas fail", () => {
  const definitions = extractSchemaFragments(fragment());
  const bundle = { "x-bdp-core-definitions": ["example"], $defs: structuredClone(definitions) };
  checkFragments(definitions, bundle);
  assert.throws(() => checkFragments(definitions, { ...bundle, $defs: {} }), /Missing/);
  assert.throws(
    () => checkFragments(definitions, { ...bundle, $defs: { example: { type: "string" } } }),
    /differs/,
  );
});

test("review comments and inline-code delimiters cannot capture hidden definitions", () => {
  assert.throws(
    () => extractSchemaFragments(`<!-- closed --> <!-- Donna:\n${fragment("hidden")}\n-->`),
    /No schema fragments|Unmatched/,
  );
  const input = `A literal \`<!--\` is inline code.\n${fragment()}`;
  assert.equal(extractSchemaFragments(input).example.type, "string");
  assert.throws(
    () => extractSchemaFragments(`<!-- unfinished\n${fragment()}`),
    /Unclosed|Unmatched/,
  );
});

test("complete ownership detects source removal, rename and unknown fragments", () => {
  const both = extractSchemaFragments(`${fragment("one")}\n${fragment("two")}`);
  const bundle = JSON.parse(prepareBundle(both, { $defs: { otherProfile: { const: 3 } } }));
  assert.throws(() => checkFragments(extractSchemaFragments(fragment("one")), bundle), /inventory/);
  assert.throws(() => prepareBundle(extractSchemaFragments(fragment("one")), bundle), /Removed/);
  assert.throws(
    () =>
      checkFragments(extractSchemaFragments(`${fragment("one")}\n${fragment("renamed")}`), bundle),
    /inventory/,
  );
  assert.throws(
    () => checkFragments({ ...both, unknown: { type: "string" } }, bundle),
    /inventory/,
  );
  assert.deepEqual(bundle.$defs.otherProfile, { const: 3 });
});

test("serialization and actual output parity preserve supported negative zero", () => {
  const defs = extractSchemaFragments(
    fragment(
      "zero",
      'Value: object\n\n#### Keywords\n\n| Keyword | JSON value |\n| --- | --- |\n| type | "number" |\n| enum | [-0] |',
    ),
  );
  const bundle = JSON.parse(prepareBundle(defs, { $defs: { otherProfile: { const: -0 } } }));
  assert(Object.is(bundle.$defs.zero.enum[0], -0));
  assert(Object.is(bundle.$defs.otherProfile.const, -0));
  checkFragments(defs, bundle);
  assert.throws(() => serializeSchemaJSON(NaN), /Nonfinite/);
});

test("a bad second copy is rejected before output preparation can be published", () => {
  const defs = extractSchemaFragments(fragment());
  const bundles = [{ $defs: {} }, { "x-bdp-core-definitions": ["removed"], $defs: {} }];
  let writes = 0;
  assert.throws(() => {
    const outputs = bundles.map((bundle) => prepareBundle(defs, bundle));
    writes += outputs.length;
  }, /Removed/);
  assert.equal(writes, 0);
});

test("actual profile fragments match both distributions and distinct feature resources", () => {
  for (const [bundleName, paths] of [
    [
      "common",
      [
        "../specs/profiles/core/bdp-v0.1.schema.json",
        "../packages/protocol/schemas/bdp-v0.1.schema.json",
      ],
    ],
    ["id-root", ["../specs/profiles/write/id-root-v1.schema.json"]],
    ["types", ["../specs/profiles/types/types-v1.schema.json"]],
  ]) {
    const { definitions, sources } = collectProfileFragments(bundleName);
    for (const path of paths) {
      const bundle = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
      checkFragments(definitions, bundle);
      assert.deepEqual(bundle["x-bdp-schema-sources"], sources);
    }
  }
});

test("bundle qualification preserves colliding names and rejects cross-profile duplicates", () => {
  const common = fragment("beadRecord");
  const types = fragment("beadRecord").replaceAll("beadRecord -->", "beadRecord bundle=types -->");
  assert.deepEqual(Object.keys(extractSchemaFragments(`${common}\n${types}`)), ["beadRecord"]);
  assert.deepEqual(Object.keys(extractSchemaFragments(`${common}\n${types}`, "types")), [
    "beadRecord",
  ]);
  assert.throws(
    () => collectProfileFragments("common", () => fragment("duplicate")),
    /Duplicate profile/,
  );
  assert.throws(() => collectProfileFragments("common", () => "# No schemas"), /No common/);
  assert.throws(() => collectProfileFragments("unknown"), /Unknown/);
});

test("ownership moves require explicit migration and cannot hide schema drift or removal", () => {
  const definitions = { one: { type: "string" } };
  const oldSources = { "old.md": ["one"] };
  const sources = { "new.md": ["one"] };
  const bundle = {
    $defs: definitions,
    "x-bdp-schema-definitions": ["one"],
    "x-bdp-schema-sources": oldSources,
  };
  assert.throws(() => prepareProfileBundle(definitions, sources, bundle), /explicit --migrate/);
  const moved = JSON.parse(prepareProfileBundle(definitions, sources, bundle, true));
  assert.deepEqual(moved.$defs, definitions);
  assert.deepEqual(moved["x-bdp-schema-sources"], sources);
  assert.throws(
    () => prepareProfileBundle({ one: { type: "number" } }, sources, bundle, true),
    /Adoption changes/,
  );
  assert.throws(() => prepareProfileBundle({}, {}, bundle, true), /Removed/);
});

test("explicit ownership migration can add a genuinely new fragment without hand-editing JSON", () => {
  const bundle = {
    $defs: { one: { type: "string" } },
    "x-bdp-schema-definitions": ["one"],
    "x-bdp-schema-sources": { "core.md": ["one"] },
  };
  const definitions = { ...bundle.$defs, two: { type: "number" } };
  const sources = { "core.md": ["one", "two"] };
  assert.throws(() => prepareProfileBundle(definitions, sources, bundle), /explicit/);
  const added = JSON.parse(prepareProfileBundle(definitions, sources, bundle, true));
  assert.deepEqual(added.$defs, definitions);
  assert.deepEqual(added["x-bdp-schema-definitions"], ["one", "two"]);
  assert.deepEqual(added["x-bdp-schema-sources"], sources);
});
