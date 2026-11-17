# Review agenda — the operations (§7)

Prepared 2026-11-16 for the grind-through. **No descriptions here on purpose** — we
settle shape first, then add `/// description:` + `/// normative:` once each is agreed.
Each op shows its **current** signature and the **tweaks** the 2026-11-16 model forces,
plus **open** questions. Signatures are the primitives only; `apply`/`eval` already
left to `stdlib`.

> Cross-cutting rename to decide up front (affects most writes):
> a bead's content field is now **`body`** (typed), not `properties`; its type is the
> **`type` path + `authority`** pair, not a `kind`/`type: any`. Every write op that took
> `properties` / `type: any` / `kind` needs to move to `type` (path) + `authority` (PackageRef) + `body`.

---

## get  — `fn` · GET /resource
```
fn get(resource: ref<Resource>, selector?: selector) -> representation
```
- **Tweaks:** `representation` → `Resource` (the alias we added). Return is a resolved `Resource`.
- **Open:** does `get` ever return `unpinned` vs `pinned`? (precision principle: pinned when versioned.)

## create — `command` · POST /scope
```
command create(scope: Scope, requestedId?: IdRoot | Id, type?: any,
               properties?: {...}, metadata?: {...}) -> Result<pinned<Resource>, Problem>
```
- **Tweaks:** `type?: any` → `type: PathString` + `authority?: PackageRef`; `properties` → `body`; drop the stale `// fixes beadKind` comment.
- **Open:** is `authority` caller-supplied on create, or resolved server-side from `type`? Can a caller create a **content** resource (media-type `type`, no authority) via create, or only `put`?

## put — `idempotent command` · PUT /resource
```
idempotent command put(resource: unpinned<Resource>, id?: unpinned<Resoure>, type?: any,
                       properties?: {...}, metadata?: {...} ifRevision?: Rev)
                       -> Result<pinned<Resource>, Problem>
```
- **Tweaks:** typo `Resoure` → `Resource`; **missing comma** before `ifRevision`; `type?: any` → `type` + `authority`; `properties` → `body`; stale `// fixes beadKind`.
- **Open:** `resource` + `id?` both present is confusing — is the target the `resource` ref, with `id?` only for first-write id proposal? Clarify.

## patch — `command` · PATCH /resource
```
command patch(resource: unpinned<Resorce>, patch: JsonPatch, ifRevision?: Rev)
              -> Result<pinned<resource>, Problem>
```
- **Tweaks:** typo `Resorce` → `Resource`; lowercase `resource` → `Resource`. JSON Patch paths were limited to `/properties` and `/metadata` → now **`/body`** and `/metadata`.

## delete — `idempotent command` · DELETE /resource
```
idempotent command delete(resource: unpinned<Resource>, ifRevision?: Rev)
                          -> Result<pinned<resource>, Problem>
```
- **Tweaks:** lowercase `pinned<resource>` → `pinned<Resource>`. Otherwise clean.

## list — `fn` · GET /scope
```
fn list(scope: Scope, where?: ListFilter, select?: selector, page?: Page)
        -> source<representation>
```
- **Tweaks:** `representation` → `Resource`. Confirm `source<Resource>`.

## revisions — `fn` · GET /resource
```
fn revisions(resource: unpinned<Resource>, select?: selector, page?: Page)
             -> source<representation>
```
- **Tweaks:** `representation` → `Resource`.

## call — `fn` · POST /operation
```
fn call(operation: ref<Resource>, request: Request) -> Reply
```
- **Tweaks:** `operation: ref<Resource>` → `ref<OperationBead>` (call targets an operation bead).
- **Open:** sync returns `Reply` (Outcome inside); `--async` returns `AsyncResultBead` at 202. Should the return type union those, or stay `Reply` with the 202 in the openapi only?

## cancel — `command` · POST /asyncResult
```
command cancel(asyncResult: unpinned<resource>) -> Result<pinned<AsyncResult>, Problem>
```
- **Tweaks:** lowercase `resource` → `AsyncResultBead`; `pinned<AsyncResult>` → `pinned<AsyncResultBead>` (the bead, not the body).

## pull — `fn` · GET /channel
```
fn pull(channel: unpinned<Channel>, request: PullRequest) -> PullPage
```
- **Tweaks:** `unpinned<Channel>` → `unpinned<ChannelBead>` (`Channel` is now the body type; the bead is `ChannelBead`).

## push — `command` · POST /channel
```
command push(channel: unpinned<Resource>, source: source<any>, strategy?: PushStrategy)
             -> Result<PushReport, Problem>
```
- **Tweaks:** `unpinned<Resource>` → `unpinned<ChannelBead>`.

## export — `fn` · GET /scope  → **lift the export FORMAT above the ops (§10 → model area)**
```
fn export(scope: Scope, where?: ListFilter, select?: selector, revisions?: bool)
          -> source<ExportRecord>
```
- **Tweaks:** your `//// no errir?` — decide whether export can fail (Result<…>) or is infallible stream. `ExportRecord` references `representation` → `Resource`.
- **Note:** you wanted the export *format* schemas (`ExportRecord`/`Begin`/`End`) moved above the ops — they serialize `Resource`, so they belong with the model, not the op list. The `export`/`import` *ops* stay here.

## import — `command` · POST /scope
```
command import(scope: Scope, source: source<ExportRecord>, strategy?: ImportStrategy)
               -> Result<ImportReport, Problem>
```
- **Tweaks:** `ExportRecord` → references `Resource`. `ImportReport.conflicts[].id: ref<resource>` lowercase → `ref<Resource>`.

> Stale comment at the scope-level banner: "I think we agreed these get out of core… apply goes with batch, eval goes with query." `apply`/`eval` are already in `stdlib`; `export`/`import` **stay** (per the data/state/storage-lifecycle call). Delete the stale note.

---

## op-param helpers (small schemas carried with the ops)
```
schema IdRoot { prefix: string }
schema Id     { id: string }
schema Page   { after?: Cursor, from?: Ordinal, limit?: number }
schema PushStrategy { dedup?: bool, dryRun?: bool }
schema PushReport   { pushed: number, skipped: number, conflicts: [ { ordinal: Ordinal, reason: string } ] }
```
- **Open:** `IdRoot | Id` as the create id-proposal — keep both, or one shape? (`IdRoot` = prefix-rooted auto-id, `Id` = exact.)

---

### Cross-cutting opens for the ops pass
1. **Write surface:** confirm the `type`(path) + `authority` + `body` triple is what create/put accept, and whether `authority` is caller-set or server-resolved.
2. **Bead vs content writes:** which ops admit non-bead (content) resources? (`put` of a `text/plain`?)
3. **Return precision:** `pinned<Resource>` everywhere a write mints a revision; relax to `unpinned` only for non-versioned scopes (advertised).
4. **`representation` alias:** we aliased `representation = Resource` so the ops resolve — decide whether to keep the alias or sweep the ops to `Resource` directly.
