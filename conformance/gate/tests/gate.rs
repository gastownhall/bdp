//! The tier-1 conformance gate — wire-level cases over the in-memory reference.
//!
//! Each case drives a `RemoteScope` against a `Server(InMemScope)` over real loopback HTTP and, on
//! success, reports the surface rows (`SurfaceId`) it covers. The harness runs every case against one
//! server, unions the covered rows, and compares against the pinned denominator (`bdp_gate::denominator`).
//!
//! Two independent signals:
//!   * A case that was expected to pass but FAILED always fails the gate — that is the gate catching a
//!     wire-level regression.
//!   * Uncovered denominator rows are reported and, under `BDP_GATE_STRICT=1`, fail the gate
//!     (fail-if-no-coverage). This is a FIRST increment: it covers the primitives the InMemScope
//!     reference implements plus the faults the typed client can trigger; the rest is reported
//!     uncovered with reasons and filled in follow-ups.

use std::collections::BTreeSet;
use std::future::Future;

use bdp_gate::{denominator, SurfaceId};
use bdp_inmem::InMemScope;
use bdp_primitives::{
    BdpError, BdpResult, BdpScope, CallMode, CallOutcome, CreateBody, CreateCaps, DeleteCaps, GetCaps,
    Guards, Id, IdModel, JsonPatch, Kind, PatchCaps, PrimitiveCapabilities, PutCaps, RawJson,
    Representation, ExportRecord, FieldPath, ListCondition, ListFilter, Page, Request, ResourceId,
    Rev, RevisionModel, Scope, ScopeCapabilities, Selector, StorageClass,
};
use bdp_protocol::http::{send, Outgoing};
use bdp_protocol::{RemoteScope, Server};
use bytes::Bytes;
use tokio::net::TcpListener;

// ---- helpers ----------------------------------------------------------------

fn note_body(text: &str) -> CreateBody {
    CreateBody {
        kind: Kind("note".into()),
        r#type: ResourceId::head(Scope::This, Id("BeadType:note".into())),
        properties: RawJson(Bytes::from(
            serde_json::to_vec(&serde_json::json!({ "text": text })).unwrap(),
        )),
        metadata: RawJson(Bytes::from_static(b"{}")),
    }
}

fn op(n: &str) -> SurfaceId {
    SurfaceId::Op(n.to_string())
}
fn fault(n: &str, s: u16) -> SurfaceId {
    SurfaceId::Fault(n.to_string(), s)
}

/// A well-formed resource id that the reference has never seen (plain id — a `:`-bearing id is
/// rejected at the wire as 400, which is a different fault than "well-formed but absent" → 404).
fn missing(id: &str) -> ResourceId {
    ResourceId::head(Scope::This, Id(id.into()))
}

/// Seed a resource with `put` and VERIFY the seed took. Every case whose assertion depends on a
/// pre-existing resource must go through this.
///
/// `not_implemented` is an `Ok` signal, so a bare `put(..).await?` "succeeds" against a subject with
/// no `put` at all, and the case then fails later with a misleading diagnostic — or, as
/// `delete+erased` once did, passes outright. A case must fail on its OWN terms, naming the breach,
/// rather than lean on a downstream error.
async fn seed(r: &RemoteScope, target: &ResourceId, text: &str) -> Result<(), String> {
    let res = r
        .put(target.clone(), note_body(text), Guards::default())
        .await
        .map_err(|e| format!("seed put transport: {e:?}"))?;
    if res.not_implemented {
        return Err(format!(
            "seed put advertised but not_implemented — the precondition for this case never ran \
             (target {:?})",
            target.id
        ));
    }
    Ok(())
}

async fn record<F>(name: &str, covered: &mut BTreeSet<SurfaceId>, failures: &mut Vec<String>, fut: F)
where
    F: Future<Output = Result<Vec<SurfaceId>, String>>,
{
    match fut.await {
        Ok(rows) => {
            for r in rows {
                covered.insert(r);
            }
        }
        Err(e) => failures.push(format!("{name}: {e}")),
    }
}

// ---- cases ------------------------------------------------------------------

/// `create` (server-allocated id) then `get` the resource back. Covers op/create + op/get.
async fn create_then_get(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let created = r
        .create(None, note_body("hi"))
        .await
        .map_err(|e| format!("create transport: {e:?}"))?;
    if created.not_implemented {
        return Err("create advertised but not_implemented".into());
    }
    let id = created.value.ok_or("create: no id returned")?;
    let got = r.get(&id, None).await.map_err(|e| format!("get transport: {e:?}"))?;
    if got.not_implemented || got.value.is_none() {
        return Err("get: no representation for the just-created id".into());
    }
    Ok(vec![op("create"), op("get")])
}

/// `get` an id the reference never created → 404 NotFound. Covers op/get/fault/404.
async fn get_missing_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    match r.get(&missing("never-existed"), None).await {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("get", 404)]),
        other => Err(format!("expected NotFound (404), got {other:?}")),
    }
}

/// `create` the same explicit id twice → 409 AlreadyExists. Covers op/create/fault/409.
async fn create_duplicate_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let id = Id("dup-409".into());
    // Verify the first create actually took: an unguarded `?` here would let a subject with no
    // `create` reach the second call, which would then fail with a misleading diagnostic rather
    // than naming the real breach.
    let first = r
        .create(Some(id.clone()), note_body("first"))
        .await
        .map_err(|e| format!("create #1 transport: {e:?}"))?;
    if first.not_implemented {
        return Err("create advertised but not_implemented — the 409 precondition never ran".into());
    }
    match r.create(Some(id), note_body("second")).await {
        Err(BdpError::AlreadyExists(_)) => Ok(vec![fault("create", 409)]),
        other => Err(format!("expected AlreadyExists (409), got {other:?}")),
    }
}

/// Seed an explicit id with `put`, `delete` it, then `get` it → 410 Erased (tombstone: a terminal
/// revision that keeps the id). Covers op/delete + op/get/fault/410.
async fn delete_then_erased(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("to-erase".into()));
    // VERIFY THE SEED, don't assume it. This case was VACUOUS: a subject whose `delete` minted a
    // tombstone for an id that never existed let it pass with this `put` never having run, falsely
    // claiming both its rows. `not_implemented` is an Ok-signal, so an unguarded `?` here passes
    // against a subject that implements no `put` at all. A case must fail on its OWN terms rather
    // than lean on a sibling row going red.
    seed(r, &target, "to-erase").await?;
    // And confirm the resource is actually live before retiring it, so "erased" means erased-from-
    // present rather than erased-from-nothing.
    let live = r
        .get(&target, None)
        .await
        .map_err(|e| format!("seed get: {e:?}"))?;
    if live.not_implemented || live.value.is_none() {
        return Err("seed: the resource is not live before delete, so 410 would prove nothing".into());
    }
    let del = r
        .delete(target.clone(), None)
        .await
        .map_err(|e| format!("delete transport: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented".into());
    }
    // RE-KEYED on the scope's DECLARED id model rather than asserting terminality outright.
    // Terminality is not universal: a write's 410 — and `get`'s — is reachable only under
    // `permanent`. Under `reusable` a retired id is simply absent, so the truthful answer is 404
    // and asserting 410 would claim more than the spec grants.
    //
    // This case previously asserted 410 unconditionally and happened to be right, because this
    // subject is `versioned` and `versioned` REQUIRES `permanent`. Right for a reason it never
    // checked is still worth fixing: the next subject need not be versioned.
    match (r.scope_capabilities().id_model, r.get(&target, None).await) {
        (IdModel::Permanent, Err(BdpError::Erased { .. })) => {
            Ok(vec![op("delete"), fault("get", 410)])
        }
        (IdModel::Permanent, other) => Err(format!(
            "scope declares `permanent`, so a retired id must fault Erased (410); got {other:?}"
        )),
        // A `reusable` scope keeps no retirement record, so 404 is correct and `get/410` is simply
        // unreachable there — reported as covering `delete` only, never as covering the 410.
        (IdModel::Reusable, Err(BdpError::NotFound(_))) => Ok(vec![op("delete")]),
        (IdModel::Reusable, other) => Err(format!(
            "scope declares `reusable`, so a retired id must fault NotFound (404); got {other:?}"
        )),
    }
}

/// `patch` targeting a retired resource → 410 Erased. Covers op/patch/fault/410.
///
/// A write that TARGETS what is gone faults Gone, which is distinct from its two neighbours: a
/// never-retired missing id is 404, and CLAIMING a spent id is identity-taken (409). Keyed on
/// `permanent` for the same reason as `get/410` — under `reusable` the id is merely absent, so the
/// row is unreachable rather than failing.
async fn patch_tombstone_410(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if r.scope_capabilities().id_model != IdModel::Permanent {
        // Not a failure: the row is unreachable on this scope's declared model.
        return Ok(vec![]);
    }
    let target = ResourceId::head(Scope::This, Id("patch-410".into()));
    seed(r, &target, "doomed").await?;
    let del = r
        .delete(target.clone(), None)
        .await
        .map_err(|e| format!("seed delete: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented".into());
    }
    match r
        .patch(
            target,
            json_patch(r#"[{"op":"replace","path":"/properties/text","value":"after"}]"#),
            None,
        )
        .await
    {
        Err(BdpError::Erased { .. }) => Ok(vec![fault("patch", 410)]),
        other => Err(format!("expected Erased (410) patching a retired resource, got {other:?}")),
    }
}

/// `delete` an id that NEVER existed → 404 NotFound, and it must mint nothing.
/// Covers op/delete/fault/404.
///
/// This row was long recorded "not producible — delete is idempotent". That was wrong twice over.
/// `delete` is idempotent on an EXISTING resource, not total: deleting an id that never existed is a
/// different case and faults 404. A subject that instead mints a tombstone makes the declared 404
/// unreachable AND, under `idModel: permanent`, lets any caller able to delete permanently spend any
/// unused id in the space — `create` there faults identity-taken for all time.
async fn delete_never_existed_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let victim = Id("never-existed-delete".into());
    let target = ResourceId::head(Scope::This, victim.clone());
    match r.delete(target, None).await {
        Err(BdpError::NotFound(_)) => {}
        other => return Err(format!("expected NotFound (404) deleting a never-created id, got {other:?}")),
    }
    // The fault is the declared half; "mints nothing" is the half that matters for safety, and it is
    // observable without asserting any status: the id must still be claimable afterwards.
    let claimed = r
        .create(Some(victim), note_body("still claimable"))
        .await
        .map_err(|e| format!("the id was BURNED by a failed delete — create now faults {e:?}"))?;
    if claimed.not_implemented {
        return Err("create advertised but not_implemented".into());
    }
    Ok(vec![fault("delete", 404)])
}

/// Deleting an ALREADY-RETIRED resource is the idempotent case: same tombstone `Rev`, no fault, and
/// no second revision. This is why `delete` alone among the writes declares no 410.
///
/// Asserts only what is invariant: the retry reports the same revision it was retired at. It claims
/// no new surface row — it exists to stop the 404 case above being satisfied by a subject that
/// faults on EVERY delete.
async fn delete_twice_is_idempotent(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("delete-twice".into()));
    seed(r, &target, "v0").await?;
    let first = r.delete(target.clone(), None).await.map_err(|e| format!("delete #1: {e:?}"))?;
    let first_rev = first.value.clone().and_then(|id| id.rev).ok_or("delete #1 returned no rev")?;
    let second = r
        .delete(target, None)
        .await
        .map_err(|e| format!("delete #2 faulted, but an already-retired resource must not: {e:?}"))?;
    let second_rev = second.value.clone().and_then(|id| id.rev).ok_or("delete #2 returned no rev")?;
    if first_rev != second_rev {
        return Err(format!(
            "delete is not idempotent: retry minted a NEW revision ({first_rev:?} -> {second_rev:?}). \
             An already-retired resource must report the revision it is retired at."
        ));
    }
    Ok(vec![])
}

/// `put` with a stale `if_revision` guard → 412 RevisionMismatch, and it must mint NOTHING.
/// Covers op/put/fault/412.
///
/// This row had no producer at all until `put` could carry a guard: the trait took no `if_rev`, so
/// the server read no precondition header and a guarded write proceeded against a stale revision
/// while returning `200`. That is a LOST-UPDATE VECTOR in which the unsafe operation SUCCEEDS, so a
/// client cannot learn it from the result — the same shape as a `delete` that mints a tombstone for
/// an id it never retired.
///
/// So the case asserts the fault AND that the resource is untouched. The status alone would pass
/// against a subject that faults after writing.
async fn put_stale_guard_412(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-412".into()));
    seed(r, &target, "v0").await?;
    let before = r
        .get(&target, None)
        .await
        .map_err(|e| format!("read-back before: {e:?}"))?
        .value
        .ok_or("no representation before the guarded put")?;

    match r
        .put(target.clone(), note_body("v1-should-not-land"), Guards::if_revision(Rev("stale-rev".into())))
        .await
    {
        Err(BdpError::RevisionMismatch { .. }) => {}
        other => return Err(format!("expected RevisionMismatch (412) on a stale guard, got {other:?}")),
    }

    // "Makes NO change" is the half that matters for safety and is observable without the status.
    let after = r
        .get(&target, None)
        .await
        .map_err(|e| format!("read-back after: {e:?}"))?
        .value
        .ok_or("no representation after the guarded put")?;
    if format!("{:?}", before.id().rev) != format!("{:?}", after.id().rev) {
        return Err(format!(
            "the guarded put FAULTED BUT STILL WROTE: revision moved {:?} -> {:?}",
            before.id().rev,
            after.id().rev
        ));
    }
    Ok(vec![fault("put", 412)])
}

/// A bare `put` targeting a retired resource → 410 Erased, and it must mint NOTHING.
/// Covers op/put/fault/410.
///
/// This is the LAST declared row that was blocked on the subject rather than on a ruling. `put` over
/// a tombstone used to start a fresh lifecycle, which revived a spent identity — the subject
/// contradicting a merged rule, not merely leaving a row uncovered.
///
/// The distinction the spec draws, and the one this case pins against its neighbour below: a BARE
/// `put` TARGETS the retired resource, so it is `410`; a `put` under `ifAbsent` CLAIMS the id, so a
/// spent one is `identity-taken` (409). Rooting cannot tell them apart — every `put` is id-rooted —
/// so the guard is what does.
async fn put_tombstone_410(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if r.scope_capabilities().id_model != IdModel::Permanent {
        // Under `reusable` a retired id is free, so a put legitimately creates and the row is
        // unreachable rather than failing.
        return Ok(vec![]);
    }
    let target = ResourceId::head(Scope::This, Id("put-410".into()));
    seed(r, &target, "doomed").await?;
    let del = r.delete(target.clone(), None).await.map_err(|e| format!("seed delete: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented".into());
    }
    match r.put(target.clone(), note_body("revived?"), Guards::default()).await {
        Err(BdpError::Erased { .. }) => {}
        other => {
            return Err(format!(
                "expected Erased (410) on a bare put at a retired id — a spent identity must not be \
                 revived; got {other:?}"
            ))
        }
    }
    // The refusal must also have written nothing: a fault that still revived the id would be worse
    // than no fault at all, and the status alone cannot tell the difference.
    match r.get(&target, None).await {
        Err(BdpError::Erased { .. }) => Ok(vec![fault("put", 410)]),
        other => Err(format!("the id must remain retired after the refused put; got {other:?}")),
    }
}

/// `put` under `if_absent` at an id that is already taken → 409. Covers op/put/fault/409.
///
/// `ifAbsent` is the CLAIMING path: `If-None-Match: *` asserts the id is free, so an occupied id
/// faults the same way a `create` collision does, keeping one id-taken handler on the client. The
/// spec is explicit that on `put` the 409 is the guard's fault and never the bare operation's —
/// a bare `put` at a live id is an ordinary update, which `put_target` already covers.
async fn put_if_absent_taken_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-409".into()));
    seed(r, &target, "occupied").await?;
    match r.put(target, note_body("claim"), Guards::if_absent()).await {
        Err(BdpError::AlreadyExists(_)) => Ok(vec![fault("put", 409)]),
        other => return Err(format!("expected AlreadyExists (409) claiming a taken id, got {other:?}")),
    }
}

/// An unguarded `put` at a live id must still be an ordinary update. Claims no row; it exists so
/// `put/409` and `put/412` cannot be satisfied by a subject that faults on every `put`.
async fn put_unguarded_still_updates(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-unguarded".into()));
    seed(r, &target, "v0").await?;
    let res = r
        .put(target, note_body("v1"), Guards::default())
        .await
        .map_err(|e| format!("an UNGUARDED put at a live id must update, not fault: {e:?}"))?;
    if res.not_implemented {
        return Err("put advertised but not_implemented".into());
    }
    Ok(vec![])
}

// ---- list / export ----------------------------------------------------------

/// `list` returns the scope's current resources. Covers op/list.
///
/// Asserts the seeded ids are PRESENT rather than asserting the exact set: other cases share this
/// server, so the scope holds their resources too. A case that demanded an exact list would pass
/// or fail depending on which cases ran before it, which is a test of the harness, not the subject.
async fn list_the_scopes_resources(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let a = ResourceId::head(Scope::This, Id("list-a".into()));
    let b = ResourceId::head(Scope::This, Id("list-b".into()));
    seed(r, &a, "a").await?;
    seed(r, &b, "b").await?;

    let res = r
        .list(&ListFilter(vec![]), Page::default())
        .await
        .map_err(|e| format!("list transport: {e:?}"))?;
    if res.not_implemented {
        return Err("list advertised but not_implemented".into());
    }
    let ids: BTreeSet<String> =
        res.value.ok_or("list returned Ok with no ids")?.iter().map(|r| r.id.0.to_string()).collect();
    for want in ["list-a", "list-b"] {
        if !ids.contains(want) {
            return Err(format!("`{want}` was seeded but is absent from list (got {} ids)", ids.len()));
        }
    }
    Ok(vec![op("list")])
}

/// A filtered `list` must be REFUSED, not silently unfiltered. Claims no row.
///
/// `capabilities()` advertises `ListCaps { conditions: [] }` over this binding because no `Filter`
/// wire encoding is pinned. This is the enforcement behind that advertisement: returning every
/// resource to a caller who asked for a subset is the `do_put`-ignored-`If-Match` defect in a
/// different primitive — accepting a constraint and not honouring it.
async fn a_filtered_list_is_refused_not_ignored(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let filter = ListFilter(vec![ListCondition::Has { field: FieldPath(vec!["properties".to_string(), "text".to_string()]) }]);
    match r.list(&filter, Page::default()).await {
        Err(_) => Ok(vec![]),
        Ok(res) => Err(format!(
            "a filtered `list` must not be answered over a binding that cannot carry the filter; \
             got {} ids, which the caller would read as the filtered set",
            res.value.map(|v| v.len()).unwrap_or(0)
        )),
    }
}

/// `export` returns a JSONL-framed backup. Covers op/export.
///
/// The declared success response is `contentType = "application/jsonl"` — the only primitive that
/// declares one — so this asserts the FRAMING, which is what distinguishes an export from a read:
/// a Begin carrying the cursor it is consistent as of, the records, and an End whose count closes
/// it. A JSON array would carry the same data and not be the declared shape.
async fn export_is_jsonl_framed(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("export-target".into()));
    seed(r, &target, "exported").await?;

    let res = r
        .export(&ListFilter(vec![]), None, false, Page::default())
        .await
        .map_err(|e| format!("export transport: {e:?}"))?;
    if res.not_implemented {
        return Err("export advertised but not_implemented".into());
    }
    let records = res.value.ok_or("export returned Ok with no records")?;

    match records.first() {
        Some(ExportRecord::Begin(_)) => {}
        other => return Err(format!("an export must open with Begin (the cut cursor), got {other:?}")),
    }
    let (count, resources) = match records.last() {
        Some(ExportRecord::End(e)) => (e.count, records.len().saturating_sub(2)),
        other => return Err(format!("an export must close with End (the count), got {other:?}")),
    };
    if count as usize != resources {
        return Err(format!(
            "End declares {count} records but the stream carried {resources} — the count that \
             closes a backup must match what it contains"
        ));
    }
    if resources == 0 {
        return Err("the export is empty though a resource was seeded".into());
    }
    Ok(vec![op("export")])
}

/// The client must ADVERTISE every primitive it forwards. Claims no row.
///
/// This exists because of a defect it would have caught: `call` was bound in the binding port and
/// never added to `remote_forwards`, so `RemoteScope` forwarded it and discovery denied it for two
/// PRs. **Nothing in the gate could catch that** — every case invokes the trait method directly, so
/// no row depends on advertisement and a subject advertising nothing would still claim every row.
///
/// Under-advertising is safer than over-advertising and still wrong: discovery is the contract a
/// client reads before calling, and the spec has it stating which primitives are offered.
async fn the_client_advertises_what_it_forwards(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    use PrimitiveCapabilities as C;
    let caps = r.capabilities();
    for (name, present) in [
        ("list", caps.iter().any(|c| matches!(c, C::List(_)))),
        ("export", caps.iter().any(|c| matches!(c, C::Export(_)))),
        ("call", caps.iter().any(|c| matches!(c, C::Call(_)))),
        ("cancel", caps.iter().any(|c| matches!(c, C::Cancel(_)))),
    ] {
        if !present {
            return Err(format!(
                "`{name}` is forwarded by this client but absent from its advertised capabilities"
            ));
        }
    }
    // And the narrowing holds: conditions are cleared because this binding carries no `where`.
    if let Some(C::List(l)) = caps.iter().find(|c| matches!(c, C::List(_))) {
        if !l.conditions.is_empty() {
            return Err(format!(
                "ListCaps advertises {} condition kinds, but this binding carries no `where` \
                 encoding — an optional feature is never half-present",
                l.conditions.len()
            ));
        }
    }
    Ok(vec![])
}

// ---- revisions --------------------------------------------------------------

/// `revisions` returns a resource's history. Covers op/revisions.
///
/// KEYED ON THE DECLARED `revision_model`, not asserted outright. Store-wide guarantee 4 says
/// whether revisions are kept is the scope's `revisionModel` — so history is a scope trait, and a
/// case that demanded it unconditionally would fail a conformant `unversioned` store. Under that
/// model guarantee 5 says no revision is minted at all, which makes history *vacuous rather than
/// violated*, so `not_implemented` is the conformant answer and this case accepts it.
///
/// This is the same correction `delete_then_erased` needed against `id_model`, made before the
/// case was written rather than after it was caught.
async fn revisions_history_is_addressable(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("rev-history".into()));
    // Three distinct states, so "history" means more than "the current state in a list".
    seed(r, &target, "v0").await?;
    seed(r, &target, "v1").await?;
    seed(r, &target, "v2").await?;

    let res = r
        .revisions(&target, None, Page::default())
        .await
        .map_err(|e| format!("revisions transport: {e:?}"))?;

    if r.scope_capabilities().revision_model == RevisionModel::Unversioned {
        // An unversioned scope mints no revisions, so it has no history to offer. Guarantee 6
        // requires that this be DISCOVERABLE, which it is — the declared model above says so.
        if res.not_implemented {
            return Ok(vec![]);
        }
        return Err("an `unversioned` scope must not claim to offer history".into());
    }

    if res.not_implemented {
        return Err("a `versioned` scope declares revisions are kept, so revisions must answer".into());
    }
    let history = res.value.ok_or("revisions returned Ok with no history")?;
    if history.len() < 3 {
        return Err(format!(
            "expected at least the 3 seeded states in the history, got {}. A scope declaring \
             `versioned` keeps prior revisions addressable (store-wide guarantee 6)",
            history.len()
        ));
    }
    // PRIOR revisions, not three copies of the current one — the guarantee is that earlier states
    // stay addressable, and a subject returning the head N times would satisfy a length check.
    let revs: BTreeSet<String> = history.iter().filter_map(rep_rev_string).collect();
    if revs.len() < 3 {
        return Err(format!(
            "history has {} entries but only {} distinct revisions — prior revisions are not \
             actually addressable",
            history.len(),
            revs.len()
        ));
    }
    Ok(vec![op("revisions")])
}

/// `revisions` of an id that never existed faults 404. Covers op/revisions/fault/404.
async fn revisions_never_existed_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let absent = ResourceId::head(Scope::This, Id("rev-never-existed".into()));
    match r.revisions(&absent, None, Page::default()).await {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("revisions", 404)]),
        other => Err(format!("expected NotFound for an id with no history, got {other:?}")),
    }
}

/// A RETIRED resource still yields its history.
///
/// Claims no row — 410 is not declared on `revisions` — but it is the assertion that makes the two
/// rows above mean something, and it is DERIVED rather than chosen:
///
/// * `revisions` declares `[400, 404]`. There is no `410`, so Gone is not available to it, unlike
///   `get`.
/// * Store-wide guarantee 14 keeps a retired id accounted for, so `404` would be false — the id
///   demonstrably existed.
///
/// One possibility remains: the history survives retirement. `get` answers *"what is the current
/// state"* and faults `410`; `revisions` answers *"what states were there"*, and retiring a
/// resource does not unmake them.
///
/// It is also the anti-vacuity guard for `revisions/404`: without it, a subject that answered 404
/// to every `revisions` call would claim that row.
async fn revisions_survive_retirement(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("rev-retired".into()));
    seed(r, &target, "before-delete").await?;
    let del = r
        .delete(target.clone(), None)
        .await
        .map_err(|e| format!("delete transport: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented — retirement never happened".into());
    }
    // Confirm the resource really is retired, so this proves history-survives-retirement rather
    // than history-of-a-live-resource.
    match r.get(&target, None).await {
        Err(BdpError::Erased { .. }) | Err(BdpError::NotFound(_)) => {}
        other => return Err(format!("the resource is not retired after delete, got {other:?}")),
    }

    let res = r.revisions(&target, None, Page::default()).await.map_err(|e| {
        format!(
            "a retired resource must still yield its history: `revisions` declares no 410, and \
             guarantee 14 keeps the id accounted for so 404 is false. Got {e:?}"
        )
    })?;
    if res.not_implemented {
        return Ok(vec![]); // unversioned: no history to survive. Keyed, not asserted.
    }
    let history = res.value.ok_or("revisions returned Ok with no history")?;
    if history.is_empty() {
        return Err("a retired resource's history is empty — retirement unmade its prior states".into());
    }
    Ok(vec![])
}

/// A representation's own revision, as a comparable string.
fn rep_rev_string(rep: &Representation) -> Option<String> {
    match rep {
        Representation::Bead { id, .. } => id.rev.as_ref().map(|r| r.0.to_string()),
        _ => None,
    }
}

// ---- call -------------------------------------------------------------------

/// An Operation bead selecting one of the subject's built-in implementations.
///
/// Which built-ins exist is the SUBJECT's business — no row depends on what an operation
/// computes. These cases depend only on which `Outcome` arm the call settles into.
fn operation_body(implementation: &str) -> CreateBody {
    CreateBody {
        kind: Kind("operation".into()),
        r#type: ResourceId::head(Scope::This, Id("BeadType:operation".into())),
        properties: RawJson(Bytes::from(
            serde_json::to_vec(&serde_json::json!({ "implementation": implementation })).unwrap(),
        )),
        metadata: RawJson(Bytes::from_static(b"{}")),
    }
}

/// Seed an Operation bead, then `call` it. Returns the decoded `Reply` body.
async fn seed_and_call(
    r: &RemoteScope,
    id: &str,
    implementation: &str,
    args: &str,
) -> Result<serde_json::Value, String> {
    let target = ResourceId::head(Scope::This, Id(id.into()));
    let res = r
        .put(target.clone(), operation_body(implementation), Guards::default())
        .await
        .map_err(|e| format!("seeding the Operation bead failed: {e:?}"))?;
    if res.not_implemented {
        return Err("seeding the Operation bead returned not_implemented".into());
    }
    let outcome = r
        .call(&target, Request(RawJson(Bytes::from(args.as_bytes().to_vec()))), CallMode::Sync)
        .await
        .map_err(|e| {
            format!(
                "`call` faulted with a Problem. A Problem means the operation could NOT RUN \
                 (pre-dispatch); a declared failure rides the Outcome instead. Got {e:?}"
            )
        })?;
    if outcome.not_implemented {
        return Err("call advertised but not_implemented".into());
    }
    match outcome.value {
        Some(CallOutcome::Reply(reply)) => serde_json::from_slice(&reply.0 .0)
            .map_err(|e| format!("the Reply body is not JSON: {e}")),
        Some(CallOutcome::Async(_)) => {
            Err("a sync call must settle into a Reply, not an AsyncResult ref".into())
        }
        None => Err("call returned Ok with no CallOutcome".into()),
    }
}

/// `call` an operation that succeeds. Covers op/call.
///
/// Asserts `kind` is PRESENT and `"success"` — the spec requires `kind` be explicit in the body
/// so a reader never infers the arm from the status, so a 200 with the arm missing is not a
/// conformant success.
async fn call_success(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let reply = seed_and_call(r, "op-echo", "echo", r#"{"n":1}"#).await?;
    let kind = reply["outcome"]["kind"]
        .as_str()
        .ok_or("the Reply's `outcome` carries no `kind` — the arm must be explicit in the body")?;
    if kind != "success" {
        return Err(format!("expected the success arm from a succeeding operation, got {kind:?}"));
    }
    // `cause` and `callId` are required members of `Reply`.
    for required in ["cause", "callId"] {
        if reply[required].is_null() {
            return Err(format!("`Reply.{required}` is required and absent"));
        }
    }
    Ok(vec![op("call")])
}

/// `call` an operation that settles on the DECLARED-FAILURE arm. Covers op/call/fault/409.
///
/// This is the only >=400 response in the binding whose body is not a `Problem`: the operation
/// ran and said no, so 409 carries a `Reply` whose `outcome.error` is the operation's declared
/// `E`. A subject that answered a Problem here would report that the call could not run.
async fn call_declared_failure_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let reply = seed_and_call(r, "op-refuses", "always-refuses", "{}").await?;
    let kind = reply["outcome"]["kind"].as_str().ok_or(
        "the 409 body carries no `outcome.kind`. A declared failure must arrive as a Reply on \
         the `failure` arm, not as a Problem",
    )?;
    if kind != "failure" {
        return Err(format!("expected the `failure` arm at 409, got {kind:?}"));
    }
    if reply["outcome"]["error"].is_null() {
        return Err("the `failure` arm must carry the operation's declared `error`".into());
    }
    // The arm is `failure`, not `fault`: a `fault` carries a Problem and means an UNDECLARED
    // failure. Conflating them would lose the distinction 409 exists to make.
    if !reply["outcome"]["problem"].is_null() {
        return Err("a declared `failure` must not carry a `problem` — that is the `fault` arm".into());
    }
    Ok(vec![fault("call", 409)])
}

/// An unresolvable `operation` is a PRE-dispatch failure: a bare Problem with NO Outcome, because
/// the operation never ran. Claims no row — 404 is not declared on `call` — but it is the anti-
/// vacuity guard for the two cases above: without it, a subject that answered 409 to every call
/// would satisfy `call/409`, and one that answered 200 to every call would satisfy `op/call`.
async fn call_unresolvable_operation_never_ran(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let absent = ResourceId::head(Scope::This, Id("op-does-not-exist".into()));
    match r.call(&absent, Request(RawJson(Bytes::from_static(b"{}"))), CallMode::Sync).await {
        Err(BdpError::NotFound(_)) => Ok(vec![]),
        Ok(res) => Err(format!(
            "calling an unresolvable operation must fault with a bare Problem (the operation never \
             ran), not settle into an Outcome. Got Ok({:?})",
            res.value.is_some()
        )),
        Err(other) => Err(format!("expected NotFound for an unresolvable operation, got {other:?}")),
    }
}


// ---- cancel -----------------------------------------------------------------
//
// `cancel` is the expensive primitive, because there is nothing to cancel until an operation can
// be minted asynchronously: `command cancel(asyncResult: unpinned<AsyncResult>) -> pinned<AsyncResult>`
// targets a handle, and a handle only exists once `call ?mode=async` has made one. So every case
// below opens with a minted handle, and the mint is verified before anything is asserted about the
// cancel — the `delete+erased` lesson, where a case passed with its seed never having run.

/// Does this subject ADVERTISE async `call`? Keyed, not assumed: §3.3 makes every primitive beyond
/// the floor "present iff advertised", and `CallCaps.async_supported` is the sub-capability that
/// says whether a handle can be minted at all. A scope without it cannot reach any `cancel` row,
/// and answering `501` is conformant rather than deficient.
fn async_call_offered(r: &RemoteScope) -> bool {
    use PrimitiveCapabilities as C;
    r.capabilities().iter().any(|c| matches!(c, C::Call(c) if c.async_supported))
}

/// Does this subject ADVERTISE `cancel`? Same reading, one level up: `cancel` is its own primitive
/// in the §3.3 index, so it is advertised (and refusable) independently of `call`.
fn cancel_offered(r: &RemoteScope) -> bool {
    use PrimitiveCapabilities as C;
    r.capabilities().iter().any(|c| matches!(c, C::Cancel(_)))
}

/// A bead representation's `properties`, decoded. Faults loudly rather than returning an empty
/// object: a case that read `{}` for an unparseable body would assert against the wrong thing.
fn bead_properties(rep: &Representation) -> Result<serde_json::Value, String> {
    match rep {
        Representation::Bead { properties, .. } => serde_json::from_slice(&properties.0)
            .map_err(|e| format!("the bead's properties are not JSON: {e}")),
        other => Err(format!("expected a Bead representation, got {other:?}")),
    }
}

/// Drop a handle's revision, so it can be handed to `cancel`.
///
/// THIS STEP IS FORCED BY THE TYPES AND IT IS WORTH NAMING. `call ?mode=async` answers with
/// `rep<AsyncResult>`, whose `id` is PINNED — a representation always carries the revision it is
/// of. `cancel` takes `unpinned<AsyncResult>`. So the handle a caller is handed is not in the form
/// the primitive that kills it accepts, and the caller must unpin it.
///
/// That is not an inconvenience to paper over: `cancel` declares no `412`, so there is nothing it
/// could have done with the revision even if it took one. Unpinning here is the caller doing
/// explicitly what a client that quietly dropped the `rev` would do invisibly — and the invisible
/// version is the one that lets a caller believe a revision was checked.
fn unpinned(r: &ResourceId) -> ResourceId {
    ResourceId::head(r.scope.clone(), r.id.clone())
}

/// Seed an Operation bead and `call` it with `CallMode::Async`, returning the minted handle's ref.
///
/// VERIFIES THE MINT, because every `cancel` case depends on it: a `not_implemented` is an `Ok`
/// signal, so an unguarded async call "succeeds" against a subject that mints nothing and the
/// cancel case then fails naming the wrong thing — or passes.
async fn mint_handle(r: &RemoteScope, op_id: &str) -> Result<ResourceId, String> {
    let target = ResourceId::head(Scope::This, Id(op_id.into()));
    let seeded = r
        .put(target.clone(), operation_body("echo"), Guards::default())
        .await
        .map_err(|e| format!("seeding the Operation bead failed: {e:?}"))?;
    if seeded.not_implemented {
        return Err("seeding the Operation bead returned not_implemented".into());
    }
    let res = r
        .call(&target, Request(RawJson(Bytes::from_static(b"{}"))), CallMode::Async)
        .await
        .map_err(|e| format!("the async `call` faulted instead of minting a handle: {e:?}"))?;
    if res.not_implemented {
        return Err(
            "`call` advertises `asyncSupported` but answered not_implemented for ?mode=async — an \
             optional feature is never half-present"
                .into(),
        );
    }
    match res.value {
        Some(CallOutcome::Async(reference)) => Ok(reference),
        Some(CallOutcome::Reply(_)) => Err(
            "?mode=async settled synchronously. A 200 tells the caller the call is done while it \
             believes it holds a running operation it could still cancel"
                .into(),
        ),
        None => Err("the async call returned Ok with no CallOutcome".into()),
    }
}

/// `call ?mode=async` mints a handle that is PENDING. Claims no row.
///
/// `op/call` is ONE denominator row and the sync case already covers it, so claiming it here would
/// let this case hold the row green if `call_success` broke. What this case is for is the
/// precondition every `cancel` case rests on, and the one assertion that makes "running" mean
/// anything: `AsyncResult.reply` is *"the settlement, once it arrives (absent while pending)"*, and
/// `Outcome`'s normative line is explicit that *"a transient state (running/waiting) is NOT an
/// arm"* — so a pending handle carries NO outcome at all, rather than a `running` one. A subject
/// that minted an already-settled handle would have nothing cancellable and every `cancel` row
/// below would be unreachable for a reason no case would name.
async fn an_async_call_mints_a_pending_handle(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-pending").await?;
    let got = r
        .get(&unpinned(&handle), None)
        .await
        .map_err(|e| format!("the minted handle is not readable: {e:?}"))?;
    let rep = got.value.ok_or("the minted handle read back with no representation")?;
    let props = bead_properties(&rep)?;
    if !props["reply"].is_null() {
        return Err(format!(
            "a just-minted handle already carries a `reply` ({}), so it is settled and there is \
             nothing for `cancel` to kill",
            props["reply"]
        ));
    }
    // The members `cancel` has to carry into the settlement it writes. They are top-level on
    // `AsyncResult` *"(queryable while pending, before `reply`)"*, which is this read exactly.
    for required in ["operation", "cause", "callId", "request", "replyChannel"] {
        if props[required].is_null() {
            return Err(format!("`AsyncResult.{required}` is a required member and is absent"));
        }
    }
    Ok(vec![])
}

/// `cancel` a running handle. Covers op/cancel.
///
/// The assertion is NOT that the call returned 200 — it is that the handle now carries
/// `reply.outcome = canceled`, which is what `cancel`'s description says the primitive writes. A
/// subject that answered 200 and wrote nothing would satisfy a status check and have cancelled
/// nothing, and it is the same subject a caller could not distinguish from a working one.
///
/// Keyed on the declared capabilities twice over: on `Cancel` being advertised (§3.3 — an
/// un-offered primitive is legitimately refused) and, for the pinned return, on the declared
/// `revision_model`, because an `unversioned` scope mints no revisions and relaxes every pinned
/// return to unpinned scope-wide. Asserting a `rev` outright would fail such a scope for a
/// guarantee it never made.
async fn cancel_a_running_handle(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) || !cancel_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-cancel").await?;
    let res = r
        .cancel(unpinned(&handle))
        .await
        .map_err(|e| format!("cancel of a running handle faulted: {e:?}"))?;
    if res.not_implemented {
        return Err("`cancel` is advertised but answered not_implemented".into());
    }
    let pinned = res.value.ok_or("cancel returned Ok with no ref")?;
    if pinned.id != handle.id {
        return Err(format!(
            "cancel returned a ref to {:?}, not to the handle it was given ({:?})",
            pinned.id, handle.id
        ));
    }
    if r.scope_capabilities().revision_model == RevisionModel::Versioned && pinned.rev.is_none() {
        return Err(
            "`cancel -> pinned<AsyncResult>` must return the revision the cancel minted; a \
             `versioned` scope mints one, so an unpinned answer loses the caller's proof of WHICH \
             revision carries the canceled outcome"
                .into(),
        );
    }

    // THE SUBSTANCE: read the handle back and check what was written. The read is UNPINNED on
    // purpose — the cancel minted a new revision, so a pinned read of the handle as it was handed
    // out would show the state before the cancel and this assertion would always fail.
    let got = r
        .get(&unpinned(&handle), None)
        .await
        .map_err(|e| format!("the handle is not readable after cancel: {e:?}"))?;
    let rep = got.value.ok_or("the cancelled handle read back with no representation")?;
    let props = bead_properties(&rep)?;
    let kind = props["reply"]["outcome"]["kind"].as_str().ok_or(
        "the cancelled handle carries no `reply.outcome.kind`. `cancel` *writes* \
         `reply.outcome = canceled`, and the arm must be explicit in the body — a reader never \
         infers it from a status",
    )?;
    if kind != "canceled" {
        return Err(format!("expected the `canceled` arm after cancel, got {kind:?}"));
    }
    // `canceled` is a non-domain fate, NOT a domain `Result`. A `failure` here would say the
    // operation ran and returned its declared `E`; a `fault` would say it ran and broke. Both
    // claim it DISPATCHED, and the whole point of a cancel is that it did not finish.
    if !props["reply"]["outcome"]["error"].is_null() || !props["reply"]["outcome"]["problem"].is_null()
    {
        return Err(
            "the `canceled` arm must carry neither `error` (the domain failure arm) nor `problem` \
             (the fault arm) — those say the operation ran to a verdict"
                .into(),
        );
    }
    Ok(vec![op("cancel")])
}

/// `cancel` an asyncResult id the subject never minted → 404. Covers op/cancel/fault/404.
///
/// D.8 grounds this one outright: *"404 get of an absent resource"*. Its anti-vacuity guard is
/// `cancel_a_running_handle` above — without a case proving a real handle IS cancellable, a subject
/// that answered 404 to every cancel would claim this row.
async fn cancel_absent_handle_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !cancel_offered(r) {
        return Ok(vec![]);
    }
    let absent = ResourceId::head(Scope::This, Id("async-never-minted".into()));
    match r.cancel(absent).await {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("cancel", 404)]),
        other => Err(format!("expected NotFound for a handle that was never minted, got {other:?}")),
    }
}

/// `cancel` a handle that is ALREADY SETTLED → 409. Covers op/cancel/fault/409.
///
/// DERIVED from the declared fault set rather than chosen. `cancel` declares `[404, 409]`; D.8
/// grounds 404 in absence, and this target demonstrably exists. `Outcome`'s normative line supplies
/// the condition: *"A present `outcome` means the invocation is settled, whichever arm it holds; a
/// transient state (running/waiting) is NOT an arm"* — and `cancel` acts on a *running* handle. So a
/// settled handle is the 409.
///
/// **It also settles whether `cancel` is idempotent, and the answer is NO** — which is why
/// cancelling twice is the way this case reaches the row. `delete` is idempotent on an existing
/// resource and declares no `410` because of it; `cancel` declares a `409` and the same normative
/// line that makes "settled" terminal says it is settled *whichever arm it holds*. That phrase
/// deliberately refuses to privilege one arm, so "already `canceled`" is not a state distinguishable
/// from "already failed", and reading the second cancel as idempotent would invent the distinction
/// the spec flattens.
///
/// The race the spec is really about — the operation settling on its own just before the cancel
/// lands — needs a scheduler, and this subject has none: a minted handle stays pending forever.
/// Double-cancel reaches the same STATE (`reply` present) by the only road available here, and the
/// case keys on that state rather than on how it was arrived at.
///
/// The first cancel is this case's own anti-vacuity guard: if it does not take, there is no settled
/// handle and the case says so instead of asserting 409 against a running one.
async fn cancel_a_settled_handle_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) || !cancel_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-settled").await?;
    let first = r
        .cancel(unpinned(&handle))
        .await
        .map_err(|e| format!("the first cancel faulted, so nothing is settled to re-cancel: {e:?}"))?;
    if first.not_implemented {
        return Err("`cancel` is advertised but answered not_implemented — the 409 precondition never ran".into());
    }
    match r.cancel(unpinned(&handle)).await {
        Err(BdpError::AlreadySettled { .. }) => Ok(vec![fault("cancel", 409)]),
        Ok(res) => Err(format!(
            "cancelling a settled handle must fault 409, not succeed. `cancel` is not idempotent: \
             a present `outcome` means settled whichever arm it holds, so there is no state in \
             which a second kill is a no-op. Got Ok({:?})",
            res.value.is_some()
        )),
        Err(other) => Err(format!("expected AlreadySettled (409) for a settled handle, got {other:?}")),
    }
}

/// `cancel` of a live resource that is NOT an AsyncResult does not resolve. Claims no row.
///
/// The declared parameter is a TYPED ref, `unpinned<AsyncResult>`. A note's id is therefore not a
/// handle that failed — it is a handle that does not resolve, and 404 is the declared fault for a
/// target that does not resolve. This is the reading `call` already takes one primitive over, for
/// `ref<Operation>`: *"a resource that resolves but names no built-in this store has is an
/// unresolvable operation, not a failed one"*.
///
/// **The alternative reading is live**: that the resource exists makes this a conflict with the
/// current state, which would be the declared 409. Nothing normative distinguishes them — D.8's
/// 404 line says *"get of an absent resource"* and this one is not absent. The case claims no row
/// precisely so that a ruling the other way moves no coverage; it is here because the two readings
/// differ in what a caller does next (re-resolve the handle, versus wait and retry), and silently
/// picking one without writing it down is how that choice stops being reviewable.
async fn cancel_of_a_non_handle_does_not_resolve(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !cancel_offered(r) {
        return Ok(vec![]);
    }
    let note = ResourceId::head(Scope::This, Id("cancel-not-a-handle".into()));
    seed(r, &note, "an ordinary note").await?;
    match r.cancel(note).await {
        Err(BdpError::NotFound(_)) => Ok(vec![]),
        Ok(res) => Err(format!(
            "cancelling an ordinary resource must not succeed — `cancel` writes \
             `reply.outcome = canceled` onto an AsyncResult, and a note has no reply to write. \
             Got Ok({:?})",
            res.value.is_some()
        )),
        Err(other) => Err(format!(
            "expected the typed ref not to resolve as a handle (404); got {other:?}. If this is \
             ruled a 409 instead, that row is declared and this case should claim it"
        )),
    }
}

/// A PINNED handle is refused, not silently cancelled at whatever revision is current. Claims no row.
///
/// DERIVED FROM AN ABSENT FAULT. `cancel` takes `unpinned<AsyncResult>` and declares no `412`,
/// while `put`, `patch` and `delete` each carry a revision guard (D.3) and each declare one. The
/// missing parameter and the missing fault agree, and together they say `cancel` has no
/// precondition channel — so a revision on the handle is an argument its declared type forbids,
/// not a guard to honour.
///
/// Which leaves refusing it as the only honest answer. Accepting it and dropping the revision is
/// the `do_put`-ignored-`If-Match` defect exactly: the caller asked for "cancel only if still at
/// this revision", gets a success, and cannot learn from the result that nothing checked. That
/// defect was a lost-update vector in which the unsafe operation SUCCEEDS, which is why this is
/// asserted rather than left to the type system of a client that may not be this one.
///
/// Claims no row because there is no row: the fault is undeclared, and over HTTP it is unreachable
/// — the route carries an id and `cancel` reads no `If-Match`, so there is no pin channel on the
/// wire to carry a revision in the first place.
async fn cancel_refuses_a_pinned_handle(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) || !cancel_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-pinned").await?;
    // THE PINNED FORM IS THE ONE THE WIRE HANDED BACK — `rep<AsyncResult>` carries the revision it
    // is of, so no revision has to be invented to make this case. Under `unversioned` there is no
    // revision anywhere, so there is nothing to refuse and the case has nothing to say.
    if handle.rev.is_none() {
        if r.scope_capabilities().revision_model == RevisionModel::Versioned {
            return Err("a `versioned` scope's minted handle must carry its revision".into());
        }
        return Ok(vec![]);
    }
    match r.cancel(handle.clone()).await {
        Err(_) => {}
        Ok(res) => {
            return Err(format!(
                "a pinned handle must be refused: `cancel` takes `unpinned<AsyncResult>` and \
                 declares no 412, so there is no precondition for a revision to be checked \
                 against. Answering it hands back a success to a caller who believes a guard \
                 held. Got Ok({:?})",
                res.value.is_some()
            ))
        }
    }
    // And the refusal must not have cancelled it anyway — a guard that is refused AND applied is
    // worse than either.
    let got = r
        .get(&unpinned(&handle), None)
        .await
        .map_err(|e| format!("the handle is not readable after the refused cancel: {e:?}"))?;
    let rep = got.value.ok_or("the handle read back with no representation")?;
    if !bead_properties(&rep)?["reply"].is_null() {
        return Err("the pinned cancel was refused and the handle was cancelled anyway".into());
    }
    Ok(vec![])
}

/// An RFC-6902-subset JSON Patch as the wire body.
fn json_patch(body: &str) -> JsonPatch {
    JsonPatch(RawJson(Bytes::from(body.as_bytes().to_vec())))
}

/// `patch` an existing resource with a delta. Covers op/patch.
async fn patch_ok(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("patch-target".into()));
    seed(r, &target, "v0").await?;
    let res = r
        .patch(
            target,
            json_patch(r#"[{"op":"replace","path":"/properties/text","value":"v1"}]"#),
            None,
        )
        .await
        .map_err(|e| format!("patch transport: {e:?}"))?;
    if res.not_implemented {
        return Err("patch advertised but not_implemented".into());
    }
    Ok(vec![op("patch")])
}

/// `patch` an id the reference never created → 404 NotFound. Covers op/patch/fault/404.
async fn patch_missing_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    match r
        .patch(
            missing("patch-never"),
            json_patch(r#"[{"op":"add","path":"/properties/x","value":1}]"#),
            None,
        )
        .await
    {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("patch", 404)]),
        other => Err(format!("expected NotFound (404), got {other:?}")),
    }
}

/// `patch` with a stale `if_rev` → 412 RevisionMismatch. Covers op/patch/fault/412.
async fn patch_stale_412(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("patch-412".into()));
    seed(r, &target, "v0").await?;
    match r
        .patch(
            target,
            json_patch(r#"[{"op":"replace","path":"/properties/text","value":"v1"}]"#),
            Some(Rev("stale-rev".into())),
        )
        .await
    {
        Err(BdpError::RevisionMismatch { .. }) => Ok(vec![fault("patch", 412)]),
        other => Err(format!("expected RevisionMismatch (412), got {other:?}")),
    }
}

/// `delete` with a stale `if_rev` → 412 RevisionMismatch. Covers op/delete/fault/412.
async fn delete_stale_412(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("delete-412".into()));
    seed(r, &target, "v0").await?;
    match r.delete(target, Some(Rev("stale-rev".into()))).await {
        Err(BdpError::RevisionMismatch { .. }) => Ok(vec![fault("delete", 412)]),
        other => Err(format!("expected RevisionMismatch (412), got {other:?}")),
    }
}

/// `put` a resource at a target id. Covers op/put.
async fn put_target(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-target".into()));
    let res = r
        .put(target, note_body("put-value"), Guards::default())
        .await
        .map_err(|e| format!("put transport: {e:?}"))?;
    if res.not_implemented {
        return Err("put advertised but not_implemented".into());
    }
    Ok(vec![op("put")])
}

// ---- raw-HTTP cases (protocol-level faults the typed client can't express) ---

/// Send a raw request straight to the server, bypassing the typed `RemoteScope`, to exercise
/// protocol-level faults (malformed/unsupported requests) that the well-formed client never emits.
async fn raw_status(
    host: &str,
    method: &str,
    target: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<u16, String> {
    let resp = send(Outgoing {
        method,
        host,
        target,
        headers,
        body: body.to_vec(),
    })
    .await
    .map_err(|e| format!("raw send: {e:?}"))?;
    Ok(resp.status)
}

fn ctype(v: &str) -> Vec<(String, String)> {
    vec![("content-type".into(), v.into())]
}

/// Like [`raw_status`], but also reads the Problem `code` out of the body.
///
/// ASSERTING THE STATUS ALONE IS WHAT LET THE OLD `patch/422` CASE LOOK SOUND. Two unrelated
/// obligations — `malformed-request` (a bad request) and `limit-exceeded` (a request past an
/// ADVERTISED capability bound) — were both answered `422` by this subject, so a case that checked
/// only the number could not say which of the two it had exercised, and it had exercised the wrong
/// one. D.9 gives every fault a stable `code`; naming it is what stops a fault satisfying a case it
/// has nothing to do with. A row is `(op, status)`, so the ledger cannot carry this distinction —
/// only the case can, which is why it belongs here and not in the denominator.
async fn raw_problem(
    host: &str,
    method: &str,
    target: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<(u16, String), String> {
    let resp = send(Outgoing {
        method,
        host,
        target,
        headers,
        body: body.to_vec(),
    })
    .await
    .map_err(|e| format!("raw send: {e:?}"))?;
    // THE STATUS IS CHECKED BEFORE THE BODY IS PARSED, and that ordering is the whole value of
    // this branch. Parsing first and reporting a missing `code` member is what this helper did at
    // first, and when the guard it tests was removed it answered "the Problem body carries no
    // `code` member" over a perfectly good success body — telling a reader the response was a
    // malformed Problem when in truth the request had SUCCEEDED. A diagnostic that names the wrong
    // failure costs more than no diagnostic, because it sends the reader to the wrong file.
    if resp.status < 400 {
        return Err(format!(
            "expected a fault, but the request SUCCEEDED with {} — the producer under test is \
             absent, not merely wrong",
            resp.status
        ));
    }
    let doc: serde_json::Value = serde_json::from_slice(&resp.body)
        .map_err(|e| format!("a Problem body must be JSON (status {}): {e}", resp.status))?;
    let code = doc
        .get("code")
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            format!("the {} Problem body carries no `code` member: {doc}", resp.status)
        })?
        .to_string();
    Ok((resp.status, code))
}

/// Assert a fault answered BOTH the expected status and the expected D.9 `code`.
fn expect_problem(got: (u16, String), status: u16, code: &str, what: &str) -> Result<(), String> {
    if got.0 != status || got.1 != code {
        return Err(format!(
            "expected {status} `{code}` on {what}, got {} `{}`",
            got.0, got.1
        ));
    }
    Ok(())
}


/// `POST /` (create) with a non-JSON body → 400 bad-request. Covers op/create/fault/400.
async fn create_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "POST", "/-/create", ctype("application/json"), b"}{ not json").await? {
        400 => Ok(vec![fault("create", 400)]),
        s => Err(format!("expected 400 on a bad create body, got {s}")),
    }
}

/// `PUT /{id}` with a non-JSON body → 400 bad-request. Covers op/put/fault/400.
async fn put_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "PUT", "/put-bad", ctype("application/json"), b"not json").await? {
        400 => Ok(vec![fault("put", 400)]),
        s => Err(format!("expected 400 on a bad put body, got {s}")),
    }
}

/// `PATCH /{id}` whose body is not a JSON-Patch array → 400 `malformed-request`. Covers
/// op/patch/fault/400. Targets `/patch-target` (seeded by the typed `patch` case earlier in the run)
/// so the handler passes the existence check and reaches body validation.
///
/// WHAT THIS CASE REPLACES, AND WHY ITS PREDECESSOR PASSED FOR TWO MERGES. The same request used to
/// be sent as `patch_unprocessable_422` and asserted `422`, because the body fell through to the
/// applier. D.8 defines `422` as a request past an ADVERTISED capability bound (`limit-exceeded`,
/// fixed by shrinking the request) and names "a patch that is not a JSON-Patch array" under `400`.
/// So the row op/patch/fault/422 was recorded covered by a case that never exercised a capability
/// bound at all — the one species of defect a single-subject suite structurally cannot find, since
/// the subject and the case agreed and nothing else had a vote. It took a peer's three-backend grid
/// to surface it.
///
/// op/patch/fault/422 is now HONESTLY UNCOVERED: this subject advertises no bound a request can
/// exceed, so nothing here can produce it. That is a smaller numerator and a truer one.
async fn patch_non_array_body_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let got = raw_problem(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/json-patch+json"),
        b"not a patch",
    )
    .await?;
    expect_problem(got, 400, "malformed-request", "a patch body that is not an array")?;
    Ok(vec![fault("patch", 400)])
}

/// `PATCH /{id}` carrying `If-None-Match: *` → 400 `malformed-request`. Also covers
/// op/patch/fault/400 — a SECOND, independent producer of the same row.
///
/// `ifAbsent` is a field of `PutCaps` and of neither `PatchCaps` nor `DeleteCaps`, so on a patch
/// `If-None-Match` is not an advertised option carrying a bad value but an input the operation does
/// not define, and no capability field exists that could advertise it either way. In the
/// operation's vocabulary and advertised false is a decline the operation can state; outside its
/// vocabulary is malformed. That line is drawn by the capability record, not by D.8's prose, which
/// is why reading the prose alone missed it.
///
/// THIS CASE AND THE ONE ABOVE DO NOT DISCHARGE EACH OTHER, and the ledger cannot say so. A row is
/// `(op, status)`; op/patch/fault/400 has two triggers and is counted once, so "covered" here means
/// one trigger exercised, not the obligation discharged. The same trap applies to the S1/S3 split
/// on the read pins, and it is recorded in both places deliberately.
///
/// NOT ASSERTED BUT MEASURED. Breaking each trigger in turn showed it: removing the guard check
/// from the subject failed this case while the non-array case still passed and the row still read
/// COVERED, and emitting the wrong Problem code from the non-array branch failed that case while
/// this one held the row covered — **30/50 both times.** So a row with two triggers can lose one
/// and the coverage figure does not move. The cases are what caught each regression; the count
/// could not have.
async fn patch_out_of_vocabulary_guard_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let mut headers = ctype("application/json-patch+json");
    headers.push(("if-none-match".into(), "*".into()));
    let got = raw_problem(
        host,
        "PATCH",
        "/patch-target",
        headers,
        br#"[{"op":"replace","path":"/properties/text","value":"guarded"}]"#,
    )
    .await?;
    expect_problem(got, 400, "malformed-request", "`If-None-Match` on a patch")?;
    Ok(vec![fault("patch", 400)])
}

/// `DELETE /{id}` carrying `If-None-Match: *` → 400 `malformed-request`. Covers
/// op/delete/fault/400.
///
/// This row was undeclared by rulings #2/#3 on the finding that its producer — a malformed id under
/// the retired `id:verb` convention — had died with that convention. True, and incomplete: a second
/// producer was in the spec the whole time, carried by `DeleteCaps`'s field list rather than by any
/// sentence. A reading that searches the prose for a producer cannot find a producer that is a
/// SHAPE, which is the general lesson and not a fact about `delete`.
///
/// The body is deliberately present and well-formed: the guard alone must decide the fault, or the
/// case would not distinguish the guard rule from a body rule.
async fn delete_out_of_vocabulary_guard_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let got = raw_problem(
        host,
        "DELETE",
        "/patch-target",
        vec![("if-none-match".into(), "*".into())],
        b"",
    )
    .await?;
    expect_problem(got, 400, "malformed-request", "`If-None-Match` on a delete")?;
    Ok(vec![fault("delete", 400)])
}

/// `PATCH` with a media type other than `application/json-patch+json` → 415.
/// Covers op/patch/fault/415.
///
/// This row was the entire 52-vs-51 delta against v0.2.2: the "`patch` is root-addressed" change
/// pins the request media type, so anything else faults. RFC 7396 merge-patch is the explicitly
/// excluded case, which is what this sends — the realistic wrong type, not a nonsense one.
///
/// It needs raw HTTP because the typed client always sends the correct type, so nothing reachable
/// through `RemoteScope` can produce it.
async fn patch_wrong_media_type_415(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/merge-patch+json"),
        br#"{"properties":{"text":"merged"}}"#,
    )
    .await?
    {
        415 => Ok(vec![fault("patch", 415)]),
        s => Err(format!("expected 415 on a merge-patch body, got {s}")),
    }
}

/// `PATCH` with NO `Content-Type` at all → 415. Also covers op/patch/fault/415.
///
/// `REQUIRED` means present-or-fault: absence is not the lenient case. A requirement that bites only
/// when you declare something else can be evaded by declaring nothing, which makes it unenforceable
/// in exactly the case a careless client produces — so an omission must never downgrade a guarantee.
/// The guarantee is that RFC 7396 merge-patch is never silently applied.
///
/// Claims the same row as `patch_wrong_media_type_415`, deliberately: coverage does not move, but the
/// second condition of the rule is pinned, and one mistake gets ONE fault — a client that erred either
/// way sees 415, not 415-or-422 depending on how it erred.
async fn patch_absent_media_type_415(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        vec![],
        br#"[{"op":"replace","path":"/properties/text","value":"no ctype"}]"#,
    )
    .await?
    {
        415 => Ok(vec![fault("patch", 415)]),
        s => Err(format!(
            "expected 415 for a patch with NO Content-Type (REQUIRED means present-or-fault), got {s}"
        )),
    }
}

/// A `patch` carrying the CORRECT media type must still be accepted — the 415 check must reject the
/// wrong type without rejecting the right one. Claims no surface row (`op/patch` is covered by
/// `patch_ok`); it exists so `patch/415` cannot be satisfied by a subject that 415s every patch.
async fn patch_correct_media_type_is_accepted(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/json-patch+json; charset=utf-8"),
        br#"[{"op":"replace","path":"/properties/text","value":"ok"}]"#,
    )
    .await?
    {
        200 => Ok(vec![]),
        415 => Err("the 415 check rejected the CORRECT media type (parameters must be ignored)".into()),
        s => Err(format!("expected 200 on a well-formed json-patch, got {s}")),
    }
}


/// `import` ROUND-TRIPS what `export` produced. Covers op/import.
///
/// THE LAST DECLARED PRIMITIVE TO REACH THE WIRE. The reference has implemented `import` all along
/// and `route.rs` has parsed `POST /-/import` all along; the server answered "not mapped in the
/// spike", so this row was uncoverable against a scope that implements the op. Wiring the handler
/// is what made it reachable, not a new case technique.
///
/// EXPORT IS THE SOURCE OF THE RECORDS ON PURPOSE. Hand-built records would test the importer
/// against my idea of the format; the exporter's own output tests the pair against each other, so a
/// framing change that breaks one breaks this case rather than passing on both sides of a private
/// convention.
async fn import_round_trips_an_export(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("import-src".into()));
    seed(r, &target, "exported").await?;

    let exported = r
        .export(&ListFilter(vec![]), None, false, Page { after: None, from: None, limit: None })
        .await
        .map_err(|e| format!("export seed: {e:?}"))?;
    if exported.not_implemented {
        return Err("export advertised but returned not_implemented".into());
    }
    let records = exported.value.ok_or("export returned no records")?;
    if !records.iter().any(|rec| matches!(rec, ExportRecord::Record(_))) {
        return Err("export carried no RECORDS, so an import of it would assert nothing".into());
    }

    let res = r
        .import(&records, p_import_set_current())
        .await
        .map_err(|e| format!("import: {e:?}"))?;
    if res.not_implemented {
        return Err("import advertised but answered not_implemented".into());
    }

    // The import must be OBSERVABLE, not merely accepted: a handler that parsed the stream and
    // dropped it would satisfy a status check. Re-reading the id is what distinguishes them.
    let back = r.get(&target, None).await.map_err(|e| format!("read-back: {e:?}"))?;
    if back.not_implemented || back.value.is_none() {
        return Err("the imported resource did not read back".into());
    }
    Ok(vec![op("import")])
}

/// A stream that does not end with `ExportEnd` → 400. Covers op/import/fault/400.
///
/// GROUNDED IN THE SPEC'S OWN WORDS, which is why this is a `400` and not a `422`: core.lumen's
/// `ExportEnd` says "a reader that takes a whole export lacking it refuses it (`400`)". A truncated
/// stream is MALFORMED, not over-bound — nothing about it exceeds an advertised limit — and the
/// distinction is the one `import`'s declared `[400, 409, 422]` keeps apart.
async fn import_truncated_stream_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    // THE WIRE SHAPE IS READ FROM `WireExportRecord`, not guessed. It is an externally-tagged
    // enum, so the frames are `{"Begin":{…}}` / `{"End":{…}}` — capitalised, with `Record`
    // wrapping a `resource`. The first version of this case hand-wrote lowercase keys, every
    // import case failed identically at 422 `unprocessable`, and the single shared cause was the
    // parse refusing all four bodies. Four red cases, one wrong assumption.
    let begin = br#"{"Begin":{"cursor":"c0"}}
"#;
    match raw_status(host, "POST", "/-/import", ctype("application/jsonl"), begin).await? {
        400 => Ok(vec![fault("import", 400)]),
        s => Err(format!("expected 400 on an import stream with no ExportEnd, got {s}")),
    }
}

/// A request that is not `application/jsonl` → 400. Claims the SAME row as the truncation case.
///
/// `400` RATHER THAN `415`, decided by the declared fault set and not by analogy: `import` declares
/// `[400, 409, 422]` and names no 415, while `patch` declares 415 and gets it. Answering 415 here
/// would put a status on the wire that no denominator row carries, which is worse than a coarse
/// one. rc2 (#448) is what makes this checkable at all — it added the
/// `request = { contentType = "application/jsonl" }` core.lumen was missing, so there is now one
/// acceptable type instead of a lenient reading.
async fn import_wrong_media_type_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "POST", "/-/import", ctype("application/json"), b"[]").await? {
        400 => Ok(vec![fault("import", 400)]),
        s => Err(format!("expected 400 on an import that is not application/jsonl, got {s}")),
    }
}

/// `?strategy=history-restore` against a scope advertising `historyRestore: false` → 422
/// `limit-exceeded`. Covers op/import/fault/422.
///
/// THE CAPABILITY DUAL, stated in core.lumen as a rule rather than a courtesy: "Each limit record
/// is the advertise side of a dual: the matching `limit-exceeded` (422) is the enforce side." So a
/// scope that advertises `historyRestore: false` must REFUSE the mode, and refuse it as 422.
///
/// IT ANSWERED 501 UNTIL NOW, and that is why this row had no producer. 501 says the OP is absent;
/// `import` is advertised and present, and declines exactly one mode. A client told 501 concludes
/// the scope cannot import at all. The fix is in the reference, not here — this case is what holds
/// it.
async fn import_history_restore_is_refused_422(host: &str) -> Result<Vec<SurfaceId>, String> {
    let framed = br#"{"Begin":{"cursor":"c0"}}
{"End":{"count":0}}
"#;
    let (status, code) =
        raw_problem(host, "POST", "/-/import?strategy=history-restore", ctype("application/jsonl"), framed)
            .await?;
    match status {
        422 if code == "limit-exceeded" => Ok(vec![fault("import", 422)]),
        422 => Err(format!("422 but the code was {code}, not limit-exceeded")),
        501 => Err("history-restore answered 501; it is an advertised limit on a PRESENT op, so \
                    the dual requires 422 limit-exceeded"
            .into()),
        s => Err(format!("expected 422 limit-exceeded for an unadvertised import mode, got {s}")),
    }
}

/// The `ImportStrategy` vocabulary is CLOSED, so a third name is malformed. Claims no new row
/// (op/import/fault/400 is covered twice over above); it exists so the strategy parse cannot be
/// satisfied by a handler that treats every unknown value as the default.
async fn import_unknown_strategy_is_malformed(host: &str) -> Result<Vec<SurfaceId>, String> {
    let framed = br#"{"Begin":{"cursor":"c0"}}
{"End":{"count":0}}
"#;
    match raw_status(host, "POST", "/-/import?strategy=merge-somehow", ctype("application/jsonl"), framed)
        .await?
    {
        400 => Ok(vec![]),
        200 => Err("an unknown import strategy was ACCEPTED; the vocabulary is closed, so a third \
                    name must not silently become set-current"
            .into()),
        s => Err(format!("expected 400 on an unknown import strategy, got {s}")),
    }
}

/// `ImportStrategy::SetCurrent` without naming the enum at every call site.
fn p_import_set_current() -> bdp_primitives::ImportStrategy {
    bdp_primitives::ImportStrategy::SetCurrent
}


/// `GET /-/export?from=…` → 400. Covers op/export/fault/400.
///
/// GROUNDED IN rc2's OWN WORDS, and that is the whole reason this row has a producer now. #448 added
/// the normative line: "`export` honors only `after`, `limit` and `format` of `request`;
/// `request.filter`, `request.select` and `request.from` are rejected `400` — filtering and
/// projection are the op's own `where`/`select`, and a snapshot resumes by cut `Cursor`, not a fresh
/// ordinal." Before rc2 this row was in the same position as the retired `get/400` and `delete/400`:
/// declared on the op with no producer anywhere in the spec.
///
/// `from` AND NOT `select`, because only one of the three is unambiguous over this binding. `export`
/// also declares its own `select?` and `where?`, and neither is lowered into the generated params
/// (gastownhall/bdp#450) — so a `?select=` could be the REJECTED `request.select` or the op's own
/// parameter arriving under a spelling nobody declared, and a case cannot tell which it exercised.
/// `export` declares no ordinal parameter of its own, so `?from=` can only be `request.from`.
///
/// THE POSITIVE HALF IS ASSERTED TOO: a guard that refused every query string would satisfy the
/// first half while breaking the route, and `after`/`limit` are the two fields the same sentence
/// says export MUST honor.
async fn export_rejects_an_ordinal_resume_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "GET", "/-/export?from=1", Vec::new(), b"").await? {
        400 => {}
        s => return Err(format!("expected 400 for `request.from` on export, got {s}")),
    }
    // The neighbours in the same sentence must still work.
    for target in ["/-/export", "/-/export?after=c0", "/-/export?limit=1"] {
        match raw_status(host, "GET", target, Vec::new(), b"").await? {
            200 => {}
            s => {
                return Err(format!(
                    "`{target}` answered {s}; rc2 says export HONORS after and limit, so a guard \
                     that refuses them is as wrong as one that drops them"
                ))
            }
        }
    }
    Ok(vec![fault("export", 400)])
}


/// An invalid `?limit=` on a read → 400 `invalid-parameter`. Covers op/list/fault/400 and
/// op/revisions/fault/400.
///
/// THE RETIRED-ROWS NOTE BELOW SAYS D.8 NAMES NO PRODUCER FOR `400`. That was true when it was
/// written and rc2 (#448) has overtaken it: D.8 now names three shapes — "A BAD BODY … AN INVALID
/// PARAMETER VALUE. Or A WRITE GUARD THE OPERATION DOES NOT DEFINE". `create/400` and `put/400`
/// are the first shape, `patch/400` and `delete/400` the third, and these two are the second. So
/// two rows that looked permanently unreachable were a stale reading of the appendix, not a gap in
/// the spec.
///
/// THE BINDING HAD TURNED THE PRODUCER INTO A SUCCESS, which is why nobody could reach the row:
/// every `?limit=` parse was `.and_then(|s| s.parse().ok())`, so `?limit=abc` silently meant "give
/// me everything" and answered 200 over the caller's whole collection. The case and the fix landed
/// together; the row was uncoverable because the behaviour was wrong, not because the spec was
/// silent.
///
/// BOTH ROWS IN ONE CASE, because it is one obligation: `limit` is a `ReadRequest` field and every
/// read lowers it the same way. Splitting them would imply a reader could legitimately differ.
async fn an_invalid_limit_is_an_invalid_parameter_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("limit-400".into()));
    let mut covered = Vec::new();

    for (op_name, path) in [("list", "/-/list"), ("revisions", "/limit-400/-/revisions")] {
        let (status, code) =
            raw_problem(host, "GET", &format!("{path}?limit=abc"), Vec::new(), b"").await?;
        if status != 400 {
            return Err(format!(
                "`{path}?limit=abc` answered {status}; an invalid parameter VALUE is a 400 (D.8), \
                 and silently ignoring it answers 200 over the whole collection"
            ));
        }
        if code != "invalid-parameter" {
            return Err(format!(
                "`{path}` faulted 400 with code `{code}`; D.8 names `invalid-parameter` for a bad \
                 parameter value, and the code is what tells it from a bad BODY"
            ));
        }
        covered.push(fault(op_name, 400));
    }

    // THE POSITIVE HALF: a guard that refused every `limit` would satisfy the loop above while
    // breaking paging on both reads.
    let _ = target;
    for path in ["/-/list?limit=1", "/limit-400/-/revisions?limit=1", "/-/list", "/-/export?limit=1"] {
        match raw_status(host, "GET", path, Vec::new(), b"").await? {
            200 | 404 => {}
            s => return Err(format!("`{path}` answered {s}; a VALID limit must be honored")),
        }
    }
    Ok(covered)
}


/// RETIRED, not lost: `get/400` and `delete/400`.
///
/// Both were produced by the router rejecting a `:`-bearing id as an unknown verb — the prototype's
/// `id:verb` convention, which the 0.2.3 action fence replaces. A `:` is now an ordinary id
/// character, so `GET /a:b:c` is a well-formed read of an absent resource and correctly answers
/// 404.
///
/// There was NO spec-grounded producer to move them to. `400` is declared on 11 of the 13
/// operations and Appendix D.8 — which named a producer for 404, 405, 409, 410, 412 and 415 —
/// named none for it; the only `400` the spec grounded was a length-related one it attributed to
/// intermediaries rather than the origin.
///
/// THAT PARAGRAPH IS NOW OUT OF DATE, and it is left standing with this correction because the
/// reasoning it records is what made the correction findable. rc2 (#448) gives D.8's `400` three
/// named shapes: "A BAD BODY: unparseable JSON, a patch that is not a JSON-Patch array, a truncated
/// export. AN INVALID PARAMETER VALUE. Or A WRITE GUARD THE OPERATION DOES NOT DEFINE." So the
/// appendix now grounds `400` on the origin in three different ways, and four rows that had been
/// recorded unreachable are not: `import/400` is the first shape, `list/400` and `revisions/400`
/// the second, `delete/400` the third.
///
/// `get/400` STILL HAS NONE, which is why these two are not simply un-retired. `get` takes no body,
/// and its parameters (`revision`, `include`, `omit`, `expand`, `select`) have no value this
/// binding can call invalid — a bad `?revision=` names a revision that does not exist, which is
/// `404`, not a malformed parameter. So the row stays uncovered, now for a reason that names what
/// would be needed rather than claiming the appendix is silent.
///
/// `create/400` and `put/400` SURVIVED the same change, and the difference is the point: they
/// malform the BODY on a valid route, which is a real producer. These two malformed the ID, which
/// was only a producer because of the convention. Four rows looked at risk; two actually were.
///
/// Recorded uncovered-with-reason rather than kept alive by retaining a dead convention.

// ---- the capability duals, against a subject that advertises a BOUND ---------------------------

/// `create/422`, `put/422` and `patch/422` — the enforce side of three capability duals.
///
/// THESE WERE NOT UNCOVERED FOR WANT OF A CASE. They were unreachable against the permissive
/// reference, which advertises `ifMatch`, `ifAbsent` and `clientProposedId` all TRUE: there was
/// nothing for it to refuse, so no request could produce the fault. That is a property of the
/// SUBJECT, not of the suite — and the fix is a second subject, not a cleverer request.
///
/// `InMemScope::restricted` narrows the ADVERTISEMENT and keeps the behaviour, which is what makes
/// the pair honest: the store still honors a guard handed to it directly, so a 422 here proves the
/// BINDING read the capability record rather than that the store lost a feature.
///
/// NOT THE SAME FAULT AS AN OUT-OF-VOCABULARY GUARD, and the codes are asserted to keep them
/// apart. `If-None-Match` on `patch` is `400`: `ifAbsent` is not a field of `PatchCaps` at all, so
/// no advertisement could offer or refuse it. `If-Match` on a `put` advertising `ifMatch: false` is
/// `422`: the field exists, this scope declines it, and the caller fixes the request by dropping
/// the guard. Status alone cannot tell those apart on an op that declares both — the `code` can.
async fn the_capability_duals_are_refused_422(host: &str) -> Result<Vec<SurfaceId>, String> {
    let mut covered = Vec::new();

    // A proposed id against `clientProposedId: false`.
    // THE PROPOSED ID RIDES THE BODY, not a query param — `WireCreateRequest.id`. The first
    // version of this case sent `?id=proposed`, which the binding ignores, so the create SUCCEEDED
    // with 201 and the anti-vacuity guard in `record()` caught it: "the producer under test is
    // absent, not merely wrong". That guard exists for exactly this, and it is the second time
    // today a hand-written wire shape cost a run.
    let (status, code) = raw_problem(
        host,
        "POST",
        "/-/create",
        ctype("application/json"),
        br#"{"kind":"note","type":{"scope":"this","id":"BeadType:note"},"id":{"scope":"this","id":"proposed"},"properties":{},"metadata":{}}"#,
    )
    .await?;
    match (status, code.as_str()) {
        (422, "limit-exceeded") => covered.push(fault("create", 422)),
        (201, _) => {
            return Err("a caller-proposed id was ACCEPTED by a scope advertising \
                        `clientProposedId: false`; the dual requires it refused, and silently \
                        minting a different id hands back a Location the caller never asked for"
                .into())
        }
        (s, c) => return Err(format!("expected 422 limit-exceeded for a proposed id, got {s} / {c}")),
    }

    // Seed through the path that the restricted scope DOES advertise, so the put/patch cases are
    // about the guard and not about a missing resource.
    let seeded = raw_status(
        host,
        "PUT",
        "/dual-target",
        ctype("application/json"),
        br#"{"kind":"note","type":{"scope":"this","id":"BeadType:note"},"properties":{},"metadata":{}}"#,
    )
    .await?;
    if seeded != 200 {
        return Err(format!("seed put answered {seeded}; an UNGUARDED put must still work"));
    }

    // `If-Match` against `ifMatch: false`, on put and on patch.
    for (op_name, method, target, ct, body) in [
        ("put", "PUT", "/dual-target", "application/json",
         br#"{"kind":"note","type":{"scope":"this","id":"BeadType:note"},"properties":{},"metadata":{}}"#.as_slice()),
        ("patch", "PATCH", "/dual-target", "application/json-patch+json",
         br#"[{"op":"replace","path":"/properties/text","value":"x"}]"#.as_slice()),
    ] {
        let mut headers = ctype(ct);
        headers.push(("if-match".into(), "some-rev".into()));
        let (status, code) = raw_problem(host, method, target, headers, body).await?;
        match (status, code.as_str()) {
            (422, "limit-exceeded") => covered.push(fault(op_name, 422)),
            (412, _) => {
                return Err(format!(
                    "{op_name} answered 412 for an If-Match against `ifMatch: false`. 412 says the \
                     guard was EVALUATED and failed, so the caller retries with a fresher rev for \
                     ever; the dual requires 422, which says the guard is not offered here"
                ))
            }
            (s, c) => {
                return Err(format!(
                    "expected 422 limit-exceeded for If-Match on {op_name}, got {s} / {c}"
                ))
            }
        }
    }

    // THE OUT-OF-VOCABULARY GUARD STILL ANSWERS 400 ON THE SAME SUBJECT, which is what stops this
    // case being satisfied by a binding that 422s every header it does not like.
    let mut headers = ctype("application/json-patch+json");
    headers.push(("if-none-match".into(), "*".into()));
    let (status, _) = raw_problem(
        host,
        "PATCH",
        "/dual-target",
        headers,
        br#"[{"op":"replace","path":"/properties/text","value":"x"}]"#,
    )
    .await?;
    if status != 400 {
        return Err(format!(
            "`If-None-Match` on patch answered {status}; `ifAbsent` is not a field of `PatchCaps` \
             at all, so it is an input patch does not define (400) and NOT an unadvertised bound \
             (422). Collapsing them tells a client to stop using a parameter that is merely \
             unavailable here"
        ));
    }

    Ok(covered)
}


// ---- harness ----------------------------------------------------------------

#[tokio::test(flavor = "current_thread")]
async fn tier1_gate() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let addr = listener.local_addr().expect("local addr").to_string();
    let server = Server::new(InMemScope::new("gate"));

    // A SECOND SUBJECT, because three declared rows are unreachable against the first. The
    // permissive reference advertises every guard as supported, so a `limit-exceeded` has nothing
    // to refuse; `InMemScope::restricted` advertises `ifMatch`, `ifAbsent` and `clientProposedId`
    // as false while implementing the same store. Coverage is the UNION over both, because a row
    // is a row about the binding and not about which subject provoked it.
    let rlistener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback (restricted)");
    let raddr = rlistener.local_addr().expect("local addr").to_string();
    let rserver = Server::new(InMemScope::restricted("gate-restricted"));

    tokio::select! {
        r = server.serve(listener) => panic!("server stopped before cases finished: {r:?}"),
        r = rserver.serve(rlistener) => panic!("restricted server stopped early: {r:?}"),
        () = run_cases(addr, raddr) => {}
    }
}

/// ANTI-VACUITY BACKSTOP: every case must FAIL against a subject that advertises the full primitive
/// set and implements none of it, and ZERO denominator rows may be reported covered.
///
/// This is the only structural defence available, and it is needed because `record()` sees a case's
/// verdict, never the `BdpResult` behind it — so it cannot itself refuse a `not_implemented`. The
/// signal is an `Ok`, by design: the server answers `501` for an unimplemented op and the client
/// converts that to `Ok(BdpResult::not_implemented())`, because `RemoteScope` is itself a
/// `BdpScope`. A case that merely propagates errors therefore PASSES against a subject that does
/// nothing, and the false green is the EASY path rather than an edge case.
///
/// That is not hypothetical: `delete+erased` was vacuous for exactly this reason, passing with its
/// seed never having run and falsely claiming two rows. Per-case `not_implemented` checks are the
/// first line, but they rely on every future author remembering. This test does not.
///
/// Adapted from Shelly's `null_subject.rs` on the reference backends, which reports 0 pass / 38
/// fail against her grid.
#[tokio::test(flavor = "current_thread")]
async fn no_case_passes_against_a_subject_that_implements_nothing() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let addr = listener.local_addr().expect("local addr").to_string();
    let server = Server::new(NullScope);

    tokio::select! {
        r = server.serve(listener) => panic!("server stopped before cases finished: {r:?}"),
        (covered, failures) = collect_cases(addr) => {
            let denom = denominator();
            let allowed: BTreeSet<SurfaceId> = SCOPE_INDEPENDENT_ROWS
                .iter()
                .map(|(op, status)| SurfaceId::Fault((*op).to_string(), *status))
                .collect();

            let claimed: Vec<&SurfaceId> =
                covered.intersection(&denom).filter(|r| !allowed.contains(r)).collect();
            assert!(
                claimed.is_empty(),
                "VACUOUS CASES: {} scope-dependent denominator row(s) were reported covered by a \
                 scope that implements NOTHING: {}.\nEach of those cases passes without the \
                 behaviour it claims to verify. Make it reject a `not_implemented` response and \
                 verify its own seeds. If a row genuinely does not depend on the scope, add it to \
                 SCOPE_INDEPENDENT_ROWS with the reason — do not widen this assertion.",
                claimed.len(),
                render(&claimed)
            );

            // The allowlist must stay honest in the other direction too: a row listed as
            // scope-independent that NO LONGER passes here has become scope-dependent, and its
            // entry is now a lie that would mask a vacuous case.
            let stale: Vec<&SurfaceId> = allowed.difference(&covered).collect();
            assert!(
                stale.is_empty(),
                "SCOPE_INDEPENDENT_ROWS lists {} row(s) that the null scope did NOT produce: {}. \
                 They now depend on the scope, so remove them from the allowlist.",
                stale.len(),
                render(&stale)
            );

            assert!(
                !failures.is_empty(),
                "the null subject produced no failures at all — the harness is not running the cases"
            );
        }
    }
}

/// Rows the `Server` produces **before the scope is ever consulted**, so a null scope cannot and
/// should not make their cases fail. These are protocol-level faults, not store behaviour:
///
/// - `create/400` and `put/400` are JSON **body-parse** failures, raised in `do_create` / `do_put`
///   after routing has already succeeded (`bad CreateRequest: …`) — NOT malformed-id rejections.
///   The route-parsing `400`s (`Route::Unroutable`, and a bare `-` id segment) are real but no case
///   in this list uses them.
/// - `patch/415` is the request media-type check at the top of `do_patch`.
/// - `patch/400` and `delete/400` are the two new pre-scope rejections: the out-of-vocabulary
///   `If-None-Match` guard on either op, and a `patch` body that is not a JSON-Patch array. All
///   three are decided from the request alone — a guard the operation does not define, or a body
///   that is not the declared document shape, is malformed whatever the store holds — so they
///   belong here on the same ground as `create/400`, not as an exception to it.
///
/// This comment previously said "the four `400`s are malformed-id rejections decided in route
/// parsing" and "5 of the covered rows" — wrong on the count (there are two `400`s and three
/// entries) and wrong on the mechanism. It mattered because this prose is the ONLY record of why a
/// row is allowlisted: the tuple is `(&str, u16)` and cannot hold a reason, while the failure
/// message tells an author to "add it to SCOPE_INDEPENDENT_ROWS with the reason". An audit trail
/// that is already wrong about its own contents cannot show whether an entry is legitimate or was
/// added to silence a failure — which this comment itself calls defeating the whole test.
///
/// This list is a statement about the gate's own composition, surfaced by the anti-vacuity test
/// rather than assumed: **5 of the covered rows exercise the protocol layer, not the store.** The
/// test asserts this set exactly — both that nothing outside it survives a null scope, and that
/// everything in it still does. Adding an entry to silence a failure, rather than because the row
/// is genuinely produced pre-scope, defeats the whole test.
const SCOPE_INDEPENDENT_ROWS: &[(&str, u16)] = &[
    ("create", 400),
    ("delete", 400),
    // The BINDING refuses a malformed import before the scope is reached: a stream that does not
    // end with `ExportEnd`, a request that is not `application/jsonl`, and a strategy outside the
    // closed vocabulary are all decided in `do_import` by reading the request alone. So this row
    // is produced identically by a scope that implements nothing, exactly like its four
    // neighbours here. Its sibling `import/422` is NOT in this list and must not be: that one is
    // the capability dual and comes from the SCOPE refusing an advertised-false mode, so it is
    // scope-dependent and the backstop correctly leaves it alone. Two fault rows on one op, two
    // different producers — which is the distinction this list exists to make.
    ("import", 400),
    ("patch", 400),
    ("patch", 415),
    ("put", 400),
];

/// A subject that ADVERTISES every primitive and IMPLEMENTS none. `get` is the one mandatory trait
/// method, so it answers the not-implemented signal explicitly; everything else falls through to the
/// trait default, which does the same. Advertising the full set is the point: it makes the subject
/// claim conformance it does not have, which is the condition the cases must detect.
struct NullScope;

impl BdpScope for NullScope {
    /// A null SUBJECT still has to state its traits — they are what a trait-dependent case keys
    /// on, and refusing to state them would make this scope unreadable rather than merely
    /// unimplemented. `Versioned` + `Permanent` is the legal pair that lets such a case run at
    /// all, so any row it then claims is claimed on the strength of behaviour it did not provide.
    fn scope_capabilities(&self) -> ScopeCapabilities {
        ScopeCapabilities {
            storage_classes: vec![StorageClass::Ephemeral],
            revision_model: RevisionModel::Versioned,
            id_model: IdModel::Permanent,
        }
    }

    fn capabilities(&self) -> Vec<PrimitiveCapabilities> {
        vec![
            PrimitiveCapabilities::Get(GetCaps { selector: false }),
            PrimitiveCapabilities::Create(CreateCaps {
                server_allocates_id: true,
                client_proposed_id: true,
            }),
            PrimitiveCapabilities::Put(PutCaps { if_match: true, if_absent: true }),
            PrimitiveCapabilities::Patch(PatchCaps { if_match: true }),
            PrimitiveCapabilities::Delete(DeleteCaps { if_match: true }),
        ]
    }

    async fn get(
        &self,
        _r: &ResourceId,
        _selector: Option<&Selector>,
    ) -> Result<BdpResult<Representation>, BdpError> {
        Ok(BdpResult::not_implemented())
    }
}

async fn run_cases(addr: String, restricted_addr: String) {
    let (mut covered, mut failures) = collect_cases(addr).await;
    record(
        "capability duals (restricted subject)",
        &mut covered,
        &mut failures,
        the_capability_duals_are_refused_422(&restricted_addr),
    )
    .await;

    // ---- coverage report ----
    let denom = denominator();
    let covered_in_denom: BTreeSet<&SurfaceId> = covered.intersection(&denom).collect();
    let uncovered: Vec<&SurfaceId> = denom.difference(&covered).collect();

    eprintln!("\n=== BDP tier-1 gate ===");
    // DELIBERATELY NO COMMIT AND NO ROW COUNT HERE. This line used to read "pin: gastownhall/bdp
    // main @488a2d01 (v0.2.3; paths block sha256 4bf1225b…) — surface 54 rows", and every part of
    // that went stale: the surface has since been 47, 48 and 50, while the line kept printing 54
    // above a coverage figure computed live from the same file. A stale provenance claim on top of
    // a live measurement is worse than no claim, because it reads as the measurement's source.
    // The denominator is read from the working tree at run time, so the tree IS the pin; `git
    // rev-parse HEAD` names it, and nothing hand-written here can be more current than that.
    eprintln!("spec version: v0.2.3 (tier-1 surface)");
    eprintln!("denominator source: specs/generated/openapi/core.openapi.json (live, drift-gated)");
    eprintln!("surface: {} rows, derived at run time, not pinned here", denom.len());
    eprintln!("coverage: {}/{} surface rows", covered_in_denom.len(), denom.len());
    let mut covered_sorted: Vec<&SurfaceId> = covered_in_denom.iter().copied().collect();
    covered_sorted.sort();
    eprintln!("  covered: {}", render(&covered_sorted));
    eprintln!("  uncovered ({}): {}", uncovered.len(), render(&uncovered));
    eprintln!("=======================\n");

    // A case that should pass but failed is a real wire-level regression — always fail.
    assert!(failures.is_empty(), "tier-1 cases failed:\n  {}", failures.join("\n  "));

    // fail-if-no-coverage — blocking only under BDP_GATE_STRICT while tier-1 is still being filled.
    if std::env::var("BDP_GATE_STRICT").is_ok() {
        assert!(
            uncovered.is_empty(),
            "BDP_GATE_STRICT: {} denominator rows uncovered:\n  {}",
            uncovered.len(),
            render(&uncovered)
        );
    }
}

/// Run every case and return what they covered and how they failed, WITHOUT asserting — so the same
/// list can be run against a deliberately broken subject by the anti-vacuity test above.
async fn collect_cases(addr: String) -> (BTreeSet<SurfaceId>, Vec<String>) {
    let remote = RemoteScope::connect(addr.clone()).await.expect("connect (caps discovery)");

    let mut covered: BTreeSet<SurfaceId> = BTreeSet::new();
    let mut failures: Vec<String> = Vec::new();

    record("create+get", &mut covered, &mut failures, create_then_get(&remote)).await;
    record("get/404", &mut covered, &mut failures, get_missing_404(&remote)).await;
    record("create/409", &mut covered, &mut failures, create_duplicate_409(&remote)).await;
    record("delete+erased", &mut covered, &mut failures, delete_then_erased(&remote)).await;
    record("patch/410", &mut covered, &mut failures, patch_tombstone_410(&remote)).await;
    record("put", &mut covered, &mut failures, put_target(&remote)).await;
    record("put/412", &mut covered, &mut failures, put_stale_guard_412(&remote)).await;
    record("put/409", &mut covered, &mut failures, put_if_absent_taken_409(&remote)).await;
    record("put/410", &mut covered, &mut failures, put_tombstone_410(&remote)).await;
    record(
        "put unguarded updates",
        &mut covered,
        &mut failures,
        put_unguarded_still_updates(&remote),
    )
    .await;
    record("patch", &mut covered, &mut failures, patch_ok(&remote)).await;
    record("patch/404", &mut covered, &mut failures, patch_missing_404(&remote)).await;
    record("patch/412", &mut covered, &mut failures, patch_stale_412(&remote)).await;
    record("delete/412", &mut covered, &mut failures, delete_stale_412(&remote)).await;
    record("delete/404", &mut covered, &mut failures, delete_never_existed_404(&remote)).await;
    record("delete idempotent", &mut covered, &mut failures, delete_twice_is_idempotent(&remote)).await;
    record("list", &mut covered, &mut failures, list_the_scopes_resources(&remote)).await;
    record(
        "filtered list refused",
        &mut covered,
        &mut failures,
        a_filtered_list_is_refused_not_ignored(&remote),
    )
    .await;
    record("export", &mut covered, &mut failures, export_is_jsonl_framed(&remote)).await;
    record(
        "advertises what it forwards",
        &mut covered,
        &mut failures,
        the_client_advertises_what_it_forwards(&remote),
    )
    .await;
    record("revisions", &mut covered, &mut failures, revisions_history_is_addressable(&remote)).await;
    record("revisions/404", &mut covered, &mut failures, revisions_never_existed_404(&remote)).await;
    record(
        "revisions survive retirement",
        &mut covered,
        &mut failures,
        revisions_survive_retirement(&remote),
    )
    .await;
    record("call", &mut covered, &mut failures, call_success(&remote)).await;
    record("call/409", &mut covered, &mut failures, call_declared_failure_409(&remote)).await;
    record(
        "call unresolvable never ran",
        &mut covered,
        &mut failures,
        call_unresolvable_operation_never_ran(&remote),
    )
    .await;
    record(
        "async call mints a pending handle",
        &mut covered,
        &mut failures,
        an_async_call_mints_a_pending_handle(&remote),
    )
    .await;
    record("cancel", &mut covered, &mut failures, cancel_a_running_handle(&remote)).await;
    record("cancel/404", &mut covered, &mut failures, cancel_absent_handle_404(&remote)).await;
    record("cancel/409", &mut covered, &mut failures, cancel_a_settled_handle_409(&remote)).await;
    record(
        "cancel of a non-handle",
        &mut covered,
        &mut failures,
        cancel_of_a_non_handle_does_not_resolve(&remote),
    )
    .await;
    record(
        "cancel refuses a pinned handle",
        &mut covered,
        &mut failures,
        cancel_refuses_a_pinned_handle(&remote),
    )
    .await;
    record(
        "list+revisions/400 invalid limit",
        &mut covered,
        &mut failures,
        an_invalid_limit_is_an_invalid_parameter_400(&addr),
    )
    .await;
    record(
        "export/400 ordinal resume",
        &mut covered,
        &mut failures,
        export_rejects_an_ordinal_resume_400(&addr),
    )
    .await;
    record("import", &mut covered, &mut failures, import_round_trips_an_export(&remote)).await;
    record("import/400 truncated", &mut covered, &mut failures, import_truncated_stream_400(&addr)).await;
    record(
        "import/400 media type",
        &mut covered,
        &mut failures,
        import_wrong_media_type_400(&addr),
    )
    .await;
    record(
        "import/422 history-restore",
        &mut covered,
        &mut failures,
        import_history_restore_is_refused_422(&addr),
    )
    .await;
    record(
        "import unknown strategy",
        &mut covered,
        &mut failures,
        import_unknown_strategy_is_malformed(&addr),
    )
    .await;
    record("create/400 (raw)", &mut covered, &mut failures, create_malformed_400(&addr)).await;
    record("put/400 (raw)", &mut covered, &mut failures, put_malformed_400(&addr)).await;
    record(
        "patch/400 non-array body (raw)",
        &mut covered,
        &mut failures,
        patch_non_array_body_400(&addr),
    )
    .await;
    record(
        "patch/400 out-of-vocabulary guard (raw)",
        &mut covered,
        &mut failures,
        patch_out_of_vocabulary_guard_400(&addr),
    )
    .await;
    record("patch/415 (raw)", &mut covered, &mut failures, patch_wrong_media_type_415(&addr)).await;
    record(
        "patch/415 absent ctype (raw)",
        &mut covered,
        &mut failures,
        patch_absent_media_type_415(&addr),
    )
    .await;
    record(
        "patch right media type (raw)",
        &mut covered,
        &mut failures,
        patch_correct_media_type_is_accepted(&addr),
    )
    .await;
    // LAST ON PURPOSE. It targets `/patch-target` so that a `400` there proves the GUARD fired
    // rather than a `404` standing in for it — but if the guard check were ever removed, the
    // request would succeed and retire the id. Running it after the last case that needs that id
    // keeps the failure to this one case instead of cascading.
    record(
        "delete/400 out-of-vocabulary guard (raw)",
        &mut covered,
        &mut failures,
        delete_out_of_vocabulary_guard_400(&addr),
    )
    .await;

    (covered, failures)
}

fn render(rows: &[&SurfaceId]) -> String {
    if rows.is_empty() {
        return "(none)".into();
    }
    rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", ")
}
