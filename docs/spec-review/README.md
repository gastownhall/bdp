# Canonical specification editing

This is the working Core/Write/Types review, starting from main commit `692d801231c78e12b456d8c5213bdf137a6b534d`.

## Open these files

1. [Core](../../specs/profiles/core/core.md)
2. [Write](../../specs/profiles/write/write.md)
3. [Types](../../specs/profiles/types/types.md)

These are the specification text, not a guide to reconstructing it. Each rule belongs in its canonical document. Shared Resource, Reference, authorization, read and Event rules belong in Core; mutations and atomic write effects belong in Write; optional definition interpretation and Type constraints belong in Types.

## Donna's review loop

One edit branch, `codex/trish-canonical-spec-review-20261101`, and one draft PR carry the complete review. Main stays stable until the joint pass is approved.

Donna edits the canonical files directly in VS Code and leaves comments where needed. Ordinary inline comments are fine; `<!-- Donna: ... -->` is an optional searchable form. Trish reads the file before making changes, processes the comments, checks the resulting text and pushes to the same PR. A comment stays until its correction is accounted for. Genuine semantic choices return to Donna; editorial repairs do not require another process vote.

One writer owns a file at a time. When Donna takes the editorial pen, agents stop changing those files until she hands them back. Other worktrees, user stores, builds and release pins are outside this edit loop.

## What the first assembly means

The first assembly consolidates the selected draft rules and removes the need to apply later amendments mentally. It does not reopen settled decisions or turn proposed transports, lifecycle commands or experimental extensions into requirements. Historical source is preserved in [the archive](../../specs/history/pre-canonical-20261101/README.md). It is provenance, not another current authority.

Review Core, then Write, then Types; also review their boundaries together. Approval of the complete pass produces one exact specification-baseline commit. Only then do the reference implementation and conformance tests enter their alignment pass. Implementation gaps and editorial questions remain explicit rather than quietly changing the intended contract.

## CI during the review

CI remains enabled. The `specification` job runs dependency-free structural checks on the canonical documents and entry points: Markdown fences, local file/heading links and syntactically valid JSON examples. It reports Donna comment markers without treating them as resolved. These checks do not establish semantic completeness, JSON-schema conformance, implementation support or release readiness.

The `changes` job examines the complete base-to-head path set. Only Markdown in the named specification/editorial directories, the explicit navigation/provenance files and the two reviewed editorial-CI infrastructure files use the editorial lane. Generated schema Markdown, JSON schemas, fixtures, product code, dependency/lock files and other tooling changes require the implementation lane. This bootstrap PR deliberately includes `.github/workflows/ci.yml` and `scripts/check-spec-editorial.py`; their logic receives independent review along with the documents.

The implementation job retains its existing build, test, generated-artifact and evidence steps. It runs when the changed paths require it. On an editorial-only change it is visibly skipped, not reported as passing conformance. The aggregate `verify` status requires the applicable jobs to succeed. Existing failed runs and historical evidence are not rewritten or upgraded.

Run the fast local checks with:

```sh
python3 -B scripts/check-spec-editorial.py
```

A successful editorial check means the documents passed those structural checks. Donna's review and the independent consistency review remain separate.
