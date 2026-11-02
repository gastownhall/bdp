# CLI reconciliation with Core, Write and Types

This is the first mismatch inventory for the fourth document in Donna's review
corpus, [the canonical CLI](../cli-design/bdp-cli.md). It compares the selected
Core/Write/Types text at `eb80814364c4ab3872ff804e891cb01ac2684ba8` with the CLI
inherited from main `692d801231c78e12b456d8c5213bdf137a6b534d` and its companion
material. The CLI introduction and direct protocol links have been repaired in
this increment; the substantive findings below remain open for the editorial pass.
This inventory is review work, not another normative document or an implementation
qualification. Each correction belongs in the document that owns its rule.

## Correct stale or contradictory text

These corrections follow existing decisions; they do not need a new design vote.

| ID | Mismatch in the branch | Required reconciliation |
| --- | --- | --- |
| CLI-01 | The CLI's command inventory and “Required Event signatures” summary, [profile helper](../cli-design/retained-profiles.md), [Events helper](../cli-design/events.md) and [batch helper](../cli-design/atomic-batch.md) still describe Events as mandatory. | Core and Write both permit a Scope without Events. Require advertised support for Event commands; keep complete postimages, atomic facts, coverage and replay obligations **within advertised Events**. Ordinary Write state, allocation, revision, owner, key and outcome guarantees remain unconditional. |
| CLI-02 | The CLI's Type summary describes a temporary unsaved-instance creation placeholder. Its own [first sequence](../cli-design/types-first-sequence.md) already supersedes that path. | State the real persisted-instance acceptance direction and all five increments accurately. Preserve installed Types as ordinary records and native creation/read/reopen obligations. This does not claim implementation delivery or activate deferred increments 2–5. |
| CLI-03 | The shared Reference summary and [Scope helper](../cli-design/scope-and-references.md) admit `--source-revision` / `--target-revision`; the detailed Link-create entry explicitly excludes them. | Use the detailed common `@N` / `@=TOKEN` suffix contract. Any historical product flags need an explicit compatibility boundary. Keep opaque tokens, truthful ordinal resolution and refusal of authored `@current` pins. |
| CLI-04 | [Reads and paging](../cli-design/reads-and-paging.md), Scope examples and the Events helper present HTTP read-control flags as usable; the main CLI's final proposal section leaves `--head` and conditional flags unreviewed. | Mark those CLI spellings consistently proposed. Selected Core HEAD/validator semantics remain selected; adopting their CLI grammar is a separate choice. |
| CLI-05 | The Link Events entry contains a copied paragraph about a **Bead** source and incident Link facts. | Describe the selected Link's own lifecycle. Keep the Bead Events population rule in the Bead entry. |
| CLI-06 | Exact-guard examples in [contract binding](../cli-design/contract-binding.md) and [object edits](../cli-design/object-edits.md) use bare opaque tokens. | Write `--if-revision =saved-r1` and `--if-revision =resource-r7`, consistent with the selected `N` / `=TOKEN` grammar. Wire `expectedRevision` is unchanged. |
| CLI-07 | The Scope helper gives deferred `type list` a “respective inventory URL,” while [Types CLI](../cli-design/types-cli.md) selects neither its endpoint nor its population. | Keep inventory/navigation conditional on a future selected contract. Ordinary Bead List is not a registered-Type catalog. Remove the completed navigation TODO in Types CLI. |
| CLI-08 | Companion documents still send readers to retired protocol stubs or describe already-selected projection/factoring as outstanding. [Authoring formats](../cli-design/authoring-formats.md) also retains pre-consolidation schema-authority language. | Link to the actual canonical clauses and distinguish specification selection from implementation qualification. Core's visible schema fragments now own its mechanically extracted definitions; prose/schema disagreement is a defect to repair. Preserve dated receipts as history. |

Recommended first repair: CLI-01, followed by CLI-02 and CLI-03. These are the
largest contradictions between the four review documents. Source review of the
read-facing and Write/Types-facing areas independently reached the same three
findings. The Link Events copy error and exact-token examples can be corrected in
the same bounded editorial pass.

## Harvest existing decisions without inventing missing contracts

**CLI profiles and product factoring.** Cleo's October 29 normalization handoff
records Donna's selected names `canonical` and `compat`, a persistent settable
default initially `compat`, and an invocation override that does not change the
saved default. Canonical command/flag registration must precede command-specific
parsing; late refusal or hidden help is insufficient. No automatic profile fallback
is selected. Packs and output presentation are separate from CLI profiles:
Issue/Dependency commands and Memory commands are domain surfaces, not inherently
compatibility commands. The main CLI lacks this explicit factoring. Harvest the
shared client rule here and keep Beads-specific migration/inventory details with
the product. Exact selector/configuration spellings and implementation coverage
must be reconciled with the receiving work; existing renderer annotations do not
prove that a persistent CLI profile is implemented. This is not a new Core/Write
protocol profile or selection of a Pack wire format.

**Batch.** Selected Write batch version 1 has six CRUD operations, create names,
prior identity handles, ordered mappings and complete final outcomes. Rooted
creation is a separately composed optional extension. The richer
[selection-binding design](../cli-design/batch-selection-design.md) preserves
Donna's client/transaction direction, but its exact version-2 wire fields remain
proposed. Present selected-v1 lowering of `--batch-bind` / `batch-ref::NAME`
separately from v2 sets, structural bindings, selection-only results and capture
policy. Date the old helper's raw-CLI/default-JSON recipe instead of treating it
as competing current syntax. Do not downgrade, split, or advertise unsupported
encodings automatically.

**Types authoring.** Stored Refines direction is DERIVED → exact BASE. The first
sequence's requested `BASE DERIVED` convenience needs explicit paired lowering;
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
These are source dispositions, not proof of installed CLI conformance. No PR was
closed or merged for this audit.

## Import/export: Iris's readiness assessment

Iris reports enough material for a **bounded Transfer specification draft now**,
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
separate capabilities. This assessment does not add a fifth adopted specification
or start an implementation campaign.

## Review limits

This pass covers the primary CLI's shared Reference, reads, paging, errors,
History, Events, CRUD, Write, batch and Type summaries, with their named
companions and existing morning review evidence. It is not a fresh complete
Query-grammar/domain-command audit or an implementation/test run. Cleo's handoff
was read as retained design evidence; her paused work was not restarted. Iris was
asked directly for readiness and the closest actual draft. The next work is
source reconciliation in the same editorial branch, preserving unsettled
contracts as unsettled.
