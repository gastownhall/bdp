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

/// The async disposition a caller asks `call` for.
///
/// THE SPEC DECLARES THIS DISPOSITION TWICE and gives no precedence rule between them:
/// `Request.async: bool = false` is a member of the request BODY, while `call`'s
/// `openapi.params` declares `mode = { in = "query", schema = "\"sync\" | \"async\"" }` on the
/// REQUEST LINE. Core's own `call` prose then speaks only of the query form — *"`?mode=async`
/// returns 202 + the AsyncResult at Location"*.
///
/// So this parameter exists to give the trait ONE source of truth. The binding carries the
/// disposition on the request line, which is the form the generated wire surface declares and the
/// one the prose uses, and the server does NOT read the body's `async` member. Honouring both
/// would need a rule for the case where they disagree, and the spec does not give one — so this is
/// flagged rather than settled, and the alternative reading (the body member is authoritative and
/// `mode` is its projection) stays live.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum CallMode {
    /// The default (`Request.async = false`, `?mode=sync`): the call settles before responding.
    #[default]
    Sync,
    /// `?mode=async`: the scope mints an `AsyncResult` and answers 202 with it at `Location`.
    Async,
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
    /// The `push` side of a channel. Separate from [`PullCaps`] because a channel's DIRECTION makes
    /// the two independent: a `source` advertises pull and not push, a `sink` the reverse, and only
    /// a `duplex` both. One combined record could not express a scope that offers one and not the
    /// other.
    Push(PushCaps),
    Export(ExportCaps),
    Create(CreateCaps),
    Put(PutCaps),
    Patch(PatchCaps),
    Delete(DeleteCaps),
    Apply(ApplyCaps),
    Import(ImportCaps),
    Evaluate(EvaluateCaps),
    Call(CallCaps),
    /// `cancel` — the scope can kill a running `AsyncResult` (§2.3). ADVERTISED SEPARATELY FROM
    /// `Call`: §3.3 indexes `call` and `cancel` as two primitives, each "present iff advertised",
    /// so a scope that mints async handles it cannot kill is a legal (if unhelpful) scope and a
    /// scope offering `cancel` without async `call` could not be described at all if the two
    /// shared one flag.
    Cancel(CancelCaps),
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

/// `push`'s limit record — core.lumen#PushCaps, field for field.
///
/// THE TWO BOUNDS ARE NOT THE SAME KIND OF THING and a case must not conflate them. `max_batch`
/// exceeded is the HARD rejection: `limit-exceeded` (422), fixed by shrinking the request. `window`
/// exceeded is SOFT backpressure, which rc2 states is "not an error" — it rides the ack as
/// `credit: 0` and a `Deferred` tail, and the pusher re-offers. A binding that answered 422 for a
/// full window would turn normal flow into a fault.
#[derive(Clone, Debug, Default)]
pub struct PushCaps {
    /// The most events accepted in one batch, when capped. Exceeding it is `limit-exceeded` (422).
    pub max_batch: Option<u64>,
    /// The admission window — how many events the channel takes before backpressure, when bounded.
    /// Exceeding it is NOT an error.
    pub window: Option<u64>,
}

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

/// `cancel`'s limits — EMPTY, and the emptiness is read off the declaration rather than deferred.
///
/// `cancel`'s whole parameter list is `asyncResult: unpinned<AsyncResult>`: no guard (D.3 carries
/// the three write guards on `put`/`patch`/`delete` only), no `mode`, no selector, no paging. There
/// is no optional sub-capability for a scope to half-offer, so presence in `capabilities()` is the
/// entire statement — the same shape as `Unversioned`. It may grow if the declaration does.
#[derive(Clone, Debug, Default)]
pub struct CancelCaps {}

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
    /// A MALFORMED payload — a body that does not parse, or a patch document that does not apply.
    /// NOT a well-formed request the scope declines: that is [`BdpError::InvalidParameter`].
    ///
    /// Wire: 400 `malformed-request`. It was 422 `unprocessable` until the RC3 fault-vocabulary
    /// pass, and that was wrong twice over. `unprocessable` is not in D.9's problem-code
    /// vocabulary (core.lumen:2117-2123) — so the code was out of vocabulary whatever the status —
    /// and D.8's 422 line now states the membership test outright (core.lumen:2103-2106): a fault
    /// belongs at 422 "IFF shrinking the request fixes it". No smaller body parses, so a malformed
    /// payload is not 422. D.8's 400 line (core.lumen:2071) carries it: "`malformed-request` /
    /// `invalid-parameter` — a malformed or invalid request."
    Unprocessable(String),
    /// A WELL-FORMED request the scope declines because the capability it exercises is advertised
    /// `false`, or is not honoured at the granularity the request used. No smaller request
    /// succeeds — dropping the parameter is not shrinking it — so this is NOT `LimitExceeded`.
    ///
    /// Wire: 400 `invalid-parameter`. Grounded in D.8's 422 membership test (core.lumen:2103-2106,
    /// "a fault belongs at 422 IFF shrinking the request fixes it") and in the spec's own worked
    /// case for this exact shape (core.lumen:1457): "A scope advertising `selector: false` faults a
    /// `select` request `400` (`invalid-parameter`): the capability is advertised, so a client reads
    /// it and omits `select` rather than being refused."
    ///
    /// Distinct from `not_implemented` (the op is not advertised at all — D.8's 405 line now
    /// declines an un-offered primitive there, never 501) and from `Unprocessable` (malformed).
    /// `capability` names the advertised flag the client can read, e.g. "pull"/"selector".
    InvalidParameter { capability: String, detail: String },
    /// The op IS advertised, and this request exceeds a NUMERIC bound that capability advertises —
    /// a batch past `maxBatch`, a push past `window`. THE MEMBERSHIP TEST IS SHRINKABILITY, and
    /// D.8 states it outright (core.lumen:2103-2106): a fault belongs at 422 "IFF shrinking the
    /// request fixes it; a well-formed body that is simply unusable … is 400, not 422".
    ///
    /// So an advertised-`false` capability does NOT belong here, however much it reads like a
    /// bound: there is no smaller request that would succeed. Those cases are
    /// [`BdpError::InvalidParameter`] (400). This variant kept its 422 for the cases that pass the
    /// test; in Core `push`/`maxBatch` is the only faulting numeric bound.
    ///
    /// Wire: 422 `limit-exceeded`. `capability`/`limit` name the bound, e.g. "push"/"maxBatch".
    LimitExceeded { capability: String, limit: String, detail: String },
    CursorExpired(Cursor),
    /// `pull` against a channel whose declared direction is `sink` — core.lumen#pull: "Valid on a
    /// `source`/`duplex` channel; a `sink`-only channel faults `channel-not-pullable`."
    ///
    /// WIRE = 405, and the spec names the code. D.8 grounds the status: "405 pull / push on the
    /// wrong channel direction; patch where a Scope offers no patch". It is NOT 422: the direction
    /// is a property of the CHANNEL, not an advertised bound of the operation, so there is no
    /// smaller request that would succeed — which is the test `limit-exceeded` is for.
    ChannelNotPullable { channel: ResourceId, direction: String },
    /// `push` against a channel whose declared direction is `source`. The mirror of
    /// [`BdpError::ChannelNotPullable`]; code `channel-not-pushable`.
    ChannelNotPushable { channel: ResourceId, direction: String },
    /// `push` to a TERMINAL (closed or failed) channel.
    ///
    /// THE STATUS IS DERIVED, NOT CITED, and that distinction is worth keeping because the rest of
    /// this enum is cited. core.lumen#push says only "A terminal (closed/failed) channel faults" —
    /// no status, no problem code. `push` declares `[405, 409, 422]`; 405 is the direction fault and
    /// 422 is the `maxBatch` bound, both named outright, so a terminal channel can only be the 409.
    /// D.8's 409 line leaves room for it ("also some Problems") without naming it.
    ///
    /// The CODE is my own naming for the same reason, and it is not `constraint-violation`:
    /// [`ConstraintViolation`] models uniqueness, cycles and cardinality — properties of
    /// relationships — and a closed channel is none of those. Reusing it would file a channel's
    /// lifecycle under the Types vocabulary.
    ///
    /// Same shape as [`BdpError::AlreadySettled`], which is derived from `cancel`'s declared set by
    /// the same elimination, and labelled as derived there too.
    ChannelClosed { channel: ResourceId },
    /// `cancel` was aimed at an `AsyncResult` that is ALREADY SETTLED — its `reply` is present.
    ///
    /// DERIVED from the declared fault set, not chosen. `cancel` declares `[404, 409]`; 404 is
    /// grounded in D.8 as *"get of an absent resource"*, and this target demonstrably exists. What
    /// remains is 409, and `Outcome`'s normative line supplies the condition: *"A present `outcome`
    /// means the invocation is settled, whichever arm it holds; a transient state (running/waiting)
    /// is NOT an arm."* `cancel` acts on a *running* handle, so a settled one is a state conflict.
    ///
    /// D.8 HAS a 409 entry — unlike 400, 406 and 422, which have none anywhere — but it does not
    /// name THIS producer. The status is grounded; the producer is derived. Kept as its own variant
    /// rather than folded into `Conflict`, per Lydia §71: `Conflict` is the declared-Types
    /// constraint family and an existence/state conflict carries its own code.
    ///
    /// Wire: 409 `already-settled`. **D.9 names no code for this conflict** — the nearest entries
    /// (`precondition-failed`, `identity-taken`) are bound to other statuses and other producers —
    /// so the code is coined here and the gate keys on the STATUS, which is what the surface
    /// declares.
    AlreadySettled { id: ResourceId },
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

/// One offered event — core.lumen#PushEvent.
#[derive(Clone, Debug)]
pub struct PushEvent {
    /// The pusher-assigned position, for a KEYED (idempotent) append; absent, the channel assigns
    /// one. rc2: append is idempotent on `(channel, ordinal)` and a keyed event is first-write-wins
    /// and immutable, so a re-push of that ordinal is "a benign no-op success, reported `Deduped`,
    /// never a fault".
    pub ordinal: Option<u64>,
    pub body: RawJson,
}

/// The fate of ONE offered event — core.lumen#PushResult.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PushResult {
    /// Appended at this ordinal.
    Accepted(u64),
    /// Already present at this ordinal — an idempotent re-push, and a SUCCESS.
    Deduped(u64),
    /// Not accepted on this call (backpressure); the pusher re-offers after `retry_after`.
    Deferred,
}

/// What `push` returns — core.lumen#PushAck.
///
/// A SHORT `results` WITH `credit: 0` IS NORMAL FLOW, not an error. The ack is where backpressure
/// lives, which is what makes `push` non-blocking: the channel takes a prefix, defers the rest, and
/// the pusher re-offers from `accepted_through + 1`.
#[derive(Clone, Debug)]
pub struct PushAck {
    /// The high-water ordinal durably appended by this call.
    pub accepted_through: u64,
    /// Per offered event, IN ORDER.
    pub results: Vec<PushResult>,
    /// How many more events the channel will take right now; `0` means hold and retry.
    pub credit: u64,
    /// Seconds to wait before re-offering the deferred tail (maps to HTTP `Retry-After`).
    pub retry_after: Option<u64>,
}

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

    /// push — append events to a channel (core.lumen#push).
    ///
    /// Takes the batch BY VALUE from the caller, exactly as rc2 makes `import` caller-driven: the
    /// pusher owns the pump, the channel initiates nothing, and no stream or cursor reference is
    /// handed to the scope to drain.
    async fn push(&self, _channel: &ResourceId, _events: &[PushEvent])
        -> Result<BdpResult<PushAck>, BdpError> {
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

    /// call — invoke an Operation bead. `CallMode::Sync` -> a settled `Reply`; `CallMode::Async`
    /// -> a minted `AsyncResult` ref the caller settles (or `cancel`s) later.
    ///
    /// `mode` IS A PARAMETER RATHER THAN A BODY MEMBER on purpose — see [`CallMode`] for which of
    /// the spec's two declarations of the disposition this binding follows and why the other
    /// reading is still live.
    ///
    /// A scope that does not advertise `CallCaps { async_supported: true }` MUST REFUSE
    /// `CallMode::Async` rather than quietly settle synchronously: the caller asked for a handle it
    /// could later `cancel`, and a 200 would tell it the call is done while it believes it holds a
    /// running operation. *"An optional feature is never half-present"* (§3.3).
    async fn call(&self, _operation: &ResourceId, _request: Request, _mode: CallMode)
        -> Result<BdpResult<CallOutcome>, BdpError> {
        Ok(BdpResult::not_implemented())
    }

    /// `cancel` — kill -9 on a RUNNING `AsyncResult`: write `reply.outcome = canceled`.
    ///
    /// Signature read straight off the declaration,
    /// `command cancel(asyncResult: unpinned<AsyncResult>) -> pinned<AsyncResult>`:
    ///
    /// * **The target is `unpinned`, so there is NO guard parameter — and that is why no `412` is
    ///   declared.** D.3 lists three write guards and gives them to `put`/`patch`/`delete`; all
    ///   three of those declare `412` and `cancel` does not. The absence of the parameter and the
    ///   absence of the fault agree, which is what makes this a derivation rather than a guess. A
    ///   caller that supplies a PINNED handle must therefore be REFUSED, never silently honoured as
    ///   if it were a precondition — accepting a guard and not enforcing it is the lost-update
    ///   defect [`Guards`] exists to document.
    /// * **It returns `pinned`**, so the answer is the ref at the revision the cancel minted. A
    ///   caller holds proof of which revision carries the `canceled` outcome.
    ///
    /// `cancel` IS NOT IDEMPOTENT, unlike `delete`. A second cancel faults
    /// [`BdpError::AlreadySettled`], because `Outcome`'s normative line says a present `outcome`
    /// means settled *"whichever arm it holds"* — which deliberately refuses to privilege one arm,
    /// so "already `canceled`" is not a distinguishable state from "already failed". Reading it as
    /// idempotent would invent the distinction the spec flattens.
    ///
    /// It runs NO COMPENSATION (that is the scheduler's graceful path) and the cancelled work's
    /// effects stay findable via `causedBy`, so a scope must not try to undo them here.
    async fn cancel(&self, _async_result: ResourceId)
        -> Result<BdpResult<ResourceId>, BdpError> {
        Ok(BdpResult::not_implemented())
    }
}
