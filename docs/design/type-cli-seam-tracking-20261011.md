# Type/CLI seam tracking — October 11, 2026

Updated October 11, 2026. Owner: Janet (release coordination and current
CLI/BDP integration). Type design: Trish. Product decisions: Donna.
Plan of record: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Release coordination: [Preview 2 #7170](https://github.com/gastownhall/beads/issues/7170).
Type design delivery: [PR60](https://github.com/gastownhall/bdp/pull/60).
Prior boundary acknowledgment:
[October 6 seam acknowledgment](https://github.com/gastownhall/bdp/issues/59#issuecomment-6021359443)
(PR60 `30bc279` against CLI PR102 `c893c11f9`).

**Status:** seam tracking record for the Type design revision Trish handed
off on October 8 ([#59 completion record](https://github.com/gastownhall/bdp/issues/59#issuecomment-6069572247)).
It records which PR60 revision the release/CLI lane tracks, the source heads
observed today, the release-gate crosswalk and the overlaps flagged between
the Type decision ledger and the graph CLI contract. It is not the exact
frozen-candidate acknowledgment, not acceptance of D01–D12, not Review Team,
product or release acceptance, and it authorizes no Type implementation or
feature staging. Canonical BDP, the schema bundle and every runtime are
unchanged by this record.

## 1. Tracked revision

| Item | Value |
| --- | --- |
| PR60 revision tracked | `a286110166b0983a8b54a406fd4883e63af67354`, as named in Trish's handoff and the #59 completion record |
| Design | [type-lifecycle-preview2.md](https://github.com/gastownhall/bdp/blob/a286110166b0983a8b54a406fd4883e63af67354/docs/design/type-lifecycle-preview2.md) (12 decision areas D01–D12, 47 cases T01–T47, ready/NYI table) |
| Decision packet | [type-preview2-decision-packet.md](https://github.com/gastownhall/bdp/blob/a286110166b0983a8b54a406fd4883e63af67354/docs/design/type-preview2-decision-packet.md) |
| Council record | [type-preview2-council-20261008.md](https://github.com/gastownhall/bdp/blob/a286110166b0983a8b54a406fd4883e63af67354/docs/design/type-preview2-council-20261008.md) (Codex + Claude on `659bc85`; Gemini omitted; Codex recheck of `ee2acae`) |
| PR60 head today | `9e959a69851798dbf26a578dd3bc8f7f79e1c493`. Six later docs-only commits (`c0885b3`, `3513912`, `92a5cb1`, `dde516b`, `0a58118`, `9e959a6`) add Type packaging/registry source notes and provenance research. None changes the three documents above, `README.md` or `CONTEXT.md` relative to `a286110`. |

SHA-256 digests computed from the tracked revision. They equal the corrected
core artifact digests recorded in the council record, so the tracked revision
is the reviewed and rechecked text plus review evidence and the acceptance
table formatting fix the council record describes.

| Artifact at `a286110` | SHA-256 |
| --- | --- |
| docs/design/type-lifecycle-preview2.md | fc6cc250d1f0439ddb4ff6711536c8887d3817723d8491b71cc76c70a23a6ede |
| docs/design/type-preview2-decision-packet.md | 785a765b74ca124b0d536f68c411dbd05749d67ce4cef747e751174f912af6c8 |
| CONTEXT.md | 807aef5611bfbf375fedc7b670b02bc4650601035726aafc87695a1ca6010313 |

These are document identity checks. They are not a re-review of the design
and do not change the council's stated limit that Claude has not re-reviewed
the corrections.

## 2. Source heads observed October 11

| Source | Pinned in design §10, the PR102 ledger or #7170 | Observed today | Movement |
| --- | --- | --- | --- |
| Canonical BDP main | `182f1fcf8a01d896976bff3c9e3fb87c596c6ca6` | same | None |
| CLI PR102 ([versioned-beads/beads#102](https://github.com/versioned-beads/beads/pull/102), draft) | `94d880d4b7bdb87468281c1a7453b94387aacb2e` | same; last updated October 9 | None |
| `versioned-beads/beads:integration` | `356275a13290064fe903ace31984c14d1b9f7ad4` | `e19524978d99301a960ae450b6d85e2cfcb88c2b` | 13 commits touching only `internal/doltserver` and `internal/replay`; no Type reader, installed-set or reference doc file changed |
| `donnabox/beads:release/preview2-integration` | `76fde9c9cb0865d430bf12d76fc473490f51128a` (#7170 body, October 10) | `72cd9dc3c7a2304f15dbe5d3e880d903cf077a35` | 101 commits across 130 files, including merged [PR84](https://github.com/donnabox/beads/pull/84) (`f7e9d7ae`) and the Preview 2 Issue command tail; `informational_types.go` and `types_read.go` unchanged |
| BDP [PR64](https://github.com/gastownhall/bdp/pull/64) common metadata | draft | draft at `b5a5b4153130dd91fb3ddb30f5aafc8f57311d2e` | Separate normative amendment; see F5 |
| [beads#7403](https://github.com/gastownhall/beads/issues/7403) runtime architecture tracker | cited by #59 and the decision packet | closed, "Withdrawn by its author", October 8 22:46Z | See F9 |

Targeted inspection only: the Type reader and installed-set source files cited
in design §10 are byte-identical on both Beads heads above, and the
versioned-beads technical reference at `e1952497` still states that arbitrary
Type installation is unavailable and that reads do not install the example
Link Types. This confirms the handoff's "arbitrary installation NYI" statement
by file identity and wording. It is not runtime qualification of either head,
and it does not qualify the staged fork head for release.

The October 6 History crosswalk is unchanged: public BDP main already
specifies History `view=versions` and exact historical reads, the Beads Read
listener does not serve that surface, and the CLI's store-local revision number
is not a BDP wire member.

## 3. Release and CLI gate crosswalk

| Gate (owner) | Recorded in | State at this record |
| --- | --- | --- |
| CLI/Type seam (Janet) | #59 gate table | Prior boundary acknowledged October 6 at PR60 `30bc279`. The release/CLI lane now tracks `a286110`. The exact frozen-candidate acknowledgment waits for a named frozen revision; this record does not discharge it. |
| Decided-document acceptance (Donna, Review Team) | #59 | Pending. The council record is design review, not acceptance. |
| Monday candidate (release owner) | #59, #7170 | Pending. The Type document is mandatory by Monday October 12 EOD Pacific; implementation is optional and unselected. |
| Reconcile the final CLI specification with the Type specification and its chosen home (Janet, CLI owner) | #7170 release gates | Open. Section 4 is the tracking input. PR102 remains a draft at `94d880d` and is not edited by this record. |
| Optional Type implementation | #59 | Unselected. Nothing here changes that. |

## 4. Flagged overlaps

Each row names the Type design position at `a286110`, the CLI or release
artifact it touches, the overlap and the lane that owns any follow-up. No row
makes a product ruling or promotes an NYI surface.

| ID | Type design at `a286110` | CLI or release artifact | Overlap flagged | Lane |
| --- | --- | --- | --- | --- |
| F1 Type selector spellings | §5: CLI spellings such as `update --bead-type` remain Beads decisions. D02: preserve existing `types/` identities. D08/T04: a floating selection resolves to one exact stored pin. D12: identity/version matching in filters. | PR102 at `94d880d`: `--bead-type`/`--link-type` accept `types/NAME` or the exact local Type URL. Staged fork (PR84, `c2f9d517`): `create`, `list`, `link` and `links` also accept bare installed Type names, and `bd types` help now lists all three spellings. | The PR102 ledger predates the staged spelling; refreshing its pinned commit and selector row is release-lane work. Under the versioned model every current spelling is a floating nominal selection that happens to resolve to the single installed definition. Once one identity has several definitions, each spelling needs a decided pinned or floating meaning and the stored record must carry the exact pin. No CLI spelling is a BDP identity form. | Beads/Janet for spellings and ledger; D03/D08/D12 for meaning |
| F2 "Type immutable" wording | T06 confirmed: an update omitting Type selection keeps the exact pin. D08: explicit adoption is a new resource version. §11: PR102's immutable wording means the existing whole binding. | PR102 `update LINK`: "Endpoints and Type are immutable"; arbitrary-authoring target: `update` preserves ID and Type; no graph `update` command selects a Type. | Unchanged from the October 6 acknowledgment. PR102's wording stays accurate for Preview 2 because adoption is NYI and no update command selects a Type. Reword only after a decided contract. | Janet/CLI owner, after a decision |
| F3 Arbitrary installed Bead authoring | §11: do not promote the NYI row because the draft exists. D04/D07, T01/T30: complete installed closure and atomic admission precede any authoring. | PR102 NYI row: "After the Type design is decided; release not assigned." Target contract: `bd create --bead-type types/NAME --properties JSON` for any installed Type "the current workspace can validate". | Stays NYI with no release assignment. The target wording presupposes D04's installed closure and D07's admission outcome; both remain open. Today's source check (section 2) finds the fixed catalog unchanged on both Beads heads. | Unchanged |
| F4 Issue `--type` versus nominal Type | D12: do not overload Issue `--type`. §10: `--type` remains Issue classification; graph Type selectors are distinct. T29/T39: nominal filters match identity, not classification. | PR102: `--type` on an Issue is its classification; the adapter stores it in `issue_type` of one installed Issue Bead Type, so a BDP `type` filter cannot select one classification. PR84 adds native-prefix Issue IDs and legacy Issue `show --json`. | Consistent on both sides. The single-Issue-Type adapter mismatch stays a documented CLI limit, not a Type design decision; PR84's ID and JSON changes do not alter it. Preview 2 publication text must describe `--type` as classification only. | No action |
| F5 Open metadata | Metadata is outside Type-validated properties. T24: open-root/preserve-untouched rules remain unless amended. §5 and T38/T44: properties and explicit Type adoption commit together; an unchanged durable state is a semantic no-op. §11 lists resource records, creation/update, mutation results and no-op detection among the surfaces a Type amendment must reconcile. | PR102: open metadata is Preview 2 mandatory and NYI; "a semantic no-op retains the revision". PR84 staged `--replace-properties`/`--replace-metadata` with shallow-merge defaults. BDP PR64 drafts the normative metadata amendment across the spec, both schema copies, fixtures and catalog rows. | PR64 and a later Type amendment edit the same spec sections, schema bundle, fixtures and catalog. PR64 lands first; the Type amendment rebases over it. Neither defines Type affiliation members by association. PR64's no-op rule and T44 agree today; T38 (an affiliation-only change is new state) must be preserved when affiliation changes exist. | PR64 owner, Trish, Janet for sequencing |
| F6 Tokens versus Type version addressing | §2: SemVer labels, opaque resource revisions, concurrency guards and exact historical addresses must not be conflated. D03: no invented revision-to-version conversion. | PR102: opaque `revision` on records, `version` on retained rows, store-local `local_revision`, `--version TOKEN`; History `view=versions` not served by the Beads listener. | No CLI token may become a Type definition version discriminator. A Type Bead's retained versions would list through `bd versions` like any Bead, but that listing is neither D03's exact definition address nor a family label. | D03 open; no CLI action |
| F7 Workspace format generation and old clients | T17: open existing four/six-Type stores with an old client; no read-time installation or silent identity rewrite; separately specified storage/client transition. D07, D12 old-client behavior. | PR102: `.beads/graph-preview-format` records `link-preview-v5`/`v6`; an older bd refuses a newer workspace; reads do not install the example Types; "unsupported Type installation" refusal. | The generation marker is today's realization of T17's transition rule. Any Type installation feature changes the generation story and refusal messages. Release notes must not describe a generation bump as Type lifecycle. | Beads/Janet |
| F8 Ownership from the installed descriptor | §6: ownership declarations are part of the contract. T19–T21: adoption that changes ownership or bounds needs explicit rules. D06, D07: partial installation grants no admission. | PR102: ownership comes from the installed Type descriptor; Issue Type owns blocking Dependencies, Memory Type owns informational Links; `--if-source-revision`. Staged fork `5f81ebfd`: uninstalled Issue dependency types are refused at the writer boundary. | Consistent. Versioned adoption that changes ownership is NYI. The writer-boundary refusal realizes "an uninstalled Type fails before a write" and agrees with D07's no-admission rule. | No action |
| F9 Withdrawn runtime tracker | Decision packet and #59 body cite beads#7403 as the runtime architecture tracker under which Vickie's Type-first questions were deferred following the Rust client/CLI/packs direction. | beads#7403 was opened October 8 20:22Z and closed "Withdrawn by its author" at 22:46Z, after Trish's 21:40Z handoff. | The deferral stands as the handoff and #59 state it. The cited tracker is closed and no replacement tracker was found, so the #59 and packet references point at a withdrawn issue. No release gate depends on it. | Trish for the #59 reference; Donna only if the deferral basis should change |
| F10 Type discovery and visibility | D12: version discovery. D01/D09, T46 and council F7: definition visibility is open; do not automatically grant every instance reader access to all definition content. | PR102 `bd types [--details]`: lists installed IDs or complete persisted descriptors to any workspace reader; "Type mutation commands are outside this contract". | Preview 2 `bd types --details` discloses whole descriptors. The versioned model's visibility and version discovery are open. Present `bd types` as the current fixed-catalog inventory, not the versioned discovery contract. | No action now |
| F11 Deletion and retention | D09: deactivation, catalog visibility and purge are distinct. §7: a generic Type Bead delete cannot ignore intrinsic affiliations or dependent Types; the retention baseline remains in force. T12/T13/T25. | PR102 `bd delete`: incident-Link refusal, reserved ID, retained snapshots, no deletion version; "does not invent deletion for a future Type until its descriptor and writer exist". | Consistent. Because a Type is a Bead under this model, a future delete of a Type Bead cannot rely on the incident-Link rule alone, since affiliation is not an incident Link. Keep Type Bead deletion outside the Preview 2 `bd delete` contract. | D09; CLI wording stays |
| F12 Work outside the tracked revision | PR60 commits after `a286110` add packaging/registry source notes and provenance research; #59 October 9 and 11 comments carry a provenance-on-resource-versions proposal. | Those documents touch resource versions, attribution and Type distribution. | Not part of the tracked revision or this seam record. If any of them enters the Monday candidate or a CLI contract, it needs its own tracking row and revision pin. | Trish |

## 5. Boundaries of this record

- No Type implementation, no feature staging, no edits to CLI PR102, the
  manual playgrounds, shared databases or any runtime, and no tests were run.
- BDP owns the shared model and protocol; Beads owns CLI spellings, storage and
  operator realization, per the README authority boundary. Nothing here moves
  that boundary or settles a D01–D12 decision.
- This file lives in `docs/design/` and is non-normative. The canonical
  specification remains `docs/specs/bdp.md`.
- The #7170 staging paragraph still names `76fde9c9`; refreshing it to the
  current staged head belongs to the release lane after its qualification
  evidence is recorded, not to this record.

## 6. Next steps in the release lane

1. When Trish names the frozen candidate revision on #59, Janet posts the
   exact frozen-candidate acknowledgment there against that revision and the
   exact PR102 head of that day. If `a286110` is named, the digests in
   section 1 identify it.
2. Refresh the PR102 ledger (pinned integration commit, selector spellings
   after PR84, current-build statements) in the CLI lane; it is separate from
   this record and from the Type document.
3. Keep F1, F2, F5 and F10 on the reconciliation list for the #7170 gate that
   reconciles the final CLI specification with the Type specification.

## 7. Verification

Checks performed on October 11: `git show`/`git diff` and SHA-256 of the three
core documents at `a286110` against the PR60 head; GitHub compare of the two
Beads heads against their pinned commits; targeted wording check of the
versioned-beads technical reference at `e1952497`; PR, issue and branch state
reads for PR60, PR64, PR84, PR102, #59, #7170 and beads#7403. No build, test,
runtime, playground or conformance observation was made.
