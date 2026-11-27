//! The HTTP binding's OWN Problem codes — the producer the trait-level probe cannot see.
//!
//! `every_emittable_problem_code_is_registered` (in `tests/gate.rs`) builds its code set by
//! constructing every `BdpError` variant and reading `WireProblem::from_error`. That is a real
//! guard and it works. It is also blind to half the problem.
//!
//! THERE ARE TWO PRODUCERS OF PROBLEM CODES IN THIS SUBJECT. The trait layer turns a `BdpError`
//! into a Problem; the HTTP binding writes Problems DIRECTLY, via `problem_body(status, code,
//! detail)`, for faults that never become a `BdpError` at all -- an unroutable path, a malformed
//! envelope, a refused query parameter. 26 such call sites exist in `server.rs`, and NONE of them
//! passes through `from_error`, so none is reachable by that probe.
//!
//! The effect is the shape that is hardest to notice: a guard whose coverage reads as complete
//! because it is exact, vacuity-checked and green, while the population it measures is the smaller
//! of two. Sixteen of the 26 sites emit a code absent from D.9's registry, and the gate has been
//! green through every one of them. `bad-request` alone accounts for 14 -- a spelling that appears
//! nowhere in `core.lumen`.
//!
//! WHY A SOURCE PARSE RATHER THAN A PROBE. These sites are reached by malformed or unroutable
//! requests, so exercising all 26 over the wire would mean 26 new cases, several of them for paths
//! the router rejects before any op is chosen. The parse reads the producer instead, and the
//! population count below is what keeps the parse honest: a call site written in a form the parser
//! cannot read changes the COUNT, so it fails rather than going silently uncounted. That is the
//! repair for a parser whose defect would otherwise be an undercount -- pin the population, not
//! just the findings.

/// The HTTP binding's source, read at compile time so the parse cannot drift from the binary.
pub const HTTP_BINDING: &str = include_str!("../../subject/bdp-protocol/src/server.rs");

/// Every `problem_body(<status>, "<code>", ...)` call in the HTTP binding, as `(status, code)`.
///
/// Parses the CALL, not the line: the status and code may sit on separate lines, and five of the
/// real sites do. A line-anchored pattern would miss exactly those and report a tidy undercount.
pub fn http_layer_problem_sites() -> Vec<(u16, String)> {
    let s = HTTP_BINDING;
    let needle = "problem_body(";
    let mut out = Vec::new();
    let mut i = 0usize;
    while let Some(p) = s[i..].find(needle) {
        let at = i + p;
        i = at + needle.len();
        // The DEFINITION is not a call site. Matching it would read the first string literal in
        // the function body (`retry: "never"`) as a code -- which is precisely what the first
        // version of this census did, inventing a code that does not exist.
        if s[..at].ends_with("fn ") {
            continue;
        }
        let t = s[i..].trim_start();
        let digits: String = t.chars().take_while(char::is_ascii_digit).collect();
        if digits.len() != 3 {
            continue;
        }
        let rest = t[digits.len()..].trim_start();
        let Some(rest) = rest.strip_prefix(',') else { continue };
        let Some(rest) = rest.trim_start().strip_prefix('"') else { continue };
        let code: String = rest.chars().take_while(|&c| c != '"').collect();
        if code.is_empty() || !code.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            continue;
        }
        let Ok(status) = digits.parse::<u16>() else { continue };
        out.push((status, code));
    }
    out
}

/// Codes the HTTP binding emits that D.9 does not register, with the repair each one needs.
///
/// Registered so the gate is green on the KNOWN set and red on a new one -- the same contract as
/// `CODES_USED_BUT_UNREGISTERED` on the spec side. Every entry is a defect with an owner, not an
/// exemption.
pub const HTTP_CODES_WITHOUT_A_REGISTER_ENTRY: &[(&str, &str)] = &[
    (
        "bad-request",
        "14 sites, all 400. Appears nowhere in core.lumen and in no D.9 register; D.8's 400 row \
         resolves to `malformed-request` OR `invalid-parameter`, and which one each site takes is \
         a per-site read of that row: in an operation's vocabulary and advertised false is a \
         statable decline (`invalid-parameter`), outside its vocabulary is malformed. \
         CLOSES WHEN: each of the 14 sites is classified under D.8 and this entry's count reaches 0.",
    ),
    (
        "unsupported-media-type",
        "1 site, 415 (a direct `patch` whose media type is not application/json-patch+json). D.8 \
         DECLARES the 415 condition (core.lumen:2079-2080) and names NO code for it, unlike the \
         412 and 422 rows which name theirs -- and D.9 registers no 415-appropriate code at all. \
         So this spelling is the binding's invention for a status the spec declares without a \
         code. NOT a rename: there is nothing to rename it to. \
         CLOSES WHEN: D.9 gains a code for 415, or D.8's row names an existing one.",
    ),
    (
        "not-implemented",
        "1 site by SPELLING (`unmapped`), 29 call sites, FOUR distinct conditions. The single \
         spelling is what hid them: counting codes found one gap, and counting CONDITIONS found \
         four, each needing a different answer. Classified by the arm that reaches it, not by the \
         detail string. \
         (a) 14 sites -- `Ok(res) if res.not_implemented`, i.e. the scope does not support the \
         primitive. core.lumen:1615 is normative that this is refused `capability-not-supported`, \
         which D.8 (:2084) binds to 405, naming `patch where a Scope offers no patch` explicitly. \
         This subject emits that code NOWHERE. A conformance gap with a known answer. \
         (b) 4 sites -- an ADVERTISED-FALSE option, which is a different thing entirely: list \
         `where` (:258), pull `format=jsonl` (:344) and `format=sse` (:349), async `call` mode \
         (:700). The capability EXISTS in the op's record and this scope advertises it false \
         (`PullCaps { sse: false, jsonl: false, .. }`), so D.8 (:2057-2062) makes it a decline the \
         op can STATE: `400 invalid-parameter`. Same reasoning the spec owner ruled for \
         `ExportCaps.selector` and extended to get/list/pull. The binding has this INVERTED -- an \
         out-of-vocabulary `format` token already answers 400 while these in-vocabulary ones \
         answer 501, so the harsher undeclared status goes to the gentler cases. NOTE: list \
         `where` is entangled with the 0.2.4 filter-model question (per-op `PullCaps.filter` vs \
         scope-wide `ListCaps.conditions` vs `ExportCaps` having no filter field at all), so its \
         code cannot be settled before that model is. \
         AND (b) MAY NOT BE 400 AT ALL -- TWO NORMATIVE LINES COLLIDE ON THIS EXACT CELL, which \
         #460 makes visible without creating. The scope of `capability-not-supported` is stated \
         three ways: `un-offered PRIMITIVE` (:993, :1573, :1615), `un-offered CAPABILITY` (:2153), \
         and, in #460's rewritten 405 row, `any un-offered primitive or FEATURE (an un-offered \
         capability is declined here, never 501)`. An advertised-false `selector` or `sse` is a \
         capability FIELD, so the broader two readings reach it -- at 405. D.8's 400 line \
         (:2057-2062) reaches the same cell at 400 `invalid-parameter`, and that is what the spec \
         owner ruled for `ExportCaps.selector`. Both lines are normative and they disagree on the \
         STATUS. \
         THE SCOPING THAT HONOURS BOTH RATIONALES, offered as a reading and not a ruling: the 405 \
         rationale is that the caller CANNOT fix the request -- the operation is not available \
         here, which is what 405 means. The 400 rationale is the owner's own words, that `the \
         capability is advertised, so a client reads it and omits select rather than being \
         refused` -- i.e. the caller CAN fix the request. So the line falls on FIXABILITY: \
         primitive absent -> 405; an option declined on a primitive that IS offered -> 400. #460's \
         `or feature` cuts across that, and #460 merges FIRST. \
         THIS BLOCKS NOTHING HERE and is not ours to rule, but it does gate the five-part \
         `select` -> `invalid-parameter` change: if `feature` carries, that change is 405, not 400. \
         AND (b) IS 8 SITES, NOT 4, ACROSS TWO CODES -- found because a peer confessed that her \
         census of this class had been scoped to where MY instances lived, which is exactly what \
         mine was. I keyed the census on `unmapped(` call sites, so it could only ever find \
         advertised-false cases that already answered 501. A second helper answers the SAME \
         condition differently: `unadvertised()` (:1193) returns 422 `limit-exceeded` for \
         `clientProposedId: false` (:219), `ifMatch: false` on put (:843), `ifAbsent: false` \
         (:850) and `ifMatch: false` on patch (:953). So this subject answers advertised-false \
         with 501 at four sites and 422 at four others, depending only on which helper the path \
         reaches -- an inconsistency invisible to any census keyed on a code. \
         THE 422 SITES LOOK WRONG TOO, and this is the consequential part. #460 adds an explicit \
         test to D.8's 422 row: `MEMBERSHIP TEST: a fault belongs at 422 IFF shrinking the request \
         fixes it; a well-formed body that is simply unusable is 400, not 422`. Dropping an \
         `If-Match` header is not SHRINKING anything, and `ifMatch: false` is an off switch rather \
         than a bound -- so these fail the IFF. Main already carried the weaker form of the same \
         test (`fixed by shrinking the request`), so the defect pre-dates #460; #460 only makes it \
         undeniable. \
         AND IT REACHES THE HEADLINE NUMBER, which is why it is recorded here rather than left in \
         a message. `op/create/fault/422` (claimed at tests/gate.rs:3279), `op/put/fault/422` and \
         `op/patch/fault/422` (both at :3314) are claimed SOLELY by \
         `the_capability_duals_are_refused_422`, via the advertised-false path, asserting \
         `(422, limit-exceeded)`. That case's own prose says 422 `says the guard is not offered \
         here` -- i.e. it is keyed on precisely the condition the membership test excludes. If \
         advertised-false is not 422, those three rows lose their only coverage and the grid is \
         45/51, not 48/51. \
         NOT TREATED AS SETTLED, by this lane's own rule: a plausible ruling could call a boolean \
         advertised false a bound of zero and keep 422, which would make current behaviour correct. \
         So it is a question with a measured consequence, not a defect to fix here -- but it is the \
         one item in this register that can move the published coverage figure, and the figure \
         should not be quoted as settled while it is open. \
         (c) 10 sites -- a `None` arm on `res.value`, which sits AFTER the `not_implemented` guard \
         in the same match and is therefore reachable ONLY when `not_implemented == false`. The \
         scope has just claimed it implements the primitive and returned no value. Answering \
         `not-implemented` asserts the opposite of the flag that got us here, about a primitive \
         the advertisement says is offered -- the advertised-implies-implemented breach, \
         manufactured by the protocol layer rather than the backend. The detail strings are honest \
         (`list returned no value`) while the code contradicts them, which is why reading the file \
         never caught it: a true sentence beside a false one. FOUND BY A PEER in her own tree, \
         after I told her hers was the correct one; she checked BECAUSE the compliment flattered \
         her. D.9's register has no code for `the scope broke its own contract`, and \
         `temporarily-unavailable` is wrong because it tells a client to retry something that is \
         not transient. REACHABILITY IS NOT PROMISED: no case constructs such a scope and the \
         in-memory backends may never do it, so these may be arms with no path to them -- and an \
         unreachable arm holds a false answer with no statistical tell. `Server` wraps any \
         `impl BdpScope`, so reachability is not ours to guarantee either way. \
         (d) 1 site -- `Route::ScopeEval` (:68), a route this binding does not bind at all. \
         Plausibly the one place 501 is right, and the only one left needing the per-op \
         vs protocol-wide ruling. \
         NOT FIXED: the core wire is frozen at 0.2.3-rc1 and (a)+(b)+(c) are 28 paths of live \
         response. CLOSES WHEN: post-freeze, (a) answers 405 `capability-not-supported`, (b) \
         answers 400 `invalid-parameter` (after the filter model for list `where`), (c) gets a \
         code that does not exist yet, and (d) is ruled.",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// THE POPULATION IS PINNED, which is what makes a source parse trustworthy.
    ///
    /// The parse's failure mode is an UNDERCOUNT -- a call written in a shape it cannot read simply
    /// does not appear, and every check below would then pass over a short set. An exact count
    /// turns that silence into a failure. The message names both directions, because a site
    /// legitimately added or removed is a normal change and not a parser bug.
    #[test]
    fn the_http_binding_parse_is_not_vacuous() {
        let sites = http_layer_problem_sites();
        const SITES: usize = 26;
        assert!(
            sites.len() == SITES,
            "parsed {} `problem_body` call sites in the HTTP binding, expected {SITES}. {} Every \
             count on this page is computed over this set:\n  {sites:?}",
            sites.len(),
            if sites.len() < SITES {
                "FEWER — EITHER a site was removed (a normal change: update SITES), OR a site is \
                 written in a form this parser cannot read and is going UNCHECKED. Rule the second \
                 out first: an undercount here is silent everywhere else."
            } else {
                "MORE — sites were added. Classify each new code before updating SITES."
            }
        );
        // DISCRIMINATING, not merely non-empty: a parser that returned a fixed stub, or that read
        // the wrong token, would still satisfy a count. These two are known to be present and are
        // of different shapes -- one registered, one not.
        let codes: BTreeSet<&str> = sites.iter().map(|(_, c)| c.as_str()).collect();
        for expect in ["malformed-request", "bad-request"] {
            assert!(
                codes.contains(expect),
                "`{expect}` is not among the parsed codes, so the parse is reading something other \
                 than the code argument: {codes:?}"
            );
        }
    }

    /// The guard itself: no code reaches the wire from the HTTP layer without a register entry.
    #[test]
    fn every_http_layer_code_is_registered() {
        let registry: BTreeSet<String> = crate::problem_codes().into_iter().collect();
        let known: BTreeSet<&str> =
            HTTP_CODES_WITHOUT_A_REGISTER_ENTRY.iter().map(|(c, _)| *c).collect();
        let unregistered: BTreeSet<String> = http_layer_problem_sites()
            .into_iter()
            .map(|(_, c)| c)
            .filter(|c| !registry.contains(c) && !known.contains(c.as_str()))
            .collect();
        assert!(
            unregistered.is_empty(),
            "the HTTP binding emits code(s) absent from D.9 and unregistered here: \
             {unregistered:?}. A code outside D.9 has no stable problem-type URI, so a client told \
             to branch on it has nothing to branch against. Either classify it under D.8 and emit \
             the registered spelling, or register it here with the repair it needs."
        );
    }

    /// BOTH DIRECTIONS. An entry that has been fixed, or whose code D.9 has since adopted, is a
    /// false claim about this subject and must go in the change that fixed it -- otherwise the
    /// register slowly becomes a list of things that used to be wrong, which reads exactly like a
    /// list of things that are.
    #[test]
    fn the_http_register_names_only_live_gaps() {
        let registry: BTreeSet<String> = crate::problem_codes().into_iter().collect();
        let emitted: BTreeSet<String> =
            http_layer_problem_sites().into_iter().map(|(_, c)| c).collect();
        let stale: Vec<&str> = HTTP_CODES_WITHOUT_A_REGISTER_ENTRY
            .iter()
            .map(|(c, _)| *c)
            .filter(|c| registry.contains(*c) || !emitted.contains(&c.to_string()))
            .collect();
        assert!(
            stale.is_empty(),
            "these entries are no longer live gaps — either D.9 now registers the code, or the \
             binding no longer emits it — so each is a false claim: {stale:?}. Remove them in the \
             change that closed them."
        );
    }

    /// The count of UNREGISTERED sites, pinned exactly so progress is visible and regression fails.
    /// A floor (`<= 16`) would pass while a 15th `bad-request` was added.
    #[test]
    fn the_unregistered_site_count_is_pinned() {
        let registry: BTreeSet<String> = crate::problem_codes().into_iter().collect();
        let n = http_layer_problem_sites()
            .iter()
            .filter(|(_, c)| !registry.contains(c))
            .count();
        const UNREGISTERED_SITES: usize = 16;
        assert!(
            n == UNREGISTERED_SITES,
            "{n} HTTP-layer sites emit an unregistered code, expected {UNREGISTERED_SITES}. {}",
            if n < UNREGISTERED_SITES {
                "FEWER — sites were repaired. Lower the constant in the same change, and drop any \
                 register entry that has reached zero sites."
            } else {
                "MORE — a new site emits an unregistered code. Classify it under D.8 before \
                 raising this."
            }
        );
    }
}
