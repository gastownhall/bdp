import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseSchema } from "./markdown-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "specs/profiles/core/core.md";
const bundlePaths = [
  "specs/profiles/core/bdp-v0.1.schema.json",
  "packages/protocol/schemas/bdp-v0.1.schema.json",
];
const ownershipKey = "x-bdp-core-definitions";

// Delimiters are recognized only as complete lines outside fenced examples.
// The enclosed DSL is visible Markdown, not content hidden inside a comment.
export function extractSchemaFragments(markdown) {
  const definitions = {};
  let active = null;
  let fence = null;
  let body = [];
  let comment = false;
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const location = `line ${index + 1}`;
    if (fence) {
      if (active) body.push(line);
      const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
      if (close.test(line)) fence = null;
      continue;
    }
    const opening = !comment && /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      fence = opening[1];
      if (active) body.push(line);
      continue;
    }
    const marker =
      !comment && /^<!-- bdp-schema:(start|end) ([A-Za-z][A-Za-z0-9]*) -->$/.exec(line);
    if (!marker) {
      if (!comment)
        assert(!/^\s*<!--\s*bdp-schema:/.test(line), `Malformed schema delimiter at ${location}`);
      // Walk every comment transition, preserving literal inline-code strings.
      let ticks = 0;
      for (let i = 0; i < line.length; ) {
        if (comment) {
          const end = line.indexOf("-->", i);
          if (end < 0) break;
          comment = false;
          i = end + 3;
        } else if (line[i] === "`") {
          const run = /^`+/.exec(line.slice(i))[0].length;
          if (!ticks) ticks = run;
          else if (ticks === run) ticks = 0;
          i += run;
        } else if (!ticks && line.startsWith("<!--", i)) {
          comment = true;
          i += 4;
        } else i++;
      }
      if (active) body.push(line);
      continue;
    }
    const [, action, name] = marker;
    if (action === "start") {
      assert(!active, `Nested schema fragment at ${location}`);
      assert(!Object.hasOwn(definitions, name), `Duplicate schema fragment ${name}`);
      active = name;
      body = [];
    } else {
      assert(active === name, `Unmatched schema end ${name} at ${location}`);
      const heading = `### Schema: ${JSON.stringify(name)}`;
      assert(body[0] === heading, `Expected ${heading}`);
      const dsl = body
        .slice(1)
        .map((row) => row.replace(/^#### /, "### "))
        .join("\n")
        .trim();
      const standalone = `# ${JSON.stringify(name)}\n\nFormat: markdown-json-schema/0.6\n\n<a id="schema-root"></a>\n## Root schema\n\n${dsl}\n`;
      definitions[name] = parseSchema(standalone);
      active = null;
    }
  }
  assert(!fence, "Unclosed code fence");
  assert(!comment, "Unclosed HTML comment");
  assert(!active, `Unclosed schema fragment ${active}`);
  assert(Object.keys(definitions).length, "No schema fragments found");
  return definitions;
}

export function checkFragments(definitions, bundle) {
  const names = Object.keys(definitions).sort();
  const owned = bundle[ownershipKey];
  assert(
    Array.isArray(owned) && owned.every((name) => typeof name === "string"),
    "Missing Core definition ownership inventory",
  );
  assert(
    isDeepStrictEqual([...owned].sort(), names),
    "Core source/ownership inventory differs; removal or rename requires explicit migration",
  );
  for (const [name, schema] of Object.entries(definitions)) {
    assert(Object.hasOwn(bundle.$defs, name), `Missing generated definition ${name}`);
    assert(isDeepStrictEqual(bundle.$defs[name], schema), `Generated definition differs: ${name}`);
  }
}

// JSON.stringify changes supported parsed -0 into 0. Preserve that value just
// as the existing lossless Markdown codec does, including inside annotations.
export function serializeSchemaJSON(value, depth = 0) {
  assert(depth <= 128, "JSON nesting exceeds 128");
  if (value === null || typeof value !== "object") {
    assert(
      value === null || ["string", "number", "boolean"].includes(typeof value),
      "Invalid JSON value",
    );
    if (typeof value === "number") assert(Number.isFinite(value), "Nonfinite JSON number");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  const indent = "  ".repeat(depth);
  const next = `${indent}  `;
  if (Array.isArray(value))
    return value.length
      ? `[\n${value.map((item) => next + serializeSchemaJSON(item, depth + 1)).join(",\n")}\n${indent}]`
      : "[]";
  const entries = Object.entries(value);
  return entries.length
    ? `{\n${entries.map(([key, item]) => `${next}${JSON.stringify(key)}: ${serializeSchemaJSON(item, depth + 1)}`).join(",\n")}\n${indent}}`
    : "{}";
}

export function prepareBundle(definitions, bundle) {
  const previous = bundle[ownershipKey] ?? [];
  assert(Array.isArray(previous), "Malformed Core ownership inventory");
  for (const name of previous)
    assert(
      Object.hasOwn(definitions, name),
      `Removed Core definition ${name}; explicit migration required`,
    );
  const output = structuredClone(bundle);
  Object.assign(output.$defs, definitions);
  output[ownershipKey] = Object.keys(definitions).sort();
  const bytes = `${serializeSchemaJSON(output)}\n`;
  checkFragments(definitions, JSON.parse(bytes));
  return bytes;
}

function main() {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ["--check", "--write"].includes(args[0]), "Use --check or --write");
  const definitions = extractSchemaFragments(readFileSync(resolve(root, sourcePath), "utf8"));
  const bundles = bundlePaths.map((path) => JSON.parse(readFileSync(resolve(root, path), "utf8")));
  if (args[0] === "--write") {
    // Validate both complete outputs before the first write. Other profiles'
    // definitions preserve their parsed meaning, including negative zero.
    const outputs = bundles.map((bundle) => prepareBundle(definitions, bundle));
    for (const [i, path] of bundlePaths.entries()) writeFileSync(resolve(root, path), outputs[i]);
  }
  for (const path of bundlePaths)
    checkFragments(definitions, JSON.parse(readFileSync(resolve(root, path), "utf8")));
  console.log(
    `${Object.keys(definitions).length} Core schema fragments match both distribution copies.`,
  );
  console.log("Schema-shape parity is not implementation conformance.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
