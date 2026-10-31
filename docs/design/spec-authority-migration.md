# Specification authority migration

Editorial work for gastownhall/bdp#59, based on main
`aed21767e1ade54bef6dad108c4f24b8e9cd844b`.

## Inventory and batches (before edits)

| Family | Classification | Work and validation |
| --- | --- | --- |
| Monolithic protocol and current navigation | Migrate now | Extract shared model/Read into Core and Read+Update/Transactional into Write; preserve headings, requirement text and profile names; check every old section and link |
| Shared conformance end matter | Migrate now | Keep one shared index under specs; preserve all rows and case IDs |
| Normative wire schema and filesystem consumers | Migrate now | Relocate unchanged bundle into Core; update filesystem loads; preserve public schema IDs, packaged bytes and their equality check |
| Type draft, six property schemas and literals | Migrate now | Colocate shared Types and Issue artifacts; relocate checker and test data outside specs; run 95 shape cases and local-link checks |
| Existing Issue prose | Migrate now as WIP | Recover the existing reviewed authoring draft without new decisions; retain inspected Preview 2 evidence and open issues |
| Memory PR143 | Coordinated follow-up | Already moved to specs/types/memory; reconcile shared-schema paths on that branch after the common layout is available; run its 70 cases |
| Sealed catalogs, reports and evidence | Preserve for compatibility | Keep captured source paths and bytes; resolve historical monolith citations against an in-memory assembly of the current authoritative files in test tooling, never an authored duplicate |
| Stable schema identifiers and packaged distribution copy | Preserve for compatibility | IDs are protocol identities, not source filenames; distribution copy remains byte-identical and explicitly non-authoritative |
| Pinned historical design/source links | Preserve | Do not relabel past observations or rewrite commit-pinned URLs |
| Vickie PR141/144 runtime changes | Unrelated; coordinate | Preserve semantics on main; provide path map for her still-unmerged edits; do not merge implementation changes |
| New optional Types wire adoption, simplified Write, OpenAPI | Deferred | Separate semantic work; this change does not adopt new wire forms or manufacture an OpenAPI contract |

Validation starts with section preservation, schema byte comparison, document links,
Type artifacts, schema packaging, catalog citations and profile-boundary tests.
Then run repository formatting, lint, boundaries, typecheck, build, tests and the
existing evidence gate. No new runtime or release qualification is inferred from
a documentation move. Historical evidence remains attributed to its original run.

## Relocation verification

A normalized comparison against the base proves that Parts I–IV and all end
matter retain exactly the same text, allowing only Markdown link destinations,
the schema filesystem path and whitespace. The preface changes only document
navigation, shared draft wording and the physical split description. All 148
original anchors have destinations in `spec-path-map.json`; automated tests check
the physical files and cross-file links. All nine moved JSON artifacts are
byte-identical; packaged schema bytes and sealed catalogs, matrices, fixtures and
evidence are unchanged. No evidence run is relabeled.

Existing Issue prose is recovered from the authoring worktree at `7bc1758`
(`specs/types/issue.md`), with links repaired and the companion Memory status
updated to PR143. Its product decisions and inspected Preview 2 evidence remain
unchanged. It is WIP design, not current wire behavior.

The Issue source audit remains an unmerged historical artifact linked at the
immutable `cbd59b60` authoring snapshot. It was deliberately not copied into the
current normative tree or represented as fresh evidence.

## Review dispositions

Independent reviews inspected `8614b4f5`. Both confirmed protocol text and schema
preservation. The initial full suite exposed eleven migration failures across
four files (180 other files passed): package-relative schema lookup, two segmented
monolith readers, and a comment-only edit to a hash-bound source. These were
corrected; the hash-bound source and its policy pin remain unchanged.

Review also required direct authoritative citation allowlists, physical anchor
ownership and cumulative-profile checks, with fail-closed handling of alternate
path spellings. Those guards and negative cases were added; native follow-up
review found no remaining issue. Issue inline-schema correspondence is now checked.

The remaining editorial findings were repaired: the Read+Update alias moved with
its heading into Write, all current authority statements point into specs, the
descriptor schema fragment path and artifact labels are current, historical Issue
evidence is disclosed, and the private citation reader preserves the repository
path boundary. Physical alias/stub ownership now has regression coverage.

The source comment in hash-bound `packages/protocol/src/index.ts` intentionally
retains its former document path, which now resolves to the navigation page.
Changing that evidence-bound module is outside this editorial move; its comment
does not grant the navigation page independent authority.

External [full findings](reviews/spec-authority-layout-20261015-claude.md) remain
attributed to their reviewed head, including faults already fixed before delivery.
The test-only helper remains under conformance test-support: it imports only the
filesystem, is not a package/runtime export, and the dependency-boundary check
passes. Moving this leaf helper to another shared directory is optional cleanup,
not a protocol dependency change.

Full local validation at `c105ec77`: 184 test files passed, 9,349 cases passed and
one existing case skipped, in 243.69 seconds. Final editorial/guard follow-up
receives targeted revalidation and its own exact-head CI; the earlier run is not
relabeled as a final-head observation.
