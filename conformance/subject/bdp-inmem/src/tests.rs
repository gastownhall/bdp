//! In-crate tests for the in-memory backend. No external deps — every test builds a fresh
//! `InMemScope` and runs instantly. Mirrors the pg suite (same behaviors), plus in-mem-specific
//! cases: full-history time-travel, per-scope volatility, and the Ephemeral storage class.

use super::*;

fn body(kind: &str, props: &str) -> CreateBody {
    CreateBody {
        kind: Kind(kind.into()),
        r#type: ResourceId::head(Scope::Named(ScopeName("types".into())), Id(kind.into())),
        properties: RawJson(Bytes::from(props.to_string())),
        metadata: RawJson::default(),
    }
}

fn scope() -> InMemScope {
    InMemScope::new(format!("test-{}", Uuid::new_v4()))
}

fn ids(v: Vec<ResourceId>) -> Vec<String> {
    v.iter().map(|r| r.id.0.to_string()).collect()
}

#[tokio::test]
async fn put_get_roundtrip() {
    let s = scope();
    let id = Id("t1".into());
    let w = s.put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"status":"open"}"#), Guards::default()).await.unwrap();
    assert!(w.value.is_some() && !w.not_implemented);
    assert!(w.value.unwrap().rev.is_some(), "write returns a pinned ref (minted rev)");
    let got = s.get(&ResourceId::head(Scope::This, id.clone()), None).await.unwrap();
    match got.value.unwrap() {
        Representation::Bead { kind, properties, .. } => {
            assert_eq!(kind.0.as_ref(), "Task");
            assert!(String::from_utf8_lossy(&properties.0).contains("open"));
        }
        _ => panic!("expected a bead"),
    }
}

#[tokio::test]
async fn create_allocates_id_then_resolves() {
    let s = scope();
    let w = s.create(None, body("Task", "{}")).await.unwrap();
    let reference = w.value.unwrap();
    assert!(!reference.id.0.is_empty(), "server allocated a non-empty id");
    let got = s.get(&ResourceId::head(Scope::This, reference.id.clone()), None).await.unwrap();
    assert!(matches!(got.value, Some(Representation::Bead { .. })));
}

#[tokio::test]
async fn create_existing_id_is_already_exists() {
    let s = scope();
    let id = Id("dup".into());
    s.create(Some(id.clone()), body("Task", "{}")).await.unwrap();
    let again = s.create(Some(id.clone()), body("Task", "{}")).await;
    assert!(matches!(again, Err(BdpError::AlreadyExists(_))), "re-create same id -> AlreadyExists; got {again:?}");
}

#[tokio::test]
async fn delete_then_erased() {
    let s = scope();
    let id = Id("d1".into());
    s.put(ResourceId::head(Scope::This, id.clone()), body("Task", "{}"), Guards::default()).await.unwrap();
    s.delete(ResourceId::head(Scope::This, id.clone()), None).await.unwrap();
    let got = s.get(&ResourceId::head(Scope::This, id.clone()), None).await;
    assert!(matches!(got, Err(BdpError::Erased { .. })), "got {got:?}");
}

/// RE-DERIVED. This test was named `put_after_delete_revives_as_create` and asserted that a `put`
/// over a tombstone starts a fresh lifecycle. That is what the spec now forbids: this scope declares
/// `idModel: permanent`, under which a retired id is spent and a bare `put` TARGETS the retired
/// resource, faulting `410 Gone`.
///
/// The test was not merely stale — it PINNED the defect, so the subject could not be corrected
/// without it going red. That is the useful kind of failure: a test asserting the old rule is how you
/// find out the rule changed. Re-derived rather than deleted, because the scenario it exercises
/// (delete, then write to the same id) is exactly the one worth keeping.
#[tokio::test]
async fn put_over_a_tombstone_is_terminal_not_a_revival() {
    let s = scope();
    let id = Id("rev1".into());
    s.put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"n":1}"#), Guards::default()).await.unwrap();
    s.delete(ResourceId::head(Scope::This, id.clone()), None).await.unwrap();

    // A bare put at a retired target: 410, and it must mint nothing.
    let revived = s
        .put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"n":2}"#), Guards::default())
        .await;
    assert!(
        matches!(revived, Err(BdpError::Erased { .. })),
        "a bare put over a tombstone must fault Erased (410) under `permanent`, not revive the id; got {revived:?}"
    );

    // And the resource stays retired — a fault that still wrote would be the worse failure.
    let got = s.get(&ResourceId::head(Scope::This, id.clone()), None).await;
    assert!(
        matches!(got, Err(BdpError::Erased { .. })),
        "the id must remain retired after the refused put; got {got:?}"
    );
}

#[tokio::test]
async fn resolve_batch_present_absent_erased() {
    let s = scope();
    let present = Id("r-present".into());
    let erased = Id("r-erased".into());
    s.put(ResourceId::head(Scope::This, present.clone()), body("Task", r#"{"status":"open"}"#), Guards::default()).await.unwrap();
    s.put(ResourceId::head(Scope::This, erased.clone()), body("Task", "{}"), Guards::default()).await.unwrap();
    s.delete(ResourceId::head(Scope::This, erased.clone()), None).await.unwrap();
    let refs = vec![
        ResourceId::head(Scope::This, present.clone()),
        ResourceId::head(Scope::This, Id("r-missing".into())),
        ResourceId::head(Scope::This, erased.clone()),
    ];
    let v = s.resolve(&refs, None).await.unwrap().value.unwrap();
    assert_eq!(v.len(), 3);
    assert!(matches!(v[0], ResolvedRepresentation::Present(Representation::Bead { .. })), "present; got {:?}", v[0]);
    assert!(matches!(v[1], ResolvedRepresentation::Absent), "absent; got {:?}", v[1]);
    assert!(matches!(v[2], ResolvedRepresentation::Erased(_)), "erased; got {:?}", v[2]);
}

#[tokio::test]
async fn apply_is_atomic_and_rolls_back() {
    let s = scope();
    let good = Id("a-good".into());
    let dup = Id("a-dup".into());
    s.put(ResourceId::head(Scope::This, dup.clone()), body("Task", "{}"), Guards::default()).await.unwrap();
    // a write-set whose SECOND write fails (create of an existing id) must leave the first unwritten
    let writes = vec![
        Write::Put { target: ResourceId::head(Scope::This, good.clone()), body: body("Task", "{}"), guards: Guards::default() },
        Write::Create { id: Some(dup.clone()), body: body("Task", "{}") },
    ];
    let r = s.apply(&writes).await;
    assert!(r.is_err(), "apply should fail on the duplicate create");
    let got = s.get(&ResourceId::head(Scope::This, good.clone()), None).await;
    assert!(matches!(got, Err(BdpError::NotFound(_))), "rolled back; got {got:?}");
    // the changefeed must not carry the rolled-back write either
    let ch = s.changes(Page::default(), None, None).await.unwrap().value.unwrap();
    assert_eq!(ch.len(), 1, "only the pre-existing dup put is in the log; the failed apply left nothing");
}

#[tokio::test]
async fn apply_multi_write_commits_together() {
    let s = scope();
    let writes = vec![
        Write::Create { id: Some(Id("m1".into())), body: body("Task", r#"{"n":1}"#) },
        Write::Create { id: Some(Id("m2".into())), body: body("Note", r#"{"n":2}"#) },
    ];
    let refs = s.apply(&writes).await.unwrap().value.unwrap();
    assert_eq!(refs.len(), 2);
    assert!(refs.iter().all(|r| r.rev.is_some()));
    assert_eq!(s.list(&ListFilter::default(), Page::default()).await.unwrap().value.unwrap().len(), 2);
}

#[tokio::test]
async fn patch_applies_delta_bumps_rev_keeps_kind() {
    let s = scope();
    let id = Id("p1".into());
    let r0 = s.put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"status":"open","n":1}"#), Guards::default()).await.unwrap().value.unwrap();
    let rev0 = r0.rev.clone().unwrap();
    let patch = JsonPatch(RawJson(Bytes::from(
        r#"[{"op":"replace","path":"/body/status","value":"closed"},{"op":"add","path":"/body/assignee","value":"ada"}]"#.as_bytes().to_vec(),
    )));
    let r1 = s.patch(ResourceId::head(Scope::This, id.clone()), patch, None).await.unwrap().value.unwrap();
    assert_ne!(r1.rev.unwrap().0.as_ref(), rev0.0.as_ref(), "patch mints a new rev");
    match s.get(&ResourceId::head(Scope::This, id.clone()), None).await.unwrap().value.unwrap() {
        Representation::Bead { kind, properties, .. } => {
            assert_eq!(kind.0.as_ref(), "Task", "kind carries over");
            let p = String::from_utf8_lossy(&properties.0);
            assert!(p.contains("closed") && p.contains("ada") && p.contains(r#""n""#), "delta applied, untouched field kept: {p}");
        }
        _ => panic!("expected a bead"),
    }
}

#[tokio::test]
async fn patch_if_rev_guards() {
    let s = scope();
    let id = Id("p2".into());
    s.put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"n":1}"#), Guards::default()).await.unwrap();
    let patch = JsonPatch(RawJson(Bytes::from(r#"[{"op":"replace","path":"/body/n","value":2}]"#.as_bytes().to_vec())));
    let r = s.patch(ResourceId::head(Scope::This, id.clone()), patch, Some(Rev("stale-rev".into()))).await;
    assert!(matches!(r, Err(BdpError::RevisionMismatch { .. })), "stale if_rev must be rejected; got {r:?}");
}

#[tokio::test]
async fn patch_missing_is_not_found() {
    let s = scope();
    let patch = JsonPatch(RawJson(Bytes::from(r#"[{"op":"add","path":"/body/x","value":1}]"#.as_bytes().to_vec())));
    let r = s.patch(ResourceId::head(Scope::This, Id("ghost".into())), patch, None).await;
    assert!(matches!(r, Err(BdpError::NotFound(_))), "patch of a never-created id -> NotFound; got {r:?}");
}

#[tokio::test]
async fn delete_if_rev_guards() {
    let s = scope();
    let id = Id("d2".into());
    s.put(ResourceId::head(Scope::This, id.clone()), body("Task", "{}"), Guards::default()).await.unwrap();
    let r = s.delete(ResourceId::head(Scope::This, id.clone()), Some(Rev("stale".into()))).await;
    assert!(matches!(r, Err(BdpError::RevisionMismatch { .. })), "stale if_rev on delete rejected; got {r:?}");
}

// --- in-mem showcase: full history in RAM => pinned-rev get is time-travel ---

#[tokio::test]
async fn pinned_rev_get_is_time_travel() {
    let s = scope();
    let id = Id("tt".into());
    let r0 = s.put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"n":1}"#), Guards::default()).await.unwrap().value.unwrap();
    let rev0 = r0.rev.clone().unwrap();
    s.put(ResourceId::head(Scope::This, id.clone()), body("Task", r#"{"n":2}"#), Guards::default()).await.unwrap();
    // head reads the latest
    let head = s.get(&ResourceId::head(Scope::This, id.clone()), None).await.unwrap().value.unwrap();
    match head { Representation::Bead { properties, .. } => assert!(String::from_utf8_lossy(&properties.0).contains("2")), _ => panic!() }
    // pinned to rev0 reads the OLD state
    let old = s.get(&ResourceId::pinned(Scope::This, id.clone(), rev0), None).await.unwrap().value.unwrap();
    match old { Representation::Bead { properties, .. } => assert!(String::from_utf8_lossy(&properties.0).contains('1') && !String::from_utf8_lossy(&properties.0).contains('2')), _ => panic!() }
}

#[tokio::test]
async fn volatility_fresh_scope_is_empty_and_scopes_isolate() {
    let s1 = InMemScope::new("alpha");
    s1.put(ResourceId::head(Scope::This, Id("x".into())), body("Task", "{}"), Guards::default()).await.unwrap();
    assert_eq!(s1.list(&ListFilter::default(), Page::default()).await.unwrap().value.unwrap().len(), 1);
    // a separate scope (= a separate RAM store) sees nothing — ephemeral, local, isolated
    let s2 = InMemScope::new("beta");
    assert!(s2.list(&ListFilter::default(), Page::default()).await.unwrap().value.unwrap().is_empty());
    assert!(matches!(s2.get(&ResourceId::head(Scope::This, Id("x".into())), None).await, Err(BdpError::NotFound(_))));
}

#[tokio::test]
async fn storage_class_is_ephemeral() {
    let s = scope();
    assert_eq!(s.storage_class(), StorageClass::Ephemeral, "the in-memory scope advertises EPHEMERAL to discovery (Lydia §78)");
}

// --- list: flat-filter discovery over current state ---

#[tokio::test]
async fn list_empty_and_compare() {
    let s = scope();
    s.put(ResourceId::head(Scope::This, Id("a".into())), body("Task", r#"{"status":"open"}"#), Guards::default()).await.unwrap();
    s.put(ResourceId::head(Scope::This, Id("b".into())), body("Task", r#"{"status":"closed"}"#), Guards::default()).await.unwrap();
    s.put(ResourceId::head(Scope::This, Id("c".into())), body("Task", r#"{"status":"open"}"#), Guards::default()).await.unwrap();
    let all = s.list(&ListFilter::default(), Page::default()).await.unwrap().value.unwrap();
    assert_eq!(all.len(), 3);
    assert!(all.iter().all(|r| r.rev.is_some()), "list returns pinned refs");
    let f = ListFilter(vec![ListCondition::Compare {
        field: FieldPath(vec!["body".into(), "status".into()]),
        op: CompareOp::Eq,
        value: RawJson(Bytes::from(r#""open""#.to_string())),
    }]);
    assert_eq!(ids(s.list(&f, Page::default()).await.unwrap().value.unwrap()), vec!["a".to_string(), "c".to_string()]);
}

#[tokio::test]
async fn list_excludes_deleted_and_shows_latest() {
    let s = scope();
    s.put(ResourceId::head(Scope::This, Id("a".into())), body("Task", r#"{"status":"open"}"#), Guards::default()).await.unwrap();
    s.put(ResourceId::head(Scope::This, Id("a".into())), body("Task", r#"{"status":"closed"}"#), Guards::default()).await.unwrap(); // update
    s.put(ResourceId::head(Scope::This, Id("b".into())), body("Task", "{}"), Guards::default()).await.unwrap();
    s.delete(ResourceId::head(Scope::This, Id("b".into())), None).await.unwrap(); // tombstoned
    let open = ListFilter(vec![ListCondition::Compare {
        field: FieldPath(vec!["body".into(), "status".into()]),
        op: CompareOp::Eq,
        value: RawJson(Bytes::from(r#""closed""#.to_string())),
    }]);
    // a's latest is closed (matches); b is deleted (excluded)
    assert_eq!(ids(s.list(&open, Page::default()).await.unwrap().value.unwrap()), vec!["a".to_string()]);
    assert_eq!(ids(s.list(&ListFilter::default(), Page::default()).await.unwrap().value.unwrap()), vec!["a".to_string()]);
}

#[tokio::test]
async fn list_has_missing_matches_type_limit() {
    let s = scope();
    s.put(ResourceId::head(Scope::This, Id("x".into())), body("Task", r#"{"assignee":"kai","title":"Fix the Login"}"#), Guards::default()).await.unwrap();
    s.put(ResourceId::head(Scope::This, Id("y".into())), body("Bug", "{}"), Guards::default()).await.unwrap();
    let has = ListFilter(vec![ListCondition::Has { field: FieldPath(vec!["body".into(), "assignee".into()]) }]);
    assert_eq!(ids(s.list(&has, Page::default()).await.unwrap().value.unwrap()), vec!["x".to_string()]);
    let missing = ListFilter(vec![ListCondition::Missing { field: FieldPath(vec!["body".into(), "assignee".into()]) }]);
    assert_eq!(ids(s.list(&missing, Page::default()).await.unwrap().value.unwrap()), vec!["y".to_string()]);
    let is_bug = ListFilter(vec![ListCondition::IsType { r#type: RelativeId("Bug".into()), exact: false }]);
    assert_eq!(ids(s.list(&is_bug, Page::default()).await.unwrap().value.unwrap()), vec!["y".to_string()]);
    // case-insensitive substring match
    let m = ListFilter(vec![ListCondition::Matches {
        field: FieldPath(vec!["body".into(), "title".into()]),
        pattern: "login".into(),
        using: MatchKind::Substring,
    }]);
    assert_eq!(ids(s.list(&m, Page::default()).await.unwrap().value.unwrap()), vec!["x".to_string()]);
    let limited = s.list(&ListFilter::default(), Page { limit: Some(1), ..Default::default() }).await.unwrap().value.unwrap();
    assert_eq!(limited.len(), 1);
}

#[tokio::test]
async fn istype_subtype_prefix() {
    let s = scope();
    let n = 600usize;
    let mut writes = Vec::with_capacity(n);
    for i in 0..n {
        let kind = if i % 2 == 0 { "bead/issue/bug" } else { "bead/task" };
        writes.push(Write::Put { target: ResourceId::head(Scope::This, Id(format!("k{i}").into())), body: body(kind, "{}"), guards: Guards::default() });
    }
    s.apply(&writes).await.unwrap();
    let sub = ListFilter(vec![ListCondition::IsType { r#type: RelativeId("bead/issue".into()), exact: false }]);
    assert_eq!(s.list(&sub, Page::default()).await.unwrap().value.unwrap().len(), n / 2, "subtype prefix matched every bead/issue/*");
    let leaf = ListFilter(vec![ListCondition::IsType { r#type: RelativeId("bead/issue/bug".into()), exact: true }]);
    assert_eq!(s.list(&leaf, Page::default()).await.unwrap().value.unwrap().len(), n / 2, "exact leaf");
    let interior = ListFilter(vec![ListCondition::IsType { r#type: RelativeId("bead/issue".into()), exact: true }]);
    assert_eq!(s.list(&interior, Page::default()).await.unwrap().value.unwrap().len(), 0, "exact interior matches no stored bead");
}

/// A condition kind outside the advertised set is `InvalidParameter`, NOT `LimitExceeded`.
///
/// The old name and assertion said `limit-exceeded`, on the reading that an advertised condition
/// SET is a bound you can exceed. D.8's membership test (core.lumen:2103-2106) admits 422 "IFF
/// shrinking the request fixes it", and no shorter filter satisfies an unsupported kind — dropping
/// the condition is not shrinking it. `list` also declares only `[400]`, so the old status had no
/// declared row at all.
#[tokio::test]
async fn list_unadvertised_condition_is_invalid_parameter() {
    let s = scope();
    s.put(ResourceId::head(Scope::This, Id("a".into())), body("Task", r#"{"tags":["x"]}"#), Guards::default()).await.unwrap();
    // in-mem advertises Compare/Matches/Has/Missing/IsType — NOT Contains.
    let filter = ListFilter(vec![ListCondition::Contains {
        field: FieldPath(vec!["body".into(), "tags".into()]),
        value: RawJson(Bytes::from(b"\"x\"".to_vec())),
    }]);
    match s.list(&filter, Page::default()).await {
        Err(BdpError::InvalidParameter { capability, .. }) => assert_eq!(
            capability, "list.conditions",
            "the refusal must name the discovery field a client can read to predict it"
        ),
        other => panic!("unadvertised condition kind -> InvalidParameter; got {other:?}"),
    }
    // AND THE ADVERTISED KINDS STILL WORK. Without this the assertion above passes for a `list`
    // that refuses every filter, which is the failure the single-arm version could not see.
    let ok = ListFilter(vec![ListCondition::Has { field: FieldPath(vec!["body".into(), "tags".into()]) }]);
    assert_eq!(
        s.list(&ok, Page::default()).await.unwrap().value.unwrap().len(),
        1,
        "an ADVERTISED condition kind must still match"
    );
}

// --- changes: the changefeed (the append-log tailed by a cursor) ---

#[tokio::test]
async fn changes_reads_the_append_log() {
    let s = scope();
    s.put(ResourceId::head(Scope::This, Id("x".into())), body("Task", r#"{"n":1}"#), Guards::default()).await.unwrap(); // create
    s.put(ResourceId::head(Scope::This, Id("x".into())), body("Task", r#"{"n":2}"#), Guards::default()).await.unwrap(); // update
    s.put(ResourceId::head(Scope::This, Id("y".into())), body("Task", "{}"), Guards::default()).await.unwrap(); // create
    s.delete(ResourceId::head(Scope::This, Id("y".into())), None).await.unwrap(); // delete

    let res = s.changes(Page::default(), None, None).await.unwrap();
    let events = res.value.unwrap();
    assert_eq!(events.len(), 4);
    let ops: Vec<ChangeOp> = events.iter().map(|e| e.op).collect();
    assert_eq!(ops, vec![ChangeOp::Create, ChangeOp::Update, ChangeOp::Create, ChangeOp::Delete]);
    assert!(matches!(events[0].content, Some(ChangeContent::Full { .. })), "create carries a full post-image");
    let del = events.last().unwrap();
    assert!(del.content.is_none() && del.provenance.is_some(), "delete carries top-level provenance, no body");
    assert!(res.protocol.cursor.is_some() && res.protocol.head == Some(true));
    // resuming after the cursor yields nothing new
    let resumed = s.changes(Page { after: res.protocol.cursor.clone(), ..Default::default() }, None, None).await.unwrap();
    assert!(resumed.value.unwrap().is_empty());
    assert_eq!(resumed.protocol.head, Some(true));
}

#[tokio::test]
async fn changes_paging_cursor_and_head() {
    let s = scope();
    for i in 0..5 {
        s.put(ResourceId::head(Scope::This, Id(format!("n{i}").into())), body("Task", "{}"), Guards::default()).await.unwrap();
    }
    // first page of 2: not caught up (head=false)
    let p1 = s.changes(Page { limit: Some(2), ..Default::default() }, None, None).await.unwrap();
    assert_eq!(p1.value.unwrap().len(), 2);
    assert_eq!(p1.protocol.head, Some(false), "more pending -> not at head");
    // resume
    let p2 = s.changes(Page { after: p1.protocol.cursor.clone(), limit: Some(10), ..Default::default() }, None, None).await.unwrap();
    assert_eq!(p2.value.unwrap().len(), 3);
    assert_eq!(p2.protocol.head, Some(true), "drained -> at head");
    // `from` an ordinal (inclusive)
    let fromq = s.changes(Page { from: Some(Ordinal(4)), ..Default::default() }, None, None).await.unwrap();
    assert_eq!(fromq.value.unwrap().len(), 2, "ordinals 4 and 5");
}

// --- export / import ---

#[tokio::test]
async fn export_import_roundtrip_set_current() {
    let a = scope();
    a.put(ResourceId::head(Scope::This, Id("x".into())), body("Task", r#"{"status":"open"}"#), Guards::default()).await.unwrap();
    a.put(ResourceId::head(Scope::This, Id("y".into())), body("Note", r#"{"text":"hi"}"#), Guards::default()).await.unwrap();

    let exp = a.export(&ListFilter::default(), None, false, Page::default()).await.unwrap().value.unwrap();
    assert!(matches!(exp.first(), Some(ExportRecord::Begin(_))), "starts with Begin");
    assert!(matches!(exp.last(), Some(ExportRecord::End(ExportEnd { count })) if *count == 2), "ends with End(2)");
    assert_eq!(exp.iter().filter(|r| matches!(r, ExportRecord::Record(_))).count(), 2);

    let b = scope();
    let rep = b.import(&exp, ImportStrategy::SetCurrent).await.unwrap();
    assert!(rep.value.is_some() && !rep.not_implemented, "import reported");
    assert_eq!(b.list(&ListFilter::default(), Page::default()).await.unwrap().value.unwrap().len(), 2, "both beads imported");
    match b.get(&ResourceId::head(Scope::This, Id("x".into())), None).await.unwrap().value.unwrap() {
        Representation::Bead { kind, properties, .. } => {
            assert_eq!(kind.0.as_ref(), "Task", "kind survived the round-trip");
            assert!(String::from_utf8_lossy(&properties.0).contains("open"), "properties survived");
        }
        _ => panic!("expected a bead"),
    }
}

#[tokio::test]
async fn export_revisions_includes_history() {
    let s = scope();
    let id = ResourceId::head(Scope::This, Id("h".into()));
    s.put(id.clone(), body("Task", r#"{"n":1}"#), Guards::default()).await.unwrap();
    s.put(id.clone(), body("Task", r#"{"n":2}"#), Guards::default()).await.unwrap();
    let cur = s.export(&ListFilter::default(), None, false, Page::default()).await.unwrap().value.unwrap();
    assert_eq!(cur.iter().filter(|r| matches!(r, ExportRecord::Record(_))).count(), 1, "current-state: one record");
    let hist = s.export(&ListFilter::default(), None, true, Page::default()).await.unwrap().value.unwrap();
    let recs: Vec<String> = hist.iter().filter_map(|r| if let ExportRecord::Record(Representation::Bead { properties, .. }) = r {
        Some(String::from_utf8_lossy(&properties.0).into_owned())
    } else { None }).collect();
    assert_eq!(recs.len(), 2, "both revisions exported");
    assert!(recs[0].contains("\"n\":1") || recs[0].contains("\"n\": 1"), "oldest first: {recs:?}");
}

#[tokio::test]
async fn honest_unadvertised_ops_are_not_implemented() {
    let s = scope();
    // ops this backend doesn't implement answer not_implemented (advertised ⟹ implemented).
    assert!(s.evaluate(Expr::BdpText("anything")).await.unwrap().not_implemented);
    assert!(s.resolve_alias("some-name").await.unwrap().not_implemented);

    // `pull` LEFT THIS LIST, and the test is where that transition shows. It used to assert
    // `pull -> not_implemented`; this scope now advertises `PrimitiveCapabilities::Pull` and
    // implements it, so the SAME line would now be asserting that an advertised op is absent —
    // the exact breach the `advertised ⟹ implemented` rule in the comment above forbids.
    //
    // So the assertion flips rather than disappearing: pull against a channel that does not exist
    // must be a real fault, NOT the not-implemented signal. Deleting the line would have left the
    // op untested from this direction, and a scope that regressed to `not_implemented` would then
    // pass both halves of the suite.
    match s.pull(&ResourceId::head(Scope::This, Id("ch-absent".into())), Page::default(), None, None).await {
        Err(BdpError::NotFound(_)) => {}
        Ok(r) if r.not_implemented => {
            panic!("pull is advertised now, so `not_implemented` is a breach, not an answer")
        }
        other => panic!("expected NotFound pulling a channel that does not exist, got {other:?}"),
    }
}

/// AN UNADVERTISED MODE OF A PRESENT OP IS NOT AN ABSENT OP, and this test exists because the one
/// above used to conflate them.
///
/// It asserted `import(HistoryRestore) -> not_implemented` under the title "unadvertised OPS are
/// not_implemented". But `import` is advertised and implemented; what is advertised false is one
/// FIELD of its limit record, `ImportCaps { history_restore: false }`.
///
/// THE OP/MODE DISTINCTION IS THE POINT AND IT SURVIVES; only the status moved. `not_implemented`
/// (501) means the scope cannot import at all; a 400 `invalid-parameter` naming
/// `import.historyRestore` means it imports and declines exactly one mode, and names which so the
/// caller can read it from discovery instead of guessing.
///
/// IT WAS 422 UNTIL THE RC3 FAULT-VOCABULARY PASS, and this doc used to carry the citation that
/// justified it: `CoreCapabilities` (core.lumen:1646), "the matching `limit-exceeded` (422) is the
/// enforce side". `historyRestore` is a bool, and D.8:2103-2106 admits 422 only "IFF shrinking the
/// request fixes it" — no smaller stream imports under a flag that is off. See the note at the
/// producer in `bdp-inmem/src/lib.rs` for the four normative lines against that parenthetical.
#[tokio::test]
async fn an_unadvertised_import_mode_is_invalid_parameter_not_unimplemented() {
    let s = scope();
    match s.import(&[], ImportStrategy::HistoryRestore).await {
        Err(BdpError::InvalidParameter { capability, .. }) => assert_eq!(
            capability, "import.historyRestore",
            "the refusal must name the op AND the field of its limit record"
        ),
        Ok(r) if r.not_implemented => panic!(
            "history-restore answered not_implemented; `import` IS advertised and implemented, so \
             501 tells a client the scope cannot import at all"
        ),
        other => panic!("expected InvalidParameter for an unadvertised import mode, got {other:?}"),
    }
    // THE OP ITSELF STILL WORKS, which is the half that makes the distinction observable: a scope
    // that refused every import would satisfy the match above.
    let framed = [
        ExportRecord::Begin(ExportBegin { cursor: Cursor(bytes::Bytes::from_static(b"c0")) }),
        ExportRecord::End(ExportEnd { count: 0 }),
    ];
    let ok = s.import(&framed, ImportStrategy::SetCurrent).await.expect("set-current import");
    assert!(!ok.not_implemented, "set-current import must work on a scope that advertises import");
}
