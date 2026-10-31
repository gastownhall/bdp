# Shared contract binding: paired source and bounded fanout

Candidate under existing [#280](https://github.com/gastownhall/bdp/issues/280) and sole plan [#59](https://github.com/gastownhall/bdp/issues/59). This branch builds on reviewed namespace PR286 at `453a37ac8031c77e76dc1a6ef16d3d05850de82a`; it does not merge or change that draft's disposition. The [CLI source](../cli-design/contract-binding.md) and [protocol binding](../../specs/profiles/core/contract-binding.md) agree on explicit values. No final profile/Type/Event adoption or runtime upgrade follows.

## Contract and artifact boundary

Discovery `"0.1"`, `application/vnd.bdp.v0.1+json` and specification/schema URI `https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json` are one candidate binding. CLI `bdp_spec` uses that URI; CLI framing remains independently schema 2. Generic JSON or a media parameter cannot select the new semantics. Unsupported selection refuses before effects; retries and opaque continuation context cannot silently change contracts.

The new canonical/distribution artifacts are separately named. Among the 159 inherited definitions, exactly four change: `bdpVersion`, and the optional `capabilities` property on `readDiscovery`, `readUpdateDiscovery`, `transactionalDiscovery`. Two map helper definitions are added, for 161 total. Capability identity maps to exact version strings, each owning a detail object; multiple versions coexist. This permits an older base client to ignore an unknown optional entry without changing base guarantees. It is not an executable extension/template framework.

The preceding 159→161 statistics are the original PR287 binding-slice snapshot.
The subsequent [#279 source](bdp-v0.1-affiliation-port.md) adds two affiliation
helpers and amends ten carrier definitions in the same new slot, for a composed
candidate of 163 definitions. The four binding changes/two capability helpers are
not a timeless complete diff of that later artifact.

All other inherited definitions, including pending profile and advanced grammar, are staged inputs unchanged by this original binding slice. Their presence is explicitly not a retained-surface decision. Profile factoring, #279 carrier/nominal ownership projection, Trish's Types and required Events must compose before any service advertises v0.1. Event transport cannot infer its contract from unversioned SSE; #153 composition remains explicit. There is no new descriptor service or legacy endpoint obligation.

The old v0 schema bytes, runtime version constant/parsers, existing fixtures, loader guards, catalog IDs and previous evidence identities remain unchanged. The package adds a JSON artifact export, not runtime support for 0.1. PR284 is preserved as the selected carrier input; its changes should port to the new target artifact rather than silently advancing the held v0 slot. The private complete C1 and its Event questions remain distinct from this paired subset.

## Pre-edit inventory and classification

The bounded construct scan covered 166 files: six source/scoped-paper files, two schema slots,130 held runtime/test/fixture files, three active citation catalogs and 25 other evidence/helper/follow-up files. Search families were discovery/version, schema identity, media admission and CLI identity. It found 1763 media occurrences; a global replacement would change held behavior and historical expectations.

| Family | Disposition in this slice |
| --- | --- |
| Paired binding/CLI source, staged schema identity and capability discovery | Add explicit candidate source/artifacts now |
| Old v0 schema slots and existing runtime/code/fixtures | Preserve exact actual contract; no blanket retarget |
| Core/Write source | Add explicit staging notices and links; inherited wire examples remain labeled inherited, not relabeled qualified 0.1 |
| Active catalog/current-source quotation guards | Preserve; validate against current source instead of bypassing them |
| Existing front door/register | Trish/Molly own updates; supply exact pointer/status delta, do not create a competing index |
| Profile/Type/Event grammar and matching examples | Follow through in their coherent paired source chunks before adoption |

No old report is edited into a new contract PASS. No runtime or catalog selector is taught to impersonate 0.1. Two versioned schema artifacts preserve source isolation; they do not require hosting two services or resuming a legacy compatibility fleet.

## Validation plan and stop loss

Use strict Ajv with URI formats for both identities, all 161 new named definitions, old/new version refusal, optional capability/version maps and unresolved-reference detection. Compare the new artifact structurally against the old: only the declared four definition changes/two additions plus identity/title/description metadata are permitted. Confirm mirror/export identity and unchanged old slot bytes.

Run the focused new artifact-binding tests plus the four existing catalog/citation/selection test files used for PR286. Preserve the loader/whitelist/current-source reader and assertions. Check JSON/fences/local links and unchanged runtime/Types/PR284 scope. The twelve [semantic cases](../../fixtures/contract-binding/candidate.json) remain paper expectations; these checks do not execute a new HTTP/CLI provider contract.

If this source/artifact boundary requires mass-changing the 130 held implementation/test/fixture files, stop and reslice rather than attrition-fix the fleet. No broad migration/build/reviewer/runner framework is authorized by this packet. D1/D2 remain with Donna; no answer is inferred. Front-door index publication, retained profile composition and actual runtime acceptance are later gates.

## Integration handoff

Author checks completed: 133 tests pass across the new seven-test artifact-binding file and the four existing PR286 catalog/citation/selection files, zero failures or skipped tests (Vitest4.1.10, Node24.19.0 final run; initial Node26 log retained). All 161 candidate definitions compile with strict Ajv8.17.1 and URI formats; exact semantic comparison confirms only the four declared definition changes/two additions. The old slot remains SHA256 `15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327`; the formatted new canonical/mirror hash is `6a38c35dfabb78e86c0b35971de74d4bbfcab0a6d48bfe332ffef7251d02cad1`. The final complete test slice ran after schema formatting and the reference-only graph check refinement; semantic/mirror checks also passed. Six active catalogs/569 quotations still resolve, with no catalog/source-reader/loader change. Thirty-two JSON fences and 57 local links resolve, Biome checks five changed code/JSON files, and whitespace checks pass. Task-created temporary dependency links/cache are removed. These are author source/artifact tests, not HTTP/CLI/provider or installed qualification; twelve semantic scenarios remain unexecuted.

The intended parent pointer update is additive: expose the staged v0.1 binding and canonical/distribution artifacts as candidate source while retaining an explicit v0 runtime/evidence link. Do not label the new artifact independently adopted or change a product pin. New shared affiliation/schema ports use the v0.1 slot, composed with Trish's Types; original PR284 remains the bounded source/evidence input.
