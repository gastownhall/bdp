import { createHash } from "node:crypto";

import { READ_VALUE_SCHEMA_REFS } from "@bdp/protocol";

import { canonicalJson, compareCodeUnits } from "./canonical-json.js";
import type { ExecutableScenarioManifest } from "./executable-manifest.js";

/**
 * The Read projection of the normative schema bundle (D29 = C, 2026-09-08).
 *
 * The sealed Read cohort records the SHA-256 of the whole bundle as
 * provenance, but the bundle is one file for every BDP profile: a later
 * profile adding its own envelopes moves that digest without changing
 * anything a Read implementation can observe. Recomputing the whole-bundle
 * digest would force a Read re-seal for every later-profile definition; not
 * recomputing it would let a Read-facing definition change ship on stale
 * evidence. The ruling binds the projection instead: the definitions
 * reachable by `$ref` from the Read-profile envelope roots, serialized as a
 * sub-bundle under RFC 8785 JCS and digested with SHA-256. A change to a
 * Read-reachable definition moves the digest and forces a re-seal; a
 * definition only a later profile reaches does not.
 *
 * Roots are derived, never hand-listed: the definitions the bound Read
 * manifest's `json-schema` assertions name, united with the definitions
 * `@bdp/protocol` parses Read values through (`READ_VALUE_SCHEMA_REFS`). The
 * manifest digest is already bound and the protocol table is the normative
 * parse surface, so the root list can only move when one of those moves.
 *
 * The walk fails closed. Every root and every reference must be a
 * bundle-local `#/$defs/<name>` pointer; a reference form the walk cannot
 * follow, a dangling reference, or an empty root set is an error rather than
 * a silently narrower projection. Over-inclusion is the safe direction — a
 * definition wrongly counted as reachable costs a re-seal, one wrongly
 * excluded costs the guarantee — so unknown keywords are descended into and
 * only instance-data keywords (`const`, `default`, `enum`, `examples`) are
 * treated as opaque values.
 */
export class ReadSchemaProjectionError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ReadSchemaProjectionError";
  }
}

export interface ReadSchemaProjection {
  /** The envelope roots the walk started from, sorted by code unit. */
  readonly roots: readonly string[];
  /** Every definition reachable from the roots, roots included, sorted by code unit. */
  readonly definitions: readonly string[];
  /**
   * RFC 8785 bytes of the sub-bundle: the bundle's `$schema` and `$id`
   * headers plus exactly the reachable `$defs`. The bundle's own `title` and
   * `description` are prose about the file, not Read-observable, and are
   * left out; a definition's own prose is part of that definition.
   */
  readonly bytes: Uint8Array;
  /** SHA-256 hex over `bytes`: the value a cohort segment binds as `schemaReadProjection`. */
  readonly digest: string;
}

const LOCAL_DEFINITION_REF = /^#\/\$defs\/([^/~]+)$/;

/** Instance data, never subschemas: a `$ref`-shaped object inside them is a value, not a reference. */
const INSTANCE_DATA_KEYWORDS = new Set(["const", "default", "enum", "examples"]);

/** Keywords whose value maps names to subschemas; the names are not keywords. */
const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

/** Reference forms the walk does not follow. Refusing them keeps the projection honest. */
const UNSUPPORTED_REFERENCE_KEYWORDS = new Set(["$dynamicRef", "$recursiveRef"]);

/**
 * The Read envelope roots, derived from the bound manifest and the protocol
 * parse table. Exported for the evidence gate and the generator, which must
 * both derive the same list from the same committed inputs.
 */
export function deriveReadSchemaProjectionRoots(
  manifest: ExecutableScenarioManifest,
  protocolSchemaRefs: readonly string[] = Object.values(READ_VALUE_SCHEMA_REFS),
): readonly string[] {
  const refs = new Set<string>(protocolSchemaRefs);
  for (const scenario of manifest.scenarios) {
    for (const site of [...(scenario.requests ?? []), ...(scenario.actions ?? [])]) {
      for (const assertion of site.assertions) {
        if (assertion.kind === "json-schema") refs.add(assertion.schema);
      }
    }
  }
  const names = new Set<string>();
  for (const ref of refs) names.add(definitionNameOf(ref, "Read envelope root"));
  if (names.size === 0) {
    throw new ReadSchemaProjectionError(
      "no Read envelope roots were derived; an empty root set would project nothing",
    );
  }
  return Object.freeze([...names].sort(compareCodeUnits));
}

/** Project the bundle onto the definitions reachable from `roots`, and digest it. */
export function projectReadSchemaBundle(
  bundle: unknown,
  roots: readonly string[],
): ReadSchemaProjection {
  const root = record(bundle, "schema bundle");
  const schema = requireString(root.$schema, "schema bundle $schema");
  const id = requireString(root.$id, "schema bundle $id");
  const defs = record(root.$defs, "schema bundle $defs");
  if (roots.length === 0) {
    throw new ReadSchemaProjectionError(
      "the Read projection needs at least one envelope root; an empty root set would project nothing",
    );
  }

  const reachable = new Set<string>();
  const pending: string[] = [];
  for (const name of roots) {
    if (!Object.hasOwn(defs, name)) {
      throw new ReadSchemaProjectionError(
        `Read envelope root '${name}' is not a definition of the bundle`,
      );
    }
    if (!reachable.has(name)) {
      reachable.add(name);
      pending.push(name);
    }
  }
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined) break;
    const refs = new Set<string>();
    collectReferences(defs[name], refs, `$defs/${name}`);
    for (const ref of refs) {
      const target = definitionNameOf(ref, `reference in $defs/${name}`);
      if (!Object.hasOwn(defs, target)) {
        throw new ReadSchemaProjectionError(
          `$defs/${name} references '${ref}', which the bundle does not define`,
        );
      }
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
    }
  }

  const definitions = Object.freeze([...reachable].sort(compareCodeUnits));
  const projected: Record<string, unknown> = {};
  for (const name of definitions) projected[name] = defs[name];
  const bytes = new TextEncoder().encode(
    canonicalJson({ $schema: schema, $id: id, $defs: projected }),
  );
  return Object.freeze({
    roots: Object.freeze([...new Set(roots)].sort(compareCodeUnits)),
    definitions,
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
  });
}

function collectReferences(node: unknown, into: Set<string>, path: string): void {
  if (Array.isArray(node)) {
    for (const [index, entry] of node.entries()) {
      collectReferences(entry, into, `${path}/${index}`);
    }
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === "$ref") {
      if (typeof value !== "string") {
        throw new ReadSchemaProjectionError(`${path}/$ref must be a string`);
      }
      into.add(value);
    } else if (UNSUPPORTED_REFERENCE_KEYWORDS.has(keyword)) {
      throw new ReadSchemaProjectionError(
        `${path}/${keyword} is a reference form the Read projection does not follow`,
      );
    } else if (INSTANCE_DATA_KEYWORDS.has(keyword)) {
      // A value, not a schema: nothing inside it can be a reference.
    } else if (SCHEMA_MAP_KEYWORDS.has(keyword)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        for (const [name, subschema] of Object.entries(value)) {
          collectReferences(subschema, into, `${path}/${keyword}/${name}`);
        }
      }
    } else {
      collectReferences(value, into, `${path}/${keyword}`);
    }
  }
}

function definitionNameOf(ref: string, label: string): string {
  const name = LOCAL_DEFINITION_REF.exec(ref)?.[1];
  if (name === undefined) {
    throw new ReadSchemaProjectionError(
      `${label} '${ref}' is not a bundle-local '#/$defs/<name>' reference; the Read projection follows only bundle-local definitions`,
    );
  }
  return name;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReadSchemaProjectionError(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReadSchemaProjectionError(`${label} must be a non-empty string`);
  }
  return value;
}
