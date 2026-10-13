# Private Snapshot core review closure

This successor preserves the private fixed all-visible Snapshot contract and the
successor-token page-width correction. It adds no HTTP serving, public profile
admission, retained-minimum interpretation, or rate policy.

Capture first checks the permanent issuance count and compact encoded ledger
bounds. It decodes at most eight live dispositions rather than materializing all
expired history. SQLite still scans the bounded ledger for count/size, expiry,
and classification checks: this is not constant-time population qualification.
Classification calls `json_type` once per ledger row. Separate detail-driven
queries consider distinct Snapshot IDs via the record/page primary-key prefixes;
they reject both missing parents and expired parents. Their work scales with
retained detail, rather than performing two empty-detail probes for every cold
historical handle. Snapshot read entries and maintenance still pay the bounded
ledger scans; no latency or throughput guarantee is claimed.
Malformed/nonboolean expiry flags and expired rows retaining record/page detail
are integrity failures. Orphaned record/page detail is also an integrity failure.
Capture asserts that any live disposition is unexpired at the captured instant:
the owner must commit expiry first using that same instant. It never silently
excludes still-retained detail from the live budget, and impossible excess live
handles remain corruption refusals. Detail-free expired entries retain their permanent count
and are validated fully on direct lookup. A cold expired commitment corruption
is consequently detected on lookup rather than eagerly on unrelated capture.
Neither that corruption nor a caller-forged token earns an issued-page response.

One validated resource map and outgoing-Link index replace per-Bead full-table
scans and repeated first-class Link decoding. The map is bounded by the existing
4,096-resource and 32 MiB encoded-record limits; decoded objects, inline owned
Links, and response construction require additional heap. Hot SQL statements are
cached lazily within the existing owner, because tables do not exist until first
provisioning. Retained page readback still independently validates returned data. The ceiling
population witnesses currently use Beads with empty owned-Link planes; they do
not combine maximum population or bytes with owned topology. Smaller owned
fixtures establish consistency, not a ceiling-owned heap/workload qualification.
The expiry-loop regression observes statement reuse while expiring all 65,536
fixture dispositions, separately from the zero-expiry capture regression.

Canonical Resource IDs are canonical HTTP URL spellings. The ordering regression
uses percent-encoded BMP and supplementary code points, with explicit expected
Bead, first-class Link, and inline owned-Link order. It does not treat decoded
UTF-16 identifier order as a protocol rule.

Private format `bdp-private-transaction-snapshot-10` persists the actual constant
`authorizationView: development-all-visible` in the installation configuration.
Prior format 9 and incompatible views refuse before BDP maintenance and pending
claim retraction, without rewriting the ordinary test files. No migration or
reseed is provided. Necessary SQLite hot-journal recovery can precede readable
configuration; these refusal tests do not claim otherwise. Startup expiry and
normal reads now use the same canonical-position context construction. The
immutable epoch is captured once inside provisioning/open, before the first
sweep, and reused by store identity, configuration and serving contexts. Position
remains a current guarded-entry read. Mutable epoch administration is unsupported.

The existing finite capacity remains deliberate: at most eight live handles,
64 MiB live encoded record bodies, and 65,536 issued handles per store epoch.
Detail expiry does not restore the permanent issuance budget. Reaching that
budget refuses further captures; no forgetting, sliding budget, rate guarantee,
or unattended-service longevity claim is introduced. Current private issuance
capacity is not general-purpose deployment qualification.
