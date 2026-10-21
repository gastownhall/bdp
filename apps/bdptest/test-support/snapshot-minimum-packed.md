# Packed retained Snapshot minimum observations

Build, pack the workspace packages, and install those tarballs offline into an
isolated directory. Select the installed server's absolute
`dist/transaction-installed-process.js` with `BDP_SNAPSHOT_PACKED_ENTRY`, and set
`BDP_SNAPSHOT_PACKED_SOURCE` to the exact runtime source commit. Optionally select
an existing private evidence directory with `BDP_SNAPSHOT_PACKED_EVIDENCE`.
Run only `transactional-snapshot-minimum-packed.test.ts`. Without an entry
selection, its two opt-in cases are explicitly skipped.

The first case uses the existing installed process and actual public HTTP. It
compares all emitted server JS modules with the installed copies and verifies the
packaged protocol schema matches the canonical schema. A saved position-2
manifest and issued continuation retain their exact bodies and original expiry
after the store advances to position 3. GET and HEAD accept minimum 2 and refuse
minimum 3 with the direct Transactional 409. Response context remains the
current same-entry serving observation; it does not rewrite the saved body.

The expiry case is a **private trusted-clock target**, not ordinary deployment
qualification. Its typed child imports the same installed configuration capture
and runtime modules, passing only the existing clock seam. IPC advances that
clock once beyond the actual full five-minute expiry. It does not patch the
global clock, shorten TTL, alter store/service/HTTP code, or add a BDP operation.
Both retained URIs return 410 before a higher minimum and conditional headers.

Each case captures actual HTTP wire bytes, configuration, installed bindings,
child stdout/stderr, terminal status, EOF and reap evidence. Synthetic credentials
in the optional evidence require private 0600 storage. Deadlines and channel
bounds follow the existing installed Snapshot cohort. These focused observations
leave unknown/foreign-context precedence and whole-profile conformance unsettled.
