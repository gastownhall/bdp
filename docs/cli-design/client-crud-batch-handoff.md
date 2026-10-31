# Generic CRUD and batch client handoff

This informative handoff supplies finite acceptance inputs for Claudia's generic
client and private reference implementation. It adds no protocol operation,
capability, CLI command or exported client API. The [case table](../../fixtures/client-handoff/cases.json)
is authored against accepted PR323 receiver
`e23aec722763e967d3bde08caf96657069b39ead`, schema identity
`https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json`, and media
`application/vnd.bdp.v0.1+json`. The complete schema's actual SHA is stored in the
table; no subset is republished under its identity.

## Source correspondence and exclusions

The fixture's historical private-reference baseline is
`a1d199613d7bfbb94d532f88531347bc312b8f10`, with specification lineage
`c6dfb3c05fe707cf605030c5661123e8dda0d8f8`.
The selected Core/Write/CLI contract files used here and the full common schema
are byte-identical between that lineage and e23. The only difference within those
profile/CLI directories is `types-first-sequence.md`, outside this handoff.
OpenAPI and front-door additions on e23 provide catalog/navigation source, not a
claim that her implementation has adopted or executed it.

The separately delivered [PR321](https://github.com/gastownhall/bdp/pull/321)
source at `61c52f8ee02dd12c23dd010b496adcbc22428ad7` contains the generic
client, retained HTTP/private-SQLite implementation and alias operations. Its
original 301-case cohort remains 297 PASS/4 FAIL; four fixture-corrected cases and
three previously unrun controls passed separately. This bounded evidence does
not establish full Write, CLI or Go conformance. The historical baseline's
missing implementations and unrun status are not current PR321 status.

Pending PR325 `idRoot`, PR328 notation, the held colon clarification, richer batch
encodings, Query/List and Type installation/lifecycle are excluded. The accepted
request carriers have no `idRoot` member. A local `--id-root` without a separately
supported allocator refuses; it must not manufacture an unsupported wire field.
No ambiguous bare-colon reference is used to decide the held proposal here.

## One preparation seam, two intent kinds

Discover and validate the Scope, selected contract/media and exact operation
directory. Prepare an immutable intent containing the captured context, operation,
key and lossless complete body. Execution and saved retry use that intent, not a
fresh parse of changed files, defaults or discovery. These are responsibilities,
not prescribed language-specific class or function names.

| Canonical signature | Typed operation and closed singleton root | Dispatch/result |
| --- | --- | --- |
| `create --type TYPE` plus admitted initialization/ID/provenance flags | `createBead`, `createBeadRequest` | Discovered createBead POST; mutationResult |
| `update REF` plus admitted whole Type/object/guard/provenance flags | `updateBead`, `updateBeadRequest` | Discovered updateBead POST; mutationResult |
| `delete REF --force` plus optional guard | `deleteBead`, `deleteBeadRequest` | Discovered deleteBead POST; mutationResult |
| `link create SOURCE TARGET --type TYPE` plus admitted initialization/ID/provenance flags | `createLink`, `createLinkRequest` | Discovered createLink POST; mutationResult |
| `link update REF` plus admitted endpoint/Type/object/guard/provenance flags | `updateLink`, `updateLinkRequest` | Discovered updateLink POST; mutationResult |
| `link delete REF --force` plus admitted guard/provenance flags | `deleteLink`, `deleteLinkRequest` | Discovered deleteLink POST; mutationResult |

The exact signatures and errors remain in [the canonical CLI](bdp-cli.md#commands).
The singleton URL supplies operation kind; `operation`, `name`, an inner key and
CLI display framing are not body members. Every applied write uses the selected
media in Accept/Content-Type and one Idempotency-Key. The synthetic routes contain
deliberately irregular paths and opaque query bytes; do not derive a suffix from
an operation name or reconstruct the URL.

The selected Write directory is the closed eight-operation directory, including
putAlias and deleteAlias. Six implemented mutations alone do not make an incomplete
directory valid. The cases use a complete synthetic directory and separately test
refusal of a six-entry directory. Alias operations were absent from the historical
a1d baseline and are present in the delivered PR321 source. These fixtures qualify
neither that implementation nor the complete Write profile.

[Object edits](object-edits.md) lower independently per properties/metadata plane.
Replacement uses distinct body members; merge/keyed modes produce the specified
patch; strict patch order and empty arrays survive. Nested null is data, while a
null object input refuses. Duplicate JSON members, invalid Unicode and inadmissible
numeric literals must be caught before loss. A Type or endpoint replacement is
the whole Reference, with omitted values and exact pins preserved. A client does
not prefetch Type definitions or perform service-side default selection.

CLI `N` needs an authoritative target-local revision resolver before an intent
is frozen; its absence refuses. `=TOKEN` strips only the CLI marker and sends the
opaque string. The wire has no ordinal or `@REV` convenience syntax. `--force`
is local apply intent; without it delete is an observational GET preview, which
cannot promise admission. Dry-run member output is unexecuted JSON, not a result.

## Delivery fidelity is observable behavior

The delivery cases require original complete postimages on retained replay even
after later mutation, exact optional-member presence, a complete no-op envelope,
final-live deleted identity and selected Link owner revision context. A successful
renderer must not replace these values with a current GET or infer owner changes.

Same-key changed meaning conflicts in the shared principal/Scope namespace,
including singleton versus batch intent. Retained terminal failure stays terminal
even when its retry advice is `after-state-change`; in-progress `after-delay`
advice is transient. Transport loss leaves outcome uncertain and preserves the
same frozen retry. None authorizes automatic fresh-key or generic-JSON fallback.
See [ordinary delivery](../../specs/profiles/write/retained-write.md#standalone-key-foundation-independent-of-sequence-and-replication).

## Batch remains a separate optional intent

Version1 requires the exact atomic-batch capability and advertised member support,
one outer key, and the closed native `capabilityVersion`/`operations` wrapper.
Creates may name prior-identity bindings in admitted slots. Local JSONL assembly
and member emission are distinct from native wire JSON; raw CLI/shell input and
proposed version2 arguments/selection are not version1 features. No aliases,
sequence, chunking or independent-CRUD fallback is allowed.

The cases reuse accepted [batch publication fixtures](../../fixtures/atomic-batch/candidate.json),
including unique final outcomes and ordered identity mappings, net-zero versus
create-delete allocation, owner context, and a whole-group guard failure. They
expect no intermediate public postimages. The frozen reference does not implement
or advertise batch, so provider cases stay explicitly unsupported until that
work is delivered. See [batch](../../specs/profiles/write/atomic-batch.md) and
[final publication](../../specs/profiles/core/publication.md).

## Consumer acceptance and remaining work

First, have the CLI adapter independently parse each admitted argv and compare
its prepared intent/wire values; assert refusals send no mutation. Second, test
the generic client with a controlled transport returning the literal bodies and
lost-response scenarios; assert exact values and immutable retry dispatch.
Third, run supported six-CRUD scenarios against the private provider after its
own gate, recording actual outcomes. Run batch preparation against fixtures,
keeping provider execution unsupported until a separately qualified implementation
exists. CLI result_kind/schema framing remains outside the HTTP body.

The artifact test only checks authored schema/source correspondence. There is no
Go client, CLI compiler, provider or transaction execution claim from this handoff.
Broader Core/Write qualification and actual consumer journeys remain separate
obligations; the historical alias implementation gap is not current missing work.
Melinda owns Read/Query and profile/config/registration; Trish owns
Types semantics and normal BDP receiving. The held colon proposal needs her
disposition, not an implicit change in these cases.
