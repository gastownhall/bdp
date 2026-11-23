//! Routing prototype for Lydia's provisional HTTP binding (RECONCILE §5). The spec gives abstract
//! `pathItem`s (`scope`/`resource`/…) + a projection rule, and several ops collide on one
//! (method, pathItem) pair — `create`/`apply`/`eval`/`import` all POST `scope`; `list`/`export`
//! both GET `scope`; `get`/`revisions` both GET `resource`. Something must disambiguate the route.
//!
//! Two candidate conventions, BOTH parsed here so the spike can compare them head-to-head:
//!   * **custom-method suffix** (AIP-style): `POST /{scope}:apply`, `GET /{scope}/{id}:revisions`.
//!   * **sub-path**:                          `POST /{scope}/apply`, `GET /{scope}/{id}/revisions`.
//!
//! Finding (see BINDING.md): the sub-path form is AMBIGUOUS with resource ids — `GET /{scope}/export`
//! is indistinguishable from `get` of a resource whose id is `export`, and sub-path verbs steal
//! those ids. The `:verb` suffix carries no such collision (`:` is not an id character here). That
//! asymmetry is the recommendation.

/// A resolved route. `{id}` segments are percent-decoded by the HTTP layer before parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    ScopeCreate,            // POST /
    ScopeList,              // GET  /
    ScopeApply,             // POST /:apply   | POST /apply
    ScopeEval,              // POST /:eval    | POST /eval
    ScopeImport,            // POST /:import  | POST /import
    ScopeExport,            // GET  /:export  | GET  /export
    ScopeCapabilities,      // GET  /:capabilities | GET /capabilities  (discovery)
    ScopeResolveAlias,      // GET  /:resolve-alias?name=NAME  (aliases capability)
    Call(String),           // POST   /{opPath}/-/call
    Cancel(String),         // POST   /{asyncResultId}/-/cancel
    /// A fence was present but its right-hand side is not a known protocol action. The spec is
    /// explicit that this faults 404, NOT 400: the fence split is deterministic, so the request is
    /// well-formed and simply names nothing.
    UnknownAction,
    /// A fence was present and the id to its left is invalid — it contains a bare `-` segment,
    /// which no resource-id segment may be (a literal hyphen-only segment MUST arrive as `%2D`).
    InvalidFencedId,
    Get(String),            // GET /{id}
    Revisions(String),      // GET /{id}:revisions | GET /{id}/revisions
    Put(String),            // PUT /{id}
    Patch(String),          // PATCH /{id}
    Delete(String),         // DELETE /{id}
    Unroutable,
}

/// Which syntactic convention matched — tracked so the prototype can report on each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    Restful,       // plain method on scope/resource, no custom verb
    CustomMethod,  // `:verb` suffix
    SubPath,       // `/verb` extra segment (ambiguous — see module docs)
    Fence,         // the 0.2.3 action fence `/-/` — matched on the RAW path
    None,
}

const SCOPE_VERBS: &[&str] = &["apply", "eval", "import", "export"];
const RES_VERBS: &[&str] = &["revisions"];

/// The CLOSED, fence-free set of protocol actions that may appear to the right of the fence.
///
/// Closed on purpose: the spec validates the right-hand side against a known set and faults `404`
/// for anything else, which is what keeps the id/action split deterministic. These are exactly the
/// actions that appear right of a fence in the generated OpenAPI paths — `/-/create`, `/-/list`,
/// `/-/export`, `/-/import`, `/{opPath}/-/call`, `/{asyncResultId}/-/cancel`,
/// `/{id}/-/revisions`. Adding a name here without a spec path re-opens the ambiguity the fence
/// exists to close.
const FENCE_ACTIONS: &[&str] = &[
    "create", "list", "export", "import", "call", "cancel", "revisions",
];

/// Split a RAW path at the action fence.
///
/// Returns `Some((left_raw, action))` when a fence is present. **Operates on the raw path, before
/// percent-decoding, and takes the LAST `/-/`** — both are normative:
///
/// - *Raw*, because the spec mandates `%2D` for a literal hyphen-only segment inside an id. After
///   decoding, that mandated encoding and a real fence are both `-`, so a CONFORMANT id would be
///   mis-split as a protocol action. Matching raw is what makes the split deterministic.
/// - *Last*, because an id may be slash-bearing, so an earlier `/-/` belongs to whatever is left of
///   it rather than terminating the id.
fn split_fence(raw: &str) -> Option<(&str, &str)> {
    let p = raw.trim_start_matches('/');
    let segs: Vec<&str> = p.split('/').collect();
    // A bare `-` SEGMENT is the fence — not a `-` anywhere in a segment, and not `%2D`.
    let last = segs.iter().rposition(|s| *s == "-")?;
    let left_end: usize = segs[..last].iter().map(|s| s.len() + 1).sum();
    let left = &p[..left_end.saturating_sub(1).min(p.len())];
    let right_start = left_end + 2; // skip "-/"
    let right = p.get(right_start..).unwrap_or("");
    Some((left, right))
}

/// Parse `(method, raw-path, decoded-path)` into a route + the convention that matched.
///
/// The fence is tried FIRST and on the RAW path. Everything after it is the pre-0.2.3 convention
/// prototype, which remains only for the routes the generated paths do not fence.
pub fn parse_raw(method: &str, raw_path: &str, decoded_path: &str) -> (Route, Style) {
    if let Some((left_raw, action)) = split_fence(raw_path) {
        // The right side must be ONE fence-free segment from the closed set.
        if action.is_empty() || action.contains('/') || !FENCE_ACTIONS.contains(&action) {
            return (Route::UnknownAction, Style::Fence);
        }
        // The id left of the fence must not itself contain a bare `-` segment.
        if !left_raw.is_empty() && left_raw.split('/').any(|s| s == "-") {
            return (Route::InvalidFencedId, Style::Fence);
        }
        // Only now decode the id, which is what the fence protected.
        let id = crate::http::pct_decode(left_raw);
        let r = match (method, action, id.is_empty()) {
            ("POST", "create", true) => Route::ScopeCreate,
            ("GET", "list", true) => Route::ScopeList,
            ("GET", "export", true) => Route::ScopeExport,
            ("POST", "import", true) => Route::ScopeImport,
            ("POST", "call", false) => Route::Call(id),
            ("POST", "cancel", false) => Route::Cancel(id),
            ("GET", "revisions", false) => Route::Revisions(id),
            // Right action, wrong method or wrong id-ness (scope action with an id, or a
            // resource action without one). The split still succeeded, so this is not 400.
            _ => Route::UnknownAction,
        };
        return (r, Style::Fence);
    }
    parse(method, decoded_path)
}

/// Parse `(method, decoded-path)` into a route + the convention that matched.
pub fn parse(method: &str, path: &str) -> (Route, Style) {
    let p = path.trim_start_matches('/');

    // 1) Scope root.
    if p.is_empty() {
        return match method {
            "GET" => (Route::ScopeList, Style::Restful),
            "POST" => (Route::ScopeCreate, Style::Restful),
            _ => (Route::Unroutable, Style::None),
        };
    }

    // 2) Custom-method suffix anywhere in the (single) last segment: "id:verb" or ":verb".
    if !p.contains('/') {
        if let Some((base, verb)) = p.rsplit_once(':') {
            return parse_custom(method, base, verb);
        }
        // 3) Plain single segment: a resource id, OR a sub-path scope verb (the ambiguous case).
        return parse_plain(method, p);
    }

    // 4) Two segments "id/rest": sub-path resource verb (ambiguous with a child resource).
    if let Some((id, rest)) = p.split_once('/') {
        if method == "GET" && RES_VERBS.contains(&rest) {
            return (Route::Revisions(id.to_string()), Style::SubPath);
        }
    }
    (Route::Unroutable, Style::None)
}

fn parse_custom(method: &str, base: &str, verb: &str) -> (Route, Style) {
    if base.is_empty() {
        // scope-level custom method: "/:verb"
        return match (method, verb) {
            ("POST", "apply") => (Route::ScopeApply, Style::CustomMethod),
            ("POST", "eval") => (Route::ScopeEval, Style::CustomMethod),
            ("POST", "import") => (Route::ScopeImport, Style::CustomMethod),
            ("GET", "export") => (Route::ScopeExport, Style::CustomMethod),
            ("GET", "capabilities") => (Route::ScopeCapabilities, Style::CustomMethod),
            ("GET", "resolve-alias") => (Route::ScopeResolveAlias, Style::CustomMethod),
            _ => (Route::Unroutable, Style::None),
        };
    }
    // resource-level custom method: "/{id}:verb"
    match (method, verb) {
        ("GET", "revisions") => (Route::Revisions(base.to_string()), Style::CustomMethod),
        _ => (Route::Unroutable, Style::None),
    }
}

fn parse_plain(method: &str, seg: &str) -> (Route, Style) {
    // AMBIGUITY: with the sub-path convention a bare segment under a POST/GET could be a scope
    // verb OR a resource id. We resolve verbs-first for the reserved set, which is exactly the
    // collision: it steals the ids `apply`/`export`/… from the resource namespace.
    match method {
        "POST" if SCOPE_VERBS.contains(&seg) && seg != "export" => {
            let r = match seg {
                "apply" => Route::ScopeApply,
                "eval" => Route::ScopeEval,
                "import" => Route::ScopeImport,
                _ => Route::Unroutable,
            };
            (r, Style::SubPath)
        }
        "GET" if seg == "export" => (Route::ScopeExport, Style::SubPath), // collides with Get("export")
        "GET" if seg == "capabilities" => (Route::ScopeCapabilities, Style::SubPath), // collides with Get("capabilities")
        "GET" => (Route::Get(seg.to_string()), Style::Restful),
        "PUT" => (Route::Put(seg.to_string()), Style::Restful),
        "PATCH" => (Route::Patch(seg.to_string()), Style::Restful),
        "DELETE" => (Route::Delete(seg.to_string()), Style::Restful),
        _ => (Route::Unroutable, Style::None),
    }
}

#[cfg(test)]
mod tests {
    // ---- the action fence ---------------------------------------------------
    //
    // These test the SPLIT RULES directly, which no wire case can: a case can only observe the
    // route that resulted, never which of two readings produced it. The rules are normative and
    // each is independently checkable.

    fn fence(raw: &str) -> Option<(String, String)> {
        super::split_fence(raw).map(|(l, r)| (l.to_string(), r.to_string()))
    }

    #[test]
    fn fence_splits_scope_and_resource_actions() {
        assert_eq!(fence("/-/create"), Some(("".into(), "create".into())));
        assert_eq!(fence("/-/list"), Some(("".into(), "list".into())));
        assert_eq!(fence("/abc/-/revisions"), Some(("abc".into(), "revisions".into())));
    }

    #[test]
    fn fence_permits_a_slash_bearing_id_on_its_left() {
        // An id may contain `/`, which is why the fence is needed to terminate it at all.
        assert_eq!(fence("/sys/aliases/x/-/revisions"), Some(("sys/aliases/x".into(), "revisions".into())));
    }

    #[test]
    fn fence_takes_the_LAST_occurrence() {
        // An earlier `/-/` belongs to whatever is left of it; only the last one terminates the id.
        // (The id it yields here is itself invalid — see the bare-`-` test — but the SPLIT must
        // still be the last fence, or the rule would not be deterministic.)
        assert_eq!(fence("/a/-/b/-/call"), Some(("a/-/b".into(), "call".into())));
    }

    #[test]
    fn a_mandated_percent_2d_is_NOT_a_fence() {
        // THE WHOLE REASON THE RULE IS DEFINED OVER THE RAW PATH. The spec requires a literal
        // hyphen-only segment inside an id to be sent as `%2D`. Matched raw, that is an ordinary
        // id segment; matched after decoding it would be indistinguishable from a fence, and a
        // CONFORMANT client using the mandated encoding would have its id mis-split as an action.
        assert_eq!(fence("/a/%2D/b"), None);
        // ...and with a real fence after it, the encoded segment stays part of the id.
        assert_eq!(fence("/a/%2D/b/-/call"), Some(("a/%2D/b".into(), "call".into())));
    }

    #[test]
    fn a_hyphen_inside_a_segment_is_not_a_fence() {
        // Only a BARE `-` segment fences. `-x`, `x-`, `a-b` are ordinary id characters.
        assert_eq!(fence("/a-b/c"), None);
        assert_eq!(fence("/-x/y"), None);
    }

    #[test]
    fn unknown_action_past_the_fence_is_404_not_400() {
        // The split succeeded, so the request is well-formed and simply names nothing.
        let (r, st) = super::parse_raw("GET", "/-/nonsense", "/-/nonsense");
        assert_eq!(r, Route::UnknownAction, "style was {st:?}");
        // A known action with the wrong method lands the same way.
        assert_eq!(super::parse_raw("DELETE", "/-/list", "/-/list").0, Route::UnknownAction);
        // A scope action given an id, or a resource action without one, likewise.
        assert_eq!(super::parse_raw("GET", "/abc/-/list", "/abc/-/list").0, Route::UnknownAction);
        assert_eq!(super::parse_raw("POST", "/-/call", "/-/call").0, Route::UnknownAction);
    }

    #[test]
    fn a_bare_hyphen_id_segment_is_refused() {
        // No resource-id segment may be a bare `-`; the literal must arrive as `%2D`.
        assert_eq!(super::parse_raw("POST", "/a/-/b/-/call", "/a/-/b/-/call").0, Route::InvalidFencedId);
    }

    #[test]
    fn the_fence_routes_the_spec_paths() {
        assert_eq!(super::parse_raw("POST", "/-/create", "/-/create").0, Route::ScopeCreate);
        assert_eq!(super::parse_raw("GET", "/-/list", "/-/list").0, Route::ScopeList);
        assert_eq!(super::parse_raw("GET", "/-/export", "/-/export").0, Route::ScopeExport);
        assert_eq!(super::parse_raw("POST", "/-/import", "/-/import").0, Route::ScopeImport);
        assert_eq!(super::parse_raw("POST", "/op/-/call", "/op/-/call").0, Route::Call("op".into()));
        assert_eq!(super::parse_raw("POST", "/ar/-/cancel", "/ar/-/cancel").0, Route::Cancel("ar".into()));
        assert_eq!(super::parse_raw("GET", "/x/-/revisions", "/x/-/revisions").0, Route::Revisions("x".into()));
    }

    #[test]
    fn an_unfenced_path_still_routes_restfully() {
        // `/{id}` carries get/put/patch/delete with no fence, so the fallback must stay intact.
        assert_eq!(super::parse_raw("GET", "/abc", "/abc").0, Route::Get("abc".into()));
        assert_eq!(super::parse_raw("DELETE", "/abc", "/abc").0, Route::Delete("abc".into()));
    }

    use super::*;

    #[test]
    fn both_conventions_resolve_the_same_route() {
        assert_eq!(parse("POST", "/:apply").0, Route::ScopeApply);
        assert_eq!(parse("POST", "/apply").0, Route::ScopeApply);
        assert_eq!(parse("GET", "/note-1:revisions").0, Route::Revisions("note-1".into()));
        assert_eq!(parse("GET", "/note-1/revisions").0, Route::Revisions("note-1".into()));
        assert_eq!(parse("GET", "/:export").0, Route::ScopeExport);
        // capabilities discovery resolves under both conventions too.
        assert_eq!(parse("GET", "/:capabilities").0, Route::ScopeCapabilities);
        assert_eq!(parse("GET", "/capabilities").0, Route::ScopeCapabilities);
        // alias resolution (custom-method; name rides as ?name=). An id `resolve-alias` stays
        // reachable via get (`GET /resolve-alias` → Get), since the verb is only the `:` suffix form.
        assert_eq!(parse("GET", "/:resolve-alias").0, Route::ScopeResolveAlias);
        assert_eq!(parse("GET", "/resolve-alias").0, Route::Get("resolve-alias".into()));
    }

    #[test]
    fn subpath_collides_with_ids_but_custom_method_does_not() {
        // The id "export" is UNREACHABLE for `get` under the sub-path convention...
        assert_eq!(parse("GET", "/export").0, Route::ScopeExport); // wanted Get("export")!
        // ...but the custom-method convention keeps the id namespace clean:
        assert_eq!(parse("GET", "/export:revisions").0, Route::Revisions("export".into()));
        assert_eq!(parse("GET", "/note-1").0, Route::Get("note-1".into()));
    }
}
