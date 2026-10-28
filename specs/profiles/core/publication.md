---
status: draft
intended-status: normative
version: "0.1"
---

# Final publication in one atomic decision

Donna selected final committed states and net-no-op behavior in Trish's October22
decision round. This common amendment pairs with the [batch CLI](../../../docs/cli-design/atomic-batch.md)
and [batch protocol](../write/atomic-batch.md). It replaces the earlier unadopted
operation-local batch results, revision and Event examples. It does not change
ordinary singleton request grammar or make atomic batch mandatory.

## Stage intent; publish final state

Members are admitted and applied to one working graph in authored order. A later
member can use an earlier creation's identity or edit earlier staged values.
There is no public intermediate Resource version, Event or readable address for
that staging. Syntax, authorization, guards, protected-input admission and exact
Reference resolution still apply even if later edits cancel a change. Applicable
Types final-graph allowances do not waive those checks.

Compare the final graph against the committed graph on which the decision is
admitted. Revision-covered state is complete affiliation, properties, metadata and
applicable captured owned-Link state, and for a Link its complete source/target
References; provenance alone does not cause a change.
Each affected live Resource gets **at most one** new revision, exactly when that
final state differs. A new surviving Resource gets one creation revision. An
existing deleted Resource gets no new revision: its final live published version
is its version before this batch, even if staged edits preceded deletion.

A→B→A within one batch retains the original revision and entire recorded envelope
when final covered state is equal and no other Resource effect requires a changed
capture. No intermediate B/version/provenance appears in ordinary reads, History,
results or Events. A failure rolls back the complete decision, unchanged from the
ordinary atomic failure rule. Two separately committed writes still publish their
two transitions; this rule does not collapse history across decisions.

## Owners capture the final graph once

Use the applicable accepted ownership semantics to compute initial and final
membership. A surviving owner captures complete **final** Link records, each with
its actual final Link revision and recorded affiliation. Compare that capture with
its initial recorded state and allocate at most one owner revision if changed.
Multiple Link changes and explicit owner edits share that one final owner version.
An owner deleted in the batch gets no intermediate owner version. A Link with no
net covered-state change retains its revision; it does not by itself force a new
owner version. Owner retyping does not invent revisions for unedited Links.
When accepted membership and captured Link records are unchanged, preserve the
original recorded capture/envelope, including retained legacy empty buckets.
Normalizing an old representation into the new-capture shape is not a mutation
or a reason to mint an owner revision. New captures still obey the selected rules.

Literal endpoint pins stay literal. A stored S@r1 may remain in L while S's final
capture at r2 contains L. No automatic repinning, future-revision capture or change
to the meaning of an existing address follows. Ownership interpretation and
Scope-wide Types activation remain with the Types owner; this clause consumes
that authority rather than defining another Type language.
The Types owner's [b924d084 source](https://github.com/gastownhall/bdp/blob/b924d08444ab0ee6eecbc1fd88a9d9cc1a6a8138/specs/profiles/types/types.md)
propagates the same ruling plus strict Scope-wide activation and the smaller alias
cut. That is a separate unadopted source input, not a merged Types implementation.

Revision meaning is Resource-qualified: compare `(URI, revision)`, not bare tokens
across Resources. An implementation may use equal token strings on different
Resources, or different strings for versions in the same decision. Neither equality
nor inequality is required. A shared token is not a global revision, transaction
identifier or proof of a shared state; existing retained-address laws still apply.

## Net no-op and committed allocation

If final revision-covered state is unchanged **and no other durable semantic
effect occurred**, the batch succeeds with `changed:false`, no new Resource
revision/provenance or lifecycle Event, and no Event-correlation transaction in its
result. Its successful idempotency disposition, resolution witnesses and original
result are nevertheless recorded atomically. That required recovery bookkeeping
does not make every semantic no-op effectful. Retry is never fresh execution.

Creation followed by deletion is different: a successfully committed allocation
consumes that canonical identity under the non-reuse rule, even though no live
Resource/version was published. It is `changed:true`; the result reports an
`allocated` final outcome with URI/kind, no fictional Resource body, revision or
affiliation. It creates no Resource lifecycle Event because no Resource transition
was published. Its transaction correlates the effectful decision without promising
that every durable internal effect has a Resource Event. Aliases cannot occupy the
consumed identity; it is not a new public reservation operation or Resource kind.

Two creates cannot reuse the same identity inside a successful batch after staged
deletion. Rollback commits no allocation/non-reuse claim; existing allocator safety
and failed-key rules still apply. No consumer can use a rolled-back capture.

## One attribution per published version

For each final new version, collect explicit `revisionProvenance` inputs from all
members directly targeting that Resource. For a final owner version, also collect
inputs from Link members whose Link is owned by that source initially or finally.
This uses boundary membership, not invented intermediate owner versions. A
member's supplied input is a request to attribute that one batch version even if
its local edit leaves a value unchanged. Omitted input does not override a supplied
one. Equal explicit objects, using ordinary JSON value equality, select one input;
otherwise the complete batch fails with ordinary validation-failed/422/never.
Do not silently choose first/last, concatenate messages or invent an attribution.

Apply the existing provenance realization once per final version using that input,
or ordinary omitted-input behavior when none was supplied. This does not add an
authority attestation or a new provenance schema. If no version is published,
otherwise valid provenance does not force one: existing no-op envelopes stay
unchanged; a deletion/allocation-only outcome has no newly recorded attribution.
Input validation and retry identity still preserve each authored input/presence.

## Published facts and recovery

For each initially absent/finally live Resource emit one create fact; for each
initially/finally live changed Resource one update; for each initially live/finally
absent Resource one deletion. Order the Scope's facts by canonical Resource URI
within the decision, preserving the source's existing append order between
decisions. Induced owner updates are included once, with their own actual revision.
The selected [Event representations](events.md) describe those final transitions:
postimage is the final published record and delta transforms the initial record to
it, not a concatenation/replay of staged commands. A staged Type overwritten before
commit has no separate fact. No-op and allocation-only cases above have no
lifecycle facts. Projection/cursor/authorization semantics stay unchanged.

One durable decision binds final state, identity allocation, facts and complete
bounded result. Recovery returns that exact result under current disclosure, not
a later GET, fresh Type default, new revision or another pass through members.
Changing labels can reproject identity mappings by existing input index; it cannot
change final state/outcomes. No public receipt, replica checkpoint or global
revision mechanism is introduced. The [current source map](../../../docs/design/bdp-v0.1-current-source-map.md)
records the assembled Types/common-source contract; implementation and concrete
consumer qualification remain separate.
