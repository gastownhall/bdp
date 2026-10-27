# Review disposition

An actual read-only Claude Code review returned the [preserved findings](claude-initial.md).
It reports examining the live authoring files and manually deriving 64 case
expectations. It executed no evaluator or provider. Later additions and fixes are
covered by the refreshed schema/static receipt; they are not automatically claimed
as externally re-reviewed. Exact transport/policy omissions stay visible as such.

Donna's selected behavior outranks reviewer recommendations. The following table
accounts for all numbered findings; the normative candidate and machine artifacts
carry the actual changes.

| Finding | Disposition |
| --- | --- |
| 1. Projected records fail held full-record schemas | Added explicit projected record/item arms as an adoption dependency; preserve required fields on stored/full records. Do not add properties/metadata to protected projection context. |
| 2. Historical input/graph ambiguity | Pinned reads require actual exact History and closure authorization. The first walk subset proposes current roots only, with known pinned roots refused and computed noncurrent roots checked before expansion. Historical graph incidence remains an explicit future seam. |
| 3. Missing/hidden/kind-mismatched `refs` | Every input resolves under its assertion or the request refuses uniformly; no dropped-root success. Added runtime/authority obligations and distinct context overrides. |
| 4. Hidden endpoint treated as absence | Rejected that recommended semantic change. Preserve Donna's required-acquisition failure rule. Use uniform unknown/not-found for missing and hidden targets, without an existence-disclosing message. |
| 5. Complete-item/native-query restrictions | Named Core collection, read-delivery, always-metadata, owned-state, exact-query and schema clauses requiring explicit amendments. Held artifacts unchanged. |
| 6. Authorization-relative counts/closure | Explicitly bind scans, count and quantifier completeness to the Authorization View. A visible Link's required unreadable endpoint remains a failure, not an absent field. |
| 7. Undefined graph masks admitted | Static admission now refuses graph projection until mixed-component targets are defined. |
| 8. List exceeds retained Selector | State that structured List is a new carrier/profile; it does not sneak contains, membership, or structured literals into the retained bounded Selector. |
| 9. Membership asymmetry | Admit literal-in-local-array and local-scalar-in-literal-array. Keep field-to-field membership outside List. Added both directions and refusal. |
| 10. Pinned Type affiliation | Exact matches nominal URI ignoring definition pin; raw paths retain union. Added pinned exact/family/raw cases. |
| 11. Shorter-route expansion | Added R→Y→X plus R→X and X→Z fixture, depth-two expected set, and execution obligation. |
| 12. Opaque endpoints | Preserve strict required-content semantics. One-hop Link-only enumeration can retain a raw Reference; deeper required expansion, explicit navigation, and graph formation refuse unavailable content. No successful stub/partial graph is silently added. |
| 13. Pointer/root/empty masks | Tightened RFC 6901 syntax; root include means full, root omit refuses, explicit empty mask arrays refuse. Protected and whole-plane checks are explicit. |
| 14. Expected sets/outcomes | Declared unordered-set expectations, sorted for readability, six explicit shape variants and three outcome classes. Delivery ordering is not asserted by these cases. |
| 15. Sorting | Preserve Donna's selected one-pointer sort target. Explicitly identify the native authority-order conflict and missing carrier/discovery amendment; do not imply current native support. |
| 16. Schema edge coverage | Added distinctive pattern, required-binder, empty-group/path, duplicate-root, unknown-member and pointer refusals; assert expected schema diagnosis. |
| 17. URI format silently skipped | Use pinned jsonschema format-nongpl extra and assert the URI checker exists. Added relative Reference/Type refusals. |
| 18. Owned/incident planes | Whole-plane-only ownedLinks/links masks and declared omission are explicit; full-record/ownership-state rules remain unchanged until projected representation amendments. |
| 19. Count flag | Preserve the accepted `--count-only` spelling; distinguish it from unsettled expression/file grammar. Added count/link-count compatibility correspondence. |
| 20. Graph Type flags | Explicit family meaning and exact variant in overview. They describe the candidate, not an installed parser. |
| 21. Dead walk binding | Require bind and through together in the proposed AST; added refusal. |
| 22. Static versus runtime refusal | Runtime failures have runtimeError/outcome distinct from schema/static admission errors. Static passes do not execute them. |
| 23. Unbound main example | Main JSON example now uses constraints fixture A and a matching authored case. |
| 24. Reference union test arm | Added pinned-object and floating-string cases on the actual pin fixture. |
| 25. Residual text | Duplicate declarations tied to surface grammar; set/path constructors explicitly deferred; id/rev values are ordinary strings without hidden scalar-domain coercion. |

## Remaining boundaries

The current-root restriction and strict external graph behavior are clearly
identified first-slice proposals. They do not change existing product behavior or
forbid later capabilities. Native request/discovery, graph framing/masks,
per-request sort, partial delivery and provider qualification are still adoption
work, not missing success claims.

The initial result model also does not yet combine witness graphs from multiple
staged walks. A Memory `constraints` explanation that includes Subject To roots
and their Requires-derived graph needs that result-composition contract or an
explicit domain facade. Do not claim that this first AST already replaces every
Memory wrapper. It covers the reviewed initial List/Graph/correlated query subset.

All authored expected sets remain obligations for a future evaluator harness.
The validator executes schema and static admission checks only.
