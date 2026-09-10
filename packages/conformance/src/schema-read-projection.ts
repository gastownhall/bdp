import { createHash } from "node:crypto";

import { HISTORY_VALUE_SCHEMA_REFS, READ_VALUE_SCHEMA_REFS } from "@bdp/protocol";

import { canonicalJson, compareCodeUnits } from "./canonical-json.js";
import type { ExecutableScenarioManifest } from "./executable-manifest.js";

/**
 * The Read projection of the normative schema bundle (D29 = C, 2026-09-08;
 * projection rule RP1, 2026-09-08).
 *
 * The sealed Read cohort records the SHA-256 of the whole bundle as
 * provenance, but the bundle is one file for every BDP profile: a later
 * profile adding its own envelopes moves that digest without changing
 * anything a Read implementation can observe. Recomputing the whole-bundle
 * digest would force a Read re-seal for every later-profile definition; not
 * recomputing it would let a Read-facing definition change ship on stale
 * evidence. D29 = C binds a projection of the bundle instead, and RP1 fixes
 * what that projection is: the sealed definition set, by name — the `$defs`
 * names the bundle carried at the seal commit, `READ_SCHEMA_SEALED_DEFINITIONS`
 * below — as the RFC 8785 JCS text of the `[name, definition]` pairs in the
 * sealed order, digested with SHA-256. A change to the text of any sealed
 * definition moves the digest and forces a re-seal. Nothing else does:
 * top-level bundle metadata (`$schema`, `$id`, `title`, `description`,
 * anything outside `$defs`), definitions the seal does not name, member
 * order, and whitespace are all outside the digest, and a sealed definition
 * that later becomes reachable from the Read roots, or stops being, changes
 * nothing.
 *
 * RP1 replaced the reachable closure from the Read roots as the selection
 * rule. Reachability drifts silently: at the ruling the closure held 25 of
 * the 26 sealed definitions, because `protocolProfile` is sealed but nothing
 * in Read references it (`readDiscovery.profile` is the constant `read`), so
 * a token added to that enum would have shipped on evidence sealed against
 * the old enum with nothing in the tree saying so. A checked-in name list
 * cannot drift: every listed name is present or the projection fails, and
 * every edit to the list moves the digest.
 *
 * The Read roots — the definitions the bound manifest's `json-schema`
 * assertions name, united with the definitions `@bdp/protocol` parses Read
 * values through (`READ_VALUE_SCHEMA_REFS` and `HISTORY_VALUE_SCHEMA_REFS`) — are still derived, never
 * hand-listed, but they no longer select anything. They are the coverage
 * check: every definition reachable from them must be sealed, so the Read
 * surface cannot widen onto a definition the seal does not cover — a new root,
 * or a new reference from a sealed definition — without the gate saying so.
 * The walk fails closed: a reference form it cannot follow, a dangling
 * reference, a root the bundle does not define, or an empty root set is an
 * error, never a narrower check. Over-inclusion is the safe direction, so
 * unknown keywords are descended into and only instance-data keywords
 * (`const`, `default`, `enum`, `examples`) are treated as opaque values.
 */
export class ReadSchemaProjectionError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ReadSchemaProjectionError";
  }
}

/**
 * RP1 (2026-09-08): the sealed definition set, by name, in sealed order.
 *
 * The original 26 names below are the `$defs` of `schemas/bdp-v0.schema.json` at seal commit
 * 0b7d86e7cfec47f88cd1ec22314a73f39763bcf8 — whole-bundle SHA-256
 * 552329e6b4a42adfc2643dc92e52403cfad5bd5e4474a25d4f0edbc12968417d, the value
 * the historical cohort records as `bindings.schema` — in the order that bundle
 * declares them. The approved 2026-09-09 successor appends
 * `ownedWildcardDeclaration` as name27 before new observations. The approved
 * History wire integration appends the 15 named Read-side definitions below;
 * its parser roots join coverage, while write-only roots remain excluded.
 * This extends schema coverage, not History runtime or capability admission.
 * `protocolProfile` is included: the seal covers what the
 * bundle held, not what Read happened to reach.
 *
 * The projection digest is a function of this list and the named definitions'
 * text alone, so the list is part of the seal: a name removed, added, or
 * reordered here moves the digest exactly as a definition change does, and the
 * cohort closes until re-sealed. Extend it, before the run head, in the Read
 * change that makes the gate report a definition Read reaches that the seal
 * does not cover.
 */
export const READ_SCHEMA_SEALED_DEFINITIONS: readonly string[] = Object.freeze([
  "absoluteHttpUrl",
  "absoluteUri",
  "bdpVersion",
  "protocolProfile",
  "retryDisposition",
  "readProblemCode",
  "readProblem",
  "typeIdArray",
  "endpointConstraint",
  "typeDescriptor",
  "typeSummary",
  "typesInventory",
  "properties",
  "beadRecord",
  "linkRecord",
  "beadCollection",
  "linkCollection",
  "positiveInteger",
  "iso8601Duration",
  "advertisedLimits",
  "maximumEndpointMultiplicityPolicy",
  "readDiscovery",
  "reference",
  "pinnedReference",
  "ownedLinkDeclaration",
  "attribution",
  "ownedWildcardDeclaration",
  "changeContext",
  "contextMessage",
  "contextString",
  "contextTime",
  "dateTime",
  "historicalBeadRecord",
  "historicalLinkRecord",
  "historyCapability",
  "historyMissing",
  "historyMissingItem",
  "historyVersionRow",
  "historyVersionsPage",
  "historyWindow",
  "jsonPointer",
  "revision",
]);

export interface ReadSchemaProjection {
  /** The sealed definition names, in the fixed sealed order the digest is computed in. */
  readonly definitions: readonly string[];
  /** The Read envelope roots the coverage walk started from, sorted by code unit. */
  readonly roots: readonly string[];
  /** Every definition reachable from the roots, roots included, sorted by code unit. Each is sealed. */
  readonly reachable: readonly string[];
  /**
   * RFC 8785 bytes of the projection: the JSON array of `[name, definition]`
   * pairs, one per sealed definition, in sealed order. Nothing outside the
   * bundle's `$defs` is in it; a definition's own prose is part of that
   * definition.
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

/** Reference forms the walk does not follow. Refusing them keeps the coverage check honest. */
const UNSUPPORTED_REFERENCE_KEYWORDS = new Set(["$dynamicRef", "$recursiveRef"]);

/**
 * The Read envelope roots, derived from the bound manifest and the protocol
 * parse table. Exported for the evidence gate and the generator, which must
 * both derive the same list from the same committed inputs.
 */
export function deriveReadSchemaProjectionRoots(
  manifest: ExecutableScenarioManifest,
  protocolSchemaRefs: readonly string[] = [
    ...Object.values(READ_VALUE_SCHEMA_REFS),
    ...Object.values(HISTORY_VALUE_SCHEMA_REFS),
  ],
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
      "no Read envelope roots were derived; an empty root set would check nothing",
    );
  }
  return Object.freeze([...names].sort(compareCodeUnits));
}

/**
 * Project the bundle onto the sealed definition set and digest it, after
 * checking that every definition Read reaches from `roots` is sealed.
 */
export function projectReadSchemaBundle(
  bundle: unknown,
  roots: readonly string[],
  sealed: readonly string[] = READ_SCHEMA_SEALED_DEFINITIONS,
): ReadSchemaProjection {
  const root = record(bundle, "schema bundle");
  const defs = record(root.$defs, "schema bundle $defs");

  // The seal: every listed name must be present, once. A sealed definition
  // the bundle no longer carries cannot be digested, and the projection must
  // not quietly shrink to the names that remain.
  if (sealed.length === 0) {
    throw new ReadSchemaProjectionError(
      "the sealed definition set is empty; an empty set would project nothing",
    );
  }
  const sealedSet = new Set<string>();
  for (const name of sealed) {
    if (sealedSet.has(name)) {
      throw new ReadSchemaProjectionError(
        `sealed definition '${name}' is listed more than once in the sealed definition set`,
      );
    }
    if (!Object.hasOwn(defs, name)) {
      throw new ReadSchemaProjectionError(
        `sealed definition '${name}' is missing from the bundle; a sealed definition cannot be removed or renamed without a re-seal`,
      );
    }
    sealedSet.add(name);
  }

  // Coverage: everything Read reaches must be sealed. The roots and the walk
  // select nothing; they prove the seal still covers the Read surface.
  if (roots.length === 0) {
    throw new ReadSchemaProjectionError(
      "the Read projection needs at least one envelope root; an empty root set would check nothing",
    );
  }
  const reachedVia = new Map<string, string>();
  const pending: string[] = [];
  for (const name of roots) {
    if (!Object.hasOwn(defs, name)) {
      throw new ReadSchemaProjectionError(
        `Read envelope root '${name}' is not a definition of the bundle`,
      );
    }
    if (!reachedVia.has(name)) {
      reachedVia.set(name, "a Read envelope root");
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
      if (!reachedVia.has(target)) {
        reachedVia.set(target, `referenced from $defs/${name}`);
        pending.push(target);
      }
    }
  }
  const reachable = Object.freeze([...reachedVia.keys()].sort(compareCodeUnits));
  for (const name of reachable) {
    if (!sealedSet.has(name)) {
      throw new ReadSchemaProjectionError(
        `Read reaches $defs/${name} (${reachedVia.get(name)}), which the sealed definition set does not include; extend READ_SCHEMA_SEALED_DEFINITIONS in the Read change and re-seal`,
      );
    }
  }

  const bytes = new TextEncoder().encode(canonicalJson(sealed.map((name) => [name, defs[name]])));
  return Object.freeze({
    definitions: Object.freeze([...sealed]),
    roots: Object.freeze([...new Set(roots)].sort(compareCodeUnits)),
    reachable,
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
