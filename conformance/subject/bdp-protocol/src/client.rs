//! The CLIENT: `RemoteScope` IS a `BdpScope`, calling a `Server` over HTTP. The symmetry is the
//! point — a remote scope substitutes for a local one at the same trait. It forwards only the
//! primitives the spike maps (get/create/put/patch/delete/apply + resolve_alias); every other
//! primitive inherits the trait's `not_implemented` default.
//!
//! `capabilities()` PROXIES the backing scope's advertised set (fetched once at `connect`), so the
//! wire faithfully represents the real scope — Donna's ruling makes advertised⟹implemented a
//! conformance requirement, and a fixed, guessed cap set violates it two ways (Connie findings
//! 1 & 2): it drops the `Unversioned` flag (unpinned refs look pinned) and advertises ops the
//! backend lacks (501 on an advertised op). The proxied set is INTERSECTED with the ops this
//! `RemoteScope` actually forwards, so it never advertises something it would itself answer
//! `not_implemented` for (the same rule, applied to the client).

use std::sync::Arc;

use bdp_primitives as p;
use bdp_primitives::BdpScope;

use crate::http::{pct_encode, send, Outgoing};
use crate::wire::{WireCreateRequest, WireProblem, WireRepresentation, WireResourceId, WireWrite};

pub struct RemoteScope {
    host: String, // "127.0.0.1:PORT"
    /// The backing scope's advertised capabilities, fetched once at `connect`. `capabilities()`
    /// returns these filtered to what this client forwards.
    caps: Vec<p::PrimitiveCapabilities>,
    /// The backing scope's own TRAITS, fetched at `connect` alongside the primitive list. Passed
    /// through verbatim: unlike the primitive list these are not filtered, because they describe
    /// the STORE rather than this client's forwarding surface, and a client that filtered them
    /// would be reporting guarantees it does not make.
    scope_caps: p::ScopeCapabilities,
}

/// The ops `RemoteScope` actually forwards over the wire, plus scope-level flags it passes through
/// faithfully (`Unversioned`). Anything else the backend advertises is NOT re-advertised, because
/// this client would answer `not_implemented` for it — advertised⟹implemented, applied to the client.
fn remote_forwards(cap: &p::PrimitiveCapabilities) -> bool {
    use p::PrimitiveCapabilities as C;
    matches!(
        cap,
        C::Get(_) | C::Create(_) | C::Put(_) | C::Patch(_) | C::Delete(_) | C::Apply(_) | C::Aliases(_) | C::Unversioned(_)
    )
}

impl RemoteScope {
    /// Connect to a `Server` at `host` ("ip:port") and PROXY its scope's advertised capabilities,
    /// so this `RemoteScope` faithfully represents the backing scope. (A full impl would take the
    /// scope's base URL and read `discovery`; the spike pins one scope == one server root.)
    pub async fn connect(host: impl Into<String>) -> Result<Self, p::BdpError> {
        let host = host.into();
        let (scope_caps, caps) = fetch_capabilities(&host).await?;
        Ok(Self { host, caps, scope_caps })
    }

    /// Construct with a known capability set and no discovery round-trip (tests / embedding).
    /// The scope traits must be supplied too: there is no safe default, since guessing one would
    /// have this client assert a guarantee the backing store may not make.
    pub fn with_capabilities(
        host: impl Into<String>,
        scope_caps: p::ScopeCapabilities,
        caps: Vec<p::PrimitiveCapabilities>,
    ) -> Self {
        Self { host: host.into(), caps, scope_caps }
    }

    async fn request(
        &self,
        method: &str,
        target: &str,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) -> Result<crate::http::HttpResponse, p::BdpError> {
        send(Outgoing { method, host: &self.host, target, headers, body })
            .await
            .map_err(|e| p::BdpError::Backend(format!("transport: {e}")))
    }
}

/// Fetch the server scope's advertised capabilities (`GET /:capabilities`), decoded to the trait
/// form, so `RemoteScope` can proxy them. A free fn so `connect` can call it before `Self` exists.
async fn fetch_capabilities(
    host: &str,
) -> Result<(p::ScopeCapabilities, Vec<p::PrimitiveCapabilities>), p::BdpError> {
    let resp = send(Outgoing { method: "GET", host, target: "/:capabilities", headers: vec![], body: vec![] })
        .await
        .map_err(|e| p::BdpError::Backend(format!("transport: {e}")))?;
    if resp.status == 200 {
        let wire: crate::wire::WireDiscovery = serde_json::from_slice(&resp.body)
            .map_err(|e| p::BdpError::Backend(format!("bad capabilities response: {e}")))?;
        let scope = wire
            .scope
            .to_trait()
            .map_err(|e| p::BdpError::Backend(format!("bad scope capabilities: {e}")))?;
        Ok((scope, crate::wire::caps_from_wire(wire.primitives)))
    } else {
        Err(p::BdpError::Backend(format!("capabilities discovery failed: http {}", resp.status)))
    }
}

fn target_for(id: &p::Id, rev: Option<&p::Rev>) -> String {
    match rev {
        Some(r) => format!("/{}?revision={}", pct_encode(&id.0), pct_encode(&r.0)),
        None => format!("/{}", pct_encode(&id.0)),
    }
}

/// Decode a non-2xx response into a `BdpError`, using the Problem `code` when present.
fn error_from(status: u16, body: &[u8], rid: &p::ResourceId) -> p::BdpError {
    let prob = serde_json::from_slice::<WireProblem>(body).ok();
    let code = prob.as_ref().map(|pb| pb.code.as_str());
    match (status, code) {
        (404, _) => p::BdpError::NotFound(rid.clone()),
        (410, Some("cursor-expired")) => p::BdpError::CursorExpired(p::Cursor(bytes::Bytes::new())),
        (410, _) => p::BdpError::Erased { id: rid.clone(), at: rid.rev.clone().unwrap_or(p::Rev(Arc::from(""))) },
        (412, _) => p::BdpError::RevisionMismatch {
            id: rid.clone(),
            expected: rid.rev.clone().unwrap_or(p::Rev(Arc::from(""))),
            found: None,
        },
        // Lydia §70: a `constraint-violation` 409 reconstructs the specific ConstraintViolation from
        // the `constraint` discriminator. Uniqueness is the blessed, fully-structured case
        // (property + existing holder); others degrade to a generic Cardinality carrier.
        (409, Some("constraint-violation")) => {
            let pb = prob.as_ref().expect("code came from a parsed problem");
            match pb.constraint.as_deref() {
                Some("uniqueness") => p::BdpError::Conflict(p::ConstraintViolation::Uniqueness {
                    fromprop: pb.property.clone().unwrap_or_default(),
                    to: p::ResourceId::head(
                        p::Scope::This,
                        p::Id(Arc::from(pb.conflicts_with.clone().unwrap_or_default().as_str())),
                    ),
                }),
                other => p::BdpError::Conflict(p::ConstraintViolation::Cardinality {
                    fromprop: pb.property.clone().unwrap_or_default(),
                    detail: format!("constraint {:?}: {}", other, pb.detail.clone().unwrap_or_default()),
                }),
            }
        }
        // Lydia §71: create-fail-if-exists is an existence conflict with its own code, distinct from
        // a declared constraint.
        (409, Some("already-exists")) => p::BdpError::AlreadyExists(rid.clone()),
        (409, _) => p::BdpError::Conflict(p::ConstraintViolation::Cardinality {
            fromprop: String::new(),
            detail: format!("server returned 409 {:?}", code),
        }),
        // Donna-ruled over-limit: reconstruct the structured rejection from the Problem's extension
        // members, so a caller sees WHICH advertised bound it exceeded (distinct from Unprocessable).
        (422, Some("limit-exceeded")) => {
            let pb = prob.as_ref().expect("code came from a parsed problem");
            p::BdpError::LimitExceeded {
                capability: pb.capability.clone().unwrap_or_default(),
                limit: pb.limit.clone().unwrap_or_default(),
                detail: pb.detail.clone().unwrap_or_default(),
            }
        }
        (422, _) => p::BdpError::Unprocessable(format!("server returned 422 {:?}", code)),
        (s, c) => p::BdpError::Backend(format!("http {s} {:?}", c)),
    }
}

/// Decode a write response (the bare pinned ref body) into the trait's write return. RESOLVED
/// (RECONCILE §1): the write return is now just the pinned `ResourceId` (rev = minted revision),
/// so `RemoteScope` reproduces it faithfully — no `created`/`op` synthesis. Create-vs-update is
/// read from the changefeed (`ChangeEvent.op`) when a caller needs it.
fn write_result(resp: &crate::http::HttpResponse) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
    let wref: WireResourceId = serde_json::from_slice(&resp.body)
        .map_err(|e| p::BdpError::Backend(format!("bad write response: {e}")))?;
    let reference = wref.to_trait();
    let mut res = p::BdpResult::ok(reference);
    // Envelope round-trips via BDP-* headers; fall back to the ref's own rev.
    res.protocol = crate::wire::protocol_from_headers(resp);
    if res.protocol.rev.is_none() {
        res.protocol.rev = res.value.as_ref().and_then(|r| r.rev.clone());
    }
    Ok(res)
}

impl BdpScope for RemoteScope {
    fn scope_capabilities(&self) -> p::ScopeCapabilities {
        // Verbatim, NOT filtered. These describe the backing store's guarantees; narrowing them
        // here would make this client claim a guarantee the store never made.
        self.scope_caps.clone()
    }

    fn capabilities(&self) -> Vec<p::PrimitiveCapabilities> {
        // Proxy the backing scope's advertised caps (incl. the Unversioned flag), filtered to the
        // ops this client forwards — never advertise what RemoteScope itself can't do.
        self.caps.iter().filter(|c| remote_forwards(c)).cloned().collect()
    }

    async fn get(
        &self,
        r: &p::ResourceId,
        _selector: Option<&p::Selector>,
    ) -> Result<p::BdpResult<p::Representation>, p::BdpError> {
        let target = target_for(&r.id, r.rev.as_ref());
        let resp = self.request("GET", &target, vec![], vec![]).await?;
        if resp.status == 200 {
            let wire: WireRepresentation = serde_json::from_slice(&resp.body)
                .map_err(|e| p::BdpError::Backend(format!("bad representation: {e}")))?;
            let rep = wire.to_trait();
            let mut res = p::BdpResult::ok(rep.clone());
            // Envelope round-trips via BDP-* headers; fall back to the representation's own rev.
            res.protocol = crate::wire::protocol_from_headers(&resp);
            if res.protocol.rev.is_none() {
                res.protocol.rev = rep.id().rev.clone();
            }
            Ok(res)
        } else if resp.status == 501 {
            // The backing scope doesn't support this op. RemoteScope IS a BdpScope, so it answers
            // with the not_implemented SIGNAL (Ok), not a transport error — mirroring the trait
            // default (Connie finding 4; also stops 501→500 drift one hop out, finding 3).
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, r))
        }
    }

    async fn resolve_alias(
        &self,
        name: &str,
    ) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        // aliases capability: GET /:resolve-alias?name=<pct>. The body is the stored target ref
        // (with its own pinning). A 501 means the scope doesn't advertise it → not_implemented.
        let target = format!("/:resolve-alias?name={}", pct_encode(name));
        let resp = self.request("GET", &target, vec![], vec![]).await?;
        if resp.status == 200 {
            let wref: WireResourceId = serde_json::from_slice(&resp.body)
                .map_err(|e| p::BdpError::Backend(format!("bad resolve-alias response: {e}")))?;
            let mut res = p::BdpResult::ok(wref.to_trait());
            res.protocol = crate::wire::protocol_from_headers(&resp);
            Ok(res)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            let rid = p::ResourceId::head(p::Scope::This, p::Id(Arc::from(name)));
            Err(error_from(resp.status, &resp.body, &rid))
        }
    }

    async fn apply(
        &self,
        writes: &[p::Write],
    ) -> Result<p::BdpResult<Vec<p::ResourceId>>, p::BdpError> {
        let wwrites: Vec<WireWrite> = writes.iter().map(WireWrite::from_trait).collect();
        let payload = serde_json::to_vec(&wwrites).unwrap();
        let headers = vec![("content-type".into(), "application/json".into())];
        // Recommended route: the custom-method form (unambiguous — see route.rs / BINDING.md).
        let resp = self.request("POST", "/:apply", headers, payload).await?;
        if resp.status == 200 {
            let wrefs: Vec<WireResourceId> = serde_json::from_slice(&resp.body)
                .map_err(|e| p::BdpError::Backend(format!("bad apply response: {e}")))?;
            let refs = wrefs.into_iter().map(|w| w.to_trait()).collect();
            let mut res = p::BdpResult::ok(refs);
            res.protocol = crate::wire::protocol_from_headers(&resp);
            Ok(res)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            let rid = p::ResourceId::head(p::Scope::This, p::Id(Arc::from("")));
            Err(error_from(resp.status, &resp.body, &rid))
        }
    }

    async fn create(
        &self,
        id: Option<p::Id>,
        body: p::CreateBody,
    ) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        let wreq = WireCreateRequest::from_body(id.as_ref(), &body);
        let payload = serde_json::to_vec(&wreq).unwrap();
        let headers = vec![("content-type".into(), "application/json".into())];
        let resp = self.request("POST", "/", headers, payload).await?;
        if resp.status == 201 {
            write_result(&resp)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            let rid = p::ResourceId::head(p::Scope::This, id.unwrap_or(p::Id(Arc::from(""))));
            Err(error_from(resp.status, &resp.body, &rid))
        }
    }

    async fn put(
        &self,
        target: p::ResourceId,
        body: p::CreateBody,
    ) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        let wreq = WireCreateRequest::from_body(None, &body);
        let payload = serde_json::to_vec(&wreq).unwrap();
        let headers = vec![("content-type".into(), "application/json".into())];
        let t = target_for(&target.id, None);
        let resp = self.request("PUT", &t, headers, payload).await?;
        if resp.status == 200 {
            write_result(&resp)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, &target))
        }
    }

    async fn patch(
        &self,
        target: p::ResourceId,
        patch: p::JsonPatch,
        if_rev: Option<p::Rev>,
    ) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        let mut headers = vec![("content-type".into(), "application/json-patch+json".into())];
        if let Some(rev) = &if_rev {
            headers.push(("if-match".into(), rev.0.to_string()));
        }
        let t = target_for(&target.id, None);
        let resp = self.request("PATCH", &t, headers, patch.0 .0.to_vec()).await?;
        if resp.status == 200 {
            write_result(&resp)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, &target))
        }
    }

    async fn delete(
        &self,
        target: p::ResourceId,
        if_rev: Option<p::Rev>,
    ) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        let mut headers = vec![];
        if let Some(rev) = &if_rev {
            headers.push(("if-match".into(), rev.0.to_string()));
        }
        let t = target_for(&target.id, None);
        let resp = self.request("DELETE", &t, headers, vec![]).await?;
        if resp.status == 200 {
            write_result(&resp)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, &target))
        }
    }
}
