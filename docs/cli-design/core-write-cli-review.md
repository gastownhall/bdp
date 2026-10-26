# Core/Write canonical CLI review

Working review map, October 25, 2026. This is a discussion companion, not a new
command contract or an implementation assignment. The goal is a usable minimal
CLI covering the selected BDP surface, with explicit translations from broader
commands into that CLI. Implementation and release pins remain separate.

The starting sources are the [canonical CLI draft](bdp-cli.md),
[retained Core](../../specs/profiles/core/retained-core.md),
[retained Write](../../specs/profiles/write/retained-write.md), and
[Preview 3 correspondence](preview3-alignment.md). The reviewed command sections
and Donna's later decisions must be reconciled with older summaries before the
packet can be treated as coherent.

## What the mappings must preserve

A canonical operation must express the full selected BDP intent through ordinary
arguments and flags. Compiling it to BDP and rendering the admitted request back
as a canonical command must preserve meaning, including omitted versus null values,
exact References, edits, guards, and capture names. That round trip need not
preserve whitespace, flag order, or a user's original choice of equivalent syntax.

A broader command may lower to several canonical operations. Its translation must
also specify results, failures, atomicity, authorization, and any reads needed to
choose those operations. A sequence of reads and writes cannot acquire a stronger
consistency promise merely because it is packaged as one command. Some workflows
will require a client algorithm; some may expose a real missing protocol primitive.

## Primitive surface to review

| Order | Command family | What must close |
| --- | --- | --- |
| 1 | Shared References, defaults and values | Current Scope without repeating it; relative/absolute References; local revision numbers versus exact tokens; quoted URL selectors; literal existing identities; precise JSON inputs. |
| 2 | `create`, `show`, `update`, `delete`, `list`, `versions` | One complete command contract each; all selected object edits; Type setting and filtering; guards, historical selection, paging and optional History. |
| 3 | The corresponding `link` commands, in the same order | Endpoint identity versus endpoint pins; mutable affiliation; ownership effects; incidence filters; whether broader endpoint editing has an honest translation. |
| 4 | `batch` | Literal commands and native JSON express the same admitted operations; identity capture; exact edit/guard preservation; one atomic decision; complete final results; no sequential fallback. |
| 5 | Events, in their own section | Required observation and postimages; optional deltas; mutation vocabulary correspondence; replay, gaps and capability compatibility. |
| 6 | Scope discovery and aliases | Actual advertised navigation, kind and capability checks; locator behavior without inventing portable identity guarantees. |

`list` is the collection command for this pass. Search/graph/query reconciliation
remains with Melinda. `bd type list` remains the agreed location for later Type CLI
work. `serve` stays reserved without extending this review into hosting design.

## Broader workflows as coverage tests

These are candidate translations and review questions, not claims of completed
protocol coverage or promises that today's product implements the translation.

| Broader intent | Canonical expression to check | Boundary or unresolved question |
| --- | --- | --- |
| Create a Memory, Policy, Requirement or Scenario | `create` with the selected Type and ordinary properties. | Type/package interpretation is conditional on the selected Types contract. No extra domain wire operation should be needed. |
| Update an existing Memory through `remember` | `update` with the supported title/body/status edits. | Keep the convenience surface small. Create-versus-update dispatch must have explicit race/error behavior; do not infer an atomic upsert from a preliminary read. |
| Reference, supersede, require, define or declare Subject To | `link create` with the corresponding Type and authored endpoint References. | Preserve direction, pins, validation and induced owner results. The Type supplies the relationship meaning. |
| Change an Issue's status or close it with supporting context | An allowed typed `update`, possibly composed with Memory/Link creation in `batch`. | Prove that the selected Issue contract admits the intended transition; native workflow effects cannot be assumed to be arbitrary property writes. State whether the whole action is atomic. |
| Follow successors, defining trees, ancestors or governing constraints | A client algorithm over `show` and bounded `link list` calls, unless another selected query facility provides it. | Termination, authorization gaps, acquisition limits and consistency need explicit treatment. Independent reads do not establish one graph snapshot. Route query-language decisions to Melinda. |
| Restore content from a historical revision | Exact `show`, then a guarded `update` of precisely the intended content. | Content copying does not restore identity, old revision tokens or an entire historical graph. Protected fields and owned relationships need their own treatment. |
| Change an existing Link's endpoint while keeping its identity | No admitted generic `link update` translation is established by the current draft. | Generic endpoint mutation is currently excluded. Delete-and-create changes identity and is not an equivalent fallback. Decide whether this is a required primitive or an explicit product-only capability. |
| Import a related set of Beads and Links | Creates plus identity captures in an admitted atomic `batch`, where its limits and member kinds suffice. | File import may need several invocations. Mapping records is not preserving original history, all-or-nothing whole-file behavior, or portable graph round trips. |
| Update or delete every current match | `list` followed by guarded members in `batch` can act on an enumerated set. | This does not provide atomic predicate evaluation or include new matches. Do not silently revive deferred set-write semantics. |
| Watch a visualizer's graph | Events plus explicit initial acquisition and permitted representation choices. | A usable initial-state/live-stream handoff must handle gaps and overlap honestly. Observation is not automatically replica bootstrap. |
| Package a convenience such as `ready` or `close` | Parameterized query/mutation composition is a future package concern. | Reserve an extension path; do not add implicit interpolation, parameter syntax, or new meanings to today's literal strings. |

## Known editorial conflicts to resolve first

- The opening summary retains `--type-revision`; the reviewed common syntax uses
  `--type TYPE@REV` and Donna removed the separate flag.
- The opening summary admits `json:` Reference/token arguments; Donna rejected
  that Reference escape hatch. Preserve structured property/metadata inputs while
  removing obsolete Reference syntax from current requirements.
- The opening summary and alignment notes describe explicit revision-token flags
  as literal. The reviewed common section uses `N` or `=TOKEN` consistently for
  `--if-revision` and `--from-revision`.
- Alignment notes retain standalone `--revision`. Donna dropped it from the
  canonical CLI; historical selection belongs on each Reference.
- Scope defaults are stated as settled in the summary but marked unreviewed in
  the command sections. Resolve the actual remaining design question rather than
  leaving contradictory authority in the same document.
- Product compatibility notes still contain `types/` examples. Distinguish exact
  historical implementation evidence from future canonical syntax; do not rewrite
  captured evidence as though a newer binary produced it.

## Proposed working sequence

Start with shared syntax and one complete Bead create/show/update/delete cycle.
Use that cycle to settle object-edit expressiveness and the request/result mapping.
Then apply the same structure to Links, checking endpoint editing explicitly before
assuming that all broader commands can lower to the primitives.

Review batch after those operation signatures are stable, using a related-create
example that captures generated IDs and a guarded multi-update example. Walk the
broader-workflow table against those primitives, recording an honest client
algorithm, optional capability, missing primitive, or explicit exclusion for each.
Finish with the separate Events section and compatibility checks across services
that advertise different optional capabilities.

The deliverable is one coherent CLI contract with worked translations and a short,
explicit list of exclusions. Neither a raw request command nor a growing collection
of domain-specific primitives should be needed to hide an unresolved mapping.
