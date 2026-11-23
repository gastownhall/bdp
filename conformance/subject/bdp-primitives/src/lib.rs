//! BDP primitives — the runtime-native Rust surface for a BDP **scope**.
//!
//! Distinct from the BDP JSON wire rep: real `ResourceId`/`Rev`/`Kind`, borrowed `&str` on the
//! call side, `Bytes`-backed raw JSON, enums for the sums. Keyed off
//! `agent-memory/bdp/nolinks/resource-model.md` §7 (2026-11-13).
//!
//! This is the scope's READ + STATE-MUTATION interface. Namespace / well-known-name routing (the
//! `/sys/` scheme, resolving a channel by name) lives ABOVE this layer.
//!
//! Shape (Donna): à la carte, NOT profiles. ONE trait (`BdpScope`); `get` is the only required
//! method, every other primitive defaults to `BdpResult::not_implemented()`, and a scope
//! overrides what it supports. Trait methods return `BdpResult<T>` directly (no per-op aliases).
//! `capabilities()` advertises the supported set; its per-op limit records are Shelly's draft,
//! Lydia BDP-ifies them into the spec.
//!
//! A `Representation` is an OPEN enum: a `Bead` (the typed graph node) or a generic `Resource`
//! (opaque content by media type) — both versioned and provenanced. More variants may come.

#![allow(async_fn_in_trait)]

use std::marker::PhantomData;
use std::sync::Arc;

use bytes::Bytes;

// =============================================================================
// §1  Identity & references
// =============================================================================

/// A resource scope. Wire `scope`: `null` = this scope, `"WEB"` = the web, else another scope.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Scope {
    This,
    Web,
    Named(ScopeName),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ScopeName(pub Arc<str>);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Id(pub Arc<str>);

/// Opaque revision token — equality ONLY; no order/time/allocation in its spelling.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Rev(pub Arc<str>);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Kind(pub Arc<str>);

/// resourceID — the identity triple. `rev: None` = head/track-latest; `Some` = pinned.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ResourceId {
    pub scope: Scope,
    pub id: Id,
    pub rev: Option<Rev>,
}

impl ResourceId {
    pub fn head(scope: Scope, id: Id) -> Self {
        Self { scope, id, rev: None }
    }
    pub fn pinned(scope: Scope, id: Id, rev: Rev) -> Self {
        Self { scope, id, rev: Some(rev) }
    }
}

/// resourceRef — `ref<T>` ( = `ResourceId` + phantom target type). Typed above; erases to
/// `ResourceId` at the surface. `fn() -> T` keeps it covariant and `Send`/`Sync` regardless of T.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Ref<T> {
    pub id: ResourceId,
    _marker: PhantomData<fn() -> T>,
}

impl<T> Ref<T> {
    pub fn new(id: ResourceId) -> Self {
        Self { id, _marker: PhantomData }
    }
    pub fn erase(self) -> ResourceId {
        self.id
    }
}

/// Marker for `ref<Bead>` where a typed ref is wanted above the surface.
#[derive(Clone, Debug)]
pub enum Bead {}

// =============================================================================
// §2  Representations — the resource read back (OPEN enum: bead or generic resource)
// =============================================================================

/// Raw JSON held zero-copy from the backend (postgres `jsonb`/`bytea`, a file's bytes).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RawJson(pub Bytes);

/// An IANA media type, e.g. "application/json", "text/html", "image/png".
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MediaType(pub Arc<str>);

/// A generic resource body — text or binary.
#[derive(Clone, Debug)]
pub enum Body {
    Text(String),
    Binary(Bytes),
}

/// A self-describing representation. OPEN (`#[non_exhaustive]`): more resource categories may be
/// added. Every variant is versioned (`rev` in `id`) and provenanced.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum Representation {
    /// A bead — the typed graph node a BDP Type governs.
    Bead {
        id: ResourceId,
        kind: Kind,
        r#type: ResourceId, // ref<BeadType>, erased
        created_at: Timestamp,
        properties: RawJson,
        metadata: RawJson,
        provenance: Provenance,
    },
    /// A generic (non-bead) resource: opaque content addressed by media type. Still revisioned and
    /// provenanced; the store treats it like any other resource. (Donna: anticipate non-beads.)
    Resource {
        id: ResourceId,
        content_type: MediaType,
        body: Body,
        provenance: Provenance,
    },
}

impl Representation {
    /// The identity (and pinned rev) of whichever variant this is.
    pub fn id(&self) -> &ResourceId {
        match self {
            Representation::Bead { id, .. } => id,
            Representation::Resource { id, .. } => id,
        }
    }
}

/// One slot of a batch `resolve`: present, absent (404), or erased (410, tombstone rev). A single
/// `get` returns `NotFound`/`Erased` as a `BdpError` instead (one ref).
#[derive(Clone, Debug)]
pub enum ResolvedRepresentation {
    Present(Representation),
    Absent,
    Erased(Rev),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Timestamp(pub Arc<str>); // RFC 3339; opaque.

/// Per-revision provenance. `previous_revision` is the before-image pointer (compensation basis).
#[derive(Clone, Debug)]
pub struct Provenance {
    pub principals: Vec<Principal>,
    pub inception: Inception,
    pub committed_at: Timestamp,
    pub message: Option<String>,
    pub previous_revision: Option<Rev>,
}

#[derive(Clone, Debug)]
pub struct Principal(pub RawJson); // opaque at this layer.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Inception {
    Create,
    Import,
    Revive,
    Unknown,
}

// =============================================================================
// §3  BdpResult<T> — the common result envelope (Donna's design)
// =============================================================================

/// Keep the payload `T` clean; park the noise beside it. `value` is `None` when the scope does
/// not support this primitive (`not_implemented`), or when a primitive legitimately yields
/// nothing. Every primitive returns `Result<BdpResult<T>, BdpError>`.
#[derive(Clone, Debug)]
pub struct BdpResult<T> {
    pub value: Option<T>,
    pub not_implemented: bool,
    pub protocol: ProtocolMeta, // protocol noise — common to every scope
    pub scope: ScopeMeta,       // scope-specific noise — open, never load-bearing
}

impl<T> BdpResult<T> {
    pub fn ok(value: T) -> Self {
        Self { value: Some(value), not_implemented: false, protocol: ProtocolMeta::default(), scope: ScopeMeta::default() }
    }
    pub fn not_implemented() -> Self {
        Self { value: None, not_implemented: true, protocol: ProtocolMeta::default(), scope: ScopeMeta::default() }
    }
    pub fn with_protocol(mut self, protocol: ProtocolMeta) -> Self {
        self.protocol = protocol;
        self
    }
}

/// Protocol noise — facts the caller MAY use but usually ignores.
#[derive(Clone, Debug, Default)]
pub struct ProtocolMeta {
    pub rev: Option<Rev>,
    pub cursor: Option<Cursor>,
    pub head: Option<bool>,
    pub transaction: Option<Transaction>,
    pub warnings: Vec<Warning>,
}

/// Scope-specific noise — an open bag (e.g. `{sql, rows_scanned, plan, elapsed_ms}`).
#[derive(Clone, Debug, Default)]
pub struct ScopeMeta(pub RawJson);

#[derive(Clone, Debug)]
pub struct Warning {
    pub code: String,
    pub detail: String,
}

// =============================================================================
// §4  List & filter inputs (the low bar)
// =============================================================================

/// A field path as literal segments (`["properties","status"]`); a dotted key stays one segment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldPath(pub Vec<String>);

/// `ListFilter` — the flat conjunction `list`/`changes`/`export` take. Each condition → one
/// storage predicate; the full `filter`/`BDPAst` goes through `evaluate`.
#[derive(Clone, Debug, Default)]
pub struct ListFilter(pub Vec<ListCondition>);

#[derive(Clone, Debug)]
pub enum ListCondition {
    Compare { field: FieldPath, op: CompareOp, value: RawJson },
    Matches { field: FieldPath, pattern: String, using: MatchKind },
    Has { field: FieldPath },
    Missing { field: FieldPath },
    Contains { field: FieldPath, value: RawJson },
    ContainsAny { field: FieldPath, values: Vec<RawJson> },
    Excludes { field: FieldPath, value: RawJson },
    IsType { r#type: RelativeId, exact: bool },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelativeId(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompareOp { Eq, Ne, Lt, Le, Gt, Ge, In }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchKind { Substring, Glob, Regex }

/// Windowed paging — resume `after` a cursor XOR start `from` an ordinal, with a `limit`.
#[derive(Clone, Debug, Default)]
pub struct Page {
    pub after: Option<Cursor>,
    pub from: Option<Ordinal>,
    pub limit: Option<u32>,
}

/// Read projection (JSON Pointer paths). Shape shared with Lydia's `selector`; held opaque.
#[derive(Clone, Debug)]
pub struct Selector(pub RawJson);

// =============================================================================
// §5  Writes — single writes + the `apply` write-set (no `update`; put=full, patch=delta)
// =============================================================================

/// The create/put body — the new full state (runtime form of `CreateRequest`).
#[derive(Clone, Debug)]
pub struct CreateBody {
    pub kind: Kind,
    pub r#type: ResourceId,
    pub properties: RawJson,
    pub metadata: RawJson,
}

/// RFC 6902 patch, limited to /properties + /metadata. Raw at this layer.
#[derive(Clone, Debug)]
pub struct JsonPatch(pub RawJson);
/// The write GUARDS. **Preconditions, never body** — each rides the request line (a header or the
/// query string), so a `put` body stays exactly the representation and a `patch` body stays exactly
/// the JSON Patch, unwrapped and correctly typed.
///
/// Carried by `put` here; `patch` and `delete` still take a bare `if_rev` and are a separate,
/// mechanical retrofit. `if_absent` is `put`-ONLY and a scope MUST refuse it elsewhere.
///
/// WHY THIS EXISTS: `put` previously could not carry a guard AT ALL — the trait took no `if_rev`,
/// so a client sending `If-Match` got `200` and believed it held a concurrency guard while the
/// write proceeded against a stale revision. That is a lost-update vector in which the unsafe
/// operation SUCCEEDS, so the client cannot learn it from the result.
#[derive(Clone, Debug, Default)]
pub struct Guards {
    /// `ifRevision` -> `If-Match: "<Rev>"` (a strong entity-tag, RFC 9110 §8.8.3). Optimistic
    /// concurrency: a stale value makes NO change and faults `RevisionMismatch` (412).
    pub if_revision: Option<Rev>,
    /// `ifAbsent` -> `If-None-Match: *`. The write applies only if nothing is there, else faults
    /// `AlreadyExists` (409) — the same fault a `create` collision raises, so a client keeps ONE
    /// id-taken handler for the claiming path. `put` only.
    pub if_absent: bool,
    /// `precondition` -> `?precondition=<Filter>`. A STATE guard: the write applies only if the
    /// current resource satisfies the filter, else faults `RevisionMismatch` (412). Reuses the same
    /// flat-AND grammar `list` takes.
    pub precondition: Option<ListFilter>,
}

impl Guards {
    pub fn if_revision(rev: Rev) -> Self {
        Self { if_revision: Some(rev), ..Default::default() }
    }
    pub fn if_absent() -> Self {
        Self { if_absent: true, ..Default::default() }
    }
    /// True when no guard is set — the unguarded write path.
    pub fn is_empty(&self) -> bool {
        self.if_revision.is_none() && !self.if_absent && self.precondition.is_none()
    }
}


/// One write in an `apply` write-set — 1:1 with the single-write methods (create/put/patch/delete).
#[derive(Clone, Debug)]
pub enum Write {
    /// bCreate — server allocates the id when `id` is `None`.
    Create { id: Option<Id>, body: CreateBody },
    /// bPut — client-id full-state upsert.
    Put { target: ResourceId, body: CreateBody, guards: Guards },
    /// bPatch — JSON Patch delta over /properties + /metadata.
    Patch { target: ResourceId, patch: JsonPatch, if_rev: Option<Rev> },
    /// bDelete — tombstone.
    Delete { target: ResourceId, if_rev: Option<Rev> },
}

/// Write ops return the **pinned ref**: the written `ResourceId` whose `rev` is the minted
/// revision (precision principle — base signatures return `pinned<resource>`; a non-versioned
/// scope relaxes to `unpinned` via capability). The create-vs-update lifecycle is NOT on the
/// write return — it is read from `ChangeEvent.op` on the changefeed, its canonical home.
///
/// (The former `WriteResult { reference, created, op }` was removed: the wire returns only the
/// pinned ref, so `created`/`op` had no body home and a `RemoteScope` could not reproduce them —
/// breaking the "RemoteScope IS a BdpScope" invariant. See `bdp-protocol/RECONCILE.md` §1.)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeOp { Create, Update, Delete }

// =============================================================================
// §6  Changefeed
// =============================================================================

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Ordinal(pub u64);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Cursor(pub Bytes);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Transaction(pub Arc<str>);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Cause(pub Arc<str>);

/// One committed change. The new revision IS `subject.rev`.
#[derive(Clone, Debug)]
pub struct ChangeEvent {
    pub ordinal: Ordinal,
    pub at: Timestamp,
    pub subject: ResourceId,
    pub subject_kind: Option<Kind>,
    pub op: ChangeOp,
    pub content: Option<ChangeContent>,
    pub transaction: Transaction,
    pub cause: Option<Cause>,
    pub caused_by: Option<Cause>,
    pub provenance: Option<Provenance>,
}

#[derive(Clone, Debug)]
pub enum ChangeContent {
    Full { representation: Representation },
    Patch { patch: JsonPatch },
}

// =============================================================================
// §7  eval / call / export-import
// =============================================================================

/// The expression `evaluate` is handed. Impl path targets `LumenAst` first (hybrid lower-to-SQL +
/// in-memory); `BdpAst` is deferred/empirical (Lydia, 2026-11-13).
#[derive(Clone, Debug)]
pub enum Expr<'a> {
    BdpAst(BdpAst),
    BdpText(&'a str),
    LumenAst(LumenAst),
    LumenText(&'a str),
    StgSpecific(&'a str),
    Other { kind: &'a str, body: RawJson },
}

/// Placeholder for Lydia's bounded query IR. Walk-op (for the eventual SQL lowering):
/// `{ relationship: { prop?, family? }, direction: forward|reverse, depth: uint }` →
/// `WHERE fromprop=prop AND/OR family=family`, pivot from/to by direction, recurse to depth.
#[derive(Clone, Debug)]
pub struct BdpAst(pub RawJson);

/// Placeholder for Rachel's typed Lumen AST (the Rachel->Shelly seam).
#[derive(Clone, Debug)]
pub struct LumenAst(pub RawJson);

/// `evaluate -> any`. Raw here; a typed `evaluate<T>` is a surface projection above.
#[derive(Clone, Debug)]
pub struct Value(pub RawJson);

/// The input to `call` — the Operation's argument record. Raw at this layer.
#[derive(Clone, Debug)]
pub struct Request(pub RawJson);

/// The outcome of a `call`: a synchronous `Reply`, or an `AsyncResult` bead's ref to settle later.
#[derive(Clone, Debug)]
pub enum CallOutcome {
    Reply(Reply),
    Async(ResourceId),
}

#[derive(Clone, Debug)]
pub struct Reply(pub RawJson);

/// One line of an export: begin marker, resource record, or end marker (JSONL framing).
#[derive(Clone, Debug)]
pub enum ExportRecord {
    Begin(ExportBegin),
    Record(Representation),
    End(ExportEnd),
}

#[derive(Clone, Debug)]
pub struct ExportBegin {
    pub cursor: Cursor,
}

#[derive(Clone, Debug)]
pub struct ExportEnd {
    pub count: u64,
}

/// How `import` applies the stream: set current state, or replay history to rebuild the chain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportStrategy {
    SetCurrent,
    HistoryRestore,
}

#[derive(Clone, Debug)]
pub struct ImportReport(pub RawJson);

// =============================================================================
// §8  Capabilities — supported ops + limits. Shelly drafts & iterates these records; Lydia
//     BDP-ifies them into the spec once settled. First cut, pending spec.
// =============================================================================

#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum PrimitiveCapabilities {
    Get(GetCaps),
    Resolve(ResolveCaps),
    List(ListCaps),
    Changes(ChangesCaps),
    Pull(PullCaps),
    Export(ExportCaps),
    Create(CreateCaps),
    Put(PutCaps),
    Patch(PatchCaps),
    Delete(DeleteCaps),
    Apply(ApplyCaps),
    Import(ImportCaps),
    Evaluate(EvaluateCaps),
    Call(CallCaps),
    /// `aliases` — the scope resolves a scope-unique alias NAME to the stored target ref
    /// (`resolve_alias`, resource-model.md §65). Advertised per ability; ABSENT ⇒ callers use the
    /// universal above-trait fallback (`list` kind=alias + `get`). Storage is alias-as-bead via the
    /// normal writes, so this is a READ capability only; the `get` floor is untouched.
    Aliases(AliasesCaps),
    /// Scope-level revision model (the precision-principle relaxation). ABSENT ⇒ the scope is
    /// versioned: write primitives return PINNED refs (`rev = Some`, the minted revision), and
    /// conformance expects that. PRESENT ⇒ the scope has **no revision identity** at all — it
    /// mints no revisions, so `rev` is `None` EVERYWHERE: write refs are unpinned, and (per
    /// Shelly, conformance owner) a conformance suite must relax EVERY revision-dependent behavior
    /// for such a scope, not just the write return — pinned-`rev` `get` (time-travel) and a
    /// revision-bearing changefeed are likewise not honored. Advertised by e.g. a git-backed fs
    /// store where history is the VCS's, not the scope's. Base signatures stay precise (`pinned`);
    /// THIS relaxes them scope-wide.
    Unversioned(UnversionedCaps),
}

#[derive(Clone, Debug, Default)]
pub struct GetCaps { pub selector: bool }

#[derive(Clone, Debug, Default)]
pub struct ResolveCaps { pub selector: bool, pub max_batch: Option<u32> }

#[derive(Clone, Debug, Default)]
pub struct ListCaps {
    pub conditions: Vec<ConditionKind>,
    pub selector: bool,
    pub sort: bool,
    pub max_limit: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConditionKind { Compare, Matches, Has, Missing, Contains, ContainsAny, Excludes, IsType }

#[derive(Clone, Debug, Default)]
pub struct ChangesCaps { pub sse: bool, pub jsonl: bool, pub filter: bool, pub selector: bool }

#[derive(Clone, Debug, Default)]
pub struct PullCaps { pub sse: bool, pub jsonl: bool, pub filter: bool, pub selector: bool }

#[derive(Clone, Debug, Default)]
pub struct ExportCaps { pub revisions: bool }

#[derive(Clone, Debug, Default)]
pub struct CreateCaps { pub server_allocates_id: bool, pub client_proposed_id: bool }

#[derive(Clone, Debug, Default)]
pub struct PutCaps { pub if_match: bool, pub if_absent: bool }

#[derive(Clone, Debug, Default)]
pub struct PatchCaps { pub if_match: bool }

#[derive(Clone, Debug, Default)]
pub struct DeleteCaps { pub if_match: bool }

#[derive(Clone, Debug, Default)]
pub struct ApplyCaps { pub max_writes: Option<u32>, pub acyclicity: bool }

#[derive(Clone, Debug, Default)]
pub struct ImportCaps { pub history_restore: bool }

#[derive(Clone, Debug, Default)]
pub struct EvaluateCaps {
    pub bdp_ast: bool,
    pub bdp_text: bool,
    pub lumen_ast: bool,
    pub lumen_text: bool,
    pub stg_specific: bool,
}

#[derive(Clone, Debug, Default)]
pub struct CallCaps { pub async_supported: bool }

/// `aliases` resolution. Presence ⇒ the scope implements `resolve_alias`. `indexed` advertises a
/// name-index backing (pg/dolt) vs an index-or-scan (fs), so a caller can prefer the advertised
/// resolve over the above-trait list+get fallback. (The marker may grow without breaking advertisers.)
#[derive(Clone, Debug, Default)]
pub struct AliasesCaps { pub indexed: bool }

/// Marker: presence in `capabilities()` means the scope is non-versioned — its write refs are
/// How a Resource is kept — whether it is PERSISTED, not whether it is versioned (that is the
/// scope's revision model). `Intrinsic` is computed by the service rather than stored and is
/// universal, so it never appears in an advertised `storage_classes`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageClass {
    Durable,
    Ephemeral,
    Intrinsic,
}

/// A scope's revision model — a scope-wide trait, **stated outright, never inferred** (no implicit
/// default).
///
/// `versioned` also CONSTRAINS the id model: it REQUIRES `permanent`, since a revision chain may
/// not span two resources under one id. So `versioned` + `reusable` is not a legal pair, and
/// `reusable` implies `unversioned`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevisionModel {
    /// The scope mints revisions; write refs are pinned and a pinned-revision `get` resolves.
    Versioned,
    /// The scope mints no revisions; `rev` is absent everywhere and every revision-dependent
    /// behaviour relaxes scope-wide.
    Unversioned,
}

/// Whether an id retired by `delete` is permanently spent, scope-wide. **Stated outright, never
/// inferred.**
///
/// This is the capability limitation that lets a scope project an existing system whose id
/// allocation it does not control: such a scope states `Reusable` rather than claim a guarantee it
/// cannot keep.
///
/// A client must be able to READ this to make an informed choice, which is why it is advertised
/// rather than assumed: under `Reusable` an unpinned inbound reference may resolve to an UNRELATED
/// resource, and pinning is not a remedy — a `Reusable` scope mints no revisions, so there is no
/// pinned form of the reference to hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdModel {
    /// A retired id is never reused; a write targeting it faults `410`, and claiming it faults
    /// `identity-taken`.
    Permanent,
    /// A retired id MAY be minted again. REQUIRES `Unversioned`.
    Reusable,
}

/// The SCOPE-LEVEL capability document — the scope's own traits, as distinct from the per-primitive
/// `PrimitiveCapabilities` list which says which ops it offers.
///
/// Both are needed and they answer different questions: the primitive list says what you may CALL,
/// this says what the store GUARANTEES. A fault's reachability can depend on these traits rather
/// than on the operation — a write's `410` is reachable only under `Permanent`, and `delete`'s `404`
/// only where the scope can tell "already retired" from "never existed" — so a conformance case for
/// such a row must key on the declared model rather than assert the behaviour unconditionally.
#[derive(Clone, Debug)]
pub struct ScopeCapabilities {
    /// Which persistence classes the scope can honour. A resource whose class is not honoured
    /// cannot be hosted. `Intrinsic` is universal and never appears here.
    pub storage_classes: Vec<StorageClass>,
    /// Whether the scope mints revisions, scope-wide.
    pub revision_model: RevisionModel,
    /// Whether a retired id is permanently spent, scope-wide.
    pub id_model: IdModel,
}

impl ScopeCapabilities {
    /// True when the pair is legal: `Versioned` REQUIRES `Permanent`.
    pub fn is_consistent(&self) -> bool {
        !(self.revision_model == RevisionModel::Versioned && self.id_model == IdModel::Reusable)
    }
}

/// unpinned (`rev = None`). Empty for now (presence is the signal); may grow (e.g. which ops
/// relax) without breaking advertisers.
#[derive(Clone, Debug, Default)]
pub struct UnversionedCaps {}

// =============================================================================
// §9  Errors
// =============================================================================

#[derive(Clone, Debug)]
pub enum BdpError {
    NotFound(ResourceId),
    Erased { id: ResourceId, at: Rev },
    /// `create` with fail-if-exists hit an existing id. An EXISTENCE conflict, NOT a declared Types
    /// constraint — so it carries its OWN code, never `constraint-violation` (Lydia §71). Distinct
    /// from `RevisionMismatch` (optimistic concurrency) and from a declared uniqueness constraint.
    /// Wire: 409 `already-exists`.
    AlreadyExists(ResourceId),
    RevisionMismatch { id: ResourceId, expected: Rev, found: Option<Rev> },
    Conflict(ConstraintViolation),
    Unprocessable(String),
    /// The op IS advertised, but this request exceeds that capability's advertised limits — a
    /// REJECTION the client fixes by adjusting the request (a batch past `max_batch`, a `List`
    /// condition kind not advertised, a selector when `selector:false`, …). Distinct from
    /// `not_implemented` (absent — the op isn't advertised) and `Unprocessable` (malformed, not
    /// over-bound). Donna-ruled; wire = HTTP 422, problem code `limit-exceeded` (see
    /// `bdp-protocol/LIMIT-EXCEEDED.md`). `capability`/`limit` name the bound, e.g. "apply"/"maxWrites".
    LimitExceeded { capability: String, limit: String, detail: String },
    CursorExpired(Cursor),
    Backend(String),
}

#[derive(Clone, Debug)]
pub enum ConstraintViolation {
    Uniqueness { fromprop: String, to: ResourceId },
    Cycle { family: String, from: ResourceId, to: ResourceId },
    Cardinality { fromprop: String, detail: String },
}

// =============================================================================
// §10  BdpScope — the one trait. `get` required; every other primitive defaults to
//      not-implemented. `self` IS an opened scope. Methods return `BdpResult<T>` directly.
// =============================================================================

pub trait BdpScope: Send + Sync {
    /// The supported ops, each with its limits. Presence = supported (`get` always present).
    fn capabilities(&self) -> Vec<PrimitiveCapabilities>;

    /// The scope's own traits. REQUIRED and stated outright — a client cannot infer them, and a
    /// conformance case for a trait-dependent fault has nothing to key on without them.
    fn scope_capabilities(&self) -> ScopeCapabilities;

    // ---- MANDATORY ----
    async fn get(&self, r: &ResourceId, selector: Option<&Selector>)
        -> Result<BdpResult<Representation>, BdpError>;

    // ---- OPTIONAL reads ----
    async fn resolve(&self, _refs: &[ResourceId], _selector: Option<&Selector>)
        -> Result<BdpResult<Vec<ResolvedRepresentation>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    async fn list(&self, _filter: &ListFilter, _page: Page)
        -> Result<BdpResult<Vec<ResourceId>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// resolve_alias — the `aliases` capability (resource-model.md §65). Resolve a scope-unique
    /// alias NAME to the STORED target ref, honoring the stored ref's own pinning (pinned →
    /// `target@rev`, unpinned → latest). Storage is alias-as-bead (kind `alias`, `{name, target}`)
    /// via the normal writes; THIS is only the read side. The floor is untouched — `get` stays a
    /// pure ref→representation primitive and get-by-alias is NOT adopted. Default (not advertised) ⇒
    /// callers use the universal above-trait fallback: `list` for kind=alias with name==N, then `get`.
    async fn resolve_alias(&self, _name: &str)
        -> Result<BdpResult<ResourceId>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// changes — the scope's changefeed (`/sys/changes`). Dedicated; namespace routing is ABOVE.
    async fn changes(&self, _page: Page, _filter: Option<&ListFilter>, _selector: Option<&Selector>)
        -> Result<BdpResult<Vec<ChangeEvent>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// pull — a general channel (already-resolved ref); its events are the channel's own type.
    async fn pull(&self, _channel: &ResourceId, _page: Page, _filter: Option<&ListFilter>, _selector: Option<&Selector>)
        -> Result<BdpResult<Vec<RawJson>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// export — bulk read as a stream of `ExportRecord`s (`revisions` = full-history backup).
    async fn export(&self, _filter: &ListFilter, _selector: Option<&Selector>, _revisions: bool, _page: Page)
        -> Result<BdpResult<Vec<ExportRecord>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// `revisions` — the history of ONE resource. Id-targeted like `get`, list-shaped like `list`.
    ///
    /// WHETHER HISTORY EXISTS AT ALL IS A SCOPE TRAIT, not a property of the resource: store-wide
    /// guarantee 4 says *"whether revisions are kept is the scope's `revisionModel`, not a
    /// per-resource field"*, and guarantee 6 says *"prior revisions addressable; offered or not,
    /// **discoverable**"*. So a caller reads [`ScopeCapabilities::revision_model`] to know what to
    /// expect here, and an `unversioned` scope answering `not_implemented` is conformant rather
    /// than deficient — under that model no revision is ever minted, so the guarantee is vacuous
    /// rather than violated.
    ///
    /// NO `410` IS DECLARED, and that absence is load-bearing. `revisions` declares `[400, 404]`
    /// only, while `get` declares `410`. A retired resource therefore cannot be answered Gone here
    /// — and guarantee 14 keeps the id accounted for, which rules out `404` as well. The remaining
    /// possibility is the one the spec intends: **a retired resource still yields its history.**
    /// That is derived from the declared fault set, not chosen.
    async fn revisions(&self, _resource: &ResourceId, _selector: Option<&Selector>, _page: Page)
        -> Result<BdpResult<Vec<Representation>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    // ---- OPTIONAL writes / state mutation ----
    /// create — first revision; `id = None` => the scope allocates the id.
    async fn create(&self, _id: Option<Id>, _body: CreateBody)
        -> Result<BdpResult<ResourceId>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// put — client-known-id upsert / idempotent FULL-STATE write.
    async fn put(&self, _target: ResourceId, _body: CreateBody, _guards: Guards)
        -> Result<BdpResult<ResourceId>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// patch — new revision via a JSON Patch DELTA over /properties + /metadata.
    async fn patch(&self, _target: ResourceId, _patch: JsonPatch, _if_rev: Option<Rev>)
        -> Result<BdpResult<ResourceId>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// delete — tombstone revision; idempotent.
    async fn delete(&self, _target: ResourceId, _if_rev: Option<Rev>)
        -> Result<BdpResult<ResourceId>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// apply — one ATOMIC write-set, one transaction (log-append + edge re-derive + acyclicity
    /// check + changefeed advance). `batch` is sugar over this.
    async fn apply(&self, _writes: &[Write])
        -> Result<BdpResult<Vec<ResourceId>>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// import — the bulk WRITE path; replays a stream of `ExportRecord`s per `strategy`.
    async fn import(&self, _records: &[ExportRecord], _strategy: ImportStrategy)
        -> Result<BdpResult<ImportReport>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    // ---- OPTIONAL query / invoke ----
    async fn evaluate(&self, _expr: Expr<'_>)
        -> Result<BdpResult<Value>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// call — invoke an Operation bead. Sync -> `Reply`; async -> an `AsyncResult` ref.
    async fn call(&self, _operation: &ResourceId, _request: Request)
        -> Result<BdpResult<CallOutcome>, BdpError> {
        Ok(BdpResult::not_implemented())
    }
}
