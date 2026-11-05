#!/usr/bin/env node
// Static Callable catalog. Offline: no HTTP, provider or CLI. The Issue document and its
// schema bundle are authoritative; this file is their mechanical projection (Issue K-7).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { serializeSchemaJSON } from "./spec-schema-fragments.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const catalogFile = "packages/bd-domain/catalog/issue-callables-preview-1.json";
const documentFile = "specs/types/issue/callables.md";
const bundleFile = "specs/types/issue/issue-callables-preview-1.schema.json";
const commonFile = "specs/profiles/core/bdp-v0.1.schema.json";
const typeRoot = "https://github.com/gastownhall/bdp/types/callable";
const types = {
  CallableQuery: `${typeRoot}/callable-query`,
  CallableBatch: `${typeRoot}/callable-batch`,
};
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const DECLARED =
  /^(?:Declared (`idempotent`|`atomic`|`idempotent` and `atomic`)\.)?\s*(?:Its `errorSchema` is `(\w+)`\.)?$/;
const HEADING = /^#{3,4} ([\w./-]+) \((CallableQuery|CallableBatch)\)\s*$/gm;
const DATA_KEYWORDS = new Set(["const", "default", "enum", "examples"]);

/** One record per declaration section: its prose, its promises and the fragments it names. */
export function parseSections(markdown) {
  const heads = [...markdown.matchAll(HEADING)];
  return heads.map((head, index) => {
    const end = heads[index + 1]?.index ?? markdown.length;
    let body = markdown.slice(head.index + head[0].length, end);
    const next = body.search(/^#{1,3} /m);
    if (next >= 0) body = body.slice(0, next);
    const name = head[1];
    const shapes = [...body.matchAll(/^\*\*`(\w+)`\*\*/gm)].map((match) => match[1]);
    const argumentsFragment = shapes[0];
    assert(argumentsFragment?.endsWith("Arguments"), `${name}: no arguments fragment`);
    const result = /^Result: `(\w+)`/m.exec(body)?.[1] ?? shapes[1];
    assert(result, `${name}: no result fragment`);
    const prose = [];
    let declared = "";
    let errorFragment;
    for (const paragraph of body.split(/\n\s*\n/).map((text) => text.trim())) {
      if (paragraph.startsWith("**`") || paragraph.startsWith("Result: `")) break;
      if (paragraph === "") continue;
      if (/^(?:Declared |Its `errorSchema`)/.test(paragraph)) {
        const match = DECLARED.exec(paragraph);
        assert(match, `${name}: unreadable promise line: ${paragraph}`);
        declared = match[1] ?? "";
        errorFragment = match[2];
      } else prose.push(paragraph);
    }
    assert(prose.length > 0, `${name}: no description prose`);
    return {
      name,
      type: types[head[2]],
      description: prose.join("\n\n"),
      idempotent: declared.includes("`idempotent`"),
      atomic: declared.includes("`atomic`"),
      argumentsFragment,
      resultFragment: result,
      errorFragment,
    };
  });
}

function definitionOf(ref, commonId, issueId) {
  const match = /^(?:([^#]*))?#\/\$defs\/([A-Za-z0-9_]+)((?:\/.*)?)$/.exec(ref);
  if (!match || ![undefined, "", commonId, issueId].includes(match[1]))
    throw new Error(`Reference is outside the Issue and common bundles: ${ref}`);
  return { name: match[2], rest: match[3] };
}

/** Copy one schema with every bundle reference rewritten inside the document that will carry it. */
function localize(node, onReference) {
  if (Array.isArray(node)) return node.map((item) => localize(item, onReference));
  if (node === null || typeof node !== "object") return node;
  const copy = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") copy[key] = onReference(value);
    else if (DATA_KEYWORDS.has(key)) copy[key] = value;
    else copy[key] = localize(value, onReference);
  }
  return copy;
}

/** Callables §2.3: the valueSchema is its own root and the closure sits in its own $defs. */
export function selfContained(schema, definitions, commonId, issueId) {
  const needed = new Set();
  const onReference = (ref) => {
    const { name, rest } = definitionOf(ref, commonId, issueId);
    if (!Object.hasOwn(definitions, name)) throw new Error(`Unknown definition: ${ref}`);
    needed.add(name);
    return `#/$defs/${name}${rest}`;
  };
  assert(!Object.hasOwn(schema, "$defs"), "A fragment carries its own $defs");
  const out = localize(schema, onReference);
  const defs = {};
  const done = new Set();
  for (
    let pending = [...needed];
    pending.length > 0;
    pending = [...needed].filter((n) => !done.has(n))
  )
    for (const name of pending) {
      done.add(name);
      const { $id: _id, $schema: _schema, ...definition } = definitions[name];
      defs[name] = localize(definition, onReference);
    }
  const names = Object.keys(defs).sort();
  if (names.length > 0) out.$defs = Object.fromEntries(names.map((name) => [name, defs[name]]));
  return out;
}

function declarationOf(section, definitions, commonId, issueId) {
  const close = (schema) => selfContained(schema, definitions, commonId, issueId);
  const fragment = (name) => {
    if (!Object.hasOwn(definitions, name))
      throw new Error(`${section.name}: unknown fragment ${name}`);
    return definitions[name];
  };
  const argumentsSchema = fragment(section.argumentsFragment);
  assert.equal(argumentsSchema.type, "object", `${section.name}: arguments must be an object`);
  assert.equal(argumentsSchema.additionalProperties, false, `${section.name}: open arguments`);
  const beyond = Object.keys(argumentsSchema).filter(
    (key) =>
      !["description", "type", "additionalProperties", "properties", "required"].includes(key),
  );
  assert.deepEqual(beyond, [], `${section.name}: a parameter cannot express these keywords`);
  const required = new Set(argumentsSchema.required ?? []);
  const parameters = Object.entries(argumentsSchema.properties ?? {}).map(([name, schema]) => ({
    name,
    schema: close(schema),
    ...(required.has(name) ? { required: true } : {}),
    ...(Object.hasOwn(schema, "default") ? { default: schema.default } : {}),
    ...(typeof schema.description === "string" ? { description: schema.description } : {}),
  }));
  return {
    name: section.name,
    type: section.type,
    description: section.description,
    parameters,
    resultSchema: close(fragment(section.resultFragment)),
    ...(section.errorFragment === undefined
      ? {}
      : { errorSchema: close(fragment(section.errorFragment)) }),
    ...(section.idempotent ? { idempotent: true } : {}),
    ...(section.atomic ? { atomic: true } : {}),
  };
}

/** The Callables §2.5 checks a declaration's own document can answer. */
export function assertValidDeclaration(declaration) {
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
  const names = new Set();
  for (const parameter of declaration.parameters) {
    const label = `${declaration.name}.${parameter.name}`;
    assert(!names.has(parameter.name), `${label}: duplicate parameter`);
    names.add(parameter.name);
    assert(
      !(parameter.required === true && Object.hasOwn(parameter, "default")),
      `${label}: required together with default`,
    );
    const validate = ajv.compile(parameter.schema);
    if (Object.hasOwn(parameter, "default"))
      assert(validate(parameter.default), `${label}: default fails its schema`);
  }
  ajv.compile(declaration.resultSchema);
  if (declaration.errorSchema !== undefined) ajv.compile(declaration.errorSchema);
}

export function generateCatalog() {
  const issue = load(bundleFile);
  const common = load(commonFile);
  const collisions = Object.keys(issue.$defs).filter((name) => Object.hasOwn(common.$defs, name));
  assert.deepEqual(collisions, [], "The Issue and common bundles share a definition name");
  const definitions = { ...common.$defs, ...issue.$defs };
  const sections = parseSections(readFileSync(resolve(root, documentFile), "utf8"));
  assert.equal(new Set(sections.map(({ name }) => name)).size, sections.length, "Duplicate name");
  const declarations = sections.map((section) =>
    declarationOf(section, definitions, common.$id, issue.$id),
  );
  for (const declaration of declarations) assertValidDeclaration(declaration);
  return {
    $comment:
      "Generated from specs/types/issue/callables.md and its issue-callables bundle under Issue K-7. Do not edit; run scripts/generate-callable-catalog.mjs.",
    declarations,
  };
}

function formatted(path, value) {
  return execFileSync(
    process.execPath,
    [resolve(root, "node_modules/@biomejs/biome/bin/biome"), "format", "--stdin-file-path", path],
    {
      cwd: root,
      input: `${serializeSchemaJSON(value)}\n`,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new Error("Usage: generate-callable-catalog.mjs [--check]");
  const bytes = formatted(catalogFile, generateCatalog());
  if (args[0] === "--check") {
    if (readFileSync(resolve(root, catalogFile), "utf8") !== bytes)
      throw new Error(`Generated drift: ${catalogFile}`);
  } else writeFileSync(resolve(root, catalogFile), bytes);
  console.log(
    args[0] === "--check"
      ? "Callable catalog regeneration matches."
      : "Generated Callable catalog.",
  );
}
