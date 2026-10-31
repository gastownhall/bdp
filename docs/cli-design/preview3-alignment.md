# Preview3 CLI alignment with the v0.1 candidate

This proposed CLI delta follows Donna's October 23 overnight dispatch in Janet's
chat, human message `01a16c1a-3334-70c3-98a6-539326218f43`, and its settled delivery
plan. It is based on the composed draft BDP PR301 source. It changes neither BDP's
v0.1 identity nor protocol/schema fields, default branches, implementation or release
pins. CLI syntax, product extensions and runtime qualification are separate claims.

The generic executable remains `bdp`, with the `bd <verb>` / `bd link <verb>` shape.
Beads' native Issue workflows, Memory and graph conveniences are product extensions,
not mandatory Core features. Cleo owns product CLI implementation; Melinda graph/
Memory reads; Janet revision/ID allocation and integration; Trish concrete Types
and BDP integration; Iris import; Sybil canonical CLI semantics and source review.

## Shared signatures and unchanged wire

| CLI | Lowering / boundary |
| --- | --- |
| `show ID@N` | Resolve stable store-local ordinal, then ordinary exact `revision=TOKEN` |
| `show ID@=TOKEN` / `show ID --revision TOKEN` | Exact historical GET; token options remain literal |
| `show ID@current` | Current Resource read; no fabricated historical token |
| `update ID --if-revision TOKEN` | Unpinned write target plus exact expectedRevision guard |
| `create --type T` / `update ID --type T` | Set affiliation; omitted update Type preserves it |
| `list --type T` / `--exact-type T` | Existing conformsTo family / type nominal predicates |
| `link create SOURCE TARGET` | Native createLink source/target References |
| `link create SOURCE --to TARGET` | Same unique endpoint bindings |
| `link create --from SOURCE --to TARGET` | Same unique endpoint bindings |
| `link list [A [B]]` | One current Link population; direction/applicability compiled before pagination |
| `link list --from A --to B` | Existing structural source=A AND target=B URI predicates |
| Generic `--source-revision` / `--target-revision` | Exact endpoint token; product typed operations below |
| `--if-source-revision` | Existing product source guard; no new generic wire guard |
| Product historical `--from-revision` | Selected retained-content edit/recovery; not an endpoint spelling |

Authoring admits exactly the three endpoint forms above. Refuse duplicates even if
equal, lone endpoint flags and inverted `--from SOURCE TARGET`; the permitted mixed
form is SOURCE plus --to TARGET. Remove preview-only Link endpoint --source/--target
and Memory --by. Native ordinary 1.3 `bd link ID1 ID2` and `dep` forms retain their
blocker direction. Comparison --from/--to remain revision selectors; Event --from
remains a replay starting mode. Alias put --target is a routing field, not a Link
endpoint. Link commands with Resource positionals use explicit/default Scope.

All five Memory authoring verbs—reference, supersede, requires, defines, subject-to—
share those signatures and the Link success renderer. Type/package semantics supply
the corresponding operation; supersede preserves old → replacement direction.
The [Memory CLI companion](memory-cli.md) collects their complete command contract,
the ten focused relationship reads and an informative task walkthrough, with its
Type-design dependency and implementation correspondence kept explicit.
An inappropriate native supersedes selection on Memory explains the live-Issue
requirement and points to superseded-by; no silent Type substitution or claim that
every native Dependency kind blocks scheduling.

### Product endpoint pin operations

Beads retains documented typed endpoint-flag operations: current means pin to the
checked current revision, and unpinned means float the endpoint. These are product
authoring intents resolved by its authoritative writer, not opaque token comparison
or new BDP Reference sentinels. Generic bdp token flags stay literal. `ID@=current`
and `ID@=unpinned` always name exact tokens with those spellings; they must not turn
into product operations through a string-sentinel comparison. Suffix plus explicit
endpoint flag still refuses. Only @N, @=TOKEN and @current are convenience suffixes;
@unpinned is not a selected incidence/current alias. Current-selection applicability
and current-pin authoring remain different operations.

These are contract examples, pending qualification against the built product:

| Command | Endpoint intent |
| --- | --- |
| `bd link create A B --type types/references --target-revision current` | Pin B to its checked current token |
| `bd link update L --target-revision unpinned` | Float L's target through the product writer |
| `bd link create A B@=current --type types/references` | Pin B to the literal token current |
| `bd link create A B@=unpinned --type types/references` | Pin B to the literal token unpinned |
| `bdp link create A B --type Relates --target-revision current` | Generic token flag: literal token current |

## History and allocation adapters

Token generation is unchanged. `@N` means a stable store-local Resource/history
ordinal, `@=TOKEN` an exact portable token, `@current` explicit current. N is a positive int64; explicit
token flags bypass the suffix parser. Numeric
tokens remain representable with @= or the explicit literal flag. Generated forms
need no shell glob/bracket/# syntax; arbitrary exact values retain JSON/literal
escapes. See [selector parsing](scope-and-references.md#revision-selectors).

Human versions output can use SEQ and include deletion events after recovery. A
deletion entry is not a live snapshot or a source for historical content copying.
The native BDP versions page remains unchanged: its version rows cannot acquire
fictional deletion revisions. A product timeline must obtain event evidence from
its actual history adapter and keep full old tokens addressable. Generic BDP without
that evidence keeps its ordinary versions descriptor and honest limitations.

Short generated Resource names are canonical identities, not display abbreviations.
The generic Memory/Link allocator starts with six lowercase URL-safe characters.
Ordinary native Issue allocation retains its already-short allocator and supported
native prefix conventions; no new 32-character fallback or six-character total-ID
promise follows. Both atomically reserve the complete name across Resource kinds,
consumed/deleted identities and conflicting aliases/navigation. Retry collisions
within the allocator, with bounded lengthening where applicable;
never treat live-row absence as a lifetime reservation. Disconnected allocation/
merge conflict behavior must be disclosed by that implementation. No old identity
is rewritten and the protocol imposes no mandatory token/ID length.

`--id-root` on product create/link create is an explicit allocation prefix; reject
with --id, use the shared import-root grammar, and keep the default flat rather than
source-derived. Native Issue root allocation uses the authoritative Issue writer
wrapper and the same lifetime collision boundary. Product root validation/allocation
happens at the service under selected [id-root1](../../specs/profiles/write/id-root.md).
Generic create sends `idRoot`; the service appends an opaque segment and reserves
the complete identity with the Resource and retained outcome. No GET can reserve
an ID and no retry may switch to a fresh key after an uncertain result. Offline
emission preserves the root without allocating. Rooted batch creates require the
explicit id-root1/atomic-batch1 composition; unextended batch1 stays unchanged.

## Type and rendering boundaries

The [human contract](read-output.md#common-human-documents-and-rows) shares Bead/Link
documents, ID-then-[Type] rows, selected revision context and exact endpoint pins.
Human local shortening removes only the exact Scope prefix. Full canonical
identities, Type References and tokens survive structured output and long details.
Friendly concrete labels cannot conceal an abstract or different declared Type.

Generic BDP inventory remains domain-neutral. Beads' omitted Bead Type selects the
Issue family; --type any selects all. Native bare task/blocks are product classification
resolvers to actual concrete child Type URIs, not generic BDP prefix inference.
Use the full concrete URI/Reference for portable equivalence. Exact filtering is
nominal identity, not definition-pin equality; family filtering uses the selected
Types authority. Do not mechanically reinterpret search/ready/dep/query filters.

The earlier list full-URI-/any clause remains a draft author choice. Donna's native
configured-any/full-URI compatibility boundary is not settled by the graph decision
below; no stored identity may be reinterpreted merely by basename.

## Graph and Memory read extensions

Graph keeps the Dependency-family default and identifies that active filter.
--link-type T selects a family, --exact-link-type T nominal identity, --link-type any
the wildcard; replace preview-only --all-link-types. Repeat selections form a union
with common direction/depth. The settled graph exact full Type URI escapes a literal
name; wildcard syntax is a CLI selector, never a Type identity sent as any.

Nodes/Links use [Type]. Empty results use plain language, and an actual depth boundary
is disclosed without default frontier/complete bookkeeping. Generic graph displays
current Bead records alongside Links' exact stored endpoint pins, which may name
older revisions; it does not resolve those older endpoint bodies or float the pins.
Specialized Memory relationship reads bind current-compatible pins and refuse a
mismatch. Historical root selection is separate admission, never silent current
fallback or literal-sibling shadowing. Acquisition refusal never becomes a successful
empty/complete result. An omitted
non-Dependency notice requires actual authorized reached-incidence evidence, on
stderr only. Do not scan the whole store for diagnostics or imply that no other
Links exist when only a filtered set was acquired. General historical graph traversal
is not added. These commands require a product traversal adapter: BDP's bounded
collection Selector has no joins, recursive traversal, aggregation or reachability.

## Semantic review and acceptance matrix

This is the review ledger for the feedback items, not a runtime PASS. Exact author
diffs and source-bound validation remain required. Shared protocol/schema/fixture
bytes are intentionally preserved; old CLI fixture strings are previous paper inputs.

| Feedback items | Required contract / review check | Implementation owner |
| --- | --- | --- |
| 1–7 | Same current/retained document; exact content; ID then actual Type; shared create/Memory acknowledgement; exact local shortening; structured values preserved | Cleo |
| 8–10, 32 | Graph Type flags/labels, real depth vs acquisition gap, evidence-based omitted notice and clear empty/help output | Melinda |
| 11 | Native supersedes error explains actual kind/Issue admission and Memory direction | Cleo + Trish |
| 12 | Subcommand help hides inherited global listing only; root/help --all complete, flag acceptance unchanged | Cleo |
| 13, 17 | @N/@=TOKEN/current disambiguation; stable ordinal mapping; unchanged token generation; deletion timeline is not a Resource version | Janet resolver + Cleo display |
| 14–16 | Short canonical allocation, complete lifetime reservation, flat default, explicit shared --id-root; no implicit source naming or identity rewrite | Janet + Iris helper |
| 18–21 | Current-live zero/one/two-operand selection; out/in/both; per-endpoint applicability; self-Link once; count parity and truthful native continuation | Cleo |
| 22–23 | Family/nominal filter meaning and native/default boundaries; no implicit native search/ready/query expansion | Cleo + Trish |
| 24–25 | Three authoring forms; --from/--to to source/target; no duplicate bindings; pins/guards/history/comparison remain distinct | Cleo |
| 26–27 | Product historical Link edit/recovery uses exact retained content; stored pins never float; generic endpoint mutation still unsupported | Janet author + Melinda |
| 28 | Real concrete Type identity, abstract admission, current/retained affiliation and inventory/JSON/HTTP agreement | Trish |
| 29, 34 | Literal public IDs, original retained addresses, owned/source lifecycle fidelity and no implicit kind namespace | Janet + Trish |
| 30–31 | Import processes supplied Memory rows by default; --include-memories names the old export, not a new import flag; exact IDs/body/title and whole-file refusal | Iris |
| 33 | Informational Links do not become native scheduling blockers | Cleo + Trish |
| 35–36 | Preserve Donna annotations; documentation/source/binary/playground claims tied to actual reviewed integrated state, with explicit gaps | Janet |

Paper controls include numeric token versus ordinal, literal @ IDs, suffix plus
literal flag conflicts, deleted ordinal refusal, pin/current races, foreign/missing
mapping, reversed/self-Link pairs, empty-but-continuable pages, root versus explicit
ID refusal, legacy native dependency direction, exact Type pin preservation and
machine-output diagnostics. These are acceptance obligations; this source change
does not claim a parser/compiler/provider, native allocation or renderer ran them.
