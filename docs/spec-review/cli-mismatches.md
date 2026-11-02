# CLI reconciliation with Core, Write and Types

This is the first mismatch inventory for the fourth document in Donna's review
corpus, [the canonical CLI](../cli-design/bdp-cli.md). It compares the selected
Core/Write/Types text at `eb80814364c4ab3872ff804e891cb01ac2684ba8` with the CLI
inherited from main `692d801231c78e12b456d8c5213bdf137a6b534d` and its companion
material. Donna reviewed all eight groups and handed the files back for correction. This
increment applies those rulings and harvests settled client decisions directly
into the CLI. This inventory records dispositions, not amendments that readers
must mentally apply. Specification requirements do not depend on current
implementation limitations; runtime conformance follows the complete human pass.

## Disposition of the eight mismatches

| ID | Disposition |
| --- | --- |
| CLI-01 | **Corrected.** Core and Write permit absent Events. CLI command availability checks advertisement; complete postimages, facts, coverage and replay remain required within supported Events. Ordinary Write durability/atomicity is unconditional. Active discovery, Events, batch and walkthrough summaries agree. |
| CLI-02 | **Corrected.** Type definitions are ordinary Bead records. The main CLI describes real persisted definitions, Refines and instances; the five-step acceptance plan is not an unsaved-instance API or a semantic limitation. |
| CLI-03 | **Corrected.** Removed generic admission of `--source-revision` / `--target-revision`. Endpoint pins use `@N` / `@=TOKEN`; separately named product operations retain their own boundaries. |
| CLI-04 | **Deferred by Donna.** HTTP CLI flags have received no design pass. Main and companions consistently mark `--head` and condition flags unselected. Core HTTP semantics remain unchanged. |
| CLI-05 | **Corrected.** Link Events describes that Link's lifecycle; Bead Events keeps its lifecycle and incident-Link population. |
| CLI-06 | **Reconciled to Donna's current bare-token direction.** `--if-revision TOKEN` sends the exact opaque token unchanged, including numeric-looking tokens and literal leading `=`. No ordinal guard shorthand is selected. Reference suffixes and the separate historical-content adapter are not silently reinterpreted. |
| CLI-07 | **Corrected boundary; full design deferred.** No Type inventory endpoint/population is invented. The future Type and packaging specifications will own it. Removed the completed navigation TODO. |
| CLI-08 | **Corrected active reader paths.** Current companions point to canonical clauses; projection and schema-authority summaries match the assembled corpus. Historical receipts retain attribution with current supersession notes where needed. |

The guard investigation found two real stages: earlier literal token flags, then
a recorded human request for uniform `N` / `=TOKEN` arguments. The original audit
was too strong to call its bare examples merely typos. Donna's current preference
now governs; quoted `"3"` is not distinguishable from `3` in argv, so literal guard
semantics explicitly preserve numeric-looking exact tokens. A leading `=` is not
stripped. No implementation parser conformance is claimed by this edit.

## Harvest existing decisions without inventing missing contracts

**CLI profiles and product factoring.** Cleo's October 29 normalization handoff
records Donna's selected names `canonical` and `compat`, a persistent settable
default initially `compat`, and an invocation override that does not change the
saved default. Canonical command/flag registration must precede command-specific
parsing; late refusal or hidden help is insufficient. No automatic profile fallback
is selected. Packs and output presentation are separate from CLI profiles:
Issue/Dependency commands and Memory commands are domain surfaces, not inherently
compatibility commands. The canonical CLI now states this shared factoring directly. Beads-specific
migration/inventory details remain with the product. Exact selector/configuration spellings and implementation coverage
must be reconciled with the receiving work; existing renderer annotations do not
prove that a persistent CLI profile is implemented. This is not a new Core/Write
protocol profile or selection of a Pack wire format.

**Batch.** Selected Write batch version 1 has six CRUD operations, create names,
prior identity handles, ordered mappings and complete final outcomes. Rooted
creation is a separately composed optional extension. The richer
[selection-binding design](../cli-design/batch-selection-design.md) preserves
Donna's client/transaction direction, but its exact version-2 wire fields remain
proposed. The canonical CLI now states selected-v1 lowering of `--batch-bind` /
`batch-ref::NAME` separately from v2 sets, structural bindings, selection-only results and capture
policy. The old helper's raw-CLI/default-JSON recipe is labeled historical rather than
competing current syntax. Do not downgrade, split, or advertise unsupported
encodings automatically.

**Types authoring.** Stored Refines direction is DERIVED → exact BASE. The first
sequence now gives the ordinary explicit endpoint form with an exact base token.
Its requested `BASE DERIVED` convenience still needs explicit paired lowering;
it must not reverse general Link `SOURCE TARGET` positionals. Complete authoring
examples through ordinary writes when their descriptor inputs are selected.
Public exact-definition invocation, Type inventory and lifecycle grammar remain
incomplete; definition creation does not imply registration or default selection.
The optional exact-definition protocol lookup itself is coherent with Types and
must not fall back to ordinary Show/History.

**Query.** Preserve the selected logical semantics and Donna's retained draft
`walk` + `direction` encoding with separate `any` / `all` nodes. Human expression
grammar, native HTTP binding, `readVersion`, Graph transport and still-unselected
sorting/incidence policies remain visibly proposed. CLI corpus inclusion does not
adopt them. Client-checked Link incidence filtering and page-size defaults are not
by themselves contradictions in Core's protocol semantics.

## What the PR harvest establishes

The relevant canonical CLI overview, Types binding, Query bootstrap, rooted
creation and authoring-format contributions are already merged source inputs:
[#310](https://github.com/gastownhall/bdp/pull/310),
[#315](https://github.com/gastownhall/bdp/pull/315),
[#317](https://github.com/gastownhall/bdp/pull/317),
[#325](https://github.com/gastownhall/bdp/pull/325) and
[#328](https://github.com/gastownhall/bdp/pull/328).
There is no need to merge those historical PRs again to obtain their text.
In particular, #317's merged bootstrap does not adopt its provisional native
binding. Open [#175](https://github.com/gastownhall/bdp/pull/175) is older JSONPath
exploration, not missing selected work that overrides the current AST direction.
These are source dispositions, not proof of installed CLI conformance. No PR was closed or merged on partial-incorporation evidence.

Donna authorized disposition during harvesting. The first bounded review checked
three open candidates against exact current heads and their saved full scopes:

| PR | Accounted-for portion | Retained residual / disposition |
| --- | --- | --- |
| [#180](https://github.com/gastownhall/bdp/pull/180) | Metadata-complete incident Link Events, self-incidence deduplication and external-endpoint boundary are represented in selected semantics. | Historical production/private-minimum integration and finite/SSE controls are not proved incorporated; #185 targets its head. **Retain implementation vehicle; semantic purpose represented.** |
| [#181](https://github.com/gastownhall/bdp/pull/181) | Compatible sanitized diagnostics and EOF/drain behavior were adapted by #335. | Whole startup/export/lifecycle and installed-carrier proposal remains distinct. **Retain startup residual; partial adaptation complete.** |
| [#164](https://github.com/gastownhall/bdp/pull/164) | Six-CRUD lifecycle, final facts, Link deletion context and incident projection are selected/superseded. | Import/Inception/source-correlation residual remains for Transfer reconciliation; #165 is related. **Retain accurately held draft.** |

Zero of these three is wholly closure-safe. That does not block closing a later
fully incorporated/superseded PR once source attribution, residuals and dependents
are accounted for. Draft-corpus incorporation is distinguished from main landing;
no bulk closure or ancestry-only disposition follows.

## Import/export: Iris's readiness assessment

Donna has asked Iris to create the Transfer profile draft for this review corpus,
with a separate CLI mapping. Iris reports enough material for a **bounded draft now**,
but not a complete frozen interoperable retained-data contract. Her closest
[Resource-shaped JSON/JSONL comparison](https://github.com/donnabox/agent-coordination/tree/4824cce9d0f2c3716ae4f9bd972bbf891863b658/context/iris/independent-362-356-20261031/native-B-resource-comparison01)
uses ordinary Resource bodies and separate transfer framing. Its
[corrected independent closure](https://github.com/donnabox/agent-coordination/blob/69cb96de687b35861826f9d7c5b1f29ca79d236e/context/iris/independent-362-356-20261031/native-B-resource-comparison01/NATIVE-RESOURCE-COMPARISON02-CLOSURE.md)
is comparison evidence, not an importable complete backup or a PR337 conformance
result.

The remaining specification work is concrete:

- Map capture boundaries, version/capability negotiation and prerequisites to the
  current Core/Write/Types contracts.
- Inventory all retained facts beyond Resource bodies: complete History,
  terminal/lineage and allocation/nonreuse facts, associations, exact Type
  prerequisites and inert original authority/provenance.
- Define JSON/JSONL equivalence, exact values, duplicate members, ordering,
  integrity, completion/EOF and extensions.
- Define destination Scope/custody/authentication and original-revision admission,
  no-op/conflict, atomic results and retry. Ordinary create/batch is insufficient
  for historical import.
- Specify bounds, privacy, errors and receipts. Checksums do not prove
  authentication or enumeration completeness; imported credentials or leases
  must never activate or replay.

Iris recommends a Transfer profile that references the three protocol documents,
a separate CLI mapping, and a separately justified native-recovery adjunct where
needed. Same-Scope identity preservation comes first; DNS-neutral identity remains
Donna's next design discussion. Optional Events does not justify a mandatory
import Event/head. Cross-Scope mapping, federation and resumable bulk recovery are
separate capabilities. The [Transfer proposal](../../specs/profiles/transfer/transfer.md) is now received
into this same editorial corpus, with its proposed commands inline in the
[canonical CLI](../cli-design/bdp-cli.md#proposed-transfer-commands) and
[remaining mappings](transfer-review.md) explicit. It is not an adopted capability
or an implementation campaign.

Events factoring remains a separate editorial/design discussion. The existing
contract already composes Events optionally with Core or Write. A separately
readable Events specification can own observation carriers, finite replay and
coverage, with conditional Write/Transfer producer obligations, without inventing
a new exclusive base-profile literal. Do not conflate moving text with selecting
a new wire capability or requiring Event replay for Transfer.

## Review limits

This pass covers the primary CLI's shared Reference, reads, paging, errors,
History, Events, CRUD, Write, batch and Type summaries, with their named
companions and existing morning review evidence. It is not a fresh complete
Query-grammar/domain-command audit or an implementation/test run. Cleo's handoff
was read as retained design evidence; her paused work was not restarted. Iris was
asked directly for readiness and the closest actual draft. Scoped read-facing and Write/Types receiving reviews covered the applied corrections.
Their two residual guard/example findings were corrected and independently closed.
Unsettled contracts remain explicitly unsettled; no implementation alignment or
main merge follows from this editorial pass.
