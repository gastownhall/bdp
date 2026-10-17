> Nonnormative planning/review background. Proposed contract authority is under specs/proposals/interchange; no runtime or landing authorization.

# Iris review of Polly’s shared Inception recommendation

October 17, 2026. Design feedback only; Donna has not adopted the recommendation. No schema/runtime changes or implementation restart.

Reviewed `/Users/dbox/.local/state/polly/inception-20261017/RECOMMENDATION.md`, SHA256 b09e15e686ee16b588be0bc49088ef36245c7f016342a41d15de9083d30cf389. This identifies the exact reviewed text while Polly’s native/Claude review proceeds.

## Fit

The proposed separation of original identity creation, entry into the current recording context, and operation producing this revision fits identity-preserving interchange. Beads and Links share it. Original retained versions/provenance stay unchanged; destination import facts belong to the new head. Scope alone cannot identify successive recording contexts. Updating/restoring content must preserve current entry rather than copy an older snapshot’s entry. No mandatory Activity record or second provenance envelope is needed.

Agree that copy/conversion of a genuinely new identity has its own origin, and current submission does not authenticate source claims. No source history is replayed as local Events. All exact fields, cause vocabulary, origin-account corrections and no-op consequences remain owner decisions rather than adopted schema.

## Format correlations and decisions

1. **A receipt can anchor entry, subject to lifetime separation.** One accepted import invocation can supply one admission correlation shared by its Beads/Links. Per-Resource records bind source ID/revision to resulting head and disposition. Bind the invocation to package digest plus admission policy and authorized destination context. Distinguish import mode from Resource origin. A retry returns that committed correlation; it does not create another entry. A package digest is not itself an invocation identity.

2. **Do not persist a raw caller idempotency key as public provenance.** Retry-key lookup and provenance correlation serve different audiences/lifetimes. Use a stable non-secret admission/receipt identity qualified by a defined recording context, or equivalent unambiguous correlation. This need not invent a globally unique URI scheme, but same Scope at different authorities and coincident local receipt numbers must not collide. Origin/entry observations do not themselves authorize Scope adoption.

3. **Receipt expiry must not erase entry meaning.** Operational retry/result pages may expire. The minimum entry fact and correlation recorded with retained versions must remain meaningful and portable; either retain the necessary admission descriptor or carry sufficient immutable fact inline. Do not require export/read/restore to contact an expired receipt service. A surviving reference need not promise that every old result page remains retrievable forever. Specify that distinction.

4. **Avoid a revision/receipt hash cycle.** An import head may refer to the admission, while the final receipt maps to that head’s revision. Allocate a stable correlation before minting heads; do not define it as the hash of a final receipt that already contains those heads. Publish heads, admission facts and receipt atomically. Preserve selected revision/hash rules; this is not a request for an ad hoc unhashed provenance field. The transfer footer is a package byte-integrity check, not a Resource revision or proof of origin.

5. **Older package with no origin:** preserve omission in original retained versions, without byte/value normalization. Recommend the new head preserve unrecorded origin as unrecorded while separately recording known destination entry. Polly’s sentence permitting the new head to report explicit unknown needs a deliberate rule: absent and explicit unknown were intentionally distinguished. If Donna selects that conversion, specify it as a destination assertion, not recovered source knowledge. Malformed or unsupported required provenance is a refusal, never downgraded to missing/unknown. Add positives for both unrecorded and explicitly unknown source origin.

6. **Historical entry is source state, not destination truth.** Each retained source version keeps its entry. Later export may carry different entries across versions, including several prior handoffs. The source-head marker identifies which source version feeds this import; record its exact address. The new head records the new destination entry and source-version correlation. Do not rewrite every retained entry, flatten the chain to the latest entry, or retarget existing exact pins. Round-trip equality compares original retained state and accounts for successive new import heads.

7. **Legacy conversion needs a per-identity distinction.** For legacy Memory keys with no prior canonical graph identity, conversion creates a new canonical identity and import/legacy-conversion is a known birth/admission cause. Do not infer new identity solely from conversion mode: if another supported legacy Resource already has a canonical identity that must be preserved, classify it under the appropriate continuity/admission rule. Human keys, short IDs and canonical identity are not interchangeable. Preserve available original facts with their actual source meaning; do not assign origin from the first retained row. Copy/remint remains deferred.

8. **Restore test belongs to shared History, not a new import mode.** Import an old source version without entry; then update/delete/restore its content. The resulting revision preserves current destination entry and applicable latest origin account, with current restore operation context. If that applicable account is unavailable/corrupt, refuse according to History’s evidence rules. Exact old reads still show their old provenance. This is consistent with G3 and does not add populated-store import/upsert.

## Suggested conformance cases

- One import creates Bead and owned-Link heads with a common admission correlation and exact per-Resource source/head mappings; injected failure publishes neither mappings nor any heads/effects.
- Retry after lost response returns the original receipt; conflicting package/policy refuses. Operational receipt expiry does not break a retained version’s entry interpretation or portable export.
- Two recording contexts serving the same logical Scope use colliding local receipt numbers: entry correlations remain distinguishable without claiming authenticated source history.
- Import→export→fresh import preserves every original account, adds a distinct new entry/head only where selected, and leaves exact historical pins unchanged.
- Absent, explicit unknown, partially known and extension-cause origins preserve their distinct valid states; invalid required forms refuse atomically. Unknown recorded cause does not enable execution of an unsupported import mode.
- Exact source ID/revision with conflicting content or provenance refuses; package digest/receipt does not authorize reconciliation. Original unknown times/authors remain unknown.

This is format feedback, not approval of origin-account correction or a new general provenance-only mutation. Those need explicit shared guard/no-op/version semantics and a Memory R3/R12 reconciliation before claiming conformance. Preserve required P3 G1/G2/G3 independently of broader provenance expansion; the minimum import contract still needs its own approved semantics and qualification.

Polly’s subsequent reviewed recommendation incorporates the format feedback:
new heads preserve unrecorded origin as unrecorded; explicit unknown stays
explicit; identity continuity/copy is separate from legacy-conversion as a
transformation. Admission correlation is portable beyond retry-page expiry and
avoids a receipt/head hash cycle. These remain recommendations pending Donna,
not adopted fields or an origin-account-correction implementation dependency.
