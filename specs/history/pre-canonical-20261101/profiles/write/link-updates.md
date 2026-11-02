> Historical source snapshot from commit `692d801231c78e12b456d8c5213bdf137a6b534d`. This is not the canonical review specification. See the [current specification](../../../../README.md). Original source and hash are recorded in the archive index.

---
status: draft
intended-status: normative
version: "0.1"
---

# Link endpoint corrections and complete owner results

This selected v0.1 amendment implements the [endpoint-identity ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6457645585): correcting either endpoint preserves the Link's identity. It composes with [affiliations](../core/affiliations.md), [final publication](../core/publication.md), [Types ownership](../types/types.md#57-ownership-matches-through-conformance) and [required Events](../core/events.md). It supersedes inherited endpoint-immutability and singular `source`/`sourceRevision` result clauses for the selected retained entries. The separate v0 schema, runtime and historical examples keep their actual contract.

## Replace a whole endpoint Reference

An ordinary `updateLink` MAY supply `source`, `target`, or both, independently of Type, properties and metadata edits. Supplying either endpoint is sufficient mutation input; no dummy property patch is required. Each supplied member replaces that complete Reference. Omission preserves the preceding complete Reference, including its pin. A URI string selects a floating Reference; `{uri, revision}` selects that exact edition. A floating replacement therefore deliberately removes a preceding pin. Null, a partial object such as `{revision}`, or a JSON Patch into an endpoint is not an endpoint replacement.

The same Link `id` and Resource kind remain fixed in its existing Scope. An endpoint may change identity, pin, or both, subject to the ordinary endpoint kind, Reference, Scope, external-endpoint policy and applicable exact Type constraints. This grants no foreign write authority or new alias kind. Singleton endpoints use `durableInputReference`, as creation does. Atomic batch members use the existing `inputReference` grammar, including prior Bead creation bindings where already admitted; bindings capture identity, never a staged revision.

The Link's optional `expectedRevision` guards its revision and is independent of any endpoint pin. No new mandatory owner guard is introduced. Syntax, authentication/authorization, exact Reference resolution, protected-input rules and liveness checks still apply. Types' final-graph allowances remain limited to their existing scope. A failed endpoint admission, stale guard or invalid final graph rolls back the Link and every induced owner effect.

## Revisions, ownership and no-ops

Endpoint References are revision-covered Link state. An effectful correction produces one new Link revision; equality compares complete resolved References, including pin presence and token. An omitted endpoint does not re-resolve its saved pin. An equal replacement after all required checks is a semantic no-op unless another supplied edit changes covered state. Retained retry identity preserves authored endpoint intent and captured resolution witnesses under the existing rules; it is not recomputed from a later GET.

For a correction `L: A → T` to `L: B → T`, evaluate initial membership under A's applicable accepted exact contract and final membership under B's. An initial owner loses L from its new capture; a final owner gains L's complete final record. Deduplicate when the source identity is unchanged. Publish the Link and every changed owner atomically, with at most one final new revision per Resource. An unowned source acquires no invented owner effect. Correcting a target can change the record captured by its source, but ordinary incoming citation does not itself version either target.

All previous Link editions and owner captures keep their recorded endpoints, pins and affiliations. No owner revision silently repins a Link. In a batch, compare initial and final committed states, not temporary ownership during staging. An A→B→A correction with otherwise equal final state preserves the Link and owner revisions and emits no lifecycle facts. A successful no-op still retains its original retry outcome.

## Complete owner revision context

Selected v0.1 singleton Link results and non-allocated atomic-batch Link rows use optional `ownerRevisions` in place of the inherited singular pair:

```json
{
  "ownerRevisions": [
    {"id":"https://work.example/acme/A","revision":"A-after"},
    {"id":"https://work.example/acme/B","revision":"B-after"}
  ]
}
```

This is a result fragment, not an additional Resource field. It contains exactly the distinct Beads that own the Link in the initial OR final committed graph, ordered by ascending code-unit order of canonical URI. Each closed entry carries its `id` and actual final published `revision`; one Link has at most two such sources. Duplicate owner IDs refuse contextual validation, even if their revision strings differ. When there are no owners, omit the member; do not supply an empty array. Bead and allocation-only results omit it.

Ownership exit therefore reports the former owner's resulting revision even though the final Link is unowned. An owned no-op reports the unchanged owner revision. If a batch also deletes an owner, report its final live published revision, not an intermediate staged revision. The complete batch additionally includes each owner's unique Resource outcome row, with the existing `changed`/outcome/full-state rules. Singleton results do not promise inline owner postimages or a cross-request snapshot; exact reads remain subject to actual retained access.

The primary Link result remains its full postimage or deleted identity, with authoritative `changed`. Source/target fields within that Link record still denote its endpoints; they are not secondary result context. Old result-level `source`/`sourceRevision` are not alternative v0.1 spellings. New v0.1 output is selected explicitly by its existing contract binding; this does not rewrite retained v0 results or claim an old client understands the new shape.

## Event correspondence

The effective Link correction emits one `updateLink` fact and each changed owner emits one `updateBead` fact, sharing the decision's actual correlation. Required postimages contain the final full records. An optional Link delta supplies each changed whole `source`/`target` Reference, alongside any other actual changes. An owner's delta uses the existing complete `derived.ownedLinks` replacement. No fake deletion/recreation, invented property patch, new revision for a mere target citation or duplicate owner transition is emitted.

An incident Bead Event projection includes a Link correction when that Bead is incident in the preceding OR resulting published Link state. The departing source/target can therefore observe the correction as well as the arriving one. Deduplicate self-incidence and preserve the same fact identity, revision and relative order; do not invent linked/unlinked operations. Ordinary authorization/disclosure and coverage rules continue to apply. Postimage and delta modes select the same facts.

## Bounded examples and qualification

The [paired fixtures](../../../fixtures/link-updates/candidate.json) cover source movement between two owners, one-boundary ownership, target identity and source-pin correction, unowned source movement and same-owner no-ops, batch final-state cancellation and unchanged historical records. [Artifact checks](../../../packages/protocol/src/link-update-artifact.test.ts) check selected singleton/batch/delta/result grammar and authored state correspondence. They do not execute a service, CLI compiler, storage transaction or concurrent provider. Authorization/guard/constraint rollback remains a required provider behavior, not something JSON Schema can prove.
