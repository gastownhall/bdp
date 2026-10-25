# Proposed `bd type` command set

**Status: Trish's design proposal for Donna, not an accepted CLI or protocol contract.**
This supplies concrete choices for the gaps in the [Types CLI companion](types-cli.md).
It changes no settled Type meaning, current command, schema or implementation.
Recommendations below need review before paired CLI/BDP specification changes.

The [Types profile](../../specs/profiles/types/types.md#72-definition-origin-installed-identity-and-publication-authority)
already separates a definition's existence, exact registration, local write default
and retirement. The command set should make those distinctions easy to use.
It should not require a second way to create and edit ordinary Beads or Links.

## Recommended command set

| Command | Purpose |
| --- | --- |
| `bd type list [SCOPE]` | List exact revisions registered in this Scope, including retired revisions. |
| `bd type show TYPE` | Read one exact definition; a bare identity selects its explicit local write default. |
| `bd type register EXACT-TYPE... [--from SOURCE-SCOPE]` | Explicitly accept the complete required exact graph, optionally acquiring it first. |
| `bd type default show TYPE` | Inspect the Scope's write-default selection, including an explicit absence. |
| `bd type default set EXACT-TYPE` | Select an eligible registered exact revision for future unpinned writes. |
| `bd type default clear TYPE` | Remove that selection without changing any instance. |
| `bd type retire EXACT-TYPE...` | Stop new affiliations with those exact revisions while retaining their meaning. |

I recommend these seven leaf commands, with three under `default`. In particular,
there is no separate `install`: `register --from` makes the combined acquisition
and acceptance action explicit. There is also no `unregister`, physical purge,
automatic upgrade, migration or second Type CRUD vocabulary in this first cut.

## Walkthrough (informative)

### Accept a contract deliberately

Suppose a registry publishes Product at exact token `product-1`. The working Scope
does not yet admit that Type, even if someone has read or cached its definition.
Registration asks this Scope to accept its complete exact dependency graph.
The source Scope is an interpretation service; its URL is not inferred from a
Type ID, nor proof that it owns every returned definition.

```sh
# Explicitly acquire and register this exact Product graph in the working Scope.
bd type register '[https://catalog.example/Product]@=product-1' --from https://catalog.example/ --scope https://work.example/

# Inspect what this Scope has actually registered.
bd type list --scope https://work.example/

```

The canonical URLs and tokens are authored illustrations, not production seed identities.
The registered definitions retain their canonical IDs, exact revisions and recorded
origin contexts; this is not a copy under newly allocated local IDs.

### Choose future unpinned writes

Registration leaves the write default unset. Exact Product affiliations are now
eligible subject to the contract and ordinary authorization, but bare `--type Product`
still refuses until a default is explicitly selected. Choosing a default does
not migrate any existing record. Installing another revision will not replace it.

```sh
# Choose the exact revision for future explicitly unpinned Product writes.
bd type default set '[https://catalog.example/Product]@=product-1' --scope https://work.example/

# Inspect the selection without fetching the definition or changing it.
bd type default show https://catalog.example/Product --scope https://work.example/

# Inspect the complete definition selected by that default.
bd type show https://catalog.example/Product --scope https://work.example/

```

`default show` reports availability state; `type show` reports a definition.
If another writer changes the default after selection, the shown exact definition
remains the selected revision, not a claim about the later default.

### Keep old meaning while moving forward

Product revision `product-2` can be registered alongside `product-1`. The old
default and all stored affiliations remain unchanged until an explicit action
changes them. Retiring `product-1` stops new affiliations with that exact revision.
Its existing instances, valid content edits and retained historical interpretation
continue under the unchanged contract.

```sh
# Accept a later exact revision without silently selecting it.
bd type register '[https://catalog.example/Product]@=product-2' --from https://catalog.example/ --scope https://work.example/

# Deliberately choose the later revision for future unpinned writes.
bd type default set '[https://catalog.example/Product]@=product-2' --scope https://work.example/

# Retire the old exact revision without deleting it or migrating its instances.
bd type retire '[https://catalog.example/Product]@=product-1' --scope https://work.example/

# Read the retained old contract explicitly.
bd type show '[https://catalog.example/Product]@=product-1' --scope https://work.example/

```

Retirement clears a default only if it still names a revision being retired.
It never chooses a replacement. Dependencies needed by other registered Types
remain retained and interpretable; retirement of a parent is not transitive retirement.

## CLI specification proposal

### Common rules and flags

**Scope.** All commands need an interpreting or destination Scope. Use the common
precedence `--scope`, environment, configuration. Only `list` also takes a positional
Scope, conflicting with `--scope` even when equal. An absolute Type URI does not
select the receiving Scope: a definition's origin and its local availability are
different things. Source acquisition uses the separate `--from` binding.

**References.** Reuse the coordinated canonical Reference grammar, including
`ID@=TOKEN`, quoted absolute-URL selector forms and exact JSON Reference escapes.
The future shared grammar is owned by Sybil; this proposal adds no standalone
revision flag or new token parser. An ordinal is admitted only with an existing
truthful mapping in the selected context; it is frozen to an exact token before
use and never inferred from inventory order. `@current` is not admitted here.
Write operands requiring exact revisions reject bare identities rather than
silently consulting defaults. Identity operands reject pins. Preserve whole IDs;
do not prepend `types/`, infer category from a basename, or invent a Type name field.

**Rendering.** Propose the shared `--output-format` flag, defaulting to `default`.
`list` accepts `default|table|detail|json|jsonl` with default table; other commands
accept `default|detail|json|jsonl` with default detail. Machine framing follows the
shared envelope/header/item/terminal conventions, with new Types descriptors below.
No field masks, properties-only view, incident aggregate, HEAD or HTTP-condition
flags are included in this first Type command cut. Ordinary read commands retain
their own options. Configured authentication and transport behavior remain shared.

**Durable mutations.** `register`, `default set/clear` and `retire` propose the
common `--idempotency-key KEY`, `--retry-file FILE`, and `--emit-operation` controls.
The retry file is exclusive with new semantic input; it supplies frozen operands,
Scope, contract, acquired graph where applicable, operation binding and key.
Emission is mutually exclusive with retry and explicit key selection: it emits
the proposed native input without execution or successful-admission claims.
It cannot fetch dependencies or resolve defaults, ordinals or aliases. A missing
literal acquired graph therefore makes `register --from --emit-operation` refuse.
This requires extending the common emitter's admitted operation set; current
six-CRUD emission support is not already support for these new operations.

Every entry lists its accepted flag groups. The groups mean exactly these flags:

| Group | Flags and defaults |
| --- | --- |
| Context | `--scope SCOPE`; common explicit/environment/config precedence. |
| Rendering | `--output-format FORMAT`; supported values above, no output projection. |
| Mutation | `--idempotency-key KEY` or `--retry-file FILE`; proposed `--emit-operation` with the exclusions above. If executing without a key, the common client creates and journals one. |
| Collection | `--paged` / `--unpaged` mutually exclusive; existing common default and `--page-size N`, `--limit N`, `--continue TOKEN` semantics. Continuations preserve the original Scope and filters. |

The shared paging default remains the common collection policy, not a new package
default. No accepted common flag is implied merely by a similar-looking command.
The paired common-source pass must bind these additions without copying stale
general CLI text over Donna and Sybil's ongoing revisions.

### `bd type list`

Show the Scope's registered exact definitions, including foreign and retired ones.

**Usage.** `bd type list [SCOPE] [--kind bead|link] [--state active|retired|all]`

**Arguments.** Optional positional Scope; no Type operand. `--kind` classifies
instances of the described Type, not the definition Bead's Resource kind.

**Flags.** Context, Rendering and Collection groups. `--kind` omitted means both
categories. `--state` defaults to `all`; `active` means not retired, not necessarily
concrete or authorized for creation. No name substring, conformance-family or
arbitrary query filters in the first cut.

**Behavior.** One item per registered `{uri,revision}`. Include intrinsic definitions
under their implementation-supplied availability; omit mere cache entries and
unregistered authoring Beads. Include registered dependency definitions as well as
explicit roots. An abstract Type is visible. Default ordering is canonical URI,
then opaque revision token as text solely for stable ordering, never chronology.
Ordinary pagination does not promise a coherent snapshot or reveal inaccessible rows.

**Results.** Propose `type_inventory` with native `items` and exact `next`. Each
item has `reference:{uri,revision}`, `category:bead|link`, `abstract:boolean`,
`retired:boolean`, `writeDefault:boolean`, and `originScope` when recorded.
These are inventory facts, not a complete definition or a creation permission grant.
No definition is fetched merely to render a row. Human columns show the same facts;
JSONL has one item per inventory row and truthful shared completion metadata.

**Errors and exit status.** Common parsing, capability, authorization and read errors.
An empty permitted inventory succeeds. A missing required inventory capability
refuses; it is not an empty list or a fallback graph query.

**Canonical CLI correspondence.** This is a general CLI inventory command with a
new Type inventory binding. It cannot lower to `bd list --type BeadType` or a union
of BeadType and LinkType graph queries. The BDP amendment must define matching
filters, ordering, continuation, admission and item schema; no fixed URL is proposed.

**Examples.**

```sh
# See nonretired registered Link Types, including abstract definitions.
bd type list --kind link --state active

```

### `bd type show`

Read a complete exact definition through the selected interpreting Scope.

**Usage.** `bd type show TYPE`

**Arguments.** One exact Type Reference, or an unpinned identity. An exact operand
uses that pair directly. An unpinned operand means this Scope's explicitly selected
write default; it never means origin current, newest registered or sole revision.

**Flags.** Context and Rendering groups only.

**Behavior.** Exact lookup uses the existing
[version-1 definition-read binding](../../specs/profiles/core/type-definition-read.md).
It preserves the full definition, captured owned state and recorded origin context.
No registration is implied; an authorized readable exact candidate may still be
unregistered. Bare input first observes the explicit local default and then reads
that exact definition. Record the actual selected pair; this two-operation form
does not promise an atomic joint view of default and definition. Missing default
refuses, with a suggestion to list or provide a pin. It does not create a default.

**Results.** Propose `type_definition`; data preserves the native
`{definition,originScope?}` wrapper. Outer CLI context identifies interpreting
Scope and selection `exact|write-default` with the resolved exact Reference.
Do not label it an ordinary Resource response, flatten origin into ownership,
recompute historical Links from live adjacency, or claim dependency closure success.
Human detail can summarize the descriptor but must retain the exact identity and
origin distinction; machine output keeps the full wrapper.

**Errors and exit status.** Preserve actual lookup Problems, including its narrow
authorized `revision-unretained` case. No History/current/default substitution for
a failed exact read. Missing-default is an availability-selection failure, not
a claim the definition does not exist. No general application History is required.

**Canonical CLI correspondence.** New explicit general Type command maps to existing
exact definition-read, preceded only for bare input by proposed default inspection.
Ordinary `bd show` keeps its Resource/History contract. The new output descriptor
must be paired with the common framing registry, not called `resource` for convenience.

**Examples.**

```sh
# Inspect an exact contract even when another revision is the current default.
bd type show Product@=product-1

```

### `bd type register`

Accept exact definitions and their complete required graph for use in this Scope.

**Usage.** `bd type register EXACT-TYPE... [--from SOURCE-SCOPE]`

**Arguments.** One or more exact Type References; duplicates of the same pair are
deduplicated. Different revisions of one identity remain different roots. Bare
identity, `@current` and a request to register every future revision refuse.

**Flags.** Context, Rendering and Mutation groups. Optional `--from SOURCE-SCOPE`
names one source interpretation service for the complete graph. No `--default`,
automatic activation, migration, `--force` or trust-bypass option.

**Behavior.** Without `--from`, the destination must already hold complete candidate
records or registered dependencies needed for admission. Do not fetch origin URLs.
With `--from`, the client explicitly reads complete exact records from that service,
following recorded metatype/conformance dependencies and schema-resource bindings
with visited exact-pair tracking and configured bounds. Use credentials scoped
to each service; never forward destination credentials to the source. No hidden
fetch from a further origin is authorized by one returned URI.

Freeze the acquired graph before destination dispatch; exact records cannot be
replaced with newer revisions or live incident Links. Acquisition is a read phase,
not acceptance. A failed read registers nothing. The destination validates the
complete required graph, exact-copy consistency, supported schema semantics,
trusted bootstrap bindings, authority evidence, local policy and operational bounds,
then registers all newly requested definitions atomically or none. Existing
registrations are preserved on refusal; acquired bytes may remain unregistered.
Registration never rewrites IDs, grants publisher authority, creates a default,
upgrades instances or turns an abstract Type concrete.

Already registered identical exact definitions are a no-op. Conflicting content
under a known exact pair refuses; do not choose a digest/signature scheme by example.
A retired exact revision does not become active when registered again; return its
retired state. The graph payload/authority-verification format needs the paired
protocol design; this proposal does not claim a portable import/export format.

**Results.** Propose `type_registration`, preserving exact requested roots and actual
accepted/no-op state, with per-definition newly-registered/already-registered and
retired facts. One complete mutation result, not a synthetic stream of independent
successful registrations. A failed mutation cannot leave successful new entries.

**Errors and exit status.** Common durable mutation outcomes; no new numeric exit
codes. Distinguish local acquisition failures from actual destination Problems.
Unknown mutation result uses the common same-key recovery path, not a fresh
acquisition or key. Missing dependencies, incompatible copies, denied authority or
unsupported required semantics refuse without partial registration.

**Canonical CLI correspondence.** Proposed `registerTypeGraph` semantic operation
with exact roots and a complete acquired graph when supplied. No faithful lowering
to ordinary create or current shared atomic-batch operations exists. Pair a narrow
Types operation capability and native request/result schema with this command;
do not add an untyped action string to an existing closed operation union. There
is no requirement to expose a public durable acquisition staging resource.

**Examples.** These local candidates use their whole IDs in the destination Scope.

```sh
# Register two already retained candidate roots as one admitted graph.
bd type register Product@=product-1 ApprovedProduct@=approved-1

```

### `bd type default show`

Inspect the write default without fetching or altering a definition.

**Usage.** `bd type default show TYPE`

**Arguments.** One unpinned Type identity; no exact revision selector.

**Flags.** Context and Rendering groups.

**Behavior.** Read this Scope's explicit selection. Never infer one from available
revisions. Authorized inspection can report no selection even when definitions
exist. Normal nondisclosure applies; absence is not an origin existence oracle.

**Results.** Propose `type_default` with canonical `uri` and
`reference:{uri,revision}|null`. The exact Reference is the selected default; null
means none. This is availability state, not the Type definition Bead or its revision.

**Errors and exit status.** Authorized no-selection succeeds with null. Denied or
unsupported inspection uses the common failure contract, never fabricated null.

**Canonical CLI correspondence.** Proposed local Type-default read. It cannot use
an arbitrary property on the publisher's definition or infer state from inventory
order. The service must supply an authoritative explicit selection.

**Examples.**

```sh
# Ask whether unpinned Product writes have a selected contract.
bd type default show Product

```

### `bd type default set`

Select one registered exact revision for future explicitly unpinned writes.

**Usage.** `bd type default set EXACT-TYPE`

**Arguments.** One exact Type Reference; its identity is the default being changed.

**Flags.** Context, Rendering and Mutation groups. No implicit acquisition flag.

**Behavior.** Require an admitted registered, nonretired, concrete exact revision.
Validate selection and replace the default atomically. Setting the same selection
is a no-op. Concurrent successful selections serialize; the last committed choice
wins. This first cut has no client read/modify/write or new registry-revision guard.
Existing affiliations, family queries and omitted-Type updates remain unchanged.

**Results.** `type_default` mutation result with actual previous and resulting
selection. It is not a revised definition or proof a future instance write succeeds.

**Errors and exit status.** Common durable mutation contract. Unregistered, retired,
abstract or otherwise ineligible selection refuses without changing the old default.

**Canonical CLI correspondence.** Proposed `setTypeDefault` semantic operation with
canonical Type identity and exact selection. Admission occurs at the authority,
not through client validation followed by an unconditional property edit.

**Examples.**

```sh
# Deliberately select this registered exact Product revision.
bd type default set Product@=product-2

```

### `bd type default clear`

Remove a write default while leaving definitions and stored affiliations intact.

**Usage.** `bd type default clear TYPE`

**Arguments.** One unpinned Type identity.

**Flags.** Context, Rendering and Mutation groups.

**Behavior.** Atomically clear the actual current selection. Already absent is a
no-op. Future explicitly unpinned writes refuse until a default is selected again;
explicit eligible pins still work. This is not retirement or an identity tombstone.

**Results.** `type_default` mutation result with previous selection and resulting null.

**Errors and exit status.** Common durable mutation contract and nondisclosure.
No selection is a successful no-op, not a missing-definition error.

**Canonical CLI correspondence.** Same proposed default-setting operation with
an explicit null selection, not an omitted member. Existing exact definitions
are not mutated or deleted.

**Examples.**

```sh
# Require callers to choose an exact Product revision until a default is set again.
bd type default clear Product

```

### `bd type retire`

End new affiliations with exact revisions while retaining existing interpretation.

**Usage.** `bd type retire EXACT-TYPE...`

**Arguments.** One or more exact Type References, deduplicated by exact pair.
No implicit identity-wide or transitive retirement.

**Flags.** Context, Rendering and Mutation groups. No force, replacement-default,
purge, migration or unretire flag in this cut.

**Behavior.** Retire all requested registered revisions atomically or none. In the
same commit, clear every local default that still selects a requested revision.
Default selection and retirement serialize so no retired default can survive the
race. Already retired is a no-op; unregistered or intrinsic requests refuse the
whole operation. Do not recursively retire descendants or dependencies. A child
registered with a retired parent still retains that parent's requirements; using
it does not create a direct affiliation with the parent.

Existing instances can keep validly editing their content without changing Type.
Explicit retyping into a retired exact revision refuses; retyping out remains
subject to normal checks. No history rewrite, physical erasure or automatic
recovery/unretirement follows. A future reversal command needs its own design.

**Results.** Propose `type_retirement` with exact requested references, actual
changed/no-op statuses and defaults cleared by this commit. No invented Resource
revision or shared transaction token is assigned by the renderer.

**Errors and exit status.** Common durable mutation contract. Authorization,
unknown registration or intrinsic immutability refusals leave all requested
retirement/default state unchanged. Retained reads keep the existing lookup errors.

**Canonical CLI correspondence.** Proposed `retireTypeRevisions` semantic operation
with exact references. One native transaction includes required default clearing;
it is not a client loop over ordinary delete/default commands or a new use of a
closed shared batch grammar.

**Examples.**

```sh
# Retire these exact revisions together, retaining all required historical meaning.
bd type retire Product@=product-1 ApprovedProduct@=approved-1

```

## Authoring uses the ordinary graph model

Define or revise local Type Beads through `bd create` and `bd update`, affiliated
with the appropriate exact BeadType/LinkType definition. Author Refines Links
through `bd link create` and ordinary graph edits under the accepted ownership
and transaction rules. Combine changes with the existing faithful atomic batch
when their final-state integrity needs it. Type-category detection is semantic,
not a path prefix or a second authored category field.

Definition authoring never registers the Type described, selects a default or
grants publication authority over an imported ID. Ordinary `bd show` inspects the
owning Resource, with History where needed; `bd type show` interprets an exact
definition in a chosen Scope. An explicit fork is a new ordinary definition with
a new identity; copying is not evidence of Refines conformance. I recommend no
`type create/update/delete/fork/refine` shortcuts until repeated use shows a need.

## Protocol changes needed if we accept this proposal

| Surface | Reuse | New paired work |
| --- | --- | --- |
| Exact definition inspection | Existing definition-read capability/version1, complete wrapper and Problems. | Usable Type command and `type_definition` CLI descriptor; explicit default-selection pre-read for bare input. |
| Inventory | Shared discovery, native collection paging/completion and normal nondisclosure. | Registered exact inventory row/filter/order/continuation contract; `type_inventory` CLI descriptor. |
| Default inspection | Common authorized reads and Scope context. | Explicit selection read and `type_default` descriptor. |
| Registration | Exact retained records, accepted atomic graph admission, ordinary durable mutation principles. | Types capability, complete graph input/authority validation, `registerTypeGraph` request/result and transport binding. |
| Default changes | Existing semantic local-default rules and durable mutation principles. | `setTypeDefault` with exact/null selection and actual previous/result state. |
| Retirement | Existing exact retirement and retained-use rules. | `retireTypeRevisions`, atomic default clearing and result schema. |

These operation names are candidate native intents, not published operation-kind
literals or chosen URLs. Discover actual bindings; do not append `/types`, scrape
graph inventory or overload generic CRUD. New operation capabilities must say what
they support, including durable retries; absence refuses before dispatch. No new
endpoint per CLI alias is required, and no new shared Core transaction token,
replication, public receipt resource or runtime adoption is implied.

The protocol pass must specify complete request/result/error/discovery schemas,
authorization and whole-graph operational limits alongside the CLI signatures.
Until that paired work lands, these are implementable design recommendations with
explicit binding work, not executable commands or a claim that CLI-only glue suffices.

## Decisions to challenge first

| Question | Recommendation | Alternative and tradeoff |
| --- | --- | --- |
| Should `show Product` work without a pin? | Yes: read its explicit local write default, report the selected exact pair, no atomic joint-view promise. | Exact-only is purer and needs fewer bindings, but makes the common inspection path need two commands. |
| Should acquisition have a separate `install` verb? | No initially: `register --from SCOPE` explicitly requests acquisition followed by atomic acceptance. Without `--from`, use retained candidates only. | Separate acquire/install/register stages offer more workflow control but add states and vocabulary before we have a portable package contract. |
| Should registration also select a default? | No: use explicit `default set`, even with a sole revision. | A combined flag saves one command but couples availability with future unpinned behavior. |
| Should list hide retired or abstract Types? | No: show all registered exact revisions by default and label their state; offer explicit kind/state filters. | Active-only is shorter but hides retained contracts and makes diagnosis harder. |
| Should retirement require a replacement default? | No: clear the affected default atomically; callers can select another before retiring. | Requiring replacement avoids an unpinned-write interruption but makes intentional removal awkward. |
| Do we need guarded default edits now? | Not in the first cut: atomic admission, common idempotency and last committed selection. | Compare-and-set could prevent competing administrators overwriting choices, at the cost of another availability-state concurrency contract. |

Physical removal, unretirement, registry browsing/search, publication, portable
package/import/export format, automatic upgrades and migration remain future
design. Their absence does not justify deleting definitions needed for current
instances/history or treating caches as registrations. Sources remain the current
Types profile, the [descriptor](../../specs/types/type-system/type-system.md),
the [CLI interpretation seam](exact-definition-read.md), and existing
[BDP59](https://github.com/gastownhall/bdp/issues/59)/[#282](https://github.com/gastownhall/bdp/issues/282).
