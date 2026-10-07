# Draft BDP v0 amendment: common Resource metadata

This is a review packet for the normative BDP spec, schemas and conformance
artifacts. It does not change the current v0 wire contract. The Graph CLI
Specification (Draft) requires a common top-level metadata object on Beads and
informational Links; current BDP v0 describes only Type-validated `properties`.
No BDP implementation is deployed, so the wire contract can still be amended
coherently before a conformance claim. Trish's Type proposal is provisional and
does not supply this Resource member.

## Proposed contract

1. `metadata` is a JSON object on every Bead and Link record, including an
   empty `{}` on creation when no metadata was supplied. It is distinct from
   `properties`, `attribution`, Type descriptors, and transport metadata.
   Resource metadata is client-authored state; the authority does not infer
   timestamps, provenance, actor names or Type classification from it.
2. The same admissible-number, validation, authorization, revision, no-op,
   retained-address and exact-read rules that govern mutable `properties`
   govern `metadata`. An actual metadata change mints one Resource revision
   and one `updated` Event. A semantically equal update retains the revision
   and attribution. A mutation of an owned Link also versions its declared
   source; an unowned Link does not. No target Bead revision changes.
3. Resource selectors may test singular paths under `metadata`. The field is
   present in collection records, History snapshots, authorized exact reads,
   comparison inputs and owned Link projections. Its content is not a
   replacement for Type validation of `properties`.
4. Creation accepts an optional metadata object. An update can atomically
   change properties and metadata under one `expectedRevision` and one
   transaction-local operation result. Omitting either plane preserves it.
   For CLI parity, metadata replacement/merge/key-set/key-unset must have one
   unambiguous ordered definition; `--metadata` merges top-level keys and
   set/unset can combine with unset last. This should be specified as a
   single metadata change grammar rather than implicit JSON Merge Patch.
5. No deletion version, timestamp, cascade or restoration behavior follows
   from this amendment. Existing incident-Link refusal and retained identity
   rules stand.

## Recommended wire operation shape for review

Rename the current `update-bead-properties` and `update-link-properties`
singletons to `update-bead` and `update-link`. Their request records accept
optional `propertiesChange` and `metadataChange` members; at least one must
be present. This avoids a misleading operation name and admits one atomic
properties-plus-metadata edit. Keep the existing JSON Pointer property-change
grammar under `propertiesChange`; define a separate metadata-change grammar
for top-level merge, set and unset. `expectedRevision`, attribution,
change-context, idempotency and source-result behavior are unchanged. Since
there are no deployed BDP implementations, the renaming cost is in spec,
schema, fixtures and conformance rather than external clients. The alternative
is two metadata-specific singleton operations, but Read+Update `sequence` is
non-atomic and would not express the CLI's combined edit as one operation.

This operation shape is a recommendation, not a settled normative rule. It
should be decided before updating the BDP discovery directory, JSON schemas
and conformance IDs. In particular, do not publish a schema accepting metadata
records while the operation and no-op semantics remain unspecified.

## Exact fanout for the normative amendment

| Family | Migrate together | Validation |
| --- | --- | --- |
| Model and wire prose | `docs/specs/bdp.md` Bead/Link model, revisions, selectors, operations, Events, Resource records, History and Read+Update/Transactional profile tables | Review each member against the Graph CLI draft and the existing owned-Link rules |
| Schemas and generated copies | `schemas/bdp-v0.schema.json` and byte-identical `packages/protocol/schemas/bdp-v0.schema.json`; discovery and singleton/sequence request definitions | Schema sync and package tests; positive and negative record/update validation |
| Examples and fixtures | `fixtures/read-update/*`, `fixtures/transactional/*`, `fixtures/history/*`, relevant reference-domain and owned-Link examples | Validate every changed fixture against the changed schema |
| Conformance | `packages/conformance/catalog/*`, runner action names, wire projection helpers, lockstep tests and matrices | Catalog/fixture/manifest tests; no claim of runtime conformance from catalog presence |
| Vendored Beads copy | Explicit follow-up after public BDP review and source pin; no automatic vendor drift | Exact hash and whole-tree verification at the Beads integration point |

Preserve as compatibility evidence the current BDP v0 examples and failed
receipts until a replacement is independently reviewed. The protocol's
existing `revision` token remains the canonical current-state guard; CLI
`bd versions` row `version` and local ordering number do not rename it.

## Decisions before normative patch

- Confirm the unified operation names and `propertiesChange` spelling (or
  explicitly choose the two-operation alternative).
- Confirm whether an empty metadata object is always emitted or may be omitted
  from old retained records; the recommendation is always emitted for new v0
  records, with explicit legacy-read disposition rather than fabricated data.
- Keep the Type design boundary: the preview CLI's single Issue Bead Type plus
  `issue_type` property is an adapter for ordinary `bd`, not a change to BDP's
  nominal Type model. Any generic Type migration is owned by the Type design.

These decisions do not authorize a schema-v6 Beads workspace migration. That
local migration needs its own compatibility and data-preservation plan.
