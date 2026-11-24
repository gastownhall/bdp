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
use crate::wire::{WireCreateRequest, WireExportRecord, WireProblem, WireRepresentation, WireResourceId, WireWrite};

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
        C::Get(_)
            | C::Create(_)
            | C::Put(_)
            | C::Patch(_)
            | C::Delete(_)
            | C::Apply(_)
            | C::Aliases(_)
            | C::Unversioned(_)
            | C::List(_)
            | C::Export(_)
            // `Call` was MISSING since the binding port bound `call`: the client forwarded it and
            // never advertised it. Under-advertising is safer than over-advertising and still
            // wrong -- discovery is meant to say which primitives are offered. Nothing in the gate
            // caught it, because every case invokes the trait method directly and no row depends
            // on advertisement: a subject could advertise nothing and still claim every row.
            | C::Call(_)
            // `Cancel` is listed HERE in the same change that added the client method below. The
            // `Call` entry above was missing for two PRs after `call` was bound, and nothing in
            // the gate could catch it, because every case invokes the trait method directly and no
            // row depends on advertisement. The checklist for binding a primitive is: trait method,
            // subject impl, server dispatch, client method, THIS function, and `capabilities()`.
            | C::Cancel(_)
    )
}

/// Rewrite a forwarded capability to what THIS BINDING can actually honour.
///
/// `remote_forwards` answers "does the client forward this primitive"; that is not the same
/// question as "can it honour every sub-capability the backing scope advertises". `InMemScope`
/// evaluates `list` conditions, but no wire encoding for a `Filter` is pinned, so conditions do
/// not survive the hop. Forwarding `ListCaps` verbatim would advertise filtering that this
/// binding silently drops -- and the spec is explicit that "an optional feature is never
/// half-present". So the conditions are cleared here, where the limitation actually is.
fn narrow_to_binding(cap: &p::PrimitiveCapabilities) -> p::PrimitiveCapabilities {
    use p::PrimitiveCapabilities as C;
    match cap {
        C::List(l) => C::List(p::ListCaps { conditions: vec![], ..l.clone() }),
        other => other.clone(),
    }
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
        // `cancel` on a handle that already carries a `reply`. Reconstructed from the code rather
        // than from the status, because three different conditions answer 409 in this binding
        // (`already-exists`, a declared `call` failure, and this) and a caller that could not tell
        // them apart would have one handler for three unrelated situations.
        (409, Some("already-settled")) => p::BdpError::AlreadySettled { id: rid.clone() },
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
        self.caps.iter().filter(|c| remote_forwards(c)).map(narrow_to_binding).collect()
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
        // `create` is `POST /-/create` in the generated paths, not `POST /`.
        let resp = self.request("POST", "/-/create", headers, payload).await?;
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
        guards: p::Guards,
    ) -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        let wreq = WireCreateRequest::from_body(None, &body);
        let payload = serde_json::to_vec(&wreq).unwrap();
        let mut headers = vec![("content-type".into(), "application/json".into())];
        // Guards ride the request line. `put` sent none before this, which is why the server had
        // nothing to enforce.
        if let Some(rev) = &guards.if_revision {
            headers.push(("if-match".into(), rev.0.to_string()));
        }
        if guards.if_absent {
            headers.push(("if-none-match".into(), "*".into()));
        }
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

    /// `POST /{opPath}/-/call`.
    ///
    /// The status→error mapping every other primitive uses is WRONG here, and this is the one
    /// place in the client where that matters. A 409 from `call` is a `Reply` on the declared-
    /// failure arm — the operation ran and said no — so routing it through `error_from` would
    /// turn the operation's own "no" into a transport-level fault and discard the `error` the
    /// caller is meant to branch on.
    ///
    /// So the rule is the inverse of the usual one: a 2xx **or a 409** carries a `Reply`, and
    /// only the other non-2xx statuses are Problems. `Outcome` is an OPEN union, and the arm is
    /// read from the body's `kind`, never from the status — so this client does not enumerate
    /// arms at all and an arm added later passes through untouched.
    /// `GET /-/list` — the scope's current resources.
    ///
    /// A NON-EMPTY FILTER IS REFUSED HERE rather than dropped on the way out. This binding carries
    /// no `Filter` encoding, so sending the request without `where` would return everything to a
    /// caller who asked for a subset. `capabilities()` already advertises `conditions: []` for the
    /// same reason; this is the enforcement behind that advertisement.
    async fn list(&self, filter: &p::ListFilter, page: p::Page)
        -> Result<p::BdpResult<Vec<p::ResourceId>>, p::BdpError> {
        if !filter.0.is_empty() {
            return Err(p::BdpError::Backend(
                "this binding carries no `where` encoding, so a filtered `list` cannot be \
                 forwarded; `capabilities()` advertises `conditions: []`"
                    .into(),
            ));
        }
        let mut target = "/-/list".to_string();
        if let Some(limit) = page.limit {
            target.push_str(&format!("?limit={limit}"));
        }
        let resp = self.request("GET", &target, vec![], vec![]).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            200 => {
                let wire: Vec<WireResourceId> = serde_json::from_slice(&resp.body)
                    .map_err(|e| p::BdpError::Backend(format!("bad list response: {e}")))?;
                Ok(p::BdpResult::ok(wire.iter().map(|w| w.to_trait()).collect()))
            }
            _ => Err(error_from(resp.status, &resp.body, &p::ResourceId::head(p::Scope::This, p::Id(Arc::from(""))))),
        }
    }

    /// `GET /-/export` — the scope as JSONL.
    ///
    /// Parsed LINE BY LINE because the declared content type is `application/jsonl`, not a JSON
    /// array. A blank trailing line is skipped rather than treated as a record: the writer ends
    /// every line with `\n`, so a well-formed stream has one.
    async fn export(&self, filter: &p::ListFilter, _selector: Option<&p::Selector>, revisions: bool, _page: p::Page)
        -> Result<p::BdpResult<Vec<p::ExportRecord>>, p::BdpError> {
        if !filter.0.is_empty() {
            return Err(p::BdpError::Backend(
                "this binding carries no `where` encoding, so a filtered `export` cannot be forwarded"
                    .into(),
            ));
        }
        let target = if revisions { "/-/export?revisions=true" } else { "/-/export" };
        let resp = self.request("GET", target, vec![], vec![]).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            200 => {
                let text = String::from_utf8_lossy(&resp.body);
                let mut out = Vec::new();
                for line in text.lines().filter(|l| !l.trim().is_empty()) {
                    let rec: WireExportRecord = serde_json::from_str(line)
                        .map_err(|e| p::BdpError::Backend(format!("bad export line: {e}")))?;
                    out.push(rec.into_trait());
                }
                Ok(p::BdpResult::ok(out))
            }
            _ => Err(error_from(resp.status, &resp.body, &p::ResourceId::head(p::Scope::This, p::Id(Arc::from(""))))),
        }
    }

    /// `GET /{id}/-/revisions`.
    ///
    /// A 404 here means the id never existed in this scope. It does NOT mean "retired" — that is
    /// `get`'s `410`, which `revisions` does not declare, so this client never synthesises an
    /// `Erased` from a `revisions` response. Mapping a 404 to anything other than `NotFound` would
    /// invent a distinction the wire does not carry.
    async fn revisions(&self, resource: &p::ResourceId, _selector: Option<&p::Selector>, page: p::Page)
        -> Result<p::BdpResult<Vec<p::Representation>>, p::BdpError> {
        let mut target = format!("/{}/-/revisions", pct_encode(&resource.id.0));
        if let Some(limit) = page.limit {
            target.push_str(&format!("?limit={limit}"));
        }
        let resp = self.request("GET", &target, vec![], vec![]).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            200 => {
                let wire: Vec<WireRepresentation> = serde_json::from_slice(&resp.body)
                    .map_err(|e| p::BdpError::Backend(format!("bad revisions response: {e}")))?;
                let reps = wire.into_iter().map(|w| w.to_trait()).collect();
                Ok(p::BdpResult::ok(reps))
            }
            _ => Err(error_from(resp.status, &resp.body, resource)),
        }
    }

    async fn call(&self, operation: &p::ResourceId, request: p::Request, mode: p::CallMode)
        -> Result<p::BdpResult<p::CallOutcome>, p::BdpError> {
        let mut target = format!("/{}/-/call", pct_encode(&operation.id.0));
        // The disposition rides the REQUEST LINE (see `p::CallMode`). `sync` is the declared
        // default, so it is left off rather than sent explicitly — a default that is also spelled
        // out is a second thing to keep in step with the first.
        if mode == p::CallMode::Async {
            target.push_str("?mode=async");
        }
        let headers = vec![("content-type".into(), "application/json".into())];
        let resp = self.request("POST", &target, headers, request.0 .0.to_vec()).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            200 | 201 | 409 => Ok(p::BdpResult::ok(p::CallOutcome::Reply(p::Reply(p::RawJson(
                bytes::Bytes::from(resp.body.clone()),
            ))))),
            // THE ASYNC ACCEPT. The declared schema is `rep<AsyncResult>`, so the handle's own
            // identity is read out of the BODY — not out of `Location`, which D.6 lists as the
            // response header carrying "the new URL" and is the addressing convenience. Parsing
            // the id back out of a URL would also have to undo the server's choice between an
            // absolute and a relative form; the representation carries the ref directly.
            202 => {
                let wire: WireRepresentation = serde_json::from_slice(&resp.body)
                    .map_err(|e| p::BdpError::Backend(format!("bad async accept body: {e}")))?;
                let rep = wire.to_trait();
                let reference = rep.id().clone();
                let mut res = p::BdpResult::ok(p::CallOutcome::Async(reference));
                res.protocol = crate::wire::protocol_from_headers(&resp);
                Ok(res)
            }
            _ => Err(error_from(resp.status, &resp.body, operation)),
        }
    }

    /// `POST /{asyncResultId}/-/cancel`.
    ///
    /// A PINNED HANDLE IS REFUSED HERE rather than sent with its revision dropped. The declared
    /// parameter is `unpinned<AsyncResult>` and `cancel` declares no `412`, while every primitive
    /// that does carry a revision guard declares one — so there is no pin channel on this route to
    /// put a revision on, and sending the id alone would let a caller who asked for
    /// "cancel only if still at this revision" believe the condition was checked.
    ///
    /// This is the same refusal `list` makes for a filter this binding cannot encode, in the same
    /// place and for the same reason: *"an optional feature is never half-present"*. The difference
    /// worth noting is that a pin is not an optional feature of `cancel` at all — it is an argument
    /// the declared type forbids — so there is no capability to narrow in `narrow_to_binding`,
    /// and `CancelCaps` stays empty.
    async fn cancel(&self, async_result: p::ResourceId)
        -> Result<p::BdpResult<p::ResourceId>, p::BdpError> {
        if async_result.rev.is_some() {
            return Err(p::BdpError::Unprocessable(
                "cancel takes `unpinned<AsyncResult>`; this route carries no revision guard and \
                 `cancel` declares no 412, so a pinned handle is refused rather than silently \
                 cancelled at whatever revision is current"
                    .into(),
            ));
        }
        let target = format!("/{}/-/cancel", pct_encode(&async_result.id.0));
        let resp = self.request("POST", &target, vec![], vec![]).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            // `-> pinned<AsyncResult>` is a ref type, so the body is the bare pinned ref — the
            // same shape `put`/`patch`/`delete` return, hence the same decoder.
            200 => write_result(&resp),
            _ => Err(error_from(resp.status, &resp.body, &async_result)),
        }
    }
}
