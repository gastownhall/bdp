//! The TS `bdptest` subsumption ledger.
//!
//! The TS suite is being subsumed into this Rust suite and then retired. The hazard is not the
//! porting; it is that a port LOSES cases quietly. A file nobody ever looked at and a file
//! deliberately dropped read identically once the TS tree is gone, and no count over the Rust side
//! can tell them apart -- the Rust suite does not know what it is missing.
//!
//! So this table is a tripwire, not a plan. It pins the EXACT set of TS files and each one's
//! disposition, and the tests below fail if the real directory and this table disagree in either
//! direction. That is the same shape that caught a peer's +1 normative obligation on #461 while a
//! `>= 60` floor had sat green through an 89 -> 91 move.
//!
//! INDEPENDENCE (the reason this file holds no expectations): the value of the TS suite was that it
//! was written separately from the Rust subject, so the two could disagree. Mechanically
//! translating its assertions would collapse two instruments into one copy of one instrument and
//! keep the shape of a cross-check while destroying its content. So this ledger carries only the
//! CHECKLIST -- which behaviours were covered somewhere -- and every Rust expectation is authored
//! from `core.lumen`. Only the surface (ops, faults, schemas) is derived by construction.

/// What has become of one `apps/bdptest/src/*.test.ts` file in the Rust port.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    /// Deliberately NOT ported: v0.1 retained-compat, which never shipped, so there is no
    /// deployed client whose behaviour it protects (ruled 2026-11-27).
    Dropped,
    /// Its behaviours are re-authored in Rust, from the spec rather than from its assertions.
    Ported,
    /// Not yet done. The honest default: a file is Pending until someone has read it.
    Pending,
}

pub struct TsFile {
    pub file: &'static str,
    pub disposition: Disposition,
}

/// THE 422 CENSUS OF THE TS SUITE, enumerated before any port, because a ported expectation is
/// the one kind of borrowed evidence this gate cannot audit afterwards.
///
/// 25 real `\b422\b` references across 10 of the 52 files (36 raw matches on a broad pattern, 5 of
/// them digit substrings like `adds2422B` — a bare `422` over-matches, so the population was read,
/// not counted). EVERY ONE WAS READ. NONE asserts the core advertised-false rule the RC3 ruling
/// reclassifies, so nothing here contradicts the ruling and no expectation needs flipping for it.
///
/// THE DOMINANT CLASS IS `validation-failed` AT 422 — a schema violation, not a capability bound —
/// and THIS SUBJECT EMITS IT AT 409. That divergence is a PORTING DECISION, not a mechanical
/// transcription: `validation-failed` appears in core.lumen exactly once (D.9's vocabulary, :2119)
/// bound to no status, so neither side is ruled. D.8:2103-2106's IFF excludes 422 for it (a schema
/// violation is not fixed by shrinking) while D.8:2084-2085's "also some Problems" leaves an
/// unnamed 409 slot. Carried to the spec owner. PORT THE CASE, NOT ITS STATUS, until it is ruled.
///
/// The rest, by category: schema/type validation rejects (the above), idempotency-key handling,
/// `view=terminal` under a feature media type, transactional admission control, and one
/// unsupported `capabilityVersion`. Three of the ten files are v0.1 retained-compat
/// (`retained-v01-reference`, `retained-v01-links-reference`, `historical-update-reference`,
/// 9 of the 25 references) and are Dropped, so they are not ported at all.
///
/// HOW THIS WAS FOUND IS THE LESSON. A peer's census of her own tree went 16 → 17 → 23 → 24, the
/// last found by a failing test rather than a grep, because a fault has TWO spellings — a variant
/// token and a wire string — and she had grepped one. Applying that here, my first repo-wide pass
/// reported no string-level assertions outside `conformance/` at all. It was wrong: I had dropped
/// the bare `422` alternative that my in-tree pattern carried, measuring the two sides with
/// DIFFERENT commands while citing the rule that says not to. The 15 files were invisible to the
/// pattern, not absent from the repo. The conclusion survived; the search did not.
///
/// Every file in `apps/bdptest/src`, pinned EXACTLY. Not a floor -- see the module note.
pub const TS_SUITE: &[TsFile] = &[
    TsFile { file: "atomic-batch-reference.test.ts", disposition: Disposition::Pending },
    TsFile { file: "canonical-reference.test.ts", disposition: Disposition::Pending },
    TsFile { file: "development-contracts.test.ts", disposition: Disposition::Pending },
    TsFile { file: "development-disconnect.test.ts", disposition: Disposition::Pending },
    TsFile { file: "development-discovery.test.ts", disposition: Disposition::Pending },
    TsFile { file: "development-matrix.test.ts", disposition: Disposition::Pending },
    TsFile { file: "development-server.test.ts", disposition: Disposition::Pending },
    TsFile { file: "historical-update-reference.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-read-fixture.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-read-oracles.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-reference-closure.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-reference-import.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-reference-startup.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-reference.test.ts", disposition: Disposition::Pending },
    TsFile { file: "installed-schema-cohort.test.ts", disposition: Disposition::Pending },
    TsFile { file: "owned-wildcard.test.ts", disposition: Disposition::Pending },
    TsFile { file: "properties-provenance.test.ts", disposition: Disposition::Pending },
    TsFile { file: "read-matrix.test.ts", disposition: Disposition::Pending },
    TsFile { file: "read-update-artifact-execution.test.ts", disposition: Disposition::Pending },
    TsFile { file: "read-update-exact-client.test.ts", disposition: Disposition::Pending },
    TsFile { file: "read-update-guarded-overlap-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "read-update-matrix.test.ts", disposition: Disposition::Pending },
    TsFile { file: "retained-v01-aliases-reference.test.ts", disposition: Disposition::Dropped },
    TsFile { file: "retained-v01-links-reference.test.ts", disposition: Disposition::Dropped },
    TsFile { file: "retained-v01-point-read.test.ts", disposition: Disposition::Dropped },
    TsFile { file: "retained-v01-reference.test.ts", disposition: Disposition::Dropped },
    TsFile { file: "server-composition.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-alias-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-binding.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-changefeed-refusal-context-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-collection-minimum-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-depth-key-order-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-direct-refusal-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-discovery-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-event-missing-context-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-event-sse-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-fresh-depth-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-guarded-batch-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-matrix.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-minimum-current-resource-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-minimum-receiving-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-principal-key-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-receipt-missing-context-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-same-key-overlap-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-schema-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-selector-admission-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-sequence-depth-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-sequence-refusal-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-set-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-set-receipts.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-snapshot-installed.test.ts", disposition: Disposition::Pending },
    TsFile { file: "transactional-sse-installed.test.ts", disposition: Disposition::Pending },
];

/// Where the TS suite lives, resolved from this crate rather than the process's working directory,
/// which differs between `cargo test` at the workspace root and in the crate.
pub fn ts_suite_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/bdptest/src")
}

/// The `*.test.ts` files actually on disk.
pub fn ts_files_on_disk() -> Result<Vec<String>, String> {
    let dir = ts_suite_dir();
    let entries = std::fs::read_dir(&dir).map_err(|e| {
        format!(
            "cannot read {}: {e}.\n\nThis is a FAILURE, not a pass. If the TS tree was deleted \
             because the tool retired, that deletion also removed the only record of which cases \
             were never ported -- so this ledger must be settled (every entry Ported or Dropped) \
             and this check replaced in the SAME change, not left to read an absent directory as \
             nothing to do.",
            dir.display()
        )
    })?;
    let mut out = Vec::new();
    for e in entries {
        let name = e.map_err(|e| format!("bad dir entry: {e}"))?.file_name();
        let name = name.to_string_lossy().to_string();
        if name.ends_with(".test.ts") {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

pub fn count(d: Disposition) -> usize {
    TS_SUITE.iter().filter(|f| f.disposition == d).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// EXACT in both directions. A file added to the TS suite that nobody classified is a case
    /// that will be lost at retirement; a file removed while still Pending is a case lost already.
    #[test]
    fn the_ts_suite_listing_is_exact() {
        let disk: BTreeSet<String> = ts_files_on_disk().expect("read the TS suite").into_iter().collect();
        let table: BTreeSet<String> = TS_SUITE.iter().map(|f| f.file.to_string()).collect();

        let unclassified: Vec<&String> = disk.difference(&table).collect();
        assert!(
            unclassified.is_empty(),
            "{} TS file(s) on disk are not in TS_SUITE: {:?}. Classify each one (Ported, Pending \
             or Dropped with a reason) -- an unclassified file is a case that disappears silently \
             when the TS tool retires.",
            unclassified.len(),
            unclassified
        );

        let vanished: Vec<&String> = table.difference(&disk).collect();
        assert!(
            vanished.is_empty(),
            "TS_SUITE names {} file(s) that are no longer on disk: {:?}. If a file was removed, \
             say so by settling its entry in the same change; leaving it here makes this ledger \
             describe a tree that does not exist.",
            vanished.len(),
            vanished
        );
    }

    /// A biconditional, deliberately. "Every dropped file is v0.1" is the half that matters: it is
    /// what stops a non-v0.1 file being parked as Dropped to make the count move. The other half
    /// catches a v0.1 file quietly kept.
    #[test]
    fn dropped_is_exactly_the_v01_retained_compat_set() {
        let wrongly_dropped: Vec<&str> = TS_SUITE
            .iter()
            .filter(|f| f.disposition == Disposition::Dropped && !f.file.starts_with("retained-v01"))
            .map(|f| f.file)
            .collect();
        assert!(
            wrongly_dropped.is_empty(),
            "Dropped is reserved for v0.1 retained-compat, which never shipped. These are not \
             v0.1 and must be ported, not dropped: {:?}",
            wrongly_dropped
        );

        let v01_not_dropped: Vec<&str> = TS_SUITE
            .iter()
            .filter(|f| f.file.starts_with("retained-v01") && f.disposition != Disposition::Dropped)
            .map(|f| f.file)
            .collect();
        assert!(
            v01_not_dropped.is_empty(),
            "these v0.1 files are not marked Dropped: {:?}. v0.1 never shipped; porting it spends \
             effort protecting no deployed client.",
            v01_not_dropped
        );
    }

    /// Progress, printed rather than asserted. A threshold here would either block the port or
    /// rot: the number that matters is Pending reaching zero, and `the_ts_suite_listing_is_exact`
    /// is what keeps it honest meanwhile.
    #[test]
    fn the_subsumption_report() {
        let (p, d, pend) = (
            count(Disposition::Ported),
            count(Disposition::Dropped),
            count(Disposition::Pending),
        );
        println!("TS subsumption: {} files total", TS_SUITE.len());
        println!("  ported:  {p}");
        println!("  dropped: {d}  (v0.1 retained-compat, never shipped)");
        println!("  PENDING: {pend}");
        assert_eq!(p + d + pend, TS_SUITE.len(), "every file must carry a disposition");
    }
}
