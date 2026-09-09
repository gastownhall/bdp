# Historical Beads implementation evidence

These documents preserve Julian Knutsen’s non-normative research from [formula-language PR595](https://github.com/donnabox/formula-language/pull/595), source commit `57bc52de116c81b30f211ab133231daf099cacdb`. They are conversation history, not current BDP specification or implementation instructions.

The two papers are unchanged from that commit. The original folder introduction is preserved unchanged as [original-context.md](original-context.md), including its provenance and citation caveats. Historical local/code references describe their original inspection environment and are not current executable links.

- [Beads kernel charter](beads-kernel-charter.md): historical layering and adoption proposal.
- [Link identity position](link-identity-position.md): historical implementation evidence and proposed identity policy.

## Where the principal positions landed

| Historical position | Current disposition at the inspected BDP baseline |
| --- | --- |
| Link structure is immutable after creation | Adopted in BDP’s Link and mutation rules. |
| Uniform URI endpoints with Scope closure | Adopted: every v0 Link has at least one in-Scope Bead endpoint; external endpoints remain opaque. |
| Deterministic authority allocation / tuple identity | Not adopted as universal BDP law. Multiple Links per endpoint tuple are permitted, and committed IDs cannot be reused. A caller may supply an ID that meets the owning contract. |
| Tuple uniqueness, acyclicity and per-constraint merge semantics | Not universal v0 requirements. Existing maximum-endpoint-multiplicity policy must not be generalized into those promises. |
| Original kernel/domain adoption sequence | Historical planning input; subsequent bead-graph and versioning plans own current implementation sequencing. |

Current protocol authority is [the BDP specification](../../specs/bdp.md). This disposition was checked against baseline `0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`; pending draft PRs are not silently treated as merged law. Preserving a proposal does not ratify every position in it.
