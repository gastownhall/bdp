# Review the specification with an installed CLI

Use this disposable local workstation while reading Core, Write and the CLI
mapping. It installs the actual workspace tarballs and starts a fresh, privileged
reference Scope on loopback only. It does not use Beads, a global executable, an
existing store or historical admission grants. It is a review aid, not full
provider conformance. [Delivery #320](https://github.com/gastownhall/bdp/issues/320)
and the [stabilization plan](../plans/bdp-stabilization.md) retain the remaining work.

## Start and stop

In your own checkout, use Node 24.22.1 and pnpm 11.20.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm review:lab
```

Do not build a checkout while another process is using its dist files. The lab
records source commit/tree, dirty status, lock/tarball hashes, actual tool versions
and installed CLI/server entry hashes. Dirty source is labeled; version 0.0.0 alone
is not an input identity. This is not complete transitive-build attestation.
Packing requires the existing built artifacts and pnpm run context; package
installation may need network/cache access. No release or global install occurs.

Wait for `review-lab.ready`. It reports the owned root, local Scope, exact Node
path and `bdp.mjs` launcher path. In a second terminal assign those literal paths:

```sh
NODE='/absolute/path/from/ready/node'
BDP='/absolute/path/from/ready/launcher'
"$NODE" "$BDP" --help
"$NODE" "$BDP" scope inspect --output-format json
```

The generated launcher is a **private argv/stdin relay**, not the installed CLI
entry itself. The foreground owner spawns that fixed installed entry, owns its
process group, and returns its stdout/stderr bytes and exit code. There is no
shell parsing, remote administrative endpoint or arbitrary executable selection.
The Unix socket is 0600 under the 0700 temporary root. Input is bounded to 64 KiB
argv and 64 KiB stdin, 128 arguments; at most four relay peers and one CLI invocation
are admitted. Busy/invalid/remote-target requests refuse rather than queue.
Each CLI child is bounded to 65 seconds; relay waits are 70 seconds. Its shutdown
uses 500 ms per TERM/KILL/reap phase. Those phase budgets total 1500 ms within the outer worker’s
unchanged 3000 ms stop budget. Signal controls require worker acknowledgement of
completed child/listener cleanup before installation removal; the owner cannot spend the same grace
period concurrently with its own child’s escalation/reaping. The existing
child custodian bounds each output stream to 1 MiB, and the lab producer applies
a combined 1 MiB bound before retaining raw stdout/stderr. Overflow stops the lab
and fails; partial output is never returned as a successful complete invocation.
These are workstation limits, not protocol support limits. Use `@-`/`--file -` for piped stdin; the relay
buffers it within the bound, so interactive input is delivered on EOF.

Credentials are random and private to this whole-Scope fixture. The config is 0600;
retry files remain under its private state directory. Never print/share that
config or enable shell tracing around it. The launcher carries no token on argv.
The lab rejects configuration/profile overrides, nonlocal target URLs and retry
files outside its state root. Retry paths must be absolute (both split and
equals flag forms), so the relay and CLI cannot interpret different working
directories. Argv is refused rather than rewritten. External Type identities are data, not dial targets.

In the **first terminal**, the owner accepts three lab controls:

- `restart`: close/reopen the same store/instance/Scope/credential with create:false.
- `terminal ID`: installed SDK read of the authorized current deletion version.
  This is a lab control, not a new `bdp` verb or full History API.
- `stop`: close listeners and children, then remove the owned installation/state.

EOF, Ctrl-C and SIGTERM also stop it. A failed restart/terminal control stops
the workstation with a nonzero result; its fixed diagnostic does not reveal
credentials or underlying incidental error text. Fifteen minutes without a command or two
hours total ends the session. These finite workstation bounds prevent an
abandoned listener; they do not change cursor or protocol retention rules. Do not
close the owner terminal and expect the second-terminal launcher to keep working.
Any old launcher refuses after its owner/socket is gone. User-supplied store paths
are not accepted; preexisting internal directories are refused without deletion.

## Ordinary reads and writes

The examples below run in the second terminal. Copy actual returned tokens into
shell variables; example names R1/R7/D are not literal revision tokens.

```sh
"$NODE" "$BDP" create --id a --type https://types.invalid/Note --properties '{"title":"First","nested":[{"a":1},{"a":2}],"decimal":0.5}' --output-format json
"$NODE" "$BDP" create --id b --type https://types.invalid/Note --output-format json
"$NODE" "$BDP" show a --output-format json
"$NODE" "$BDP" show a --properties-only --include /nested/1/a --output-format json
"$NODE" "$BDP" list --paged --page-size 1 --output-format json
```

Save a's initial revision as R1 and the issued `data.next` unchanged as NEXT.

```sh
"$NODE" "$BDP" list --continue "$NEXT" --page-size 1 --output-format json
"$NODE" "$BDP" list --unpaged --page-size 1 --limit 0 --output-format jsonl
"$NODE" "$BDP" update a --if-revision "$R1" --set-property title=Edited --output-format json
"$NODE" "$BDP" update a --if-revision "$R1" --set-property title=Wrong --output-format json
"$NODE" "$BDP" update a --set-property title=Edited --output-format json
"$NODE" "$BDP" delete b --output-format json
```

The stale guard fails with revision-mismatch and exit 4. Repeating Edited is a
no-op preserving the Resource. Plain delete is a read preview; apply requires
`--force`. JSONL requires its terminal success record to claim complete delivery.
Property masks render the native properties view; they are not Resource projection.
Whole-object JSON or `--properties @-` preserves literal strings, nested data and
keys. `--set-property x=true` means boolean true, not the string "true".

```sh
"$NODE" "$BDP" link create a b --id edge --type https://types.invalid/Related --output-format json
"$NODE" "$BDP" link show edge --output-format json
"$NODE" "$BDP" link list --incident-to a --direction out --output-format json
"$NODE" "$BDP" link update edge --set-property note=Reviewed --output-format json
"$NODE" "$BDP" alias put aliases/current --target a --output-format json
"$NODE" "$BDP" alias resolve aliases/current --output-format json
"$NODE" "$BDP" show aliases/current --output-format json
"$NODE" "$BDP" alias delete aliases/current --force --output-format json
"$NODE" "$BDP" link delete edge --force --output-format json
```

For exact endpoint/Type pins, use genuine `a@=TOKEN` or
`[ABSOLUTE_URI]@=TOKEN`. `--if-revision TOKEN` is different: it sends the literal
opaque token, without stripping a leading equals sign. Alias resolve returns its
Location without following it; show alias follows the supported public read.

## Same-ID recovery, replay and restart

The lab uses installed `startReferenceService`, not the legacy
`startInstalledReferenceCandidate`. It selects optional historicalUpdate on a
fresh format 7 store; batch is not also selected. The API’s default ordinary
composition is format 5, and its separate batch-enabled format 6 cannot be combined
with historicalUpdate. This workstation starts no second batch lab. Save the
actual current a revision as R7, then:

```sh
"$NODE" "$BDP" delete a --force --if-revision "$R7" --output-format json
"$NODE" "$BDP" show a --output-format json
```

Ordinary show now returns not-found. In the first terminal, `terminal a` reads
actual deletion version D. The delete result's deleted.resource.revision is R7,
not D. Copy D's genuine revision and use the original live content token R1:

```sh
"$NODE" "$BDP" update a --from-revision "=$R1" --if-revision "$D" --idempotency-key review-recovery --output-format json
```

The result has the same identity and fresh live revision, source R1's editable
content, current protected Type/state, and context source R1/previous D. It does
not revive edge. Repeating the source with the new current guard is a live no-op.
Use owner `restart`, then show a again. Native cursors expire across restart;
restart is not a continuation-reset instruction.

Every mutation writes a private frozen journal before POST. Find the journal
whose saved prepared key is `review-recovery` in the reported root's
`state/bdp/retry`; do not assume newest filename means the desired operation.
Then replay with the same credential/config and exact saved invocation:

```sh
"$NODE" "$BDP" update --retry-file "$RECOVERY" --output-format json
```

Only saved input and display controls belong on retry: no new Scope, target,
source, guard or key. It returns the original envelope even after later changes,
not a newly evaluated update. Changing credentials is conservatively refused.
This manual lab has no public fault-injection control; the existing nine installed
CLI process cases separately test actual lost-response recovery and interruption.

## Finite check and explicit limits

`pnpm review:lab --check` runs the installed discovery, native pages, exact-value
properties, Bead/Link/alias CRUD, guards/no-op, historical undelete, original replay
and reopen journey, then removes its state. `review-lab.checked` records the
bounded scope; final lifecycle cleanup must also succeed. The companion Node
controls test relay/refusal/process-lifetime boundaries. Neither awards arbitrary
provider conformance or covers the eight remaining required provider families.

See the [executable support table](../reference-service.md#executable-review-support).
Types interpretation, Events, full History, Transfer, richer batch2 and Resource
projection are unsupported. Exact endpoint pins do **not** establish exact saved
Resource GET support: `show a@=R1` parses, but this reference rejects the revision
query because full History is unadvertised. This refusal is protocol-correct;
endpoint pin support does not advertise History or imply missing required support.
The canonical CLI does not submit batch1 even though a separate reference
composition can advertise it. No protocol or CLI-design decision follows from
these implementation boundaries.

## HTTP conditional-read appendix

Canonical HEAD/condition flags remain deferred; do not invent `bdp --head` or
translate a renderer mask into an HTTP condition. The installed SDK’s ordinary
`read` method supports method HEAD and ifMatch/ifNoneMatch/ifModifiedSince/
ifUnmodifiedSince controls; the reference current read implements ETag-based
condition handling. A manual HTTP probe should acquire the actual current ETag
from its authorized GET, send that exact validator in If-None-Match, and inspect
status/headers/body absence independently (304 is not an empty Resource). Keep
credentials in private process configuration, not curl argv or a transcript.
These controls are not exposed by this lab’s CLI relay or owner controls. Their
SDK/HTTP correspondence is a separate bounded review, not a new conditional-CLI
support claim.
