//! End-to-end liveness for the conformance gate's wire loop.
//!
//! A `RemoteScope` drives a `Server` over real HTTP on loopback — discovery (`GET /:capabilities`
//! on connect) plus a `create` → `get` round-trip. This is **pin-agnostic**: it asserts the
//! MECHANISM (client ⇄ server over the wire, a write and a read actually cross a socket), not any
//! spec-normative behavior. The re-derived spec cases (gated on the lumendoc `--to surfaces`
//! emitter) slot into this same wiring later.
//!
//! Mirrors `bdp-conformance::transport::run_protocol`: serve until the client half finishes, then
//! drop the server via `select!`.

use bdp_inmem::InMemScope;
use bdp_primitives::{BdpScope, CreateBody, Id, Kind, RawJson, ResourceId, Scope};
use bdp_protocol::{RemoteScope, Server};
use bytes::Bytes;
use tokio::net::TcpListener;

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

#[tokio::test(flavor = "current_thread")]
async fn remote_scope_drives_reference_over_http() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let addr = listener.local_addr().expect("local addr");
    let server = Server::new(InMemScope::new("liveness"));

    // The server runs until the client half completes; then `select!` drops it.
    tokio::select! {
        r = server.serve(listener) => panic!("server stopped before the client finished: {r:?}"),
        out = client_half(addr.to_string()) => out.expect("liveness round-trip failed"),
    }
}

async fn client_half(addr: String) -> Result<(), String> {
    // `connect` does a real `GET /:capabilities` over the wire and proxies the scope's caps.
    let remote = RemoteScope::connect(addr)
        .await
        .map_err(|e| format!("connect (caps discovery): {e:?}"))?;

    if remote.capabilities().is_empty() {
        return Err("capabilities empty after connect — discovery did not round-trip".into());
    }

    // `create` (id = None → server allocates): a write primitive crossing the socket.
    let created = remote
        .create(None, note_body("hi"))
        .await
        .map_err(|e| format!("create transport error: {e:?}"))?;
    if created.not_implemented {
        return Err("create advertised but returned not_implemented".into());
    }
    let id = created.value.ok_or("create ok but returned no id")?;

    // `get` the just-created resource back over the wire.
    let got = remote
        .get(&id, None)
        .await
        .map_err(|e| format!("get transport error: {e:?}"))?;
    if got.not_implemented || got.value.is_none() {
        return Err("get returned no representation for the just-created id".into());
    }

    Ok(())
}
