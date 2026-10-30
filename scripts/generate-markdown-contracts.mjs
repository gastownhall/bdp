// Human-readable projections only. No provider, schema-resource publication or network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { operations } from "./generate-openapi.mjs";
import { definitionAnchor, parseSchema, renderSchema } from "./markdown-schema.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const commonPath = "specs/profiles/core/bdp-v0.1.schema.json";
export const companionPath = "specs/profiles/core/bdp-v0.1.schema.md";
const externalPrefix = "../profiles/core/bdp-v0.1.schema.json#/$defs/";
const localPrefix = "#/$defs/";
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

function formattedJSON(path, value) {
  assert.equal(load("node_modules/@biomejs/biome/package.json").version, "2.5.7");
  return execFileSync(
    process.execPath,
    [resolve(root, "node_modules/@biomejs/biome/bin/biome"), "format", "--stdin-file-path", path],
    {
      cwd: root,
      input: `${JSON.stringify(value, null, 2)}\n`,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
}

// Visit schema positions, not literal data in enum/const/default/examples.
export function schemaReferences(schema) {
  const references = [];
  function visit(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (typeof value.$ref === "string") references.push(value.$ref);
    for (const key of ["$defs", "properties", "patternProperties", "dependentSchemas"])
      for (const child of Object.values(value[key] || {})) visit(child);
    for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"])
      for (const child of value[key] || []) visit(child);
    for (const key of [
      "items",
      "contains",
      "not",
      "if",
      "then",
      "else",
      "additionalProperties",
      "unevaluatedProperties",
      "unevaluatedItems",
      "propertyNames",
      "contentSchema",
    ])
      visit(value[key]);
  }
  visit(schema);
  return references;
}

export function definitionClosure(schema, names) {
  const selected = new Set();
  const external = new Set();
  function add(name) {
    if (selected.has(name)) return;
    assert(Object.hasOwn(schema.$defs, name), `Unknown canonical definition: ${name}`);
    selected.add(name);
    for (const reference of schemaReferences(schema.$defs[name])) {
      if (reference.startsWith(localPrefix)) {
        const rest = reference.slice(localPrefix.length);
        const token = rest.split("/")[0].replaceAll("~1", "/").replaceAll("~0", "~");
        add(token);
      } else external.add(reference);
    }
  }
  for (const name of names) add(name);
  return { definitions: [...selected].sort(), externalReferences: [...external].sort() };
}

function queryAndDispatchRoots(rows) {
  const selected = new Set();
  if (rows.some((row) => row.event)) selected.add("retainedEventQuery");
  if (rows.some((row) => row.projection)) {
    selected.add("resourceProjectionSelection");
    selected.add("resourceProjectionMask");
  }
  if (rows.some((row) => row.projection && !row.collection))
    selected.add("resourceProjectionPointQueryV1");
  if (rows.some((row) => row.projection && row.collection))
    selected.add("resourceProjectionInventoryQueryV1");
  if (rows.some((row) => row.id === "exactDefinition")) {
    selected.add("typeDefinitionReadSelection");
    selected.add("typeDefinitionReadQueryV1");
  }
  if (rows.some((row) => row.id === "atomicBatch")) selected.add("atomicBatchSelection");
  return [...selected].sort();
}

function selectedRoots(rows) {
  const selected = new Set();
  for (const row of rows) {
    for (const value of [
      row.request,
      row.projection ? "resourceProjectionProblem" : row.problem,
      ...[row.response].flat(),
    ])
      if (value) selected.add(value);
    for (const parameter of row.parameters || [])
      for (const ref of schemaReferences(parameter.schema))
        if (ref.startsWith(externalPrefix)) selected.add(ref.slice(externalPrefix.length));
  }
  if (rows.some((row) => row.methods.includes("post"))) selected.add("idempotencyKey");
  for (const name of queryAndDispatchRoots(rows)) selected.add(name);
  return [...selected].sort();
}

function schemaLink(name, prefix) {
  return `[${name}](${prefix}bdp-v0.1.schema.md#${definitionAnchor(name)})`;
}

function profileDocument(kind, rows, schema, closure) {
  const prefix = kind === "read" ? "" : "../core/";
  const link = (name) => schemaLink(name, prefix);
  const entry = kind === "read" ? "retained-core.md" : "retained-write.md";
  const lines = [
    `# ${kind === "read" ? "Read" : "Write"} schema contracts`,
    "",
    `This index applies the [Markdown JSON Schema notation](../../formats/markdown-json-schema.md) to the selected [${kind === "read" ? "Core/Read" : "Write"} entry](${entry}). The [complete schema companion](${prefix}bdp-v0.1.schema.md) preserves the entire canonical JSON bundle, including its original identity and reference topology. This index selects the actual entry points below; inherited definitions elsewhere in that bundle do not become selected operations. The JSON schema and protocol clauses keep their existing authority.`,
    "",
    "The notation describes value shape. Authorization, discovery, exact request selection, HTTP decision order, pagination, Type interpretation and durable retry remain protocol rules. A schema-valid value alone does not establish those behaviors or provider conformance.",
    "",
    "## Operation correspondence",
    "",
    "| Operation or read form | Request body | Success representation | Problem shape | Selection |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const response = [row.response].flat().filter(Boolean).map(link).join(" or ");
    const problem = row.projection ? "resourceProjectionProblem" : row.problem;
    const support =
      row.optional || (kind === "read" ? "Required retained Core" : "Required retained Write");
    lines.push(
      `| ${row.id} | ${row.request ? link(row.request) : "No JSON request body"} | ${response ? response + (row.aggregate ? "; links is additionally required" : "") : row.alias ? "Bodyless alias redirect" : "Optional human landing body; no BDP JSON schema"} | ${link(problem)} | ${support} |`,
    );
  }
  lines.push(
    "",
    "GET and HEAD share read selection; HEAD has no representation body. Alias resolution uses its bodyless redirect. Native 204/304/405/406/412/500 branches retain their actual bodyless rules rather than acquiring a Problem body. The informative [HTTP catalog](../../openapi/README.md) records headers, media, native query carriers and complete transport branches.",
    "",
    "Projection alternatives overlap and remain inclusive: an explicit request selects the applicable full or projected arm. Ordinary full output cannot silently become a projection. The optional History, exact-definition and batch entries retain their independent capability/context requirements; a row in this index never advertises them.",
    "",
    "## Decoded query and dispatch shapes",
    "",
    "The following helpers describe decoded query values or preliminary selection prefixes. A prefix is not a complete invocation, and these schemas do not add JSON bodies to GET requests. Raw query encoding, duplicate members, error precedence and capability admission remain in their protocol clauses.",
    "",
    ...queryAndDispatchRoots(rows).map((name) => `- ${link(name)}`),
    ...(kind === "write"
      ? [
          "",
          `Every mutation carries the ordinary ${link("idempotencyKey")} HTTP header; it is not a request-body field.`,
        ]
      : []),
    "",
    "## Shared shapes used by these entries",
    "",
    `The entry-point roots reach ${closure.definitions.length} named definitions in the canonical bundle. They are linked below without copying a partial bundle under the original schema identity. Every link names the same definition represented in the complete Markdown companion.`,
    "",
    ...closure.definitions.map((name) => `- ${link(name)}`),
    "",
    "## Source and reproduction",
    "",
    `Canonical source: [${schema.$id}](${prefix}bdp-v0.1.schema.json). The companion round-trips to that complete parsed source, preserving required order, omission, exact references, conditionals, annotations and closure. This is source-projection evidence, not executed HTTP, Type admission or storage behavior.`,
    "",
    "Generate or check with the pinned repository Node runtime:",
    "",
    "```sh",
    "# Regenerate the Markdown schema companion and selected profile indexes.",
    "node scripts/generate-markdown-contracts.mjs",
    "",
    "# Verify that checked-in projections match their sources.",
    "node scripts/generate-markdown-contracts.mjs --check",
    "",
    "```",
    "",
  );
  return lines.join("\n");
}

export function generateMarkdownContracts() {
  const schema = load(commonPath);
  const markdown = renderSchema(schema, { title: "Complete BDP v0.1 schema bundle" });
  assert.deepEqual(parseSchema(markdown), schema, "Complete schema projection must be lossless");
  const rows = operations();
  const read = rows.filter((row) => !row.methods.includes("post"));
  const write = rows.filter((row) => row.methods.includes("post"));
  const selections = Object.fromEntries(
    [read, write].map((group, i) => {
      const entryPoints = selectedRoots(group);
      return [
        i === 0 ? "read" : "write",
        { entryPoints, ...definitionClosure(schema, entryPoints) },
      ];
    }),
  );
  return {
    [companionPath]: markdown,
    "specs/profiles/core/read-contracts.md": profileDocument("read", read, schema, selections.read),
    "specs/profiles/write/write-contracts.md": profileDocument(
      "write",
      write,
      schema,
      selections.write,
    ),
    "fixtures/markdown-contracts/selected.json": formattedJSON(
      "fixtures/markdown-contracts/selected.json",
      {
        status: "SOURCE_PROJECTION_ONLY",
        source: commonPath,
        sourceSHA256: createHash("sha256")
          .update(readFileSync(resolve(root, commonPath)))
          .digest("hex"),
        selections,
        operations: { read: read.map((row) => row.id), write: write.map((row) => row.id) },
      },
    ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new Error("Usage: generate-markdown-contracts.mjs [--check]");
  for (const [path, value] of Object.entries(generateMarkdownContracts())) {
    if (args[0] === "--check") assert.equal(readFileSync(resolve(root, path), "utf8"), value, path);
    else writeFileSync(resolve(root, path), value);
  }
  console.log(
    args[0] === "--check"
      ? "Markdown contracts match their sources."
      : "Generated Markdown contracts.",
  );
}
