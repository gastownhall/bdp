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
    /// `route::parse_raw`: the nine paths the generated OpenAPI binds, with the action fence
    /// (`/-/`) matched on the RAW path. The pre-0.2.3 `/verb` sub-path convention is retired;
    /// `:verb` survives ONLY for the surfaces the OpenAPI does not bind (discovery, `apply`,
    /// `eval`, `resolve-alias`), which are this subject's own and not spec'd (see `route.rs`).
    pub async fn handle(&self, req: HttpRequest) -> HttpResponse {
        use crate::route::Route;
        let (route, _style) = crate::route::parse_raw(&req.method, &req.raw_path, &req.path);
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
            Route::Revisions(id) => self.do_revisions(&req, &id).await,
            // The fence split succeeded but named no known action, or named one with the wrong
            // method / id-ness. 404 rather than 400: the request is well-formed and simply names
            // nothing, which is what the spec says.
            Route::UnknownAction => HttpResponse::json(
                404,
                problem_body(404, "not-found", "no such protocol action past the fence"),
            ),
            // The id LEFT of the fence contains a bare `-` segment, which no resource-id segment
            // may be — a literal hyphen-only segment must arrive as `%2D`. Malformed id, so 400.
            Route::InvalidFencedId => HttpResponse::json(
                400,
                problem_body(400, "bad-request", "a resource-id segment may not be a bare `-`"),
            ),
            Route::Call(op_path) => self.do_call(&req, &op_path).await,
            // Routed by the fence, not yet implemented by this subject.
            Route::Cancel(_) => unmapped("cancel not implemented by this scope"),
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

    /// `GET /{id}/-/revisions` — one resource's history as a JSON array of representations.
    ///
    /// The id is taken from the path and NOT from a `?revision=` pin: a pinned read is `get`'s job
    /// and asking for the history *of one revision* is incoherent. So `revisions` deliberately
    /// ignores that query parameter rather than honouring it.
    ///
    /// `limit` is the one `ReadRequest` control wired here. `after` / `from` (cursor resumption)
    /// are not: this scope's history is a snapshot read out of RAM in one pass, and a cursor that
    /// cannot expire is not a cursor. Returning one would advertise resumability that nothing
    /// backs, which is the same mistake as `storage_classes: [Durable]` on an in-memory store.
    async fn do_revisions(&self, req: &HttpRequest, id_seg: &str) -> HttpResponse {
        let rid = resource_id_from(id_seg, None);
        let page = p::Page {
            after: None,
            from: None,
            limit: req.query.get("limit").and_then(|s| s.parse::<u32>().ok()),
        };
        match self.scope.revisions(&rid, None, page).await {
            Ok(res) if res.not_implemented => unmapped("revisions not implemented by this scope"),
            Ok(res) => match res.value {
                Some(reps) => {
                    let wire: Vec<WireRepresentation> =
                        reps.iter().map(WireRepresentation::from_trait).collect();
                    let body = serde_json::to_vec(&wire).unwrap();
                    attach(HttpResponse::json(200, body), &res.protocol)
                }
                None => unmapped("revisions returned no value"),
            },
            Err(e) => problem_response(&e),
        }
    }

    /// `POST /{opPath}/-/call`.
    ///
    /// The status is a PROJECTION of the settled `Outcome`'s arm, computed here and nowhere else:
    ///
    ///   success  -> 200   failure -> 409   fault -> the Problem's OWN status   canceled -> 409
    ///
    /// Two consequences worth stating, because both are easy to get wrong and neither is
    /// observable from the status alone:
    ///
    /// 1. A 409 here carries a `Reply`, NOT a `Problem`. It is the only >=400 response in this
    ///    binding whose body is not a Problem, because a declared failure is the operation's own
    ///    "no" — it ran, and `Outcome.failure.error` is its declared `E`.
    /// 2. `kind` stays explicit in the body. The spec requires that a reader never infer the arm
    ///    from the status, so this projection is deliberately one-way: it reads `kind` to choose a
    ///    status and never rewrites the body to match.
    ///
    /// `Outcome` is the one sanctioned OPEN union, so an arm this binding does not recognise is
    /// not an error — it is a settled outcome that is not `success`, which is what 409 says.
    async fn do_call(&self, req: &HttpRequest, op_path: &str) -> HttpResponse {
        // `mode` is a declared query param (`"sync" | "async"`). Asking for a mode the scope does
        // not advertise is unimplemented, not malformed — so 501, not 400.
        if req.query.get("mode").map(|s| s.as_str()) == Some("async") {
            return unmapped("async call (?mode=async) not implemented by this scope");
        }
        let operation = resource_id_from(op_path, None);
        let request = p::Request(p::RawJson(bytes::Bytes::from(req.body.clone())));
        match self.scope.call(&operation, request).await {
            Ok(res) if res.not_implemented => unmapped("call not implemented by this scope"),
            Ok(res) => match res.value {
                Some(p::CallOutcome::Reply(reply)) => {
                    let status = status_for_outcome(&reply.0 .0);
                    attach(HttpResponse::json(status, reply.0 .0.to_vec()), &res.protocol)
                }
                // An async accept is 202 + the AsyncResult's Location; no scope mints one yet.
                Some(p::CallOutcome::Async(_)) => unmapped("async call not implemented by this scope"),
                None => unmapped("call returned no outcome"),
            },
            // A bare Problem with NO Outcome — the pre-dispatch channel. The operation never ran.
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
        // GUARDS RIDE THE REQUEST LINE, never the body. Read them here: before this, `do_put`
        // read no headers at all, so an `If-Match` was accepted and ignored and the client got a
        // `200` believing it held a concurrency guard.
        let guards = p::Guards {
            if_revision: req.header("if-match").map(|s| p::Rev(std::sync::Arc::from(s))),
            // `If-None-Match: *` is the only form that means "apply only if absent". Any other
            // value is an entity-tag precondition this scope does not implement, so it is NOT
            // silently treated as `*` — that would be the same failure being fixed here.
            if_absent: req.header("if-none-match").map(|v| v.trim() == "*").unwrap_or(false),
            precondition: None,
        };
        match self.scope.put(target, body, guards).await {
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

/// Project a settled `Outcome`'s arm onto an HTTP status, reading the INTERNALLY-TAGGED `kind`.
///
/// A `fault` carries a Problem at the Problem's own status, so that status comes out of the
/// nested Problem rather than being a constant — which is exactly why a status cannot identify
/// the arm in reverse: a 409 is a declared failure, but a fault could also be a 409 if that is
/// what its Problem says.
fn status_for_outcome(reply_body: &[u8]) -> u16 {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(reply_body) else {
        return 500;
    };
    let outcome = &v["outcome"];
    match outcome["kind"].as_str() {
        Some("success") => 200,
        Some("fault") => outcome["problem"]["status"].as_u64().unwrap_or(500) as u16,
        // `failure`, `canceled`, and any arm added later: settled, and not success.
        _ => 409,
    }
}

fn unmapped(detail: &str) -> HttpResponse {
    HttpResponse::json(501, problem_body(501, "not-implemented", detail))
}

#[cfg(test)]
mod outcome_projection_tests {
    use super::status_for_outcome;

    fn status(outcome: &str) -> u16 {
        status_for_outcome(format!(r#"{{"outcome":{outcome}}}"#).as_bytes())
    }

    #[test]
    fn success_is_200_and_a_declared_failure_is_409() {
        assert_eq!(status(r#"{"kind":"success","value":1}"#), 200);
        assert_eq!(status(r#"{"kind":"failure","error":{"code":"no"}}"#), 409);
    }

    /// A `fault` rides the Outcome at the PROBLEM'S OWN status, so this arm is the only one whose
    /// status is data rather than a constant. No wire case reaches it — this subject's built-ins
    /// never fault — so without this test the branch would be live and unexercised.
    #[test]
    fn a_fault_carries_the_problems_own_status() {
        assert_eq!(status(r#"{"kind":"fault","problem":{"status":422}}"#), 422);
        assert_eq!(status(r#"{"kind":"fault","problem":{"status":403}}"#), 403);
    }

    /// Why a status can NEVER identify the arm in reverse: a fault whose Problem says 409 is
    /// indistinguishable by status from a declared failure, and the two mean opposite things
    /// (undeclared vs. the operation's own "no"). Hence `kind` explicit in the body.
    #[test]
    fn a_409_fault_and_a_409_failure_are_the_same_status() {
        assert_eq!(status(r#"{"kind":"fault","problem":{"status":409}}"#), 409);
        assert_eq!(status(r#"{"kind":"failure","error":{}}"#), 409);
    }

    /// `Outcome` is the one sanctioned OPEN union — a reader MUST tolerate an unrecognized arm.
    /// An unknown arm is still settled and still not success, so it projects to 409 rather than
    /// being an error. A future arm therefore needs no change here.
    #[test]
    fn an_unrecognized_arm_is_tolerated_not_rejected() {
        assert_eq!(status(r#"{"kind":"deadlined","after":"PT1S"}"#), 409);
    }

    /// A body that is not a Reply at all is the subject's own bug, not a protocol outcome.
    #[test]
    fn an_unparseable_body_is_a_server_error() {
        assert_eq!(status_for_outcome(b"not json"), 500);
    }
}
