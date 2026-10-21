# RU normal-reopen association correction

The ordinary prepare hook records exactly one initial ready per scenario in `sessions`.
A normal close/reopen records its complete actual ready object as a separate
`normal-reopen-ready` observation. The existing `normal-close-and-reopen` observation
also remains unchanged. No scenario, runtime, request, deadline or cleanup rule changes.

The 9549115 attempt2 ran all 104 selected scenarios successfully, but the final artifact
association rejected the continuation shard's 55 sessions for 53 scenarios. The two
additional sessions are actual normal reopens of `read.collections.cursor-errors` and
`read.bead-links.pagination`; neither is another scenario execution. Original files,
failed artifact summary and completion error remain immutable.

A fixture-free DATA test exercises the real collection function. A separately gated
DATA test consumes exact hash-pinned baseline/continuation captures, validates all 104
original PASS results, configuration/artifact/source/ready/cleanup joins and both reopen
records, then emits a new derived reconciliation. Its environment is
`BDP_RU_ASSOCIATION_CAPTURE_DIRECTORY` and create-only
`BDP_RU_ASSOCIATION_DERIVED_OUTPUT`. It launches no installed process and changes no
original capture. Decoded JSON cannot recover the live configuration factory's private
WeakMap identity: the test explicitly verifies that refusal and does not create or
pretend to have a new factory-bound campaign association. This is DATA reconciliation,
not a newly executed runtime result or whole-profile award. It infers no native PID,
store absence or lifecycle facts omitted from the original collector.
