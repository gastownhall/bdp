# Beads Preview3 versus BDP Preview3

**Initial comparison record — not a conformance certification.** The final BDP
baseline SHA and Beads release source/build/evidence pins have not yet been selected
in this record. Branch names are discovery pointers, not reproducible release pins.

| Pin | Current disposition |
| --- | --- |
| BDP working branch | `codex/bdp-v0.1`; final BDP Preview3 commit follows reconciliation/qualification |
| Beads working branch | `donnabox/beads:codex/preview3-integration`; release owner selects exact release source/build |
| Earlier landed Memory evidence | Beads PR130/141/205/217; qualified PR217 merge `6a5f47b43889ac3edf82ce7c5442b5ac2a23102e` has its own runbook/evidence, not a claim about later product heads or the new BDP baseline |

## Starting gap inventory

These dispositions preserve known scope. They must be checked against the exact
selected release build and final BDP commit before release notes claim support.

| Area | Starting disposition | Required release accounting |
| --- | --- | --- |
| Fixed Memory Types, retyping and endpoint pins | Product work landed under its selected Memory contract | Cite the exact build and existing relevant evidence; identify differences from the BDP baseline |
| General Scope-wide Types profile | Full runtime support not qualified by the descriptor/schema work | Do not advertise complete profile support from fixed-catalog behavior |
| Type registration, defaults, retirement and package lifecycle | General public operation/CLI surface deferred | State unsupported/deferred scope explicitly |
| Exact Type-definition read service | Candidate source/grammar exists; provider/CLI service execution not established by artifact tests | Record actual capability and retained-read behavior or mark unsupported/unverified |
| Final-per-Resource atomic batch and required Events | Paired BDP source and static examples exist | Actual product comparison and runtime evidence required; do not inherit artifact-test passes |
| Scope paths and CLI correspondence | Accepted BDP target; product deltas require exact-source comparison | Preserve existing owner inventories and classify concrete mismatches |
| Experimental features | Outside retained baseline | No conformance requirement or product commitment |

Use existing issues and source/evidence inventories under [BDP59](https://github.com/gastownhall/bdp/issues/59);
this file is the release comparison artifact, not a new tracker or a request for a
broad audit/ACK campaign. Release notes may report conformance gaps. Unknown behavior
must remain unverified rather than being labeled pass or fail without evidence.
