# Packed smoke routes

Run these through the pinned pnpm package scripts after `pnpm build`. The scripts
need the package-manager entry supplied by pnpm; invoking a Node test through
`pnpm exec node` alone does not supply that packing context.

| Command | Actual observations |
| --- | --- |
| `pnpm smoke` | Existing full default: shared package custody, all three installed executables, startup/configuration/lifecycle and historical admission, canonical service/SDK, private installed process and role isolation. |
| `pnpm smoke:current` | Shared package custody, canonical installed service/SDK and all nine real CLI cases against the installed executable and installed reference module. |
| `pnpm smoke:legacy` | Shared package custody plus all existing historical executable/configuration/admission/private-process observations; the canonical service/SDK observation belongs to the current route. |

The two explicit routes together preserve the full default's observations and
add installed CLI evidence. The default has not been shortened or replaced in
CI. Suite classification, coverage and cold timing still need review before CI
cutover. No Go installation or `bd` execution is performed by these smoke routes;
the discovery-only legacy adapter probe is separate from wider legacy tests that
really invoke `bd`.

## Shared package custody

`packed-workspace.mjs` owns one build-output inspection and actual tarball
installation per invocation. Every route keeps the existing closed server-module
checks, required output, explicit public exports, prohibited deep imports,
structural parser controls and absence of test artifacts/support payloads. The
observations consume that exact installation before its owned directory is
removed. A result from another build or installation is not reused.

Both normal and failed observations remove the installation. Pack/npm children
and the installed CLI driver use the existing process-group supervisor. Parent
SIGINT/SIGTERM abort the owned work, await group termination and remove the
installation; interrupted commands remain unsuccessful with exit 130/143.
Cleanup failures stay failures, including both the original and cleanup causes.
The actual cleanup tests cover success, observation failure, and parent-only
SIGINT/SIGTERM while a real packed CLI driver is live, checking group disappearance
and installation removal. The packed driver confines its case fixtures to the owned root; interruption controls stop an observed real CLI child before signaling the parent, so they cover an active case rather than only driver startup. These process-group controls run on POSIX hosts.

## Actual CLI evidence

The emitted test entry and packed entry register the same authored scenarios from
`canonical-cli-cases.mjs`. The emitted entry supplies workspace-built artifacts.
The packed driver takes an explicit owned installation argument, resolves
`@bdp/server/reference` from that installation and executes its installed `bdp`
binary. There is no ambient source override or fallback to workspace service code.

The nine cases retain their HTTP proxy, exact request and output assertions,
CRUD/pages/retries, backpressure/cancellation and terminal same-ID undelete.
Sharing case code does not share an execution: emitted and packed runs start
separate processes and stores and keep separate evidence. The packed SDK/service
observation also remains; an SDK call is not substituted for CLI argv/IO behavior.

This is reference and packaging evidence. Private timing controls and whole-Scope
principals do not establish arbitrary-provider conformance, deployed TLS, Types,
History/Events composition, pruning or administrative-erasure qualification.

## Focused commands

```sh
pnpm build
pnpm test:current:shadow -- scripts/packed-workspace.node-test.mjs
pnpm test:cli:built
pnpm smoke
pnpm smoke:current
pnpm smoke:legacy
```

The current shadow route accounts for the actual cleanup test entry in its
manifest. The helper and explicit packed driver are shared implementation of
these entry points, not additional silently discovered test suites. The legacy
and full test setup and qualification evidence remain unchanged.
