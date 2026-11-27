//! The SERVER: wraps any `impl BdpScope` and exposes its primitives over HTTP per the pinned
//! wire mapping (inline `/// openapi` markers in `bdp.lumen` @ b555931c).
//!
//! Mapped: get / create / put / patch / delete / list / export / revisions / call (sync and
//! `?mode=async`) / cancel / apply / discovery. Still answering `501`: pull, push, eval, import.
//!
//! Generic over `S: BdpScope` (not `dyn`): the trait's `async fn`s are not dyn-safe without
//! boxing, and a spike needs no runtime polymorphism.

use bdp_primitives as p;
use bdp_primitives::BdpScope;

use crate::http::{read_request, write_response, HttpRequest, HttpResponse};
use crate::wire::{WireCreateRequest, WireExportRecord, WireProblem, WireRepresentation, WireResourceId, WireWrite};

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
            Route::ScopeList => self.do_list(&req).await,
            Route::ScopeExport => self.do_export(&req).await,
            Route::ScopeEval => unmapped("eval not mapped in the spike"),
            Route::ScopeImport => self.do_import(&req).await,
            Route::Pull(ref id) => self.do_pull(&req, id).await,
            Route::Push(ref id) => self.do_push(&req, id).await,
            Route::Revisions(id) => self.do_revisions(&req, &id).await,
            // The fence split succeeded but named no known action, or named one with the wrong
            // method / id-ness. 404 rather than 400: the request is well-formed and simply names
            // nothing, which is what the spec says.
            Route::UnknownAction => HttpResponse::json(
                404,
                problem_body(404, "resource-not-found", "no such protocol action past the fence"),
            ),
            // The id LEFT of the fence contains a bare `-` segment, which no resource-id segment
            // may be — a literal hyphen-only segment must arrive as `%2D`. Malformed id, so 400.
            Route::InvalidFencedId => HttpResponse::json(
                400,
                problem_body(400, "bad-request", "a resource-id segment may not be a bare `-`"),
            ),
            Route::Call(op_path) => self.do_call(&req, &op_path).await,
            Route::Cancel(id) => self.do_cancel(&id).await,
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
        // `retired` IS REFUSED ON CREATE, which is half of a divergence `put` holds the other end
        // of. core.lumen#rep: "`retired` is SERVICE-MANAGED — minted only by `delete`, refused on
        // `create` and ignored on `put`"; and "a write can neither forge nor clear a tombstone".
        //
        // WHY HERE AND NOT IN SERDE. `create` and `put` share `WireCreateRequest`, so serde can
        // only answer ONCE for both ops — `deny_unknown_fields` with no field refuses it for both,
        // which is right here and wrong for `put`, whose rule is that a read-only member is
        // "IGNORED, never faulted — so a `get` → `put` round-trip of a whole representation is
        // safe". The field is therefore admitted on the type and the two handlers diverge.
        //
        // The two normative lines collide on this one cell and BOTH survive it: `put`'s rationale
        // is round-trip safety, and a round-trip never CREATES, so it does not reach create; the
        // tombstone rationale does, because `retired: true` at birth forges one. The specific
        // carves out of the general.
        // THE SET, NOT THE MEMBER. `provenance` and `createdAt` were refused only incidentally, by
        // `deny_unknown_fields`, under the unregistered `bad-request` and only while undeclared.
        if let Some(m) = [
            ("retired", wreq.retired.is_some()),
            ("provenance", wreq.provenance.is_some()),
            ("createdAt", wreq.created_at.is_some()),
        ]
        .iter()
        .find(|(_, present)| *present)
        .map(|(n, _)| *n)
        {
            return HttpResponse::json(
                400,
                problem_body(
                    400,
                    "malformed-request",
                    &format!(
                        "`{m}` is service-managed: the service sets it and a writer never does. A \
                         `create` cannot forge it. (`put` ignores the whole set instead — the \
                         round-trip case. `id` is exempt: it is caller-proposable at creation.)"
                    ),
                ),
            );
        }
        let (proposed, body) = wreq.into_body();
        // THE DUAL ON `clientProposedId`. A scope advertising it false mints its own ids, so a
        // caller-supplied one is refused rather than quietly overwritten -- a create that silently
        // allocated a DIFFERENT id than the one asked for would hand back a Location the caller
        // did not request and could not predict.
        if proposed.is_some() && self.create_caps().is_some_and(|cc| !cc.client_proposed_id) {
            return unadvertised(
                "create",
                "clientProposedId",
                "this scope advertises `clientProposedId: false`; omit the id and read it from the \
                 response",
            );
        }
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

    /// `GET /-/list` — the scope's current resources as a JSON array of refs.
    ///
    /// A `where` FILTER IS REFUSED, NOT IGNORED. `list` declares `where` as a query param
    /// (`schema = "Filter"`), and `InMemScope::list` really does evaluate conditions — but this
    /// binding has no wire encoding for a `Filter`, and the spec does not pin one. Accepting the
    /// parameter and listing everything would hand back an unfiltered answer to a caller who
    /// believes they filtered: the same defect as `do_put` reading no `If-Match` (#419) and as
    /// treating an unknown `If-None-Match` as `*`. So an un-encodable filter is an un-offered
    /// capability, and the spec is explicit that "an optional feature is never half-present".
    ///
    /// `RemoteScope` therefore advertises `ListCaps { conditions: [] }` over this binding, so a
    /// client learns from discovery not to send one rather than learning from a 501.
    async fn do_list(&self, req: &HttpRequest) -> HttpResponse {
        if let Some(r) = refuse_format(req, &["page"], "list") {
            return r;
        }
        if req.query.contains_key("where") {
            return unmapped(
                "list `where` filtering is not carried by this binding — no wire encoding for a \
                 Filter is pinned, so the capability is not offered here rather than ignored",
            );
        }
        let page = p::Page {
            // `?after=` IS READ, and it was pinned to `None` here. That made the cursor
            // undeliverable no matter what the store or the client did: FOUR layers had to agree on
            // this one read — the store honoring `after`, the server parsing it, the client sending
            // it, and an envelope to hand the position back — and none of them did. Each failure
            // looked like a correct first page.
            after: req.query.get("after").map(|c| p::Cursor(bytes::Bytes::from(c.clone().into_bytes()))),
            from: None,
            limit: match parse_limit(req) {
                Ok(l) => l,
                Err(resp) => return resp,
            },
        };
        match self.scope.list(&p::ListFilter(vec![]), page).await {
            Ok(res) if res.not_implemented => unmapped("list not implemented by this scope"),
            Ok(res) => match res.value {
                Some(ids) => {
                    // THE PAGE ENVELOPE, not a bare array. See `WirePage` for the ruling and why
                    // emitting it is catch-up against a rule in force at the frozen tag.
                    let items: Vec<WireResourceId> = ids.iter().map(WireResourceId::from_trait).collect();
                    let page = crate::wire::WirePage::of(items, &res.protocol);
                    attach(HttpResponse::json(200, serde_json::to_vec(&page).unwrap()), &res.protocol)
                }
                None => unmapped("list returned no value"),
            },
            Err(e) => problem_response(&e),
        }
    }

    /// `GET /-/export` — the scope as JSONL. `?revisions=true` emits every revision in order.
    ///
    /// The declared content type is `application/jsonl`, so the body is newline-delimited records
    /// and NOT a JSON array. Begin and End frame the stream: the cursor the export is consistent
    /// as of, and the record count, which is what makes it a backup rather than a read.
    /// This scope's `PutCaps` / `PatchCaps` / `CreateCaps`, if advertised at all.
    fn put_caps(&self) -> Option<p::PutCaps> {
        self.scope.capabilities().into_iter().find_map(|c| match c {
            p::PrimitiveCapabilities::Put(pc) => Some(pc),
            _ => None,
        })
    }

    fn patch_caps(&self) -> Option<p::PatchCaps> {
        self.scope.capabilities().into_iter().find_map(|c| match c {
            p::PrimitiveCapabilities::Patch(pc) => Some(pc),
            _ => None,
        })
    }

    fn create_caps(&self) -> Option<p::CreateCaps> {
        self.scope.capabilities().into_iter().find_map(|c| match c {
            p::PrimitiveCapabilities::Create(cc) => Some(cc),
            _ => None,
        })
    }

    /// `GET /{channel}/-/pull` — read a channel's events.
    ///
    /// `format` IS ACTED ON RATHER THAN IGNORED, which is the whole point of rc2's silent-failure
    /// clause: "Silently ignoring a resume cursor or a transport selector — returning the whole set
    /// from the start, or the default encoding, as if the param were absent — is NON-CONFORMANT."
    /// This binding implements `jsonl` and REFUSES the two it does not implement, by name. A
    /// refusal is not silence; returning jsonl to a caller who asked for `page` would be.
    ///
    /// `sse` IS REFUSED AS UNIMPLEMENTED, NOT AS INVALID, and the difference matters: `pull` is the
    /// one read where `sse` is legal (core.lumen#pull: "`sse` is valid here because `pull` is the
    /// one live-feed read"), so a `400` would be a false statement about the spec. 501 says this
    /// binding does not do it yet, which is true.
    async fn do_pull(&self, req: &HttpRequest, channel_seg: &str) -> HttpResponse {
        // `page` IS THE DEFAULT AND THE ONLY FRAMING SERVED, which is the ruling rather than a
        // preference: every read "wire-returns a `Page` window", so the envelope is the response
        // shape and a transport is how it is encoded.
        //
        // `jsonl` IS REFUSED, and this is the one place with no conformant answer — the spec does
        // not say how a `Page` is framed as newline-delimited records, so the choices are to invent
        // framing, to serve page bytes under a jsonl request, or to refuse a declared floor param.
        // All three are wrong; refusing is wrong LOUDLY and names the gap (Lydia has it as RC3
        // item 1). A case asserting "a declared `format` is honored" should still fail here.
        match req.header("format").map(|f| f.trim().to_ascii_lowercase()).as_deref() {
            None | Some("") | Some("page") => {}
            Some("jsonl") => {
                return unmapped(
                    "pull `format=jsonl` is not served: the spec does not frame a `Page` as \
                     newline-delimited records, so this binding refuses rather than inventing it",
                )
            }
            Some("sse") => return unmapped("pull `format=sse` is not implemented by this binding"),
            Some(other) => {
                return HttpResponse::json(
                    400,
                    problem_body(
                        400,
                        "invalid-parameter",
                        &format!("`format` must be page | jsonl | sse; got `{other}`"),
                    ),
                )
            }
        }
        let page = p::Page {
            after: req.query.get("after").map(|c| p::Cursor(bytes::Bytes::from(c.clone().into_bytes()))),
            from: None,
            limit: match parse_limit(req) {
                Ok(l) => l,
                Err(resp) => return resp,
            },
        };
        let channel = resource_id_from(channel_seg, None);
        match self.scope.pull(&channel, page, None, None).await {
            Ok(res) if res.not_implemented => unmapped("pull not implemented by this scope"),
            Ok(res) => match res.value {
                Some(events) => {
                    // The events are already JSON values, so they ride as raw items inside the
                    // envelope rather than being re-encoded as strings.
                    let items: Vec<serde_json::Value> = events
                        .iter()
                        .map(|e| serde_json::from_slice(e.0.as_ref()).unwrap_or(serde_json::Value::Null))
                        .collect();
                    let page = crate::wire::WirePage::of(items, &res.protocol);
                    attach(HttpResponse::json(200, serde_json::to_vec(&page).unwrap()), &res.protocol)
                }
                None => unmapped("pull returned no value"),
            },
            Err(e) => problem_response(&e),
        }
    }

    /// `POST /{channel}/-/push` — append events to a channel.
    ///
    /// `application/jsonl` IS FIXED on the request, exactly as on `import`: core.lumen#push carries
    /// `request = { contentType = "application/jsonl" }`. A wrong media type is `400` and not `415`
    /// for the same reason as import — `push` declares `[405, 409, 422]` and names no 415, so
    /// answering one would put a status on the wire that no denominator row carries.
    async fn do_push(&self, req: &HttpRequest, channel_seg: &str) -> HttpResponse {
        const JSONL: &str = "application/jsonl";
        let media_type = req
            .header("content-type")
            .and_then(|ct| ct.split(';').next().map(|m| m.trim().to_ascii_lowercase()))
            .unwrap_or_default();
        if media_type != JSONL {
            let got = if media_type.is_empty() { "no Content-Type" } else { &media_type };
            return HttpResponse::json(
                400,
                problem_body(400, "bad-request", &format!("push requires {JSONL}, got {got}")),
            );
        }

        let text = String::from_utf8_lossy(&req.body);
        let mut events = Vec::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            match serde_json::from_str::<crate::wire::WirePushEvent>(line) {
                Ok(w) => events.push(p::PushEvent {
                    ordinal: w.ordinal,
                    body: p::RawJson(bytes::Bytes::from(w.body.get().as_bytes().to_vec())),
                }),
                Err(e) => {
                    return HttpResponse::json(
                        400,
                        problem_body(400, "bad-request", &format!("bad push event line: {e}")),
                    )
                }
            }
        }

        let channel = resource_id_from(channel_seg, None);
        match self.scope.push(&channel, &events).await {
            Ok(res) if res.not_implemented => unmapped("push not implemented by this scope"),
            Ok(res) => match res.value {
                Some(ack) => {
                    let wire = crate::wire::WirePushAck::from_trait(&ack);
                    attach(HttpResponse::json(200, serde_json::to_vec(&wire).unwrap()), &res.protocol)
                }
                None => unmapped("push returned no value"),
            },
            Err(e) => problem_response(&e),
        }
    }

    /// `POST /-/import` — the bulk WRITE side, and the last declared primitive this binding left
    /// unmapped. The reference has implemented `import` all along and `route.rs` has parsed the
    /// path all along; only the handler was missing, so `op/import` and its three fault rows were
    /// uncoverable against a scope that implements the op.
    ///
    /// THE MEDIA TYPE IS FIXED, NOT NEGOTIATED. rc2 (#448) added the `request = { contentType =
    /// "application/jsonl" }` that core.lumen was missing, so there is now exactly one acceptable
    /// request type and no lenient-reading rationale left.
    ///
    /// A WRONG MEDIA TYPE IS `400`, NOT `415`, and the declared fault set is what decides that:
    /// `import` declares `[400, 409, 422]` and names no 415. `patch` declares 415 and gets it (see
    /// `do_patch`). Answering an undeclared status would put a row on the wire that no denominator
    /// carries, which is worse than a coarse one — so a request that is not `application/jsonl` is
    /// malformed against a fixed contract.
    async fn do_import(&self, req: &HttpRequest) -> HttpResponse {
        const JSONL: &str = "application/jsonl";
        let media_type = req
            .header("content-type")
            .and_then(|ct| ct.split(';').next().map(|m| m.trim().to_ascii_lowercase()))
            .unwrap_or_default();
        if media_type != JSONL {
            let got = if media_type.is_empty() { "no Content-Type" } else { &media_type };
            return HttpResponse::json(
                400,
                problem_body(
                    400,
                    "bad-request",
                    &format!("import requires {JSONL} (rc2 fixes it on the request), got {got}"),
                ),
            );
        }

        let records = match parse_import_jsonl(&req.body) {
            Ok(r) => r,
            Err(detail) => {
                return HttpResponse::json(400, problem_body(400, "bad-request", &detail))
            }
        };

        // `?strategy=` carries the merge mode. An unknown value is malformed rather than
        // unsupported: the vocabulary is closed, so a third name is not a capability question.
        let strategy = match req.query.get("strategy").map(|s| s.as_str()) {
            None | Some("set-current") => p::ImportStrategy::SetCurrent,
            Some("history-restore") => p::ImportStrategy::HistoryRestore,
            Some(other) => {
                return HttpResponse::json(
                    400,
                    problem_body(
                        400,
                        "bad-request",
                        &format!(
                            "unknown import strategy `{other}`; the vocabulary is \
                             set-current | history-restore"
                        ),
                    ),
                )
            }
        };

        match self.scope.import(&records, strategy).await {
            Ok(res) if res.not_implemented => unmapped("import not implemented by this scope"),
            Ok(res) => match res.value {
                Some(report) => attach(HttpResponse::json(200, report.0 .0.to_vec()), &res.protocol),
                None => unmapped("import returned no value"),
            },
            Err(e) => problem_response(&e),
        }
    }

    async fn do_export(&self, req: &HttpRequest) -> HttpResponse {
        if let Some(r) = refuse_format(req, &["jsonl"], "export") {
            return r;
        }
        // REFUSED, AND WITH A DECLARED STATUS. This refused only `where`, and did it with
        // `unmapped()` — a `501`. Two defects in one site:
        //
        // 1. `select` WAS NOT REFUSED AT ALL. Donna's export ruling (B) says a history export
        //    refuses `select`/`where` together; half the refusal was missing, so `?select=` was
        //    accepted and silently dropped — the caller's projection vanishing with a `200`, which
        //    is the defect the `after`/`limit` comment below was written about.
        // 2. `export` DECLARES EXACTLY ONE FAULT, `400`. A `501` from here is a status the
        //    generated contract does not publish, so the refusal was itself a divergence.
        //
        // I had a tidier design — `400` for a history export (the spec refuses projection) and
        // `501` for a current-state one (ruling B says honour it, this binding cannot) — and the
        // asymmetry does carry the real semantic difference. It also ADDS an undeclared status to
        // keep a `501` I am meant to be removing, so it is the wrong trade: a caller reading
        // `core.openapi.json` sees no `where`/`select` parameter on this operation at all
        // (gastownhall/bdp#450), which makes `400` a true statement about the published contract
        // rather than a convenient one.
        //
        // AND THE REFUSAL IS UNCONDITIONAL FOR A STRONGER REASON THAN I FIRST WROTE. I had this
        // as "ruling B's current-state half is not implemented because the projection has no wire
        // channel", which is true and understates it: `export` declares THREE of its own inputs —
        // `where?`, `select?` AND `revisions?` — and the annotation lowers none of them, all three
        // being registered in the gate's `UNCARRIED_INPUTS`. `revisions` is the DISCRIMINATOR
        // ruling B turns on (current state vs history), so the binding cannot express which branch
        // a caller is asking for. There is exactly one reachable branch here, which is why this is
        // not a choice between B's two halves at all.
        //
        // (The handler does read `?revisions=` below, under a spelling the contract does not
        // publish. That keeps the operation useful and is left alone deliberately — but it is why
        // no conformance case may use `?revisions=` to reach the history branch: a case over an
        // undeclared spelling asserts against a contract nobody can read.)
        //
        // CLOSES WHEN: #450 lowers these parameters, at which point the current-state branch must
        // honour projection and self-label partial instead of refusing.
        if req.query.contains_key("where") || req.query.contains_key("select") {
            return HttpResponse::json(
                400,
                problem_body(
                    400,
                    "bad-request",
                    "export refuses `where` and `select`: a history export rejects projection, and \
                     this binding lowers neither parameter, so there is no declared way to supply \
                     one",
                ),
            );
        }

        // rc2 NAMES THIS FAULT, which is what makes it a producer rather than a guess: "`export`
        // honors only `after`, `limit` and `format` of `request`; `request.filter`,
        // `request.select` and `request.from` are rejected `400` — filtering and projection are the
        // op's own `where`/`select`, and a snapshot resumes by cut `Cursor`, not a fresh ordinal."
        //
        // `from` IS THE UNAMBIGUOUS ONE and the only one asserted here. `select` and `filter` as
        // query names are ambiguous over this binding: export ALSO declares its own `select?` and
        // `where?`, and those are not lowered into the generated params at all
        // (gastownhall/bdp#450), so a `?select=` could be either the rejected `request.select` or
        // the op's own parameter arriving by a spelling nobody declared. `from` has no such
        // double: export declares no ordinal parameter of its own, and a snapshot resumes by cut
        // cursor, so `?from=` can only be `request.from`.
        if req.query.contains_key("from") {
            return HttpResponse::json(
                400,
                problem_body(
                    400,
                    "bad-request",
                    "export rejects `request.from`: a snapshot resumes by cut Cursor (`after`), \
                     not by a fresh ordinal",
                ),
            );
        }

        let revisions = req.query.get("revisions").map(|s| s == "true").unwrap_or(false);

        // HONORED, NOT IGNORED. These were all three `None`, so export accepted `?after=` and
        // `?limit=` and silently dropped them — the caller's window vanished with a 200, which is
        // the same defect as a silently dropped selector and worse than refusing. Rejecting `from`
        // above while continuing to drop its two neighbours would have been incoherent.
        let page = p::Page {
            after: req.query.get("after").map(|c| p::Cursor(bytes::Bytes::from(c.clone().into_bytes()))),
            from: None,
            limit: match parse_limit(req) {
                Ok(l) => l,
                Err(resp) => return resp,
            },
        };
        match self.scope.export(&p::ListFilter(vec![]), None, revisions, page).await {
            Ok(res) if res.not_implemented => unmapped("export not implemented by this scope"),
            Ok(res) => match res.value {
                Some(records) => {
                    let mut body = Vec::new();
                    for rec in &records {
                        body.extend_from_slice(&serde_json::to_vec(&WireExportRecord::from_trait(rec)).unwrap());
                        body.push(b'\n');
                    }
                    attach(HttpResponse::jsonl(200, body), &res.protocol)
                }
                None => unmapped("export returned no value"),
            },
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
        if let Some(r) = refuse_format(req, &["page"], "revisions") {
            return r;
        }
        let rid = resource_id_from(id_seg, None);
        let page = p::Page {
            after: req.query.get("after").map(|c| p::Cursor(bytes::Bytes::from(c.clone().into_bytes()))),
            from: None,
            limit: match parse_limit(req) {
                Ok(l) => l,
                Err(resp) => return resp,
            },
        };
        match self.scope.revisions(&rid, None, page).await {
            Ok(res) if res.not_implemented => unmapped("revisions not implemented by this scope"),
            Ok(res) => match res.value {
                Some(reps) => {
                    let items: Vec<WireRepresentation> =
                        reps.iter().map(WireRepresentation::from_trait).collect();
                    let page = crate::wire::WirePage::of(items, &res.protocol);
                    attach(HttpResponse::json(200, serde_json::to_vec(&page).unwrap()), &res.protocol)
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
        // `mode` is a declared query param (`"sync" | "async"`), and THE REQUEST LINE IS WHERE
        // THIS BINDING CARRIES THE DISPOSITION. The body's `Request.async` member declares the
        // same thing and is deliberately not read here — see `p::CallMode` for which of the two
        // spec declarations this follows and why the other reading stays live. An unrecognised
        // value is a malformed parameter rather than an un-offered mode, so it is 400.
        let mode = match req.query.get("mode").map(|s| s.as_str()) {
            None | Some("sync") => p::CallMode::Sync,
            Some("async") => p::CallMode::Async,
            Some(other) => {
                return HttpResponse::json(
                    400,
                    problem_body(
                        400,
                        "bad-request",
                        &format!("mode must be \"sync\" or \"async\", got {other:?}"),
                    ),
                )
            }
        };
        // Asking for a mode the scope does not ADVERTISE is unimplemented, not malformed — so 501,
        // not 400. Read off `capabilities()` rather than hard-coded: this is the same
        // advertised⟹implemented rule the rest of the binding follows, applied in the direction
        // that matters here (not-advertised ⟹ refused), so a scope that cannot mint a handle never
        // has to answer a request for one.
        if mode == p::CallMode::Async && !self.scope_supports_async_call() {
            return unmapped("async call (?mode=async) is not advertised by this scope");
        }
        let operation = resource_id_from(op_path, None);
        let request = p::Request(p::RawJson(bytes::Bytes::from(req.body.clone())));
        match self.scope.call(&operation, request, mode).await {
            Ok(res) if res.not_implemented => unmapped("call not implemented by this scope"),
            Ok(res) => match res.value {
                // A SYNC answer to an ASYNC request is refused, not relabelled. The caller asked
                // for a handle it could later `cancel`; a 200 would tell it the call is done while
                // it believes it holds a running operation. D.9 names the code —
                // `mode-refused`, the mode was understood and not honoured — as distinct from
                // `mode-not-supported` (the 501 above), where the scope never offered it.
                //
                // **NOT 409, and that is forced rather than preferred.** `call/409` is the one
                // `>=400` row in this whole binding whose body is declared to be a `Reply` and not
                // a `Problem` — it is the operation's own "no", which a caller branches on. So a
                // bare Problem at 409 from `call` is unrepresentable here: a conformant client
                // reads the status as a declared failure and looks for an `outcome` that is not
                // there. (Found by removing the minting and watching this branch come back through
                // the client as a `Reply` with no arm.) D.8 gives `mode-refused` no status, so the
                // catch-all applies — *"any fault — the body is the Problem, carried at the
                // Problem's own status"* — and the status says WHOSE fault it is: the server
                // already checked `asyncSupported` above, so reaching here means the scope
                // advertised a mode and did not honour it. The request was fine; the subject
                // contradicted its own discovery, and no change the caller could make would help.
                Some(p::CallOutcome::Reply(_)) if mode == p::CallMode::Async => HttpResponse::json(
                    500,
                    problem_body(
                        500,
                        "mode-refused",
                        "?mode=async was requested and the scope settled synchronously; it \
                         advertises asyncSupported and did not mint an AsyncResult",
                    ),
                ),
                Some(p::CallOutcome::Reply(reply)) => {
                    let status = status_for_outcome(&reply.0 .0);
                    attach(HttpResponse::json(status, reply.0 .0.to_vec()), &res.protocol)
                }
                // An ASYNC answer to a SYNC request is refused for the mirror-image reason: the
                // request line asked for a settled Reply and the caller would otherwise read a
                // 202 it never asked for. The request line is authoritative in BOTH directions,
                // which is what makes it a single source of truth rather than a hint.
                Some(p::CallOutcome::Async(_)) if mode == p::CallMode::Sync => HttpResponse::json(
                    500,
                    problem_body(
                        500,
                        "mode-refused",
                        "the scope minted an AsyncResult for a sync call; ?mode=async was not \
                         requested",
                    ),
                ),
                // THE ASYNC ACCEPT. D.8: *"202 call ?mode=async — Location: the AsyncResult URL;
                // body: no outcome yet"*, and the declared response schema is `rep<AsyncResult>` —
                // so the body is the handle's REPRESENTATION, not a `Reply` and not a bare ref.
                // The scope hands back the minted ref, so the representation is read back through
                // `get`; a handle that cannot be read straight after minting would not be a handle.
                Some(p::CallOutcome::Async(reference)) => {
                    let rep = match self.scope.get(&reference, None).await {
                        Ok(r) => match r.value {
                            Some(rep) => rep,
                            None => return unmapped("the minted AsyncResult is not readable"),
                        },
                        Err(e) => return problem_response(&e),
                    };
                    let body = serde_json::to_vec(&WireRepresentation::from_trait(&rep)).unwrap();
                    let loc = format!("/{}", reference.id.0);
                    let location = match &self.public_base {
                        Some(base) => format!("{base}{loc}"),
                        None => loc,
                    };
                    attach(
                        HttpResponse::json(202, body).header("location", &location),
                        &res.protocol,
                    )
                }
                None => unmapped("call returned no outcome"),
            },
            // A bare Problem with NO Outcome — the pre-dispatch channel. The operation never ran.
            Err(e) => problem_response(&e),
        }
    }

    /// Does the wrapped scope ADVERTISE async `call`? Read from `capabilities()`, never assumed.
    fn scope_supports_async_call(&self) -> bool {
        self.scope
            .capabilities()
            .iter()
            .any(|c| matches!(c, p::PrimitiveCapabilities::Call(c) if c.async_supported))
    }

    /// `POST /{asyncResultId}/-/cancel`.
    ///
    /// The route carries AN ID AND NOTHING ELSE, which is the whole wire surface `cancel` declares:
    /// `command cancel(asyncResult: unpinned<AsyncResult>)` takes no guard, no mode and no
    /// projection, and D.3 gives the three write guards to `put`/`patch`/`delete` only. So there is
    /// no header or query parameter to read here — and no `If-Match` is read deliberately rather
    /// than by omission: reading one would accept a precondition that `cancel`, alone among the
    /// writes, declares no `412` to report failing.
    ///
    /// Success is `200` carrying the bare pinned ref, the same body shape `put`/`patch`/`delete`
    /// return — `-> pinned<AsyncResult>` is a ref type, so there is no representation to send.
    async fn do_cancel(&self, id_seg: &str) -> HttpResponse {
        let target = resource_id_from(id_seg, None);
        match self.scope.cancel(target).await {
            Ok(res) if res.not_implemented => unmapped("cancel not implemented by this scope"),
            Ok(res) => {
                let (wire, _loc) = write_result_wire(&res);
                attach(HttpResponse::json(200, serde_json::to_vec(&wire).unwrap()), &res.protocol)
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
        if let Some(pc) = self.put_caps() {
            if guards.if_revision.is_some() && !pc.if_match {
                return unadvertised(
                    "put",
                    "ifMatch",
                    "this scope advertises `ifMatch: false`; retry without `If-Match`",
                );
            }
            if guards.if_absent && !pc.if_absent {
                return unadvertised(
                    "put",
                    "ifAbsent",
                    "this scope advertises `ifAbsent: false`; retry without `If-None-Match: *`",
                );
            }
        }
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
        // OUT-OF-VOCABULARY GUARD → 400, not 422. `ifAbsent` (`If-None-Match: *`) is a field of
        // `PutCaps` and of NEITHER `PatchCaps` NOR `DeleteCaps` (core.lumen) — so on a patch it is
        // not an advertised option carrying a bad value, it is an input the operation does not
        // define, and no capability field exists that could ever advertise it either way. A 422
        // here would claim `limit-exceeded`, which means a request past an ADVERTISED bound.
        //
        // This is the SECOND independent producer of op/patch/fault/400; the non-array body below
        // is the first. `SurfaceId` is `(op, status)` and cannot tell them apart, so neither case
        // discharges the other — see the coverage note in gate/src/lib.rs.
        if req.header("if-none-match").is_some() {
            return HttpResponse::json(
                400,
                problem_body(
                    400,
                    "malformed-request",
                    "patch defines no `ifAbsent` guard: `If-None-Match` is not a patch parameter",
                ),
            );
        }
        // A JSON-Patch document is an ARRAY of operations (RFC 6902 §3). Anything else is a bad
        // body, which D.8 names as a `400` trigger in as many words ("a patch that is not a
        // JSON-Patch array"). This check is the first producer of op/patch/fault/400.
        //
        // WHAT THIS REPLACES, and why the old behaviour read as sound: the body fell through to
        // the applier, which answered 422 — and a case recorded that 422 as coverage of
        // op/patch/fault/422, the CAPABILITY-BOUND fault (`limit-exceeded`, a request past an
        // advertised bound). A malformed body is never that. The row was covered for the wrong
        // reason, and the status alone could not show it.
        match serde_json::from_slice::<serde_json::Value>(&req.body) {
            Ok(serde_json::Value::Array(_)) => {}
            _ => {
                return HttpResponse::json(
                    400,
                    problem_body(
                        400,
                        "malformed-request",
                        "a JSON Patch document must be an array of operations (RFC 6902)",
                    ),
                )
            }
        }
        let target = resource_id_from(id_seg, None);
        let patch = p::JsonPatch(p::RawJson(bytes::Bytes::copy_from_slice(&req.body)));
        let if_rev = req.header("if-match").map(|s| p::Rev(std::sync::Arc::from(s)));
        if if_rev.is_some() && self.patch_caps().is_some_and(|pc| !pc.if_match) {
            return unadvertised(
                "patch",
                "ifMatch",
                "this scope advertises `ifMatch: false` on patch; retry without `If-Match`",
            );
        }
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
        // OUT-OF-VOCABULARY GUARD → 400. `DeleteCaps` carries `ifRevision` and `precondition` and
        // no `ifAbsent`, so `If-None-Match` is an input `delete` does not define. Same rule as
        // `patch` above, and the producer of op/delete/fault/400.
        //
        // This row was undeclared by rulings #2/#3 because its ORIGINAL producer — a malformed id
        // under the retired `id:verb` convention — died with that convention. That was true and
        // incomplete: a second producer was in the spec the whole time, in the shape of the
        // capability record rather than of a sentence, so reading D.8's prose could not find it.
        if req.header("if-none-match").is_some() {
            return HttpResponse::json(
                400,
                problem_body(
                    400,
                    "malformed-request",
                    "delete defines no `ifAbsent` guard: `If-None-Match` is not a delete parameter",
                ),
            );
        }
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

/// The `format` (Transport) header refusals that #457 and #458 made normative.
///
/// WINDOWED READS vs THE ONE STREAM. #458 carved `export` out of the return-unified resolution:
/// the windowed reads (`list`, `revisions`) return a `Page`, and `export` is the single exception —
/// a self-framed jsonl backup stream. So the two refusals are mirror images:
///   - `list` / `revisions` refuse `jsonl` and `sse`, and serve `page` or an absent header.
///   - `export` refuses everything that is not `jsonl`, `page` INCLUDED, "since a backup is a
///     stream, not a windowed `Page`".
///
/// WHY THIS IS A REFUSAL AND NOT A DEFAULT. Serving the windowed bytes under a `jsonl` request —
/// which is what this binding did, with a 200 — is "the default encoding, as if the param were
/// absent", which rc2 names as the silent-failure class: the caller asked for a transport, got a
/// success, and got something else. The status alone does not carry that, which is why the cases
/// also assert the refused body is not served.
///
/// `invalid-parameter`, not `bad-request`: D.8's 400 row names `malformed-request` and
/// `invalid-parameter`, and an invalid parameter VALUE is explicitly the second. The nine
/// `bad-request` sites in this file are an unregistered code awaiting Donna's vocabulary batch; a
/// new site must not join them.
fn refuse_format(req: &HttpRequest, allowed: &[&str], op: &str) -> Option<HttpResponse> {
    let got = req.header("format").map(|f| f.trim().to_ascii_lowercase());
    match got.as_deref() {
        None | Some("") => None,
        Some(f) if allowed.contains(&f) => None,
        Some(f) => Some(HttpResponse::json(
            400,
            problem_body(
                400,
                "invalid-parameter",
                &format!(
                    "`{op}` does not serve `format: {f}`; it accepts {} — serving the default \
                     encoding instead would be a silent substitution",
                    allowed.join(" | ")
                ),
            ),
        )),
    }
}

fn problem_body(status: u16, code: &str, detail: &str) -> Vec<u8> {
    let prob = WireProblem {
        r#type: format!("tag:bdp.dev,2026:problem/{}", code),
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

/// Read an `application/jsonl` import body, REFUSING a stream that is not whole.
///
/// SERVER-SIDE AND SEPARATE from the client's `parse_export_jsonl`, deliberately. The client parses
/// what it RECEIVES and the server parses what it is SENT; sharing one function would make a single
/// leniency apply to both directions at once, and these two have different obligations — a reader
/// that takes a truncated export must refuse it (core.lumen `ExportEnd`: "a reader that takes a
/// whole export lacking it refuses it (`400`)"), while an importer additionally has to accept
/// rc2's CHUNKED form, where `ExportBegin` appears only in the first batch and `ExportEnd` only in
/// the last.
///
/// CHUNKING IS NOT IMPLEMENTED HERE AND SO IS NOT PRETENDED AT: this binding accepts only the
/// one-shot form, which is the whole stream, and rejects a stream lacking its terminator. When
/// `importId`/`fromOrdinal` resume lands, the terminator check becomes conditional on being the
/// final batch — and until then a conditional check would be a branch nothing takes.
fn parse_import_jsonl(body: &[u8]) -> Result<Vec<p::ExportRecord>, String> {
    let text = String::from_utf8_lossy(body);
    let mut out = Vec::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let rec: WireExportRecord = serde_json::from_str(line)
            .map_err(|e| format!("bad import line: {e}"))?;
        out.push(rec.into_trait());
    }
    match out.last() {
        Some(p::ExportRecord::End(_)) => Ok(out),
        None => Err("import carried no lines at all; a whole export is framed by Begin and End, \
                     so this stream is truncated"
            .into()),
        Some(_) => Err("the import stream does not end with ExportEnd, so it is truncated and \
                        MUST NOT be applied as whole"
            .into()),
    }
}

/// `?limit=` as a number, or the D.8 `invalid-parameter` fault.
///
/// AN INVALID PARAMETER VALUE IS A 400, and D.8 says so in as many words: "`malformed-request` /
/// `invalid-parameter` — a malformed or invalid request. Three shapes reach it. A BAD BODY … AN
/// INVALID PARAMETER VALUE. Or A WRITE GUARD THE OPERATION DOES NOT DEFINE".
///
/// EVERY CALLER USED `.and_then(|s| s.parse().ok())`, which SILENTLY DROPPED a bad value and
/// answered 200 over the caller's whole collection. That is the same defect as a silently dropped
/// selector and worse than refusing: `?limit=abc` meant "give me everything" instead of "that is
/// not a number". It also left `list/400` and `revisions/400` with no producer — two declared fault
/// rows whose only reachable path had been turned into a success.
fn parse_limit(req: &HttpRequest) -> Result<Option<u32>, HttpResponse> {
    match req.query.get("limit") {
        None => Ok(None),
        Some(raw) => raw.parse::<u32>().map(Some).map_err(|_| {
            HttpResponse::json(
                400,
                problem_body(
                    400,
                    "invalid-parameter",
                    &format!("`limit` must be a non-negative integer; got `{raw}`"),
                ),
            )
        }),
    }
}

/// The ENFORCE side of the capability dual, read off `capabilities()` and never hard-coded.
///
/// core.lumen states the rule on `CoreCapabilities`: "Each limit record is the advertise side of a
/// dual: the matching `limit-exceeded` (422) is the enforce side." So a guard whose field is
/// advertised FALSE must be refused, and refused as `422 limit-exceeded` naming the bound — not
/// honored anyway, and not answered `501`, which says the whole op is absent.
///
/// THIS IS NOT THE SAME FAULT AS AN OUT-OF-VOCABULARY GUARD, and the two sit a few lines apart in
/// this file deliberately. `If-None-Match` on `patch` is `400`: `ifAbsent` is not a field of
/// `PatchCaps` at all, so no advertisement could have offered or refused it and the request names
/// something the operation does not define. `If-Match` on a `put` advertising `ifMatch: false` is
/// `422`: the field EXISTS, this scope says it does not support it, and the caller fixes the
/// request by dropping the guard. A binding that collapsed them would tell a client to stop using
/// a parameter that is simply unavailable here.
fn unadvertised(op: &str, limit: &str, detail: &str) -> HttpResponse {
    problem_response(&p::BdpError::LimitExceeded {
        capability: op.into(),
        limit: limit.into(),
        detail: detail.into(),
    })
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
