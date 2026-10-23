# CLI and retained profile discovery

The [canonical CLI](bdp-cli.md) uses one v0.1 binding and the positive
[Core](../../specs/profiles/core/retained-core.md)/[Write](../../specs/profiles/write/retained-write.md)
entries. This completes independent discovery/factoring source; required Event and
actual Types composition still block adoption. CLI command availability cannot be
inferred from a schema file, a path suffix or a parked exploration.

scope inspect preserves native discovery. Clients understand retainedDiscovery's
core and write arms even if they execute only Core commands. Write adds eight
individually atomic targets, not different read/result meanings. Discovery URLs are
absolute; aliases remain Scope-relative names within their advertised base. Both
profiles require events navigation, with actual Event semantics still gated. Core
needs no Type inventory. type list remains deferred until its owning Type contract
provides navigation/payload, without a guessed catalog path.

| Client intent | Service context | Behavior |
| --- | --- | --- |
| Core read | core or write | Same selected read contract; ignore unused operation navigation |
| Singleton write | write | Follow one of eight directory targets; complete inline result and same-key recovery |
| Atomic batch | write plus selected atomic-batch version1 | One atomic invocation/result; refuse absent/unsupported subset before new effects |
| Exact application read/versions | advertised complete History | Existing full contract and own cursor rules; absence refuses |
| Exact Type interpretation | selected type-definition-read version1 | Explicit interpreting Scope and complete wrapper/origin; no generic show fallback |
| Base use after new optional capability appears | either profile | Ignore unknown optional detail; preserve base values/keys/cursors/observations |
| Feature-aware invocation unsupported | either profile | Precise refusal, no stripping the request's meaning or mutation probing |
| Retained replay after support/configuration changes | original frozen binding/key | Known disposition comparison/recovery precedes new admission; never retry as fresh |

Future features use explicit URI/version capability selection, not a higher profile
literal or new required base fields under unchanged semantics. An old Core client
therefore need not implement Types/batch/synchronization to keep Core functionality.
A Write client keeps ordinary inline results even if the service adds more features.
Unknown annotations are ignorable only where declared; required semantics and native
closed fields remain rejectable. Feature presence grants neither authorization nor
a portable identity/Scope relocation guarantee. Drop/rebuild of history does not
reset successful keys or identity allocation while claiming the same logical Scope.

The new native helpers are coreDiscovery, writeDiscovery, retainedDiscovery,
writeOperationDirectory and their two closed limit groups. Earlier read/read-update/
transactional helpers are staging inputs, not the selected front door. Existing
runtime constants/parsers, catalog profile tags and prior PASS artifacts are not
rewritten to look like target support. Offline emission verifies implemented grammar/
Scope context without claiming remote support; execution verifies actual binding.

Experimental remains a non-normative parking boundary outside specs, not an optional
profile advertised by this CLI. Public receipts, set writes and replica bootstrap/
checkpoint/changefeed recovery gain no selected URI, command or implementation.
The finite [cutline](../design/bdp-v0.1-retained-cutline.md) records remaining gates.
