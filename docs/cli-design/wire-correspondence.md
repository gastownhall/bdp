# Canonical commands and BDP correspondence

This is the command-first review map for the selected Core/Write CLI. The
[generated command map](../../specs/openapi/commands.md) groups the exhaustive
HTTP signatures beneath their public commands. A separately named GET/HEAD
signature, revision form or projection case is not another CLI command or a
requirement to generate another public SDK method. Protocol semantics and the
feature-owned sources govern the actual requests.

## Ordinary correspondence

Create/update/delete lower to their corresponding mutation operation for the
selected kind. Show, List, Versions and Events retain their own operation
meanings; options choose the Resource, view, representation or selection. Bead
and Link commands share mechanisms while preserving actual kind checks. HTTP
HEAD is a transport form of a selected read, not an additional domain operation.

`--id-root ROOT` sends `idRoot: ROOT` under independently selected
[id-root1](../../specs/profiles/write/id-root.md), on the existing create URL.
The service allocates `ROOT/OPAQUE_SEGMENT` and commits its lifetime reservation
with the original result. The client does not scan, reserve or retry guessed IDs.
The same root field is available in the feature's explicit atomic-batch1
composition; unextended batch1 remains closed and unchanged.

An unpinned authored Type URI is resolved by the service during Types admission.
An exact authored Type pin stays exact. Creation requires no client definition
lookup or client choice of a registered default. Same-key recovery retains the
original allocated identity, selected Type and outcome even after defaults change.
Core-only Type carriers do not imply Types interpretation.

## Explicit exceptions to one request per invocation

| CLI behavior | Actual mapping | Boundary |
| --- | --- | --- |
| Establish a Scope | Discover its description and, for writes, operation directory | Shared connection setup; no path guessing or cross-authority credentials |
| Read a collection or Versions | Follow issued pages as requested | One selected population; paging does not create new operations |
| `events --follow` | Read pages, then poll the same native event source | Preserve complete delivered progress; no invented wire stream |
| Recover an uncertain write | Repeat the original frozen request/key | One logical decision; no new key, default resolution or allocation |
| Show through an alias | Resolve its admitted redirect, then retrieve the canonical Resource | Alias resolution and Resource retrieval are distinguishable |
| Local `REF@N` or numeric guard | An authoritative store adapter maps N to an exact token | Never count versions rows or infer an ordinal from page order |
| Historical content copying | Read a saved source then submit an admitted update | Source revision and destination guard remain separate; not one atomic read/write promise |
| Revision-sensitive Link applicability | Resolve identity and any current-token test within a supported coherent read context | Independent HTTP reads cannot manufacture that consistency |
| Delete without apply intent | Read an observational preview | No deletion, reservation or promise of future admission |
| Dry-run/member emission | Compile an unexecuted request; request preview may discover/resolve | No effect, identity reservation or successful admission claim |

Local numeric ordinals are a host/store affordance, not durable wire References.
The wire keeps URI strings and exact `{uri, revision}` References; tokens remain
opaque strings, including numeric-looking ones. A literal URI containing `@2`
is still a literal URI. No suffix parser or ordinal Reference arm is added to
BDP. A generic client without the authoritative mapping refuses local ordinals
and can use an explicitly supplied exact token instead.

## Visible correspondence gaps

| Surface | Current boundary |
| --- | --- |
| Exact Type-definition lookup | Selected wire interpreter operation; public Type CLI deferred. Ordinary show cannot silently substitute for it. |
| Rich selection/set batch | CLI direction and local implementation exceed retained CRUD batch1. The separate proposed encoder2 is not selected wire support; id-root1 does not activate it. |
| Count/query/graph | Feature-owned reconciliation remains separate. Retained inventory GET has no count result; page length is not an exact total. |

These are completion items, not permissions to invent endpoints or weaken
guarantees in a generic client. New capabilities must preserve old base requests,
issued values, exact pins, cursors and retained-key outcomes. The wire coverage
matrix remains useful for validation after the public mapping is clear.
