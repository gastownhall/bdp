---
type: Specification
id: ""
status: draft
version: "0.1"
---

# Markdown authoring for Bead and Link instances

This BDP-local draft is a human-editable **authoring and projection format** for
BDP Bead and Link *instances* — the record-level sibling of the
[Type-definition notation](markdown-type-definitions.md), which describes Type
*definitions*. One record maps to one file (with a compact in-frontmatter form
for simple Links). It originates in the Memory experiment's authoring bundles and
**supersedes** that nascent format (see [provenance](README.md) and the retired
[experimental bundle](../../experimental/formats/markdown-bead-bundles.md)).

The format is **lossless** against the BDP JSON record and editable in a plain
Markdown vault at all times. It is an authoring surface, not an authority: a file
is a draft until a service admits it. It is **not** a Type-identity format, a
protocol runtime, an admission engine, a provider, or permission to change a
stored record. Prose in this specification states the rules; prose in a rendered
record document is not executable. The current normative protocol remains the
[specification index](../README.md); this format changes no BDP wire contract.

## Purpose, authority and boundary

The format projects a single admitted Bead or Link record to and from Markdown
and back without altering any value. It carries the Core number model (exact
decimal / binary64), so a value that cannot round-trip is refused rather than
rounded, and re-importing an unedited export mints no revision under Core's
same-value no-op rule. Type checking, endpoint resolution and Link validation are
described as happening before a store write, but this document specifies the
*representation*, not an admission implementation; the [Core](../profiles/core/)
and [Write](../profiles/write/) profiles remain the authority for admission,
identity and alias semantics.

Two project directions this draft authors to, both still being finalized in the
normative profiles — where this format and the normative text differ, the
profiles govern and this draft follows:

- **Independent Links only.** Every Link is an independent Resource; there are no
  owned Links. Where normative Core/Types text still describes owned Links, that
  model is being retired, and this format does not represent owned-link bundling,
  child ownership, or `defines` grouping.
- **Resource-wide aliases.** A file path is an alias (below), for a **Link** as
  well as a **Bead**. This rests on alias targets ranging over any in-Scope
  Resource and on Link identity recovery; where current normative Core text still
  restricts aliases to Beads, the widened semantics are a pending Core/Write
  revision that this format assumes.

## Design principles

1. **Lossless round-trip.** Markdown → record → Markdown preserves every admitted
   value. The reverse may normalize table layout, frontmatter key order and
   number *spelling*, but never a value.
2. **Plain-vault-native always.** Flat scalar/list frontmatter (editable in a
   properties pane and queryable by flat-property views); `[[wikilinks]]` for
   edges (native backlinks and graph); descriptive filenames (graph views label
   by basename). No nested YAML in frontmatter, ever.
3. **One authority per record.** A Bead or Link is authored in exactly one place;
   the format never reads one record from two surfaces.
4. **Namespaced structural fields.** `id`, `type`, `revision`, `source` and
   `target` are structural and reserved; they are never a Type property or free
   metadata and can never collide with one.
5. **Identity in-record; the path is an alias** (§3).

---

## 1. Beads

**One file = one Bead.** Exactly one YAML frontmatter block at the top, then the
body.

```markdown
---
id: ""                       # explicit; empty = unbound draft (never from path/filename/title)
type: https://…/types/Memory    # Type URI (unpinned — the common authoring case)
status: open                 # a declared Memory property  → properties.status (typechecked)
confidence: 0.8              # a declared Memory property  → properties.confidence
reviewer: jordan             # an UNDECLARED key           → metadata.reviewer (reported back)
---

# Retrieve a saved note

A Memory is an evidenced, scoped assertion worth retaining…   ← this prose is `body`
```

### 1.1 Field mapping (beadification)

- **`id`** — the Bead's canonical identity, explicit. Empty string = an unbound
  draft that MUST NOT be treated as a stored Bead. Never derived from the
  filename, path, or title; §3 explains where identity comes from.
- **`type`** — the Type affiliation.
  - **Unpinned** (common case): `type: <uri-or-name>` — a Type URI, or a short
    name a service resolves to one.
  - **Pinned** (`{uri, revision}`): a flat two-key convention, `type: <uri>` plus
    `typePin: <revision>`, that lowers to the admitted `{uri, revision}` object on
    import and renders back to the two keys on export. Frontmatter is authoring
    sugar, not the wire; it compiles to the legal object form and stays flat so a
    properties pane and flat-property views can read it (no nested YAML).
- **`revision`** — store-owned and opaque. An authoring draft omits it; an export
  fills it; a round-trip preserves it; an author edit never sets it.
- **Title** — the first `# H1` is the Bead's `title`. Import removes that H1 from
  `body`; export recreates it from the stored title. The title is never
  duplicated in frontmatter.
- **`body`** — the well-known property holding the Markdown content below the
  title. Per §1.2, `body` is prose *plus* structured-property projections.
- **Every other frontmatter key** — a declared property of the resolved Type (or
  an ancestor) → `properties`, typechecked; otherwise → `metadata`, value
  preserved and the key reported so a typo cannot masquerade as typed. A later
  Type change must not silently reclassify stored metadata; an export-time
  collision between a stored metadata key and a newly typed property requires
  explicit resolution, never a silent overwrite.

Frontmatter values are **flat scalars and lists only** — the constraint that
keeps a properties pane and flat-property views working.

### 1.2 Structured properties project into the body

Flat frontmatter is right for scalars and simple lists; it is wrong for nested
objects and arrays-of-objects. So the Type descriptor **splits** a Bead's
properties by shape:

- **scalar / flat-list property → frontmatter** (above);
- **structured property (object, array-of-objects, map) → a body section**,
  rendered in a table-first notation modeled on
  [markdown-json-schema.md](markdown-json-schema.md), with a fenced residual block
  for anything a table cannot hold exactly, extracted **mechanically** back to the
  typed value.

This reuses the schema notation's *technique* for property **values** (a
value-codec, a companion to the schema codec; to be specified and built). A
structured property `evidence` renders as:

```markdown
## evidence
| source | kind | added |
| --- | --- | --- |
| "https://…/pr/3" | "external" | "2026-11-07" |
```

**A section binds to a property by heading, driven by the Type, with no comment
markers.** The Type descriptor declares which properties are structured-in-body. A
body section whose `##` heading is **exactly** such a property's name *is* that
property's value; everything else in the body is prose. The binding is the Type
plus the heading — never a hidden comment and never the prose spelling.

Precise rules so it round-trips and stays unambiguous:

- `body` (the prose property) is the content from after the H1 up to the first
  structured-property section. Structured-property sections are emitted **last**,
  in the Type's declared property order, so export is deterministic.
- A projection heading is reserved: a prose section titled with a name that
  collides with a structured property is a conflict requiring explicit resolution
  (rename the prose heading), exactly like the metadata/property collision rule.

---

## 2. Links (all peers)

Every Link is an independent Resource, authored at **one** of two fidelities.

### 2.1 Compact: a frontmatter wikilink property

A simple edge with no properties of its own is a frontmatter key whose value is a
`[[wikilink]]` (or a list of them). The **key names the Link Type**; the value
names the target(s); the source is this Bead:

```yaml
supersededBy: "[[memory-0042]]"        # one Link: {type: SupersededBy, source: this, target: memory-0042}
references:                            # several References Links
  - "[[pr-3]]"
  - "https://example.org/spec"         # out-of-scope endpoint: an opaque absolute URL, not a wikilink
```

A frontmatter key is read as a **Link** exactly when it resolves to an installed
**Link Type** and its value is wikilink(s)/URL(s); a key that resolves to a
**property** goes to `properties`; anything else is `metadata`. The disambiguator
is the Type inventory at beadification, never the spelling. Compact Links carry
**no** properties, metadata, or own-revision — the moment one needs them, it
promotes.

### 2.2 Promoted: one file = one Link

A Link that carries its own `type` pin, `properties`, `metadata`, or revision is
its own file:

```markdown
---
id: ""
type: https://…/types/References
source: "[[memory-0042]]"     # or a canonical URL
target: "[[pr-3]]"
weight: 0.9                   # a declared Link-Type property → properties
---

Why this reference matters.      ← the Link's `body`
```

### 2.3 Two or more Links of the same Type

- **Same type, different targets → a list.** `references: [ "[[pr-3]]", "[[pr-8]]" ]`
  is two `References` Links. The common case, fully in frontmatter.
- **Links that each carry their own properties → one file each.** Compact Links
  are property-less; any that needs `properties`/`metadata`/a `type` pin is a
  promoted file, and N such files are N distinct Links of that type.
- **Parallel Links (same type *and* same target).** Core allows them, but each
  needs its own identity — so they are **promoted files**, one per Link. Compact
  lists **dedupe** by (type, target): a repeated identical wikilink is one Link.
- A given Link is authored once (§2.4); different Links of one type may sit in
  different surfaces, and the canonical store **unions** them. Keeping one
  (source, type) in one surface is encouraged for legibility, not required.

### 2.4 Single-authority rule

A given Link lives in **exactly one** surface — compact *or* promoted, never both.
Promotion moves authorship into the Link file; the former compact entry is dropped
(or kept only as a tool-maintained read-only backlink, never a second author
surface). This is the one-authority-per-record principle applied to edges.

### 2.5 Endpoints

A `[[wikilink]]` endpoint resolves through the path-alias (§3) to the target
Bead's **canonical** URL and is stored canonical. An out-of-scope endpoint is an
**opaque absolute URL** written in full (never fetched, never validated as a local
Bead). At least one endpoint of a Link is an in-Scope Bead (Core).

---

## 3. Identity and the filesystem — the path **is** an alias

This is the heart of the format and the answer to "filename versus identity":

- The **canonical `id`** (immutable, store-allocated, in the frontmatter) is
  identity. It is never derived from the path.
- The **file path is an alias** to that id — a repointable locator that carries no
  identity promise and is reusable after deletion. So:
  - **Moving or renaming a file is a `put-alias` repoint.** An alias mutation
    mints no revision: the target Resource's revision is unchanged by a put, a
    repoint, or a delete. `mv` changes nothing about the record, not even its
    revision — so "renaming a file must not declare a new Bead" holds for free.
  - **Authoring a new file at a path creates an unbound draft** (`id: ""`). On
    publish, a service allocates a canonical id in a space **disjoint** from the
    path/alias space (an authority-allocated canonical id is never a live alias
    URL) and binds the path-alias to it.
- **Link paths are aliases too, uniform with Beads.** A promoted Link file's path
  is an alias: renaming it is a `put-alias` repoint that mints no revision, and a
  stable edge name (for example `supersedes/current`) can repoint to whichever
  Link is current. An alias may name a Link as an operation *subject*; it never
  names a Link *endpoint* — endpoints stay Beads. (This rests on the
  resource-wide alias direction noted under Boundary; the normative Core/Write
  text is the authority as it lands.)
- **Pinned targets.** A target may be pinned (`{uri, revision}`); a file path is
  naturally a **bare** alias that tracks current. A pinned reference, if authored,
  stores the exact revision token, and `name@y` resolves only when `y` names that
  pinned revision — an optional later construct, not the default file-path alias.
- `.obsidian/` and `.git/` are machine-local and excluded from the Scope.

---

## 4. Round-trip contract

Import (Markdown→record) and export (record→Markdown) are inverse. A projection
preserves: `id`, `type` (and pin), `revision`, title, `body` prose, every typed
property (flat and structured), all metadata, and each Link's type, endpoints,
properties and metadata. Reverse projection MAY normalize table layout,
frontmatter key order, and number spelling; it MUST NOT drop or alter a value.
Unknown frontmatter stays metadata. Type checking and endpoint/Link validation
happen before any store write.

---

## 5. Worked example

`notes/retrieve-a-saved-note.md` — path = alias `notes/retrieve-a-saved-note`, id
allocated at publish:

```markdown
---
id: "https://memory.scope/bead/9f3a"
type: https://…/types/Memory
revision: "r7"
status: open
supersededBy: "[[consolidate-memory]]"
references:
  - "[[pr-3]]"
---

# Retrieve a saved note

A Memory is an evidenced, scoped assertion worth retaining because it is reusable
and costly to rediscover.

## evidence
| source | kind | added |
| --- | --- | --- |
| "https://example.org/pr/3" | "external" | "2026-11-07" |
```

A flat-property table view over this directory — filtered `type == Memory`,
columns `status`, `file.name` — is a no-code Core-style collection read over the
corpus.

---

## 6. Draft → publish lifecycle

A file is an authoring surface; it becomes a stored record only when a service
admits it. The stages, which also answer "where does identity come from":

1. **Unbound draft.** `id: ""` (or absent). The file lives at a path; the author
   edits frontmatter and body. Nothing is stored. If the Type is not yet
   resolvable, link-versus-property classification is **deferred** — every
   non-structural frontmatter key is held as a candidate until publish. The path
   is a candidate alias.
2. **Beadify (dry, local — the lint).** Resolve the Type and ancestors; classify
   each frontmatter key (declared property → `properties` + typecheck; installed
   Link Type → Links; else `metadata`); extract structured-property body sections;
   resolve wikilink endpoints to canonical ids; report metadata keys and any
   collision. Writes nothing to the store.
3. **Publish (admission).** A service: allocates the canonical `id` in a namespace
   disjoint from the path/alias space; writes the record under Core/Write
   admission (atomic-batch for a Bead plus its promoted Links, idempotency,
   revision guards); binds the path as an alias (`put-alias`) to the new canonical
   id; and stamps `id` and `revision` back into the file on export.
4. **Edit after publish.** A body/property change → `update` (new revision). A
   move/rename → `put-alias` repoint, **no revision minted**. Deleting the *file*
   follows §8.
5. **No-op.** Re-importing an unedited export mints **no revision** (lossless
   round-trip plus the Core number model).

So a human **never invents an id**: they author at a path (a candidate alias), and
publish allocates the id and binds the alias. `id: ""` is the honest unbound
marker, and such a file is never treated as stored.

---

## 7. Reading the graph: inbound links and views

Outbound edges are authored on their source Bead (§2); a Bead's **inbound** edges
are authored elsewhere. So every inbound presentation is a **derived view, never a
second authority**.

- **Native backlinks** already surface inbound wikilinks — a free, read-time
  inbound view for compact Links, with no store write.
- **Flat-property views** filter and sort a flat property set but do not traverse
  edges; inbound closure and multi-hop queries belong to a real BDP client (Core
  graph queries/selectors), not a view. A view over a **Links** directory can
  still show a flat edge table (one promoted Link per row).
- A **materialized** in-vault inbound index (for example a generated
  `## Backlinks` section) is **tool-maintained and read-only** — never
  hand-authored, never the Link's authority.

Single-authority holds: a Link has exactly one authoring home; every inbound
rendering is derived from it.

---

## 8. Deleting a file

Because a Resource's path **is** an alias (§3, for Beads and Links alike),
removing a file is ambiguous between "delete the Resource" and "release the
locator." The format resolves it, **uniformly for Beads and Links**, to the
**least-destructive** reading:

- **Deleting a file is a `delete-alias`, not a delete of the Resource.** The path
  locator is released; the **Bead or Link survives** under its canonical id, still
  reachable by id and listed in collections, and the path becomes reusable. A
  human reorganizing files never silently destroys a record or triggers a cascade.
- **Deleting the Resource itself is an explicit act** — a tombstone gesture
  (`deleted: true` at publish, an explicit delete command, or a designated
  tombstone area), never a side effect of `rm`. A Bead deletion inherits Core's
  incident-link safety; a Link deletion destroys no endpoint. Deleting a Resource
  removes every alias targeting it, atomically, and the result lists them.
- **Deletion is recoverable for both kinds**: a recovery or a create over the
  deleted id resumes the identity (adding a revision, inheriting nothing); git
  history is the local undo beneath that. (Link recovery rests on the
  resource-wide identity direction noted under Boundary.)
- A service **MAY** offer a "vault-authoritative" mode where a removed file also
  tombstones the Resource — but that destructiveness must be **explicit**
  (confirmed), never the silent default.

---

## 9. Alias collisions at publish

A path-alias must be unique in the Scope's one shared namespace across Beads,
Links and aliases (Core). Collisions surface at two points:

- **Beadify (dry lint), best-effort.** The candidate path is checked against the
  Scope's known aliases and canonical URLs and a collision is reported *before*
  publish, so the author renames the file first. Offline this cannot be
  authoritative (the store may have moved), but it catches the common case.
- **Publish, authoritative.** A `put-alias` at a bound path returns Core's
  `alias-path-taken`; a path equal to an ever-committed canonical Resource URL
  returns `identity-taken`. The whole publish fails atomically (nothing changes),
  and the tool surfaces an author-facing error naming the conflicting path.
- **Non-disclosure.** Aliases are not an enumeration oracle: a collision with a
  record the author may not see reports a generic "path unavailable" without
  revealing what occupies it.
- **Bounded surface.** Because canonical ids are allocated in a namespace disjoint
  from the path/alias space (§6), an authored path can never collide with an
  auto-allocated id — collisions arise only between two authored paths, or an
  authored path and another author's alias.
- **Resolution.** The author renames the file (the alias) and re-publishes; an
  already-allocated canonical `id` is unchanged — only the alias binding retries.

---

## 10. Scope and non-delivery

This draft specifies a representation and its round-trip contract. It does not
deliver a parser, a beadify/lint implementation, the value-codec, a publication
command, or an instance-bundle converter; those are companions to be specified and
checked separately, as the schema notation's codec is. It defines no BDP wire
contract and grants no authority beyond the normative [Core](../profiles/core/)
and [Write](../profiles/write/) profiles, which govern identity, admission and
alias semantics as their text lands.
