//! The BDP tier-1 conformance gate — the coverage DENOMINATOR.
//!
//! This library is pure and dependency-light: it parses the repo's GENERATED v0.2.3 OpenAPI catalog
//! and yields the tier-1 coverage surface — every primitive operation plus each of its declared
//! `>=400` fault statuses. The wire-level CASES that cover this surface live in `tests/gate.rs`; they
//! run black-box against the in-memory reference and report covered-vs-uncovered against this set.
//!
//! The denominator is read LIVE from `specs/generated/openapi/core.openapi.json` — the artifact
//! `check-generated.py` regenerates from `specs/src/` and drift-gates in the `specification` job. That
//! is what makes this a LOCKSTEP gate: when the spec's wire surface moves, the denominator moves with
//! it and the uncovered row surfaces here. A vendored snapshot would freeze the denominator and
//! silently stop catching spec changes, which is why it was dropped once #405 merged.
//!
//! Pin: `gastownhall/bdp` `main` @`aa439827` — the #405 MERGE commit (merged commits, never draft
//! tips), where `specs/generated/` first lands. Verified: the merged catalog is byte-identical
//! (sha256 `8eca709d…`) to the draft copy this gate was first built against, so the 52-row surface is
//! unchanged by the merge.
//!
//! PR #407 (`$defs/Resource` was an uncompilable self-cycle) changes this file's BYTES but not this
//! gate's surface. Verified at its head `fc90ba6e`: only `components/schemas/Resource`'s `$ref`
//! moves (`…/Resource` → `…/rep`), the `paths` block is byte-identical by sha256
//! (`770e3ccc…`), and the denominator still yields 9 paths / 13 ops / 39 faults = 52. So the
//! whole-file `8eca709d…` above is the one fact that goes stale when #407 lands; re-record it then.
//! This gate reads only `paths`, and does NOT consume `specs/generated/schema/*.schema.json` — the
//! self-cycle was never reachable from here.

use std::collections::BTreeSet;
use std::fmt;

/// One row of the tier-1 coverage surface: either a primitive operation, or a declared fault
/// (an HTTP `>=400` response) on that operation.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SurfaceId {
    /// A primitive operation, keyed by its OpenAPI `operationId` (e.g. `get`, `create`).
    Op(String),
    /// A declared fault on an operation: `(operationId, http_status)` (e.g. `get` + 404).
    Fault(String, u16),
}

impl fmt::Display for SurfaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SurfaceId::Op(op) => write!(f, "op/{op}"),
            SurfaceId::Fault(op, s) => write!(f, "op/{op}/fault/{s}"),
        }
    }
}

/// The repo's generated v0.2.3 core OpenAPI catalog, read live from `specs/generated/` so the
/// denominator tracks the spec rather than a frozen copy (see the module docs). This is a
/// compile-time include: if the artifact moves or disappears the gate fails loudly at build time
/// instead of quietly measuring a stale surface.
pub const CORE_OPENAPI: &str =
    include_str!("../../../specs/generated/openapi/core.openapi.json");

/// Derive the tier-1 denominator from the pinned OpenAPI: one `Op` per operation and one `Fault`
/// per declared `>=400` response. This is the set the gate measures coverage against.
pub fn denominator() -> BTreeSet<SurfaceId> {
    let doc: serde_json::Value =
        serde_json::from_str(CORE_OPENAPI).expect("specs/generated/openapi/core.openapi.json parses");
    let mut out = BTreeSet::new();
    let paths = doc
        .get("paths")
        .and_then(|p| p.as_object())
        .expect("OpenAPI document has a `paths` object");
    const METHODS: [&str; 8] = ["get", "put", "post", "patch", "delete", "head", "options", "trace"];
    for item in paths.values() {
        let Some(item) = item.as_object() else { continue };
        for (method, op) in item {
            if !METHODS.contains(&method.as_str()) {
                continue;
            }
            let Some(op) = op.as_object() else { continue };
            let Some(opid) = op.get("operationId").and_then(|v| v.as_str()) else { continue };
            out.insert(SurfaceId::Op(opid.to_string()));
            if let Some(resps) = op.get("responses").and_then(|r| r.as_object()) {
                for code in resps.keys() {
                    if let Ok(n) = code.parse::<u16>() {
                        if n >= 400 {
                            out.insert(SurfaceId::Fault(opid.to_string(), n));
                        }
                    }
                }
            }
        }
    }
    out
}

/// The 13 core primitives, for sanity-checking the denominator against the spec surface.
pub const CORE_PRIMITIVES: [&str; 13] = [
    "get", "pull", "push", "call", "cancel", "create", "put", "patch", "delete", "list",
    "revisions", "export", "import",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denominator_has_13_ops_and_matches_core_primitives() {
        let d = denominator();
        let ops: BTreeSet<&str> = d
            .iter()
            .filter_map(|s| match s {
                SurfaceId::Op(o) => Some(o.as_str()),
                _ => None,
            })
            .collect();
        let expected: BTreeSet<&str> = CORE_PRIMITIVES.iter().copied().collect();
        assert_eq!(ops, expected, "OpenAPI ops must equal the 13 core primitives");
    }

    /// The v0.2.3 tier-1 surface, written out ROW BY ROW: each primitive and its declared `>=400`
    /// fault statuses. 13 ops + 39 faults = 52.
    ///
    /// Spelled out rather than counted on purpose. A count alone asserts a WEAKER property than the
    /// one that matters: `patch/415` silently becoming `patch/416` keeps the total at 52, so a
    /// count-only tripwire passes while the surface has moved underneath the cases. That failure mode
    /// is not hypothetical — the generated schema bundle shipped a `$defs/Resource` self-cycle at this
    /// very pin because its own gate checked that `$ref`s resolved BY NAME instead of that they
    /// COMPILED. Same shape of mistake, one artifact over. Assert the thing you actually depend on.
    const EXPECTED_SURFACE: &[(&str, &[u16])] = &[
        ("call", &[409]),
        ("cancel", &[404, 409]),
        ("create", &[400, 409, 422]),
        ("delete", &[400, 404, 409, 412]),
        ("export", &[400]),
        ("get", &[400, 404, 406, 410]),
        ("import", &[400, 409, 422]),
        ("list", &[400, 406]),
        // 415 is v0.2.3-only: the "patch is root-addressed" change pins the request media type to
        // application/json-patch+json, so any other type faults. It is the ENTIRE 52-vs-51 delta
        // against v0.2.2 @ca298b04 — and it is not producible against the current reference, which
        // performs no server-side content-type check at all.
        ("patch", &[400, 404, 409, 412, 415, 422]),
        ("pull", &[400, 405, 410]),
        ("push", &[400, 405, 409, 422]),
        ("put", &[400, 409, 412, 422]),
        ("revisions", &[400, 404]),
    ];

    fn expected_surface() -> BTreeSet<SurfaceId> {
        let mut out = BTreeSet::new();
        for (op, faults) in EXPECTED_SURFACE {
            out.insert(SurfaceId::Op((*op).to_string()));
            for status in *faults {
                out.insert(SurfaceId::Fault((*op).to_string(), *status));
            }
        }
        out
    }

    #[test]
    fn denominator_is_exactly_the_v023_surface() {
        // Deliberate TRIPWIRE: the denominator is read live from specs/generated/, so if the spec's
        // wire surface moves this fails. That is the lockstep gate working — a surface change must be
        // reviewed and the cases updated alongside it, never silently absorbed.
        //
        // It reports the DELTA, not just a mismatch, so whoever moved the spec gets the per-row answer
        // without re-deriving it by hand.
        let actual = denominator();
        let expected = expected_surface();
        if actual != expected {
            let added: Vec<String> = actual.difference(&expected).map(|s| s.to_string()).collect();
            let removed: Vec<String> = expected.difference(&actual).map(|s| s.to_string()).collect();
            panic!(
                "tier-1 surface moved (expected {} rows, generated OpenAPI now yields {}).\n  \
                 ADDED by the spec, not yet in this expectation or the cases: {}\n  \
                 REMOVED from the spec, still expected here: {}\n\
                 Review the delta, then update EXPECTED_SURFACE and tests/gate.rs TOGETHER.",
                expected.len(),
                actual.len(),
                if added.is_empty() { "(none)".into() } else { added.join(", ") },
                if removed.is_empty() { "(none)".into() } else { removed.join(", ") },
            );
        }
        assert_eq!(actual.len(), 52, "the v0.2.3 surface is 52 rows (13 ops + 39 faults)");
    }
}
