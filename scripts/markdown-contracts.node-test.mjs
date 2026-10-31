import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  commonPath,
  companionPath,
  definitionClosure,
  generateMarkdownContracts,
  root,
  schemaReferences,
} from "./generate-markdown-contracts.mjs";
import { definitionAnchor, parseSchema } from "./markdown-schema.mjs";

const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

test("complete Markdown bundle preserves canonical structure, identity and both schema mirrors", () => {
  const common = load(commonPath);
  assert.deepEqual(parseSchema(readFileSync(resolve(root, companionPath), "utf8")), common);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(resolve(root, commonPath)))
      .digest("hex"),
    "e0de70f5d1da926bedb4fac0343e0f561e91136511c4949cffd56ba5b6c60b8f",
  );
  for (const edition of ["v0", "v0.1"])
    assert.deepEqual(
      readFileSync(resolve(root, `specs/profiles/core/bdp-${edition}.schema.json`)),
      readFileSync(resolve(root, `packages/protocol/schemas/bdp-${edition}.schema.json`)),
    );
});

test("checked-in projections are reproducible and every selected schema anchor exists", () => {
  const artifacts = generateMarkdownContracts();
  assert.deepEqual(artifacts, generateMarkdownContracts());
  for (const [path, expected] of Object.entries(artifacts))
    assert.equal(readFileSync(resolve(root, path), "utf8"), expected, path);
  const manifest = JSON.parse(artifacts["fixtures/markdown-contracts/selected.json"]);
  for (const selection of Object.values(manifest.selections))
    for (const name of selection.definitions)
      assert(artifacts[companionPath].includes(`id="${definitionAnchor(name)}"`), name);
});

test("read/write entry selection excludes historical operations without deleting their definitions", () => {
  const manifest = load("fixtures/markdown-contracts/selected.json");
  assert.deepEqual(manifest.operations.write, [
    "createBead",
    "updateBead",
    "deleteBead",
    "createLink",
    "updateLink",
    "deleteLink",
    "putAlias",
    "deleteAlias",
    "atomicBatch",
  ]);
  assert.equal(manifest.operations.read.length, 26);
  assert(manifest.operations.read.includes("scopeEvents"));
  assert(manifest.operations.read.includes("exactDefinition"));
  const roots = [
    ...new Set(Object.values(manifest.selections).flatMap((entry) => entry.entryPoints)),
  ].sort();
  const closure = [
    ...new Set(Object.values(manifest.selections).flatMap((entry) => entry.definitions)),
  ].sort();
  assert.equal(roots.length, 46, "Body, header, parsed-query and dispatch entry points");
  assert.equal(closure.length, 140, "Complete selected reference closure");
  for (const name of [
    "retainedEventQuery",
    "resourceProjectionSelection",
    "resourceProjectionPointQueryV1",
    "resourceProjectionInventoryQueryV1",
    "atomicBatchSelection",
    "typeDefinitionReadSelection",
    "typeDefinitionReadQueryV1",
    "idempotencyKey",
  ])
    assert(roots.includes(name), name);
  for (const entry of Object.values(manifest.selections))
    for (const name of entry.entryPoints)
      assert(!/sequence|transactionalDiscovery|receipt|snapshot|changeFeed/i.test(name), name);
  assert(Object.hasOwn(load(commonPath).$defs, "sequenceRequest"));
});

test("projection Problems and aggregate requirements are not weakened in the readable index", () => {
  const manifest = load("fixtures/markdown-contracts/selected.json");
  assert(manifest.selections.read.entryPoints.includes("resourceProjectionProblem"));
  const read = readFileSync(resolve(root, "specs/profiles/core/read-contracts.md"), "utf8");
  const aggregate = read.split("\n").find((line) => line.startsWith("| beadAggregate |"));
  assert(aggregate?.includes("links is additionally required"));
  for (const line of read.split("\n").filter((line) => line.startsWith("| projected")))
    assert(line.includes("resourceProjectionProblem"));
});

test("reference inventory never treats schema-looking literal instance data as a reference", () => {
  const schema = {
    $defs: {
      A: { const: { $ref: "#/$defs/not-a-schema" }, properties: { value: { $ref: "#/$defs/B" } } },
      B: { type: "string", examples: [{ $ref: "#/$defs/also-data" }] },
    },
  };
  assert.deepEqual(schemaReferences(schema.$defs.A), ["#/$defs/B"]);
  assert.deepEqual(definitionClosure(schema, ["A"]), {
    definitions: ["A", "B"],
    externalReferences: [],
  });
  assert.throws(() => definitionClosure(schema, ["missing"]), /Unknown canonical definition/);
});
