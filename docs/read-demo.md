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

For the second implementation on the original capture host, pass its recorded
Homebrew `bd` 1.0.5 executable:

```sh
node scripts/demo-read.mjs /tmp/bdp-demo-real-bd-1 /opt/homebrew/bin/bd
```

This is intentionally a **capture-host-artifact-only** mode, tested on Donna's
Mac; it is not the repository's portable bd version-admission policy. Other
Homebrew bottles and CI source builds are refused even when they report 1.0.5.
This mode checks the executable's SHA-256 against the recorded baseline before
executing it. It deliberately refuses other builds rather than silently changing
the comparison. The real-bd run takes about 30 seconds end to end. It creates fresh
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
5. **“The server enforces the limits it advertises.”** An actual over-limit
   HTTP request receives `413 limit-exceeded`.
6. **“We changed the server implementation without changing the client.”**
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
In real-bd mode, `isolated-state/` retains the test database and its isolated
configuration. Reference mode retains an empty workspace and isolated config.

The reference mode uses the shipping reference-server composition and its
normal Read admission check. The real-bd mode composes the shipping HTTP server
and process adapter, with the same Read admission, advertised limits and public
Read controls as `bdpbd`, plus an explicit isolated child environment. This is
an in-process composition; the `bdpbd` CLI itself is not launched. It does not substitute a fake bd executable or a canned transport.
The separate CLI is the actual built `apps/bdp` executable in both modes.

**This demonstrates BDP Read and dependency-Link traversal today.** It does not
show BDP writes, transactions, retained History, new graph Memory records, or the
new managed engine. Fixture data is seeded through native bd commands. Ordinary
Read here does not specifically exercise PR54's dynamic schema-reference work.
Those are separate integration milestones; do not describe this as the full
memory/history demo.

To exercise the capture-host real-bd regression test explicitly:

```sh
BDP_DEMO_BD_EXECUTABLE=/opt/homebrew/bin/bd pnpm exec vitest run scripts/demo-read.test.mjs
```

The test checks the recorded seed command sequence, real readiness parity and
advertised limits. Tests skip when the packaged client has not been built.
The `/tmp` isolation root is deliberate: it avoids ancestor `.beads` discovery
under user home directories; this walkthrough is qualified on the capture Mac.

The demo retains a copied seed recipe for transparent command capture; the
opt-in test compares its commands to fixture-derived expectations, not directly
to the matrix seeder implementation. Shared seeder extraction is deferred. The
test supervisor waits longer than the script's 120-second abort deadline so
the script can record failures and clean up its owned state.


## Optional History client boundary

`BdpClient.performHistory` can explicitly enumerate retained versions or fetch one exact old Bead/Link body from a **Read-profile target that advertises `historicalResolution: { version: 1 }`**. The current demo servers do not advertise or serve this capability. The client tests use controlled History responses; they do not qualify a Beads History provider or the native memory proposal.

```ts
const traversal = client.createContinuationScope();
const first = await client.performHistory(
  { kind: "versions", resource: "bead", id: beadId, limit: 2 },
  { continuationScope: traversal },
);
if (!isBdpClientProblem(first) && first.next !== null) {
  const next = await client.performHistory(
    { kind: "versions", resource: "bead", id: beadId, continuation: first.next },
    { continuationScope: traversal },
  );
  // Display returned order and metadata; page order does not establish ancestry.
}
const old = await client.performHistory({
  kind: "revision", resource: "bead", id: beadId, revision: selectedRevision,
});
```

Each call performs only the requested read. Listing a revision does not promise permission, availability or a retained complete body later. Exact reads preserve carried context and pins, or return the authority's validated Problem; they never fall back to the current record. Revisions are opaque strings, including reserved characters; lossy URL encoding is refused. This API uses the existing Read discovery parser, so ReadUpdate/Transactional targets require their own future wrapper support.

Use distinct continuation scopes for independent traversals. If two History traversals under the same owner (including the default owner) receive the same continuation URL, the second publication fails with a local request error while the first remains usable. An abandoned default-owner cursor cannot be forgotten and may block restarting the same enumeration until `close()`; use an explicit scope whenever a traversal may be abandoned. Explicit scopes permit `forgetContinuations(traversal)`; that forgets available cursors while preserving in-flight leases. Terminal pages release their traversal state, and `close()` clears all state. The shared local bounds remain 1,024 continuation contexts and 10,000 cursor-history entries; reaching them is a local capacity error, not cursor expiry or retention loss. Restarting an enumeration is not guaranteed to bypass these bounds. No bodies, window bounds or cross-page revision set are cached.

An explicit initial limit is forwarded and preserved in issued continuations. An omitted limit stays omitted; the client does not infer defaults or fabricate a limit-exceeded response from advertised maxima. A server-added limit on an issued continuation bounds that requested page, without becoming a new equality constraint on later continuation URLs. Schema-valid terminal participation values are also returned as received; the client does not infer cross-page fence state. Window values are returned as received, without claiming client verification of a stable server snapshot or hidden erasure facts. Ordinary RFC 9457 extensions survive validated Problems, subject to the protocol's known erased-pointer restrictions.

This is a **body-only API**. Cache-Control, ETag, BDP-History-Lineage, navigation Link headers and HEAD are outside this transport slice. Pagination plus selected-revision retrieval is not direct predecessor/successor navigation. No History server capability or History catalog conformance pass is added by these SDK tests.
