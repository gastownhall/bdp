# Private Snapshot core review closure

This successor preserves the private fixed all-visible Snapshot contract and the
successor-token page-width correction. It adds no HTTP serving, public profile
admission, retained-minimum interpretation, or rate policy.

Capture first checks the permanent issuance count and compact encoded ledger
bounds. It decodes at most eight live dispositions rather than materializing all
expired history. SQLite still scans the bounded ledger for count/size, expiry,
and classification checks: this is not constant-time population qualification.
Malformed/nonboolean expiry flags and expired rows retaining record/page detail
are integrity failures. Detail-free expired entries retain their permanent count
and are validated fully on direct lookup. A cold expired commitment corruption
is consequently detected on lookup rather than eagerly on unrelated capture.
Neither that corruption nor a caller-forged token earns an issued-page response.

One validated resource map and outgoing-Link index replace per-Bead full-table
scans and repeated first-class Link decoding. The map is bounded by the existing
4,096-resource and 32 MiB encoded-record limits; decoded objects, inline owned
Links, and response construction require additional heap. Hot SQL statements are
cached lazily within the existing owner, because tables do not exist until first
provisioning. Retained page readback still independently validates returned data.

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
normal reads now use the same canonical-position context construction.

The existing finite capacity remains deliberate: at most eight live handles,
64 MiB live encoded record bodies, and 65,536 issued handles per store epoch.
Detail expiry does not restore the permanent issuance budget. Reaching that
budget refuses further captures; no forgetting, sliding budget, rate guarantee,
or unattended-service longevity claim is introduced. Current private issuance
capacity is not general-purpose deployment qualification.
