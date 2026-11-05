import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertValidDeclaration,
  catalogFile,
  generateCatalog,
  parseSections,
  root,
  selfContained,
} from "./generate-callable-catalog.mjs";

const COMMON = "https://example.test/common.json";
const ISSUE = "https://example.test/issue.json";
const section = (promise) =>
  `### do-it (CallableBatch)\n\nDoes it.\n\n${promise}\n\n**\`doItArguments\`** — Args.\n\n**\`doItResult\`**\n`;
const declaration = (parameter) => ({
  name: "do-it",
  parameters: [parameter],
  resultSchema: true,
});

test("the checked-in catalog is what the Issue document generates", () => {
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(root, catalogFile), "utf8")),
    JSON.parse(JSON.stringify(generateCatalog())),
  );
});
test("promises and the error fragment are read from the section's own line", () => {
  assert.deepEqual(
    parseSections(
      section("Declared `idempotent` and `atomic`. Its `errorSchema` is `doItError`."),
    )[0],
    {
      name: "do-it",
      type: "https://github.com/gastownhall/bdp/types/callable/callable-batch",
      description: "Does it.",
      idempotent: true,
      atomic: true,
      argumentsFragment: "doItArguments",
      resultFragment: "doItResult",
      errorFragment: "doItError",
    },
  );
});
test("an unreadable promise line stops generation rather than dropping a promise", () => {
  assert.throws(() => parseSections(section("Declared `retryable`.")), /unreadable promise line/);
});
test("the closure is inlined under the fragment's own $defs and follows references", () => {
  const definitions = {
    a: { $ref: `${COMMON}#/$defs/b` },
    b: { $id: "dropped", items: { $ref: "#/$defs/c/items" } },
    c: { items: { type: "string", const: { $ref: "data, not a reference" } } },
  };
  assert.deepEqual(selfContained({ $ref: `${ISSUE}#/$defs/a` }, definitions, COMMON, ISSUE), {
    $ref: "#/$defs/a",
    $defs: {
      a: { $ref: "#/$defs/b" },
      b: { items: { $ref: "#/$defs/c/items" } },
      c: definitions.c,
    },
  });
});
test("a reference leaving both bundles is refused", () => {
  assert.throws(
    () => selfContained({ $ref: "https://elsewhere.test/x.json#/$defs/a" }, {}, COMMON, ISSUE),
    /outside the Issue and common bundles/,
  );
  assert.throws(
    () => selfContained({ $ref: "#/$defs/a" }, {}, COMMON, ISSUE),
    /Unknown definition/,
  );
});
test("§2.5: required with default and a failing default are invalid declarations", () => {
  assert.throws(
    () =>
      assertValidDeclaration(
        declaration({ name: "n", schema: { type: "string" }, required: true, default: "x" }),
      ),
    /required together with default/,
  );
  assert.throws(
    () =>
      assertValidDeclaration(declaration({ name: "n", schema: { type: "string" }, default: 1 })),
    /default fails its schema/,
  );
});
