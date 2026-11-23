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
    BdpError, BdpResult, BdpScope, CreateBody, CreateCaps, DeleteCaps, GetCaps, Id, JsonPatch, Kind,
    PatchCaps, PrimitiveCapabilities, PutCaps, RawJson, Representation, ResourceId, Rev, Scope,
    Selector,
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
        .put(target.clone(), note_body(text))
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
    ("get", 400),
    ("create", 400),
    ("put", 400),
    ("delete", 400),
    ("patch", 415),
];

/// A subject that ADVERTISES every primitive and IMPLEMENTS none. `get` is the one mandatory trait
/// method, so it answers the not-implemented signal explicitly; everything else falls through to the
/// trait default, which does the same. Advertising the full set is the point: it makes the subject
/// claim conformance it does not have, which is the condition the cases must detect.
struct NullScope;

impl BdpScope for NullScope {
    fn capabilities(&self) -> Vec<PrimitiveCapabilities> {
        vec![
            PrimitiveCapabilities::Get(GetCaps { selector: false }),
            PrimitiveCapabilities::Create(CreateCaps {
                server_allocates_id: true,
                client_proposed_id: true,
            }),
            PrimitiveCapabilities::Put(PutCaps {}),
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
    eprintln!("pin: gastownhall/bdp main @2dfc097f (v0.2.3; paths block sha256 770e3ccc…)");
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
    record("delete/400 (raw)", &mut covered, &mut failures, delete_malformed_400(&addr)).await;

    (covered, failures)
}

fn render(rows: &[&SurfaceId]) -> String {
    if rows.is_empty() {
        return "(none)".into();
    }
    rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", ")
}
