# Bounded erasure review corrections

Metadata-only incident-Link Events were deliberately authorized. Remove the obsolete unsupported-domain error class/catch/comment; preserve actual projector membership and erased-cursor commitments.

An administrative erase now marks/re-writes a retained group only when an Event or upsert postimage is actually removed. Unaffected groups retain exact bytes and contiguous framing. The private optional erasurePruned marker is boolean-validated and enables relaxed gap framing only when exactly true. Existing actual original ordinals and missing-ordinal commitments remain unchanged.

All selected retained body identities, including cascade-added source versions, must have a same-Scope canonical prefix before deriving a local live lookup key. This defensive prewrite refusal does not invent a cross-Scope erasure operation or permit live erasure without successor/tombstone.

A separate versioned erasureVersionBackfill=retained-postimages-1 metadata marker records completed postimage backfill. It commits atomically with that backfill and is independent of request fingerprint migration. Missing markers backfill compatible native stores once; ordinary reopen does not reinsert every retained historical copy. Native restore continues to use the destination permanent anchor; no public format/config/HTTP API or retention budget changes.

Six new bounded native cases demonstrate unchanged unrelated group bytes, strict marker validation in both projections and the actual owner reader, foreign-scope cascade refusal, and one completed missing backfill followed by a SQLite trigger proving no repeated insert attempt on reopen. Initial RED6fail and GREEN6pass are preserved; no original passing cohort is replayed.

The external report's finite HTTP publication-cancellation mapping (finding2) is deferred to a separate route-provenance/law audit. This tranche does not change runtime status selection, timing, or publication semantics. Generic current finite service failure is not automatically a violated cursor-expiry rule.
