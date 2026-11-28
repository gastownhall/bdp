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

/// Parse an `application/jsonl` export body, REFUSING a stream that does not end with `ExportEnd`.
///
/// The obligation is a READER obligation, and it is the half that carries the safety property:
///
/// > An export MUST end with the `ExportEnd` line; a reader refuses a file ending without it
/// > (truncation detection) and MUST NOT treat it as whole.
///
/// Emitting a correct terminator buys nothing from a reader that never demands one — a truncated
/// backup would come back `Ok` and apparently whole, which is precisely what the line forbids. This
/// is the third instance in this suite of accepting input the spec says must be refused (`do_put`
/// ignoring `If-Match`; `list` silently ignoring a `where` it could not carry), so the refusal lives
/// here, on the reading side, and not only in the case that checks what the server writes.
///
/// DELIBERATELY NOT CHECKED HERE, because the line does not say it:
/// - that the stream OPENS with `Begin`. The gate case asserts it against the reference server,
///   which is where an expectation about what this binding writes belongs.
/// - that `End.count` matches the records carried. Also asserted in the gate case. Checking it here
///   would make one reading of the count's semantics (frames excluded) load-bearing in a second
///   place, and the spec pins no reading — raised as a question rather than settled by code.
///
/// Parsed LINE BY LINE because the declared content type is `application/jsonl`, not a JSON array.
/// A blank trailing line is skipped rather than treated as a record: the writer ends every line with
/// `\n`, so a well-formed stream has one.
fn parse_export_jsonl(body: &[u8]) -> Result<Vec<p::ExportRecord>, p::BdpError> {
    let text = String::from_utf8_lossy(body);
    let mut out = Vec::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let rec: WireExportRecord = serde_json::from_str(line)
            .map_err(|e| p::BdpError::Backend(format!("bad export line: {e}")))?;
        out.push(rec.into_trait());
    }
    match out.last() {
        Some(p::ExportRecord::End(_)) => Ok(out),
        // An empty body is the degenerate truncation: a well-formed export is never zero lines,
        // because the frames alone are two.
        None => Err(p::BdpError::Backend(
            "export carried no lines at all; a whole export is framed by Begin and End, so this \
             stream is truncated and MUST NOT be treated as whole"
                .into(),
        )),
        Some(_) => Err(p::BdpError::Backend(format!(
            "export does not end with ExportEnd ({} lines read, last is not the terminator); the \
             stream is truncated and MUST NOT be treated as whole",
            out.len()
        ))),
    }
}

/// Where a scope lives, split into the two things this transport actually needs: the authority to
/// dial, and the path prefix every target hangs off.
///
/// `RemoteScope` used to hold a bare `"host:port"` and build every target from `/`, which pinned
/// one scope == one server root. Nothing in the protocol says that: discovery LOCATES a scope, and
/// a server may host several. A base URL carrying a prefix is what lets one endpoint serve more
/// than one scope -- and it is what an operator validating a real deployment actually has. They
/// hold a URL, not an `ip:port`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseUrl {
    /// What `TcpStream::connect` takes. ALWAYS carries an explicit port, defaulted here if the URL
    /// omitted one, so no target-building site needs to know a scheme default.
    authority: String,
    /// `""`, or a path with a leading and no trailing slash (`"/acme/scope-1"`). Prepended to every
    /// request target, discovery included.
    prefix: String,
}

impl BaseUrl {
    /// Parse an operator-supplied base URL. A bare authority (`"127.0.0.1:8080"`) is accepted so
    /// every existing caller keeps working unchanged; `http://host:port/prefix` is the new form.
    ///
    /// `https` is REFUSED, not silently downgraded. This transport is raw TCP with no TLS, so
    /// honouring an `https` base URL would put cleartext on the wire for a caller who asked for a
    /// secure channel. That is the same rule this file already applies to capabilities: a feature
    /// is never half-present. A refusal the operator can read beats a request they think is
    /// encrypted.
    pub fn parse(input: &str) -> Result<Self, p::BdpError> {
        let bad = |m: String| p::BdpError::Backend(m);
        let s = input.trim();
        if s.is_empty() {
            return Err(bad("base URL is empty".into()));
        }
        let rest = if let Some(r) = s.strip_prefix("http://") {
            r
        } else if s.strip_prefix("https://").is_some() {
            return Err(bad(format!(
                "base URL {s:?} is https, and this binding speaks cleartext HTTP over raw TCP with \
                 no TLS. Honouring it would downgrade a caller who asked for a secure channel, so \
                 it is refused instead of served in part."
            )));
        } else if let Some((scheme, _)) = s.split_once("://") {
            return Err(bad(format!(
                "base URL {s:?} has scheme {scheme:?}; this transport supports only http:// or a \
                 bare host:port"
            )));
        } else {
            s
        };
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        if authority.is_empty() {
            return Err(bad(format!("base URL {s:?} has no host")));
        }
        if authority.ends_with(':') {
            return Err(bad(format!("base URL {s:?} has a colon with no port after it")));
        }
        if authority.contains('@') {
            return Err(bad(format!(
                "base URL {s:?} carries userinfo; this client does not forward credentials, and \
                 accepting the URL would quietly drop them"
            )));
        }
        // A port is whatever follows the LAST colon when it is all digits. That test also gets
        // bare IPv6 right: `[::1]` ends `1]`, which is not a port, so it defaults -- whereas
        // `[::1]:8080` ends `8080`, which is.
        let has_port = authority
            .rfind(':')
            .is_some_and(|i| !authority[i + 1..].is_empty()
                && authority[i + 1..].chars().all(|c| c.is_ascii_digit()));
        let authority =
            if has_port { authority.to_string() } else { format!("{authority}:80") };
        // `"/"` trims to `""`, which is the right answer rather than an edge case: the scope sits
        // at the root, exactly as a bare authority means.
        Ok(Self { authority, prefix: path.trim_end_matches('/').to_string() })
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    pub fn prefix(&self) -> &str {
        &self.prefix
    }

    /// The wire target for a scope-relative `path` (which always starts with `/`).
    fn target(&self, path: &str) -> String {
        format!("{}{}", self.prefix, path)
    }
}

pub struct RemoteScope {
    /// Where the scope lives. Replaces the old bare `"127.0.0.1:PORT"`, which could only ever
    /// address a scope at a server's root.
    base: BaseUrl,
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
    /// Connect to a scope at `base` and PROXY its advertised capabilities, so this `RemoteScope`
    /// faithfully represents the backing scope.
    ///
    /// `base` is a base URL -- `http://host:port/prefix`, or a bare `"host:port"` for a scope at a
    /// server's root. Discovery is read AT THE PREFIX, which is the whole point: the scope is
    /// wherever the operator's URL says it is, not wherever this client assumed. That is what lets
    /// an endpoint host several scopes, and what lets someone point this driver at a real
    /// deployment they did not build.
    pub async fn connect(base: impl AsRef<str>) -> Result<Self, p::BdpError> {
        let base = BaseUrl::parse(base.as_ref())?;
        let (scope_caps, caps) = fetch_capabilities(&base).await?;
        Ok(Self { base, caps, scope_caps })
    }

    /// Construct with a known capability set and no discovery round-trip (tests / embedding).
    /// The scope traits must be supplied too: there is no safe default, since guessing one would
    /// have this client assert a guarantee the backing store may not make.
    ///
    /// Returns a `Result` because the base URL is parsed here as well. A constructor that fell back
    /// to some default on a URL it could not read would hand back an object that dials the wrong
    /// place and reports nothing.
    pub fn with_capabilities(
        base: impl AsRef<str>,
        scope_caps: p::ScopeCapabilities,
        caps: Vec<p::PrimitiveCapabilities>,
    ) -> Result<Self, p::BdpError> {
        Ok(Self { base: BaseUrl::parse(base.as_ref())?, caps, scope_caps })
    }

    /// Where this scope was located, for a caller that needs to report or log the endpoint.
    pub fn base(&self) -> &BaseUrl {
        &self.base
    }

    async fn request(
        &self,
        method: &str,
        target: &str,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    ) -> Result<crate::http::HttpResponse, p::BdpError> {
        // Every target is scope-relative and gets the base prefix here, at the ONE site that
        // builds a request. Prefixing at each call site instead would make a forgotten one fail
        // only against a prefixed deployment -- green here, wrong at Chris's endpoint.
        let target = self.base.target(target);
        send(Outgoing { method, host: self.base.authority(), target: &target, headers, body })
            .await
            .map_err(|e| p::BdpError::Backend(format!("transport: {e}")))
    }
}

/// Fetch the server scope's advertised capabilities (`GET /:capabilities`), decoded to the trait
/// form, so `RemoteScope` can proxy them. A free fn so `connect` can call it before `Self` exists.
async fn fetch_capabilities(
    base: &BaseUrl,
) -> Result<(p::ScopeCapabilities, Vec<p::PrimitiveCapabilities>), p::BdpError> {
    let target = base.target("/:capabilities");
    let resp = send(Outgoing { method: "GET", host: base.authority(), target: &target, headers: vec![], body: vec![] })
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
/// Lift a `Page` envelope's cursor and head back into `ProtocolMeta`.
///
/// THE ENVELOPE IS THE WIRE'S FORM OF WHAT `ProtocolMeta` CARRIES IN PROCESS, so a wire client that
/// read the items and dropped the envelope would present a `BdpScope` whose walks cannot terminate
/// — the one place a correct scope becomes an incorrect one purely by being remote.
fn page_protocol(cursor: &Option<String>, head: Option<bool>) -> p::ProtocolMeta {
    p::ProtocolMeta {
        cursor: cursor.as_ref().map(|c| p::Cursor(bytes::Bytes::from(c.clone().into_bytes()))),
        head,
        ..Default::default()
    }
}

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
        (409, Some("validation-failed")) => {
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
        (409, Some("identity-taken")) => p::BdpError::AlreadyExists(rid.clone()),
        // `cancel` on a handle that already carries a `reply`. Reconstructed from the code rather
        // than from the status, because three different conditions answer 409 in this binding
        // (`already-exists`, a declared `call` failure, and this) and a caller that could not tell
        // them apart would have one handler for three unrelated situations.
        (409, Some("already-settled")) => p::BdpError::AlreadySettled { id: rid.clone() },
        (409, _) => p::BdpError::Conflict(p::ConstraintViolation::Cardinality {
            fromprop: String::new(),
            detail: format!("server returned 409 {:?}", code),
        }),
        // An advertised-`false` capability refused the request: 400 `invalid-parameter`. Keyed on
        // the CODE, not the status, because 400 is the busiest status in this binding — `export`'s
        // `format`, `import`'s `partial` source and the out-of-vocab guards all answer 400 — and a
        // caller that could not tell them apart would have one handler for unrelated situations.
        // `capability` is reconstructed so the caller is told which advertised flag to read.
        (400, Some("invalid-parameter")) => {
            let pb = prob.as_ref().expect("code came from a parsed problem");
            p::BdpError::InvalidParameter {
                capability: pb.capability.clone().unwrap_or_default(),
                detail: pb.detail.clone().unwrap_or_default(),
            }
        }
        (400, Some("malformed-request")) => {
            let pb = prob.as_ref().expect("code came from a parsed problem");
            p::BdpError::Unprocessable(pb.detail.clone().unwrap_or_default())
        }
        // A request past a NUMERIC advertised bound: reconstruct the structured rejection from the
        // Problem's extension members, so a caller sees WHICH bound it exceeded and can shrink.
        (422, Some("limit-exceeded")) => {
            let pb = prob.as_ref().expect("code came from a parsed problem");
            p::BdpError::LimitExceeded {
                capability: pb.capability.clone().unwrap_or_default(),
                limit: pb.limit.clone().unwrap_or_default(),
                detail: pb.detail.clone().unwrap_or_default(),
            }
        }
        // A 422 carrying some OTHER code is NOT reconstructed as `Unprocessable` any more. That
        // variant now serialises at 400 (`malformed-request`), so reconstructing it from a 422
        // would hand back an error whose own wire mapping is a different status — the kind of
        // asymmetry only a round-trip test catches, which is why one now exists
        // (`every_structured_fault_round_trips_at_its_own_status`).
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
        // THE CURSOR MUST BE SENT, and it was not. This read forwarded `limit` and dropped
        // `after`, so a caller resuming a walk got PAGE ONE every time with a 200 — the same
        // silent-failure the store had, one layer out, and invisible for the same reason: page one
        // is a correct-looking answer.
        //
        // THREE LAYERS HAD TO AGREE on this one read and none of them did: the store ignored
        // `after`, the client never sent it, and there was no envelope to carry the position back.
        // Fixing any one alone leaves a walk broken, which is why only a case that WALKS TO
        // EXHAUSTION found it.
        let mut q: Vec<String> = Vec::new();
        if let Some(c) = &page.after {
            q.push(format!("after={}", String::from_utf8_lossy(&c.0)));
        }
        if let Some(limit) = page.limit {
            q.push(format!("limit={limit}"));
        }
        let mut target = "/-/list".to_string();
        if !q.is_empty() {
            target.push('?');
            target.push_str(&q.join("&"));
        }
        let resp = self.request("GET", &target, vec![], vec![]).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            200 => {
                // THE PAGE ENVELOPE, not a bare array — see `wire::WirePage`. The envelope's
                // cursor and head are lifted back into `protocol`, so a caller driving
                // `RemoteScope` as a `BdpScope` resumes exactly as it would in-process. Dropping
                // them here would make the wire client the one place a walk cannot terminate.
                let page: crate::wire::WirePage<WireResourceId> = serde_json::from_slice(&resp.body)
                    .map_err(|e| p::BdpError::Backend(format!("bad list response: {e}")))?;
                let ids = page.items.iter().map(|w| w.to_trait()).collect();
                let mut res = p::BdpResult::ok(ids);
                res.protocol = page_protocol(&page.cursor, page.head);
                Ok(res)
            }
            _ => Err(error_from(resp.status, &resp.body, &p::ResourceId::head(p::Scope::This, p::Id(Arc::from(""))))),
        }
    }

    /// `GET /-/export` — the scope as JSONL.
    ///
    /// Parsed LINE BY LINE because the declared content type is `application/jsonl`, not a JSON
    /// array. A blank trailing line is skipped rather than treated as a record: the writer ends
    /// every line with `\n`, so a well-formed stream has one.
     /// import — the bulk WRITE side, sent as `application/jsonl`.
    ///
    /// SERIALIZED LINE BY LINE, matching `export`'s reader on the other side: rc2 fixes
    /// `application/jsonl` on the request, so the body is newline-delimited records and never a
    /// JSON array. The frames ride as records like any other, because `ExportBegin`/`ExportEnd` are
    /// `ExportRecord` variants rather than envelope sugar.
    ///
    /// THE STRATEGY RIDES THE QUERY, not the body. The body is the stream; a merge mode is a
    /// request parameter, and putting it in the stream would make it re-offered on every resumed
    /// chunk once rc2's `importId`/`fromOrdinal` resume lands.
    async fn import(&self, records: &[p::ExportRecord], strategy: p::ImportStrategy)
        -> Result<p::BdpResult<p::ImportReport>, p::BdpError> {
        let mut payload = Vec::new();
        for rec in records {
            payload.extend_from_slice(&serde_json::to_vec(&WireExportRecord::from_trait(rec)).unwrap());
            payload.push(b'\n');
        }
        let headers = vec![("content-type".into(), "application/jsonl".into())];
        let path = match strategy {
            p::ImportStrategy::SetCurrent => "/-/import?strategy=set-current",
            p::ImportStrategy::HistoryRestore => "/-/import?strategy=history-restore",
        };
        let resp = self.request("POST", path, headers, payload).await?;
        if resp.status == 200 {
            let mut res = p::BdpResult::ok(p::ImportReport(p::RawJson(bytes::Bytes::from(resp.body.clone()))));
            res.protocol = crate::wire::protocol_from_headers(&resp);
            Ok(res)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, &p::ResourceId::head(p::Scope::This, p::Id(Arc::from("")))))
        }
    }

    /// pull — read a channel's events, as `application/jsonl`.
    ///
    /// NO `format` HEADER IS SENT, deliberately: `jsonl` is the only transport this binding
    /// implements, and asking for one it would refuse would make the client the reason a case
    /// fails. When `page` lands, this is where the header goes.
    async fn pull(&self, channel: &p::ResourceId, page: p::Page, _filter: Option<&p::ListFilter>, _selector: Option<&p::Selector>)
        -> Result<p::BdpResult<Vec<p::RawJson>>, p::BdpError> {
        let mut q = Vec::new();
        if let Some(c) = &page.after {
            q.push(format!("after={}", String::from_utf8_lossy(&c.0)));
        }
        if let Some(l) = page.limit {
            q.push(format!("limit={l}"));
        }
        let qs = if q.is_empty() { String::new() } else { format!("?{}", q.join("&")) };
        let target = format!("/{}/-/pull{qs}", channel.id.0);
        let resp = self.request("GET", &target, Vec::new(), Vec::new()).await?;
        if resp.status == 200 {
            let page: crate::wire::WirePage<serde_json::Value> = serde_json::from_slice(&resp.body)
                .map_err(|e| p::BdpError::Backend(format!("bad pull response: {e}")))?;
            let events: Vec<p::RawJson> = page
                .items
                .iter()
                .map(|v| p::RawJson(bytes::Bytes::from(serde_json::to_vec(v).unwrap())))
                .collect();
            let mut res = p::BdpResult::ok(events);
            res.protocol = page_protocol(&page.cursor, page.head);
            Ok(res)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, channel))
        }
    }

    /// push — append events to a channel, as `application/jsonl`.
    async fn push(&self, channel: &p::ResourceId, events: &[p::PushEvent])
        -> Result<p::BdpResult<p::PushAck>, p::BdpError> {
        let mut payload = Vec::new();
        for ev in events {
            let line = serde_json::json!({
                "ordinal": ev.ordinal,
                "body": serde_json::from_slice::<serde_json::Value>(ev.body.0.as_ref())
                    .unwrap_or(serde_json::Value::Null),
            });
            // `ordinal: null` would be sent for an unkeyed event; drop the key instead, because
            // the wire type distinguishes ABSENT (the channel assigns) from a value.
            let line = match ev.ordinal {
                Some(_) => line,
                None => serde_json::json!({ "body": line.get("body").cloned().unwrap_or(serde_json::Value::Null) }),
            };
            payload.extend_from_slice(&serde_json::to_vec(&line).unwrap());
            payload.push(b'\n');
        }
        let headers = vec![("content-type".into(), "application/jsonl".into())];
        let target = format!("/{}/-/push", channel.id.0);
        let resp = self.request("POST", &target, headers, payload).await?;
        if resp.status == 200 {
            let wire: crate::wire::WirePushAck = serde_json::from_slice(&resp.body)
                .map_err(|e| p::BdpError::Backend(format!("bad push ack: {e}")))?;
            let mut res = p::BdpResult::ok(wire.to_trait());
            res.protocol = crate::wire::protocol_from_headers(&resp);
            Ok(res)
        } else if resp.status == 501 {
            Ok(p::BdpResult::not_implemented())
        } else {
            Err(error_from(resp.status, &resp.body, channel))
        }
    }

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
            200 => Ok(p::BdpResult::ok(parse_export_jsonl(&resp.body)?)),
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
        // Same omission as `list` had: `after` was dropped, so paging a long history re-read the
        // oldest revisions for ever.
        let mut q: Vec<String> = Vec::new();
        if let Some(c) = &page.after {
            q.push(format!("after={}", String::from_utf8_lossy(&c.0)));
        }
        if let Some(limit) = page.limit {
            q.push(format!("limit={limit}"));
        }
        let mut target = format!("/{}/-/revisions", pct_encode(&resource.id.0));
        if !q.is_empty() {
            target.push('?');
            target.push_str(&q.join("&"));
        }
        let resp = self.request("GET", &target, vec![], vec![]).await?;
        match resp.status {
            501 => Ok(p::BdpResult::not_implemented()),
            200 => {
                let page: crate::wire::WirePage<WireRepresentation> = serde_json::from_slice(&resp.body)
                    .map_err(|e| p::BdpError::Backend(format!("bad revisions response: {e}")))?;
                let reps = page.items.into_iter().map(|w| w.to_trait()).collect();
                let mut res = p::BdpResult::ok(reps);
                res.protocol = page_protocol(&page.cursor, page.head);
                Ok(res)
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

/// Truncation detection on the READING side of `export`.
///
/// These are unit tests rather than gate cases on purpose: the obligation is that a reader refuses a
/// truncated stream, and the reference server never writes one, so no case driven through it can
/// produce the input. Fault injection would mean a server that lies on request — a second subject to
/// keep honest. Testing the parser directly exercises the real refusal with no such machinery, the
/// same split already used for `status_for_outcome` in `server.rs`.
///
/// They claim NO surface row. There is no declared fault for a truncated body, and there should not
/// be: the stream never reached a state the wire could report on.
#[cfg(test)]
mod export_truncation_tests {
    use super::parse_export_jsonl;

    const BEGIN: &str = r#"{"Begin":{"cursor":"c0"}}"#;
    const END: &str = r#"{"End":{"count":0}}"#;

    #[test]
    fn a_whole_export_is_accepted() {
        let body = format!("{BEGIN}\n{END}\n");
        let out = parse_export_jsonl(body.as_bytes()).expect("a framed export must be accepted");
        assert_eq!(out.len(), 2, "both frames must survive the parse");
    }

    #[test]
    fn a_blank_trailing_line_is_still_whole() {
        // The writer ends every line with `\n`, so a well-formed stream has a trailing blank. If
        // this regressed, every honest export would be rejected as truncated — the inverse defect,
        // and the reason the accepting cases are here at all.
        let body = format!("{BEGIN}\n{END}\n\n\n");
        let out = parse_export_jsonl(body.as_bytes()).expect("a trailing newline is not truncation");
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn a_stream_without_the_terminator_is_refused() {
        // THE DEFECT THIS FIXES: before, this returned Ok and the caller received a truncated
        // backup as though it were whole.
        let body = format!("{BEGIN}\n");
        let err = parse_export_jsonl(body.as_bytes())
            .expect_err("a stream with no ExportEnd must be refused, not returned as whole");
        let msg = format!("{err:?}");
        assert!(
            msg.contains("truncated"),
            "the refusal must say the stream is truncated, got: {msg}"
        );
    }

    #[test]
    fn an_empty_body_is_refused() {
        let err = parse_export_jsonl(b"")
            .expect_err("an empty body is the degenerate truncation: the frames alone are two");
        assert!(format!("{err:?}").contains("truncated"));
    }

    #[test]
    fn a_terminator_that_is_not_last_is_refused() {
        // This is the case that discriminates. An implementation asking "does the stream CONTAIN an
        // End" passes every test above and fails this one; the obligation is that the stream ENDS
        // with it, which is what makes it truncation detection rather than a presence check.
        let body = format!("{END}\n{BEGIN}\n");
        parse_export_jsonl(body.as_bytes())
            .expect_err("an ExportEnd that is not the final line does not make a stream whole");
    }
}

#[cfg(test)]
mod base_url_tests {
    use super::*;

    fn ok(s: &str) -> BaseUrl {
        BaseUrl::parse(s).unwrap_or_else(|e| panic!("{s:?} should parse: {e:?}"))
    }

    /// A bare authority is the OLD form and must keep working untouched, because the two existing
    /// callers pass one. The prefix it yields is empty, not `"/"`.
    #[test]
    fn a_bare_authority_is_a_scope_at_the_root() {
        let b = ok("127.0.0.1:8080");
        assert_eq!(b.authority(), "127.0.0.1:8080");
        assert_eq!(b.prefix(), "");
    }

    /// The whole point of the change: authority and prefix come apart, and the prefix survives.
    #[test]
    fn a_base_url_splits_into_authority_and_prefix() {
        let b = ok("http://example.test:9000/acme/scope-1");
        assert_eq!(b.authority(), "example.test:9000");
        assert_eq!(b.prefix(), "/acme/scope-1");
    }

    /// `TcpStream::connect` cannot resolve a scheme default, so the port is materialised here.
    #[test]
    fn an_absent_port_defaults_to_eighty() {
        assert_eq!(ok("http://example.test/scope").authority(), "example.test:80");
        assert_eq!(ok("example.test").authority(), "example.test:80");
    }

    /// A trailing slash is an operator typing a URL, not a different scope. Both spellings of
    /// "the root" must land on the same empty prefix, or targets double their slash.
    #[test]
    fn a_trailing_slash_and_a_bare_root_agree() {
        assert_eq!(ok("http://example.test:80/").prefix(), "");
        assert_eq!(ok("http://example.test:80/scope/").prefix(), "/scope");
        assert_eq!(ok("http://example.test:80").prefix(), "");
    }

    /// BOTH arms. A `target` that is only checked with a prefix would also pass for a driver that
    /// always prefixed; one only checked without would pass for a driver that never did. Neither
    /// test alone discriminates, so neither is written alone.
    #[test]
    fn target_composition_is_checked_with_and_without_a_prefix() {
        assert_eq!(ok("http://h:1/acme").target("/:capabilities"), "/acme/:capabilities");
        assert_eq!(ok("h:1").target("/:capabilities"), "/:capabilities");
        // And the resource form, where a doubled slash would be silently accepted by many servers
        // and change the path for a strict one.
        assert_eq!(ok("http://h:1/acme").target("/things/1"), "/acme/things/1");
    }

    /// Refused, not downgraded. The transport has no TLS, so serving this would put cleartext on
    /// the wire for someone who asked for a secure channel.
    #[test]
    fn https_is_refused_rather_than_silently_downgraded() {
        let e = BaseUrl::parse("https://example.test/scope").expect_err("https must not parse");
        let msg = format!("{e:?}");
        assert!(
            msg.contains("https") && msg.contains("TLS"),
            "the refusal must say WHY, so an operator can act on it; got: {msg}"
        );
    }

    #[test]
    fn an_unsupported_scheme_is_named_in_its_refusal() {
        let e = BaseUrl::parse("ftp://example.test/scope").expect_err("ftp must not parse");
        assert!(format!("{e:?}").contains("ftp"), "refusal should name the scheme it rejected");
    }

    /// Credentials this client never forwards must not be accepted and dropped: a URL that
    /// "worked" while losing its userinfo is how an auth failure gets blamed on the server.
    #[test]
    fn userinfo_is_refused_because_it_would_be_dropped() {
        assert!(BaseUrl::parse("http://user:pw@example.test/scope").is_err());
    }

    /// The port detector is a last-colon-all-digits test, which is exactly the rule that bare IPv6
    /// breaks. Both arms, because a detector that never found a port would still pass the first.
    #[test]
    fn bare_ipv6_is_not_mistaken_for_a_port_and_a_real_one_is_still_found() {
        assert_eq!(ok("http://[::1]/scope").authority(), "[::1]:80");
        assert_eq!(ok("http://[::1]:8080/scope").authority(), "[::1]:8080");
    }

    #[test]
    fn the_degenerate_inputs_are_refused() {
        assert!(BaseUrl::parse("").is_err());
        assert!(BaseUrl::parse("   ").is_err());
        assert!(BaseUrl::parse("http://").is_err(), "no host");
        assert!(BaseUrl::parse("http://example.test:/scope").is_err(), "colon with no port");
    }
}

#[cfg(test)]
mod fault_round_trip_tests {
    use super::*;

    /// A STRUCTURED FAULT MUST SURVIVE THE WIRE AND COME BACK AS ITSELF, at the same status.
    ///
    /// This exists because the RC3 fault-vocabulary pass moved two variants between statuses, and
    /// the two halves of that move live in different files: `WireProblem::from_error` (wire.rs)
    /// serialises, `error_from` (here) reconstructs. Each half compiled and tested green on its
    /// own while disagreeing with the other — `Unprocessable` went out at 400 and came back from
    /// 422 — and nothing in the tree compared them. Statuses are asserted as well as variants,
    /// because a reconstruction that lands on the right variant from the wrong status re-serialises
    /// to a different response than it parsed.
    #[test]
    fn every_structured_fault_round_trips_at_its_own_status() {
        let rid = p::ResourceId::head(p::Scope::This, p::Id(Arc::from("r")));
        let cases: Vec<(p::BdpError, u16, &str)> = vec![
            (
                p::BdpError::InvalidParameter {
                    capability: "pull.selector".into(),
                    detail: "this scope advertises `selector: false` on pull".into(),
                },
                400,
                "invalid-parameter",
            ),
            (p::BdpError::Unprocessable("not json".into()), 400, "malformed-request"),
            (
                p::BdpError::LimitExceeded {
                    capability: "push".into(),
                    limit: "maxBatch".into(),
                    detail: "at most 2 per batch".into(),
                },
                422,
                "limit-exceeded",
            ),
        ];

        for (sent, want_status, want_code) in cases {
            let (status, prob) = WireProblem::from_error(&sent);
            assert_eq!(status, want_status, "outbound status for {sent:?}");
            assert_eq!(prob.code, want_code, "outbound code for {sent:?}");
            let body = serde_json::to_vec(&prob).expect("problem serialises");
            let back = error_from(status, &body, &rid);

            match (&sent, &back) {
                (
                    p::BdpError::InvalidParameter { capability: a, detail: da },
                    p::BdpError::InvalidParameter { capability: b, detail: db },
                ) => {
                    assert_eq!(a, b, "`capability` lost over the wire");
                    assert_eq!(da, db, "`detail` lost over the wire");
                }
                (p::BdpError::Unprocessable(a), p::BdpError::Unprocessable(b)) => {
                    assert_eq!(a, b, "the malformed-payload message lost over the wire")
                }
                (
                    p::BdpError::LimitExceeded { capability: a, limit: la, detail: da },
                    p::BdpError::LimitExceeded { capability: b, limit: lb, detail: db },
                ) => {
                    assert_eq!(a, b, "`capability` lost over the wire");
                    assert_eq!(la, lb, "`limit` lost over the wire");
                    assert_eq!(da, db, "`detail` lost over the wire");
                }
                (s, b) => panic!("round trip changed the variant: sent {s:?}, got back {b:?}"),
            }

            // AND IT CAME BACK FROM THE RIGHT STATUS. Reconstructing the same variant from some
            // other status would pass the match above and still be wrong.
            let (restatus, reprob) = WireProblem::from_error(&back);
            assert_eq!(restatus, want_status, "re-serialising the reconstruction moved the status");
            assert_eq!(reprob.code, want_code, "re-serialising the reconstruction moved the code");
        }
    }

    /// A 422 CARRYING AN UNKNOWN CODE IS `Backend`, NOT `Unprocessable`.
    ///
    /// `Unprocessable` serialises at 400 now, so reconstructing it from a 422 would hand a caller
    /// an error whose own mapping is a different status — which is what the catch-all did before
    /// this pass. The 400 mirror is asserted too, so the arms cannot both quietly become a
    /// catch-all that swallows everything.
    #[test]
    fn an_unknown_code_is_not_reconstructed_as_a_structured_fault() {
        let rid = p::ResourceId::head(p::Scope::This, p::Id(Arc::from("r")));
        let body = br#"{"type":"t","title":"x","status":422,"code":"something-new","retry":"no"}"#;
        match error_from(422, body, &rid) {
            p::BdpError::Backend(m) => assert!(
                m.contains("something-new"),
                "the opaque fallback must still name the code it could not place; got {m}"
            ),
            other => panic!("a 422 with an unknown code must not become a structured fault: {other:?}"),
        }

        let body400 = br#"{"type":"t","title":"x","status":400,"code":"bad-request","retry":"no"}"#;
        match error_from(400, body400, &rid) {
            p::BdpError::Backend(_) => {}
            other => panic!("a 400 with an unmapped code must not become a structured fault: {other:?}"),
        }
    }
}
