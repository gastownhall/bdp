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

    #[test]
    fn denominator_is_52_rows() {
        // 13 ops + 39 declared >=400 fault rows = 52 (the v0.2.3 surface @aa439827).
        //
        // Deliberate TRIPWIRE: the denominator is read live from specs/generated/, so if the spec's
        // wire surface moves this fails. That is the lockstep gate working — a surface change must be
        // reviewed and the cases updated alongside it, never silently absorbed.
        assert_eq!(
            denominator().len(),
            52,
            "tier-1 surface moved: the generated OpenAPI no longer yields 52 rows (13 ops + 39 \
             faults). Review the delta and update the cases and this expectation together."
        );
    }
}
