//! In-memory BDP scope — the **EPHEMERAL** substrate (volatile, local, never durable).
//!
//! The fifth backend. It mirrors postgres's event-sourced SEMANTICS entirely in RAM: an
//! append-only revision `log` is the source of truth, `by_id` indexes the head/revisions per
//! resource, a transaction (`apply`) is an atomic log-append, and the changefeed IS the log tailed
//! by a cursor. The win: no docker/external deps — tests are instant.
//!
//! **Storage class = EPHEMERAL.** The cleanroom's trait models only Durable; this backend is the
//! first Ephemeral one. v1 ships as a fully *versioned* scope (full history kept in RAM, so
//! pinned-rev `get`, a revision-bearing changefeed and history export mirror pg) — ephemerality is
//! a non-surfaced *instance* property (a restart loses everything). Whether a scope should DECLARE
//! its storage class through the trait is an open question routed to Lydia (see inmem-DESIGN-NOTE).
//!
//! **Concurrency.** `BdpScope` methods take `&self`, so state lives behind a `RwLock<Store>`. There
//! are no real async await points (pure RAM): every method does its work inside a synchronous lock
//! scope and drops the guard before returning (never held across an `.await` — there are none), so
//! the futures stay `Send`. Reads take a read guard; `create`/`put`/`patch`/`delete`/`apply` take
//! ONE write guard for the whole write-set. `apply` is atomic: it records the log length and each
//! touched resource's prior index entry, mutates real state incrementally (so later writes in the
//! set see earlier ones — pg's in-transaction visibility), and on any error truncates the log and
//! restores the touched entries → all-or-nothing, O(touched) rollback.
//!
//! **Wired (non-ref core):** get/resolve, create/put/patch/delete/apply, list/changes,
//! export/import. **Deferred until Donna pins the ref encoding:** edge derivation, acyclicity on
//! write, walk (the ref-dependent graph bit). Until then `Apply{acyclicity:false}` is advertised
//! and `walk` is not exposed. Ref detection, when it lands, is isolated in one function.

use std::collections::HashMap;
use std::sync::RwLock;

use bdp_primitives::*;
use bytes::Bytes;
use uuid::Uuid;

/// One revision in the append-only log — the runtime form of a `resources` row. `op == "delete"`
/// is a tombstone (no properties/metadata/type). `created_at` is the resource's first-seen
/// creation instant, carried across updates; `committed_at` is this revision's commit instant.
#[derive(Clone, Debug)]
struct Row {
    ordinal: u64,
    scope: String,
    id: String,
    rev: String,
    kind: String,
    type_scope: Option<String>,
    type_id: Option<String>,
    properties: Option<String>,
    metadata: Option<String>,
    op: String,
    prev_rev: Option<String>,
    transaction: String,
    created_at: String,
    committed_at: String,
}

/// The in-RAM store. `log` is the global append-only revision log (ordinal = index + 1) and is the
/// changefeed; `by_id` maps (scope, id) to that resource's revision positions in `log`, ascending
/// (so the head is the last one, and a pinned-rev read scans the id's few revisions).
#[derive(Clone, Default)]
struct Store {
    log: Vec<Row>,
    by_id: HashMap<(String, String), Vec<usize>>,
    /// Per-channel event streams, keyed `(scope, channel id)`.
    ///
    /// A SEPARATE LOG FROM `log`, and core.lumen says why in as many words: "A Channel bead's
    /// revision does NOT change when events arrive — the bead is not the stream. Appended events
    /// ride the channel's own stream, never the changefeed." Putting events in `log` would mint a
    /// revision per event on the channel resource and leak them into `/sys/changes`, which is the
    /// one thing that sentence forbids.
    channels: HashMap<(String, String), ChannelLog>,
}

/// A channel's declared facts, read from its bead.
struct ChannelDescriptor {
    direction: String,
    /// The lowest ordinal still resumable; a cursor below it faults `cursor-expired`.
    floor: u64,
    /// Terminal (closed/failed).
    closed: bool,
}

/// One channel's stream: its events by ordinal.
#[derive(Clone, Default)]
struct ChannelLog {
    /// `(ordinal, body)`, append-only and ordinal-ascending.
    ///
    /// EVENTS ARE NOT DROPPED when the retention floor rises. Retention governs what a READER may
    /// resume from, and discarding the events behind it would make the floor unobservable: a case
    /// could not then tell "expired cursor" from "nothing was ever there".
    events: Vec<(u64, String)>,
}

impl Store {
    /// The head (latest) row for (scope, id), if any.
    fn head(&self, scope: &str, id: &str) -> Option<&Row> {
        self.by_id
            .get(&(scope.to_string(), id.to_string()))
            .and_then(|v| v.last())
            .map(|&pos| &self.log[pos])
    }

    /// The row for a specific pinned rev of (scope, id), if any.
    fn at_rev(&self, scope: &str, id: &str, rev: &str) -> Option<&Row> {
        self.by_id
            .get(&(scope.to_string(), id.to_string()))
            .and_then(|v| v.iter().rev().map(|&pos| &self.log[pos]).find(|r| r.rev == rev))
    }

    /// Append one revision row, updating the `by_id` index.
    fn append(&mut self, row: Row) {
        let key = (row.scope.clone(), row.id.clone());
        let pos = self.log.len();
        self.log.push(row);
        self.by_id.entry(key).or_default().push(pos);
    }
}

/// The bead `kind` a minted `AsyncResult` carries. `cancel`'s parameter is a TYPED ref
/// (`unpinned<AsyncResult>`), so a target of any other kind does not resolve as a handle — which
/// is what makes a note's id a 404 here rather than a 409.
const ASYNC_RESULT_KIND: &str = "asyncResult";

/// An opened, in-memory BDP scope, bound to one scope name (like `PgScope`). Cheap to construct;
/// `Default` gives a scope named `"inmem"`.
pub struct InMemScope {
    store: RwLock<Store>,
    scope_name: String,
    /// NARROW THE ADVERTISEMENT, never the behaviour. A scope constructed with
    /// [`InMemScope::restricted`] advertises `ifMatch`, `ifAbsent` and `clientProposedId` as
    /// FALSE while implementing exactly what it did before.
    ///
    /// WHY THE REFERENCE NEEDS THIS AT ALL. Three declared fault rows -- `create/422`, `put/422`,
    /// `patch/422` -- are the enforce side of a capability dual, and a subject that advertises
    /// every guard as supported can never produce one: there is nothing for it to refuse. The
    /// rows were not uncovered for want of a case; they were unreachable against a permissive
    /// subject, which is a property of the SUBJECT and not of the suite.
    ///
    /// Narrowing the advertisement rather than removing the implementation is what keeps the pair
    /// honest: the restricted scope still HONORS a guard it is handed directly, so a case proving
    /// the binding refuses one is proving the binding read the capability record, not that the
    /// store lost a feature.
    restricted_guards: bool,
}

impl Default for InMemScope {
    fn default() -> Self {
        Self::new("inmem")
    }
}

/// Per-SCOPE storage class (Lydia §78) — DISCOVERY METADATA, not a capability. Durability is a fact
/// about the scope (what a hybrid-query/cache planner consumes to tell an ephemeral cache from a
/// durable source), so it rides in discovery, distinct from the per-BEAD `storageClass` on `Bead`.
/// The local placeholder this used to define is RETIRED: `StorageClass` now lives in
/// `bdp-primitives` alongside `ScopeCapabilities`, which is the "trait/discovery surfacing" its
/// comment was waiting for. The value below is the one it said that surface would read.

impl InMemScope {
    pub fn new(scope_name: impl Into<String>) -> Self {
        Self {
            store: RwLock::new(Store::default()),
            scope_name: scope_name.into(),
            restricted_guards: false,
        }
    }

    /// The same store, advertising `ifMatch: false`, `ifAbsent: false` and
    /// `clientProposedId: false`. See [`InMemScope::restricted_guards`].
    pub fn restricted(scope_name: impl Into<String>) -> Self {
        Self { restricted_guards: true, ..Self::new(scope_name) }
    }

    /// This scope's storage class — `Ephemeral` (volatile, local, not a durable source). The
    /// inherent accessor that feeds discovery (Lydia §78); nothing about the versioned core changes.
    pub fn storage_class(&self) -> StorageClass {
        StorageClass::Ephemeral
    }

    /// A channel's declared descriptor — `direction` and its retention floor — read from the
    /// channel RESOURCE's body.
    ///
    /// THE DESCRIPTOR IS THE BEAD, not scope configuration, which is what core.lumen#Channel means
    /// by `Channel is Bead`: "A channel-descriptor bead body — its two event schemas, direction,
    /// and delivery characteristics. Its resource is `rep<Channel>`." So a test declares a channel
    /// by CREATING one, and `pull`/`push` read what it declared. Holding direction in scope state
    /// instead would let the two disagree with the resource a client can read.
    ///
    /// SIMPLIFIED IN ONE PLACE, and said so rather than implied: the spec's `retention: Retention`
    /// is modelled here as an optional `retentionFloor` ordinal, which is the only part of
    /// retention `pull` has an observable obligation about (a cursor below it faults). The schemas
    /// (`pushSchema`/`pullSchema`) are not modelled: this store validates no event payloads, so
    /// carrying them would be declaring a check that does not exist.
    fn channel_descriptor(&self, channel: &ResourceId) -> Result<ChannelDescriptor, BdpError> {
        let store = self.store.read().unwrap();
        let scope = self.scope_str(&channel.scope);
        let row = store
            .head(&scope, channel.id.0.as_ref())
            .ok_or_else(|| BdpError::NotFound(channel.clone()))?;
        if row.op == "delete" {
            return Err(BdpError::Erased {
                id: channel.clone(),
                at: Rev(row.rev.clone().into()),
            });
        }
        let body: serde_json::Value = row
            .properties
            .as_deref()
            .and_then(|p| serde_json::from_str(p).ok())
            .unwrap_or(serde_json::Value::Null);
        // A resource that declares no direction is not a channel. `405` would claim it is a channel
        // facing the wrong way; `404` says there is no channel here, which is what is true.
        let direction = body
            .get("direction")
            .and_then(|d| d.as_str())
            .ok_or_else(|| BdpError::NotFound(channel.clone()))?
            .to_string();
        let floor = body.get("retentionFloor").and_then(|f| f.as_u64()).unwrap_or(0);
        // TERMINAL STATE IS DECLARED ON THE BEAD TOO, for the same reason as direction and for one
        // more: a `closed` flag on the in-memory event log would be set by NOTHING, since this
        // store has no close operation — a branch no request can reach, which reads as implemented
        // while being dead. Reading it from the descriptor makes the state something a client can
        // both set (by writing the channel) and observe (by reading it).
        let closed = body.get("closed").and_then(|c| c.as_bool()).unwrap_or(false);
        Ok(ChannelDescriptor { direction, floor, closed })
    }

    fn scope_str(&self, s: &Scope) -> String {
        match s {
            Scope::This => self.scope_name.clone(),
            Scope::Web => "WEB".to_string(),
            Scope::Named(n) => n.0.to_string(),
        }
    }

    /// Mint the `AsyncResult` bead a `?mode=async` call is accepted as.
    ///
    /// Members written are exactly `AsyncResult`'s declared ones. Two are worth stating:
    ///
    /// * `cause` and `callId` are STRINGS (`type Cause is string`, `type CallId is string`) and sit
    ///   at TOP LEVEL rather than inside `reply`, because the type keeps them there *"(queryable
    ///   while pending, before `reply`)"*. `cancel` reads them back and carries them into the Reply
    ///   it writes, which is what makes the settlement correlatable to the call.
    /// * `reply` is ABSENT, which is what "pending" means — *"the settlement, once it arrives
    ///   (absent while pending)"*, and `Outcome`'s normative line is explicit that a transient
    ///   state is NOT an arm, so there is no `running` outcome to write instead.
    ///
    /// **This store has no scheduler, so a minted handle stays pending forever.** That is what
    /// makes it cancellable at all, and it is also the limit of what this subject can reach: the
    /// race `cancel`'s 409 is really about — the operation settling on its own just before the
    /// cancel lands — needs something that settles, and nothing here does. The 409 is reached
    /// instead by cancelling twice, which is the same *state* (`reply` present) by a different road.
    ///
    /// `replyChannel: ref<Channel>` is required, so it is written — refs do not have to resolve
    /// locally, and this one does not: it names an INTRINSIC per-call stream this store never
    /// materializes. It is given an id derived from the handle's own (ids are free, slash-bearing
    /// strings per D.1, so this invents no noun root), and that derivation is **this subject's own
    /// naming with no spec basis** — flagged rather than dressed up. Nothing can observe it here:
    /// `pull` is not offered, so there is no primitive that would read the channel. The ref
    /// ENCODING (bare `{"id": …}`) is likewise the unpinned one the rest of this store uses.
    fn mint_async_result(
        &self,
        operation: &ResourceId,
        request: &Request,
    ) -> Result<ResourceId, BdpError> {
        let id = Uuid::new_v4().to_string();
        // `request: Request` is "the original request" — stored verbatim, as an opaque value. A
        // body that is not JSON would make the bead unstorable, so it is refused here rather than
        // written as a string that later readers would have to guess at.
        let request_json: serde_json::Value = serde_json::from_slice(request.0 .0.as_ref())
            .map_err(|e| BdpError::Unprocessable(format!("call request is not json: {e}")))?;
        let properties = serde_json::json!({
            "operation":    { "id": operation.id.0.to_string() },
            "cause":        format!("inmem-cause-{}", Uuid::new_v4()),
            "callId":       format!("inmem-call-{}", Uuid::new_v4()),
            "request":      request_json,
            "replyChannel": { "id": format!("{id}/reply") },
        });
        self.commit(&[Write::Create {
            id: Some(Id(id.into())),
            body: CreateBody {
                kind: Kind(ASYNC_RESULT_KIND.into()),
                r#type: ResourceId::head(Scope::This, Id("BeadType:asyncResult".into())),
                properties: RawJson(Bytes::from(serde_json::to_vec(&properties).unwrap())),
                metadata: RawJson(Bytes::from_static(b"{}")),
            },
        }])
        .map(|mut v| v.pop().expect("one write, one ref"))
    }

    /// The `apply` boundary: a single exclusive write guard over the whole write-set with
    /// all-or-nothing rollback. Single writes go through here as a one-element set.
    fn commit(&self, writes: &[Write]) -> Result<Vec<ResourceId>, BdpError> {
        // Read the DECLARED id model rather than assuming one. Retirement semantics are
        // model-dependent — under `permanent` a retired id is spent, under `reusable` it is free —
        // so a write path that hard-coded either would be behaving on an undeclared basis, which
        // is the defect `delete_then_erased` was built on.
        let id_model = self.scope_capabilities().id_model;
        let txn = Uuid::new_v4().to_string();
        let mut store = self.store.write().unwrap();

        let log_rollback = store.log.len();
        // first time a (scope,id) is touched, remember its prior index vec so we can restore it.
        let mut touched: HashMap<(String, String), Option<Vec<usize>>> = HashMap::new();
        let mut out = Vec::with_capacity(writes.len());

        for w in writes {
            // record the pre-state of the key this write targets (before any mutation).
            let key = write_key(self, w);
            touched.entry(key.clone()).or_insert_with(|| store.by_id.get(&key).cloned());

            match apply_one(&mut store, &self.scope_name, w, &txn, id_model) {
                Ok(r) => out.push(r),
                Err(e) => {
                    // roll back: truncate the log and restore every touched index entry.
                    store.log.truncate(log_rollback);
                    for (k, prior) in touched {
                        match prior {
                            Some(v) => {
                                store.by_id.insert(k, v);
                            }
                            None => {
                                store.by_id.remove(&k);
                            }
                        }
                    }
                    return Err(e);
                }
            }
        }
        Ok(out)
    }
}

/// The (scope, id) a write targets — used to snapshot pre-state for rollback. A `Create` with no id
/// allocates a fresh uuid at apply time, so it can't collide and needs no snapshot; we key it on the
/// (fresh, unused) empty id, which `apply_one` will not touch under that key.
fn write_key(scope: &InMemScope, w: &Write) -> (String, String) {
    match w {
        Write::Create { id, .. } => (
            scope.scope_name.clone(),
            id.clone().map(|i| i.0.to_string()).unwrap_or_default(),
        ),
        Write::Put { target, .. }
        | Write::Patch { target, .. }
        | Write::Delete { target, .. } => (scope.scope_str(&target.scope), target.id.0.to_string()),
    }
}

/// Apply one write to the store in place (mutating real state so later writes in the same set see
/// it — pg's in-transaction visibility). Any `Err` leaves `commit` to roll the whole set back.
fn apply_one(
    store: &mut Store,
    scope_name: &str,
    w: &Write,
    txn: &str,
    id_model: IdModel,
) -> Result<ResourceId, BdpError> {
    match w {
        Write::Create { id, body } => {
            let scope = scope_name.to_string();
            let id_s = id.clone().map(|i| i.0.to_string()).unwrap_or_else(|| Uuid::new_v4().to_string());
            // a client-proposed id that already exists is an EXISTENCE conflict (409); a generated
            // uuid is fresh and can't collide.
            if id.is_some() && store.head(&scope, &id_s).is_some() {
                return Err(BdpError::AlreadyExists(ResourceId::head(
                    Scope::Named(ScopeName(scope.into())),
                    Id(id_s.into()),
                )));
            }
            let rev = Uuid::new_v4().to_string();
            let now = now_rfc3339();
            let (ts, ti) = ref_parts(&body.r#type);
            store.append(Row {
                ordinal: (store.log.len() + 1) as u64,
                scope: scope.clone(),
                id: id_s.clone(),
                rev: rev.clone(),
                kind: body.kind.0.to_string(),
                type_scope: ts,
                type_id: ti,
                properties: Some(json_str(&body.properties)),
                metadata: Some(json_str(&body.metadata)),
                op: "create".into(),
                prev_rev: None,
                transaction: txn.into(),
                created_at: now.clone(),
                committed_at: now,
            });
            Ok(ResourceId::pinned(Scope::Named(ScopeName(scope.into())), Id(id_s.into()), Rev(rev.into())))
        }
        Write::Put { target, body, guards } => {
            let scope = scope_str_of(scope_name, &target.scope);
            let id_s = target.id.0.to_string();
            let head = store.head(&scope, &id_s).cloned();

            // HONOUR THE GUARDS BEFORE MINTING ANYTHING. `put` previously accepted none, so an
            // `If-Match` was silently ignored and the write proceeded against a stale revision
            // while reporting success — a lost-update vector the client could not detect from the
            // result. A guard that is accepted and not enforced is worse than one that is refused.
            //
            // `ifRevision`: a stale value makes NO change and faults 412. A guard against a head
            // that does not exist cannot be satisfied, so that faults too.
            if let Some(want) = &guards.if_revision {
                let found = head.as_ref().map(|h| Rev(h.rev.clone().into()));
                let matches = found.as_ref().map(|f| f.0.as_ref() == want.0.as_ref()).unwrap_or(false);
                if !matches {
                    return Err(BdpError::RevisionMismatch {
                        id: target.clone(),
                        expected: want.clone(),
                        found,
                    });
                }
            }
            // `ifAbsent`: the write applies only if nothing is there. A live resource OR a
            // tombstone both count as present — a tombstoned id is spent, not free, so claiming it
            // is the same fault as a `create` collision. That keeps ONE id-taken handler on the
            // client for the whole claiming path.
            if guards.if_absent && head.is_some() {
                return Err(BdpError::AlreadyExists(target.clone()));
            }

            // DELETION IS TERMINAL under `permanent`: a bare `put` TARGETS the retired resource,
            // so it faults `410 Gone` and MUST NOT resurrect it. This arm used to classify a
            // tombstone head as a fresh "create", which revived a spent identity — the subject
            // contradicting a merged normative rule, not merely leaving a row uncovered.
            //
            // The CLAIMING path is already handled above and is a different fault: a `put` under
            // `ifAbsent` asserts the id is free, so a spent id is `identity-taken` (409). Rooting
            // cannot discriminate the two, since every `put` is id-rooted — the guard is what does.
            //
            // Under `reusable` a retired id IS free, so the same write legitimately creates. Hence
            // the branch on the declared model rather than one hard-coded answer.
            if let Some(h) = head.as_ref().filter(|h| h.op == "delete") {
                if id_model == IdModel::Permanent {
                    return Err(BdpError::Erased {
                        id: target.clone(),
                        at: Rev(h.rev.clone().into()),
                    });
                }
            }
            // A NO-CHANGE FULL-STATE WRITE IS A NO-OP. Computed before the revision is minted,
            // because minting one is exactly what must not happen. A tombstone head is excluded:
            // that path either faulted above (`permanent`) or legitimately creates (`reusable`).
            let kind_s = body.kind.0.to_string();
            let (ts, ti) = ref_parts(&body.r#type);
            let props_s = json_str(&body.properties);
            let meta_s = json_str(&body.metadata);
            if let Some(h) = head.as_ref().filter(|h| h.op != "delete") {
                if unchanged_from(h, &kind_s, &ts, &ti, &props_s, &meta_s) {
                    return Ok(ResourceId::pinned(
                        target.scope.clone(),
                        target.id.clone(),
                        Rev(h.rev.clone().into()),
                    ));
                }
            }
            let (op, prev, created_at) = match &head {
                None => ("create", None, now_rfc3339()),
                // Reachable only under `reusable`, where a retired id is free to mint again.
                Some(h) if h.op == "delete" => ("create", None, now_rfc3339()),
                Some(h) => ("update", Some(h.rev.clone()), h.created_at.clone()),
            };
            let rev = Uuid::new_v4().to_string();
            store.append(Row {
                ordinal: (store.log.len() + 1) as u64,
                scope,
                id: id_s,
                rev: rev.clone(),
                kind: kind_s,
                type_scope: ts,
                type_id: ti,
                properties: Some(props_s),
                metadata: Some(meta_s),
                op: op.into(),
                prev_rev: prev,
                transaction: txn.into(),
                created_at,
                committed_at: now_rfc3339(),
            });
            Ok(ResourceId::pinned(target.scope.clone(), target.id.clone(), Rev(rev.into())))
        }
        Write::Delete { target, if_rev } => {
            let scope = scope_str_of(scope_name, &target.scope);
            let id_s = target.id.0.to_string();
            let head = store.head(&scope, &id_s).cloned();

            // A NO-CHANGE DELETE MINTS NOTHING. `delete` is idempotent on an EXISTING resource, not
            // total (core.lumen, `delete`): deleting an id that NEVER existed faults `404` and MUST
            // NOT mint a tombstone, while deleting an already-retired resource is the idempotent case
            // and returns the SAME tombstone `Rev` without faulting — which is why `delete` alone
            // among the writes declares no `410`.
            //
            // Minting here retired an identity that was never admitted, and that is not cosmetic:
            // the id is then spent forever by normative rule ("a deleted resource's id stays
            // accounted for … and the id is never reused"), so under `idModel: permanent` ANY caller
            // able to call `delete` could permanently deny any unused id in the space — `create`
            // there faults identity-taken for all time. It also made the declared `404` unreachable,
            // and let a read answer `410 erased` for something that never existed.
            //
            // Found against this subject, confirmed live in the reference backends and fixed there
            // too. Verified red-then-green: with this block removed, `delete_never_existed_404` and
            // `delete_then_erased_needs_its_seed` both fail.
            if head.is_none() {
                return Err(BdpError::NotFound(target.clone()));
            }
            if let (Some(want), Some(h)) = (if_rev, &head) {
                if want.0.as_ref() != h.rev {
                    return Err(BdpError::RevisionMismatch {
                        id: target.clone(),
                        expected: want.clone(),
                        found: Some(Rev(h.rev.clone().into())),
                    });
                }
            }
            // Already retired — the idempotent case. Report the revision it is retired AT, so a
            // retry is identical to the first call and no second tombstone (or change row) appears.
            if let Some(h) = head.as_ref().filter(|h| h.op == "delete") {
                return Ok(ResourceId::pinned(
                    target.scope.clone(),
                    target.id.clone(),
                    Rev(h.rev.clone().into()),
                ));
            }
            let rev = Uuid::new_v4().to_string();
            let prev = head.as_ref().map(|h| h.rev.clone());
            let kind = head.as_ref().map(|h| h.kind.clone()).unwrap_or_default();
            let created_at = head.as_ref().map(|h| h.created_at.clone()).unwrap_or_else(now_rfc3339);
            store.append(Row {
                ordinal: (store.log.len() + 1) as u64,
                scope,
                id: id_s,
                rev: rev.clone(),
                kind,
                type_scope: None,
                type_id: None,
                properties: None,
                metadata: None,
                op: "delete".into(),
                prev_rev: prev,
                transaction: txn.into(),
                created_at,
                committed_at: now_rfc3339(),
            });
            // (tombstone would drop the holder's edges — deferred with the graph increment.)
            Ok(ResourceId::pinned(target.scope.clone(), target.id.clone(), Rev(rev.into())))
        }
        Write::Patch { target, patch, if_rev } => {
            let scope = scope_str_of(scope_name, &target.scope);
            let id_s = target.id.0.to_string();
            let head = store.head(&scope, &id_s).cloned().ok_or_else(|| BdpError::NotFound(target.clone()))?;
            if head.op == "delete" {
                return Err(BdpError::Erased { id: target.clone(), at: Rev(head.rev.into()) });
            }
            if let Some(want) = if_rev {
                if want.0.as_ref() != head.rev {
                    return Err(BdpError::RevisionMismatch {
                        id: target.clone(),
                        expected: want.clone(),
                        found: Some(Rev(head.rev.clone().into())),
                    });
                }
            }
            // apply the RFC 6902 delta over a {properties, metadata} doc — the SAME shared applier
            // pg/fs/dolt use, so patch semantics can't diverge by backend.
            let cur_props = head.properties.clone().unwrap_or_else(|| "{}".into());
            let cur_meta = head.metadata.clone().unwrap_or_else(|| "{}".into());
            let props_v: serde_json::Value = serde_json::from_str(&cur_props)
                .map_err(|e| BdpError::Unprocessable(format!("patch: current properties not json: {e}")))?;
            let meta_v: serde_json::Value = serde_json::from_str(&cur_meta)
                .map_err(|e| BdpError::Unprocessable(format!("patch: current metadata not json: {e}")))?;
            // ROOT-ADDRESSED OVER THE REP, per core.lumen#patch: "JSON Patch over the resource
            // representation, ROOT-addressed (`/body/…`, `/metadata/…`, `/type`, `/authority`)".
            // This document was `{ properties, metadata }`, so the spec's own documented paths
            // FAILED (`replace /body/status` -> "target does not exist") while an unknown path
            // silently succeeded. The member is `body`.
            let mut doc = serde_json::json!({ "body": props_v, "metadata": meta_v });
            let patch_v: serde_json::Value = serde_json::from_slice(patch.0 .0.as_ref())
                .map_err(|e| BdpError::Unprocessable(format!("patch: patch document not json: {e}")))?;
            bdp_jsonpatch::apply_patch(&mut doc, &patch_v).map_err(BdpError::Unprocessable)?;
            let props_s = serde_json::to_string(doc.get("body").unwrap_or(&serde_json::Value::Null))
                .map_err(|e| BdpError::Unprocessable(e.to_string()))?;
            let meta_s = serde_json::to_string(doc.get("metadata").unwrap_or(&serde_json::Value::Null))
                .map_err(|e| BdpError::Unprocessable(e.to_string()))?;

            // THE SAME RULE, and reached by a different route: a delta can be well-formed and
            // still leave the document identical (`replace` with the value already there, `add` of
            // an existing member). kind and type carry over, so the comparison is really over the
            // patched body and metadata.
            if unchanged_from(&head, &head.kind, &head.type_scope, &head.type_id, &props_s, &meta_s) {
                return Ok(ResourceId::pinned(
                    target.scope.clone(),
                    target.id.clone(),
                    Rev(head.rev.clone().into()),
                ));
            }
            let rev = Uuid::new_v4().to_string();
            store.append(Row {
                ordinal: (store.log.len() + 1) as u64,
                scope,
                id: id_s,
                rev: rev.clone(),
                kind: head.kind.clone(), // kind/type carry over (patch is a props+metadata delta)
                type_scope: head.type_scope.clone(),
                type_id: head.type_id.clone(),
                properties: Some(props_s),
                metadata: Some(meta_s),
                op: "update".into(),
                prev_rev: Some(head.rev.clone()),
                transaction: txn.into(),
                created_at: head.created_at.clone(),
                committed_at: now_rfc3339(),
            });
            Ok(ResourceId::pinned(target.scope.clone(), target.id.clone(), Rev(rev.into())))
        }
    }
}

// ---- helpers (shared with pg's conventions) -------------------------------------------------

fn scope_str_of(scope_name: &str, s: &Scope) -> String {
    match s {
        Scope::This => scope_name.to_string(),
        Scope::Web => "WEB".to_string(),
        Scope::Named(n) => n.0.to_string(),
    }
}

/// A write whose RESULT equals the head is a NO-OP: it keeps the revision, appends no row, and so
/// records no provenance and produces no event.
///
/// Two obligations say this, and they say it of ALL writes, not of `put`: "a full-state write that
/// changes nothing succeeds, keeps the revision, records no provenance, and produces no event; the
/// reply carries no `transaction`", and "one commit produces exactly one event per resource
/// changed ... a failed request and a no-change request produce no resource event".
///
/// ONE RULE, SO ONE HELPER. `put` and `patch` differ in how they COMPUTE the new content and not at
/// all in what a no-change outcome means, so mirroring the check into both arms would let the two
/// drift apart. The store appended unconditionally before this, so every idempotent re-write minted
/// a fresh revision AND published a changefeed event for a change that did not happen.
///
/// COMPARED AS PARSED JSON, NEVER AS STRINGS. `put` serializes the caller's object and `patch`
/// serializes a patched document, so two equal documents routinely differ byte-wise in key order
/// or spacing. A string compare would report "changed" for a write that changed nothing — the very
/// defect this closes — so the comparison is over `serde_json::Value`.
///
/// AN UNPARSEABLE SIDE IS TREATED AS CHANGED, not as equal. Mapping a parse failure to `Null` on
/// both sides would make two corrupt documents compare EQUAL and silently swallow a write.
fn unchanged_from(
    head: &Row,
    kind: &str,
    type_scope: &Option<String>,
    type_id: &Option<String>,
    properties: &str,
    metadata: &str,
) -> bool {
    fn same_json(stored: Option<&String>, incoming: &str) -> bool {
        let a = serde_json::from_str::<serde_json::Value>(stored.map(String::as_str).unwrap_or("{}"));
        let b = serde_json::from_str::<serde_json::Value>(incoming);
        match (a, b) {
            (Ok(x), Ok(y)) => x == y,
            _ => false,
        }
    }
    head.kind == kind
        && &head.type_scope == type_scope
        && &head.type_id == type_id
        && same_json(head.properties.as_ref(), properties)
        && same_json(head.metadata.as_ref(), metadata)
}

fn ref_parts(r: &ResourceId) -> (Option<String>, Option<String>) {
    let s = match &r.scope {
        Scope::This => None,
        Scope::Web => Some("WEB".to_string()),
        Scope::Named(n) => Some(n.0.to_string()),
    };
    (s, Some(r.id.0.to_string()))
}

fn scope_from_opt(s: Option<String>) -> Scope {
    match s.as_deref() {
        None => Scope::This,
        Some("WEB") => Scope::Web,
        Some(n) => Scope::Named(ScopeName(n.into())),
    }
}

fn json_str(r: &RawJson) -> String {
    if r.0.is_empty() {
        "{}".to_string()
    } else {
        String::from_utf8_lossy(&r.0).to_string()
    }
}

/// A non-delete row → a `Representation::Bead`. Shared by `get`, `changes` and `export`.
fn bead_from_row(scope: &Scope, id: &Id, row: &Row) -> Representation {
    Representation::Bead {
        id: ResourceId::pinned(scope.clone(), id.clone(), Rev(row.rev.clone().into())),
        kind: Kind(row.kind.clone().into()),
        r#type: ResourceId {
            scope: scope_from_opt(row.type_scope.clone()),
            id: Id(row.type_id.clone().unwrap_or_default().into()),
            rev: None,
        },
        created_at: Timestamp(row.created_at.clone().into()),
        properties: RawJson(Bytes::from(row.properties.clone().unwrap_or_default().into_bytes())),
        metadata: RawJson(Bytes::from(row.metadata.clone().unwrap_or_default().into_bytes())),
        provenance: provenance_of(row),
    }
}

fn provenance_of(row: &Row) -> Provenance {
    Provenance {
        principals: vec![],
        inception: if row.op == "create" { Inception::Create } else { Inception::Unknown },
        committed_at: Timestamp(row.committed_at.clone().into()),
        message: None,
        previous_revision: row.prev_rev.clone().map(|p| Rev(p.into())),
    }
}

fn one(r: ResourceId) -> BdpResult<ResourceId> {
    let rev = r.rev.clone();
    BdpResult::ok(r).with_protocol(ProtocolMeta { rev, ..Default::default() })
}

/// Current UTC time as an RFC 3339 instant (no external deps). `Timestamp` is opaque; ordering is
/// by `ordinal`, not this. Uses the days-from-civil algorithm.
fn now_rfc3339() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, m, day) = civil_from_days(days);
    format!("{y:04}-{m:02}-{day:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn civil_from_days(z0: i64) -> (i64, u32, u32) {
    let z = z0 + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

// ---- list filter evaluation (in-RAM, mirroring pg's #>> text semantics) ----------------------

/// Resolve a `FieldPath` against a row's payload and metadata. First segment selects the root
/// member; the rest walks object keys / array indices.
///
/// ROOT-ADDRESSED ON `body`, per core.lumen: "Field paths are root-addressed `FieldPath` ARRAYS
/// (`["body","status"]`, `["metadata","x"]`, `["type"]`) … the first segment selects the root
/// member (`body`/`metadata`/`type`/`authority`), consistent with root-addressed `patch`/`selector`.
/// NOT a dotted string." This keyed on `properties`, the same divergence the wire and `patch`
/// carried.
///
/// THE DEFAULT ARM IS A KNOWN RESIDUAL: a first segment that is NOT a root member falls through to
/// the payload rather than failing to resolve, so `["nonsense"]` silently addresses the body. Same
/// shape as `add /nonsense` still succeeding on `patch`, and the same open question — what a scope
/// answers for an unaddressable path is not specified, so it is recorded rather than guessed.
fn field_value(props: &serde_json::Value, meta: &serde_json::Value, field: &FieldPath) -> Option<serde_json::Value> {
    let segs = &field.0;
    let (doc, rest): (&serde_json::Value, &[String]) = match segs.first().map(String::as_str) {
        Some("metadata") => (meta, &segs[1..]),
        Some("body") => (props, &segs[1..]),
        _ => (props, &segs[..]),
    };
    let mut cur = doc;
    for s in rest {
        cur = match cur {
            serde_json::Value::Object(m) => m.get(s)?,
            serde_json::Value::Array(a) => a.get(s.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur.clone())
}

/// The text form `#>>` returns: a string field yields the unquoted string; null → None (absent);
/// anything else → its compact JSON text.
fn text_of(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

/// The RHS text of a `Compare`/condition value (mirrors pg `json_scalar_text`).
fn rhs_text(v: &RawJson) -> String {
    match serde_json::from_slice::<serde_json::Value>(&v.0) {
        Ok(serde_json::Value::String(s)) => s,
        Ok(serde_json::Value::Null) => String::new(),
        Ok(other) => other.to_string(),
        Err(_) => String::from_utf8_lossy(&v.0).to_string(),
    }
}

/// Does `row` satisfy one `ListCondition`? Mirrors pg's lowering: Compare/Matches use `#>>` text
/// comparison; Has/Missing test presence; IsType is the kind-path prefix.
///
/// BOTH refusal paths here are now `InvalidParameter` (400 `invalid-parameter`), and they are NOT
/// the same defect:
///   - an unadvertised condition KIND is a capability this scope declines by advertisement, the
///     case D.8's membership test and core.lumen:1457 settle;
///   - an unwired SUB-OPTION (`In`, `Glob`, `Regex`) is UNRULED, and TWO OF THE THREE READINGS
///     MAKE THE CARRIER BELOW WRONG. Saying that first, because it is the direction that costs
///     me: an earlier version of this note called it "a class D.8's dichotomy does not reach",
///     which framed the gap so that my own `invalid-parameter` survived it by default. It does
///     not survive by default.
///
/// D.8:2071-2083 lists THREE shapes reaching 400 — a bad body, AN INVALID PARAMETER VALUE, and a
/// write guard the operation does not define — then justifies the third: "no field exists that
/// could advertise it either way … The line is therefore drawn by the caps record, not by the
/// sentence — in an operation's vocabulary and advertised false is a decline it can state, outside
/// its vocabulary is malformed."
///
/// THE "THEREFORE" IS SCOPED TO THE GUARD CASE, which is the whole difficulty. D.8's example
/// (`If-None-Match` on `patch`) has BOTH properties at once — `PatchCaps` has no `ifAbsent` field
/// AND `ifAbsent` is not a parameter of `patch` — so it cannot discriminate "no caps field" from
/// "not in the signature", and the generalizing sentence was written where the two coincide.
/// Whether it extends to a value that is DECLARED but unadvertisable is exactly the open question.
///
/// Three readings, and only the first leaves this code as it stands:
///   (i)   shape 2, "an invalid parameter value" → `invalid-parameter`. Weakest of the three:
///         `"glob"` is not an invalid value, it is a valid one this scope cannot run.
///   (ii)  the caps-record sentence extends → no field at `op`/`using` granularity →
///         `malformed-request`. THIS MAKES THE CARRIER BELOW WRONG, and it is the reading with
///         the only NORMATIVE text behind it. Measured: `invalid-parameter` appears ZERO times in
///         ae703386's diff and twice in its commit MESSAGE, and the one code-relevant line that
///         diff does add says "declined at 400, not here" without choosing between the two 400
///         codes. So the competing naming lives in a message, not in the artefact — authority is
///         real (it is the owner's), but ae703386 deliberated the 405 boundary and named
///         `invalid-parameter` as its contrast case, never weighing a declared-but-unadvertisable
///         input. Wording reaching further than deliberation, again, and this time against me.
///   (iii) an advertised KIND binds all its declared members → supporting `"in"` is not optional,
///         so the refusal is not a fault at all but a SUBJECT GAP: implement them, or stop
///         advertising `compare`/`matches`. THIS MAKES THE CARRIER BELOW WRONG TOO, and more
///         deeply — there would be no fault to classify.
///
/// The declared text that forces the question, none of it in dispute:
///   core.lumen:1286  `compare { field, op: "eq"|"ne"|"lt"|"le"|"gt"|"ge"|"in", value }`
///   core.lumen:1288  `matches { field, pattern, using: "substring"|"glob"|"regex" }`
///   core.lumen:1726  `ConditionKind = "compare" | "matches" | ... | "isType"`
/// So `"in"`, `"glob"` and `"regex"` are DECLARED members of a DECLARED parameter of a DECLARED
/// operation, while `ListCaps.conditions: [ConditionKind]` advertises at KIND granularity only,
/// with no caps field at `op`/`using` granularity. In-vocabulary by the signature, unadvertisable
/// by the caps record — and D.8 names the caps record as the discriminator, which is why (ii) is
/// the stronger reading of the text and (i), the one this code implements, is the weaker.
///
/// A CONDITION KIND IS NOT IN THIS CLASS, and that is the line. `contains`, `containsAny` and
/// `excludes` are `ConditionKind` members that `ListCaps.conditions` CAN advertise, so refusing one
/// is a decline the scope can state — `invalid-parameter`, which is what the catch-all below emits.
/// Same record, two populations, two answers.
///
/// NOT RE-POINTED ON MY OWN DERIVATION, and that is a decision about PROCESS, not a defence of
/// (i). `invalid-parameter` stays only because moving it would answer an unruled cell by editing,
/// on a reading that is mine — the same ground on which a peer declined to re-flip 12 sites in her
/// tree on her derivation plus my message. If the ruling picks (ii) or (iii), this carrier changes. THE FIX IS
/// PROBABLY NOT A STATUS AT ALL: Lydia's stated reason for adding `ExportCaps.selector` was that
/// without it "a scope that did not project had to refuse while claiming an advertised absence it
/// had no field to advertise" — which is this class exactly, and the remedy she chose was to ADD
/// THE FIELD. A sub-option advertisement would do the same here. Carried to her as that.
fn matches_condition(
    props: &serde_json::Value,
    meta: &serde_json::Value,
    kind: &str,
    cond: &ListCondition,
) -> Result<bool, BdpError> {
    Ok(match cond {
        ListCondition::Compare { field, op, value } => {
            let lhs = field_value(props, meta, field).and_then(|v| text_of(&v));
            let lhs = match lhs {
                Some(t) => t,
                None => return Ok(false), // null LHS → SQL null → not matched
            };
            let rhs = rhs_text(value);
            match op {
                CompareOp::Eq => lhs == rhs,
                CompareOp::Ne => lhs != rhs,
                CompareOp::Lt => lhs < rhs,
                CompareOp::Le => lhs <= rhs,
                CompareOp::Gt => lhs > rhs,
                CompareOp::Ge => lhs >= rhs,
                CompareOp::In => {
                    return Err(BdpError::InvalidParameter {
                        capability: "list".into(),
                        detail: "list: `in` is not wired in this scope (see the note on \
                                 `matches_condition`: `ListCaps.conditions` advertises kinds, not \
                                 sub-options, so this refusal is not advertised anywhere)"
                            .into(),
                    })
                }
            }
        }
        ListCondition::Matches { field, pattern, using } => {
            let lhs = match field_value(props, meta, field).and_then(|v| text_of(&v)) {
                Some(t) => t,
                None => return Ok(false),
            };
            match using {
                MatchKind::Substring => lhs.to_lowercase().contains(&pattern.to_lowercase()),
                MatchKind::Regex => {
                    return Err(BdpError::InvalidParameter {
                        capability: "list".into(),
                        detail: "list: `regex` match needs a regex engine and is not wired in this \
                                 scope (unadvertisable — see `matches_condition`)"
                            .into(),
                    })
                }
                MatchKind::Glob => {
                    return Err(BdpError::InvalidParameter {
                        capability: "list".into(),
                        detail: "list: `glob` match is not wired in this scope (unadvertisable — \
                                 see `matches_condition`)"
                            .into(),
                    })
                }
            }
        }
        ListCondition::Has { field } => {
            matches!(field_value(props, meta, field).and_then(|v| text_of(&v)), Some(t) if !t.is_empty())
        }
        ListCondition::Missing { field } => field_value(props, meta, field).and_then(|v| text_of(&v)).is_none(),
        ListCondition::IsType { r#type, exact } => {
            let t = &r#type.0;
            if *exact {
                kind == t
            } else {
                kind == t || kind.starts_with(&format!("{t}/"))
            }
        }
        // A condition KIND outside the advertised set (`ListCaps.conditions`) is a WELL-FORMED
        // request exercising a capability this scope does not advertise — 400 `invalid-parameter`,
        // not 422. No smaller request succeeds: dropping the condition is not shrinking it, and
        // D.8's 422 line admits a fault "IFF shrinking the request fixes it"
        // (core.lumen:2103-2106). It is also not `not_implemented`: `list` IS offered.
        //
        // AND `list` DECLARES ONLY 400 (core.openapi.json, `list`: problem = [400]), so the old 422
        // was an undeclared fault as well as a mis-keyed one — two independent reasons, and the
        // declaration one holds whichever way the membership test had been read.
        other => {
            return Err(BdpError::InvalidParameter {
                capability: "list.conditions".into(),
                detail: format!(
                    "condition kind not in this scope's advertised `ListCaps.conditions`: {other:?}"
                ),
            })
        }
    })
}

// Note on ref detection (DEFERRED): when the graph increment lands, ref-ness is read from a bead's
// ref-properties. Per Shelly, the canonical encoding (bare `{"id":…}` vs `{"$ref":…}`) is being
// pinned by Donna, and ref-ness is moving to a declared property schema (§76 TypeDescriptor). So
// the single detection function (mirroring pg's `as_ref`, bare-`{"id"}`) is intentionally not
// written yet — it will be the one-spot change when the encoding is pinned.

impl BdpScope for InMemScope {
    fn scope_capabilities(&self) -> ScopeCapabilities {
        // Declared from what this store ACTUALLY does, not from what would be convenient.
        //
        // `Ephemeral`, NOT `Durable`, and this scope has said so all along: `storage_class()`
        // below has returned `Ephemeral` since before this surface existed — "volatile, local,
        // not a durable source". An in-memory store cannot HONOUR `Durable`, which is what
        // `storage_classes` advertises, so claiming it would be advertising a persistence
        // guarantee that a restart disproves. (I first wrote `Durable` here because the cases
        // write persistent-looking data; the subject's own accessor was the correction.)
        //
        // `Versioned`: it appends a revision row per commit. And `versioned` REQUIRES `permanent`,
        // which is also independently true — it keeps tombstones — so the pair is legal rather
        // than merely declared.
        ScopeCapabilities {
            storage_classes: vec![StorageClass::Ephemeral],
            revision_model: RevisionModel::Versioned,
            id_model: IdModel::Permanent,
        }
    }

    fn capabilities(&self) -> Vec<PrimitiveCapabilities> {
        vec![
            PrimitiveCapabilities::Get(GetCaps { selector: false }),
            PrimitiveCapabilities::Resolve(ResolveCaps { selector: false, max_batch: None }),
            PrimitiveCapabilities::Create(CreateCaps {
                // A scope that mints no id of its own would be unusable, so only the
                // caller-proposed half narrows.
                server_allocates_id: true,
                client_proposed_id: !self.restricted_guards,
            }),
            PrimitiveCapabilities::Put(PutCaps {
                if_match: !self.restricted_guards,
                if_absent: !self.restricted_guards,
            }),
            PrimitiveCapabilities::Patch(PatchCaps { if_match: !self.restricted_guards }),
            PrimitiveCapabilities::Delete(DeleteCaps { if_match: true }),
            // acyclicity DEFERRED until the ref-encoding pin (honest: advertised ⟹ implemented).
            PrimitiveCapabilities::Apply(ApplyCaps { max_writes: None, acyclicity: false }),
            // THE TWO CHANNEL SIDES ARE ADVERTISED SEPARATELY, because a channel's direction makes
            // them independent — this scope offers both and each individual channel declares which
            // of them IT admits.
            PrimitiveCapabilities::Pull(PullCaps {
                sse: false,
                jsonl: false,
                filter: false,
                selector: false,
            }),
            // SMALL BOUNDS ON PURPOSE. `max_batch: 4` is the hard bound whose breach is
            // `limit-exceeded` (422); `window: 2` is the soft admission credit, whose breach is
            // backpressure and NOT an error. Keeping them different numbers is what lets a case
            // prove the binding does not conflate them: a batch of 3 is deferred-in-part and
            // SUCCEEDS, a batch of 5 is refused.
            PrimitiveCapabilities::Push(PushCaps { max_batch: Some(4), window: Some(2) }),
            // `selector: true` IS MEASURED, NOT ASPIRATIONAL: the current-state branch of
            // `export` forwards the selector to `get`, so a projection is honoured. The revisions
            // branch ignores it — but main refuses `select` on a `--revisions` export outright
            // (400), so that is an unconditional refusal this subject still owes, not a reason to
            // advertise the flag false. Registered separately in the gate.
            PrimitiveCapabilities::Export(ExportCaps { revisions: true, selector: true }),
            PrimitiveCapabilities::Import(ImportCaps { history_restore: false }),
            PrimitiveCapabilities::Changes(ChangesCaps { sse: false, jsonl: false, filter: false, selector: false }),
            // `async_supported: true` — `?mode=async` now MINTS an `AsyncResult` and answers 202
            // with it, so the promise this flag makes is one the store keeps. It went from `false`
            // to `true` in the same change that added the minting; advertising it earlier would
            // have promised a 202 + Location nothing produced.
            PrimitiveCapabilities::Call(CallCaps { async_supported: true }),
            // `cancel` — advertised separately, because §3.3 indexes `call` and `cancel` as two
            // primitives each "present iff advertised". This store can kill a pending handle.
            PrimitiveCapabilities::Cancel(CancelCaps {}),
            PrimitiveCapabilities::List(ListCaps {
                conditions: vec![
                    ConditionKind::Compare,
                    ConditionKind::Matches,
                    ConditionKind::Has,
                    ConditionKind::Missing,
                    ConditionKind::IsType,
                ],
                selector: false,
                sort: false,
                max_limit: None,
            }),
        ]
    }

    async fn get(&self, r: &ResourceId, _selector: Option<&Selector>) -> Result<BdpResult<Representation>, BdpError> {
        let store = self.store.read().unwrap();
        let scope = self.scope_str(&r.scope);
        let id = r.id.0.to_string();
        let row = match &r.rev {
            Some(rev) => store.at_rev(&scope, &id, rev.0.as_ref()),
            None => store.head(&scope, &id),
        };
        let row = row.ok_or_else(|| BdpError::NotFound(r.clone()))?;
        if row.op == "delete" {
            return Err(BdpError::Erased { id: r.clone(), at: Rev(row.rev.clone().into()) });
        }
        let rev = row.rev.clone();
        let rep = bead_from_row(&r.scope, &r.id, row);
        Ok(BdpResult::ok(rep).with_protocol(ProtocolMeta { rev: Some(Rev(rev.into())), ..Default::default() }))
    }

    /// resolve — batch read, reusing `get`'s Present/Absent/Erased decision so it lives in one place.
    async fn resolve(&self, refs: &[ResourceId], selector: Option<&Selector>)
        -> Result<BdpResult<Vec<ResolvedRepresentation>>, BdpError> {
        let mut out = Vec::with_capacity(refs.len());
        for r in refs {
            let resolved = match self.get(r, selector).await {
                Ok(res) => match res.value {
                    Some(rep) => ResolvedRepresentation::Present(rep),
                    None => ResolvedRepresentation::Absent,
                },
                Err(BdpError::NotFound(_)) => ResolvedRepresentation::Absent,
                Err(BdpError::Erased { at, .. }) => ResolvedRepresentation::Erased(at),
                Err(e) => return Err(e),
            };
            out.push(resolved);
        }
        Ok(BdpResult::ok(out))
    }

    async fn create(&self, id: Option<Id>, body: CreateBody) -> Result<BdpResult<ResourceId>, BdpError> {
        let r = self.commit(&[Write::Create { id, body }])?.pop().unwrap();
        Ok(one(r))
    }

    async fn put(&self, target: ResourceId, body: CreateBody, guards: Guards) -> Result<BdpResult<ResourceId>, BdpError> {
        let r = self.commit(&[Write::Put { target, body, guards }])?.pop().unwrap();
        Ok(one(r))
    }

    async fn delete(&self, target: ResourceId, if_rev: Option<Rev>) -> Result<BdpResult<ResourceId>, BdpError> {
        let r = self.commit(&[Write::Delete { target, if_rev }])?.pop().unwrap();
        Ok(one(r))
    }

    async fn patch(&self, target: ResourceId, patch: JsonPatch, if_rev: Option<Rev>) -> Result<BdpResult<ResourceId>, BdpError> {
        let r = self.commit(&[Write::Patch { target, patch, if_rev }])?.pop().unwrap();
        Ok(one(r))
    }

    async fn apply(&self, writes: &[Write]) -> Result<BdpResult<Vec<ResourceId>>, BdpError> {
        let rs = self.commit(writes)?;
        Ok(BdpResult::ok(rs))
    }

    /// list — current resources in THIS scope (latest-rev-per-id, not deleted) matching a flat
    /// `ListFilter`, as pinned refs, ordered by id. Mirrors pg's current-state projection.
    async fn list(&self, filter: &ListFilter, page: Page) -> Result<BdpResult<Vec<ResourceId>>, BdpError> {
        let store = self.store.read().unwrap();
        let mut heads: Vec<&Row> = store
            .by_id
            .iter()
            .filter(|((scope, _), _)| scope == &self.scope_name)
            .filter_map(|(_, positions)| positions.last().map(|&pos| &store.log[pos]))
            .filter(|row| row.op != "delete")
            .collect();
        heads.sort_by(|a, b| a.id.cmp(&b.id));

        let mut out = Vec::new();
        for row in heads {
            let props: serde_json::Value =
                serde_json::from_str(row.properties.as_deref().unwrap_or("{}")).unwrap_or(serde_json::Value::Null);
            let meta: serde_json::Value =
                serde_json::from_str(row.metadata.as_deref().unwrap_or("{}")).unwrap_or(serde_json::Value::Null);
            let mut keep = true;
            for cond in &filter.0 {
                if !matches_condition(&props, &meta, &row.kind, cond)? {
                    keep = false;
                    break;
                }
            }
            if keep {
                out.push(ResourceId::pinned(
                    Scope::Named(ScopeName(self.scope_name.clone().into())),
                    Id(row.id.clone().into()),
                    Rev(row.rev.clone().into()),
                ));
            }
        }
        // RESUME AFTER THE CURSOR, which this read used to IGNORE. `page.after` was never looked
        // at: only `limit` was, so a caller walking the collection got PAGE ONE AGAIN, FOREVER,
        // with a 200 each time — indistinguishable from a correct first page, which is why neither
        // a test nor a grid row could see it. rc2 names exactly this: "Silently ignoring a resume
        // cursor … is NON-CONFORMANT (the silent-failure class)".
        //
        // THE CURSOR IS THE LAST ID EMITTED, and the encoding is sound because the result is
        // ordered BY ID — so the id IS the position, and no side table is needed to interpret it.
        // rc2 leaves the encoding to the scope and fixes only the semantics. Found by Shelly in the
        // sibling stores; this binding had the same defect, so applying her finding rather than
        // assuming it stopped at her tree is what caught it.
        if let Some(c) = &page.after {
            let resume_after = String::from_utf8_lossy(&c.0).into_owned();
            out.retain(|r| r.id.0.as_ref() > resume_after.as_str());
        }

        let total_after_cursor = out.len();
        if let Some(n) = page.limit {
            out.truncate(n as usize);
        }
        // `head` IS COMPUTED, NOT GUESSED. The tempting heuristic — `out.len() < limit` — is FALSE
        // on a final page that exactly fills the limit, so it would claim "more remains" at the end
        // of a walk and a caller looping on `head` would never terminate. The scope knows whether
        // anything is left; that is the authoritative signal and it is the one reported.
        let head = out.len() == total_after_cursor;
        let cursor = out.last().map(|r| Cursor(Bytes::from(r.id.0.as_ref().to_owned().into_bytes())));
        Ok(BdpResult::ok(out).with_protocol(ProtocolMeta {
            // `cursor` is null once `head`: there is nothing further to resume from, and handing
            // back a position that yields an empty page invites an endless poll.
            cursor: if head { None } else { cursor },
            head: Some(head),
            ..Default::default()
        }))
    }

    /// changes — the scope's changefeed: the append-log tailed by a cursor. Resume `after` a cursor
    /// (exclusive) XOR `from` an ordinal (inclusive); `head` = caught up to the live edge. Each log
    /// row is one committed change; create/update carry the full post-image, delete carries
    /// top-level provenance (no body). Mirrors pg.
    /// DEFECT, MEASURED AND UNFIXED: this silently DROPS a requested `filter` and `selector`.
    ///
    /// AND IT IS ONE INSTANCE OF A BIGGER ONE. I first reported this as `changes` being wrong
    /// where `pull` was right. That contrast is FALSE, and I had stated it to two peers before
    /// measuring it. The capability record is DECORATIVE in this subject: across the three
    /// selector-governed reads, NONE reads the flag it advertises. Every mention of `PullCaps`,
    /// `ExportCaps` and `ChangesCaps` in this file is a construction inside `capabilities()`
    /// (:1010, :1027, :1029) — there is no third kind of mention.
    ///
    ///   `pull`     advertises `selector: false`, refuses UNCONDITIONALLY (:1412). Right answer,
    ///              and right only because the flag happens to be `false`. Honest by accident:
    ///              set it `true` and `pull` still refuses.
    ///   `export`   advertises `selector: true`, honours UNCONDITIONALLY (:1300 forwards to
    ///              `get`). Also right only by coincidence, and the INVERSE failure — set it
    ///              `false` and `export` keeps projecting, silently, exactly as `changes` does.
    ///   `changes`  advertises `selector: false`, drops it silently. The one case where the
    ///              coincidence does not save the answer.
    ///
    /// SO THE FLAG AND THE BEHAVIOUR AGREE BY COINCIDENCE IN ALL THREE, and two of the three
    /// coincidences are currently favourable. That is a worse defect than a wrong status on one
    /// path, because it means the advertisement cannot be trusted anywhere in this subject — and
    /// it is invisible to any test that only drives the advertised value, which is every test
    /// here. It is the shape I have recorded as honest-by-accident, in the one place I would have
    /// sworn I had checked.
    ///
    /// IT ALSO WEAKENS MY OWN 8fdc9651. I advertised `ExportCaps.selector: true` and justified it
    /// as "measured, not aspirational — export forwards the selector to `get`". The forwarding is
    /// real, so the VALUE is right; but nothing derives it, so the justification was a statement
    /// about today's coincidence dressed as a statement about the code. The fix for all three is
    /// the same and it is the one #461 chose for `ExportCaps.selector`: READ THE FIELD.
    ///
    /// Not fixed here for the reason below — stopping the silence requires choosing a fault — but
    /// `export` and `pull` are fixable WITHOUT that ruling, because both already have their
    /// answer and only need to derive it from the flag instead of hardcoding it.
    ///
    /// This scope advertises `ChangesCaps { filter: false, selector: false }` (see
    /// `capabilities()`), and both parameters are `_`-prefixed and never read below. So a client
    /// that asks for a projection gets `200` with FULL representations and no error — the request
    /// was neither honoured nor refused. That is strictly worse than answering the wrong status:
    /// a wrong status is visible, and this is not.
    ///
    /// AND IT CONTRADICTS `pull` IN THIS SAME FILE. `pull` advertises `selector: false` too and
    /// faults `400 invalid-parameter` for a selector. Same advertisement, opposite behaviour, one
    /// subject — and `pull` is the one with a spec precedent behind it (core.lumen:1457).
    ///
    /// WHY IT IS RECORDED RATHER THAN FIXED, and the two halves are not equally blocked:
    ///   * THE SILENCE IS WRONG UNDER EVERY READING. Dropping a requested projection while
    ///     advertising the flag is indefensible whichever fault is correct, so this is not a
    ///     "plausible ruling makes it right" case.
    ///   * WHICH FAULT IS UNRULED. `changes` is not among the 13 declared operationIds and has no
    ///     declared fault surface, so there is no row to answer and no status the spec assigns.
    ///     Picking one is the same unruled third class as the `list` sub-options.
    /// Stopping the silence REQUIRES picking, so the fix is blocked on which fault, never on
    /// whether. CLOSES WHEN: the spec owner rules the class, or grounds `changes` as an operation.
    ///
    /// FOUND BY AUDITING A PEER'S RETRACTION rather than accepting it. She withdrew a claim about
    /// her own changefeed selector; checking whether the withdrawal held sent me to my own caps
    /// record, which I had never enumerated either. Her point generalises and this is the
    /// instance: a self-correction arrives with the credibility of having caught itself, so it
    /// gets less scrutiny than the assertion it replaces.
    async fn changes(&self, page: Page, _filter: Option<&ListFilter>, _selector: Option<&Selector>)
        -> Result<BdpResult<Vec<ChangeEvent>>, BdpError> {
        let store = self.store.read().unwrap();
        let after: u64 = match (&page.after, &page.from) {
            (Some(c), _) => std::str::from_utf8(&c.0)
                .ok()
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| BdpError::CursorExpired(c.clone()))?,
            (None, Some(o)) => o.0.saturating_sub(1),
            (None, None) => 0,
        };
        let limit = page.limit.unwrap_or(100) as usize;
        let scope_du = Scope::Named(ScopeName(self.scope_name.clone().into()));

        let mut events = Vec::new();
        let mut last_ordinal = after;
        for row in store.log.iter().filter(|r| r.scope == self.scope_name && r.ordinal > after) {
            if events.len() >= limit {
                break;
            }
            last_ordinal = row.ordinal;
            let subject = ResourceId::pinned(scope_du.clone(), Id(row.id.clone().into()), Rev(row.rev.clone().into()));
            let kind_k = Kind(row.kind.clone().into());
            let op = match row.op.as_str() {
                "create" => ChangeOp::Create,
                "delete" => ChangeOp::Delete,
                _ => ChangeOp::Update,
            };
            let (content, top_prov) = if op == ChangeOp::Delete {
                (None, Some(provenance_of(row))) // tombstone: provenance rides top-level
            } else {
                (Some(ChangeContent::Full { representation: bead_from_row(&scope_du, &Id(row.id.clone().into()), row) }), None)
            };
            events.push(ChangeEvent {
                ordinal: Ordinal(row.ordinal),
                at: Timestamp(row.committed_at.clone().into()),
                subject,
                subject_kind: Some(kind_k),
                op,
                content,
                transaction: Transaction(row.transaction.clone().into()),
                cause: None,
                caused_by: None,
                provenance: top_prov,
            });
        }
        // `head`: did we reach the live edge? true unless we stopped on the limit with more pending.
        let more = store
            .log
            .iter()
            .any(|r| r.scope == self.scope_name && r.ordinal > last_ordinal);
        let head = !more;
        let cursor = Cursor(Bytes::from(last_ordinal.to_string()));
        Ok(BdpResult::ok(events).with_protocol(ProtocolMeta { cursor: Some(cursor), head: Some(head), ..Default::default() }))
    }

    /// export — a self-describing stream: Begin(cursor) · Record(Representation)* · End(count).
    /// `revisions=false` emits each current representation; `revisions=true` emits every non-tombstone
    /// revision oldest-first. Mirrors pg. (EPHEMERAL "never exported" reading routed to Lydia; here
    /// export = a RAM snapshot, useful to seed a cache / hybrid substrate.)
    async fn export(&self, filter: &ListFilter, selector: Option<&Selector>, revisions: bool, page: Page)
        -> Result<BdpResult<Vec<ExportRecord>>, BdpError> {
        let cur_ord = {
            let store = self.store.read().unwrap();
            store.log.iter().filter(|r| r.scope == self.scope_name).map(|r| r.ordinal).max().unwrap_or(0)
        };
        let mut out = vec![ExportRecord::Begin(ExportBegin {
            cursor: Cursor(Bytes::from(cur_ord.to_string().into_bytes())),
        })];
        let ids = self.list(filter, page).await?.value.unwrap_or_default();
        let scope_du = Scope::Named(ScopeName(self.scope_name.clone().into()));
        let mut count = 0u64;
        for rid in &ids {
            if revisions {
                let store = self.store.read().unwrap();
                if let Some(positions) = store.by_id.get(&(self.scope_name.clone(), rid.id.0.to_string())) {
                    for &pos in positions {
                        let row = &store.log[pos];
                        if row.op == "delete" {
                            continue;
                        }
                        out.push(ExportRecord::Record(bead_from_row(&scope_du, &rid.id, row)));
                        count += 1;
                    }
                }
            } else {
                let rep = self.get(rid, selector).await?.value.expect("get yields a representation");
                out.push(ExportRecord::Record(rep));
                count += 1;
            }
        }
        out.push(ExportRecord::End(ExportEnd { count }));
        Ok(BdpResult::ok(out))
    }

    /// import — replay a record stream into THIS scope. `SetCurrent` writes each record as current
    /// state in one atomic apply (a revision-stream collapses to its final state, minting fresh
    /// history). `HistoryRestore` isn't wired (advertised `history_restore: false`). Mirrors pg.
    async fn import(&self, records: &[ExportRecord], strategy: ImportStrategy)
        -> Result<BdpResult<ImportReport>, BdpError> {
        match strategy {
            ImportStrategy::SetCurrent => {
                let mut writes = Vec::new();
                for rec in records {
                    if let ExportRecord::Record(Representation::Bead { id, kind, r#type, properties, metadata, .. }) = rec {
                        let target = ResourceId::head(
                            Scope::Named(ScopeName(self.scope_name.clone().into())),
                            id.id.clone(),
                        );
                        writes.push(Write::Put {
                            // An import replays stored state; it asserts no precondition.
                            guards: Guards::default(),
                            target,
                            body: CreateBody {
                                kind: kind.clone(),
                                r#type: r#type.clone(),
                                properties: properties.clone(),
                                metadata: metadata.clone(),
                            },
                        });
                    }
                }
                let imported = writes.len() as u64;
                self.commit(&writes)?;
                let report = format!(r#"{{"strategy":"set-current","imported":{imported}}}"#);
                Ok(BdpResult::ok(ImportReport(RawJson(Bytes::from(report.into_bytes())))))
            }
            // THE CAPABILITY DUAL, not an absent op — and 400, not 422.
            //
            // `not_implemented` was the wrong signal and it mattered on the wire: 501 says the OP
            // is absent, and `import` is present and advertised. A client told 501 concludes the
            // scope cannot import at all, when in fact it imports and declines exactly one mode.
            // That reasoning stands unchanged.
            //
            // THE STATUS, HOWEVER, WAS WRONG, and this comment used to carry the citation that
            // made it look right: `CoreCapabilities` (core.lumen:1646) says "Each limit record is
            // the advertise side of a dual: the matching `limit-exceeded` (422) is the enforce
            // side." Read at the width of the record that covers a BOOLEAN field too, which is how
            // this site read it. It does not survive the rest of the spec:
            //
            //   - core.lumen:1552 (`import`'s own normative line) scopes `limit-exceeded` to "a
            //     request that exceeds a static capability bound, fixed by shrinking the request";
            //   - core.lumen:688 says the same for `push`;
            //   - D.8:2103-2106 states the membership test outright — 422 "IFF shrinking the
            //     request fixes it";
            //   - core.lumen:1457 works this exact shape the other way: a capability advertised
            //     `false` faults `400` (`invalid-parameter`).
            //
            // `historyRestore` is a bool. No smaller stream imports under it, so it fails the test
            // four normative lines state and the one description-level parenthetical does not
            // reach. :1646's "(422)" predates the test (it landed at GAP-4) and is reported as a
            // stale parenthetical, not treated as a competing ruling.
            //
            // NOTE WHAT THIS COSTS: `op/import/fault/422` goes back to having no producer here.
            // That is the spec's to undeclare (a 0.2.4 task), not this subject's to keep reachable
            // by emitting a status the spec's own test excludes.
            ImportStrategy::HistoryRestore => Err(BdpError::InvalidParameter {
                capability: "import.historyRestore".into(),
                detail: "this scope advertises `historyRestore: false`; replay the stream as \
                         set-current, or import into a scope that rebuilds revision chains"
                    .into(),
            }),
        }
    }

    /// call — invoke an Operation bead.
    ///
    /// This store has no execution engine of its own, so it offers a CLOSED, declared set of
    /// built-in implementations and an Operation bead selects one by name. That set is the
    /// SUBJECT's own business: no spec row depends on what an operation computes, only on the
    /// dispatch rule and on the `Outcome` the call settles into. Two built-ins are enough to
    /// reach both arms the binding projects to a status.
    ///
    /// The dispatch rule (core.lumen, `## call`) decides what may be returned here:
    ///
    ///   PRE-dispatch failure  -> a bare `Problem`, NO `Outcome`. The operation never ran.
    ///   POST-dispatch failure -> rides the `Outcome` (`Result.failure`, `fault`, `canceled`).
    ///
    /// So an unresolvable `operation` is an `Err` (a Problem) and a *declared* failure is an
    /// `Ok` carrying a settled `Outcome`. Collapsing the two would erase the only distinction
    /// that says whether the operation ran.
    /// pull — read a channel's events (core.lumen#pull).
    async fn pull(&self, channel: &ResourceId, page: Page, _filter: Option<&ListFilter>, selector: Option<&Selector>)
        -> Result<BdpResult<Vec<RawJson>>, BdpError> {
        let d = self.channel_descriptor(channel)?;
        let (direction, floor) = (d.direction, d.floor);
        // DIRECTION FIRST, before the cursor is even parsed. A `sink` has no readable stream at
        // all, so a malformed cursor on one is not the interesting fault.
        if direction == "sink" {
            return Err(BdpError::ChannelNotPullable { channel: channel.clone(), direction });
        }
        // 400, and this is the case the spec itself works: core.lumen:1457 rules `select` under
        // `ExportCaps.selector: false` a `400` (`invalid-parameter`) — "the capability is
        // advertised, so a client reads it and omits `select` rather than being refused" — and
        // says selector support is advertised per-op, `pull` among them. The exact parallel.
        //
        // `pull` DECLARES [400, 404, 405, 410] and no 422 at all (core.openapi.json), so the old
        // mapping was an undeclared fault independently of the membership test.
        if selector.is_some() {
            return Err(BdpError::InvalidParameter {
                capability: "pull.selector".into(),
                detail: "this scope advertises `selector: false` on pull".into(),
            });
        }

        let after: u64 = match (&page.after, &page.from) {
            (Some(c), _) => String::from_utf8_lossy(&c.0)
                .parse()
                .map_err(|_| BdpError::CursorExpired(c.clone()))?,
            (None, Some(Ordinal(o))) => o.saturating_sub(1),
            _ => 0,
        };

        // BELOW THE RETENTION FLOOR. Resuming "after N" delivers N+1 onwards, so the cursor is
        // valid exactly when `N + 1 >= floor` — off-by-one in the other direction would expire a
        // cursor that names the last event BEFORE the floor, which is the oldest legal resume
        // point rather than an illegal one.
        if after + 1 < floor {
            return Err(BdpError::CursorExpired(
                page.after.clone().unwrap_or_else(|| Cursor(Bytes::from(after.to_string()))),
            ));
        }

        let store = self.store.read().unwrap();
        let key = (self.scope_str(&channel.scope), channel.id.0.to_string());
        let limit = page.limit.unwrap_or(u32::MAX) as usize;
        let out = store
            .channels
            .get(&key)
            .map(|log| {
                log.events
                    .iter()
                    .filter(|(o, _)| *o > after)
                    .take(limit)
                    .map(|(_, body)| RawJson(Bytes::from(body.clone().into_bytes())))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        // THE WINDOW'S OWN POSITION, so a reader can resume without tracking ordinals itself. The
        // cursor is the last ordinal delivered, in the same decimal encoding `after` parses, and
        // `head` is whether anything remains beyond it — computed from the log, never from whether
        // the window filled.
        let last_delivered = after + out.len() as u64;
        let remaining = store
            .channels
            .get(&key)
            .map(|log| log.events.iter().any(|(o, _)| *o > last_delivered))
            .unwrap_or(false);
        Ok(BdpResult::ok(out).with_protocol(ProtocolMeta {
            cursor: if remaining { Some(Cursor(Bytes::from(last_delivered.to_string()))) } else { None },
            head: Some(!remaining),
            ..Default::default()
        }))
    }

    /// push — append events to a channel (core.lumen#push).
    async fn push(&self, channel: &ResourceId, events: &[PushEvent])
        -> Result<BdpResult<PushAck>, BdpError> {
        let d = self.channel_descriptor(channel)?;
        let direction = d.direction;
        if direction == "source" {
            return Err(BdpError::ChannelNotPushable { channel: channel.clone(), direction });
        }

        // READ OFF THIS SCOPE'S OWN ADVERTISEMENT rather than hard-coded, so narrowing the
        // capability record narrows the behaviour with it and the two cannot drift.
        let (max_batch, window) = BdpScope::capabilities(self)
            .into_iter()
            .find_map(|c| match c {
                PrimitiveCapabilities::Push(pc) => Some((pc.max_batch, pc.window)),
                _ => None,
            })
            .unwrap_or((None, None));

        // THE HARD BOUND, and it is checked BEFORE anything is appended: `limit-exceeded` means
        // the request is refused whole, so a partial append would make the fault a lie.
        if let Some(mb) = max_batch {
            if events.len() as u64 > mb {
                return Err(BdpError::LimitExceeded {
                    capability: "push".into(),
                    limit: "maxBatch".into(),
                    detail: format!("this channel accepts at most {mb} events per batch; offered {}", events.len()),
                });
            }
        }

        let mut store = self.store.write().unwrap();
        let key = (self.scope_str(&channel.scope), channel.id.0.to_string());
        if d.closed {
            return Err(BdpError::ChannelClosed { channel: channel.clone() });
        }
        let log = store.channels.entry(key).or_default();

        let mut high = log.events.last().map(|(o, _)| *o).unwrap_or(0);
        let mut taken: u64 = 0;
        let mut results = Vec::with_capacity(events.len());
        for ev in events {
            // THE SOFT BOUND. Once the admission window is full the REST is deferred, and that is
            // a success: rc2 is explicit that backpressure "is soft and temporal, not an error".
            if window.is_some_and(|w| taken >= w) {
                results.push(PushResult::Deferred);
                continue;
            }
            let body = String::from_utf8_lossy(ev.body.0.as_ref()).into_owned();
            match ev.ordinal {
                // KEYED AND ALREADY PRESENT: first-write-wins and immutable, so this is a benign
                // no-op reported `Deduped` and NEVER a fault — and it does not consume credit,
                // because nothing was admitted.
                Some(o) if log.events.iter().any(|(x, _)| *x == o) => results.push(PushResult::Deduped(o)),
                Some(o) => {
                    log.events.push((o, body));
                    high = high.max(o);
                    taken += 1;
                    results.push(PushResult::Accepted(o));
                }
                None => {
                    let o = high + 1;
                    log.events.push((o, body));
                    high = o;
                    taken += 1;
                    results.push(PushResult::Accepted(o));
                }
            }
        }
        log.events.sort_by_key(|(o, _)| *o);

        let deferred = results.iter().any(|r| matches!(r, PushResult::Deferred));
        Ok(BdpResult::ok(PushAck {
            accepted_through: high,
            results,
            // `credit: 0` is the hold signal and must accompany a deferred tail, or the pusher
            // re-offers immediately into the same full window.
            credit: if deferred { 0 } else { window.unwrap_or(0) },
            retry_after: if deferred { Some(1) } else { None },
        }))
    }

    async fn call(&self, operation: &ResourceId, request: Request, mode: CallMode)
        -> Result<BdpResult<CallOutcome>, BdpError> {
        // --- PRE-dispatch: resolve the operation. Faults as a Problem, no Outcome.
        let implementation = {
            let store = self.store.read().unwrap();
            let scope = self.scope_str(&operation.scope);
            let id = operation.id.0.to_string();
            let row = match &operation.rev {
                Some(rev) => store.at_rev(&scope, &id, rev.0.as_ref()),
                None => store.head(&scope, &id),
            };
            let row = row.ok_or_else(|| BdpError::NotFound(operation.clone()))?;
            if row.op == "delete" {
                return Err(BdpError::Erased { id: operation.clone(), at: Rev(row.rev.clone().into()) });
            }
            builtin_of(row.properties.as_deref())
        };

        // Still pre-dispatch: a resource that resolves but names no built-in this store has is
        // an unresolvable operation, not a failed one. Same Problem channel, still no Outcome.
        let Some(builtin) = implementation else {
            return Err(BdpError::NotFound(operation.clone()));
        };

        // --- ASYNC: mint the handle INSTEAD of settling. Resolution above still happened first,
        // because the dispatch rule's PRE-dispatch channel does not depend on the mode: an
        // unresolvable `operation` faults as a bare Problem whether or not async was asked for.
        // Nothing is recorded for a call that could not run, async included.
        if mode == CallMode::Async {
            let _ = builtin; // resolved, deliberately NOT run — that is what "async" means here.
            let handle = self.mint_async_result(operation, &request)?;
            return Ok(one_outcome(handle));
        }

        // --- POST-dispatch: the operation ran, so whatever happened rides the Outcome.
        //
        // `Outcome` lowers INTERNALLY TAGGED — `kind` is explicit in the body precisely so a
        // reader never infers the arm from the HTTP status. The status is the binding's
        // projection of this `kind`, not a second source of truth, so it is not computed here.
        let outcome = match builtin {
            Builtin::Echo => {
                let args = json_str(&RawJson(request.0 .0.clone()));
                format!(r#"{{"kind":"success","value":{args}}}"#)
            }
            // An operation's own "no" — the ONE declared failure in the protocol. `error` is the
            // operation's declared `E`, NOT a Problem: a Problem here would claim the operation
            // could not run when in fact it ran and said no.
            Builtin::AlwaysRefuses => {
                r#"{"kind":"failure","error":{"code":"refused","detail":"this operation always refuses"}}"#
                    .to_string()
            }
        };
        let reply = format!(
            // `cause` and `callId` are REQUIRED members of `Reply`; `transaction` and `metadata`
            // are optional and omitted rather than sent empty.
            //
            // Both are STRINGS, not objects: `type Cause is string` and `type CallId is string`.
            // This used to emit `{{"id":"inmem-cause"}}`, which no declaration supports — caught
            // while choosing the encoding for the same two members on a minted `AsyncResult`,
            // where they are top-level precisely so they stay queryable while `reply` is absent.
            r#"{{"outcome":{outcome},"cause":"inmem-cause","callId":"inmem-call"}}"#
        );
        Ok(BdpResult::ok(CallOutcome::Reply(Reply(RawJson(Bytes::from(reply.into_bytes()))))))
    }

    /// `cancel` — write `reply.outcome = canceled` onto a RUNNING `AsyncResult`.
    ///
    /// Every branch below is read off `cancel`'s declaration — `command cancel(asyncResult:
    /// unpinned<AsyncResult>) -> pinned<AsyncResult>` with `problem = { status = [404, 409] }` —
    /// rather than chosen:
    ///
    /// * **absent id → `404`.** D.8: *"404 get of an absent resource"*. The one declared fault with
    ///   a producer named outright.
    /// * **resolves, but is not an `AsyncResult` → `404`.** The parameter is a TYPED ref, so a note
    ///   is not a handle that failed, it is a handle that does not resolve. Same reading `call`
    ///   already takes for `ref<Operation>`: *"a resource that resolves but names no built-in this
    ///   store has is an unresolvable operation, not a failed one"* — same Problem channel, and 404
    ///   is declared.
    /// * **already settled → `409`.** See [`BdpError::AlreadySettled`]: derived from the declared
    ///   set plus `Outcome`'s *"a present `outcome` means the invocation is settled, whichever arm
    ///   it holds"*, not from a producer D.8 names.
    /// * **a PINNED handle → refused.** The declared parameter is `unpinned`, and `cancel` declares
    ///   no `412` while every guard-carrying primitive does. Honouring a pin would invent a
    ///   precondition the declaration excludes; ignoring one would be the lost-update defect. Over
    ///   HTTP this is unreachable — the route carries an id and `cancel` reads no `If-Match`, so
    ///   there is no pin channel to carry — which is why no row, declared or otherwise, covers it.
    ///
    /// **A RETIRED handle faults `410`, which `cancel` does NOT declare.** Under the declared
    /// `permanent` id model a write targeting a retired id is Gone, and a cancel is a write; D.8's
    /// catch-all permits it (*"4xx/5xx — any fault — the body is the Problem, carried at the
    /// Problem's own status"*). But `put` declares `410` for exactly this situation and `cancel`
    /// does not, so either the declaration is short a row or a retired handle is meant to answer
    /// something else. **Flagged, not resolved** — and no case asserts it either way.
    ///
    /// NO COMPENSATION runs: that is the scheduler's graceful path. The cancelled work's effects
    /// stay findable via `causedBy`, so undoing them here would be wrong even where it were possible.
    async fn cancel(&self, async_result: ResourceId) -> Result<BdpResult<ResourceId>, BdpError> {
        if async_result.rev.is_some() {
            // A pinned handle is an INVALID PARAMETER, not a malformed body: the request parses
            // and the argument is simply one the declared signature forbids. Moved off
            // `Unprocessable` with the rest, because that variant now means "did not parse".
            //
            // STILL UNDECLARED AT ANY STATUS, and that is the point of saying so here: `cancel`
            // declares [404, 409] — neither 400 nor 422 — so this refusal has no declared row to
            // land on whichever code it carries. The declaration question above is unchanged by
            // this move; 400 is the least-wrong carrier, not an answer to it.
            return Err(BdpError::InvalidParameter {
                capability: "cancel".into(),
                detail: "cancel takes `unpinned<AsyncResult>`: it carries no revision guard, and \
                         declares no 412 to report one failing. A pinned handle is refused rather \
                         than honoured as a precondition the declaration excludes."
                    .into(),
            });
        }

        // Read the handle's state under a read guard, then release it before committing — the
        // write path takes its own exclusive guard (see the concurrency note at the top).
        let (cause, call_id) = {
            let store = self.store.read().unwrap();
            let scope = self.scope_str(&async_result.scope);
            let id = async_result.id.0.to_string();
            let row = store
                .head(&scope, &id)
                .ok_or_else(|| BdpError::NotFound(async_result.clone()))?;
            if row.op == "delete" {
                return Err(BdpError::Erased {
                    id: async_result.clone(),
                    at: Rev(row.rev.clone().into()),
                });
            }
            if row.kind != ASYNC_RESULT_KIND {
                return Err(BdpError::NotFound(async_result.clone()));
            }
            let props: serde_json::Value =
                serde_json::from_str(row.properties.as_deref().unwrap_or("{}"))
                    .map_err(|e| BdpError::Backend(format!("asyncResult properties not json: {e}")))?;
            if props.get("reply").map(|r| !r.is_null()).unwrap_or(false) {
                return Err(BdpError::AlreadySettled { id: async_result.clone() });
            }
            // `cause` and `callId` are top-level on `AsyncResult` *"(queryable while pending,
            // before `reply`)"*, which is exactly the read being done here: the Reply this cancel
            // writes must carry the SAME correlation tokens the pending handle advertised, or the
            // settlement would not be correlatable to the call it settles.
            (
                props.get("cause").cloned().unwrap_or(serde_json::Value::Null),
                props.get("callId").cloned().unwrap_or(serde_json::Value::Null),
            )
        };

        // `reply.outcome = canceled` — the write the description names, and the ONLY member added.
        // `canceled { reason?: string }`, so the reason is optional and given.
        let reply = serde_json::json!({
            "outcome": { "kind": "canceled", "reason": "canceled" },
            "cause": cause,
            "callId": call_id,
        });
        let patch = serde_json::json!([
            // `/body/reply`, root-addressed over the rep like any other patch — this wrote
            // `/properties/reply`, which stopped resolving the moment the document became the
            // spec's. The one PRODUCTION patch path in this subject.
            { "op": "add", "path": "/body/reply", "value": reply }
        ]);
        let r = self
            .commit(&[Write::Patch {
                target: async_result,
                patch: JsonPatch(RawJson(Bytes::from(serde_json::to_vec(&patch).unwrap()))),
                if_rev: None,
            }])?
            .pop()
            .unwrap();
        Ok(one(r))
    }

    /// revisions — one resource's history, oldest first, as pinned representations.
    ///
    /// This scope declares `revisionModel: versioned`, so it HAS history to offer: `by_id` already
    /// holds every log position for a resource, which is the same index `export(revisions: true)`
    /// walks. Nothing new is stored for this primitive — the history was always there and simply
    /// had no way to be asked for.
    ///
    /// A RETIRED RESOURCE STILL YIELDS ITS HISTORY. `revisions` declares no `410`, and guarantee 14
    /// keeps a retired id accounted for, so neither Gone nor Not-Found is available for a resource
    /// that once existed. `get` faults `410` because it answers *"what is the current state"*;
    /// `revisions` answers *"what states were there"*, and retirement does not unmake them.
    ///
    /// The tombstone revision itself is NOT enumerated — matching `export`, which skips delete rows
    /// for the same reason: a tombstone is not a state the resource was ever in. Guarantee 14's
    /// *"the tombstone revision is kept"* is still satisfied, and observably so: a pinned `get` at
    /// that revision faults `410` carrying it. **Whether `revisions` ought to enumerate tombstones
    /// is not settled by anything normative** — the section carries zero `/// normative:` lines —
    /// so this is flagged rather than resolved, and no case asserts either way.
    async fn revisions(&self, resource: &ResourceId, _selector: Option<&Selector>, page: Page)
        -> Result<BdpResult<Vec<Representation>>, BdpError> {
        let store = self.store.read().unwrap();
        let scope = self.scope_str(&resource.scope);
        let id = resource.id.0.to_string();
        let positions = store
            .by_id
            .get(&(scope, id))
            // An id with NO log positions never existed in this scope — the one 404 `revisions`
            // declares. Distinct from a retired id, which has positions and yields them.
            .ok_or_else(|| BdpError::NotFound(resource.clone()))?;

        let mut out = Vec::new();
        for &pos in positions {
            let row = &store.log[pos];
            if row.op == "delete" {
                continue;
            }
            out.push(bead_from_row(&resource.scope, &resource.id, row));
        }
        // THE SAME CURSOR OBLIGATION AS `list`, and it was missing here too. `page.after` was
        // ignored, so a caller paging a long history re-read the oldest revisions for ever.
        //
        // THE POSITION IS THE REVISION, so the cursor is the last `rev` emitted and resuming means
        // dropping everything up to and including it. History is ordered oldest-first, so index
        // order IS revision order and a scan to the cursor is unambiguous.
        if let Some(c) = &page.after {
            let resume_after = String::from_utf8_lossy(&c.0).into_owned();
            if let Some(i) = out.iter().position(|r| {
                r.id().rev.as_ref().map(|rv| rv.0.as_ref()) == Some(resume_after.as_str())
            }) {
                out.drain(..=i);
            }
        }

        let total_after_cursor = out.len();
        if let Some(limit) = page.limit {
            out.truncate(limit as usize);
        }
        let head = out.len() == total_after_cursor;
        let cursor = out
            .last()
            .and_then(|r| r.id().rev.clone())
            .map(|rv| Cursor(Bytes::from(rv.0.as_ref().to_owned().into_bytes())));
        Ok(BdpResult::ok(out).with_protocol(ProtocolMeta {
            cursor: if head { None } else { cursor },
            head: Some(head),
            ..Default::default()
        }))
    }
}

/// `call` returning an async handle, with the minted revision in the envelope.
fn one_outcome(r: ResourceId) -> BdpResult<CallOutcome> {
    let rev = r.rev.clone();
    BdpResult::ok(CallOutcome::Async(r)).with_protocol(ProtocolMeta { rev, ..Default::default() })
}

/// The closed built-in set. Adding an arm is a SUBJECT change and moves no row.
#[derive(Clone, Copy, Debug)]
enum Builtin {
    /// Succeeds, carrying the request's arguments back as the value.
    Echo,
    /// Settles on the declared-failure arm — the 409 producer.
    AlwaysRefuses,
}

/// Read an Operation bead's chosen built-in out of its `properties`. Unknown or absent ⇒ `None`,
/// which the caller treats as an unresolvable operation (pre-dispatch), never as a failure.
fn builtin_of(properties: Option<&str>) -> Option<Builtin> {
    let v: serde_json::Value = serde_json::from_str(properties.unwrap_or("{}")).ok()?;
    match v.get("implementation")?.as_str()? {
        "echo" => Some(Builtin::Echo),
        "always-refuses" => Some(Builtin::AlwaysRefuses),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
