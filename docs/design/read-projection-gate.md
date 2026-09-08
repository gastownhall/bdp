# Read schema projection gate (D29 = C, projection rule RP1)

**Decision.** Ruled 2026-09-08 by the operator as D29 = C: the sealed Read
conformance cohort binds the digest of a **projection** of the normative
schema bundle, and `pnpm evidence:verify` recomputes that digest from the
committed tree and refuses drift. Ruled the same day as **RP1** (option a):
the projection is the **sealed definition set, by name** — the 26 `$defs`
names the bundle carried at seal commit
`0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`, `protocolProfile` included — not
the closure reachable from the Read roots, and top-level bundle metadata is
outside the digest. A change to the text of any sealed definition forces a
re-seal; a definition the seal does not name, or the bundle's metadata, does
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

## Rule (option C, as fixed by RP1)

1. **Projection.** The sealed definition set, by name:
   `READ_SCHEMA_SEALED_DEFINITIONS` in
   `packages/conformance/src/schema-read-projection.ts`, the 26 `$defs` names
   of `schemas/bdp-v0.schema.json` at seal commit `0b7d86e7`, in the order
   that bundle declares them. The projection's bytes are the JSON array of
   `[name, definition]` pairs in that order, canonicalized under RFC 8785
   (JCS) so member order and whitespace cannot move it; the digest is SHA-256
   over those bytes. Only the text of the sealed definitions is inside the
   digest, and a definition's own prose is part of its text. Outside it:
   top-level bundle metadata — `$schema`, `$id`, `title`, `description`,
   anything outside `$defs` — every definition the list does not name, and
   whether a sealed definition is reachable from Read.
2. **The list is part of the seal.** Every listed name must be present in the
   bundle, once, or the projection fails: a sealed definition removed or
   renamed is an error, never a narrower projection. Any edit to the list — a
   name added, dropped, or reordered — moves the digest exactly as a
   definition change does. The list is a verification input like the bundle
   and the manifest: it is extended before the run head, in the Read change
   that needs it, never in the evidence commit.
3. **Roots, derived — the coverage check.** The union of (a) the definitions
   the bound Read manifest's `json-schema` assertions name, at every request
   and action assertion site, and (b) the definitions `@bdp/protocol` parses
   Read values through, exported as `READ_VALUE_SCHEMA_REFS`. Neither is a
   hand-kept list. The roots select nothing: the projection walks the bundle
   from them and fails if any definition Read reaches is not sealed, so the
   Read surface cannot widen onto a definition the seal does not cover — a
   new root, or a new reference from a sealed definition — without the gate
   saying so. The fix is to extend the sealed list in that Read change and
   re-seal.
4. **Walk.** Reference collection descends every applicator — `properties`,
   `patternProperties`, `dependentSchemas`, `items`, `prefixItems`,
   `contains`, `additionalProperties`, `propertyNames`, `anyOf`, `allOf`,
   `oneOf`, `not`, `if`/`then`/`else`, nested `$defs`, and any unknown
   keyword — and treats only the instance-data keywords `const`, `default`,
   `enum`, and `examples` as opaque values. Over-inclusion is the safe
   direction for a coverage check. The walk fails closed: a reference that is
   not a bundle-local `#/$defs/<name>` pointer, a `$dynamicRef`, a dangling
   reference, a root the bundle does not define, or an empty root set is an
   error, never a narrower check.
5. **Binding.** Every cohort segment records `bindings.schemaReadProjection`.
   `bindings.schema`, the whole-bundle digest, stays recorded as provenance
   and is checked for format only, because later-profile definitions and
   top-level metadata legitimately move it.
6. **Verification.** The gate projects the committed bundle over the sealed
   list, after the coverage check, and fails with
   `Read schema projection drift: re-seal required` when any segment binds a
   different digest. The generator records the same value at generation.

Implementation: `packages/conformance/src/schema-read-projection.ts`
(`READ_SCHEMA_SEALED_DEFINITIONS`, `deriveReadSchemaProjectionRoots`,
`projectReadSchemaBundle`), `packages/conformance/src/canonical-json.ts`
(the one RFC 8785 serializer, shared with the artifact's canonical bytes),
the verifier in `packages/conformance/src/cohort-verification.ts`, and the
gate script `scripts/read-cohort-evidence.mjs`, which also requires the
bundle to be committed state. The sealed list, the committed bundle's digest,
and the rule that metadata does not move it are pinned by
`packages/conformance/src/schema-read-projection.test.ts` and, at the gate,
by `scripts/read-cohort-evidence.test.mjs`.

## RP1: the projection is the sealed set by name (ruled 2026-09-08)

**Found.** Review of the D29 = C gate as first implemented — the closure
reachable by `$ref` from the derived Read roots, serialized with the bundle's
`$schema` and `$id` — found two things.

- The closure held 25 definitions, not the 26 sealed at `0b7d86e7`.
  `protocolProfile` is sealed but unreachable: `readDiscovery.profile` is the
  constant `read`, and nothing else in Read references the enum. A token a
  later profile adds to that enum is a change to a definition the seal
  covers, yet it would not have moved the digest, so it would have shipped on
  evidence sealed against the old enum with nothing in the tree saying so.
- The bundle's top-level `description` had changed since the seal in a
  sibling worktree carrying later-profile work, while every sealed definition
  there was byte-identical to `0b7d86e7`. The closure rule left `title` and
  `description` out but kept `$schema` and `$id` in; whether metadata was
  inside the digest was a property of the serialization, not a stated rule.

**Ruled (option a).** The projection the gate binds is the sealed definition
set by name — the 26 `$defs` names present in the bundle at `0b7d86e7`,
`protocolProfile` included — not the reachable closure from the Read roots.
Top-level bundle metadata (`description`, `$id`, `$schema`, `title`, anything
outside `$defs`) is outside the digest. The digest is computed over those 26
definitions' canonical JSON text in a fixed, documented order: the sealed
order of the names, which at the ruling is also the bundle's prefix.

**Why.** A name list cannot drift silently: every listed name is present or
the projection fails, and every edit to the list moves the digest.
Reachability can: the set it selects is a function of the walk, the roots,
and every `$ref` in the bundle, so it narrows or widens with edits that are
not Read changes, and it leaves a sealed definition uncovered without anyone
deciding that. The seal covers what the bundle held, not what Read happened
to reach. Reachability is kept for the one thing it is good for — checking
that the seal still covers everything Read reaches — where a false alarm
costs a list edit and a miss is impossible without a digest change.

## At the ruling

Bundle `schemas/bdp-v0.schema.json` at SHA-256
`552329e6b4a42adfc2643dc92e52403cfad5bd5e4474a25d4f0edbc12968417d` (the
value every sealed segment records as `bindings.schema`; byte-identical at
the run head, at the seal commit, and at the RP1 ruling), 26 definitions,
sealed in this order: `absoluteHttpUrl`, `absoluteUri`, `bdpVersion`,
`protocolProfile`, `retryDisposition`, `readProblemCode`, `readProblem`,
`typeIdArray`, `endpointConstraint`, `typeDescriptor`, `typeSummary`,
`typesInventory`, `properties`, `beadRecord`, `linkRecord`,
`beadCollection`, `linkCollection`, `positiveInteger`, `iso8601Duration`,
`advertisedLimits`, `maximumEndpointMultiplicityPolicy`, `readDiscovery`,
`reference`, `pinnedReference`, `ownedLinkDeclaration`, `attribution`.

Roots (10): `beadCollection`, `beadRecord`, `linkCollection`, `linkRecord`,
`properties`, `readDiscovery`, `readProblem`, `typeDescriptor`, `typeSummary`,
`typesInventory`. Eight come from the manifest's `json-schema` assertions;
`typeDescriptor` and `typeSummary` come from the protocol table, because the
descriptor row is driven through the public client and the manifest carries
no `json-schema` assertion for it. Reachable from them: 25 of the 26 sealed
definitions, `protocolProfile` being the one nothing in Read references.
Every reachable definition is sealed, so the coverage check passes.

Digest (RP1):
`801728f8de54fb27367123e4dc7db865401596ad936e3f52b0b7e29e1808f14e`, recorded
as `bindings.schemaReadProjection` on all four sealed segments and
cross-checked by an independent computation of the same rule (a from-scratch
sorted-key serializer over the same 26 names in the same order). The closure
digest it replaces was
`37ac8d527909947e210d97433ae50468e20f28bfcc4e05c3cc19ef61c1e24a13` (25
definitions plus the `$schema`/`$id` header).

## Re-seal procedure

When `pnpm evidence:verify` reports `Read schema projection drift: re-seal
required`, the text of a sealed definition changed and the observations must
be redone: run `pnpm evidence:generate` on a clean, built tree per the
evidence law, record the printed constant in
`packages/server/src/read-conformance-capability.ts`, and commit the artifact
and constant together with nothing else in that commit. When the gate instead
reports that Read reaches a definition the sealed set does not include, or
that a sealed definition is missing from the bundle, the sealed list must
change first: edit `READ_SCHEMA_SEALED_DEFINITIONS` in the Read change
itself, before the run head, then re-seal. The generator records
`schemaReadProjection` itself; nothing is hand-edited.

## The binding-format migrations

The sealed artifact predated the binding. It was migrated twice, without a
re-run; the observations sealed at run head
`0a928bac442be0e1567186737af1db9a90c0240d` are unchanged both times.

1. **D29 = C** (`0d2bb46764b360dad40cde0807444eafee7a684a`, parented on the
   sealed evidence commit `4795f8e0451c6f67ced9e9dd75a1efe5bd1f3711`): added
   `schemaReadProjection` = `37ac8d52…` to each of the four segments'
   bindings and recomputed the evidence constant the way the tooling does
   (`readCohortEvidenceConstant` over the canonical bytes). The constant
   moved from `5141c855420f6c7c032e513e5d072cd446275587` to
   `7e18f51ae390bc74876b2757faa64a5f9a5507f5`.
2. **RP1** (`32ad267cb7779a5e9ca337db1e61a51d81ec6aa7`, parented on
   `0d2bb46`): moved that one value to `801728f8…` on all four segments. The
   constant moved from `7e18f51ae390bc74876b2757faa64a5f9a5507f5` to
   `7f96beb5832e9486712bd5a9a22ae754a39cc70a`.

Each is a binding-format migration, not new evidence and not a re-seal: the
value written is a pure function of the bundle bytes the seal already pinned
(`bindings.schema` is the SHA-256 of the bundle at the run head, and that
bundle is byte-identical to the one projected), and no row, exchange, score,
or other binding changed. Each migration commit changed only the artifact
and the constant file, and the constant moved only because it is the digest
of the artifact bytes.

The evidence law confines the delta from the run head to the evidence
commit — the most recent commit touching the artifact or the constant — to
those two paths. A migration commit therefore has to be parented on the
commit whose tree is the run head's plus the evidence — the sealed evidence
commit for the first migration, the first migration for the second — and
merged into the branch with a merge commit, never rebased or squashed, which
would place unrelated changes inside the confined delta. That is exactly the
topology the original seal commit has relative to the run head, and the gate
proves it the same way: ancestry, delta confinement, canonical bytes, and the
constant. A reviewer confirms each migration changed nothing else with
`git diff 4795f8e 0d2bb46` and `git diff 0d2bb46 32ad267c`.

## Non-goals

- No conformance claim, observation, row, or score changed.
- The specification is unchanged; the projection is evidence discipline, not
  protocol.
- The whole-bundle digest is not retired: it remains the provenance record of
  the exact file the run observed.
- The reachability walk is not retired: it no longer selects the projection,
  but it is the check that the seal covers the Read surface.
