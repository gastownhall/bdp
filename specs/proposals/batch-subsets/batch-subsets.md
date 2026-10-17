# Atomic batch operation subsets — WIP proposal

October 17, 2026. Requested change [#152](https://github.com/gastownhall/bdp/issues/152).
Owner: Trish; Iris prepares this review draft. Donna has not released the landing
hold. Starting source: PR159 d7197e97a29bff8f075028419afad05388e2e655.

**Proposed specification material, not adopted wire or runtime behavior.** The
[current Core](../../profiles/core/core.md) and [Write](../../profiles/write/write.md)
remain authoritative. This draft changes neither their schema bundle nor runtime
parsers/capability advertisements. Approval of the product direction does not
settle the open wire/profile decisions below.

## Selected direction

BDP batch and proposed bd batch V2 use the same JSON operations envelope,
operation meanings, exact values, guards, provenance and name/@name identity
bindings. Go V2 supports six individual Resource operations: createBead,
updateBead, deleteBead, createLink, updateLink and deleteLink. updateWhere and
deleteWhere are deferred, not implementation prerequisites. Parameterized batches,
stored procedures, GET-result extraction and a new CLI text language are excluded.

An atomic subset must advertise exactly what it implements through an agreed
capability/profile amendment. It cannot claim the current complete Transactional
profile, and Read+Update cannot simply advertise batch. Batch always means one
Scope, ordered operations and all-or-nothing publication. No sequence fallback,
client-side approximation, skipping, prefix execution or hidden chunk commits.

For a new invocation, recognize the canonical vocabulary independently of endpoint
support. A syntactically valid recognized member that the endpoint omits must
produce a deterministic unsupported-operation refusal, proposed name
`operation-not-supported`, including operation name and original JSON pointer.
Report the first unsupported member in request order. Malformed/unknown records,
authorization refusals and transient execution outages remain distinct.

Preflight every member before durable admission; an unsupported new invocation
binds no receipt/key and publishes no Resource, revision or Event. Preserve the
existing syntax/authentication/disclosure constraints. Subject to those constraints,
retained identical retries and conflicting keys retain their prescribed precedence:
a changed support set cannot re-execute or reclassify an already retained invocation.
Scope, principal and idempotency key remain invocation context, not invented JSON
body/per-member fields. Local/server semantics and unsuccessful CLI diagnosis agree.

## Decisions explicitly held

| Question | Required owner disposition before normative/runtime promotion |
| --- | --- |
| Discovery/profile | Exact representation/versioning of supported members; relationship to required singleton/set targets and current Transactional inheritance |
| Refusal wire | Problem family/code/status/retry fields; diagnostic pointer/member names and bounded/disclosure-safe diagnostics |
| Admission | Precise retained replay/conflict/support-check order, including expired outcomes and authorization changes |
| Compatibility | Old CLI grammar entry/transition, pending receipt/result paging and exit behavior; no heuristic invalid-JSON fallback |
| Type-change propagation | Types §2 already selects whole Type-reference replacement validated atomically with resulting properties/constraints; omission preserves affiliation. Types §3.6 distinguishes targeted edits (untouched fields preserved) from explicit replacement (mandatory fields supplied). Frozen Core immutability and the Write/bundle updateBead wire have not propagated this direction. Reconcile singleton/batch wire together, without reopening product permission or blocking native Memory. This subset amendment alone does not implement it. |

These choices are not resolved by illustrative test-field spelling. Six-versus-eight
is closed for Go V2; implementing set mutation is not an alternative resolution.

## Review artifacts and acceptance

`support-cases.schema.json` describes **test scenarios**, not BDP requests,
capability discovery or a new Problem wire shape. `../../../fixtures/specs/batch-subsets/support-cases.json`
contains canonical batch request bodies plus conceptual expected classifications.
The offline checker uses the actual current bundle to distinguish well-formed
unsupported requests from malformed requests, then checks the first member pointer
in this finite support model. Retained replay/conflict and engine atomicity remain
runtime acceptance obligations; this checker does not execute transactions.

Run: `uv run --no-project --with 'jsonschema[format]' python scripts/check_batch_subset_examples.py`.
No remote schema retrieval is allowed. Before adoption, owning prose/schema,
discovery, parsers and conformance must move together. Installed embedded and
ordinary shared-server tests must place an unsupported member first/middle/last,
prove zero prefix effects, distinguish malformed/forbidden/transient refusals,
and exercise retained outcomes across capability changes. Native Go Memory does
not depend on a BDP runtime or completing this amendment.

[Review and check status](REVIEW.md) records the per-draft council disposition.

The checker preserves current Write's carrier-syntax-before-key/support baseline:
a schema-malformed body anywhere is classified malformed before this support
model runs. Unknown operation names are malformed under the closed vocabulary;
recognized, well-shaped but omitted members are unsupported. This is a current
carrier/shape comparison, not validation of complete Selector grammar, principal
checks or the new amendment's final admission sequence. The combined
unsupported-then-malformed vector illustrates that baseline; final new-control
placement remains in the held admission decision. Current Problem envelopes
already have a pointer diagnostic; extending the closed code inventory and
settling its family/status/disclosure rules still require owner reconciliation.
