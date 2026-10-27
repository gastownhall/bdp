# Read/Query incorporation map

October 26, 2026. Coordination notes for PR310, not another semantic source.
The prior author commits 4477db1/9eb4bb4/ba9c40e are already composed in Sybil's
PR310 head f386bf0c5069cfc642b84aee842f109809841ef9. This follow-up completes
review proposals on top of that author source. No held schema, runtime, main,
release or pin is moved by these documents.

## Source homes

| Home | Responsibility |
| --- | --- |
| [Review entry](../read-review.md) | Overview reading order, selected/proposed distinction and evidence |
| [CLI grammar](../query-language.md) | Full canonical command/input/flag/grammar and AST lowering candidate |
| [Query](../../../specs/profiles/core/query.md) | Logical semantics, author-proposed first-slice admission |
| [Native binding](../../../specs/profiles/core/read-operations.md) | Proposed optional capability/version dispatch, masks/sort/results/continuation/errors |
| [Projection](../../../specs/profiles/core/resource-projection.md) | Shared current/exact/List Resource mask semantics |
| [Read output](../read-output.md) | Existing schema2 framing plus explicit graph/aggregate/context amendment proposals |
| [AST](query.schema.json), [binding schema](read-binding.schema.json), [cases](cases.json), [binding cases](read-binding-cases.json), [syntax obligations](syntax-cases.json) | Authored checks, not an implemented parser/service |
| [Overview02](../overview/02-explore-graph.md), [05](../overview/05-revisions.md) | Linear seed/story examples, distinct from normative source |
| [Council](review/council-20261026/README.md) | Exact review coverage, findings, fixes and disagreements |
| [Provider experiment](experiments/20261026/README.md) | Actual narrow lowerings/product measurements, limits and next checked prototype |

## Shared-entry changes for Sybil

Sybil owns bdp-cli.md/index/assembly, Scope helpers, CRUD 03, Events 04 and Batch 06.
Do not copy an entire entry from this author lane. Incorporate these focused deltas:

1. Link the review entry/complete language/native binding alongside the already
   integrated overview 02/05. Seed/guide business states remain unchanged.
2. Keep baseline bounded --selector behavior distinct. Structured List is a new
   optional profile; Query/Graph names do not silently reparse product arguments.
3. Point service projection now has its own optional capability; List/Query masks
   use the same contract but can be declined independently. Projected full-record
   arms and exact History's revision-only query need explicit native amendments.
4. Exact count is outer service result mode, never page length. Optional support,
   scalar sort rules, response-scoped completeness and native continuation are
   specified in the new candidate rather than left to a renderer.
5. Query/Graph arguments, file inputs, kind/profile assertions and initial graph
   mask/paging refusal now have explicit proposals. No installed support implied.
6. Preserve dedicated Versions semantics, actual History qualification and native
   window/lineage/body/provenance. Story 05 adds consistent Window/metadata and
   supplied ordinal9; it does not change retained data.
7. Shared inherited Scope examples still use bdp while canonical source uses bd.
   Normalize those names in assembly; do not invent a second Reference parser.
8. Paired read delivery now explicitly states reflexive Type-family matching;
   coordinate the final recorded authority wording with Trish/Types. Exact nominal
   matching and family admission remain distinct, never definition-pin equality.

## Adoption is a separate concrete patch

Port new optional capability/detail/dispatch, full/projected response, count/graph
carrier and Problem definitions into the selected v0.1 native/distribution schemas
only after review/adoption. Register schema2 descriptor/context additions with the
shared output owner; no new writer or framing version is authorized here. Preserve
base Core Selector, actual HTTP/History status/retry semantics and existing pins.

The current-edition incidence, strict endpoints/no stubs, fail-fast proof policy,
atomic graph result, scalar/nonscalar sort partition, exact transport/grammar names
and first List/incidence boundary remain author proposals. Council review does
not turn them into human rulings.

Provider spikes are explicit pattern lowerings, not a general compiler. Current
Memory's induced boundary edges and staged witness-graph composition remain
compatibility/result-model questions, not silently claimed complete AST coverage.
All static/schema, SQL, product CLI and source-review evidence retain their actual
separate identities and limits.
