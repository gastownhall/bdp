# Ordinary reads: paired CLI and protocol source

Candidate under existing [#280](https://github.com/gastownhall/bdp/issues/280)
and sole #59, isolated from reviewed PR292 at
`ad6ddd45f4fb35742fbc60be84b0eb6f3b0fd9c1`. Earlier namespace/binding/
affiliation/object-edit/batch draft ancestry remains separate from adoption.
The [CLI selection/paging](../cli-design/reads-and-paging.md) and
[output contract](../cli-design/read-output.md) come first; the matching
[Core amendment](../../specs/profiles/core/read-delivery.md) closes their
actual HTTP/query correspondence. This is paper source, not runtime support.

## Author choices and recovered constraints

The ordinary surface keeps one Resource or one population per command, default
Scope/absolute Reference rules, revision tokens and Cleo's output/paging/masks.
No domain conveniences, mixed query, traversal, Type lifecycle or general History
expansion is added. The actual properties view stays distinct from a display
mask; optional incident aggregation stays one bounded embedded page.

| Gap | Candidate resolution |
| --- | --- |
| Wire endpoint predicate lacked a CLI flag | `link list --endpoint REF`, including opaque external URIs |
| Earlier CLI mutual exclusion lost wire expressiveness | `--type` and `--exact-type` combine with AND; nominal affiliation and exact recorded family may differ across definition pins |
| Incident population lacked Link predicate parity | `view=links` admits the same Link structural/Selector filters, applied before paging |
| Empty or opaque continuation URL gave no item-kind proof | Required `BDP-Collection-Kind` plus owning `service-desc` on top-level Resource collections, continuations, HEAD/304 |
| Point-subject and represented item could differ | Incident HTTP Resource-Kind remains bead; Collection-Kind and CLI primary context are link |
| Total cap could strand an overfetched tail | Per-fetch limit bounds remaining budget; only limit may change on an issued ordinary continuation |
| Partial stream could skip undisplayed rows | Omit unavailable continuation at a mid-page boundary; never synthesize null or use a token after its tail |
| Validators could appear to cover assembled/projected output | HTTP conditions select one native representation; context identifies an associated native response, not a CLI envelope ETag |

These are explicit author refinements, not new human rulings. In particular,
filter AND replaces the private C1 author-only conflict rule, while its raw
Selector semantics remain unchanged. Bare filter `any` is a CLI sentinel, not
a newly reserved Type name. Native Source/target matching remains URI-based
and pin-transparent. Family unavailable refuses without local emulation.

The new ordinary page-size rule is explicitly bound to selected v0.1 and
Bead/Link inventories/incident views. It requires issuers, including signed-URL
schemes, to permit changing only limit without changing the snapshot or auth
fence. It does not assign that rule to History, Events or Type inventory. No
portable local cache cursor, snapshot export, replication or retention guarantee
is created. Old contracts are not advertised as if they already supported it.

Application exact History keeps revision-only query/full-record semantics;
`ID@REV` and `--revision` conflict when both supplied. `--if-revision` remains a
mutation guard. Narrow exact-definition lookup stays coordinated with Trish;
this pair invents neither its transport nor an automatic fallback from absent
application History. The scope descriptor example retains the staged inherited
profile/navigation vocabulary only for framing, without choosing final profiles
or a Type inventory payload.

## Output artifact boundary

The separate [CLI candidate schema](../cli-design/read-framing.schema.json)
checks bound v0.1/schema 2 framing and primary protected Resource/Reference
shape for six ordinary read descriptors. It is not the complete Cleo registry,
a native protocol schema/export, a full native-state validator or a renderer.
Full native record/discovery/Problem checking and cross-record delivery counts
are separate artifact assertions. Unbound/pre-discovery errors are outside this
subset. Existing protocol canonical/distribution schemas stay byte-identical:
171 candidate definitions, no new native definition or runtime export.

Finite JSON and JSONL header/item/terminal retain Cleo's outcome/error/completion
vocabulary. Bodyless GET 304 has no data/completion; HEAD has actual HTTP metadata.
Missing terminal is incomplete. Projection records original requested pointers;
Resources keep identity/Type/revision/endpoints while ordinary properties remain
data. Protected Reference members stay whole, optional owned planes may be omitted,
and original-index/compaction rules are not a graph-membership filter. Raw output
makes no self-contained framing/completion claim.

## Bounded qualification and remaining gates

The prior eleven-file source/schema/catalog slice plus twelve new read-artifact
tests passes **470/470 across twelve files**, zero failures/skips, using Node
24.19.0, Vitest 4.1.10 and strict Ajv 8.17.1/full formats. Positive/negative
controls cover descriptor framing, protected primary context, contract identity,
bodyless reads, error origins, pointer syntax, stream ordering/counts and native
Reference/record/Problem examples. Initial strict-schema construction failures
are preserved separately; declarations were corrected without disabling strict
validation or weakening old assertions.

All 569 current catalog quotations still resolve without edits. Catalog files,
IDs/profiles/anchors/selection and old runtime/provider/behavior fixtures are
unchanged. Six command/query pairs, twenty semantic cases and the HTTP header
example are paper expectations, not executed CLI compilation, field-mask
application, cursor resizing, provider behavior or network evidence. No full-suite,
hosted, installed-client or HTTP qualification is claimed.

Trish owns actual Types/profile composition and narrow exact-definition source;
Molly batches current-source curation. Required Events payload/coverage decisions
remain in the existing human loop; exact multi-operation owner revision allocation
remains a Types seam. No new question, tracker, worker or implementation queue is
created. Runtime/product/main/serve/Vickie/Experimental holds remain. This source
requires bounded parent review and normal semantic integration; a docs index PASS
cannot qualify it.
