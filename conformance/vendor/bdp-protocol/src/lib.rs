//! `bdp-protocol` — a thin BDP HTTP protocol spike over the shared `BdpScope` trait.
//!
//! Two symmetric pieces over the one `bdp_primitives::BdpScope` trait:
//!   1. [`Server`] wraps any `impl BdpScope` and exposes the primitives over HTTP;
//!   2. [`RemoteScope`] ITSELF `impl BdpScope`, calling the server over HTTP — so a remote scope
//!      is drop-in for a local one. That symmetry is the point.
//!
//! This is a SPIKE to surface friction between the wire protocol and the Core trait, NOT a
//! conformant server. Spike coverage is the single-resource core (get/create/put/patch/delete);
//! scope-level and streaming ops answer `501`. The running list of trait↔wire mismatches is the
//! real deliverable — see `NOTES.md`. Spec pin: `PIN.md` (gastownhall/bdp @ b555931c).

#![allow(async_fn_in_trait)]

pub mod client;
pub mod http;
pub mod route;
pub mod server;
pub mod wire;

pub use bdp_primitives::BdpScope;
pub use client::RemoteScope;
pub use server::Server;
