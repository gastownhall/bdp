import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseSchema } from "./markdown-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const profileSources = {
  common: [
    "specs/profiles/core/core.md",
    "specs/profiles/events/events.md",
    "specs/profiles/write/write.md",
  ],
  "id-root": ["specs/profiles/write/write.md"],
  types: ["specs/profiles/types/types.md"],
};
const bundlePaths = [
  "specs/profiles/core/bdp-v0.1.schema.json",
  "packages/protocol/schemas/bdp-v0.1.schema.json",
];
const ownershipKey = "x-bdp-schema-definitions";
const legacyOwnershipKey = "x-bdp-core-definitions";

// Delimiters are recognized only as complete lines outside fenced examples.
// The enclosed DSL is visible Markdown, not content hidden inside a comment.
export function extractSchemaFragments(markdown, bundleName = "common", allowEmpty = false) {
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
      !comment &&
      /^<!-- bdp-schema:(start|end) ([A-Za-z][A-Za-z0-9]*)(?: bundle=([a-z][a-z-]*))? -->$/.exec(
        line,
      );
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
    const [, action, name, qualifier = "common"] = marker;
    const key = `${qualifier}:${name}`;
    if (action === "start") {
      assert(!active, `Nested schema fragment at ${location}`);
      assert(!Object.hasOwn(definitions, key), `Duplicate schema fragment ${key}`);
      active = key;
      body = [];
    } else {
      assert(active === key, `Unmatched schema end ${name} at ${location}`);
      const heading = `### Schema: ${JSON.stringify(name)}`;
      assert(body[0] === heading, `Expected ${heading}`);
      const dsl = body
        .slice(1)
        .map((row) => row.replace(/^#### /, "### "))
        .join("\n")
        .trim();
      const standalone = `# ${JSON.stringify(name)}\n\nFormat: markdown-json-schema/0.6\n\n<a id="schema-root"></a>\n## Root schema\n\n${dsl}\n`;
      definitions[key] = parseSchema(standalone);
      active = null;
    }
  }
  assert(!fence, "Unclosed code fence");
  assert(!comment, "Unclosed HTML comment");
  assert(!active, `Unclosed schema fragment ${active}`);
  const selected = Object.fromEntries(
    Object.entries(definitions)
      .filter(([key]) => key.startsWith(`${bundleName}:`))
      .map(([key, schema]) => [key.slice(bundleName.length + 1), schema]),
  );
  assert(allowEmpty || Object.keys(selected).length, "No schema fragments found");
  return selected;
}

export function checkFragments(definitions, bundle) {
  const names = Object.keys(definitions).sort();
  const owned = bundle[ownershipKey] ?? bundle[legacyOwnershipKey];
  assert(
    Array.isArray(owned) && owned.every((name) => typeof name === "string"),
    "Missing schema definition ownership inventory",
  );
  assert(
    isDeepStrictEqual([...owned].sort(), names),
    "Schema source/ownership inventory differs; removal or rename requires explicit migration",
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
  const previous = bundle[ownershipKey] ?? bundle[legacyOwnershipKey] ?? [];
  assert(Array.isArray(previous), "Malformed schema ownership inventory");
  for (const name of previous)
    assert(
      Object.hasOwn(definitions, name),
      `Removed schema definition ${name}; explicit migration required`,
    );
  const output = structuredClone(bundle);
  Object.assign(output.$defs, definitions);
  delete output[legacyOwnershipKey];
  output[ownershipKey] = Object.keys(definitions).sort();
  const bytes = `${serializeSchemaJSON(output)}\n`;
  checkFragments(definitions, JSON.parse(bytes));
  return bytes;
}

export function collectProfileFragments(
  bundleName,
  reader = (path) => readFileSync(resolve(root, path), "utf8"),
) {
  assert(Object.hasOwn(profileSources, bundleName), "Unknown schema bundle");
  const definitions = {};
  const sources = {};
  for (const path of profileSources[bundleName]) {
    const fragments = extractSchemaFragments(reader(path), bundleName, true);
    assert(Object.keys(fragments).length, `No ${bundleName} fragments in ${path}`);
    sources[path] = Object.keys(fragments).sort();
    for (const [name, schema] of Object.entries(fragments)) {
      assert(!Object.hasOwn(definitions, name), `Duplicate profile definition ${name}`);
      definitions[name] = schema;
    }
  }
  return { definitions, sources };
}

export function prepareProfileBundle(definitions, sources, bundle, migrate = false) {
  const oldSources = bundle["x-bdp-schema-sources"];
  assert(
    migrate || isDeepStrictEqual(oldSources, sources),
    "Source ownership changed; use explicit --migrate-ownership",
  );
  const owned = bundle[ownershipKey] ?? [];
  for (const [name, schema] of Object.entries(definitions))
    if (Object.hasOwn(bundle.$defs, name) && (migrate || !owned.includes(name)))
      assert(isDeepStrictEqual(bundle.$defs[name], schema), `Adoption changes schema: ${name}`);
  const prepared = JSON.parse(prepareBundle(definitions, bundle));
  prepared["x-bdp-schema-sources"] = sources;
  return `${serializeSchemaJSON(prepared)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  assert(
    args.length === 1 && ["--check", "--write", "--migrate-ownership"].includes(args[0]),
    "Use --check, --write or --migrate-ownership",
  );
  const configs = [
    ["common", bundlePaths],
    ["id-root", ["specs/profiles/write/id-root-v1.schema.json"]],
    ["types", ["specs/profiles/types/types-v1.schema.json"]],
  ];
  const outputs = [];
  for (const [bundleName, paths] of configs) {
    const { definitions, sources } = collectProfileFragments(bundleName);
    for (const path of paths) {
      const bundle = JSON.parse(readFileSync(resolve(root, path), "utf8"));
      if (args[0] !== "--check") {
        // Every previously authored name must survive the ownership migration.
        // Refuse semantic drift during initial adoption of an existing definition.
        outputs.push([
          path,
          prepareProfileBundle(definitions, sources, bundle, args[0] === "--migrate-ownership"),
        ]);
      } else {
        assert(
          !Object.hasOwn(bundle, legacyOwnershipKey),
          "Legacy ownership requires explicit --write migration",
        );
        checkFragments(definitions, bundle);
        assert(
          isDeepStrictEqual(bundle["x-bdp-schema-sources"], sources),
          "Schema source ownership differs",
        );
      }
    }
    console.log(`${Object.keys(definitions).length} ${bundleName} schema fragments checked.`);
  }
  // Validate every bundle before the first write; the two shared copies must agree.
  if (args[0] !== "--check") {
    const sharedOutputs = outputs.filter(([path]) => bundlePaths.includes(path));
    assert(
      sharedOutputs.length === bundlePaths.length &&
        sharedOutputs.every(([, bytes]) => bytes === sharedOutputs[0][1]),
      "Shared schema distribution mismatch",
    );
    for (const [path, bytes] of outputs) writeFileSync(resolve(root, path), bytes);
  } else
    assert(
      readFileSync(resolve(root, bundlePaths[0]), "utf8") ===
        readFileSync(resolve(root, bundlePaths[1]), "utf8"),
      "Shared schema distribution mismatch",
    );
  console.log("Schema-shape parity is not implementation conformance.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
