//! The SERVER: wraps any `impl BdpScope` and exposes its primitives over HTTP per the pinned
//! wire mapping (inline `/// openapi` markers in `bdp.lumen` @ b555931c).
//!
//! Spike coverage = the single-resource core: get / create / put / patch / delete. The
//! scope-level and streaming ops (list, revisions, pull, apply, eval, export, import, call,
//! cancel) answer `501` and are logged as unmapped in `NOTES.md`.
//!
//! Generic over `S: BdpScope` (not `dyn`): the trait's `async fn`s are not dyn-safe without
//! boxing, and a spike needs no runtime polymorphism.

use bdp_primitives as p;
use bdp_primitives::BdpScope;

use crate::http::{read_request, write_response, HttpRequest, HttpResponse};
use crate::wire::{WireCreateRequest, WireProblem, WireRepresentation, WireResourceId, WireWrite};

pub struct Server<S: BdpScope> {
    scope: S,
    /// The scope's public base URL (e.g. "http://127.0.0.1:PORT"). When set, `create` emits an
    /// ABSOLUTE `Location` (the ratified form); absent, it falls back to the relative spike form.
    public_base: Option<String>,
}

impl<S: BdpScope> Server<S> {
    pub fn new(scope: S) -> Self {
        Self { scope, public_base: None }
    }

    /// Set the scope's public base URL so `create` can emit an absolute `Location`.
    pub fn with_public_base(mut self, base: impl Into<String>) -> Self {
        self.public_base = Some(base.into());
        self
    }

    /// Accept-and-handle loop. Sequential by design (spike); each connection is one
    /// request/response then close. Runs until the listener errors or the future is dropped.
    pub async fn serve(&self, listener: tokio::net::TcpListener) -> std::io::Result<()> {
        loop {
            let (mut stream, _peer) = listener.accept().await?;
            match read_request(&mut stream).await {
                Ok(req) => {
                    let resp = self.handle(req).await;
                    let _ = write_response(&mut stream, &resp).await;
                }
                Err(_) => { /* malformed request: drop the connection */ }
            }
        }
    }

    /// Route one request to a primitive and encode the outcome. Routing goes through
    /// `route::parse`, which accepts BOTH the `:verb` custom-method and `/verb` sub-path
    /// conventions (see `route.rs` / `BINDING.md`).
    pub async fn handle(&self, req: HttpRequest) -> HttpResponse {
        use crate::route::Route;
        let (route, _style) = crate::route::parse(&req.method, &req.path);
        match route {
            Route::Get(id) => self.do_get(&req, &id).await,
            Route::ScopeCreate => self.do_create(&req).await,
            Route::Put(id) => self.do_put(&req, &id).await,
            Route::Patch(id) => self.do_patch(&req, &id).await,
            Route::Delete(id) => self.do_delete(&req, &id).await,
            Route::ScopeApply => self.do_apply(&req).await,
            Route::ScopeCapabilities => self.do_capabilities(),
            Route::ScopeResolveAlias => self.do_resolve_alias(&req).await,
            Route::ScopeList => unmapped("list not mapped in the spike"),
            Route::ScopeExport => unmapped("export not mapped in the spike"),
            Route::ScopeEval => unmapped("eval not mapped in the spike"),
            Route::ScopeImport => unmapped("import not mapped in the spike"),
            Route::Revisions(_) => unmapped("revisions not mapped in the spike"),
            Route::Unroutable => {
                HttpResponse::json(400, problem_body(400, "bad-request", "Unroutable request"))
            }
        }
    }

    /// Capability discovery: advertise the wrapped scope's REAL `capabilities()` so a client (e.g.
    /// `RemoteScope`) can proxy them instead of guessing. Per Donna's advertised⟹implemented ruling
    /// the wire representation of the scope must be faithful — this is what makes that possible.
    fn do_capabilities(&self) -> HttpResponse {
        let wire = crate::wire::WireDiscovery {
            scope: crate::wire::WireScopeCapabilities::from_trait(&self.scope.scope_capabilities()),
            primitives: crate::wire::caps_to_wire(&self.scope.capabilities()),
        };
        HttpResponse::json(200, serde_json::to_vec(&wire).unwrap())
    }

    /// aliases capability: resolve `?name=` to the stored target ref (resource-model.md §65). The
    /// body is a bare ref (the stored target, with its own pinning); not advertised ⇒ 501, so a
    /// caller falls back to list(kind=alias)+get.
    async fn do_resolve_alias(&self, req: &HttpRequest) -> HttpResponse {
        let Some(name) = req.query.get("name") else {
            return HttpResponse::json(400, problem_body(400, "bad-request", "resolve-alias requires a ?name= parameter"));
        };
        match self.scope.resolve_alias(name).await {
            Ok(res) if res.not_implemented => unmapped("resolve_alias not implemented by this scope"),
            Ok(res) => match res.value {
                Some(reference) => {
                    let wire = WireResourceId::from_trait(&reference);
                    attach(HttpResponse::json(200, serde_json::to_vec(&wire).unwrap()), &res.protocol)
                }
                None => unmapped("resolve_alias not implemented by this scope"),
            },
            Err(e) => problem_response(&e),
        }
    }

    async fn do_get(&self, req: &HttpRequest, id_seg: &str) -> HttpResponse {
        let rid = resource_id_from(id_seg, req.query.get("revision").map(|s| s.as_str()));
        match self.scope.get(&rid, None).await {
            Ok(res) => {
                let protocol = res.protocol.clone();
                match res.value {
                    Some(rep) => {
                        let wire = WireRepresentation::from_trait(&rep);
                        let body = serde_json::to_vec(&wire).unwrap();
                        let mut r = attach(HttpResponse::json(200, body), &protocol);
                        // Representation carries its own rev; surface it as the ETag when the
                        // envelope didn't already (the read's validator).
                        if protocol.rev.is_none() {
                            if let Some(rv) = rep_rev(&rep) {
                                r = r.header("ETag", &format!("\"{}\"", rv));
                            }
                        }
                        r
                    }
                    None => unmapped("get not implemented by this scope"),
                }
            }
            Err(e) => problem_response(&e),
        }
    }

    async fn do_apply(&self, req: &HttpRequest) -> HttpResponse {
        let wwrites: Vec<WireWrite> = match serde_json::from_slice(&req.body) {
            Ok(w) => w,
            Err(e) => return HttpResponse::json(400, problem_body(400, "bad-request", &format!("bad write-set: {e}"))),
        };
        let writes: Vec<p::Write> = wwrites.into_iter().map(|w| w.into_trait()).collect();
        match self.scope.apply(&writes).await {
            Ok(res) if res.not_implemented => unmapped("apply not implemented by this scope"),
            Ok(res) => {
                let protocol = res.protocol.clone();
                let refs = res.value.unwrap_or_default();
                let wire: Vec<WireResourceId> = refs.iter().map(WireResourceId::from_trait).collect();
                let body = serde_json::to_vec(&wire).unwrap();
                attach(HttpResponse::json(200, body), &protocol)
            }
            Err(e) => problem_response(&e),
        }
    }

    async fn do_create(&self, req: &HttpRequest) -> HttpResponse {
        let wreq: WireCreateRequest = match serde_json::from_slice(&req.body) {
            Ok(w) => w,
            Err(e) => return HttpResponse::json(400, problem_body(400, "bad-request", &format!("bad CreateRequest: {e}"))),
        };
        let (proposed, body) = wreq.into_body();
        match self.scope.create(proposed, body).await {
            Ok(res) if res.not_implemented => unmapped("create not implemented by this scope"),
            Ok(res) => {
                let (wire, loc) = write_result_wire(&res);
                let location = match &self.public_base {
                    Some(base) => format!("{base}{loc}"), // absolute (ratified)
                    None => loc,                           // relative (spike fallback)
                };
                let body = serde_json::to_vec(&wire).unwrap();
                attach(HttpResponse::json(201, body).header("location", &location), &res.protocol)
            }
            Err(e) => problem_response(&e),
        }
    }

    async fn do_put(&self, req: &HttpRequest, id_seg: &str) -> HttpResponse {
        let wreq: WireCreateRequest = match serde_json::from_slice(&req.body) {
            Ok(w) => w,
            Err(e) => return HttpResponse::json(400, problem_body(400, "bad-request", &format!("bad CreateRequest: {e}"))),
        };
        let target = resource_id_from(id_seg, None);
        let (_proposed, body) = wreq.into_body(); // FRICTION: body may ALSO carry `id`; URL wins for put
        match self.scope.put(target, body).await {
            Ok(res) if res.not_implemented => unmapped("put not implemented by this scope"),
            Ok(res) => {
                let (wire, _loc) = write_result_wire(&res);
                let body = serde_json::to_vec(&wire).unwrap();
                attach(HttpResponse::json(200, body), &res.protocol)
            }
            Err(e) => problem_response(&e),
        }
    }

    async fn do_patch(&self, req: &HttpRequest, id_seg: &str) -> HttpResponse {
        // SPEC BASIS (cited, not inferred): core.lumen's media-type appendix —
        //   "application/json-patch+json  the direct `patch` body (RFC 6902). REQUIRED means
        //    PRESENT-OR-FAULT: a direct `patch` whose `Content-Type` names another media type, OR
        //    OMITS THE HEADER, faults `415`. Absence is not the lenient case — a requirement that
        //    bites only when you declare something else can be evaded by declaring nothing, and an
        //    omission must never downgrade a guarantee."
        // and the lowering annotation `request = { contentType = "application/json-patch+json" }`.
        //
        // The word REQUIRED is in the MERGED text; the clarification above only settles which way its
        // ambiguity falls. So this check does not depend on an unmerged ruling — the merged spec
        // already requires the header, and a reading that let an absent one through was the weaker
        // of the two available readings rather than the plain one.
        //
        // This check is the ONLY producer of op/patch/fault/415 — the well-formed client always
        // sends the right type (client.rs), so the row is unreachable without validating here.
        //
        // So ABSENT, EMPTY and WRONG all fault 415, and one mistake gets one fault: a client that
        // erred either way sees 415 rather than 415-or-422 depending on how it erred. An earlier
        // version of this check exempted an absent header, on the narrower reading that the old
        // fault clause named only "another media type"; that ambiguity was flagged rather than
        // closed here, and the spec has since ruled present-or-fault.
        const JSON_PATCH: &str = "application/json-patch+json";
        // Compare the media type only; parameters such as `; charset=utf-8` are not part of it.
        // An absent header yields the empty string, which is != JSON_PATCH and so faults.
        let media_type = req
            .header("content-type")
            .and_then(|ct| ct.split(';').next().map(|m| m.trim().to_ascii_lowercase()))
            .unwrap_or_default();
        if media_type != JSON_PATCH {
            let got = if media_type.is_empty() { "no Content-Type" } else { &media_type };
            return HttpResponse::json(
                415,
                problem_body(
                    415,
                    "unsupported-media-type",
                    &format!("patch requires {JSON_PATCH}, got {got}"),
                ),
            );
        }
        let target = resource_id_from(id_seg, None);
        let patch = p::JsonPatch(p::RawJson(bytes::Bytes::copy_from_slice(&req.body)));
        let if_rev = req.header("if-match").map(|s| p::Rev(std::sync::Arc::from(s)));
        match self.scope.patch(target, patch, if_rev).await {
            Ok(res) if res.not_implemented => unmapped("patch not implemented by this scope"),
            Ok(res) => {
                let (wire, _loc) = write_result_wire(&res);
                attach(HttpResponse::json(200, serde_json::to_vec(&wire).unwrap()), &res.protocol)
            }
            Err(e) => problem_response(&e),
        }
    }

    async fn do_delete(&self, req: &HttpRequest, id_seg: &str) -> HttpResponse {
        let target = resource_id_from(id_seg, None);
        let if_rev = req.header("if-match").map(|s| p::Rev(std::sync::Arc::from(s)));
        match self.scope.delete(target, if_rev).await {
            Ok(res) if res.not_implemented => unmapped("delete not implemented by this scope"),
            Ok(res) => {
                let (wire, _loc) = write_result_wire(&res);
                attach(HttpResponse::json(200, serde_json::to_vec(&wire).unwrap()), &res.protocol)
            }
            Err(e) => problem_response(&e),
        }
    }
}

// ---- helpers --------------------------------------------------------------------

/// Attach the `BdpResult` protocol-meta as `BDP-*` response headers (Lydia's envelope convention).
fn attach(mut resp: HttpResponse, meta: &p::ProtocolMeta) -> HttpResponse {
    for (k, v) in crate::wire::protocol_to_headers(meta) {
        resp = resp.header(&k, &v);
    }
    resp
}

fn resource_id_from(id_seg: &str, revision: Option<&str>) -> p::ResourceId {
    p::ResourceId {
        scope: p::Scope::This,
        id: p::Id(std::sync::Arc::from(id_seg)),
        rev: revision.map(|r| p::Rev(std::sync::Arc::from(r))),
    }
}

fn rep_rev(rep: &p::Representation) -> Option<String> {
    rep.id().rev.as_ref().map(|r| r.0.to_string())
}

/// Build the wire pinned ref the write ops return. RESOLVED (RECONCILE §1): the base write return
/// is now the bare pinned `ResourceId` (rev = the minted revision), matching the wire contract.
/// `created`/`op` are no longer on the return — create-vs-update lives on the changefeed
/// (`ChangeEvent.op`), so a `RemoteScope` reproduces the write return faithfully.
fn write_result_wire(res: &p::BdpResult<p::ResourceId>) -> (WireResourceId, String) {
    let reference = res.value.as_ref().expect("write op returned no value");
    let mut wire = WireResourceId::from_trait(reference);
    if wire.rev.is_none() {
        if let Some(rev) = &res.protocol.rev {
            wire.rev = Some(rev.0.to_string());
        }
    }
    let loc = format!("/{}", wire.id);
    (wire, loc)
}

fn problem_response(e: &p::BdpError) -> HttpResponse {
    let (status, prob) = WireProblem::from_error(e);
    HttpResponse::json(status, serde_json::to_vec(&prob).unwrap())
}

fn problem_body(status: u16, code: &str, detail: &str) -> Vec<u8> {
    let prob = WireProblem {
        r#type: format!("https://bdp.dev/problems/{}", code),
        title: detail.to_string(),
        status,
        code: code.to_string(),
        retry: "never".to_string(),
        detail: Some(detail.to_string()),
        capability: None,
        limit: None,
        constraint: None,
        property: None,
        conflicts_with: None,
    };
    serde_json::to_vec(&prob).unwrap()
}

fn unmapped(detail: &str) -> HttpResponse {
    HttpResponse::json(501, problem_body(501, "not-implemented", detail))
}
