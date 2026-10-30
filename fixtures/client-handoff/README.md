# CRUD and batch client acceptance handoff

[cases.json](cases.json) supplies literal inputs and expected requests/results for
Claudia's next generic client slice. The [paired source note](../../docs/cli-design/client-crud-batch-handoff.md)
pins the accepted contract, interpretation and outstanding implementation work.
These are authored acceptance oracles, not output captured from a CLI, client or
provider. The illustrative typed-intent vocabulary does not declare an exported API.

There are 57 cases: 28 request-lowering cases, 11 delivery/result cases and 18
atomic-batch cases. `argv` is an already tokenized argument vector without the
executable; an empty vector selects the direct typed-intent API test seam.
`scopeContext` supplies explicit fixture state and frozen inputs, never live
configuration discovery. `discovery` is synthetic contract/navigation data, not a
claim that the current reference service advertises complete Write. `wire.jsonBody`
is the raw expected JSON value, without CLI framing. Preserve numeric input before
an implementation's parser can round it; invalid raw JSON remains in `argv`.

`assertionStage` distinguishes preparation from execution/retry expectations.
`expectedResultOrProblem.kind` is a test tag, not a wire member. A `not-asserted`
value means that case checks preparation only. `mustNotDispatch` forbids effectful
mutation dispatch; a delete-preview case explicitly permits its listed GET.
Emission, local refusal and uncertain transport are never mutation success.

The frozen private reference has six CRUD operations authored but unrun; it has
no batch implementation or advertisement. Every batch case is explicitly
`NOT_SUPPORTED_BY_FROZEN_REFERENCE`. Test a client's preparation with a stubbed
capability response now; gate actual provider execution until that provider
implements and advertises the capability. Never turn these cases into singleton
loops or claim a skipped provider case passed. Owner-context cases require their
explicit ownership fixture; they do not install or infer a Type system.

[Artifact checks](../../packages/protocol/src/client-handoff-artifact.test.ts)
validate the literal request/result/Problem carriers against the unchanged full
schema, exact route/header/body correspondence within each authored case, and
malformed batch-carrier rejection. They do **not** execute CLI lowering, discovery,
transport, retry, transaction rollback, publication or provider conformance.
Consumer tests must independently compute actual values and compare them with
these oracles; importing an expected body and echoing it proves no implementation.

Every `--file` case supplies its own exact bytes in `scopeContext.files`; case
filenames are isolated, not a global lookup into expected results. Synthetic valid
Write directories contain all eight required entries, including aliases, even
though this handoff exercises six mutations. A separate incomplete-directory case
must refuse. Current missing reference aliases remain an integration gap, not
permission to advertise an incomplete selected Write contract. Full returned
Resource records contain metadata; optional provenance is not synthesized.
