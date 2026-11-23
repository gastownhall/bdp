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
    None,
}

const SCOPE_VERBS: &[&str] = &["apply", "eval", "import", "export"];
const RES_VERBS: &[&str] = &["revisions"];

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
