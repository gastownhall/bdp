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

/// `PATCH /{id}` of an existing resource with an unprocessable patch body → 422. Covers
/// op/patch/fault/422. Targets `/patch-target` (seeded by the typed `patch` case earlier in the run)
/// so the handler passes the existence check and reaches patch validation.
async fn patch_unprocessable_422(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/json-patch+json"),
        b"not a patch",
    )
    .await?
    {
        422 => Ok(vec![fault("patch", 422)]),
        s => Err(format!("expected 422 on an unprocessable patch, got {s}")),
    }
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


/// RETIRED, not lost: `get/400` and `delete/400`.
///
/// Both were produced by the router rejecting a `:`-bearing id as an unknown verb — the prototype's
/// `id:verb` convention, which the 0.2.3 action fence replaces. A `:` is now an ordinary id
/// character, so `GET /a:b:c` is a well-formed read of an absent resource and correctly answers
/// 404.
///
/// There is NO spec-grounded producer to move them to. `400` is declared on 11 of the 13 operations
/// and Appendix D.8 — which names a producer for 404, 405, 409, 410, 412 and 415 — names none for
/// it. The only `400` the spec grounds is a length-related one it attributes to intermediaries
/// rather than the origin.
///
/// `create/400` and `put/400` SURVIVED the same change, and the difference is the point: they
/// malform the BODY on a valid route, which is a real producer. These two malformed the ID, which
/// was only a producer because of the convention. Four rows looked at risk; two actually were.
///
/// Recorded uncovered-with-reason rather than kept alive by retaining a dead convention.

// ---- harness ----------------------------------------------------------------

#[tokio::test(flavor = "current_thread")]
async fn tier1_gate() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let addr = listener.local_addr().expect("local addr").to_string();
    let server = Server::new(InMemScope::new("gate"));

    tokio::select! {
        r = server.serve(listener) => panic!("server stopped before cases finished: {r:?}"),
        () = run_cases(addr) => {}
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
/// - the four `400`s are malformed-id rejections decided in route parsing (`Route::Unroutable`);
/// - `patch/415` is the request media-type check at the top of `do_patch`.
///
/// This list is a statement about the gate's own composition, surfaced by the anti-vacuity test
/// rather than assumed: **5 of the covered rows exercise the protocol layer, not the store.** The
/// test asserts this set exactly — both that nothing outside it survives a null scope, and that
/// everything in it still does. Adding an entry to silence a failure, rather than because the row
/// is genuinely produced pre-scope, defeats the whole test.
const SCOPE_INDEPENDENT_ROWS: &[(&str, u16)] = &[
    ("create", 400),
    ("put", 400),
    ("patch", 415),
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

async fn run_cases(addr: String) {
    let (covered, failures) = collect_cases(addr).await;

    // ---- coverage report ----
    let denom = denominator();
    let covered_in_denom: BTreeSet<&SurfaceId> = covered.intersection(&denom).collect();
    let uncovered: Vec<&SurfaceId> = denom.difference(&covered).collect();

    eprintln!("\n=== BDP tier-1 gate ===");
    eprintln!("pin: gastownhall/bdp main @488a2d01 (v0.2.3; paths block sha256 4bf1225b…)");
    eprintln!("denominator source: specs/generated/openapi/core.openapi.json (live, drift-gated)");
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
    record("create/400 (raw)", &mut covered, &mut failures, create_malformed_400(&addr)).await;
    record("put/400 (raw)", &mut covered, &mut failures, put_malformed_400(&addr)).await;
    record("patch/422 (raw)", &mut covered, &mut failures, patch_unprocessable_422(&addr)).await;
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

    (covered, failures)
}

fn render(rows: &[&SurfaceId]) -> String {
    if rows.is_empty() {
        return "(none)".into();
    }
    rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", ")
}
