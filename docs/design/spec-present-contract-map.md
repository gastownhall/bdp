# Present-contract editorial pass

This non-normative map accounts for the editorial changes from
`e9361d77b862aa0e6ddfa19cf272225f62c32d35`. It preserves the draft's contract;
it does not adopt new schema, runtime, Type-lifecycle or conformance behavior.
Development history remains in Git and the existing design decision documents.

## Inventory and disposition

| Family | Disposition |
| --- | --- |
| Inline dates, amendment labels, council/ruling identifiers and issue-comment provenance | Remove the provenance, retain the operative sentence and requirement force. Example timestamps and standard versions remain data. |
| Implementation-origin discussion in Status | Remove the development narrative. The draft status, version/namespace rules, uniformity principle and normative schema authority remain. |
| Optional historical-read definitions scattered through core Read | Move change context, historical authorization, discovery/view details, historical deletion diagnoses and the capability's CORS obligation into Historical resolution. Core sections keep short navigation references. |
| Retained-address laws in Revisions | Preserve as generic revision invariants, including retention across restore and prohibition on rebinding an address to different state. They are not conditional on advertising History. |
| Dated Open protocol questions ledger | Remove repeated answers and obsolete artifact gates. Present-contract homes for every entry appear below. |
| Deferred companion work and implementation ledger | Remove implementation staffing/language/workflow plans and CLI inventories. Existing Type-installation exclusion, domain modeling rules and protocol scope remain in their normative sections. |
| Conformance-row introductions | Replace development chronology and test-mechanics narratives with direct metadata/evidence status. Preserve every row, retirement, cumulative obligation and applicable-row proof requirement. |
| Reference implementation diagnostic defaults | Remove the non-normative configuration example (1 MiB request/properties, 8 MiB diagnostics); preserve the preceding normative feasibility, complete-diagnostic and retained-configuration obligations. Implementation settings remain implementation evidence, not protocol maxima. |
| Explicit feature exclusions | Preserve the present limits: no new mutation/replication requirements for optional Read History, no generic retention guarantee, no alternative surviving-citation lifecycle, no import endpoint, and no additional Type/aggregate capabilities. |

## Removed ledger: requirement homes

The item numbers below refer to the removed Open protocol questions ledger,
not new normative identifiers. References target the present specification.

| Old item | Present-contract home |
| --- | --- |
| 1: profile membership and minimum Read | [Read discovery](../specs/bdp.md#scope-discovery-and-human-documentation), [Read conformance](../specs/bdp.md#read-conformance), and the three cumulative profile parts. Optional History remains a capability. |
| 2: singleton/sequence semantics, local bindings, retries, aliases and durability | [Operation Directory](../specs/bdp.md#operation-directory-and-singleton-targets), [sequence](../specs/bdp.md#readupdate-sequence-target), [alias targets](../specs/bdp.md#alias-targets), [durability](../specs/bdp.md#durability-and-recovery). Superseded alias-deferral and implementation-wave statements are chronology. |
| 3: service-desc and fixed discovery vocabulary | [Scope discovery](../specs/bdp.md#scope-discovery-and-human-documentation). |
| 4: optional but binding advertised limits | [Read limits](../specs/bdp.md#advertised-limits), [Read+Update limits](../specs/bdp.md#readupdate-schema-and-limits), [Transactional limits](../specs/bdp.md#transactional-limits). |
| 5: one offline bundle and profile-specific envelopes | [Normative schema bundle](../specs/bdp.md#normative-schema-bundle), [operation records](../specs/bdp.md#operation-record-schema), [mutation results](../specs/bdp.md#mutation-results), [Transactional schema inventory](../specs/bdp.md#profile-schema-inventory). Draft dates, old definition counts and evidence pins are not protocol requirements. |
| 6: problem families, closed tables, reference/alias failure boundaries and History diagnoses | [Read problems](../specs/bdp.md#problem-details), [Read+Update problems](../specs/bdp.md#readupdate-problem-details), [sequence problems](../specs/bdp.md#sequence-problem-envelopes), [Transactional problems](../specs/bdp.md#transactional-problem-details). The final tables govern; obsolete intermediate alias-code assignments do not reappear. |
| 7: HTTP consistency, authorization, private caching and CORS | [Read HTTP fields](../specs/bdp.md#http-consistency-caching-and-cors-fields), [Read+Update consistency](../specs/bdp.md#readupdate-consistency), [Transactional HTTP consistency](../specs/bdp.md#transactional-http-consistency), [Historical HTTP metadata](../specs/bdp.md#historical-http-metadata). |
| 8: Event/checkpoint tokens and genesis | [Event-ID and checkpoint character profile](../specs/bdp.md#event-id-and-checkpoint-character-profile). |
| 9: deleted/unknown/nondisclosed identities, discretionary ordinary 410, authorized historical reads | [Reads after deletion](../specs/bdp.md#reads-after-deletion), [Historical diagnoses](../specs/bdp.md#historical-diagnoses-and-missing-state), [Events after deletion](../specs/bdp.md#events-after-resource-deletion). |
| 10: no authority-attested actor, carried attribution | [Actor attribution](../specs/bdp.md#actor-attribution), [Carried attribution](../specs/bdp.md#carried-attribution), and profile-local mutation/receipt/Event prohibitions. |
| 11: no universal root Type | [Types](../specs/bdp.md#types); category and domain conformance remain separate. |
| 12: optional generated OpenAPI, no per-Scope/Type requirement | [Link endpoint constraints](../specs/bdp.md#link-endpoint-constraints) retains the generic OpenAPI/tooling paragraph and normative-spec/schema authority. |
| 13: cumulative public conformance matrix and claim evidence | [Normative conformance matrix](../specs/bdp.md#normative-conformance-matrix), all profile row tables and their retirement rules. Metadata is not execution evidence. |
| 14: optional maximum endpoint multiplicity and policy replacement | [Scope aggregate constraints](../specs/bdp.md#scope-aggregate-constraints), [Aggregate-constraint enforcement](../specs/bdp.md#aggregate-constraint-enforcement). |
| 15: at least one local Link endpoint | [Beads and Links](../specs/bdp.md#beads-and-links). The both-external case remains outside v0. |
| 16: wildcard ownership, whole-set max and property References as authored data | [Owned Links](../specs/bdp.md#owned-links), [References](../specs/bdp.md#references), [Installed Type contracts](../specs/bdp.md#installed-type-contracts). The historical rationale and withdrawn proposal are removed; no Reference-validation capability is added. |
| 17: exact-decimal equality, round-trip admission and named token schemes | [Revisions](../specs/bdp.md#revisions), [Numeric admission](../specs/bdp.md#numeric-admission), [BDP JSON](../specs/bdp.md#bdp-json-and-http-protocol). |

## History preservation

History remains optional, complete and available on each cumulative profile.
The Read subsection states this without naming future profile mechanisms.
Advertisement remains exactly the closed `historicalResolution: { "version": 1 }`
member. No current implementation or capability claim follows from this text.

The pass preserves exact revision-specific GET/HEAD, full owned-state reads,
subject-history versus whole-record authorization, uniform unauthorized refusal,
all five historical diagnoses and their precedence, bounded missing inventories,
retained-version pages and cursors, lineage and version relations, context metadata,
imports, erasure, recovery and scoped assurance. Shared schemas continue to permit
absent context for legacy/non-History versions. Write and Transactional extensions
remain in their own parts. Core retained-address laws remain unconditional.

## Citation and verification scope

Catalog IDs, titles, profiles, kinds, retirement lists, requirement counts and all
non-citation fields are unchanged. Eleven excerpts change across four catalogs:
Read 1, Read+Update 4, Transactional 2 and History 4. No schema, fixture, runtime,
evidence artifact or evidence constant changes.

The removed `open-protocol-questions` and
`deferred-companion-work-and-implementation-evidence` headings are development
ledgers, not public compatibility obligations. Current internal links and catalog
citations must resolve; no bookmark-only replacement anchors are introduced.
The earlier profile map's old-anchor preservation counts describe its earlier
round, not this pass.

The known current Read evidence byte-binding drift remains unresolved until a
genuine new two-target qualification run. This editorial pass does not rerun the
whole repository suite merely to rediscover that known failure, and claims no
current Read seal or write-profile qualification.

## Validation of this pass

- Pinned Node 24.16.0 / pnpm 11.20.0; frozen install succeeded.
- Protocol and conformance suites: 42 files, 1,636 tests passed, no skips.
  Earlier runs identified two citation migrations; the final complete targeted
  run passed after both were corrected.
- Typecheck, dependency-boundary check, whole-repository formatting and
  `git diff --check` passed.
- Anchor audit: 144 current anchors, 142 prior anchors retained, two development
  anchors removed and two local History subsection anchors added; 170 internal
  links resolve. No Read/Read+Update link points to a later profile.
- All 539 spec citations audited. All six catalog scenario counts, non-citation
  fields and requirement counts are preserved. Eleven selected excerpts change.
- Every table row is unchanged after stripping only inline provenance labels.
  All pre-ledger uppercase requirement-word counts are unchanged (128 MUST,
  31 MAY, 15 SHOULD, 2 SHALL, 1 REQUIRED); relocated/rephrased requirements were
  also inspected individually, because counts alone do not prove equivalence.
- Both schema copies are byte-identical and unchanged. Runtime, fixtures, sealed
  evidence and constants are untouched. Full-repository tests and new evidence
  generation were not run in this editorial slice.
