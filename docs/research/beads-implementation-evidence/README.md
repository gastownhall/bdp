---
status: draft
authority: non-normative
---

# Historical Beads implementation evidence

This README is a later BDP editorial archive note. The three files below preserve
Julian Knutsen’s research from [formula-language PR595][pr595], source commit
`57bc52de116c81b30f211ab133231daf099cacdb`, under
[`bdp/docs/research/beads-implementation-evidence/`][original].
They remain conversation history, not current implementation instructions.

- [Beads kernel charter](beads-kernel-charter.md): original layering and adoption proposal, unchanged.
- [Link identity position](link-identity-position.md): original implementation evidence and identity proposal, unchanged.
- [Original context](original-context.md): the source folder’s `README.md`, preserved unchanged and renamed to distinguish it from this editorial note; includes provenance and citation caveats.

Historical local/code references describe the original inspection environment.
The archive does not decide current implementation sequencing or ratify its proposals.

## Disposition in the inspected BDP draft

The following summarizes baseline `0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`.
Its [status section][status] calls the whole specification a draft, not yet an adopted
conformance target. Pending PRs are not treated here as merged draft text.

| Historical position | Disposition in that draft |
| --- | --- |
| Descriptor-declared operations, named queries and server readiness | The draft excludes Type-declared operations, queries, views and Events; [readiness remains client-owned over generic reads][readiness]. See its [descriptor boundary][descriptors]. |
| Immutable Link structure | Included: Link `id`, `type`, `source` and `target` are immutable; repointing or re-pinning uses delete/create. [Link rules][links]. |
| Uniform URI endpoints with Scope closure | Included: every v0 Link has an in-Scope Bead endpoint; out-of-Scope endpoints remain opaque. [Endpoint rules][endpoints]. |
| Deterministic authority allocation / tuple identity | Not universal policy: Links have independent identities and multiple Links may share a tuple. Creators may supply canonical local IDs beneath `beads/` or `links/` using safe segments; noncanonical spellings are rejected. Committed URLs are never reassigned to unrelated Resources in the logical Scope’s lifetime, including after deletion or epoch change. [Link identity][links]; [allocation and non-reuse][identity]. |
| Tuple uniqueness, acyclicity and additional aggregate policies | The specification [defers these beyond v0][deferred], rather than making them optional implicit behavior. Its maximum-endpoint-multiplicity policy does not select those additional promises. |
| Offline multi-writer merge / per-constraint merge semantics | The draft defines one logical mutation authority at a time and snapshot/changefeed consumption, not independently writable replicas or multi-authority merge. The papers’ offline-merge premise is outside that model. [Scope history][history]. |

The [repository specification](../../specs/bdp.md) remains the owning protocol document.
This archive adds no normative rule, runtime support or conformance evidence.

[pr595]: https://github.com/donnabox/formula-language/pull/595
[original]: https://github.com/donnabox/formula-language/tree/57bc52de116c81b30f211ab133231daf099cacdb/bdp/docs/research/beads-implementation-evidence
[status]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L9-L19
[readiness]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L130-L145
[descriptors]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2390-L2399
[links]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L297-L311
[endpoints]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L315-L334
[identity]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L565-L585
[deferred]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1489-L1493
[history]: https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1029-L1038
