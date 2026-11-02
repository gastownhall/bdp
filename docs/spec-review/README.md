# Canonical specification editing

This is the working Core/Write/Types/Transfer/CLI review, starting from main commit `692d801231c78e12b456d8c5213bdf137a6b534d`.

## Open these files

1. [Core](../../specs/profiles/core/core.md)
2. [Write](../../specs/profiles/write/write.md)
3. [Types](../../specs/profiles/types/types.md)
4. [Transfer — proposed](../../specs/profiles/transfer/transfer.md)
5. [CLI](../cli-design/bdp-cli.md)

The [CLI mismatch audit](cli-mismatches.md) is the first-pass reconciliation list. The CLI remains a client contract: it does not add protocol capabilities through command examples.

These are the specification text, not a guide to reconstructing it. Each rule belongs in its canonical document. Shared Resource, Reference, authorization, read and Event rules belong in Core; mutations and atomic write effects belong in Write; optional definition interpretation and Type constraints belong in Types.

Transfer is a new proposal, with its [correspondence and remaining mappings](transfer-review.md)
explicitly recorded. Its proposed command mapping is inline in the canonical CLI.
Events remains optional and currently documented in Core; a separate Events
document is a recommendation, with no clause or wire-profile move adopted.

## Donna's review loop

One edit branch, `codex/trish-canonical-spec-review-20261101`, and one draft PR carry the complete review. Main stays stable until the joint pass is approved.

Donna edits the canonical files directly in VS Code and leaves comments where needed. Ordinary inline comments are fine; `<!-- Donna: ... -->` is an optional searchable form. Trish reads the file before making changes, processes the comments, checks the resulting text and pushes to the same PR. A comment stays until its correction is accounted for. Genuine semantic choices return to Donna; editorial repairs do not require another process vote.

One writer owns a file at a time. When Donna takes the editorial pen, agents stop changing those files until she hands them back. Other worktrees, user stores, builds and release pins are outside this edit loop.

## What the first assembly means

The first assembly consolidates the selected draft rules and removes the need to apply later amendments mentally. It does not reopen settled decisions or turn proposed transports, lifecycle commands or experimental extensions into requirements. Historical source is preserved in [the archive](../../specs/history/pre-canonical-20261101/README.md). It is provenance, not another current authority.

Review Core, then Write, then Types, then the proposed Transfer profile, then CLI; also review their boundaries together. Approval of the complete pass produces one exact specification-baseline commit. Only then do the reference implementation and conformance tests enter their alignment pass. Implementation gaps and editorial questions remain explicit rather than quietly changing the intended contract.

## Embedded Core schemas

Core now carries its description-rich schema definitions beside the concepts they describe. Edit the visible DSL between matching `<!-- bdp-schema:start NAME -->` and `<!-- bdp-schema:end NAME -->` comments. The delimiters are complete lines; the body remains readable Markdown. Do not hide definitions in review comments. Arbitrary prose belongs outside each fragment.

The extractor uses the existing lossless Markdown JSON Schema codec. It updates the Core-owned definitions in both JSON distribution copies, preserves other profiles' definitions and records the complete generated Core ownership inventory so an accidentally removed fragment fails validation. Removing or renaming a previously owned definition requires an explicit migration. Write and Types will receive their own inline-schema pass; this Core pass does not silently select historical helpers elsewhere in the common bundle.

```sh
node scripts/spec-schema-fragments.mjs --write
node scripts/spec-schema-fragments.mjs --check
node --test scripts/spec-schema-fragments.node-test.mjs
```

OpenAPI authoring remains a separate decision. The older generated HTTP catalog and schema indexes still pin the pre-consolidation source layout and require a deliberate mapping update; their old source fingerprints are not automatically rehashed. Their failures do not change the meaning of the canonical files, and are not reported as passing checks.

## CI during the review

CI remains enabled. The `specification` job runs dependency-free structural checks on the canonical documents and entry points: Markdown fences, local file/heading links and syntactically valid JSON examples. It also validates embedded Core schema extraction, complete source ownership and both JSON distribution copies, and runs the extractor regression tests. It reports Donna comment markers without treating them as resolved. These checks do not establish semantic completeness, JSON-schema conformance, implementation support or release readiness.

The `changes` job examines the complete base-to-head path set and both revisions' file modes and content. The specification lane covers named specification/client/review Markdown, navigation and glossary files, and the explicit editorial/extraction tooling exercised by this lane. It also permits the two common v0.1 JSON distributions only when they agree, existing Core ownership is preserved, and changes stay within the definitions authored in Core; other-profile definitions and schema identity remain unchanged. The sole additional baseline exception is the already reviewed removal of `events` from Write discovery's required list; adjacent Write changes do not qualify. The corresponding schema Markdown is supporting specification material. A package-script edit qualifies only when it adds the extractor regression file to the existing Markdown test command without changing dependencies or any other script.

Product code, dependency/lock changes, other schemas, other-profile definition changes, symlinks and unrelated tooling require the existing implementation job. Sixteen temporary-Git-history regression cases exercise positive and refusal boundaries, including mixed product changes and negative-zero drift. The two named retained CSV shell examples receive a syntax check without execution; other shell scripts require implementation checks. The CI policy and extraction tools receive human review with the baseline; a classifier result alone is not acceptance evidence.

The implementation job retains its existing build, test, generated-artifact and evidence steps. It runs when the changed paths require it. On a specification-only change it is visibly skipped, not reported as passing conformance. The [existing OpenAPI catalog is historical for this baseline](../../specs/openapi/README.md); Donna expressly selected that disposition instead of remapping the retired inputs before the baseline. Its generator and original failed runs remain unchanged. Current OpenAPI regeneration and historical citation/test alignment are dated deferrals owned by Trish. The aggregate `verify` status requires the applicable jobs to succeed. Existing failed runs and historical evidence are not rewritten or upgraded.

Run the fast local checks with:

```sh
python3 -B scripts/check-spec-editorial.py
```

A successful editorial check means the documents passed those structural checks. Donna's review and the independent consistency review remain separate.

## Baseline merge checklist

Donna's November 1 merge brief governs this pass. The current branch is later than its `72f92fe8` snapshot: the CLI rulings and proposed Transfer draft are already included. Until the baseline is merged, Trish works only on this PR. The fleet and all implementation work, including Beads and the older server batch candidate, remain held. Eight archived dispatcher handoffs have been read without action or reply.

| Item | Disposition |
| --- | --- |
| M1 | CLI Events is consistently optional; full duties apply within advertised Events. Corrected at `2aceaa942a14f8918d282e3736acb8cd7eacbbad`; this pass makes the remaining two summaries explicitly conditional. |
| M2 | CLI-03, CLI-05 and CLI-06 are resolved at `2aceaa942a14f8918d282e3736acb8cd7eacbbad`; the audit gives the exact source commit. |
| M3 | CLI-02 and CLI-08 are resolved; HTTP flags and the full Type/packaging inventory have explicit November 1 deferrals owned by Trish. |
| M4 | The old integration-branch proposal is preserved under `specs/history/`; active documents point directly to the single canonical review. |
| M5 | Both retained v0 schemas are labeled historical evidence inputs; the glossary identifies the current authoring/distribution boundary. |
| M6 | Donna selected a historical OpenAPI catalog and separate specification checks. Old artifact bytes and failures remain preserved; canonical regeneration and implementation alignment are deferred, owner Trish. |
| M7 | [#336 was archived without merge](https://github.com/gastownhall/bdp/pull/336#issuecomment-6569514085), with its branch retained and a pointer to this PR and its complete preservation/residual report. Historical loader, exact source/catalog pins, citation controls and future generated mapping remain Trish's recorded alignment duties. No wholesale cherry-pick or inherited qualification. |
| M8 | Run the three requested local checks sequentially, push normally, then record the actual head and hosted CI run/outcome in the PR body. Until those receipts exist this item is pending. |
| M9 | Donna reviews the complete pass and merges with a merge commit. Trish does not merge or declare human approval complete. |

After the merge, record the actual baseline SHA and dated deferrals, prepare a baseline notice for Donna to post, and start no implementation or queued handoff until the fleet resumes. Proposed Transfer and Query bindings remain visibly unadopted.
