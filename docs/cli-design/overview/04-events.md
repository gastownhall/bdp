## Observe changes

We have created Beads and a Link, edited them, changed their Types and removed part of the graph. Events let us inspect those changes as well as watch for new ones. An Event identifies the operation and the object it affected. By default, a creation or update includes a postimage: the complete record as it was after that change. The example's Event source covers and still retains the changes we just made; the displays here are abbreviated.

### Read changes for the Scope

`bd events` reads a page of Events for the current Scope. Each row names the kind of operation: `createBead`, `updateBead`, `deleteBead`, or its Link counterpart. These names distinguish a change to a Link from a change to one of its endpoints. Creation, editing and deletion all appear through this one observation interface. The page returns a cursor, a marker for resuming after that page's fully delivered content.

```console
# Read a page of retained changes in the current Scope.
> bd events --page-size 20
Representation: postimage
…
createBead  csv-draft   [note]        CSV export notes
createBead  csv-checks  [note]        CSV export checks
createLink  csv-context [references] csv-draft → csv-checks
updateBead  csv-draft   [note]        CSV export notes
updateLink  csv-context [references] csv-draft → csv-checks
…
updateBead  csv-draft   [guide]       CSV export guide
updateLink  csv-context [explains]   csv-draft → csv-checks
deleteLink  csv-context [explains]   csv-draft → csv-checks
deleteBead  csv-checks  [note]
…
Cursor: scope-page-end-1

```

The failed attempt to delete the checklist produced no change and therefore no Event. Deletion previews were reads, so they produced none either.

### Focus on one Bead or Link

A Resource operand narrows observation to that Resource's source. For a Bead, this includes changes to the Bead and changes to its incident Links. The Link Events retain their actual operation names and endpoints. A Link source reports the lifecycle of that Link itself.

```console
# Read changes to the guide and its incident Links.
> bd events csv-draft --page-size 20
Representation: postimage
…
createBead  csv-draft   [note]        CSV export notes
createLink  csv-context [references] csv-draft → csv-checks
…
updateBead  csv-draft   [guide]       CSV export guide
deleteLink  csv-context [explains]   csv-draft → csv-checks
Cursor: draft-page-end-1

# Read the retained changes to the removed Link.
> bd link events csv-context --page-size 20
Representation: postimage
createLink  csv-context [references] csv-draft → csv-checks
updateLink  csv-context [references] csv-draft → csv-checks
updateLink  csv-context [explains]   csv-draft → csv-checks
deleteLink  csv-context [explains]   csv-draft → csv-checks
Cursor: link-page-end-1

```

Our example permits these retained Link facts to be read after deletion. Their availability follows the source's retention and access rules; deleting the current Link does not require those facts to disappear.

### Read the content at the change

The default representation is `postimage`: a creation or update carries the complete record published with that change. It is the content at that moment, even when the object has since changed again. Use `--output-format detail` to expand the compact display. A deletion carries the removed object's identity and, for a Link, its endpoints.

```console
# Expand the retained changes to inspect their content.
> bd events csv-draft --output-format detail
…
updateBead csv-draft [note] CSV export notes
…
Properties
  title: CSV export notes
  body: Include headings even when no rows are selected.
  status: review-needed

Metadata
  area: export
  scratch: true
  reviewed: true
…

```

This excerpt is the body-and-status edit from the CRUD example. It still contains the temporary fields that were present at that change.

Some sources also offer `delta`, describing the changes to apply to the preceding content. Its property and metadata edits use the same vocabulary as the update commands. The following is one possible realized delta for that same edit; a source can use an equivalent admitted patch or replacement. Requesting delta requires support for that representation.

```console
# Request delta representation from a source that offers it.
> bd events csv-draft --representation delta --output-format detail
Representation: delta
…
updateBead csv-draft [note] CSV export notes
…
propertiesChange
  add /body = "Include headings even when no rows are selected."
  add /status = "review-needed"

metadataChange
  add /reviewed = true
…

```

A consumer applying deltas needs the preceding content and an unbroken continuation through the changes it consumes. Reading postimages supplies a complete record for each creation or update.

### Watch for new changes

`--from now` establishes a starting boundary without replaying earlier Events. Add `--follow` to keep observing after that boundary. The command continues through empty polls while waiting for new facts. We will use two terminals so the observer can stay open while we edit the guide.

```console
# In the first terminal, establish the starting boundary and keep observing.
> bd events csv-draft --from now --follow
Following csv-draft
Starting boundary captured.

```

Once that boundary has been established, leave the observer running. In a second terminal, make an ordinary update.

```console
# In the second terminal, update the guide's title.
> bd update csv-draft --set-property title='CSV export guide (reviewed)'
Updated
csv-draft [guide] CSV export guide (reviewed)

```

When the source reports the change, the first terminal displays its Event. The observer does not need a new invocation for every edit.

```console
# Output from the observer already running in the first terminal.
updateBead csv-draft [guide] CSV export guide (reviewed)

```

Press Ctrl-C to stop following. The guide remains available with its updated title and its existing body and metadata.

### Resume from a cursor

A page's cursor is an opaque resume marker issued by that source. Copy it intact when asking for changes after the completed page. The cursor belongs to its source and selected representation; a Scope cursor cannot be substituted for a Bead cursor. A cursor is usable progress only after its whole page has been delivered.

```console
# Resume the guide's postimage source after the earlier completed page.
> bd events csv-draft --after draft-page-end-1
Representation: postimage
updateBead csv-draft [guide] CSV export guide (reviewed)
Cursor: draft-page-end-2

```

This deliberately resumes from before the live-observer update, so that fact appears again. Seeing it twice through two reads does not mean the guide was updated twice.

Event retention is bounded, and the source declares the interval it covers. An expired cursor or lost coverage produces a diagnosis instead of silently restarting observation at the present. With `--follow`, the CLI drains a multi-page range using the source's issued continuation, then polls for another range. Finishing one range means it has been drained, while new Events may still arrive.
