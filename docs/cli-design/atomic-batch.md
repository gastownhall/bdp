# Canonical CLI: optional atomic batch

CLI-first #152 source, paired with the [batch protocol](../../specs/profiles/write/atomic-batch.md)
under sole #59. Use the ordinary [object edits](object-edits.md), [affiliations](affiliations-and-owned-state.md)
and [Scope binding](scope-and-references.md). This is paper design, not an implemented
compiler/provider. The concrete choices below extend C1; they are reviewable author
choices, not new human rulings. [Event D1/D2 are now answered](event-decisions-20261022.md).
Donna has also selected [final publication and net-no-op behavior](../../specs/profiles/core/publication.md).
The result shapes below replace the earlier unadopted per-member postimages.

The newer [batch overview](overview/06-batch.md) and
[selection design notes](batch-selection-design.md) explore named List/Query
bindings and a shared `--dry-run-mode` surface. They are review proposals for an
explicit extension. This version-1 source continues to admit only six CRUD
members; its closed grammar and existing capture semantics are unchanged.

## One document, one decision

```sh
bdp batch --file review.bdp --input-format cli
bdp batch --file review.json --input-format json
bdp batch --file review.bdp --input-format cli --emit-batch
bdp batch --retry-file private-replay.json
```

`--file` is required except in retry-file mode; `-` reads stdin. Format defaults to
`json`, never inferred from an extension. The outer invocation selects one Scope,
contract, authenticated context and key. Default Scope applies once; an explicit
positional Scope and `--scope` conflict. Per-member Scope/connection/output/retry
settings refuse. Batch admits exactly create/update/delete and their `link` forms.
No alias/read/set/domain operations, sequence, partial prefix or automatic chunking.
The capability extends Write and does not waive its ordinary singleton obligations.
An adapter with only independent CRUD cannot claim this capability by iterating.

Capability identity is `https://github.com/gastownhall/bdp/capabilities/atomic-batch`,
exact version `"1"`. Discovery supplies its POST `operation` URL, supported
`operations` subset and optional bounds. Current CLI implements only 1; no version
ordering or generic JSON fallback. The compiler emits required `capabilityVersion:"1"`
in the shared JSON wrapper. JSON input supplies the same closed wrapper; this field
is not a per-member option or a new user-facing protocol-version flag. A missing
selector is malformed; a valid unsupported selector refuses before interpretation
of that version's body. No silently selected default version.

## Literal command files

UTF-8 logical lines contain ordinary signatures without the executable. Ignore
blank lines. This is a tokenizer, never a shell:

1. Unquoted spaces/tabs separate arguments; newline ends a command. Unquoted
   backslash quotes the next character; backslash-newline joins physical lines.
2. Single quotes preserve everything until the closing quote. Double quotes
   preserve text; backslash escapes a double quote or backslash, otherwise remains
   literal. Quoted newlines are data. Adjacent spans form one token, including empty quotes.
3. At an unquoted token boundary, `#` starts a physical-line comment. Within a
   token/quotes it is data. Quotes/backslashes must finish; NUL refuses.
4. Unquoted `; | & < >` refuse; quoted/escaped forms are data. Dollar signs,
   backticks, parentheses and glob characters have no expansion or execution.
5. Outside quotes CRLF is a line boundary; quoted UTF-8 data stays authored.
   Diagnostics identify physical line/argument without echoing sensitive values.

Local value-file paths resolve against the command-file directory (invocation
working directory for stdin). Only the outer batch consumes stdin: member `@-`
refuses. Parse all commands and freeze all local inputs before dispatch. A malformed
last line/file leaves the document unsubmitted. Delete members require `--force`;
it carries apply intent and emits no wire field. Ordinary Type/patch/replacement/
metadata/guard/provenance semantics are identical to standalone commands.

```text
create --name task --type Task --properties '{"title":"Review BDP"}'
link create @task task-17 --type Relates
```

With command Scope `https://work.example/acme/`, this compiles to:

```json
{
  "capabilityVersion":"1",
  "operations":[
    {"operation":"createBead","name":"task","type":"https://work.example/acme/Task","properties":{"title":"Review BDP"}},
    {"operation":"createLink","type":"https://work.example/acme/Relates","source":"@task","target":"task-17"}
  ]
}
```

`--name NAME` applies only to creates; names are unique and match
`[A-Za-z][A-Za-z0-9_-]*`. `@NAME` denotes the identity of an earlier creation
in an admitted Resource-reference position, not its revision or arbitrary output.
Unknown/forward/wrong-kind handles refuse the whole batch. Type references and
caller-assigned IDs cannot capture a handle. A property string `"@task"` stays data.
A whole `@NAME` handle is recognized only in this batch capture context; a suffix
`ID@N` is a local revision selector and `ID@=TOKEN` an exact token. Canonical
rendering uses explicit tokens/JSON References, never store-local ordinal labels.
Pinned endpoint handles carry only an explicitly authored literal revision; no
current-revision capture is invented. Types-specific pin admission remains separate.

## Emission and rendering

`--emit-operation` on ordinary CRUD emits one member, including explicit delete
apply intent when rendered back. `--emit-batch` emits the versioned wrapper. Both
reject execution keys/retry mode/display masks; no network lookup, ID/revision/key
allocation, registration/default resolution or successful-admission claim. Emission
selects implemented version 1 and an offline Scope; server support discovery is for
execution, not a prerequisite to emitting a request. Supply
an offline Scope binding when relative operands need it. JSON input is literal
selected-contract JSON, with duplicate/Unicode/exact-number/closed-field checks;
it does not expand filenames or interpolate strings.

Every admitted version 1 request has a canonical command-file rendering using the
ordinary replacement/patch flags and exact Reference/token field escapes when
convenience spellings would lose meaning. The outer compiler supplies selector 1.
Rendering an unsupported feature version refuses rather than rewriting it as 1.
An unresolved local ordinal or allocator-only --id-root refuses offline emission.
Execution may use a selected local resolver before freezing the full request/key,
but never resolve a future capture or re-resolve on retry. Version1 has no idRoot
member. An allocated explicit ID is ordinary id; no allocation claim follows from
printing it. Existing fixture command strings preserve the previous paper grammar;
they are historical inputs, not execution proof of this updated grammar.

```text
compile(render(request), binding) = request
compile(render(compile(commands, binding)), binding) = compile(commands, binding)
```

Equality preserves operation order, fields/presence, exact JSON values, Type and
replacement/patch intent, guards/provenance and creation names/references; quote
style and JSON member order are immaterial. These are design equations with
[paper pairs](../../fixtures/atomic-batch/candidate.json), not executed round trips.
No whole-request escape stands in for missing ordinary command signatures.

## Complete results and errors

HTTP 200 returns one native object with `capabilityVersion`, aggregate `changed`,
ordered `results` identity mappings, unique final `resources`, and `transaction`
exactly when effectful. Each mapping has `operationIndex`, `operation`, resolved
`id` and optional create `operationName`. It is not an intermediate mutation result.
Every mapped identity has one final Resource outcome, ordered by canonical URI.
Induced owners appear there too when required, with their actual final context.

Final outcomes are created/updated/unchanged with complete live `resource`, deleted
with its final published `deleted` identity, or allocated with only identity/kind
when a creation was also deleted before publication. Each has `id`, `resourceKind`
and authoritative `changed`. No fake intermediate record/revision is returned.
Named creations keep their allocated identity even in the allocated/absent case.
Existing singleton results and alias results keep their distinct ordinary shapes.

For A→B→A in one batch, the unique final row is unchanged with its original revision;
all command mappings still exist. No lifecycle Event or new provenance is published.
This succeeds durably with `changed:false` when there is no other semantic effect.
Create-then-delete commits identity consumption, so changed is true with an allocated
row and transaction, but no Resource lifecycle Event. No-op recovery bookkeeping
does not itself set changed. Replayed output reports the original decision.

An explicit guard on an existing target compares its pre-batch committed revision,
including on later staged edits. No new revision exists between members; a guard
cannot name a guessed staged/future token. A newly created target has no baseline
revision to match. Working-target liveness and other admission still apply.
Literal endpoint pins stay literal and names capture identity only.

One final version has one attribution. Conflicting explicit provenance inputs for
that Resource (including applicable initial/final owned-Link contributions to an
owner) refuse the whole batch; omission does not overwrite an explicit input.
No version means no new provenance, even with valid supplied inputs. See the
[common rules](../../specs/profiles/core/publication.md) for final owner capture,
deletion/allocation, attribution, Events and durable recovery.

For a staged Type change and restoration to its initial pin, the native result
inside CLI data is:

```json
{
  "capabilityVersion": "1",
  "changed": false,
  "results": [
    {
      "operationIndex": 0,
      "operation": "updateBead",
      "id": "https://work.example/acme/task-17"
    },
    {
      "operationIndex": 1,
      "operation": "updateBead",
      "id": "https://work.example/acme/task-17"
    }
  ],
  "resources": [
    {
      "id": "https://work.example/acme/task-17",
      "resourceKind": "bead",
      "outcome": "unchanged",
      "changed": false,
      "resource": {
        "id": "https://work.example/acme/task-17",
        "type": {
          "uri": "https://work.example/acme/Task",
          "revision": "definition-r1"
        },
        "revision": "bead-r1",
        "properties": {
          "title": "Review BDP"
        },
        "metadata": {}
      }
    }
  ]
}
```

Finite JSON presents the native result through the existing mutation descriptor.
JSONL emits the complete compound result as one item with its terminal; it does
not split members into independently successful executions. Collection paging/
limit flags refuse. Human rows may display members but still report one decision.
Rendering failure cannot roll back known effects. Native Problems pass through
unchanged as `origin:bdp`; local refusal is `origin:cli`, using the same capability/
operation code and pointer fields without pretending a remote HTTP response occurred.

For a new invocation, missing version/support refuses locally before dispatch;
the service rechecks against stale advertisements. Recognized disabled CRUD uses
`operation-not-supported`, the operation name and `/operations/I/operation` pointer;
the first unsupported member wins after syntax validation. Unknown names, including
deferred set-write names in version 1, are malformed. A future selected version can
add vocabulary; it cannot reinterpret version 1 property strings or `@name`.

## Recovery without a receipt service

Execution accepts `--idempotency-key` or generates a key, freezing the complete
request/binding/input values in a private invocation journal before transmission.
Retry-file is a mutually exclusive mode: no file/semantic input/Scope override/new
key. It resends the original request/key to the original verified context, never
rereads source files or newly resolves Type defaults. Display controls may change.
An uncertain retry is not blocked merely because current advertising removed an
operation: retained outcome/conflict lookup precedes current support admission.
Unavailable routing/result remains explicit uncertainty, never a new execution.

In-flight returns the ordinary retryable `idempotency-in-progress` Problem or waits
for a complete result; no public pending receipt. Lost response is unknown unless
terminal disposition is known. Expired/erased/withheld detail cannot authorize a
fresh execution. Same key/different request conflicts, including switching a
singleton to this explicitly selected batch context; all mutation carriers share
one key namespace, so a wrapper switch cannot start an independent duplicate.
Creation labels are presentation: normalized identity ignores their spelling, and
a retained replay projects the requesting labels by unchanged operation index
without changing identities/outcomes/transaction. Frozen ordinary retry keeps the
original labels. These choices are explicit in the paired protocol.

> **Cleo — Batch framing:** Reuse your output/error framing and ordinary edit modes.
> Complete compound batch output and replay files preserve one atomic decision.
> No public receipt/request family or domain convenience is added; this records
> shared design without interrupting your current work.

Future parameterized/stored batches must be explicitly selected/versioned and
materialize this ordinary representation. No string substitution, result path,
revision capture or template engine is specified. Events remain required under the
paired [source](events.md); actual Types/source composition and qualification
remain adoption gates. `serve`, runtime/Vickie/product pins and
Experimental stay held.
