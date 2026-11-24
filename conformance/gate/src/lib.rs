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
//! Pin: `gastownhall/bdp` `main` @`488a2d01` — merged commits, never draft tips. The surface is
//! **48 rows (13 ops + 35 faults)** over 9 paths.
//!
//! **The `paths` block HAS moved, and that is the point of recording it.** It was `770e3ccc…` and
//! byte-identical from `aa439827` through #407, #408, #410 and #412 — a stability that made it
//! tempting to treat as a guarantee. #411 then moved it to `4bf1225b…` by declaring `put/410` and
//! `patch/410`, the surface tripwire fired naming exactly those two rows, and the expectation moved
//! with the spec in the same PR. That is the lockstep interlock working rather than a regression.
//!
//! So: do NOT quote a digest as evidence of anything. Quote the **per-row delta**. The whole-file
//! digest (now `52d29ba5…`) has moved three times for reasons this gate does not care about —
//! #407's `$defs/Resource` self-cycle fix among them — while `paths` moved once, for a reason it
//! cares about entirely. This gate reads only `paths`: a whole-file change is noise to it, and a
//! `paths` change is the signal.
//!
//! This gate does NOT consume `specs/generated/schema/*.schema.json`, so #407's self-cycle was never
//! reachable from here. It DOES read `specs/src/core/core.lumen` (see [`source_surface`]), so both
//! that path and the catalog path are live dependencies: moving either fails the build.

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
///   knows only the shorthand silently undercounts by one and reports 47 instead of 48.
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

/// The store-wide guarantees, parsed from `core.lumen`'s `// A conformant store keeps:` block.
///
/// THE CONFORMANCE WEIGHT RUNS BACKWARDS TO THE SYNTAX, and that is why this function has to exist
/// separately from everything above it. `core.lumen` carries obligations in three registers:
///
/// | register            | force                                                            |
/// |---------------------|------------------------------------------------------------------|
/// | `/// normative:`    | the file says each one IS a conformance point                    |
/// | `/// description:`  | carries real obligations ("under If-Match", "in commit order") — |
/// |                     | and NO conformance force at all                                  |
/// | plain `//`          | the 14 guarantees below — COUNTED as conformance points          |
///
/// So the weakest syntactic form carries weight and a stronger one carries none. Every other
/// surface check in this crate keys on `///` — [`source_surface`] skips a non-`///` line by
/// deliberate design, so a prose example is never mistaken for an annotation — which left the 14
/// invisible to the gate **by construction**, not by oversight in any one predicate.
///
/// The hole that opened: a change to a guarantee moves the conformance-point count without moving
/// a single wire row. `conformance.yml` triggers on `core.lumen`, so CI RUNS — and nothing asserts,
/// so it passes. The interlock this crate exists to provide was absent for exactly the obligations
/// that govern primitives it is about to cover (4 and 6 govern `revisions`, 12 governs `export`).
pub fn store_wide_guarantees() -> Vec<(u8, String)> {
    let mut out: Vec<(u8, String)> = Vec::new();
    let mut inside = false;
    for raw in CORE_LUMEN.lines() {
        let line = raw.trim_start();
        if line.starts_with("// A conformant store keeps:") {
            inside = true;
            continue;
        }
        if !inside {
            continue;
        }
        // A `///` line cannot appear in this block; reaching real code ends it.
        if !line.starts_with("//") {
            break;
        }
        let body = line.trim_start_matches('/').trim();
        // `n. text` opens a guarantee; anything else is its continuation (4 and 6 wrap).
        match body.split_once(". ") {
            Some((n, rest)) if n.parse::<u8>().is_ok() => {
                out.push((n.parse().unwrap(), rest.trim().to_string()));
            }
            _ => {
                if body.is_empty() {
                    // The blank `//` after guarantee 14 closes the list; the Discovery prose that
                    // follows is NOT a guarantee and must not be swept in as a continuation.
                    if !out.is_empty() {
                        break;
                    }
                } else if let Some((_, text)) = out.last_mut() {
                    text.push(' ');
                    text.push_str(body);
                }
            }
        }
    }
    out
}

// =============================================================================
// TIER 2 — the normative obligation ledger
// =============================================================================

/// How one `/// normative:` obligation is discharged. Exactly one applies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Disposition {
    /// Maps onto tier-1 rows already in [`denominator`] — the wire carries it, so coverage of
    /// those rows IS coverage of this obligation.
    SurfaceBearing,
    /// Exercised by a tier-2 case with no wire status of its own (no fault code to key on).
    Behavioural,
    /// Not yet covered. XFAIL plus a tracking issue, so the gap is named rather than absent.
    Waived,
}

/// One registered obligation: its text, how it is discharged, and the evidence for that claim.
#[derive(Clone, Copy, Debug)]
pub struct Registration {
    /// The obligation text EXACTLY as `core.lumen` carries it, minus the `/// normative:` prefix.
    /// This is the key, so a reworded obligation reads as CHANGED and must be re-registered — the
    /// same choice `EXPECTED_GUARANTEES` makes, and for the same reason.
    pub text: &'static str,
    pub disposition: Disposition,
    /// Surface-bearing: the tier-1 rows it grounds. Behavioural: the case. Waived: the issue.
    pub evidence: &'static str,
}

/// THE LEDGER PINS EACH OBLIGATION'S RESOLUTION, NEVER THE CARDINALITY.
///
/// A count cannot be pinned coherently here and the reason is concrete: PR #428 takes the
/// obligations from 67 to 79. A ledger asserting 67 breaks the moment it lands; one asserting 79
/// cannot be built before it does. Pinning dispositions instead makes this correct from either side
/// of that merge, and a new or reworded line then surfaces as an UNREGISTERED OBLIGATION naming the
/// line — which is also an error a spec author can act on, where a count mismatch is not.
///
/// Registered ahead of the spec change is a legitimate state, reported as PENDING: #428's twelve are
/// registered here and are pending until #428 merges.
pub const EXPECTED_OBLIGATIONS: &[Registration] = &[
    // THE LEDGER'S FIRST PRE-EXISTING FIND: normative on `main` all along, no case, no
    // waiver, and invisible until the ledger enumerated the register. Registered against its
    // own issue rather than #430, which is scoped to #428's cohort.
    Registration {
        text: "The revision changes exactly when the resource's state changes; a write that would leave the state unchanged mints no new revision (and produces no event).",
        // WAIVED, not Behavioural: there is no case yet, and `Behavioural` asserts that a case
        // exercises it. Registering it as behavioural "with a waiver note" was the first thing I
        // wrote, and it is precisely the half-true registration this ledger exists to stop —
        // caught by reading the disposition against its own evidence.
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#433",
    },
    Registration {
        text: "A `Rev` is opaque: compared for equality only, never parsed or inspected.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 1",
    },
    Registration {
        text: "`displayName` is never identity and never a matching/resolution key.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 2",
    },
    Registration {
        text: "Export (the primitive) includes only `Durable` resources; `StorageClass` is per-resource, so a `Durable` scope MAY hold individual `Ephemeral` resources, and an `Ephemeral` resource is local state that is NEVER included in an export stream; `Intrinsic` is computed by the service, not stored.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 3",
    },
    Registration {
        text: "A `Timestamp` is RFC 3339 with an uppercase `T` and `Z`.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 4",
    },
    Registration {
        text: "An `abstract` type is not directly instantiable; a bead MUST use a concrete (leaf) type.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 5",
    },
    Registration {
        text: "`sse` transport is valid ONLY on a live source (pull); a snapshot read (list/query/revisions/export) refuses `format=sse` and faults `400`.",
        disposition: Disposition::SurfaceBearing,
        evidence: "op/list/fault/400, op/export/fault/400, op/revisions/fault/400",
    },
    Registration {
        text: "Supplying both `after` and `from` is malformed and faults `400`.",
        disposition: Disposition::SurfaceBearing,
        // CORRECTED: this cited `op/list/fault/400` and `op/revisions/fault/400` too, which was
        // wrong when written — `after`/`from` are declared ONLY on `pull`, so the trigger could not
        // reach those ops. The ledger test passed it because it checks the cited rows are REAL
        // denominator rows, not that the trigger REACHES them, and it cannot check the latter: the
        // surface model is `Op | Fault` with no params in it. Same grounded-vs-reachable error that
        // was corrected in the README and left live here, because nobody grepped for its other home.
        // gastownhall/bdp#432 declares `after` on list/revisions/export; re-add those two rows in
        // the same unit that lands it, not before.
        evidence: "op/pull/fault/400",
    },
    Registration {
        text: "`cancel` settles an async result as `canceled` and runs NO compensation; effects already produced stay findable via `causedBy`.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 6",
    },
    Registration {
        text: "`put` replaces resource state wholesale (a full-state write), NOT a merge.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 7",
    },
    Registration {
        text: "A patch whose path names an envelope member (`/id`, `/provenance`, `/createdAt`), the whole-document root (`\"\"`), or a property declared `computed` or `serviceManaged` faults — for ANY JSON Patch operation, and for the `from` pointer of `move`/`copy` — whatever the implementation's patch document contains.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 8",
    },
    Registration {
        // RULED since this was first registered: the obligation now says ANY reader of an export
        // stream MUST refuse a truncated file. So #431's `parse_export_jsonl` refusal, with its five
        // unit tests, IS on-obligation rather than the "reader-side strictness" it was shipped as.
        // Still WAIVED, not Behavioural: "any reader" is not fully discharged while `import` — the
        // other reader — is unbound. The export half is covered by `export_truncation_tests`.
        text: "The completed read is the truncation conformance point: a whole export — a one-shot reader's entire file, or a resumable import AT the call that consumes `ExportEnd` (the ack bearing `complete`) — MUST end with an `ExportEnd`, and a reader that takes a whole export lacking it refuses it (`400`). An intermediate resume chunk is a PREFIX by design: it is acked (`acceptedThrough`, not `complete`) and re-offered from, never refused for want of a terminator.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 9",
    },
    Registration {
        text: "`import` is a bulk WRITE (put/create), not a filter/read; a history file is replayed in commit order (history-restore), otherwise it sets current state.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 10",
    },
    Registration {
        text: "Import is RESUMABLE over the export's implicit record ordinals ([[core.lumen#ExportRecord]]). `import` is non-blocking: the scope processes a prefix up to its current admission `credit` (advertised as `window`), marks the remainder `Deferred`, and returns `acceptedThrough` (the high-water ordinal PROCESSED) with `credit` and an optional `retryAfter`. The importer holds the deferred tail and re-offers from `acceptedThrough + 1`; re-offering a record at or below `acceptedThrough` is a benign no-op reported `Deduped`, never a fault. This resume-idempotency is the model's own, not the caller's strategy.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 11",
    },
    Registration {
        text: "`acceptedThrough` is the last PROCESSED record — applied OR rejected — NOT the last success. A `Conflicted` record counts toward `acceptedThrough`, so resume SKIPS it and never re-offers it; a dropped-and-resumed import converges to the same per-record fates as one uninterrupted call.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 12",
    },
    Registration {
        text: "TWO idempotencies ride import and MUST NOT be conflated. Resume-idempotency is protocol-level: a re-offered ordinal ≤ `acceptedThrough` is a no-op, independent of content. Content `dedup` ([[core.lumen#ImportStrategy]]) is a merge strategy: a record whose resource is already present is skipped. Both surface as `Deduped`, but the first is keyed on the stream ordinal and the second on resource presence — they coincide only by accident.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 13",
    },
        // Re-points to SurfaceBearing at the impl PR that binds the params: that is what makes
        // list/export/revisions `400` reachable. Waived until then -- there is no case to name.
    Registration {
        text: "A service offering a read MUST HONOR the floor controls it accepts — not merely declare them: `after` (resume from the cursor), `limit` (window the result), and `format` (encode in the selected transport) — and MUST fault `400` on a malformed value. Silently ignoring a resume cursor or a transport selector — returning the whole set from the start, or the default encoding, as if the param were absent — is NON-CONFORMANT (the silent-failure class, like a dropped `where`). A declared floor param is a promise to act on it.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 14",
    },
        // A DISTINCT trigger from item 9's missing terminator, and deliberately NOT SurfaceBearing
        // on `op/import/fault/400`: one truncation case citing that row would discharge this
        // obligation too while the count-mismatch trigger never fires. `(op, status)` cannot tell
        // two triggers apart, and this test only checks the row exists.
    Registration {
        text: "A reader refuses (`400`) an `ExportEnd` whose `count` disagrees with the Resource records it closes over — this is what tells a whole file from two exports concatenated (each ending in its own `ExportEnd`), which the implicit record-ordinal (stream position) cannot distinguish.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 15",
    },
        // Covering `op/import/fault/422` would prove only that the HARD bound faults. The content
        // here is the DISTINCTION from it, so the row says nothing about the soft path. Re-points
        // to Behavioural when a case proves credit:0 + Deferred exists and is not a 422.
    Registration {
        text: "Backpressure — an `ImportAck` carrying `credit: 0` and a deferred tail — is soft and temporal, not an error, exactly as [[core.lumen#push]]. It is distinct from `limit-exceeded` (422), the hard rejection of a request that exceeds a static capability bound, fixed by shrinking the request. `dryRun` ([[core.lumen#ImportStrategy]]) is inherently one-shot — nothing durable is written, so nothing can be resumed — and returns a single `complete` ack.",
        disposition: Disposition::Waived,
        evidence: "gastownhall/bdp#430 item 16",
    },
];

/// The two lines in `core.lumen` that contain `/// normative:` WITHOUT being obligations: the file
/// documents its own annotation syntax using that syntax, and Appendix E refers to it in prose.
///
/// They are listed because they are the live form of a hazard that has now bitten this file three
/// times — an unanchored `grep -c '/// normative:'` counts them, giving 87 where the answer is 85,
/// exactly as it once gave 69 for 67, 61 for 59 and 15 for 13. A `^`-anchored grep is not the fix
/// either: it now UNDER-counts at 83, because two obligations sit indented inside a type body. The
/// unit is the first non-whitespace token, which is what [`normative_surface`] anchors on, and
/// `the_normative_parse_excludes_the_self_documentation` asserts these never enter the set, so the
/// mistake is structurally impossible rather than left to whoever runs the count.
pub const SELF_DOCUMENTATION_FRAGMENTS: [&str; 2] = [
    "one numbered MUST / SHOULD / MAY line in the generated",
    "line above is a conformance point; the list below gathers the",
];

/// Every `/// normative:` obligation in `core.lumen`, in file order, prefix stripped.
///
/// ANCHORED on the first non-whitespace token, which is the whole method: a substring match also
/// catches the file documenting this very annotation (see [`SELF_DOCUMENTATION_FRAGMENTS`]).
/// Indentation is allowed, because obligations inside a type body are indented.
pub fn normative_surface() -> Vec<String> {
    CORE_LUMEN
        .lines()
        .map(|l| l.trim_start())
        .filter(|l| l.starts_with("/// normative:"))
        .map(|l| l["/// normative:".len()..].trim().to_string())
        .collect()
}

/// The ledger: every obligation partitioned by whether it is registered, and every registration by
/// whether the spec carries it yet.
#[derive(Debug, Default)]
pub struct Ledger {
    /// Present in `core.lumen` AND registered.
    pub registered: Vec<(String, Disposition, &'static str)>,
    /// Present in `core.lumen`, NOT registered — the backlog this ledger exists to burn down.
    pub unregistered: Vec<String>,
    /// Registered but NOT yet in `core.lumen` — a registration landed ahead of its spec change.
    pub pending: Vec<&'static Registration>,
}

pub fn obligation_ledger() -> Ledger {
    let found = normative_surface();
    let mut l = Ledger::default();
    for text in &found {
        match EXPECTED_OBLIGATIONS.iter().find(|r| r.text == text.as_str()) {
            Some(r) => l.registered.push((text.clone(), r.disposition, r.evidence)),
            None => l.unregistered.push(text.clone()),
        }
    }
    for r in EXPECTED_OBLIGATIONS {
        if !found.iter().any(|t| t == r.text) {
            l.pending.push(r);
        }
    }
    l
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
    /// fault statuses. 13 ops + 37 faults = 50.
    ///
    /// RE-PINNED FOUR TIMES. Each re-pin corrects the one before it, and the corrections are the
    /// argument for spelling the surface out row by row instead of asserting a total.
    ///
    /// **1. Rulings #2/#3 (#435)** moved 7 rows out and 7 in while the TOTAL STAYED AT 54 — precisely
    /// the case a count-only tripwire cannot see. The comment below about `patch/415` was written as
    /// a hypothetical; that was it happening.
    ///
    /// | out | why | in | why |
    /// |---|---|---|---|
    /// | `get/400`, `delete/400` | producer died with the retired `id:verb` convention | `put/413`, `patch/413`, `delete/413` | believed grounded: D.8 names an over-budget guard where the scope does not advertise `bodyFormSpill` |
    /// | `patch/400`, `push/400`, `import/400` | no normative producer — PROBED: a malformed patch body answers `422`, `push` is unrouted, `import` is `501` | `get/414`, `list/414`, `revisions/414`, `export/414` | believed grounded: D.8 names the read's query string exceeding the URL budget |
    /// | `get/406`, `list/406` | the genuine orphans — no content negotiation in Core | | |
    ///
    /// **2. Ruling D (#437)** then UNDECLARED all 7 of those incoming rows, taking 54 → 47. They were
    /// grounded and declared but never **OBLIGED**, and the gate had no way to tell the difference:
    ///
    /// - `414` — the spec says the URL-byte limit "is imposed by intermediaries (proxies/CDNs/
    ///   browsers), not the origin", and advertises no origin-side budget. The origin is not the
    ///   conformance point, so no direct-to-origin case can force a `414` at any length.
    /// - `413` — unreachable on BOTH triggers. The over-budget URL guard has no declared budget;
    ///   the request-context header path promises "its max is advertised" but **no capability field
    ///   carries it**, and D.5's 4096 is a floor a Scope MUST ACCEPT, so a case at 4096 must
    ///   succeed. There is no portable threshold.
    ///
    /// Reading a status off an op's `problem` list is NOT the same as that op owing it. Three
    /// levels, not two: **grounded** (the spec says it) → **reachable** (a case can construct it)
    /// → **obliged** (this party must produce it). The first re-pin conflated the third with the
    /// first and called 7 unreachable rows "GROUNDED where the outgoing ones were not". Undeclaring
    /// them strands no grounding, because they had no origin producer to strand.
    ///
    /// **3. #432** re-declared `import/400`, 47 → 48, once `import` had a routed producer.
    ///
    /// **4. The malformed-vs-capability line** re-declared `patch/400` and `delete/400`, 48 → 50,
    /// and this one RETRACTS A REASON GIVEN IN RE-PIN 1 rather than reacting to a new ruling.
    ///
    /// Re-pin 1 dropped `patch/400` on the evidence *"PROBED: a malformed patch body answers
    /// `422`"*. That is an observation about the SUBJECT offered as a finding about the SPEC. D.8
    /// names "a patch that is not a JSON-Patch array" under `400`, and defines `422` as a request
    /// past an ADVERTISED capability bound; the subject was simply wrong, and its `422` was being
    /// recorded as coverage of `patch/422` — a row the suite had never exercised. Probing an
    /// implementation to decide what the spec obliges inverts the direction of evidence, and the
    /// wrong answer then looked confirmed by a green case.
    ///
    /// `delete/400` is the same shape with a different cause. Re-pin 1's reason — its producer died
    /// with the retired `id:verb` convention — was true and incomplete: a second producer was in the
    /// spec throughout, carried by `DeleteCaps`'s FIELD LIST rather than by any sentence.
    /// `ifAbsent` is a field of `PutCaps` and of neither `PatchCaps` nor `DeleteCaps`, so
    /// `If-None-Match` on a patch or a delete is not an advertised option with a bad value but an
    /// input the operation does not define — malformed, not a capability decline, because no field
    /// exists that could advertise it either way. A search of the prose for a producer cannot find
    /// a producer that is a SHAPE.
    ///
    /// **`patch/400` now has TWO independent triggers and is ONE row.** `SurfaceId` is
    /// `(op, status)`, so "covered" for that row means one trigger exercised, not the obligation
    /// discharged, and deleting either case would leave the coverage figure unchanged while a real
    /// producer went untested. Both cases exist, the limitation is stated where they live, and the
    /// ledger carries the distinction nowhere — which is the honest position, not an oversight.
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
        // 400: `If-None-Match` on an op whose `DeleteCaps` carries no `ifAbsent` field — an
        // out-of-vocabulary guard, so malformed rather than a capability decline.
        ("delete", &[400, 404, 409, 412]),
        ("export", &[400]),
        ("get", &[404, 410]),
        ("import", &[400, 409, 422]),
        ("list", &[400]),
        // 415 pins the request media type to application/json-patch+json, so any other type faults.
        //
        // 400 has TWO triggers for this one row: a body that is not a JSON-Patch array, and
        // `If-None-Match` on an op whose `PatchCaps` carries no `ifAbsent` field. One case each; a
        // row cannot say that, so neither case discharges the other.
        //
        // 422 is UNCOVERED and that is the correction, not a regression: it is the
        // capability-bound fault, this subject advertises no bound a request can exceed, and the
        // case that used to claim the row sent a malformed body — which is a 400.
        //
        // 410: a write that TARGETS a retired resource faults Gone, so `put` and `patch` declare it
        // alongside `get`. UNCOVERABLE here for the same reason as `get/410` — a write's 410 is
        // reachable only under `idModel: permanent`, and this subject declares no scope-level id
        // model, so a case has nothing to key on. `put` deliberately declares no 404: an absent id
        // is not an error for `put`, which creates. On `put` the 409 belongs to the `ifAbsent` guard
        // (claiming a spent id), never to the bare operation (updating what is gone).
        ("patch", &[400, 404, 409, 410, 412, 415, 422]),
        ("pull", &[400, 405, 410]),
        ("push", &[405, 409, 422]),
        ("put", &[400, 409, 410, 412, 422]),
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
        assert_eq!(actual.len(), 50, "the v0.2.3 surface is 50 rows (13 ops + 37 faults)");
    }

    /// The STANDING GENERATOR WITNESS: the surface derived from the normative `core.lumen` source must
    /// equal the surface derived from the generated OpenAPI catalog.
    ///
    /// `check-generated.py` validates the pipeline from the source side. This validates it from the
    /// consumer side, independently, in a different language, with no shared code — so agreement means
    /// the generator invents no rows and drops none. A divergence here is a real signal, not noise:
    /// The 14 store-wide guarantees, spelled out so a change to one cannot pass silently.
    ///
    /// SPELLED OUT IN FULL, and the brittleness is the point. A count-only assertion was already
    /// proven inadequate on the wire surface: mutating a declared `415` to `416` left the count at
    /// 52 and the old count-only test passed. The same hole applies here with less excuse, because
    /// there are only 14 rows. Recording the text means an edit must be acknowledged IN THIS LIST,
    /// and the acknowledgement is the diff.
    ///
    /// The cost is deliberate: rewording a guarantee — even fixing a typo — fails this test until
    /// the expectation is updated. For 14 lines that the spec counts as conformance points, that is
    /// the right trade. If this ever feels expensive, the question to ask is whether the guarantee's
    /// MEANING moved, not how to make the test quieter.
    const EXPECTED_GUARANTEES: &[(u8, &str)] = &[
        (1, "A stable identity per resource — never changed, and under `permanent` ([[core.lumen#IdModel]]) never reused; opaque local part. Under `reusable` a retired id MAY be minted again, which is what that model declares."),
        (2, "A type per resource — the (authority, type) pair, frozen at inception."),
        (3, "A body and metadata it stores and does NOT interpret."),
        (4, "A storage class per resource — Durable | Ephemeral | Intrinsic; whether revisions are kept is the scope's revisionModel, not a per-resource field."),
        (5, "Under `versioned` ([[core.lumen#RevisionModel]]), a revision per resource that changes exactly when its state changes. Under `unversioned` no revision is minted and `rev` is absent everywhere, so this guarantee is vacuous rather than violated."),
        (6, "History where offered — prior revisions addressable; offered or not, discoverable."),
        (7, "A transaction marker shared by everything committed together."),
        (8, "A cause minted once per incoming request, stamped on every effect it sets off."),
        (9, "A durable change record per resource per commit — none for a failed or no-change request."),
        (10, "Provenance saved with the change, immutable, never invented."),
        (11, "A changefeed at /sys/changes carrying every commit (replication included)."),
        (12, "Where `export` is offered, an export consistent with itself, with the cursor that matches it."),
        (13, "An authorization view — a hidden resource reads exactly as a missing one."),
        (14, "Where `delete` is offered, deletion that does not erase — under `permanent` the id stays accounted for, and where the scope is also `versioned` the tombstone revision is kept. A `reusable` scope retains neither record ([[core.lumen#delete]]); that is the declared model, not a breach of this guarantee."),
    ];

    /// The guarantees are conformance points this crate could not previously see.
    ///
    /// They live in plain `//` comments, and every other check here keys on `///` — so the gate was
    /// blind to them by construction. A guarantee could be added, removed or rewritten and CI would
    /// run (the workflow triggers on `core.lumen`) and pass, because nothing asserted anything.
    /// Three of them are not hypothetical for this suite: 4 and 6 govern `revisions` and 12 governs
    /// `export`, both primitives whose rows are next to be covered.
    #[test]
    fn the_store_wide_guarantees_have_not_moved() {
        let found = store_wide_guarantees();
        let expected: Vec<(u8, String)> =
            EXPECTED_GUARANTEES.iter().map(|(n, t)| (*n, t.to_string())).collect();
        if found == expected {
            return;
        }
        let mut report = String::new();
        for (n, text) in &expected {
            match found.iter().find(|(m, _)| m == n) {
                None => report.push_str(&format!("\n  REMOVED guarantee {n}: {text}")),
                Some((_, got)) if got != text => report.push_str(&format!(
                    "\n  CHANGED guarantee {n}:\n      was: {text}\n      now: {got}"
                )),
                Some(_) => {}
            }
        }
        for (n, text) in &found {
            if !expected.iter().any(|(m, _)| m == n) {
                report.push_str(&format!("\n  ADDED guarantee {n}: {text}"));
            }
        }
        panic!(
            "the store-wide guarantees moved (expected {}, core.lumen now yields {}).{}\n\n\
             These are COUNTED as conformance points despite living in plain `//` comments, so a \
             change here moves the conformance surface without moving any wire row. Update this \
             expectation in the SAME change as the spec edit, and say in the PR which cases cover \
             the new or changed guarantee — or that none does, and why.",
            expected.len(),
            found.len(),
            if report.is_empty() { "\n  (ordering changed)".to_string() } else { report },
        );
    }

    /// A guarantee is only a tripwire if the parse actually found them, so prove the parse works
    /// rather than trusting an empty result to mean "unchanged". An empty or truncated parse is the
    /// failure mode that would make the test above vacuous — it would compare `[]` to `[]` if the
    /// expectation were also derived, and silently pass if the block were renamed.
    #[test]
    fn the_guarantee_parse_is_not_vacuous() {
        let found = store_wide_guarantees();
        assert_eq!(found.len(), 14, "expected 14 guarantees, parsed {}", found.len());
        let numbers: Vec<u8> = found.iter().map(|(n, _)| *n).collect();
        assert_eq!(numbers, (1..=14).collect::<Vec<u8>>(), "guarantees are not 1..=14 in order");
        assert!(
            found.iter().all(|(_, t)| t.len() > 20 && t.ends_with('.')),
            "a guarantee parsed as a fragment — the continuation handling is wrong"
        );
        // The Discovery paragraph follows the list and is NOT a guarantee. If the stop condition
        // failed it would arrive glued onto 14.
        let (_, last) = found.last().unwrap();
        assert!(
            !last.contains("Discovery advertises"),
            "the Discovery prose was swept into guarantee 14: {last}"
        );
    }

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
        // The off-by-one canary. It was `get/400`, which the fault-surface reconciliation removed —
        // so the canary FAILED when that landed, correctly: its witness has to be a row that is
        // genuinely first in some op's `problem` list, and asserting a row that no longer exists
        // would make it fail forever while testing nothing. `get`'s list is now [404, 410, 414].
        assert!(
            surface.contains(&SurfaceId::Fault("get".into(), 404)),
            "get/404 is the FIRST entry of get's `problem` status list — the off-by-one canary"
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

    // ---- tier 2: the normative obligation ledger ---------------------------

    /// Parse a row name as the report prints it (`op/list/fault/400`, `op/get`).
    fn row(s: &str) -> SurfaceId {
        let p: Vec<&str> = s.trim().split('/').collect();
        match p.as_slice() {
            ["op", name] => SurfaceId::Op((*name).to_string()),
            ["op", name, "fault", code] => {
                SurfaceId::Fault((*name).to_string(), code.parse().expect("fault status parses"))
            }
            _ => panic!("not a row name: {s}"),
        }
    }

    /// The ledger is only a tripwire if the parse found the obligations, so prove the parse works
    /// rather than trusting an empty result to mean "nothing changed".
    #[test]
    fn the_normative_parse_is_not_vacuous() {
        let found = normative_surface();
        assert!(
            found.len() >= 60,
            "parsed only {} obligations — the anchor or the prefix is wrong",
            found.len()
        );
        assert!(
            found.iter().all(|t| t.len() > 20),
            "an obligation parsed as a fragment — check the prefix strip"
        );
        assert!(
            found.iter().all(|t| !t.starts_with("///")),
            "the `/// normative:` prefix was not stripped"
        );
    }

    /// THE STRUCTURAL GUARD. `core.lumen` documents its own annotation syntax USING that syntax, so
    /// a substring match counts the documentation of an obligation as an obligation. That hazard has
    /// hit this file three times (69-for-67 here, 61-for-59 and 15-for-13 before). Anchoring fixes
    /// it; this test is what stops anyone un-fixing it, and it is why the count is trustworthy at
    /// all.
    #[test]
    fn the_normative_parse_excludes_the_self_documentation() {
        let found = normative_surface();
        for frag in SELF_DOCUMENTATION_FRAGMENTS {
            assert!(
                !found.iter().any(|t| t.contains(frag)),
                "a self-documentation line entered the obligation set: {frag:?}\n\nThis is the \
                 unanchored-grep hazard reappearing. The parse must anchor on the first \
                 non-whitespace token, never match `/// normative:` as a substring."
            );
        }
        // And prove the fragments are REAL — a guard against text that no longer exists would pass
        // forever while guarding nothing.
        for frag in SELF_DOCUMENTATION_FRAGMENTS {
            assert!(
                CORE_LUMEN.contains(frag),
                "SELF_DOCUMENTATION_FRAGMENTS is stale: {frag:?} is no longer in core.lumen, so \
                 this test now guards nothing. Re-derive it from the file."
            );
        }
    }

    /// THE TIER-1/TIER-2 INTERLOCK: a surface-bearing obligation claims specific wire rows, and
    /// those rows must exist in the denominator. A registration naming a row that was undeclared, or
    /// misspelled, is a silent lie about where the obligation is discharged — so it fails here.
    #[test]
    fn every_surface_bearing_registration_names_real_rows() {
        let den = denominator();
        for r in EXPECTED_OBLIGATIONS {
            match r.disposition {
                Disposition::SurfaceBearing => {
                    let rows: Vec<SurfaceId> = r.evidence.split(',').map(row).collect();
                    assert!(!rows.is_empty(), "surface-bearing with no rows: {}", r.text);
                    for id in rows {
                        assert!(
                            den.contains(&id),
                            "obligation claims row `{id}`, which is NOT in the denominator:\n  {}\n\n\
                             Either the row was undeclared by a spec change (re-register the \
                             obligation as behavioural or waived) or the evidence is misspelled.",
                            r.text
                        );
                    }
                }
                Disposition::Waived => assert!(
                    r.evidence.contains('#'),
                    "a waived obligation must name a tracking issue: {}",
                    r.text
                ),
                // A behavioural obligation CLAIMS a case exercises it, so its evidence must name
                // one — never an issue reference, which would be a waiver wearing a stronger
                // disposition. This caught a registration of mine that said `Behavioural` while its
                // evidence read "no case yet".
                Disposition::Behavioural => {
                    assert!(
                        !r.evidence.is_empty(),
                        "a behavioural obligation must name its case: {}",
                        r.text
                    );
                    assert!(
                        !r.evidence.contains('#') && !r.evidence.contains("waiv"),
                        "obligation is registered Behavioural but its evidence is a WAIVER, not a \
                         case — use Disposition::Waived:\n  {}\n  evidence: {}",
                        r.text,
                        r.evidence
                    );
                }
            }
        }
    }

    /// REPORT-ONLY, staged exactly like tier-1's `fail-if-no-coverage`: the backlog is expected to be
    /// non-empty today, so an unregistered obligation prints rather than fails. `BDP_GATE_STRICT`
    /// flips it to blocking once the backlog is burnt down.
    #[test]
    fn the_obligation_ledger_report() {
        let l = obligation_ledger();
        let total = l.registered.len() + l.unregistered.len();
        println!("\nobligation ledger: {total} normative obligations in core.lumen");
        println!(
            "  registered: {}  (surface-bearing {}, behavioural {}, waived {})",
            l.registered.len(),
            l.registered.iter().filter(|(_, d, _)| *d == Disposition::SurfaceBearing).count(),
            l.registered.iter().filter(|(_, d, _)| *d == Disposition::Behavioural).count(),
            l.registered.iter().filter(|(_, d, _)| *d == Disposition::Waived).count(),
        );
        println!("  UNREGISTERED (backlog): {}", l.unregistered.len());
        for t in &l.unregistered {
            println!("    - {}", &t[..t.len().min(100)]);
        }
        println!("  PENDING (registered, not yet in the spec): {}", l.pending.len());
        for r in &l.pending {
            println!("    - [{:?}] {}", r.disposition, &r.text[..r.text.len().min(90)]);
        }

        if std::env::var("BDP_GATE_STRICT").is_ok() && !l.unregistered.is_empty() {
            panic!(
                "{} normative obligations are UNREGISTERED. Every `/// normative:` line is a \
                 conformance obligation, so each must resolve to surface-bearing, behavioural or \
                 waived-with-an-issue.",
                l.unregistered.len()
            );
        }
    }

    /// Pending is legitimate but must stay EXPLAINABLE: a registration may be written before the
    /// spec change that carries its text, and until that change lands it has no matching line.
    ///
    /// ASSERTED AS A SET, NOT A CEILING, and the ceiling it replaces was a live hole. This test read
    /// `l.pending.len() <= 12` — sized for #428's cohort — while its own doc comment said "once
    /// #428 merges there should be none". #428 merged. Pending has been 0 since, and the ceiling
    /// still permitted twelve, so **a reworded obligation would have gone PENDING and passed.**
    ///
    /// That matters because `obligation_ledger` matches registered text by EXACT string equality
    /// (`r.text == text`). Any spec PR that rewords a registered `/// normative:` line silently
    /// de-registers it: the obligation reappears in the backlog, the registration drops to pending,
    /// and under a ceiling of twelve nothing goes red. The ledger would report one fewer registered
    /// obligation and no test would say why.
    ///
    /// This was found by asking what a specific incoming spec edit would do to the ledger — the
    /// access-mode cleanup rewords the registered `#430 item 8` line — rather than by reading the
    /// test. An assertion that passes on a COUNT UNDER A CEILING is checking the shape of the
    /// evidence, not the thing: the property wanted here is "every registration still matches a
    /// line in the spec, except these named ones, for these reasons".
    const EXPECTED_PENDING: &[&str] = &[
        // Empty by design. #428's cohort has landed, so every registration should match a live
        // `/// normative:` line. To register ahead of a spec change, add its `evidence` string
        // here with the PR that will carry the text, and remove it when that PR merges.
    ];

    #[test]
    fn pending_registrations_are_accounted_for() {
        let l = obligation_ledger();
        let actual: BTreeSet<&str> = l.pending.iter().map(|r| r.evidence).collect();
        let expected: BTreeSet<&str> = EXPECTED_PENDING.iter().copied().collect();
        if actual != expected {
            let unexpected: Vec<&str> = actual.difference(&expected).copied().collect();
            let stale: Vec<&str> = expected.difference(&actual).copied().collect();
            panic!(
                "the pending set moved.\n  \
                 PENDING but not expected — the spec text was reworded or dropped under a live \
                 registration, so re-register it against its new text: {}\n  \
                 EXPECTED pending but now matching — its spec change has landed, so remove it from \
                 EXPECTED_PENDING: {}",
                if unexpected.is_empty() { "(none)".into() } else { unexpected.join(", ") },
                if stale.is_empty() { "(none)".into() } else { stale.join(", ") },
            );
        }
    }

}
