/**
 * Gate helper: every generated `$def` must COMPILE in a real JSON Schema 2020-12
 * validator, not merely have resolvable `$ref` target names.
 *
 * check-generated.py's name-resolution pass cannot catch a degenerate cycle: a def
 * shaped `{"$ref": "#/$defs/Self"}` resolves by name and then blows the stack when a
 * validator tries to build it. That is exactly how an uncompilable `$defs/Resource`
 * (from `type Resource = rep<any>` lowering through `rep` -> `Resource`) shipped while
 * the gate reported "all $refs resolve".
 *
 * Ajv 2020 is used deliberately: it is what `packages/conformance` validates wire
 * payloads with, so "compiles here" means "usable by the conformance gate".
 *
 * Usage: node scripts/compile-generated-schemas.mjs [schemaDir]
 * Exits 0 with a one-line summary, or 1 listing every def that cannot be compiled.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const schemaDir = process.argv[2] ?? "specs/generated/schema";
const files = readdirSync(schemaDir)
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

if (files.length === 0) {
  console.error(`No *.schema.json bundles found in ${schemaDir}`);
  process.exit(1);
}

// One validator holding every bundle, keyed by bare filename, so the cross-bundle
// `<owner>.schema.json#/$defs/Name` form the generator emits resolves as written.
const ajv = new Ajv2020({ strict: false, allowUnionTypes: true, validateFormats: false });
const bundles = new Map();
for (const name of files) {
  const bundle = JSON.parse(readFileSync(path.join(schemaDir, name), "utf8"));
  bundles.set(name, bundle);
  // Drop any self-declared $id: the bare filename is the key the refs actually use.
  const { $id, ...rest } = bundle;
  ajv.addSchema(rest, name);
}

const failures = [];
let compiled = 0;
for (const [name, bundle] of bundles) {
  for (const defName of Object.keys(bundle.$defs ?? {})) {
    try {
      ajv.compile({ $ref: `${name}#/$defs/${defName}` });
      compiled += 1;
    } catch (error) {
      // A degenerate cycle surfaces as RangeError (stack overflow); a malformed
      // keyword surfaces as a plain Error. Both mean the def is unusable.
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}#/$defs/${defName}: ${message.split("\n")[0].slice(0, 160)}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `${failures.length} generated def(s) cannot be compiled by a JSON Schema 2020-12 validator:`,
  );
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`All ${compiled} generated defs compile across ${bundles.size} bundles (Ajv 2020-12).`);
