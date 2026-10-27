## Read and use saved states

The CSV guide has changed several times. Its ID stayed `csv-draft` while its
content, metadata and Type changed. A revision identifies one saved state of that
same Resource. We can read a retained state, cite it exactly, or use the current
revision to protect an edit from overwriting someone else's work.

The guide now has the title `CSV export guide (reviewed)`, after the update we
observed. For this example, the Scope advertises complete application History and
allows the illustrated reads. Its adapter also provides stable local revision
numbers. Outputs are authored excerpts; the short token labels below stand for
complete opaque tokens, not a token-generation scheme or a runtime transcript.

### Read the current state and its revision

`--long` includes the context needed to identify the selected state. Here the
current guide's complete token is `guide-h`. The body and metadata are the values
we left in place while editing and observing the guide.

```console
# Inspect the current guide and its revision token.
> bd show csv-draft --long
https://work.example/acme/csv-draft [https://work.example/acme/guide] CSV export guide (reviewed)
Revision: guide-h
…
Include headings even for an empty selection. Check the exported file in a spreadsheet.

Metadata
  area: export
  ready: true

```

The token is useful because the next edit can change it. It is not a timestamp,
page position, or number that a client increments. Comparing saved Resources as
editions compares their canonical identity and concrete selected revision.

### Browse retained versions

`bd versions` lists retained version summaries for one Bead or Link. It does not
fetch all their bodies. The page has its own retained-window and continuation
context; permission to see a summary does not promise permission or future
availability of the saved body.

```console
# Read one retained History page for the guide.
> bd versions csv-draft --page-size 8
Subject: csv-draft
Population: all-retained
Participation: tracked
Window: complete
REVISION  LINEAGE   BODY
guide-h   current   complete
guide-g   replaced  complete
guide-f   replaced  complete
guide-e   replaced  complete
guide-d   replaced  complete
guide-c   replaced  complete
guide-b   replaced  complete
guide-a   replaced  complete
Next: none
…

```

These rows are summaries. They are not historical Beads returned by List, and
they do not accept List's filters or Resource include/omit masks. A continued page
uses the exact History `next` URL under its own rules; ordinary collection
page-resizing and total-limit behavior do not silently apply.

This example's authority orders the eight retained states. The spelling of the
tokens does not establish that order. If the authority reports an incomplete
window or a continuation, the CLI preserves that information.

### Select an exact saved state

`@=TOKEN` selects an exact opaque revision token on a local Reference. The `=`
distinguishes the token from a local revision number. `@current` explicitly asks
for the current state; a bare point-read ID already has that default.

```console
# Read the guide's original saved state by exact token.
> bd show csv-draft@=guide-a
csv-draft [note] CSV export notes
Revision: guide-a
…
Keep column headings in every CSV export.

# Read current content explicitly.
> bd show csv-draft@current
csv-draft [guide] CSV export guide (reviewed)
Revision: guide-h
…
Include headings even for an empty selection. Check the exported file in a spreadsheet.

```

The historical read retains the original Type and content. It does not borrow
the current title or convert the old note into a guide. Unavailable retained
content produces an explicit outcome, never a nearest-current fallback.

The shared Resource projection contract also applies to exact saved states:

```console
# Request the original state's title property with its protected context.
> bd show csv-draft@=guide-a --include /properties/title
csv-draft [note] CSV export notes
Revision: guide-a
…

```

This projection is the accepted service-side target. Its native request binding
must explicitly extend the old revision-only query restriction. A client that
only masks a full response does not thereby implement that capability.

### Use a local revision number when available

The example adapter maps local number 1 to `guide-a`, 7 to `guide-g`, and 8 to
`guide-h`. That mapping is stable for this Resource and authority. Another store
may assign different numbers to the same portable tokens.

```console
# Use the adapter's stable local number for the original state.
> bd show csv-draft@1
csv-draft [note] CSV export notes
Revision: guide-a
…
Keep column headings in every CSV export.

```

The CLI resolves the number before sending the exact token to BDP. It cannot
derive a number by counting a versions page, renumber after pruning, or assume a
numeric token is an ordinal. Without authoritative mapping, this convenience
refuses; exact token reads remain the portable operation. Absolute HTTP URLs
remain literal. To attach a selector, wrap the URL in brackets and quote the
whole argument for the shell:

```console
# Select the same saved state through its absolute URL.
> bd show '[https://work.example/acme/csv-draft]@=guide-a'
csv-draft [note] CSV export notes
Revision: guide-a
…
Keep column headings in every CSV export.

```

The CLI receives the brackets and separates the URL from its selector. No
standalone `--revision` flag or `json:` Reference escape is introduced.

### Read a saved Link after deletion

`csv-context` was edited and retyped before it was deleted. Its last live state
can remain available under the illustrated retention and authorization policy.
Root `versions` is generic; `link versions` asserts that its subject is a Link.

```console
# Browse retained summaries for the deleted Link.
> bd link versions csv-context
Subject: csv-context
Population: all-retained
Participation: tracked
REVISION          LINEAGE   BODY
context-explains  replaced  complete
context-edited    replaced  complete
context-created   replaced  complete
Next: none
…

# Read its last live record by exact token.
> bd link show csv-context@=context-explains
csv-context [explains] Checks for CSV output
Revision: context-explains
…
Source: csv-draft
Target: csv-checks

```

This retained Link does not revive either deleted object. Reading its stored
endpoint References does not acquire the checklist's body. The native versions
page also does not fabricate a deletion revision; deletion evidence and retained
live Resource editions have their own meanings.

### Cite current content or a fixed edition

A floating Reference identifies the Bead and selects current content when read.
A pinned Reference includes an exact token. We can create two citation Links to
show the distinction, assuming these fixture Types permit the endpoints and pins.

```console
# Create a citation that follows the guide's current state.
> bd link create csv-plan csv-draft --id csv-guide-current --type references
Created
csv-guide-current [references] csv-plan → csv-draft

# Create a separate citation fixed at the reviewed state.
> bd link create csv-plan csv-draft@=guide-h --id csv-guide-snapshot --type references
Created
csv-guide-snapshot [references] csv-plan → csv-draft@=guide-h

```

The first Link stores the canonical target identity. The second stores that
identity and exact revision. They are different Links, and their endpoint
References keep those meanings in JSON as well as human output. A pin does not
guarantee permanent retention; an unavailable pinned body never silently floats.

### Protect an edit with a revision guard

We read `guide-h` before deciding to approve the title. `--if-revision` allows the
edit only if the current target still has that revision. Under the selected
shared write-flag grammar, `=guide-h` supplies the exact token; `8` would ask the
example adapter to resolve local revision number 8 instead.

```console
# Approve the title only if the guide is still at the state we reviewed.
> bd update csv-draft --if-revision =guide-h \
  --set-property title='CSV export guide (approved)'
Updated
csv-draft [guide] CSV export guide (approved)
Revision: guide-i

# Try a different edit with the stale guard; it must leave the guide unchanged.
> bd update csv-draft --if-revision =guide-h \
  --set-property title='CSV export guide (needs another review)'
Error: revision-mismatch

```

The successful write creates the new current state `guide-i`. The failed write
does not create another state. The floating citation now selects the approved
guide; the pinned citation still selects `guide-h`, whose title remains reviewed.
Omitting the guard makes an ordinary unguarded write; it does not imply an
automatic concurrency check.

> **Product conveniences: historical content as input**
>
> A product with the historical-content adapter can offer `--from-revision` to
> use a retained same-identity state as the base of a new edit. For example, an
> *optional alternative continuation* after the approval above is
> `bd update csv-draft --from-revision 7 --if-revision 9`. It copies historical
> properties and metadata from state 7 while requiring current state 9, preserves
> the current Type, and creates a new current state. Explicit edits then apply
> under that adapter's contract. It does not rewrite history or revive the old
> Type. The source acquisition, guard, composition and write must be performed by
> the authoritative adapter as specified; a historical GET followed by replacement
> is not an equivalent substitute. Ordinary portable Write currently has no
> `fromRevision` request member. This example requires that separately specified
> capability and is outside the main story's state trace.

The main story ends with the approved guide at `guide-i`, its unchanged body and
metadata, and the two new citation Links. `csv-context` and `csv-checks` remain
deleted. The seed's original Beads and four Links retain their content.
