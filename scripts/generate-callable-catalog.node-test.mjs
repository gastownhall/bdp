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
test("title and CLI mapping are read from after the arguments, never from prose", () => {
  const body = section("Declared `atomic`.").replace(
    "Does it.",
    "Does it.\n\nTitle: prose that merely looks like a title.",
  );
  const mapping = '{"positionals": [{"position": 0, "parameter": "a"}]}';
  const [parsed] = parseSections(
    `${body}\nTitle: Do it\n\nCLI mapping:\n\n\`\`\`json\n${mapping}\n\`\`\`\n`,
  );
  assert.equal(parsed.title, "Do it");
  assert.deepEqual(parsed.cliMapping, JSON.parse(mapping));
  assert.equal(parsed.description.includes("prose that merely"), true);
});
test("a CLI mapping that is not a fenced block stops generation", () => {
  assert.throws(
    () => parseSections(`${section("Declared `atomic`.")}\nCLI mapping: none\n`),
    /unreadable CLI mapping/,
  );
});
test("§2.5: every invalid cliMapping is refused", () => {
  const flagged = (cliMapping) => ({
    ...declaration({ name: "pinned", schema: { type: "boolean" } }),
    cliMapping,
  });
  const undeclared = [{ names: ["-x"], parameter: "nope" }];
  assert.throws(
    () => assertValidDeclaration(flagged({ flags: undeclared })),
    /flags names undeclared/,
  );
  assert.throws(
    () => assertValidDeclaration(flagged({ fromFile: undeclared })),
    /fromFile names undeclared/,
  );
  assert.throws(
    () => assertValidDeclaration(flagged({ positionals: [{ position: 0, parameter: "nope" }] })),
    /positionals names undeclared/,
  );
  assert.throws(
    () =>
      assertValidDeclaration(
        flagged({
          positionals: [
            { position: 0, parameter: "pinned" },
            { position: 0, parameter: "pinned" },
          ],
        }),
      ),
    /duplicate position/,
  );
  for (const names of [["--pinned"], ["-p", "-p"]])
    assert.throws(
      () => assertValidDeclaration(flagged({ flags: [{ names, parameter: "pinned" }] })),
      /duplicate flag spelling/,
    );
  assert.throws(
    () =>
      assertValidDeclaration(
        flagged({
          flags: [{ names: ["-p"], parameter: "pinned" }],
          fromFile: [{ names: ["-p"], parameter: "pinned" }],
        }),
      ),
    /duplicate flag spelling/,
  );
});
test("§2.5: an invalid member flag is refused", () => {
  const patched = (memberFlags) => ({
    ...declaration({
      name: "patch",
      schema: {
        $ref: "#/$defs/Patch",
        $defs: {
          Patch: {
            type: "object",
            properties: { status: { type: "string" }, actor: { type: "string" } },
          },
        },
      },
    }),
    cliMapping: { memberFlags },
  });
  assert.doesNotThrow(() =>
    assertValidDeclaration(patched([{ member: "status", names: ["-s"], parameter: "patch" }])),
  );
  assert.throws(
    () => assertValidDeclaration(patched([{ member: "status", parameter: "nope" }])),
    /memberFlags names undeclared/,
  );
  assert.throws(
    () => assertValidDeclaration(patched([{ member: "nope", parameter: "patch" }])),
    /does not declare/,
  );
  assert.throws(
    () => assertValidDeclaration(patched([{ member: "actor", parameter: "patch" }])),
    /who is acting/,
  );
  for (const spelling of ["--actor", "--author", "--arguments", "--help"])
    assert.throws(
      () =>
        assertValidDeclaration(
          patched([{ member: "status", names: [spelling], parameter: "patch" }]),
        ),
      /reserved flag/,
    );
  assert.throws(
    () =>
      assertValidDeclaration(
        patched([{ member: "status", names: ["--patch"], parameter: "patch" }]),
      ),
    /duplicate flag spelling/,
  );
});
test("§10: a boolean's derived --no-x yields to a parameter declared with that flag", () => {
  assert.doesNotThrow(() =>
    assertValidDeclaration({
      name: "do-it",
      parameters: [
        { name: "pinned", schema: { type: "boolean" } },
        { name: "no_pinned", schema: { type: "boolean" } },
      ],
      resultSchema: true,
    }),
  );
});
