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
use bdp_primitives::{BdpError, BdpScope, CreateBody, Id, Kind, RawJson, ResourceId, Scope};
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
    r.put(target.clone(), note_body("to-erase"))
        .await
        .map_err(|e| format!("seed put: {e:?}"))?;
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
    let remote = RemoteScope::connect(addr).await.expect("connect (caps discovery)");

    let mut covered: BTreeSet<SurfaceId> = BTreeSet::new();
    let mut failures: Vec<String> = Vec::new();

    record("create+get", &mut covered, &mut failures, create_then_get(&remote)).await;
    record("get/404", &mut covered, &mut failures, get_missing_404(&remote)).await;
    record("create/409", &mut covered, &mut failures, create_duplicate_409(&remote)).await;
    record("delete+erased", &mut covered, &mut failures, delete_then_erased(&remote)).await;
    record("put", &mut covered, &mut failures, put_target(&remote)).await;

    // ---- coverage report ----
    let denom = denominator();
    let covered_in_denom: BTreeSet<&SurfaceId> = covered.intersection(&denom).collect();
    let uncovered: Vec<&SurfaceId> = denom.difference(&covered).collect();

    eprintln!("\n=== BDP tier-1 gate ===");
    eprintln!("pin: gastownhall/bdp #405 @7aaecec2 (v0.2.3 draft)");
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
