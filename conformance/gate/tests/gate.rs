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
    BdpError, BdpScope, CreateBody, Id, JsonPatch, Kind, RawJson, Rev, ResourceId, Scope,
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
    r.create(Some(id.clone()), note_body("first"))
        .await
        .map_err(|e| format!("create #1 transport: {e:?}"))?;
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
    let seeded = r
        .put(target.clone(), note_body("to-erase"))
        .await
        .map_err(|e| format!("seed put: {e:?}"))?;
    if seeded.not_implemented {
        return Err("seed put advertised but not_implemented — the tombstone precondition never ran".into());
    }
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
    match r.get(&target, None).await {
        Err(BdpError::Erased { .. }) => Ok(vec![op("delete"), fault("get", 410)]),
        other => Err(format!("expected Erased (410) after delete, got {other:?}")),
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
    let seeded = r.put(target.clone(), note_body("v0")).await.map_err(|e| format!("seed put: {e:?}"))?;
    if seeded.not_implemented {
        return Err("seed put advertised but not_implemented".into());
    }
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

/// An RFC-6902-subset JSON Patch as the wire body.
fn json_patch(body: &str) -> JsonPatch {
    JsonPatch(RawJson(Bytes::from(body.as_bytes().to_vec())))
}

/// `patch` an existing resource with a delta. Covers op/patch.
async fn patch_ok(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("patch-target".into()));
    r.put(target.clone(), note_body("v0"))
        .await
        .map_err(|e| format!("seed put: {e:?}"))?;
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
    r.put(target.clone(), note_body("v0"))
        .await
        .map_err(|e| format!("seed put: {e:?}"))?;
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
    r.put(target.clone(), note_body("v0"))
        .await
        .map_err(|e| format!("seed put: {e:?}"))?;
    match r.delete(target, Some(Rev("stale-rev".into()))).await {
        Err(BdpError::RevisionMismatch { .. }) => Ok(vec![fault("delete", 412)]),
        other => Err(format!("expected RevisionMismatch (412), got {other:?}")),
    }
}

/// `put` a resource at a target id. Covers op/put.
async fn put_target(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-target".into()));
    let res = r
        .put(target, note_body("put-value"))
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

/// A malformed resource id in the path → 400 bad-request. Covers op/get/fault/400.
async fn get_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "GET", "/a:b:c", vec![], b"").await? {
        400 => Ok(vec![fault("get", 400)]),
        s => Err(format!("expected 400 on a malformed id, got {s}")),
    }
}

/// `POST /` (create) with a non-JSON body → 400 bad-request. Covers op/create/fault/400.
async fn create_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "POST", "/", ctype("application/json"), b"}{ not json").await? {
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

/// `DELETE` of a malformed id → 400 bad-request. Covers op/delete/fault/400.
async fn delete_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "DELETE", "/a:b:c", vec![], b"").await? {
        400 => Ok(vec![fault("delete", 400)]),
        s => Err(format!("expected 400 on a malformed id, got {s}")),
    }
}

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

async fn run_cases(addr: String) {
    let remote = RemoteScope::connect(addr.clone()).await.expect("connect (caps discovery)");

    let mut covered: BTreeSet<SurfaceId> = BTreeSet::new();
    let mut failures: Vec<String> = Vec::new();

    record("create+get", &mut covered, &mut failures, create_then_get(&remote)).await;
    record("get/404", &mut covered, &mut failures, get_missing_404(&remote)).await;
    record("create/409", &mut covered, &mut failures, create_duplicate_409(&remote)).await;
    record("delete+erased", &mut covered, &mut failures, delete_then_erased(&remote)).await;
    record("put", &mut covered, &mut failures, put_target(&remote)).await;
    record("patch", &mut covered, &mut failures, patch_ok(&remote)).await;
    record("patch/404", &mut covered, &mut failures, patch_missing_404(&remote)).await;
    record("patch/412", &mut covered, &mut failures, patch_stale_412(&remote)).await;
    record("delete/412", &mut covered, &mut failures, delete_stale_412(&remote)).await;
    record("delete/404", &mut covered, &mut failures, delete_never_existed_404(&remote)).await;
    record("delete idempotent", &mut covered, &mut failures, delete_twice_is_idempotent(&remote)).await;
    record("get/400 (raw)", &mut covered, &mut failures, get_malformed_400(&addr)).await;
    record("create/400 (raw)", &mut covered, &mut failures, create_malformed_400(&addr)).await;
    record("put/400 (raw)", &mut covered, &mut failures, put_malformed_400(&addr)).await;
    record("patch/422 (raw)", &mut covered, &mut failures, patch_unprocessable_422(&addr)).await;
    record("delete/400 (raw)", &mut covered, &mut failures, delete_malformed_400(&addr)).await;

    // ---- coverage report ----
    let denom = denominator();
    let covered_in_denom: BTreeSet<&SurfaceId> = covered.intersection(&denom).collect();
    let uncovered: Vec<&SurfaceId> = denom.difference(&covered).collect();

    eprintln!("\n=== BDP tier-1 gate ===");
    eprintln!("pin: gastownhall/bdp main @aa439827 (v0.2.3, #405 merge)");
    eprintln!("denominator source: specs/generated/openapi/core.openapi.json (live, drift-gated)");
    eprintln!(
        "coverage: {}/{} surface rows",
        covered_in_denom.len(),
        denom.len()
    );
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

fn render(rows: &[&SurfaceId]) -> String {
    if rows.is_empty() {
        return "(none)".into();
    }
    rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", ")
}
