//! `bdp-ref` — the conformance gate's single reference endpoint.
//!
//! Serves an in-memory BDP scope over HTTP. The wire-level conformance harness connects a
//! `RemoteScope` to this address and runs the case suite black-box. In CI this runs as a
//! background process (`bdp-ref &`) and the gate job points the harness at `$BDP_REF_ADDR`.
//!
//! Pin-agnostic by construction: it wires `Server` to `InMemScope` and serves whatever that
//! scope implements — the spec pin (`ca298b04`) governs the CASES, never this binary.

use bdp_inmem::InMemScope;
use bdp_protocol::Server;
use tokio::net::TcpListener;

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::io::Result<()> {
    // Default to a fixed port for CI; `127.0.0.1:0` lets the OS pick an ephemeral one locally.
    let addr = std::env::var("BDP_REF_ADDR").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let listener = TcpListener::bind(&addr).await?;
    let local = listener.local_addr()?;
    let base = format!("http://{local}");

    // Announce the bound address on stderr so a CI runner / local script can read it back.
    eprintln!("bdp-ref: serving InMemScope(\"gate\") at {base}");

    let server = Server::new(InMemScope::new("gate")).with_public_base(base);
    server.serve(listener).await
}
