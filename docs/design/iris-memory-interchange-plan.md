> Nonnormative planning/review background. Proposed contract authority is under specs/proposals/interchange; no runtime or landing authorization.

# Memory V2 import/export: implementation plan

Draft for Donna’s review — October 17, 2026. Implementation remains paused.

Deliver two capabilities in the current Go codebase: reliable legacy-to-graph import and a versioned, identity-preserving file contract for V2 interchange. Keep legacy import independently deliverable. Prepare the shared contract for a future Rust implementation without starting that implementation.

This is the delivery companion to the [interchange proposal](../../specs/proposals/interchange/interchange.md), not a replacement Memory or BDP specification. Approval of this plan would authorize bounded implementation; it would not settle the unresolved contract decisions listed below or authorize release integration.

## Inputs and scope

Align with [Trish’s scoped fixed Memory Types plan](https://github.com/gastownhall/bdp/blob/99ab2594202c7de436dc1b215770dcf0820e5790/docs/design/preview3-fixed-memory-types-plan.md) and [Chris’s Memory requirements](https://github.com/gastownhall/beads/issues/5877). Trish’s Memory input is candidate commit `38791e4cc6e16cf661fa839303d4ff315d49ab3d`; review the accepted landing delta before promoting fixtures or runtime behavior. Never ship illustrative Type identities or revision tokens.

Janet’s selected starting base is final graph-preview2, `703bb13e91aa2cab2092443319139006d74242c8`. Confirm it or an explicitly qualified successor before creating implementation branches. Reuse compatible Iris work from draft PRs [86](https://github.com/donnabox/beads/pull/86), [87](https://github.com/donnabox/beads/pull/87) and [88](https://github.com/donnabox/beads/pull/88), after reviewing its older base and assumptions. Earlier test evidence does not qualify the resulting source.

The initial new-format profile includes:

- UTF-8 JSONL with versioned manifest, complete Resource-version records and completion digest/counts. Resource payloads follow a pinned shared V2 contract; no private Go interchange schema.
- Explicit selected IDs or an admitted graph, plus required endpoint, owned-Link and pinned-version closure from one coherent source boundary.
- Full properties, metadata, canonical identity, retained revision tokens, References and recorded provenance. Memory bodies require explicit inclusion; automatic export excludes them.
- Identity-preserving admission into a fresh graph destination authorized for the same logical Scope. Collisions refuse; this is not populated-workspace upsert.
- Atomic bounded package publication, retained invocation receipts and a new import revision in front of each admitted source head. Original versions/provenance remain unchanged; original pins retain their original targets.

Propose absolute IDs for the first implementation. Local-ID encoding remains a future capability unless selected during review. Directory packages, arbitrary history archives, cross-Scope copying, federation, dynamic Types, set operations, new query languages, parameterized batches and Rust startup are outside this plan. Six individual Resource mutation operations remain the Go V2 cutline.

## Deliverable slices

Each slice returns a reviewable PR, exact source identity, test results and an explicit list of unqualified behavior. Do not stack legacy import on the new exporter or transfer reader.

| Slice | Change and completion evidence | Dependency |
| --- | --- | --- |
| I0 — contract and conformance corpus | Freeze the minimum envelope/Resource profile, preservation table and refusal vectors. Validate schemas, exact-byte framing, examples and expected semantic results. Record source commits and hashes for shared fixtures. | Can prepare against pinned candidates immediately after plan approval. Contract-owner decisions are required before freeze. No runtime activation. |
| L1 — finish legacy import | Adapt PR86 to the selected base and accepted Memory representation; retain a separate PR/release gate. Import actual disposable legacy-producer exports into fresh graph stores. Account for every ID, dependency, metadata field, key, comment and unavailable history: preserve, explicitly map or refuse. Verify atomicity and feature-off compatibility. | Does not depend on I1/I2. Complete Memory mappings depend on the accepted payload/catalog and shared mutation rules. |
| I1 — coherent graph export | Adapt the snapshot reader to complete Memory payloads, exact References and required historical/owned-Link closure. Add transfer serialization and explicit format selection. Reuse reviewed detached file publication. Qualify consent, coherent reads, bounds and output failures. | I0 writer contract; Trish F1/F2 for complete current payloads/catalog and F3/F4 plus History support for pinned/owned state. Pure serializer work can proceed earlier. |
| I2 — staged graph import | Implement strict package validation and an admission plan, then one native storage publication boundary for original retained versions, import heads, provenance/history facts and durable receipts. Add explicit CLI dispatch and structured outcomes. | I0 reader contract and shared history/provenance/authority decisions. Runtime admission needs the accepted catalog and exact endpoint/history support. Does not need I1 to validate independently authored fixtures. |
| I3 — installed qualification and handoff | Run the selected positive/refusal/fault corpus on the exact installed source in embedded and ordinary shared-server modes, including restart and retry. Deliver preservation/refusal documentation, client fixtures and a requirement-by-requirement release recommendation. | Each independently shipping lane must pass its own applicable gate. Full Go new-format qualification requires I1 and I2 together. Janet owns integration and engine scheduling. |

I1 and I2 can prepare codecs and test vectors independently. The new format is useful only when a reader and writer implement the same frozen contract; a writer-only PR is not a completed interchange feature. Legacy import may ship first. Donna decides which completed capability belongs in each release.

## Shared ownership and Trish alignment

Iris owns transfer framing, selection/closure planning, legacy mapping, admission planning, CLI import/export adapters, receipts and publication. Coordinate changes to shared storage before editing; do not implement another Memory validator, History system or catalog beside the owners’ work.

| Trish work | What Iris consumes or must review |
| --- | --- |
| F0 fixed validators | Reuse accepted validation and fixture meanings. Cover all six Memory Bead Types and six Memory relationship Types; do not infer affiliation from property shape. |
| F1 complete payload/history | Preserve specialized and permitted unknown-root properties, empty bodies, absent versus explicit unknown Inception and exact retained-state meaning. Current title/body-only export assumptions must go. |
| F2 catalog/CLI | Use final production identities and selected generation policy. Preserve old related/relates-to and Issue behavior; Association is a distinct Memory relationship. No silent workspace upgrade. |
| F3/F4 endpoint/lifecycle | Apply correlated pairs, canonical self exclusion, exact target requirements, retained endpoint affiliation and owned-source effects. Do not flatten pins or silently revive deleted Resources. |
| F5 installed evidence | Schedule with Janet; shared source changes require new qualification of the affected Iris paths. |

Jim/Polly own shared History/provenance integration. Trish/Melinda own Type/domain meaning. Vickie reviews public BDP DTO implications. Coordinate contract questions on bus #1 under tracker #6; do not silently redefine the frozen BDP contract or wait for unrelated amendments #152/#153. No generalized participation-minimum, pair-uniqueness or acyclicity engine is needed for the selected Memory relationships.

## Decisions to settle before dependent runtime work

These are bounded contract tasks, not permission to add more product features:

1. **Complete retained representation.** Pin accepted Resource/Memory/Type contracts, including key/name, Inception/sources and auxiliary state. Specify how the applicable historical contract is identified. No silent dropping of fields that do not fit the current DTO.
2. **Import transition and provenance.** Specify the narrow imported lifecycle fact, original-version reference, local actor/time/source claims, and exact source/Link ownership effects. Define consistent new heads without rewriting original owned snapshots or pins. Ordinary no-op update rules must not be bypassed with fake property edits.
   Polly’s candidate origin/entry design fits this split; [format review](iris-inception-format-review.md) records receipt-lifetime, correlation/hash-cycle, historical-entry and absent-origin decisions. Add their positive/refusal vectors to I0; do not treat the recommendation as approved schema.

3. **Authority admission.** Specify how a fresh destination is authorized to preserve the source Scope and how unauthorized or conflicting claims refuse. A source URI in a manifest is insufficient authorization.
4. **Limits and recovery.** Fix byte/Resource/version/owned-Link bounds, receipt retention and invocation-key scope, commit-outcome recovery and behavior after receipt expiry. No unbounded exactly-once claim.

The initial profile may refuse unsupported terminal/deleted endpoint combinations. It must still successfully transfer useful Task/Memory/Link graphs, including required historical pins. A profile too narrow to do that does not satisfy Memory interchange. Any remaining requirement gap needs Donna’s explicit exception or further implementation.

## Acceptance tests

Use synthetic fixtures and fresh disposable stores only. Never read production data, migrate a store in place or mutate shared core/staging. Use repository test/build instructions and canonical installed workflows; engine-skipped tests cannot qualify a release gate.

| Area | Required evidence |
| --- | --- |
| Legacy fidelity | Actual ordinary legacy export as producer input, Unicode and empty bodies, valid keys, dependencies, metadata/comments and unsupported history. No invented historical attribution. Explicit collision/ambiguity and refusal cases. Wider R24 access/storage paths remain separately accounted for. |
| Complete Memory state | All six Bead specializations; specialized required fields and legal unknown-root fields; absence/null/empty distinctions; explicit unknown Inception; metadata and provenance. Reuse Trish’s shared property corpus rather than duplicate its implementation. |
| Graph meaning | Useful Task–Memory association, each supported relationship form, parallel/cyclic informational Links where allowed, exact pins to older retained state and consistent owned snapshots. Exercise correlated-pair/self/pin failures and missing endpoints/versions. External References stay opaque. |
| Strict framing | Unsupported versions/contracts/capabilities, malformed values, duplicate JSON members and duplicate ID/revision records, incompatible content at an exact address, invalid source heads, forward references and arbitrary legal record ordering, truncation, digest/count mismatch and trailing data. |
| Source consistency | Concurrent mutations cannot produce mixed source boundaries. Exceeded capacity refuses without truncation. Failed export never returns a valid completion record. File output preserves the previous file until publication; stdout consumers require successful completion. |
| Atomic admission | Inject failures during retained-version, owned-state, head and receipt publication. After rollback/reopen, no partial Resources, history, Events, allocations or destination binding changes remain. Recheck destination emptiness/authority inside the transaction to defeat races. |
| Retry and outcome | Same retained invocation/package/policy returns the same receipt and heads; changed payload/policy conflicts. Lost response and post-commit cleanup failures resolve through durable receipt. A new invocation against an occupied destination refuses. Test restart and expiry rules. |
| Compatibility | Existing dependency-mode legacy import/export defaults and data shapes unchanged; direct and proxied routes checked against selected base. New-format selection in dependency mode refuses without mutation. Graph-mode assertions never convert workspace format. |
| Round trip | Export → fresh Go import → reopen/read/history → re-export. Compare canonical meaning, original retained versions/provenance, pins and owned state; account for new import heads rather than requiring byte-identical packages or destination revision tokens. |

Record exact source/tree, build identity, engine identity, commands, pass/fail/required-skip counts, fault points and cleanup. Run installed embedded and ordinary shared-server tests only in a coordinated engine slot. Verify source and destination assertions as well as process status. Preserve disposable failure evidence, then clean up owned stores/processes.

## Review and release gates

Before calling a concrete implementation plan or PR ready, obtain native Codex and actual Claude review, excluding Gemini as requested. Resolve findings and rerun affected checks on the final source. The proposal-publication council is complete with no remaining publication blocker; see the [joint review record](iris-joint-council-review-20261017.md). That disposition does not approve contract freeze, implementation readiness or runtime qualification. Concrete source changes still require their own exact-source council and validation.

For each lane, hand Janet the immutable source, preservation/refusal matrix, installed evidence and open requirement ledger. Donna selects release scope; no unqualified source lands solely because the format is agreed. A new shared base or changed Memory/history contract invalidates relevant earlier evidence.

Go contract/corpus qualification is an intermediate milestone. Actual independent interchange remains pending until a second implementation exists and passes Go → Rust → Go and Rust → Go → Rust on fresh stores plus independently authored shared fixtures. Do not label Go self-round-trips as cross-implementation proof. Rust setup and implementation require their own authorization.

## Proposed first action after this review

Start I0 and inspect the legacy PR against Janet’s selected base. Produce the exact preservation table, shared fixtures, file ownership/dependency list and smallest source PRs. Resolve the four contract tasks with the owners before dependent runtime admission. Keep all implementation work paused until Donna has reviewed this plan; no background worker or engine qualification is started by writing it.

Shared Inception candidate status is recorded in the [owning WIP contract](../../specs/proposals/interchange/interchange.md#shared-inception-design-update--october-17-2026); follow that disposition before schema freeze.
