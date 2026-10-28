# October27 bounded alignment review

This records review of the new common-source amendment `b8f7963`, combined source
`f924371`, and Trish's root-status successor `a41128d`. It is not an implementation
qualification, a whole-branch re-review or a new approval layer. Previous reviews
retain their original source identity. The [current source map](bdp-v0.1-current-source-map.md)
records the selected/proposed boundary and paired artifacts.

## Findings and disposition

| Reviewer | Finding | Disposition |
| --- | --- | --- |
| Native Codex, Spec/Standards | Projection inventory endpoint filters incorrectly narrowed existing input domains | Fixed: raw structural filters retain local Bead IDs and absolute URIs, with existing semantic validation/normalization. Static controls cover local paths, URNs and unchanged HTTP-only Type operands |
| Native Codex | Endpoint fixture coverage prose overstated target-pin/unowned-no-op cases | Fixed: prose now names the actual target identity/source-pin correction and unowned source movement cases |
| Melinda, Read owner | Existing continuation prose allowed changing what are now native projection masks | Fixed: native masks stay frozen in issued continuation; local rendering cannot recover omitted fields or replace native applied-mask metadata |
| Melinda, Read owner | Authored exact-history denial exposed forbidden rather than inherited nondisclosing404 | Fixed: fixture/test use resource-not-found/status404, with no full/current substitution |
| Trish, Types/source owner | Stale Types endpoint summaries and current root incorporation status | Reviewed Types/source-status counterpart incorporated normally; historical register rows explicitly retain their historical scope |
| Combined-tree artifact check | Types exact-read cases pinned the previous whole common-schema digest | Current three-file correspondence/provenance refreshed to the known assembled schema; all30 transitively used definitions compare JSON-value-identical with the prior input. Historical qualification source/checker remain unchanged; fresh combined-tree checker required |

Native review confirmed its findings closed at `f924371` and found no remaining
Spec/Standards findings within that bounded scope. Melinda confirmed the two Read
corrections at the same frozen source; that ACK does not claim provider execution
or full Write/Types review. Trish owns the Types seam and final integration route.

## External council coverage

Claude was invoked read-only against the bounded amendment packet. It produced no
review output within the ten-minute observation bound and was stopped. This is
**incomplete**, not a no-findings review.

Gemini via Antigravity could not read the file in headless mode. A stdin attempt
reported that the CLI had not forwarded the supplied content. The corrected direct
inline packet timed out after five minutes without findings. Its exit status was0,
but its explicit timeout output establishes **incomplete** coverage. No permission
bypass, alternative account/model or fabricated review was used.

The packet SHA256 is `94726cc04cd6d3ab23ea5b45017536269fad53033e6947a8e87845e2e848ceca`.
It predates the documented review fixes; reviewers were instructed to consider
those corrections. External coverage remains a residual integration risk to report,
not an inherited green or a semantic veto from an unavailable reviewer.

## Executed checks and limits

The common amendment passed31 protocol test files /1,109 tests, including strict
offline candidate compilation, schema mirror equality, held-v0 preservation and
static endpoint/projection cases. Format, lint, dependency boundaries and typecheck
passed locally under the pre-refresh Node24.16 toolchain. Later changes are the
reviewed root Markdown counterpart and current Types provenance/digest refresh.
Actual refreshed combined-head CI uses the preserved Node24.22.1 security update
and must pass independently before ordinary integration.

These checks establish artifact shape/correspondence only. They do not execute a
provider's authorization, historical acquisition, mask evaluator, rollback,
transaction serializability or CLI compiler. No runtime/consumer/release pin or
past validation receipt is upgraded by this source landing.
