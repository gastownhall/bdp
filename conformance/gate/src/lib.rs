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
//! Pin: `gastownhall/bdp` `main` — merged commits, never draft tips. The surface is
//! **51 rows (13 ops + 38 faults)**, and it is DERIVED AT RUN TIME, never pinned here.
//!
//! THIS LINE SAID 48 AT `488a2d01` and stayed there while the surface moved to 50 and then 51.
//! It is the first thing anyone reads, and two sweeps missed it: one grepped for the stale value I
//! expected (50) rather than for the SHAPE of a surface claim, and the other looked only at the
//! declaration it sat above. The number now carries the derivation rather than a pin, so there is
//! one fewer hand-maintained copy to drift — and the sha is dropped, because a pinned sha in prose
//! is a second copy of something `git` already knows.
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
    // waiver, and invisible until the ledger enumerated the register.
    //
    // NOW DISCHARGED, and the waiver is removed in the same change that discharged it rather
    // than left behind as a stale label. It was Waived because `Behavioural` asserts that a case
    // exercises it and there was none; registering it as behavioural "with a waiver note" was the
    // first thing I wrote, and it is precisely the half-true registration this ledger exists to
    // stop. The subject appended a row unconditionally, so this was a real gap and not a missing
    // test: closing it took an implementation change, not a case.
    //
    // THE TEXT IS A BICONDITIONAL — "the revision changes EXACTLY WHEN the state changes" — so a
    // case asserting one direction would not discharge it. Both are asserted, each no-change arm
    // paired with a changing write that MUST mint.
    Registration {
        text: "The revision changes exactly when the resource's state changes; a write that would leave the state unchanged mints no new revision (and produces no event).",
        disposition: Disposition::Behavioural,
        evidence: "a_no_change_write_is_a_no_op — put and patch, each no-change arm paired with a changing write that MUST mint, so a subject that never wrote would fail it. The parenthetical \"and produces no event\" is NOT asserted: the resource changefeed is served by `changes`, a retired primitive the protocol client exposes no method for, so the event stream is unobservable over the published surface. One code path serves the revision append and the event, so no row means no event — an argument from the source, not a measurement, and it is not counted as one",
    },
    // The full-state statement of the same rule, which adds two clauses of its own.
    Registration {
        text: "A full-state write that changes nothing succeeds, keeps the revision, records no provenance, and produces no event; the reply carries no `transaction`.",
        disposition: Disposition::Behavioural,
        evidence: "a_no_change_write_is_a_no_op — PARTIAL, and the case names what it leaves. Succeeds, keeps the revision and records no provenance are asserted (no new revision means no provenance row, since they are the same append). Produces no event is unobservable, as above. The reply carries no `transaction` would pass VACUOUSLY: this subject never carries one on a write reply under any circumstances, so the assertion could not fail and is deliberately absent — a probe that cannot fail is not evidence",
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
        text: "A patch whose path names an envelope member (`/id`, `/provenance`, `/createdAt`, `/retired`), the whole-document root (`\"\"`), or a property declared `computed` or `serviceManaged` faults — for ANY JSON Patch operation, and for the `from` pointer of `move`/`copy` — whatever the implementation's patch document contains.",
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
        text: "Import is RESUMABLE over ABSOLUTE record ordinals. A record's ordinal is `fromOrdinal + its index` in the delivered `records` array (`fromOrdinal` omitted ⇒ `1`), so the stream position survives chunking across requests even though each array restarts at index 0; `importId` names the session the scope keys `acceptedThrough` on, and a one-shot import omits both. `import` is non-blocking: the scope processes a prefix up to its current admission `credit` (advertised as `window`), marks the remainder `Deferred`, and returns `acceptedThrough` (the high-water ordinal PROCESSED) with `credit` and an optional `retryAfter`. The importer holds the deferred tail and re-offers from `acceptedThrough + 1` (`fromOrdinal = acceptedThrough + 1`); a record whose absolute ordinal is `≤ acceptedThrough` is a benign no-op reported `Deduped`, never a fault. This resume-idempotency is the model's own, not the caller's strategy.",
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
    // THE FIRST OBLIGATION THIS LEDGER CANNOT HONESTLY TYPE, and the clause states have MOVED since
    // it was written, which is the argument for recording them on the row. The malformed-value
    // clause is COVERED; "MUST HONOR after/limit" was PARTIAL and is now COVERED -- typing it
    // partial is what sent me looking, and `after` turned out to be dropped at FOUR layers of this
    // binding (the store ignored it, the server never parsed it, the client never sent it, and
    // there was no envelope to return the position), each failure looking like a correct first
    // page. `format` is still NOT COVERED AT ALL
    // — read nowhere in this binding, and riding as a HEADER on all four reads, which is why it was
    // easy to miss while every other control sits on the request line.
    //
    // `Waived` is the least wrong of three bad fits, not a verdict. `Behavioural` would claim a case
    // exercises it, true of one clause in three; `SurfaceBearing` would claim tier-1 rows ground it,
    // true of clause 1 alone. A PARTIALLY DISCHARGED obligation is a real state and this ledger has
    // no word for it. Recorded rather than rounded to whichever bucket flattered the count.
    Registration {
        text: "A service offering a read MUST HONOR the floor controls it accepts — not merely declare them: `after` (resume from the cursor), `limit` (window the result), and `format` (encode in the selected transport) — and MUST fault `400` on a malformed value. Silently ignoring a resume cursor or a transport selector — returning the whole set from the start, or the default encoding, as if the param were absent — is NON-CONFORMANT (the silent-failure class, like a dropped `where`). A declared floor param is a promise to act on it.",
        disposition: Disposition::Waived,
        evidence: "PARTIAL, and tracked in two places: gastownhall/bdp#430 item 14 for the obligation, gastownhall/bdp#451 for the `format` encoding question that blocks the rest. TWO of three clauses are now covered -- the malformed-value clause by an_invalid_limit_is_an_invalid_parameter_400 (grounding op/list/fault/400 and op/revisions/fault/400), and MUST-HONOR-after/limit by every_read_returns_a_page_and_a_walk_terminates, which walks list to exhaustion and asserts the pages reconstruct the set exactly. `format` remains uncovered: list and revisions refuse `jsonl` 501 because the spec does not frame a `Page` as newline-delimited records (#451, Lydia has it as RC3 item 1)",
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

// ---- the INPUT lowering: can the generated contract say how to INVOKE each op? ----------------

/// One primitive's input lowering — what its `core.lumen` signature DECLARES, against what the
/// generated OpenAPI can actually CARRY.
///
/// THE DENOMINATOR ABOVE CANNOT SEE THIS, which is the whole reason this exists. [`denominator`]
/// counts ops and their declared `>=400` statuses, and both are present and correct for all 13
/// primitives. So the contract can be complete in every row this gate counts and still not say how
/// to INVOKE the operation — no request body, no parameter, nowhere for a declared input to ride.
///
/// The tier-1 cases do not catch it either, and that is worth stating plainly: they drive a
/// reference that carries inputs the contract never declared, so they pass over a wire the contract
/// cannot describe. A green gate over an unusable contract is the exact failure the two-sided
/// generator witness ([`source_surface`]) was added for, one level further in — there the two sides
/// were the generated catalog and the source it comes from; here they are an operation's signature
/// and the `/// openapi =` annotation hand-written three lines above it, with nothing comparing
/// them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputLowering {
    pub op: String,
    /// The signature parameter the path carries, named by the annotation's `pathItem`.
    pub path_param: Option<String>,
    /// Signature parameters that must therefore ride a param or the request body.
    pub declared: Vec<String>,
    /// The `params = { … }` KEYS from the annotation. The key is the Lumen parameter name; a
    /// nested `name = "If-Match"` is its wire spelling, so the keys are what a signature compares
    /// against.
    pub carried: Vec<String>,
    /// Whether the annotation declares `request = { contentType = … }`.
    pub has_request_body: bool,
    /// Declared parameters with nowhere on the wire to ride: not the path, not a param, and no
    /// request body to fall back on.
    pub uncarried: Vec<String>,
}

/// Signature parameters the annotation lowers under a DIFFERENT name.
///
/// Each needs a reason, because an unexplained alias and a dropped parameter look identical from
/// here — and reading one as the other is how this check would acquire a false positive and then be
/// widened to silence it.
pub const LOWERED_UNDER_ANOTHER_NAME: &[(&str, &str, &str)] = &[(
    "get",
    "selector",
    "lowered as the `select` query param. `get`'s annotation also carries `revision`, `include`, \
     `omit` and `expand`, none of which has a signature counterpart at all — so this annotation is \
     MORE complete than its signature, not less, and the mismatch is a spelling rather than a gap.",
)];

/// Declared inputs that the generated contract CANNOT carry, registered with what each costs.
///
/// THIS IS A REGISTER, NOT A SUPPRESSION LIST, and the test below asserts it in BOTH directions: an
/// unregistered uncarried input fails, and a registered one that becomes carriable fails too. So
/// closing any of these turns the gate red until its entry is removed in the same change, and no
/// entry can quietly outlive the gap it describes.
///
/// WHY THESE ARE REGISTERED RATHER THAN FIXED. A plausible ruling makes the current annotations
/// correct: that the OpenAPI lowering is a ROUTE and FAULT surface, with inputs specified by the
/// Lumen signature and the prose, and never intended as a complete client contract. On that reading
/// nothing here is a defect and the fix would be to say so in the spec. The opposite ruling — that
/// the lowering is the machine-readable contract — makes every row below a blocker, because an
/// implementer handed `core.openapi.json` cannot create, write or call at all. The evidence leans
/// the second way (`list` carries all eight of its params, `put` carries its three guards, and
/// `patch`/`import`/`push` all declare a `request` body, so the vocabulary is used completely where
/// an author filled it in) but leaning is not a ruling, and authoring the fix would decide it.
pub const UNCARRIED_INPUTS: &[(&str, &str, &str)] = &[
    (
        "call",
        "request",
        "the invocation payload. `call` is POST with one `mode` query param and no request body, so \
         there is no channel for the argument of the call.",
    ),
    (
        "create",
        "requestedId",
        "`create` declares NO params and NO request body — its annotation carries only `success`, \
         `responseHeaders` and `problem`. All five non-path inputs are uncarriable, so the \
         generated contract describes no way to create a resource.",
    ),
    ("create", "type", "see `create`/`requestedId`."),
    ("create", "authority", "see `create`/`requestedId`."),
    ("create", "body", "see `create`/`requestedId`."),
    ("create", "metadata", "see `create`/`requestedId`."),
    (
        "put",
        "type",
        "`put` carries its three GUARDS (`If-Match`, `If-None-Match`, `precondition`) and declares \
         no request body, so the representation it writes has nowhere to ride. The guards being \
         present is what makes this an omission rather than a policy: the annotation is used, just \
         not finished.",
    ),
    ("put", "authority", "see `put`/`type`."),
    ("put", "body", "see `put`/`type`."),
    ("put", "metadata", "see `put`/`type`."),
    (
        "export",
        "where",
        "`export`'s own filter. Its normative line REQUIRES this parameter to exist — it rejects \
         `request.filter` with `400` precisely because \"filtering and projection are the op's own \
         `where`/`select`\" — so the annotation contradicts the obligation three lines above it.",
    ),
    (
        "export",
        "select",
        "`export`'s own projection, required to exist by the same normative line as \
         `export`/`where`. (This also cited the open question on `ExportCaps` having no selector field. #461 ANSWERS \
         it by adding `ExportCaps.selector`, so that clause is now false while the claim above \
         it stands — the PR adds the capability field, not the parameter. CLOSES WHEN: `select` \
         appears in `export`'s generated `parameters`.)",
    ),
    (
        "export",
        "revisions",
        "the `--revisions` flag the description leans on (\"`--revisions` emits every revision in \
         order (a true backup)\"). Uncarried, so the generated contract offers no way to ask for \
         the backup form of an export.",
    ),
    (
        "revisions",
        "select",
        "declared `select?: selector` with the description \"Projection per revision — ids-only vs \
         full representations\", and absent from the annotation's params. `list` — the sibling this \
         op's own description compares it to (\"list-shaped like `list`\") — carries its `select`, \
         which is what makes this a drop rather than a design.",
    ),
];

/// Derive the input lowering for every primitive carrying an `/// openapi =` annotation.
///
/// Parses two things the file keeps three lines apart and never cross-checks:
///   * the annotation — `pathItem`, the `params` keys, and whether a `request` body is declared;
///   * the signature — `fn`, `command` or `idempotent command`, one parameter per line at four
///     spaces, up to the `) ->` return.
///
/// A `request?: ReadRequest` parameter is EXCLUDED as the documented expansion into
/// `after`/`from`/`limit`/`format`. The type is what decides that, never the name: `call` also has
/// a parameter called `request` and its type is `Request`, the invocation payload, which has to be
/// carried like any other input. Matching on the name alone hid `call` when this was first written.
pub fn input_lowering() -> Vec<InputLowering> {
    let mut out: Vec<InputLowering> = Vec::new();

    for line in CORE_LUMEN.lines() {
        let l = line.trim_start();
        if !l.starts_with("///") || !l.contains("openapi") {
            continue;
        }
        let Some(idx) = l.find("operationId") else { continue };
        let Some(rest) = l[idx..].split_once('"').map(|(_, r)| r) else { continue };
        let Some((op, _)) = rest.split_once('"') else { continue };

        let path_param = l.find("pathItem").and_then(|i| {
            l[i..].split_once('"').and_then(|(_, r)| r.split_once('"').map(|(v, _)| v.to_string()))
        });

        let carried: Vec<String> = match l.find("params = {") {
            Some(i) => balanced(l, i, b'{', b'}').map(keys_of).unwrap_or_default(),
            None => Vec::new(),
        };

        let has_request_body = l.contains("request = {");
        let sig = signature_params(op);
        assert!(
            !sig.is_empty(),
            "no signature parameters parsed for `{op}`. Every primitive declares at least its own \
             target, so an empty list means the parse missed the declaration form — and a parse \
             that reports nothing reports every op as clean. Teach `signature_params` the form \
             rather than letting this return an empty verdict.",
        );

        let declared: Vec<String> = sig
            .iter()
            .filter(|(n, t)| {
                Some(n.as_str()) != path_param.as_deref() && !(n == "request" && t.contains("ReadRequest"))
            })
            .map(|(n, _)| n.clone())
            .collect();

        let uncarried: Vec<String> = if has_request_body {
            Vec::new()
        } else {
            declared
                .iter()
                .filter(|n| {
                    !carried.contains(n)
                        && !LOWERED_UNDER_ANOTHER_NAME
                            .iter()
                            .any(|(o, p, _)| *o == op && *p == n.as_str())
                })
                .cloned()
                .collect()
        };

        out.push(InputLowering {
            op: op.to_string(),
            path_param,
            declared,
            carried,
            has_request_body,
            uncarried,
        });
    }
    out
}

/// The `word = {` keys of a `params = { … }` span, in order.
fn keys_of(span: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = span.as_bytes();
    let mut i = 0usize;
    while let Some(eq) = span[i..].find(" = {").map(|p| i + p) {
        let key_end = eq;
        let mut key_start = key_end;
        while key_start > 0 && (bytes[key_start - 1].is_ascii_alphanumeric() || bytes[key_start - 1] == b'_') {
            key_start -= 1;
        }
        if key_start < key_end {
            out.push(span[key_start..key_end].to_string());
        }
        // Skip the whole nested record, so an inner `name = { … }` is never read as a param key.
        match balanced(span, eq, b'{', b'}') {
            Some(inner) => {
                let after = inner.as_ptr() as usize - span.as_ptr() as usize + inner.len();
                i = (after + 1).min(span.len());
            }
            None => i = (eq + 4).min(span.len()),
        }
    }
    out
}

/// One primitive's signature parameters as `(name, type)`, in declaration order.
///
/// Accepts all three declaration forms `core.lumen` uses — `fn op(`, `command op(` and
/// `idempotent command op(`, with optional generics (`fn get<T>(`). Reads only parameters at
/// exactly four spaces, so a nested record field inside a parameter's type is never mistaken for a
/// parameter.
fn signature_params(op: &str) -> Vec<(String, String)> {
    let mut lines = CORE_LUMEN.lines();
    while let Some(l) = lines.next() {
        let head = l
            .strip_prefix("idempotent ")
            .unwrap_or(l)
            .strip_prefix("fn ")
            .or_else(|| l.strip_prefix("idempotent ").unwrap_or(l).strip_prefix("command "));
        let Some(head) = head else { continue };
        let name: String = head.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        if name != op {
            continue;
        }
        let after = &head[name.len()..];
        // `(` directly, or after a generic parameter list.
        let opens = after.starts_with('(')
            || (after.starts_with('<') && after.split_once('>').is_some_and(|(_, r)| r.starts_with('(')));
        if !opens {
            continue;
        }
        let mut out = Vec::new();
        for body in lines.by_ref() {
            let t = body.trim_start();
            if t.starts_with(") ->") || t.starts_with(")->") {
                break;
            }
            if t.starts_with("///") || t.starts_with("//") {
                continue;
            }
            let Some(decl) = body.strip_prefix("    ") else { continue };
            if decl.starts_with(' ') {
                continue;
            }
            let Some((lhs, rhs)) = decl.split_once(':') else { continue };
            let pname = lhs.trim().trim_end_matches('?');
            if pname.is_empty() || !pname.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                continue;
            }
            out.push((pname.to_string(), rhs.trim().trim_end_matches(',').to_string()));
        }
        return out;
    }
    Vec::new()
}

// =============================================================================
// WIRE-LOWERING COMPLETENESS — does every declared thing have a wire home?
//
// The tier-1 gate above counts FAULTS: ops and their declared `>=400` statuses. It cannot see a
// declared thing that the wire has no way to carry, because such a thing produces no row to be
// uncovered. Four findings in two days were all that shape — declared inputs the generated
// contract cannot carry (#450), a mandated encoding with no framing (#451), a status produced but
// never declared (#452), a status declared but not producible (#453), and a closed representation
// envelope the wire does not emit (#454). Each was found by hand. This section is the machine.
//
// WHAT THIS SECTION DOES *NOT* DO, recorded because I built it and threw it away:
//
// I also wrote the symmetric check — every declared fault status must have a producer naming its
// operation in D.8 — because that is precisely the hand-derivation that found `delete/409` and
// `patch/409`. It flags **22 of 37 rows**, and a filter that rejects a majority of a conformant
// surface is not a filter. The reason is prose shape, not defects: D.8's `409` entry ENUMERATES
// its producers ("call → …; any id collision — `create` … OR `put` …"), so an op absent from it is
// genuinely unaccounted for; D.8's `400` entry describes an OPEN CLASS ("Three shapes reach it. A
// BAD BODY … AN INVALID PARAMETER VALUE …"), under which every write op falls legitimately without
// being named. Telling those two shapes apart is prose semantics, and a gate that cried wolf 22
// times would be ignored into uselessness — worse than no gate. The hand-derivation stands on
// reasoning this check cannot reach, so it stays hand work and is NOT registered as automated.
// =============================================================================

/// Every Problem `code` the spec declares, parsed from the D.9 catalogue.
///
/// `code` is normative WIRE OUTPUT: core.lumen:853 makes it a BDP extension member carrying a
/// stable problem-type URI (`tag:bdp.dev,2026:problem/<code>`), one per code. So a code is a thing
/// the wire emits, and a client branches on it.
pub fn problem_codes() -> Vec<String> {
    let (block, _) = d9_catalogue();
    let mut out: Vec<String> = Vec::new();
    // ONLY THE ·-SEPARATED LINES, which is what makes a hyphenless code reachable.
    //
    // This parser required a hyphen, on the reasoning that codes are kebab-case and the header
    // sentence's `problem-type` was the one false positive to exclude. **Two codes have no
    // hyphen** — `unauthenticated` and `forbidden` — so both were silently dropped, and the
    // registry read 20 where it is 22. Every count built on it was computed over the wrong
    // denominator, and both are themselves orphans, so the orphan figure was wrong in BOTH terms.
    // A peer hit the identical bug in her own extractor and told me to check mine.
    //
    // The fix is to discriminate by POSITION rather than by spelling: the catalogue's codes are
    // the ·-separated items, and its header prose contains no `·`. That admits a hyphenless code
    // and still excludes the prose, where a hyphen rule had to choose one or the other.
    for line in block.lines().filter(|l| l.contains('·')) {
        for tok in line.split('·') {
            let t = tok.trim().trim_start_matches('/').trim().trim_matches('`');
            if !t.is_empty()
                && t.chars().all(|c| c.is_ascii_lowercase() || c == '-')
                && !t.starts_with('-')
                && !t.ends_with('-')
                && !out.iter().any(|s| s == t)
            {
                out.push(t.to_string());
            }
        }
    }
    out
}

/// The D.9 catalogue block, and the rest of `core.lumen` with that block removed.
///
/// The split is the whole method: a code MENTIONED ONLY IN ITS OWN CATALOGUE is bound to nothing.
fn d9_catalogue() -> (String, String) {
    let start = CORE_LUMEN
        .find("D.9 Problem codes")
        .expect("core.lumen has a D.9 Problem codes appendix");
    let end = CORE_LUMEN[start..]
        .find("Appendix E")
        .map(|i| start + i)
        .expect("D.9 is followed by Appendix E");
    let block = CORE_LUMEN[start..end].to_string();
    let rest = format!("{}{}", &CORE_LUMEN[..start], &CORE_LUMEN[end..]);
    (block, rest)
}

/// A declared Problem code that appears NOWHERE outside the D.9 catalogue — so nothing in the spec
/// binds it to a status, an operation, or a producing condition.
pub fn orphan_codes() -> Vec<String> {
    let (_, rest) = d9_catalogue();
    problem_codes().into_iter().filter(|c| !rest.contains(c.as_str())).collect()
}

/// The declared codes with no wire home, registered so the gate is green on the KNOWN set and red
/// on a new one. Each entry is the code and what is actually missing — they are not one defect.
///
/// EVERY JUSTIFICATION HERE MUST NAME WHAT CLOSES IT. Most do so implicitly, by restating the fact
/// the guard already checks ("D.8 has no 401 row"): when the spec gains that row the code stops
/// being an orphan and `the_code_register_names_only_live_orphans` fails. Prose and guard agree by
/// construction there, which is why those entries cannot rot.
///
/// A justification that instead cites an OPEN QUESTION expires the moment the question closes, and
/// NOTHING WATCHES PROSE. `validation-failed` carried "the open question behind #453's patch/409"
/// after Donna had already ruled it 409: claim still true, reasoning false, and no guard able to
/// tell the difference. So an entry resting on a question states the condition that closes it,
/// which dates the entry and lets a reader check instead of trusting the sentence.
///
/// THE TWO TIERS MATTER, and collapsing them would overstate the finding. For some, D.8 describes
/// the CONDITION under a status without ever writing the code beside it, so the repair is one line
/// of text: `404` says "get of an absent resource" and `410` says "get of a pruned / erased
/// resource". For the rest there is no status entry to attach to at all — D.8 has no `429` and no
/// `5xx` entry beyond the `4xx/5xx` catch-all, so `rate-limited` and `temporarily-unavailable`
/// have nowhere to land, and `validation-failed` has neither a status nor a condition anywhere.
// THREE ENTRIES CLOSED BY #456 (`b001cbff`), not re-judged: `resource-not-found`,
// `resource-pruned` and `resource-erased` are now named beside their D.8 status rows, so each has a
// wire home. The staleness guard is what told me — it failed naming them the moment main was
// merged in, which is the only reason this list is not now a false claim about the spec it reads.
// Thirteen of twenty-two became ten of twenty-two.
pub const CODES_WITHOUT_A_WIRE_HOME: &[(&str, &str)] = &[
    ("unauthenticated", "HYPHENLESS, so the old parser never saw it: no status entry names it; D.8 has no 401 row"),
    ("forbidden", "HYPHENLESS, so the old parser never saw it: no status entry names it; D.8 has no 403 row"),
    (
        "validation-failed",
        "no status row and no producing condition in the TEXT. This used to cite \"the open \
         question behind #453's patch/409\" — Donna has since RULED it 409, so the question is \
         CLOSED and only the lowering is outstanding. CLOSES WHEN: `validation-failed` appears on \
         D.8's 409 row.",
    ),
    ("rate-limited", "implies 429; D.8 has no 429 entry at all"),
    ("temporarily-unavailable", "implies 503; D.8 has no 5xx entry beyond the 4xx/5xx catch-all"),
    ("type-not-installed", "no status entry names it; Types-profile condition with no Core landing"),
    ("callable-not-found", "no status entry names it; a `call` dispatch condition"),
    ("callable-unavailable", "no status entry names it; a `call` dispatch condition"),
    ("mode-not-supported", "no status entry names it; `?mode=async` refusal"),
    ("mode-refused", "no status entry names it; `?mode=async` refusal"),
];

/// The field names of the spec's `CoreCapabilities` record — the closed set of primitives that may
/// be advertised in the `core` capability member.
///
/// core.lumen:1611 is normative and makes presence the SOLE criterion of support: "a primitive is
/// supported iff its capability is present". So this set is not a style guide — a key outside it,
/// advertised in `core`, tells a client something the spec's capability model does not define, and
/// a primitive whose key cannot appear there cannot be discovered at all.
///
/// `call` and `cancel` are deliberately absent: core.lumen:1570 puts them under their own package
/// ("Call / cancel (operations) and the stdlib packs (apply = batch, eval = query) advertise under
/// their own packages, not core"), so `Capabilities.packs` is their home, not `core`. Eleven fields
/// for thirteen primitives is the design, not a gap — a conclusion I reached only after nearly
/// filing it as a defect, which is why it is written here rather than left to be re-derived.
pub fn core_capability_fields() -> Vec<String> {
    let start = CORE_LUMEN
        .find("## CoreCapabilities")
        .expect("core.lumen declares a CoreCapabilities record");
    let span = balanced(CORE_LUMEN, start, b'{', b'}')
        .expect("the CoreCapabilities record body is brace-balanced");
    record_field_names(span)
}

/// Field names of a Lumen record body — `name:` or `name?:` at the head of a line.
///
/// NOT [`keys_of`], which parses the `name = { … }` annotation form used by the `/// openapi =`
/// lowering lines. Reusing it here yielded ZERO fields, and an empty allowed-set would have made
/// the wire-side check flag every advertised key — caught by the anti-vacuity test on the first
/// run, which is the whole reason that test is written before the check that depends on it.
fn record_field_names(span: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in span.lines() {
        let t = line.trim();
        // Skip doc comments, comments and nested braces.
        if t.starts_with("///") || t.starts_with("//") || t.is_empty() {
            continue;
        }
        let Some(colon) = t.find(':') else { continue };
        let name = t[..colon].trim().trim_end_matches('?');
        if !name.is_empty()
            && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            && !out.iter().any(|s| s == name)
        {
            out.push(name.to_string());
        }
    }
    out
}

/// Problem codes NAMED BY A FAULT VERB in `core.lumen` — "faults `x`", "refused `x`".
///
/// The mirror of [`orphan_codes`], which asks whether a REGISTERED code has a status home. This
/// asks the other direction: whether a code the spec actually USES is in the registry at all. A
/// code named in a normative line and absent from D.9 has no stable problem-type URI
/// (`tag:bdp.dev,2026:problem/<code>` is defined per registry entry — core.lumen:853), so a client
/// told to branch on it has nothing to branch against.
///
/// THE VERB IS THE DISCRIMINATOR, and it has to be. A naive "backticked kebab-case token" filter
/// returns nine candidates here, of which SIX are not problem codes at all — an event kind
/// (`call-leave`), an authentication basis (`channel-authenticated`), a query relation (`is-a`) and
/// three link relations (`service-desc`/`service-doc`/`service-meta`). Filtering on the fault verb
/// cuts it to the three that are, which is the difference between a check and a noise generator.
pub fn codes_named_by_a_fault_verb() -> Vec<String> {
    const VERBS: [&str; 4] = ["faults `", "refused `", "refuses `", "fault `"];
    let (d9, rest) = d9_catalogue();
    let _ = d9;
    let mut out: Vec<String> = Vec::new();
    for verb in VERBS {
        let mut from = 0usize;
        while let Some(i) = rest[from..].find(verb).map(|p| from + p) {
            let after = i + verb.len() - 1; // keep the opening backtick in the window
            // SCAN THE CLAUSE, NOT JUST THE NEXT TOKEN. This took only the token immediately
            // after the verb, which handles "faults `channel-not-pullable`" and is BLIND to the
            // other normative style: core.lumen:673 writes "faults `404` (`resource-not-found`)",
            // where the verb is followed by the STATUS and the code sits in a parenthetical. The
            // first token there is `404`, which fails the kebab filter, so the whole site
            // contributed nothing — and three codes named on that line were invisible.
            //
            // Found by simulating an incomplete repair (removing a code from D.9 while leaving its
            // normative usages) and watching this check stay GREEN. A peer had told me it would
            // catch exactly that; it did not, and only running it showed so.
            let end = rest[after..]
                .find(". ")
                .map(|e| after + e)
                .unwrap_or_else(|| (after + 200).min(rest.len()));
            let clause = &rest[after..end];
            for tok in clause.split('`').skip(1).step_by(2) {
                if tok.contains('-')
                    && tok.chars().all(|c| c.is_ascii_lowercase() || c == '-')
                    && !tok.starts_with('-')
                    && !tok.ends_with('-')
                    && !out.iter().any(|s| s == tok)
                {
                    out.push(tok.to_string());
                }
            }
            from = end.max(i + verb.len());
        }
    }
    out.sort();
    out
}

/// Codes the spec USES but never registers in D.9. Registered so the gate is green on the known set
/// and red on a new one, with the staleness guard in the other direction too.
///
/// All three are channel/alias faults, which is not a coincidence: both are surfaces whose codes
/// were written at the point of use and never carried back to the registry. A peer found
/// `channel-not-pullable` by reading one normative line; measuring the whole file found its mirror
/// and a third on an unrelated primitive.
pub const CODES_USED_BUT_UNREGISTERED: &[(&str, &str)] = &[
    ("channel-not-pullable", "core.lumen pull: a `sink`-only channel faults it; absent from D.9"),
    ("channel-not-pushable", "core.lumen push: a `source`-only channel faults it; absent from D.9"),
    ("invalid-target", "core.lumen alias binding: an alias whose target is a live alias is refused it; absent from D.9"),
];

/// The subject's server source, for the SECOND problem producer.
pub const SERVER_RS: &str = include_str!("../../subject/bdp-protocol/src/server.rs");

/// Problem codes the server emits through `problem_body(status, code, detail)` — a producer that
/// does **not** go through `WireProblem::from_error`, and so is invisible to the exhaustive-by-
/// execution check over `BdpError`'s variants.
///
/// I COMMITTED THAT CHECK CLAIMING THE COMPLETE VOCABULARY. It is complete over `BdpError`, a
/// closed enum of thirteen variants, and that is not the same as complete over the subject: eleven
/// `problem_body` call sites construct Problems directly, and two of their codes are unregistered.
/// Exhaustiveness is a property of a POPULATION, and I named the enum while asserting it of the
/// server.
///
/// METHOD, AND ITS LIMIT, because the two differ here. `from_error` is enumerated BY EXECUTION —
/// construct every variant, call it, read the code. `problem_body` cannot be: it is private, and
/// its `code` parameter means the vocabulary lives in the CALL SITES, not the function. So this is
/// a scan for the literal `problem_body(<status>, "<code>"` form. **A code built dynamically at a
/// call site would be missed**, which is a real gap and the reason the anti-vacuity test pins the
/// site count rather than only the contents.
///
/// AND IT IMMEDIATELY BEAT THE GREP I HAD USED TO SCOPE IT. My ad-hoc
/// `grep -oE 'problem_body\([0-9]{3}, "[a-z-]+"'` reported three codes; this scan reports four.
/// The one it missed — `unsupported-media-type` — has its call site split across lines, so the
/// status and the code are not on one line and a single-line pattern cannot see it. A pattern that
/// encodes an assumption about how the code is FORMATTED is the same guess as one encoding how it
/// is written, and this is the argument for the check living in the suite rather than in my shell
/// history.
pub fn codes_emitted_by_direct_problem_bodies() -> Vec<(u16, String)> {
    let mut out: Vec<(u16, String)> = Vec::new();
    let mut rest = SERVER_RS;
    while let Some(i) = rest.find("problem_body(") {
        rest = &rest[i + "problem_body(".len()..];
        let Some(comma) = rest.find(',') else { break };
        let Ok(status) = rest[..comma].trim().parse::<u16>() else { continue };
        let after = rest[comma + 1..].trim_start();
        let Some(stripped) = after.strip_prefix('"') else { continue };
        let Some(end) = stripped.find('"') else { continue };
        let code = &stripped[..end];
        if !code.is_empty() && code.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            out.push((status, code.to_string()));
        }
    }
    out
}

/// The direct-producer codes D.9 does not register. Registered so the gate is green on the known
/// set and red on a new one.
///
/// Both are near-misses of registered codes with a D.8 status row, which is what makes them the
/// same class as `not-found`/`already-exists` rather than new vocabulary:
/// `bad-request` sits where D.8's 400 row names `malformed-request` and `invalid-parameter`, and
/// `not-implemented` answers an un-offered capability, which core.lumen:1611 settles as
/// `capability-not-supported` — a REGISTERED code whose D.8 row is **405**, so that one is wrong on
/// the status as well. `501` appears nowhere in `core.lumen`.
pub const DIRECT_CODES_NOT_REGISTERED: &[(&str, &str)] = &[
    ("bad-request", "9 sites at 400; D.8's 400 row names `malformed-request` / `invalid-parameter`, both registered"),
    ("not-implemented", "1 site at 501, a status absent from core.lumen; an un-offered capability is `capability-not-supported` (405) per core.lumen:1611"),
    ("unsupported-media-type", "1 site at 415. The SHARPEST of the three: D.8 HAS a 415 row (a patch body whose media type is not application/json-patch+json), the row op/patch/fault/415 IS covered, and D.9 registers NO code for 415 at all — so the status is declared, the row is green, and the code is invented. My own 415 row asserts the status only, which is why it never surfaced. A fifth 'D.8 row with no registered code', after 401/403/429/5xx."),
];

/// The subject's wire module, for the capability-key mapping.
pub const WIRE_RS: &str = include_str!("../../subject/bdp-protocol/src/wire.rs");

/// The capability keys this subject's wire CAN emit — the `serde(rename = "…")` of each
/// `WireCapability` variant.
///
/// THE CAUSE-LEVEL CHECK, ported from the cleanroom after its own inverse sweep found that it would
/// have caught this subject's `push` defect. The capability case in `tests/gate.rs` catches the
/// SYMPTOM — an operation this gate covers that the scope does not advertise. This catches the
/// CAUSE: a closed-vocabulary field the wire has no variant for, so no scope could ever advertise
/// it however correctly it behaved. `caps_to_wire` is `filter_map(from_trait)`, so a trait
/// capability with no wire variant is silently discarded.
///
/// The two are worth keeping separate and in this order: fix the wire variant and the cause check
/// goes green while the symptom check still fires until the scope actually advertises. That
/// sequencing is the point — one guard per step, rather than one guard that passes when either is
/// done.
///
/// METHOD: a scan for the literal `rename = "…"` inside the `WireCapability` enum. Serde renames
/// are literals here so the scan is exhaustive over them; a variant named any other way would be
/// missed, which is why the test pins the count.
pub fn capability_keys_the_wire_can_emit() -> Vec<String> {
    let Some(start) = WIRE_RS.find("enum WireCapability") else { return Vec::new() };
    let Some(span) = balanced(WIRE_RS, start, b'{', b'}') else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    let mut rest = span;
    while let Some(i) = rest.find("rename = \"") {
        rest = &rest[i + "rename = \"".len()..];
        let Some(end) = rest.find('"') else { break };
        let k = &rest[..end];
        if !k.is_empty() && k.chars().all(|c| c.is_ascii_lowercase()) && !out.iter().any(|s| s == k) {
            out.push(k.to_string());
        }
        rest = &rest[end..];
    }
    out
}

/// Closed-vocabulary fields the wire has no variant for, so no scope can advertise them.
///
/// Both are IMPLEMENTED here and carry covered rows — `op/push` with three faults, `op/revisions`
/// with two — so seven covered rows belong to primitives a conformant client must read as
/// unsupported (core.lumen:1611: a primitive is supported iff its capability is present).
pub const CAPABILITY_FIELDS_THE_WIRE_CANNOT_EMIT: &[(&str, &str)] = &[
    ("push", "no `WireCapability::Push`; inmem advertises `C::Push` on the trait and `filter_map` discards it — the ASYMMETRIC case: advertised, implemented, dropped"),
    ("revisions", "no `WireCapability::Revisions` and no trait variant either; the cleanroom derives this advertisement from `revision_model == Versioned` so the pairing cannot rot"),
];

#[cfg(test)]
mod tests {
    use super::*;

    /// Every declared input must have somewhere on the wire to ride, or be REGISTERED as not
    /// having one. Asserted in both directions, so neither the gap nor the register can rot.
    #[test]
    fn every_declared_input_is_carriable_or_registered() {
        let lowering = input_lowering();
        assert_eq!(
            lowering.len(),
            CORE_PRIMITIVES.len(),
            "input lowering must cover all 13 primitives; got {}",
            lowering.len()
        );

        let observed: BTreeSet<(String, String)> = lowering
            .iter()
            .flat_map(|l| l.uncarried.iter().map(|p| (l.op.clone(), p.clone())))
            .collect();
        let declared: BTreeSet<(String, String)> =
            UNCARRIED_INPUTS.iter().map(|(o, p, _)| (o.to_string(), p.to_string())).collect();

        let unregistered: Vec<&(String, String)> = observed.difference(&declared).collect();
        assert!(
            unregistered.is_empty(),
            "{} declared input(s) have NOWHERE on the wire to ride and are not registered: {:?}.\n\
             The generated contract cannot say how to supply them, so an implementer working from \
             `core.openapi.json` alone cannot invoke the operation. Either lower the parameter in \
             the `/// openapi =` annotation, or add it to UNCARRIED_INPUTS with what it costs.",
            unregistered.len(),
            unregistered
        );

        // The other direction: an entry that is no longer needed is a claim that has expired.
        let stale: Vec<&(String, String)> = declared.difference(&observed).collect();
        assert!(
            stale.is_empty(),
            "UNCARRIED_INPUTS registers {} input(s) that ARE now carriable: {:?}. The gap closed \
             and the entry outlived it — remove it in the change that closed it.",
            stale.len(),
            stale
        );
    }

    /// The alias register must stay honest the same way: an alias that stops being needed is an
    /// unexplained exemption, and an alias for a parameter that is NOT in the signature is a stale
    /// name nobody is lowering.
    #[test]
    fn the_alias_register_names_only_live_aliases() {
        let lowering = input_lowering();
        for (op, param, _) in LOWERED_UNDER_ANOTHER_NAME {
            let l = lowering
                .iter()
                .find(|l| l.op == *op)
                .unwrap_or_else(|| panic!("alias register names `{op}`, which is not a primitive"));
            assert!(
                l.declared.iter().any(|d| d == param),
                "alias register claims `{op}` declares `{param}`, but its signature does not. \
                 The parameter was renamed or removed and this entry now lowers nothing."
            );
            assert!(
                !l.carried.iter().any(|c| c == param),
                "`{op}`'s annotation now carries `{param}` under its OWN name, so the alias entry \
                 is obsolete — remove it."
            );
        }
    }

    /// THE PARSE MUST NOT BE VACUOUS. Both checks above are clean if `signature_params` returns
    /// nothing, so the parse is asserted directly: a form it cannot read reports every op as
    /// carrying every input.
    #[test]
    fn the_signature_parse_reaches_every_primitive() {
        for op in CORE_PRIMITIVES {
            let ps = signature_params(op);
            assert!(
                !ps.is_empty(),
                "`signature_params(\"{op}\")` found nothing. `core.lumen` declares primitives as \
                 `fn`, `command` and `idempotent command`, with optional generics — a form this \
                 parser cannot read makes the lowering checks pass by measuring nothing."
            );
        }
        // And it must find the three declaration forms, not just one: `get` is `fn get<T>(`,
        // `push` is `command push(`, `put` is `idempotent command put(`. If a future rewrite
        // collapses them this still holds; if the parser regresses to one form, it fails.
        assert!(signature_params("get").iter().any(|(n, _)| n == "resource"));
        assert!(signature_params("push").iter().any(|(n, _)| n == "events"));
        assert!(signature_params("put").iter().any(|(n, _)| n == "body"));
    }

    /// `call`'s `request` is the invocation payload, NOT a `ReadRequest` expansion, and the
    /// lowering must keep them apart. Written as its own test because excluding `request` by NAME
    /// is the obvious implementation and it silently hid `call` when this was first built.
    #[test]
    fn a_read_request_expansion_is_not_confused_with_a_payload() {
        let lowering = input_lowering();
        let call = lowering.iter().find(|l| l.op == "call").expect("call");
        assert!(
            call.declared.iter().any(|d| d == "request"),
            "`call`'s `request: Request` is the argument of the call and must be treated as an \
             input needing a channel, not dropped as a ReadRequest expansion"
        );
        for op in ["list", "pull", "export", "revisions"] {
            let l = lowering.iter().find(|l| l.op == op).expect(op);
            assert!(
                !l.declared.iter().any(|d| d == "request"),
                "`{op}`'s `request?: ReadRequest` lowers to after/from/limit/format and must not \
                 be counted as an uncarried input"
            );
        }
    }

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
    /// fault statuses. **13 ops + 38 faults = 51** — #456 declared `pull/404`, and I updated the
    /// assertion below and left this line saying 50.
    ///
    /// AND THIS TABLE MUST NOT BE DERIVED, which is the scope limit on "make the drift
    /// unrepresentable rather than detectable". Deriving it from the generated OpenAPI is exactly
    /// the circular assertion that rule is meant to prevent elsewhere — a filter checked against
    /// its own predicate. The relationships differ:
    ///
    ///   two things that must AGREE BY CONSTRUCTION (an advertisement and the fact it advertises)
    ///     -> derive one from the other; the wrong pairing becomes unwritable
    ///   an INDEPENDENT EXPECTATION watching an artifact (this table vs the generated catalog)
    ///     -> must stay hand-written, or it can no longer disagree, and disagreeing is its whole job
    ///
    /// So this stays a hand-maintained row-by-row list, and the cost is exactly what just happened:
    /// a hand-maintained expectation drifts from its own prose, and the prose is what drifted.
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
        // 404 ADDED by #456 (merged `b001cbff`): once "which channels exist is discovered
        // per-channel" is normative, pulling a channel that does not exist is a legitimate request,
        // and `pull`'s other three statuses are each spoken for — 405 is direction, 410 is the
        // retention floor, 400 is malformed. Raised pre-merge, declared in the same change.
        ("pull", &[400, 404, 405, 410]),
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
        assert_eq!(actual.len(), 51, "the v0.2.3 surface is 51 rows (13 ops + 38 faults)");
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
        // EXACT, NOT A FLOOR — the third floor in this file to need this, and the one that had
        // already cost something: the normative surface grew 89 -> 91 when #456/#457/#458 merged,
        // and `>= 60` passed in silence. Every obligation figure published off this parse — "89
        // obligations, 19 registered", the 70-strong backlog I sized by reading — was computed over
        // a population that had since moved. A floor is exactly the shape that survives the change
        // it exists to report.
        const OBLIGATIONS: usize = 91;
        assert!(
            found.len() == OBLIGATIONS,
            "parsed {} obligations, expected {OBLIGATIONS}. {} The ledger, the backlog sizing and \
             every count on this page are computed over this set:",
            found.len(),
            if found.len() < OBLIGATIONS {
                "FEWER — the anchor or the prefix is wrong, or obligations were removed; the ledger \
                 is now a tripwire over a short set."
            } else {
                "MORE — the spec gained normative lines. That is not a bug: re-read the new ones, \
                 classify them, and update OBLIGATIONS. The backlog sizing is short by the delta."
            }
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

    /// NO TWO REGISTRATIONS MAY CARRY THE SAME TEXT, and this exists because I added a duplicate.
    ///
    /// The obligation above was already on the ledger, waived against #430 item 14. I registered it
    /// a second time without checking, and NOTHING COMPLAINED: `obligation_ledger` resolves each
    /// obligation with `find`, which takes the first match, so my entry silently shadowed the
    /// original and the original became unreachable. The counts could not show it either — 20
    /// entries resolved to "registered: 19, pending: 0", and the only trace was that 20 ≠ 19 + 0.
    ///
    /// THE SHADOWING IS THE DANGER, not the redundancy. Two entries for one obligation means one
    /// disposition and one piece of evidence are live and the other is dead text that still reads
    /// as current — so a reader can find the stale one, trust it, and act on a tracking issue that
    /// the live entry has already superseded.
    #[test]
    fn no_obligation_is_registered_twice() {
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        for r in EXPECTED_OBLIGATIONS {
            assert!(
                seen.insert(r.text),
                "two registrations carry the same obligation text, so one SHADOWS the other and \
                 its disposition and evidence are dead text that still reads as current:\n  {}",
                r.text
            );
        }
        // And the partition must account for every entry: anything neither registered nor pending
        // has been swallowed, which is exactly how the duplicate hid.
        let l = obligation_ledger();
        assert_eq!(
            l.registered.len() + l.pending.len(),
            EXPECTED_OBLIGATIONS.len(),
            "{} registrations resolved to {} registered + {} pending; the difference is entries \
             the ledger silently dropped",
            EXPECTED_OBLIGATIONS.len(),
            l.registered.len(),
            l.pending.len()
        );
    }

    /// THE TIER-1/TIER-2 INTERLOCK: a surface-bearing obligation claims specific wire rows, and
    /// those rows must exist in the denominator. A registration naming a row that was undeclared, or
    /// misspelled, is a silent lie about where the obligation is discharged — so it fails here.
    ///
    /// This doc comment was stranded above the WRONG test by a bad insertion: the duplicate-
    /// registration test was spliced between it and this function, leaving a second `#[test]` on
    /// that test (so it registered twice and the harness reported 18 tests for 17) and attributing
    /// the interlock rationale to it. Only a `duplicated attribute` warning showed it.
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

    /// EVERY DECLARED PROBLEM CODE MUST HAVE A WIRE HOME. A `code` is normative wire output
    /// (core.lumen:853 — a BDP extension member with a stable problem-type URI per code), so a
    /// client branches on it. A code mentioned ONLY in its own catalogue is bound to no status, no
    /// operation and no condition: the spec declares a value the wire can carry and never says
    /// when it is carried.
    ///
    /// This is the check the tier-1 gate structurally cannot make. A code with no status home
    /// produces no fault row, so there is nothing for coverage to leave uncovered — the gate
    /// counts faults, and this is an obligation.
    #[test]
    fn every_problem_code_has_a_wire_home() {
        let registered: BTreeSet<&str> = CODES_WITHOUT_A_WIRE_HOME.iter().map(|(c, _)| *c).collect();
        let orphans = orphan_codes();
        let unregistered: Vec<&String> =
            orphans.iter().filter(|c| !registered.contains(c.as_str())).collect();
        assert!(
            unregistered.is_empty(),
            "declared Problem code(s) with NO status, operation or condition anywhere outside the \
             D.9 catalogue, and not registered in CODES_WITHOUT_A_WIRE_HOME:\n  {unregistered:?}\n\n\
             Either bind the code to a status in D.8 and name its producing condition, or register \
             it here with what is missing."
        );
    }

    /// THE REGISTER NAMES ONLY LIVE ORPHANS — the other direction, and the one that rots silently.
    /// A code that has since been given a status would sit here for ever reading as an open gap,
    /// and the register would then be documentation of a defect that no longer exists.
    #[test]
    fn the_code_register_names_only_live_orphans() {
        let orphans: BTreeSet<String> = orphan_codes().into_iter().collect();
        let declared: BTreeSet<String> = problem_codes().into_iter().collect();
        for (code, why) in CODES_WITHOUT_A_WIRE_HOME {
            assert!(
                declared.contains(*code),
                "CODES_WITHOUT_A_WIRE_HOME names {code:?}, which is no longer a declared code in \
                 D.9 at all — the register is stale. ({why})"
            );
            assert!(
                orphans.contains(*code),
                "CODES_WITHOUT_A_WIRE_HOME still registers {code:?} as having no wire home, but it \
                 is now referenced outside the D.9 catalogue — the gap was closed and this entry \
                 is now a false claim. Remove it. ({why})"
            );
        }
    }

    /// THE PARSE IS NOT VACUOUS. Every guard above is of the form "nothing unregistered is
    /// orphaned", which passes trivially if the parse finds no codes — and a catalogue parse is
    /// exactly the kind that silently yields zero when a heading is reworded. So pin the shape
    /// from both ends: real codes are found, and codes known to be BOUND are not reported orphaned.
    #[test]
    fn the_problem_code_parse_is_not_vacuous() {
        let codes = problem_codes();
        // THE COUNT IS EXACT, SO THE DIAGNOSIS MUST READ BOTH WAYS. This was a floor (`>= 15`),
        // which could not catch a systematic omission — two hyphenless codes were being dropped and
        // 20 passed as happily as 22. Tightening it to an exact count fixed the check and left the
        // MESSAGE saying "too few … the parse broke", so when the registry legitimately GREW to 24
        // (two channel codes registered) the failure sent the reader hunting a bug that was not
        // there. A true check whose words say something else is the same defect as a stale comment;
        // the fix is to let the message name the direction instead of assuming one.
        const REGISTRY: usize = 22;
        assert!(
            codes.len() == REGISTRY,
            "D.9 parsed to {} codes, expected {REGISTRY}. {} Either way, re-derive before trusting \
             any orphan count on this page — they are all computed over this set:\n  {codes:?}",
            codes.len(),
            if codes.len() < REGISTRY {
                "FEWER than expected, so either the parse broke (a reworded heading, a code shape \
                 the filter cannot see) or codes were removed from the catalogue — and every orphan \
                 check above is now passing over a short set."
            } else {
                "MORE than expected, so the catalogue GREW. That is a spec change, not a bug: \
                 update REGISTRY and re-check which entries in the orphan and used-but-unregistered \
                 registers have just become false claims."
            }
        );
        // Codes whose binding is written out at length in D.8 and the primitive prose. If the
        // orphan check ever reports one of THESE, it is the parse that is wrong, not the spec.
        // `unauthenticated` and `forbidden` are HYPHENLESS and were dropped by the old parser,
        // so they are pinned here by name: they are the two the shape-based filter could not see.
        for want in ["unauthenticated", "forbidden"] {
            assert!(
                codes.iter().any(|c| c == want),
                "{want:?} is missing from the parsed catalogue — the hyphenless codes have been \
                 dropped again, and every count over this registry is off by two: {codes:?}"
            );
        }
        for bound in ["identity-taken", "revision-mismatch", "precondition-failed", "limit-exceeded"] {
            assert!(
                codes.iter().any(|c| c == bound),
                "{bound:?} is not in the parsed catalogue, so the D.9 parse is missing codes: {codes:?}"
            );
            assert!(
                !orphan_codes().iter().any(|c| c == bound),
                "{bound:?} is reported as having no wire home, but its binding is written out in \
                 D.8 — the orphan check is measuring the catalogue against itself, not against the \
                 rest of the spec."
            );
        }
        // And the split must actually REMOVE the catalogue: if `rest` still contained it, every
        // code would look bound and the check would report nothing, for ever.
        let (block, rest) = d9_catalogue();
        assert!(block.contains("malformed-request"), "the D.9 block does not contain the catalogue");
        assert!(
            !rest.contains("temporarily-unavailable"),
            "the catalogue was not removed from the comparison text, so no code can ever be \
             reported orphaned — this check would pass for ever while guarding nothing"
        );
    }

    /// THE CORE CAPABILITY FIELD PARSE IS NOT VACUOUS, and it pins the shape from both ends.
    ///
    /// The wire-side check built on this asserts "no advertised key is outside this set", which
    /// passes trivially if the set is accidentally everything — and a brace-balanced record parse
    /// is exactly the kind that silently swallows a neighbouring type when a heading moves.
    #[test]
    fn the_core_capability_field_parse_is_not_vacuous() {
        let fields = core_capability_fields();
        assert_eq!(
            fields.len(),
            11,
            "CoreCapabilities parsed to {} fields, not the eleven rc2 closed it to — the parse has \
             drifted and the wire-side check built on it is measuring the wrong set: {fields:?}",
            fields.len()
        );
        for want in ["get", "list", "pull", "create", "put", "patch", "delete", "revisions", "export", "import", "push"] {
            assert!(
                fields.iter().any(|f| f == want),
                "{want:?} is missing from the parsed CoreCapabilities fields, so a conformant \
                 advertisement of it would be reported as out-of-vocabulary: {fields:?}"
            );
        }
        // And the two that must NOT be here. core.lumen:1570 puts `call`/`cancel` under their own
        // package, so a parse that picked them up would bless advertising them in `core` — the
        // exact divergence the wire-side check exists to catch.
        for never in ["call", "cancel", "apply"] {
            assert!(
                !fields.iter().any(|f| f == never),
                "{never:?} was parsed as a CoreCapabilities field. It is not one (core.lumen:1570 \
                 — operations and stdlib packs advertise under their own packages, not core), so \
                 the parse has swallowed a neighbouring record and would bless the divergence."
            );
        }
    }

    /// EVERY CODE THE SPEC USES MUST BE IN THE REGISTRY — the mirror of
    /// [`every_problem_code_has_a_wire_home`], and the direction that one structurally cannot see.
    ///
    /// A registry is two assertions, not one: every entry has a home, and every code in use has an
    /// entry. #455 checked the first and found eleven. This checks the second and finds three, on
    /// surfaces whose codes were written at the point of use and never carried back. Both drifts
    /// live on the same primitive in one case — `pull` has `channel-not-pullable` unregistered AND
    /// `validation-failed`-style registry entries with no status — in opposite directions.
    #[test]
    fn every_code_the_spec_uses_is_registered() {
        let registry: BTreeSet<String> = problem_codes().into_iter().collect();
        let known: BTreeSet<&str> = CODES_USED_BUT_UNREGISTERED.iter().map(|(c, _)| *c).collect();
        let unregistered: Vec<String> = codes_named_by_a_fault_verb()
            .into_iter()
            .filter(|c| !registry.contains(c) && !known.contains(c.as_str()))
            .collect();
        assert!(
            unregistered.is_empty(),
            "code(s) named by a fault verb in core.lumen but absent from D.9's registry, and not \
             registered here:\n  {unregistered:?}\n\nA code with no registry entry has no stable \
             problem-type URI, so a client told to branch on it has nothing to branch against. \
             Either add it to D.9 or register it here."
        );
    }

    /// And the register names only live gaps, so a closed one fails instead of rotting.
    #[test]
    fn the_used_code_register_names_only_live_gaps() {
        let registry: BTreeSet<String> = problem_codes().into_iter().collect();
        let used: BTreeSet<String> = codes_named_by_a_fault_verb().into_iter().collect();
        for (code, why) in CODES_USED_BUT_UNREGISTERED {
            assert!(
                used.contains(*code),
                "CODES_USED_BUT_UNREGISTERED names {code:?}, but no fault verb in core.lumen names \
                 it any more — the register is stale. ({why})"
            );
            assert!(
                !registry.contains(*code),
                "{code:?} is now IN D.9's registry, so this entry is a false claim — remove it. \
                 ({why})"
            );
        }
    }

    /// THE FAULT-VERB PARSE IS NOT VACUOUS, and it must stay DISCRIMINATING.
    ///
    /// Both guards above pass trivially if the parse finds nothing, and a verb-anchored scan is
    /// exactly the kind that silently yields zero when wording shifts. Worse, a parse that got
    /// LOOSER would start reporting link relations and event kinds as unregistered codes — so this
    /// pins both ends: the real codes are found, and the six known non-codes are not.
    #[test]
    fn the_fault_verb_parse_is_not_vacuous_and_discriminates() {
        let found = codes_named_by_a_fault_verb();
        // EXACT, NOT A FLOOR — the same correction the registry pin needed today. `>= 6` was true
        // at 6 and true at 12, and the parser was finding 6 because it read only the token
        // immediately after the verb and could not see `faults `404` (`code`)`. A floor cannot
        // catch a systematic omission; it passed happily over HALF the usage sites.
        //
        // The six it missed all named REGISTERED codes, so the used-but-unregistered result was
        // right while the method was incomplete — a number correct for a reason that would not have
        // held if any of those six had been unregistered.
        const VERB_SITES: usize = 12;
        assert!(
            found.len() == VERB_SITES,
            "{} codes named by a fault verb, expected {VERB_SITES}. {} Either way the two registry \
             checks are computed over this set, so re-derive before trusting them:\n  {found:?}",
            found.len(),
            if found.len() < VERB_SITES {
                "FEWER — EITHER the parse narrowed (a reworded clause, a naming style it cannot \
                 see) and usage sites are going unchecked, OR a usage was legitimately REMOVED by \
                 a spec change. The second is not a bug: confirm the code is gone from the registry \
                 too, then update VERB_SITES. I wrote this branch naming only the first cause and \
                 it was wrong the first time it fired, on #460 retiring `resource-pruned`."
            } else {
                "MORE — either the spec names codes in new places, or the scan has LOOSENED and is \
                 collecting non-codes; check the discrimination assertions below."
            }
        );
        for want in ["channel-not-pullable", "identity-taken", "revision-mismatch"] {
            assert!(
                found.iter().any(|c| c == want),
                "{want:?} is named by a fault verb in core.lumen but the parse missed it: {found:?}"
            );
        }
        // The six that are NOT problem codes. If the filter loosens, these reappear and the check
        // becomes a noise generator — which is how a gate gets ignored into uselessness.
        for never in ["call-leave", "channel-authenticated", "is-a", "service-desc", "service-doc", "service-meta"] {
            assert!(
                !found.iter().any(|c| c == never),
                "{never:?} was parsed as a problem code. It is not one — it is an event kind, an \
                 authentication basis, a query relation or a link relation. The fault-verb filter \
                 has loosened and this check will now report noise."
            );
        }
    }

    /// THE SECOND PRODUCER MUST ALSO SPEAK THE REGISTRY. The exhaustive-by-execution check over
    /// `BdpError` is complete over that enum and NOT over this subject: `problem_body` builds
    /// Problems directly at eleven call sites and two of its codes are unregistered. I published
    /// the first check calling its vocabulary complete, which was a claim about a population I had
    /// not enumerated.
    #[test]
    fn the_direct_problem_producer_speaks_the_registry() {
        let registry: BTreeSet<String> = problem_codes().into_iter().collect();
        let known: BTreeSet<&str> = DIRECT_CODES_NOT_REGISTERED.iter().map(|(c, _)| *c).collect();
        let bad: BTreeSet<String> = codes_emitted_by_direct_problem_bodies()
            .into_iter()
            .map(|(_, c)| c)
            .filter(|c| !registry.contains(c.as_str()) && !known.contains(c.as_str()))
            .collect();
        assert!(
            bad.is_empty(),
            "code(s) emitted by a direct `problem_body` call that D.9 does not register, and that \
             are not registered here: {bad:?}"
        );
        // The other direction, so a closed gap cannot rot into a false claim.
        let emitted: BTreeSet<String> =
            codes_emitted_by_direct_problem_bodies().into_iter().map(|(_, c)| c).collect();
        for (code, why) in DIRECT_CODES_NOT_REGISTERED {
            assert!(
                emitted.contains(*code) && !registry.contains(*code),
                "DIRECT_CODES_NOT_REGISTERED still lists {code:?}, but it is now registered or no \
                 longer emitted — remove it. ({why})"
            );
        }
    }

    /// THE SCAN IS NOT VACUOUS, and it pins the SITE COUNT, not just the contents — because its
    /// method is a source scan and a literal-form change (a code built dynamically, a reformatted
    /// call) would silently shrink what it sees rather than break it.
    #[test]
    fn the_direct_producer_scan_is_not_vacuous() {
        let sites = codes_emitted_by_direct_problem_bodies();
        // EXACT, for the same reason. This read `>= 10` and the file has since grown to 25 sites,
        // so the floor had stopped measuring anything — it would have passed with fifteen sites
        // deleted.
        // 25 -> 26: `export`'s `where`/`select` refusal became a `problem_body(400, "bad-request")` site,
        // replacing an `unmapped()` (`501`) that `export` does not declare. The code is already in
        // DIRECT_CODES_NOT_REGISTERED, so the move adds a site without adding a divergence.
        const DIRECT_SITES: usize = 26;
        assert!(
            sites.len() == DIRECT_SITES,
            "the direct-producer scan found {} `problem_body` sites, expected {DIRECT_SITES}. {} \
             The unregistered-code result is computed over this set:\n  {sites:?}",
            sites.len(),
            if sites.len() < DIRECT_SITES {
                "FEWER — the literal form has changed (a status or code built dynamically, a \
                 reformatted call) and sites are going unscanned."
            } else {
                "MORE — new refusal sites were added. Check whether any introduced an unregistered \
                 code before updating DIRECT_SITES."
            }
        );
        // A known-good one, so the scan is proven to reach a REGISTERED code too and is not merely
        // collecting the two it is told to expect.
        assert!(
            sites.iter().any(|(s, c)| *s == 404 && c == "resource-not-found"),
            "the scan missed the 404 `resource-not-found` site, so it is not reading the call sites \
             it claims to: {sites:?}"
        );
    }

    /// EVERY CLOSED-VOCABULARY FIELD MUST BE EMITTABLE. The inverse of the capability case's
    /// question, one layer upstream: that case asks whether a covered op is advertised; this asks
    /// whether the wire could advertise it at all.
    #[test]
    fn every_capability_field_is_emittable() {
        let emittable: BTreeSet<String> = capability_keys_the_wire_can_emit().into_iter().collect();
        let known: BTreeSet<&str> =
            CAPABILITY_FIELDS_THE_WIRE_CANNOT_EMIT.iter().map(|(f, _)| *f).collect();
        let missing: Vec<String> = core_capability_fields()
            .into_iter()
            .filter(|f| !emittable.contains(f.as_str()) && !known.contains(f.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "CoreCapabilities field(s) the wire has NO variant for, so no scope can advertise them \
             however correctly it behaves: {missing:?}\n\n`caps_to_wire` is \
             `filter_map(from_trait)`, so a trait capability with no wire variant is silently \
             discarded. Add the variant, or register the gap here."
        );
        // And the register must not outlive its gap.
        for (f, why) in CAPABILITY_FIELDS_THE_WIRE_CANNOT_EMIT {
            assert!(
                !emittable.contains(*f),
                "{f:?} is now emittable, so this entry is a false claim — remove it, and check \
                 whether the scope actually advertises it yet. ({why})"
            );
        }
    }

    /// THE SCAN IS NOT VACUOUS, and it pins the count because its method is a source scan: a
    /// variant renamed some other way would silently shrink what it sees.
    #[test]
    fn the_capability_key_scan_is_not_vacuous() {
        let keys = capability_keys_the_wire_can_emit();
        const WIRE_KEYS: usize = 17;
        assert!(
            keys.len() == WIRE_KEYS,
            "scanned {} `WireCapability` renames, expected {WIRE_KEYS}. {} The emittable check is \
             computed over this set:\n  {keys:?}",
            keys.len(),
            if keys.len() < WIRE_KEYS {
                "FEWER — either the scan narrowed (a variant named some other way) or variants were \
                 removed. The second is a spec/subject change, not a bug."
            } else {
                "MORE — variants were added. Check whether any closed-vocabulary gap just closed \
                 before updating WIRE_KEYS."
            }
        );
        for want in ["get", "list", "pull", "create", "put", "patch", "delete", "export", "import"] {
            assert!(
                keys.iter().any(|k| k == want),
                "{want:?} is a CoreCapabilities field the wire plainly does emit, but the scan \
                 missed it — the scan is wrong, not the subject: {keys:?}"
            );
        }
    }
}
