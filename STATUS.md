# Status

This repository holds the BDP v0 **draft**. Until the draft is adopted it is
not a conformance target.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | Wildcard ownership, numeric model, named schema projection and erasure-pointer correction are being integrated | Historical two-target cohort retained in Git; the changed Read contract requires genuine successor observations before a current conformance claim |
| Read+Update profile | Ruled wire artifacts on PR #19, not yet integrated here | Runtime not yet realized |
| Transactional profile | Ruled wire artifacts on PR #20; approved gap closure in progress | Runtime not yet realized |

The foundation integration combines PRs #22, #23, #24, #26 and #27. All
source ancestry is preserved, including #24's evidence-only migration branch.
The approved named Read seal retains its existing ordered definitions and
appends `ownedWildcardDeclaration`; coverage checks do not choose digest inputs.
Implementation, catalog/manifest/fixture changes and the seal list must precede
the new run head. Only the generated cohort artifact and matching capability
constant belong in the subsequent evidence commit.

Evidence discipline: claims require the committed two-target cohort in
`docs/design/evidence/read-cohort/read-v1.json`, verified by
`pnpm evidence:verify` under `packages/conformance/matrices/README.md`.
Runner reports keep `claimEligible` false by construction. The historical
cohort is not proof of the changed wildcard, numeric or erasure behavior.
Applicable new rows need actual observations; absent features need justified
not-applicable dispositions. The Read manifest remains separate from later
profile manifests.

The wildcard runtime review in `docs/design/owned-wildcard-runtime-review.md`
records isolated parser, adapter and public HTTP checks; those checks alone
are not catalog execution or a replacement cohort.

The erased-resource pointer correction is documented in
`docs/design/read-erasure-pointer-correction.md` and is included before the
successor observations.

Open protocol questions and dated rulings are recorded in the specification.
