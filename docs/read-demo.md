# A three-minute BDP Read demo

BDP gives tools a common way to read records and follow their relationships.
This demonstration asks a practical question: **which tasks can we work on now?**
The same client can answer it against two different server implementations.

The little A/B/C tasks are deliberate test data. B depends on A. A depends on C.
C is finished, but A is still open. That makes A ready and B waiting.

## Run it

Use the repository's pinned Node **24.16.0** and pnpm **11.20.0**. From its root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node scripts/demo-read.mjs /tmp/bdp-demo-reference-1
```

The output directory must not exist; its parent must exist. The script creates
it and refuses to overwrite an earlier attempt. It uses loopback port 19280;
set `BDP_DEMO_PORT` if that port is occupied. Each run stops its listener and
owned child processes before returning. Each command has a 30-second deadline;
the walkthrough has a 120-second abort deadline.

For the second implementation, pass the recorded Homebrew `bd` 1.0.5 executable:

```sh
node scripts/demo-read.mjs /tmp/bdp-demo-real-bd-1 /opt/homebrew/bin/bd
```

This mode checks the executable's SHA-256 against the recorded baseline before
executing it. It deliberately refuses other builds rather than silently changing
the comparison. The real-bd setup takes around 15 seconds. It creates fresh
isolated test data under `/tmp`, with its own HOME and Git configuration, then
copies that state into the output directory and removes the temporary root.
It does not use an existing Beads workspace. A fresh output directory is needed
for every run. The existing matrix's seed commands and creation-time spacing are
retained; native setup commands are recorded alongside the Read demonstration.

## What to say while it runs

1. **“The client first discovers what this server supports.”** It contacts the
   HTTP scope, follows its service-description link, and learns that this server
   supports BDP Read.
2. **“The relationships are data we can follow.”** It reads B, asks for its
   outgoing Links, and follows the actual dependency Link to A. A is still open,
   explaining why B must wait.
3. **“We can follow another step.”** From A, it follows the next dependency to C.
   C is closed, so A's dependency is satisfied.
4. **“Now a separate command uses that protocol to answer our question.”** The
   actual `bdp bd ready --json` process reads the server over HTTP and returns
   J, D, A. B is absent. The output is checked against the fixture oracle, or,
   for the real-bd server, against an independent direct `bd ready` invocation.
5. **“We changed the server implementation without changing the client.”**
   Repeat using the real-bd command. The IDs and data come from a real isolated
   bd database; the same packaged BDP client still computes readiness.

The server records the CLI's actual HTTP requests. In this fixture it makes 12
GETs: scope discovery, its description, the beads collection, and each bead's
outgoing Links. There is no special HTTP `ready` endpoint returning a canned
answer. The task labels J and D are additional ready examples in the shared
fixture; this walkthrough explains the smaller B → A → C chain.

## Evidence and boundaries

`transcript.txt` is the human-readable walkthrough. `result.json` records parsed
BDP responses, request paths/statuses observed by the HTTP listener, exact CLI
stdout/stderr, native setup commands, oracle comparisons, and cleanup errors.
It is demo evidence, not a new conformance certification or wire-byte capture.
`isolated-state/` retains the test workspace and its isolated configuration.

The reference mode uses the shipping reference-server composition and its
normal Read admission check. The real-bd mode composes the shipping HTTP server
and process adapter, with the same Read admission and an explicit isolated child
environment. It does not substitute a fake bd executable or a canned transport.
The separate CLI is the actual built `apps/bdp` executable in both modes.

**This demonstrates BDP Read and dependency-Link traversal today.** It does not
show BDP writes, transactions, retained History, new graph Memory records, or the
new managed engine. Fixture data is seeded through native bd commands. Ordinary
Read here does not specifically exercise PR54's dynamic schema-reference work.
Those are separate integration milestones; do not describe this as the full
memory/history demo.
