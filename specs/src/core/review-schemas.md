# Review agenda — the other schemas (everything not in the closed model)

Prepared 2026-11-16 for the grind-through. **No descriptions here on purpose** — shape
first, prose after. Each group lists the **current** shape and the **tweaks** the
2026-11-16 model forces, plus **open** questions. The closed resource/bead model
(Resource, Bead<T>, the four bodies, identity, authority, Scope) is done and not repeated here.

> **Temporary aliases to resolve.** The merge introduced three carry-over aliases so the
> ops resolve. Decide each:
> - `type Kind = string` — only alive for `BeadValueSchema.TypeRef { to: Kind }` and
>   `ChangeEnvelope.subjectKind`. **Dissolves in the types pass** (kind = `type.id`).
> - `type representation = Resource` — keep the alias, or sweep ops/events/export to `Resource`.
> - `type Metadata = { ...: any }` — define properly or inline at Request/Reply.

---

## 1. Supporting primitives — mostly stable, confirm only
```
StorageClass = Durable { versioned: bool } | Ephemeral | Intrinsic
Provenance   = { principals: [Principal], inception, committedAt, previousRevision?, message?, metadata? }
Principal    = { id: AbsoluteUri, displayName?, roles?, basis: IdentityBasis, authority? }
IdentityBasis = union { "writer-supplied" | "channel-authenticated" | "unknown" }
AbsoluteUri, Timestamp, SemVer, LocalName  = string (with jsonschema refinements)
namedDeclarations = [ { name, schema: BeadValueSchema, required } ]
Retention = forever | window{by,amount} | compacted{window?}
```
- **Tweaks:** `Principal.authority` collides by name with the new `Resource.authority` (unrelated — this is "the channel-authenticating service"). Consider rename (`authenticatedBy`).
- **Open:** `Provenance.inception` enum vs the §0 `createdAt`-with-storage open — reconcile who owns birth vs revive.

## 2. The type-value schema — **THE deferred "types" pass** (biggest item)
```
schema BeadValueSchema =
    Scalar | Literal | Nominal | Record | DU | Union | Array | Set
  | TypeRef { to: Kind }          // ← must become ElementRef (authority? + path)
  | Opaque  { jsonSchema }
LocalName, JsonSchema
```
- **Tweaks:** `TypeRef { to: Kind }` is the one real gap — realign to the new `ElementRef`
  (`authority?: PackageRef`, `path: ElementPath`). Then `Kind` can be deleted.
- **Open:** does `BeadValueSchema` stay at all, or does the single-`is` TypeDef model subsume
  parts of it (Nominal/Record/DU)? This is where the "types batch" lives — expect real work.

## 3. Op-support shapes (call protocol)
```
Request  = { arguments: [{name,value}], async=false, causedBy?, calledBy?, provenance?, idempotencyKey, metadata? }
Reply    = { outcome: Outcome<any,any>, cause, frame, transaction?, metadata? }
Result<T,E>  = union { success{value:T} | failure{error:E} }
Outcome<T,E> = union { Result<T,E> | fault{problem:Problem} | canceled{reason?} }
Problem  = { type, title, status, code, retry, detail?, instance? }
AsyncResult = { operation: ref<OperationBead>, cause, frame, request, reply?, replyChannel: ref<ChannelBead> }
IdempotencyKey, Cause, Frame, Transaction = string
```
- **Tweaks:** these are op-side but already reference the new bead types (`ref<OperationBead>`,
  `ref<ChannelBead>`) correctly. `Metadata` alias (see top). `Result`/`Outcome`/`Problem` look closed.
- **Open:** `Reply.outcome: Outcome<any,any>` — keep generic `any`, or tie to the op's `success`/`failure`?

## 4. Read-shaping & filter
```
selector  = { include?: [JsonPointer], omit?: [JsonPointer], expand?: [LocalName] }
JsonPatchOp = { op, path, value?, from? } ;  JsonPatch = [JsonPatchOp]
JsonPointer = string
ListFilter = [ listCondition ]
listCondition = union  compare | matches | has | missing | contains | containsAny | excludes | isKind{kind:RelativeId, match}
FieldPath = [string] ;  RelativeId = string
```
- **Tweaks:**
  - `listCondition` has a **broken union** (`union` with no `{`, arms unbraced, an orphan `isKind` arm after the review notes) — fix to the `union { … }` block form.
  - `selector`/`JsonPatch` note "`/properties`" — now **`/body`**; the "`kind`/`id` never dropped" note → `type`/`id` never dropped (kind is derived).
  - `isKind { kind: RelativeId, match: "exact"|"prefix" }` is exactly the kind-path prefix/exact matcher — aligns with `type.id` as the path. Keep; rename `RelativeId` → an `ElementPath`-ish.
- **Open:** the `>>>`/`>L` review thread on isType-vs-isKind is still inline — resolve and strip.

## 5. Change events (§8)
```
ChangeEvent    = Created | Updated | Deleted
ChangeEnvelope = { ordinal, at, subject: ResourceId, subjectKind?: Kind, subjectType?: ref<BeadType>,
                   transaction, cause?, causedBy?, frame?, calledBy? }
Created  = { ...ChangeEnvelope, representation: representation }
Updated  = { ...ChangeEnvelope, content: ChangeContent }
Deleted  = { ...ChangeEnvelope, provenance: Provenance }
ChangeContent = full{representation} | patch{patch: JsonPatch, provenance}
```
- **Tweaks:**
  - `representation` → `Resource` (3 places).
  - `subjectType?: ref<BeadType>` → `ref<TypeBead>` (`BeadType` is undefined; the type bead is `TypeBead`).
  - `subjectKind?: Kind` → derived `type.id`; keep as a denormalized path or drop (kind dissolves).
  - `ChangeEvent = Created | Updated | Deleted` and `ChangeContent` → `union { … }` block form (per the DU-is-union-blocks convention).
- **Open:** the `>>>`/`>L` thread about delete provenance / top-level DU is inline and marked "Review this shape" — this is a real review item.

## 6. Transport (§9)
```
PullRequest = { after?: Cursor, from?: Ordinal, limit?, format?: Format, filter?: ListFilter, select?: selector }
Ordinal = number ;  Cursor = string ;  Format = "json" | "jsonl" | "sse"
PullPage = { items: [any], cursor: Cursor, head?: bool }
```
- **Tweaks:** mostly clean. Strip the inline `>>>`/`>L` review notes in `PullRequest`/`PullPage` (already resolved — `source` removed, `events`→`items`).

## 7. Export format (§10) — **lift this group above the ops** (it serializes `Resource`)
```
ExportRecord = ExportBegin | representation | ExportEnd
ExportBegin  = { kind: "export-begin", scope: AbsoluteHttpUrl, cursor: Cursor }
ExportEnd    = { kind: "export-end", count: number }
ImportStrategy = { dedup?, allowStale?, dryRun?, idRoot? }
ImportReport   = { imported, skipped, conflicts: [{ id: ref<resource>, reason }] }
```
- **Tweaks:**
  - `representation` → `Resource`.
  - `AbsoluteHttpUrl` is **undefined** — use `AbsoluteUri` (or a `BdpScope`).
  - `ImportReport.conflicts[].id: ref<resource>` lowercase → `ref<Resource>`.
  - `ExportBegin`/`End` use a literal `kind:` discriminant — fine as a line-type tag (unrelated to bead `type`); maybe rename the field to avoid confusion with the kind path.
- **Rationale for the move:** export is a *transfer syntax for resources/beads*, not an operation — it belongs next to the model it serializes.

---

### Suggested grind order (when you're back)
1. **Op-support shapes** (§3) — nearly closed, quick confirm.
2. **Change events** (§5) — real shape review (the delete-provenance thread).
3. **Filter/read-shaping** (§4) — fix the broken `listCondition` union, resolve isKind.
4. **Export format** (§7) — small, then lift above the ops.
5. **The types pass** (§2 `BeadValueSchema`) — last and biggest; realign `TypeRef`, kill `Kind`.
