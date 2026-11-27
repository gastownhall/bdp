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
        "1 site by spelling, ~16 reachable paths, 501 (`unmapped`). TWO DIFFERENT THINGS WERE \
         CONFLATED HERE, and only one is an open question. \
         (a) AN UN-OFFERED PRIMITIVE. `unmapped` answers every \
         `Ok(res) if res.not_implemented` arm -- get, list, put, patch, delete, create, pull, \
         push, import, export, revisions, call, cancel, apply, resolve_alias -- and \
         `BdpResult::not_implemented` is exactly \"this scope does not support this primitive\". \
         The spec ANSWERS that case and we do not match it: core.lumen:1615 is normative that a \
         request needing an un-offered primitive is refused `capability-not-supported`, and D.8 \
         binds that code to 405 (:2084, which names `patch where a Scope offers no patch` by \
         name). So this is a conformance gap, not a missing register entry -- a REGISTERED code \
         (`capability-not-supported`) at a REQUIRED status, and this subject emits that code \
         nowhere at all. It is invisible to the gate three ways: 405 is absent from patch's \
         declared set so no denominator row can carry it, the 501 spelling is unregistered, and \
         the `pull format=sse` case pins the 501 as correct. NOT FIXED HERE: the core wire is \
         frozen at 0.2.3-rc1, and this changes wire behaviour on ~16 paths. \
         CLOSES WHEN: the un-offered-primitive refusal becomes 405 `capability-not-supported`, \
         post-freeze. \
         (b) AN UN-OFFERED TRANSPORT (`pull format=sse`). 1615 governs PRIMITIVES, and a \
         transport is not one, so (a)'s answer does not reach it. That one stays genuinely open. \
         CLOSES WHEN: Donna rules whether 501 is declared per-op or protocol-wide, and D.9 gains \
         a code if it is to be branched on.",
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
