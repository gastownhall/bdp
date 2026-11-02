# Addressing ruling of 2026-08-29 and its disposition

This is an informative review record, not a specification. It preserves a ruling note written
on 2026-08-29, before the canonical consolidation, and states where each point now lives in the
canonical documents at `a415d4155`. Current rules live only in those documents.

| # | The note said | Where it lives now | Disposition |
| --- | --- | --- | --- |
| 1 | Canonical ID established at creation and permanent; the user may supply the path or the authority generates one | Write § Creation and identity allocation; Core § Scopes and identity (lifetime non-reuse) | Absorbed. The `beads/` example is dropped on purpose: no reserved kind prefix (Core; Write "no mandatory `beads/`, `links/` or Type prefixes") |
| 2 | Authority-generated IDs are one flat opaque segment; the authority never encodes meaning | Write § Creation and identity allocation ("allocate one opaque segment … MUST NOT encode meaning") | Absorbed |
| 3 | One segment grammar for all segments | Core § Discovery and navigation, local spelling rules (nonempty safe segments; no `.`/`..`, controls, backslashes, encoded separators; one percent decode; no Unicode normalization) | Absorbed |
| 4 | Paths are identifiers, not containers | Core § Scopes and identity ("Segments imply neither containment nor a child Scope"); Write ("Hierarchy authored in an ID implies neither containment nor a nested Scope") | Absorbed |
| 5 | Reject, never trim | Write § Creation and identity allocation ("rejected, never trimmed, decoded twice or normalized into another identity") | Absorbed |
| 6 | Aliases live under a fixed root `{scope}alias/`, so canonical versus alias is decidable from the string | Core § Aliases ("beneath the advertised `aliases` base. The authority chooses that base; it MAY be the canonical Scope URL itself. BDP reserves no `alias/` spelling"); Core discovery ("Aliases navigation is an in-Scope base, possibly the Scope itself") | **Superseded by Core at `a415d4155`.** Classification is by discovery and `HEAD`, not by path word |
| 7 | Redirect-only resolution: `307` with `Location`, no body; `HEAD` as the resolve primitive; no representation at the alias URL | Core § Alias resolution | Absorbed |
| 8 | No chains; exactly one hop | Core § Aliases and § Alias resolution; Write alias target rules (an alias, Link or external URI target is `validation-failed`) | Absorbed |
| 9 | Unknown alias is the uniform `404`, authorization-projected; aliases are not Resources | Core § Alias resolution; Core § Aliases | Absorbed |
| 10 | Reuse rules split by root; references at rest are always canonical | Core § Aliases (repointable, reusable after deletion; canonical identity never released); Write ("stored/served References never contain the alias or follow a later repoint") | Absorbed; the root-split framing is superseded with #6 |
| 11 | Resolution is capability-honest through an optional `aliases` discovery member; lifecycle is write surface | Core discovery (optional `aliases`), § Alias resolution; Write discovery (required `aliases`) and `putAlias` / `deleteAlias` | Absorbed; the profile names changed with the consolidation (resolution is Core, lifecycle is Write) |
| — | Relation to `gastownhall/beads#5877`: collapse `key + aliases` into `canonical path + aliases` | Outside BDP | Open on the beads side |

## Original note (2026-08-29), historical provenance

### Ruling: creation-time identity and aliases

Adjudicated with the operator (design worked jointly with the beads side). This settles the addressing story raised here and feeds a clarification back to gastownhall/beads#5877.

**Canonical identity — mostly existing law, now stated crisply:**

1. A Bead's canonical ID is established at creation and is permanent (the existing non-reuse law). The user may supply the path — one or more segments beneath `beads/`, e.g. `beads/project1/bob` — or the authority generates one.
2. Authority-generated IDs are a single flat segment, opaque, from the safe-segment grammar. Hierarchy is a user affordance; the authority never encodes meaning into paths it mints.
3. One grammar for all segments (already normative): nonempty, no `.`/`..`, no embedded separators or control characters, canonically encoded — exactly one valid spelling per name.
4. **Paths are identifiers, not containers.** `beads/foo/bar` implies nothing at `beads/foo`; no directory semantics, no listing-by-prefix promise.
5. **Reject, never trim.** Leading slashes, trailing slashes, and empty segments are refused (already enforced). Silently normalizing would mint an identity the user didn't type; clients may tidy in UX, the protocol refuses loudly.

The payoff: a memorable name chosen at creation *is* identity — which removes most of the demand for a separate mutable "key" concept.

**Aliases — new surface, symlink semantics:**

6. An alias is a repointable name for one Bead, living under its own root: `{scope}alias/{one-or-more segments}`, same segment grammar. Two roots keep canonical-vs-alias decidable from the string alone at any depth.
7. **Resolution is redirect-only**: `GET`/`HEAD` on an alias returns `307` with `Location: {canonical Bead URL}`, no body. `HEAD` is the resolve-without-fetch primitive (both methods already mandated). Serving the representation at the alias URL is rejected — it would mint a second address for one resource and fork caches and equality.
8. **No chains**: an alias targets a canonical Bead URL only; alias-to-alias is refused at creation. Resolution is always exactly one hop.
9. Unknown alias → the uniform `404`, authorization-projected like every resource; aliases are not Resources (no collection membership, no revision, no version).
10. **Reuse rules split by root**: canonical segments are never reused; alias paths are repointable, deletable, and reusable after deletion. A reference written by alias resolves to canonical at admission; references at rest are always canonical, so aliases never appear in stored or served reference data.
11. **Scope for v0**: alias *resolution* is Read-profile surface, capability-honest — discovery gains an optional `aliases` root member, and an authority without aliases omits it (the `bd` adapter's honest posture: shipped `bd` has no bead-level alias mechanism). Alias *lifecycle* (create, repoint, delete) is write surface and lands with the write profiles.

Relation to #5877: this proposes collapsing that design's `key + aliases` (a privileged renameable current-name plus former-names-as-aliases) into `canonical path + aliases` — the memorable name moves to creation-time identity, every later name is a peer alias, and the legacy KV-key conversion (S11) maps a legacy key to the creation-time canonical segment rather than a mutable field. Clarification to be proposed on that thread.

Normative text, schema, conformance, and the reference realization follow in a PR on this issue.
