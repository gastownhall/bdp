# Read schema projection gate (D29 = C)

**Decision.** Ruled 2026-09-08 by the operator as D29 = C: the sealed Read
conformance cohort binds the digest of the **Read-reachable projection** of
the normative schema bundle, and `pnpm evidence:verify` recomputes that digest
from the committed tree and refuses drift. A change to a Read-reachable
definition forces a re-seal; a definition only a later profile reaches does
not.

This document is the decision record. The evidence law lives in
[`packages/conformance/matrices/README.md`](../../packages/conformance/matrices/README.md);
if the two disagree, the law governs and this record must be corrected.

## Problem

`schemas/bdp-v0.schema.json` is one bundle for every BDP profile: the
specification adds each later profile's definitions to the same file before
that profile is implemented. The cohort artifact recorded the SHA-256 of the
whole bundle at the seal (`bindings.schema`), but the gate checked that value
for format only. That left two bad options:

- **A — recompute the whole-bundle digest.** Every later-profile definition
  would close the Read cohort and force a packaged re-run that observes no
  Read change.
- **B — keep the digest informational.** A Read-facing definition could
  change and ship on evidence sealed against the old definition, and nothing
  in the tree would say so.

## Rule (option C)

1. **Projection.** The set of `$defs` reachable by `$ref`, transitively, from
   the Read envelope roots. It is serialized as a sub-bundle holding the
   bundle's `$schema` and `$id` plus exactly those `$defs`, canonicalized
   under RFC 8785 (JCS) so member order and whitespace cannot move it, and
   digested with SHA-256. The bundle's own `title` and `description` are
   outside the projection; a definition's own prose is inside it.
2. **Roots, derived.** The union of (a) the definitions the bound Read
   manifest's `json-schema` assertions name, at every request and action
   assertion site, and (b) the definitions `@bdp/protocol` parses Read values
   through, exported as `READ_VALUE_SCHEMA_REFS`. Neither is a hand-kept list:
   the manifest digest is already bound by the cohort, and the protocol table
   is the normative Read parse surface, so the roots move only when one of
   those moves — and both moves are Read changes.
3. **Walk.** Reference collection descends every applicator — `properties`,
   `patternProperties`, `dependentSchemas`, `items`, `prefixItems`,
   `contains`, `additionalProperties`, `propertyNames`, `anyOf`, `allOf`,
   `oneOf`, `not`, `if`/`then`/`else`, nested `$defs`, and any unknown
   keyword — and treats only the instance-data keywords `const`, `default`,
   `enum`, and `examples` as opaque values. Over-inclusion is the safe
   direction: a definition wrongly counted as reachable costs a re-seal, one
   wrongly excluded costs the guarantee. The walk fails closed: a reference
   that is not a bundle-local `#/$defs/<name>` pointer, a `$dynamicRef`, a
   dangling reference, a root the bundle does not define, or an empty root
   set is an error, never a narrower projection.
4. **Binding.** Every cohort segment records `bindings.schemaReadProjection`.
   `bindings.schema`, the whole-bundle digest, stays recorded as provenance
   and is checked for format only.
5. **Verification.** The gate derives the roots from the committed manifest
   and the protocol table, projects the committed bundle, and fails with
   `Read-reachable schema drift: re-seal required` when any segment binds a
   different digest. The generator records the same value at generation.

Implementation: `packages/conformance/src/schema-read-projection.ts`
(`deriveReadSchemaProjectionRoots`, `projectReadSchemaBundle`),
`packages/conformance/src/canonical-json.ts` (the one RFC 8785 serializer,
shared with the artifact's canonical bytes), the verifier in
`packages/conformance/src/cohort-verification.ts`, and the gate script
`scripts/read-cohort-evidence.mjs`, which now also requires the bundle to be
committed state.

## At the ruling

Bundle `schemas/bdp-v0.schema.json` at SHA-256
`552329e6b4a42adfc2643dc92e52403cfad5bd5e4474a25d4f0edbc12968417d` (the
value every sealed segment records as `bindings.schema`), 26 definitions.

Roots (10): `beadCollection`, `beadRecord`, `linkCollection`, `linkRecord`,
`properties`, `readDiscovery`, `readProblem`, `typeDescriptor`, `typeSummary`,
`typesInventory`. Eight come from the manifest's `json-schema` assertions;
`typeDescriptor` and `typeSummary` come from the protocol table, because the
descriptor row is driven through the public client and the manifest carries
no `json-schema` assertion for it.

Projection: 25 of 26 definitions. `protocolProfile` is the one definition
nothing in Read references — `readDiscovery.profile` is the constant `read` —
so an enum member a later profile adds there does not force a Read re-seal.

Digest: `37ac8d527909947e210d97433ae50468e20f28bfcc4e05c3cc19ef61c1e24a13`,
recorded as `bindings.schemaReadProjection` on all four sealed segments and
cross-checked by an independent computation of the same rule.

## Re-seal procedure

When `pnpm evidence:verify` reports `Read-reachable schema drift: re-seal
required`, the Read surface changed and the observations must be redone: run
`pnpm evidence:generate` on a clean, built tree per the evidence law, record
the printed constant in `packages/server/src/read-conformance-capability.ts`,
and commit the artifact and constant together with nothing else in that
commit. The generator records `schemaReadProjection` itself; nothing is
hand-edited.

## The one-time binding-format migration

The sealed artifact predated the binding. It was migrated once — the
observations sealed at run head `0a928bac442be0e1567186737af1db9a90c0240d`
are unchanged — by adding `schemaReadProjection` to each of its four segments'
bindings and recomputing the evidence constant the way the tooling does
(`readCohortEvidenceConstant` over the canonical bytes). This is a
binding-format migration, not new evidence and not a re-seal: the added value
is a pure function of the bundle bytes the seal already pinned
(`bindings.schema` is the SHA-256 of the bundle at the run head, and that
bundle is byte-identical to the one projected), and no row, exchange, score,
or other binding changed.

The evidence law confines the delta from the run head to the evidence
commit — the most recent commit touching the artifact or the constant — to
those two paths. A migration commit therefore has to be parented on the
sealed evidence commit, whose tree is the run head's plus the evidence, and
merged into the branch with a merge commit — never rebased or squashed, which
would place unrelated changes inside the confined delta. That is exactly the
topology the original seal commit has relative to the run head, and the gate
proves it the same way: ancestry, delta confinement, canonical bytes, and the
constant. A reviewer confirms the migration changed nothing else with
`git diff <sealed evidence commit> <migration commit>`.

## Non-goals

- No conformance claim, observation, row, or score changed.
- The specification is unchanged; the projection is evidence discipline, not
  protocol.
- The whole-bundle digest is not retired: it remains the provenance record of
  the exact file the run observed.
