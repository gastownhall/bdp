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

/// An opened, in-memory BDP scope, bound to one scope name (like `PgScope`). Cheap to construct;
/// `Default` gives a scope named `"inmem"`.
pub struct InMemScope {
    store: RwLock<Store>,
    scope_name: String,
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
        Self { store: RwLock::new(Store::default()), scope_name: scope_name.into() }
    }

    /// This scope's storage class — `Ephemeral` (volatile, local, not a durable source). The
    /// inherent accessor that feeds discovery (Lydia §78); nothing about the versioned core changes.
    pub fn storage_class(&self) -> StorageClass {
        StorageClass::Ephemeral
    }

    fn scope_str(&self, s: &Scope) -> String {
        match s {
            Scope::This => self.scope_name.clone(),
            Scope::Web => "WEB".to_string(),
            Scope::Named(n) => n.0.to_string(),
        }
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
            let (op, prev, created_at) = match &head {
                None => ("create", None, now_rfc3339()),
                // Reachable only under `reusable`, where a retired id is free to mint again.
                Some(h) if h.op == "delete" => ("create", None, now_rfc3339()),
                Some(h) => ("update", Some(h.rev.clone()), h.created_at.clone()),
            };
            let rev = Uuid::new_v4().to_string();
            let (ts, ti) = ref_parts(&body.r#type);
            store.append(Row {
                ordinal: (store.log.len() + 1) as u64,
                scope,
                id: id_s,
                rev: rev.clone(),
                kind: body.kind.0.to_string(),
                type_scope: ts,
                type_id: ti,
                properties: Some(json_str(&body.properties)),
                metadata: Some(json_str(&body.metadata)),
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
            let mut doc = serde_json::json!({ "properties": props_v, "metadata": meta_v });
            let patch_v: serde_json::Value = serde_json::from_slice(patch.0 .0.as_ref())
                .map_err(|e| BdpError::Unprocessable(format!("patch: patch document not json: {e}")))?;
            bdp_jsonpatch::apply_patch(&mut doc, &patch_v).map_err(BdpError::Unprocessable)?;
            let props_s = serde_json::to_string(doc.get("properties").unwrap_or(&serde_json::Value::Null))
                .map_err(|e| BdpError::Unprocessable(e.to_string()))?;
            let meta_s = serde_json::to_string(doc.get("metadata").unwrap_or(&serde_json::Value::Null))
                .map_err(|e| BdpError::Unprocessable(e.to_string()))?;

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

/// Resolve a `FieldPath` against a row's {properties, metadata}. First segment selects the doc
/// (`metadata`/`properties`, default `properties`); the rest walks object keys / array indices.
fn field_value(props: &serde_json::Value, meta: &serde_json::Value, field: &FieldPath) -> Option<serde_json::Value> {
    let segs = &field.0;
    let (doc, rest): (&serde_json::Value, &[String]) = match segs.first().map(String::as_str) {
        Some("metadata") => (meta, &segs[1..]),
        Some("properties") => (props, &segs[1..]),
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
/// comparison; Has/Missing test presence; IsType is the kind-path prefix. An unadvertised kind is
/// `LimitExceeded`; an unwired sub-option (Glob/In) is `Unprocessable` — exactly as pg emits.
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
                CompareOp::In => return Err(BdpError::Unprocessable("list: `in` not wired".into())),
            }
        }
        ListCondition::Matches { field, pattern, using } => {
            let lhs = match field_value(props, meta, field).and_then(|v| text_of(&v)) {
                Some(t) => t,
                None => return Ok(false),
            };
            match using {
                MatchKind::Substring => lhs.to_lowercase().contains(&pattern.to_lowercase()),
                MatchKind::Regex => return Err(BdpError::Unprocessable("list: regex match needs a regex engine (not wired)".into())),
                MatchKind::Glob => return Err(BdpError::Unprocessable("list: glob match not wired".into())),
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
        // a condition KIND beyond the advertised set (Compare/Matches/Has/Missing/IsType) is an
        // OVER-LIMIT request — LimitExceeded, not not_implemented and not a generic payload error.
        other => {
            return Err(BdpError::LimitExceeded {
                capability: "list".into(),
                limit: "conditions".into(),
                detail: format!("condition kind not in the advertised set: {other:?}"),
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
            PrimitiveCapabilities::Create(CreateCaps { server_allocates_id: true, client_proposed_id: true }),
            PrimitiveCapabilities::Put(PutCaps { if_match: true, if_absent: true }),
            PrimitiveCapabilities::Patch(PatchCaps { if_match: true }),
            PrimitiveCapabilities::Delete(DeleteCaps { if_match: true }),
            // acyclicity DEFERRED until the ref-encoding pin (honest: advertised ⟹ implemented).
            PrimitiveCapabilities::Apply(ApplyCaps { max_writes: None, acyclicity: false }),
            PrimitiveCapabilities::Export(ExportCaps { revisions: true }),
            PrimitiveCapabilities::Import(ImportCaps { history_restore: false }),
            PrimitiveCapabilities::Changes(ChangesCaps { sse: false, jsonl: false, filter: false, selector: false }),
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
        if let Some(n) = page.limit {
            out.truncate(n as usize);
        }
        Ok(BdpResult::ok(out))
    }

    /// changes — the scope's changefeed: the append-log tailed by a cursor. Resume `after` a cursor
    /// (exclusive) XOR `from` an ordinal (inclusive); `head` = caught up to the live edge. Each log
    /// row is one committed change; create/update carry the full post-image, delete carries
    /// top-level provenance (no body). Mirrors pg.
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
            ImportStrategy::HistoryRestore => Ok(BdpResult::not_implemented()),
        }
    }
}

#[cfg(test)]
mod tests;
