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

/// The NORMATIVE source the catalog is generated from, also read live. Pairing this with
/// [`CORE_OPENAPI`] lets the gate witness the generator from the opposite side: see
/// [`source_surface`].
pub const CORE_LUMEN: &str = include_str!("../../../specs/src/core/core.lumen");

/// Slice the balanced-delimiter region that starts at the first `open` at or after `from`.
/// Returns the inner span, exclusive of the outer delimiters.
fn balanced(hay: &str, from: usize, open: u8, close: u8) -> Option<&str> {
    let bytes = hay.as_bytes();
    let start = (from..bytes.len()).find(|&i| bytes[i] == open)?;
    let mut depth = 0usize;
    for i in start..bytes.len() {
        if bytes[i] == open {
            depth += 1;
        } else if bytes[i] == close {
            depth -= 1;
            if depth == 0 {
                return hay.get(start + 1..i);
            }
        }
    }
    None
}

/// Every status in `span`, in order. Handles BOTH spellings the annotations use:
/// `status = 409` (the per-response form) and `status = [400,404,410]` (the `problem` shorthand).
fn statuses(span: &str) -> Vec<u16> {
    let mut out = Vec::new();
    let mut rest = span;
    while let Some(i) = rest.find("status") {
        rest = &rest[i + "status".len()..];
        let Some(after) = rest.trim_start().strip_prefix('=') else { continue };
        let after = after.trim_start();
        if let Some(arr) = after.strip_prefix('[') {
            let end = arr.find(']').unwrap_or(arr.len());
            out.extend(arr[..end].split(',').filter_map(|t| t.trim().parse::<u16>().ok()));
        } else {
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = digits.parse::<u16>() {
                out.push(n);
            }
        }
    }
    out
}

/// Derive the SAME tier-1 surface straight from the normative `core.lumen` `/// openapi =` lowering
/// annotations, independently of the generated catalog.
///
/// This exists to witness the generator from the other side. [`denominator`] reads the GENERATED
/// artifact; this reads the SOURCE the artifact is generated from. If the two agree, the generator
/// invents no rows and drops none — a property no single-sided check can establish, and one that is
/// worth having standing rather than ad hoc (the generated schema bundle shipped an uncompilable
/// `$defs/Resource` self-cycle at this pin precisely because its own gate only ever looked at one
/// side of its pipeline).
///
/// TWO ACCEPTED ANNOTATION SHAPES, and anything counting this surface must read both:
/// - `problem = { status = [...] }` — the shorthand for "each of these statuses returns a `Problem`".
///   12 of the 13 primitives use it.
/// - `responses = [ { status = ..., schema = ... }, ... ]` — the explicit, per-status form. `call`
///   alone uses it, and that is LOAD-BEARING, not an inconsistency: its statuses carry distinct
///   schemas, and its `409` returns a `Reply` (a declared domain failure, branch on the arm), NOT a
///   `Problem`. Normalizing it to the shorthand would misstate the wire contract. A counter that
///   knows only the shorthand silently undercounts by one and reports 51 instead of 52.
pub fn source_surface() -> BTreeSet<SurfaceId> {
    let mut out = BTreeSet::new();
    for line in CORE_LUMEN.lines() {
        let line = line.trim_start();
        // A doc-comment annotation only: `//` example lines inside prose must not be picked up.
        if !line.starts_with("///") || !line.contains("openapi") {
            continue;
        }
        let Some(idx) = line.find("operationId") else { continue };
        let Some(rest) = line[idx..].split_once('"').map(|(_, r)| r) else { continue };
        let Some((op, _)) = rest.split_once('"') else { continue };
        out.insert(SurfaceId::Op(op.to_string()));

        let mut codes = Vec::new();
        if let Some(p) = line.find("problem") {
            if let Some(span) = balanced(line, p, b'{', b'}') {
                codes.extend(statuses(span));
            }
        }
        if let Some(r) = line.find("responses") {
            if let Some(span) = balanced(line, r, b'[', b']') {
                codes.extend(statuses(span));
            }
        }
        for c in codes.into_iter().filter(|c| *c >= 400) {
            out.insert(SurfaceId::Fault(op.to_string(), c));
        }
    }
    out
}

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

    /// The STANDING GENERATOR WITNESS: the surface derived from the normative `core.lumen` source must
    /// equal the surface derived from the generated OpenAPI catalog.
    ///
    /// `check-generated.py` validates the pipeline from the source side. This validates it from the
    /// consumer side, independently, in a different language, with no shared code — so agreement means
    /// the generator invents no rows and drops none. A divergence here is a real signal, not noise:
    /// either the catalog is stale against `specs/src/`, or the lowering dropped//invented a response.
    #[test]
    fn generated_catalog_matches_the_normative_source() {
        let generated = denominator();
        let source = source_surface();
        if generated != source {
            let only_gen: Vec<String> =
                generated.difference(&source).map(|s| s.to_string()).collect();
            let only_src: Vec<String> =
                source.difference(&generated).map(|s| s.to_string()).collect();
            panic!(
                "the generated catalog and the normative source disagree \
                 (generated {} rows, source {}).\n  \
                 In the GENERATED catalog but NOT in specs/src/core/core.lumen: {}\n  \
                 In core.lumen but MISSING from the generated catalog: {}\n\
                 Either specs/generated/ is stale (regenerate it) or the lowering is wrong. Do not \
                 relax this test to make it pass.",
                generated.len(),
                source.len(),
                if only_gen.is_empty() { "(none)".into() } else { only_gen.join(", ") },
                if only_src.is_empty() { "(none)".into() } else { only_src.join(", ") },
            );
        }
    }

    /// Direct test of the annotation parser, on both accepted shapes.
    ///
    /// The equality witness above already catches parser bugs, but only TRANSITIVELY and
    /// AMBIGUOUSLY: a 38-row delta reads identically whether the catalog went stale or the parser
    /// dropped something. This localizes it.
    ///
    /// Earned the hard way, twice. The Rust parser's first cut handled `status = N` but not
    /// `status = [...]`, dropping every `problem`-form fault. Then a throwaway re-implementation of
    /// this same logic, written to spot-check a branch, forgot to strip the leading `[` and so dropped
    /// the FIRST status of every list — a 12-row phantom divergence that would have sent a peer
    /// chasing a generator bug that did not exist. An off-by-one in bracket handling is evidently the
    /// failure mode here, so both forms and the first-element case are pinned explicitly.
    #[test]
    fn parses_both_annotation_shapes_including_the_first_status() {
        // The `problem` shorthand: every listed status, the first one included.
        assert_eq!(
            statuses(" status = [400,404,406,410] "),
            vec![400, 404, 406, 410],
            "the problem-shorthand status list must yield EVERY status, not all-but-the-first"
        );
        // The explicit per-response form, as `call` uses it.
        assert_eq!(
            statuses(" { status = 200, schema = \"Reply\" }, { status = 409, schema = \"Reply\" } "),
            vec![200, 409],
            "the explicit per-response array form must yield each response's status"
        );
        // Single-element list, and a span with no statuses at all.
        assert_eq!(statuses(" status = [422] "), vec![422]);
        assert_eq!(statuses(" nothing here "), Vec::<u16>::new());
        // Balanced slicing must respect nesting rather than stopping at the first close.
        assert_eq!(balanced("a = { b = { c }, d }, e", 0, b'{', b'}'), Some(" b = { c }, d "));

        // And the shapes must both survive end-to-end: `call` contributes its 409 via the responses
        // array, which is the row a shorthand-only counter silently loses.
        let surface = source_surface();
        assert!(
            surface.contains(&SurfaceId::Fault("call".into(), 409)),
            "call/409 comes from the `responses = [...]` form; losing it undercounts the surface by one"
        );
        assert!(
            surface.contains(&SurfaceId::Fault("get".into(), 400)),
            "get/400 is the FIRST entry of get's `problem` status list — the off-by-one canary"
        );
    }

    /// `call/409` is the ONE `>=400` row in the surface that does not return a `Problem`.
    ///
    /// Every other fault row responds `application/problem+json` with a `Problem`. `call`'s `409` is a
    /// DECLARED DOMAIN FAILURE: it responds `application/json` with a `Reply`, and the caller branches
    /// on the arm. A case covering that row must therefore assert a `Reply`, not a Problem — expecting
    /// a Problem there fails for the wrong reason and looks like a reference bug.
    ///
    /// So this is a TRIPWIRE on the exception, not a blessing of it: if the spec grows a second
    /// non-Problem `>=400` response, this fails and the new row gets the same scrutiny rather than
    /// being quietly assumed Problem-shaped.
    #[test]
    fn call_409_is_the_only_non_problem_fault_row() {
        let doc: serde_json::Value = serde_json::from_str(CORE_OPENAPI).unwrap();
        let mut non_problem = BTreeSet::new();
        for item in doc["paths"].as_object().unwrap().values() {
            let Some(item) = item.as_object() else { continue };
            for op in item.values() {
                let Some(op) = op.as_object() else { continue };
                let Some(opid) = op.get("operationId").and_then(|v| v.as_str()) else { continue };
                let Some(resps) = op.get("responses").and_then(|r| r.as_object()) else { continue };
                for (code, body) in resps {
                    let Ok(status) = code.parse::<u16>() else { continue };
                    if status < 400 {
                        continue;
                    }
                    let is_problem = body
                        .get("content")
                        .and_then(|c| c.as_object())
                        .map(|c| c.contains_key("application/problem+json"))
                        .unwrap_or(false);
                    if !is_problem {
                        non_problem.insert(SurfaceId::Fault(opid.to_string(), status));
                    }
                }
            }
        }
        let expected: BTreeSet<SurfaceId> = [SurfaceId::Fault("call".into(), 409)].into();
        assert_eq!(
            non_problem, expected,
            "the set of >=400 rows that do NOT return application/problem+json has changed. \
             call/409 is the sole sanctioned exception (a declared failure returning Reply). A new \
             entry here needs a deliberate ruling and a case that asserts the right wire shape."
        );
    }
}
