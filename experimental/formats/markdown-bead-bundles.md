---
type: Specification
id: ""
status: draft
version: "0.1"
subjects:
  - Markdown Bead authoring
  - GitHub Issue projection
  - repository file projection
---

# Markdown authoring bundles for Beads and Links

> **Experimental v0.1 authoring draft.** Imported from the Memory experiment; “this repository” and “this scope” below refer to that original experiment. Its Type vocabulary, publication workflow and examples are historical context, not adopted BDP behavior. Identity binding, revision selection and edit/delete mechanics remain open. See [status and provenance](README.md).

This Specification describes the **draft authoring format** used in this repository. It covers local Markdown, its prospective projection into Bead/Link records, and deliberate publication as a GitHub Issue or repository file. It is a design draft, not an implemented converter or a claim that any Link in these files has been written to a store.

## One editable source

The author writes a Markdown file in a branch or worktree. Donna and Janet may edit that same draft in Obsidian, VS Code, or another Markdown editor. A deliberate publication step compares the destination's prior state, writes the reviewed candidate, reads it back, and records the source commit and destination in [the publication ledger](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/PUBLICATIONS.md). GitHub Issue edits use the create/update path; repository-file edits use the normal commit and PR path. Neither destination becomes normative merely because this scope published a copy. The destination project's authority rules decide that.

An authoring file may bundle its root Bead, owned outgoing Links, and child Beads for which it is the defining home through `defines`. The child Beads retain independent identities after creation. The bundle is a convenient edit unit, not a new identity or an implicit containment rule for every owned Link: `satisfies`, `depends-on`, and `conformsTo`, for example, do not imply that their targets are authored in the source file.

## Root Bead fields

Exactly one YAML frontmatter block is at the top. `type` names the root Bead Type. `id` is the root Bead's explicit identity field; an empty string means this draft has not been assigned a Bead ID and must not be treated as a stored Bead. Do not derive `id` from the filename, path, or title. The first H1 is the root Bead's `title`; import removes that H1 from `body`, and export recreates it from the stored title. Do not duplicate the title in frontmatter. The remaining authored prose and sections form its body, subject to the owned-record extraction below.

Frontmatter can carry both Type-defined properties and Bead metadata. During **beadification**, resolve the selected Type and its ancestors. A frontmatter key explicitly declared as a property of that Type maps to `properties` and is typechecked. An undeclared key maps to `metadata` with its value preserved. `type` is a structural selector and `id` is the Bead's identity field; neither is a Type property or free metadata. Report which keys went to metadata, especially likely misspellings. A later Type change must not silently reclassify already stored metadata as a typed property. If a stored metadata key collides with a newly defined property on export, require an explicit resolution rather than overwriting either value.

In this scope, `status` is a Memory property and `version` is an optional Work Product property. `subjects` is currently an undeclared metadata list for indexing the Type names discussed by a draft; it does not create Type-definition Beads. A missing optional field remains absent, not a default. Keep scalar values such as version labels quoted when a YAML parser might otherwise turn them into numbers. Use flat scalars and lists so Obsidian's Properties editor can edit them; avoid nested YAML objects in this working format.

GitHub Issue number, repository path, file name, Git commit, Bead ID, Link ID, and revision are different kinds of locator or identity. None is inferred from the H1 or directory name. The explicit `id` field is blank in unbound examples; filling and checking it at Bead creation or publication remains to be specified. For a repository file, the H1, frontmatter, and Markdown body remain together. For a GitHub Issue, the Issue title can carry the root Bead title, but the exact Issue-body encoding of frontmatter properties and metadata is still open. Do not drop those fields or claim a lossless Issue round trip before that encoding is selected and tested.

## Owned Links

Use one `## <Link Type>` section per owned outgoing Link Type of the root Bead, except for the `defines` presentation below. A bundled child Bead's owned Links appear in a subsection beneath that child, as with a Scenario's `#### Requires` table. A homogeneous link table names its target column for the target Bead Type, such as **Requirement**. Show a Link's optional **Title**, **Status**, or **Body** columns only when at least one row populates them; add Type-defined columns such as **Evidence** for `satisfies` when useful. Title is the Link's optional title, not the target Bead's title. Body is the Link's note, which can hold caveats or guidance. A long note may be placed in a detail subsection linked from the table cell; that subsection still belongs to the Link body. Empty values in a displayed optional column use `—`.

Rows describe authoring intent until a publication or store operation resolves the target, checks endpoint Types and constraints, and creates or updates Link identities. Do not infer a live Link from a row. The name `depends-on` is currently a candidate owned Link Type, not an installed/public Type. In this repo, a local file or a pinned external URL may appear as a **Target** authoring locator. A URL is not proof of an external Specification Bead's identity or Type. A publisher must resolve and validate that target before creating a typed cross-scope Link; until then the row remains an unresolved dependency candidate. Standards cited for context may remain in prose or **External sources** without claiming a dependency.

Direct, unowned `references` Links have no authoritative row in either endpoint's document or metadata. Their separate authoring and publication surface remains open. Views may display such Links without making the endpoint file their source of truth.

## Defined children

A Proposal or Specification may keep Beads it defines in one authoring file. Use one top-level section per homogeneous target Type, with a short index table followed by the child definitions. A Proposal or Specification uses `## Scenarios` and `## Requirements` when it defines those obligations; a Type Specification may use `## Bead Types` and `## Link Types` for Beads affiliated with BeadType and LinkType. There is no generic `## Defines` wrapper. Each index names its target column for the target Type: **Scenario**, **Requirement**, **Bead Type**, or **Link Type**. These tables project source-owned `defines` Links, while detail sections project the target Beads. A `requires` Link, if asserted, is a separate semantic dependency and has its own section; the presence of a definition does not imply one.

An authored child heading combines an optional human label and the child title, for example `### R1. Remember a note` or `### S1. Retrieve a saved note`. This is one visible title line, not a bare `### r1` heading followed by a duplicate bold title. The label is part of the child Bead title in this trial; it is not the `defines` Link title, a separate property, or the Bead ID. The author chooses labels. This Specification provides no allocator, numbering scope, ordering, uniqueness, reuse, or renumbering rule. The index links to the heading's Markdown slug, for example `#r1-remember-a-note`. A cross-file draft citation can use `memory-proposal.md#r1-remember-a-note`. Because the slug changes if the title changes, such links are provisional authoring locators; a stored Link must resolve the child's Bead ID. The child status appears only in its detail section, and Link status/body columns appear in the index only when a Link actually has those values.

The R/S prefix convention applies only to Requirement and Scenario titles. A Bead Type or Link Type definition uses its Type name as the detail heading and keeps its own descriptor content in that section. The Type package documents in this repository use homogeneous index-and-definition groups as private working projections; their child definitions must become addressable Beads before a publisher may assert stored `defines` Links. The authoritative BDP Type definitions remain in BDP.

If a child grows too large for one file, move its full draft into a separate file and change the defining index link. The `defines` ownership rule stays the same. A Markdown path and heading anchor is a provisional authoring locator, never a permanent Bead ID. A `satisfies` or `addresses` row in another Work Product may use that link while drafting; publication must resolve it to the actual child Bead identity and reject an ambiguous or missing target. Whether child status appears as a frontmatter field in a separate file or as a line beneath its heading in a bundle does not change its typed meaning.

This compact bundle trades some Obsidian Properties-pane convenience for a readable whole Proposal/Specification. Obsidian edits the root frontmatter as Properties, while child status and Link tables are edited in the note body. The file stays ordinary Markdown and the target links remain clickable. The [working Proposal and Specification examples](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/examples/examples-guide.md) exercise this shape without inventing Bead or Link IDs.

## Round-trip and open mechanics

A projection that creates Beads must preserve root and child titles, bodies, statuses, optional versions, metadata, owned Link titles/bodies/statuses, endpoint identities, and Type-specific fields. It must not duplicate an owned Link body in the root Bead's stored prose, or treat an ordinary external citation as a Link. Reverse projection may normalize table layout and frontmatter key order, but it must not lose authored values. Unknown frontmatter fields remain metadata. Semantic Type checking and endpoint/link validation occur before writing a store.

Pin selection, Link edit/reparent/delete operations, creation of independent child identities from a bundle, a canonical identity-to-file binding, and the GitHub Issue-body encoding of frontmatter are still open. This document specifies the human-editable candidate shape so the project can test it in real use; it does not claim those mechanics exist today.

## Depends on

| Title | Target | Status | Body |
| --- | --- | --- | --- |
| Memory vocabulary | [Memory Bead and Link Type catalog](https://github.com/donnabox/memory-beads/blob/742e0025eb294a0d733c2ef0e945703f7325f965/specs/type-packages/memory-references/memory-and-references.md) | draft | Uses its working property and owned-Link definitions; the dependency is an authoring draft, not a live Link. |
