# Installed historical owned-Link cascade and last-version withholding

This new test-only unit uses exact combined source `4b264f9d82eb47dae398298dcf1881add85d65ea`. It does not rerun PR197's unowned case or PR198's mutation surface. Runtime, protocol, specification, portable manifests and production administration are unchanged. No live-owned erasure, source tombstone cascade, restore/new-epoch, arbitrary view, optional History, all20 baseline, whole profile or whole-fit claim is made.

## Authored finite fixture and expected records

Task Type explicitly owns outgoing Owned Link Type with max4; both endpoint constraints are local Task. Actual public mutations construct one Link between Beads `a` and `b`:

| Position | Actual operation / selected version |
|---|---|
| pos1 | Create safe Beads a/b. |
| pos2 | Create owned Link L1 carrying `old-owned-secret`; source Bead becomes A1 and inlines that complete Link. Capture first-class L1 and full public A1. |
| pos3 | Update Link to healthy L2; source becomes A2 with exact healthy inline L2. |
| pos4 | Historical erase L1 only through existing installed companion. Expected cascade is exactly two records: L1 and A1. Full current L2/A2 remain unchanged. Scope `linked` facts remain because another Link version still carries its endpoints. |
| pos5 | Publicly delete L2. Source becomes current A3 with an empty declared owned set. Only now is L2 also eligible for historical erasure. |
| pos6 | Historical erase L2. Expected cascade is exactly L2 and A2; final ledger has four exact subject/revision/digest records. Current A3/b stay complete and unchanged, no live Link remains. |

Expected JCS digests are independently computed from the complete Resource versions captured over public HTTP, stripping only the derived `links` aggregate if present. The fixture helper sorts JSON object member names and preserves array/value order; it does not call the production digest helper. Actual inlining and source revisions are checked before each historical selection. Three counterfactual controls reject a missing cascade, wrong digest and wrong revision.

## Event and publication behavior

An actual public caught-up SSE stream observes groups pos2 through pos6, including both complete erasure record sets at pos4/pos6 with no changes/Events and eventCount0. All original wire bytes are retained. Earlier frames delivered before erasure are client-held history, not a claim that the server may republish erased content.

After first erasure, the Scope still has two linked facts and current full L2/A2. After deletion and second erasure, Scope graph facts are withheld: the earlier eight visible facts become exactly the four unaffected full facts in their original order. The literal identity-only Link deletion and nested owned-deletion Event survive. Endpoint b's three facts become its one unaffected original fact. An actual captured linked Event cursor remains valid and exclusive, returning an empty terminal result after withholding. Fresh Snapshot contains exactly A3/b, no Links, and the four ledger records. Both Link receipts return content-free erased results while retaining required source/sourceRevision lineage.

## Installed private administration, never public control

The new sidecar adapts the reviewed PR197 private pattern. It imports actual installed configuration capture/payload/startRuntime/companion modules by exact path, obtains administration only from the SAME authentic facade, and accepts at most two requests for `links/l`. No runtime implementation is copied. No normal wrapper identity check is repaired, and no public HTTP route, package export, CLI/config control, clock seam or live administrative operation is added. Readiness explicitly labels this a private historical-owned administrative fixture, not an ordinary deployment.

The serving build/pack was made from clean exact4b BEFORE new test authoring. Eleven local tarballs install seventeen packages offline with zero downloads. The actual case checks all72 installed server JS modules against emitted bytes before launching and compares packaged/canonical schema. Sixteen protocol JS modules are additionally byte-compared post-run; that is metadata verification, not another execution. Exact package/module/config/source/fixture identities are retained separately from the test controller's source transport helpers.

## Validation and limits

Initial new case PASS652ms. Only the materially strengthened Scope/endpoint full ordered survivor-Event assertions were then validated: PASS659ms. Both source snapshots, logs, receipts, complete config/wires and process evidence remain separate. Neither PR197/198 nor a passed unrelated case was replayed. Final case has22 finite HTTP responses (21x200, one ordinary Link404), plus the deliberately nonterminal SSE connection. Child exit0, both channels closed/reaped, no force/overflow, SSE explicitly destroyed/closed, outer process group absent and test-owned database removed.

Typecheck, format, build and dependency boundaries pass; focused lint exits0 with two non-null assertion warnings. Bounds: child channels64KiB, ready/close10seconds, finiteHTTP5seconds, response1MiB, request headers16KiB/body64KiB, at most70 finite requests and12pages per explicit Event scan, existing SSE2MiB/20second recorder, cohort45seconds/test60seconds/outer90seconds. These are test observation limits, not a product runtime cap increase or universal fit proof.

Private full credentials/configuration/wires remain0600 under `bdp-write-product-reset-20261020/owned-erasure-installed`. Publish only its redacted completion. The historical fixture's success does not support erasing a live owned Link/source version; unsupported live-owned behavior stays a separate explicit gap.
