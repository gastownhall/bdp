//! The tier-1 conformance gate — wire-level cases over the in-memory reference.
//!
//! Each case drives a `RemoteScope` against a `Server(InMemScope)` over real loopback HTTP and, on
//! success, reports the surface rows (`SurfaceId`) it covers. The harness runs every case against one
//! server, unions the covered rows, and compares against the pinned denominator (`bdp_gate::denominator`).
//!
//! Two independent signals:
//!   * A case that was expected to pass but FAILED always fails the gate — that is the gate catching a
//!     wire-level regression.
//!   * Uncovered denominator rows are reported and, under `BDP_GATE_STRICT=1`, fail the gate
//!     (fail-if-no-coverage). This is a FIRST increment: it covers the primitives the InMemScope
//!     reference implements plus the faults the typed client can trigger; the rest is reported
//!     uncovered with reasons and filled in follow-ups.

use std::collections::BTreeSet;
use std::future::Future;

use bdp_gate::{denominator, SurfaceId};
use bdp_inmem::InMemScope;
use bdp_primitives::{
    BdpError, BdpResult, BdpScope, CallMode, CallOutcome, CreateBody, CreateCaps, DeleteCaps, GetCaps,
    Guards, Id, IdModel, JsonPatch, Kind, PatchCaps, PrimitiveCapabilities, PutCaps, RawJson,
    Representation, ExportRecord, FieldPath, ListCondition, ListFilter, Page, PushEvent, PushResult,
    Request, ResourceId, Cursor,
    Rev, RevisionModel, Scope, ScopeCapabilities, Selector, StorageClass,
};
use bdp_protocol::http::{send, Outgoing};
use bdp_protocol::{RemoteScope, Server};
use bytes::Bytes;
use tokio::net::TcpListener;

// ---- helpers ----------------------------------------------------------------

fn note_body(text: &str) -> CreateBody {
    CreateBody {
        kind: Kind("note".into()),
        r#type: ResourceId::head(Scope::This, Id("BeadType:note".into())),
        properties: RawJson(Bytes::from(
            serde_json::to_vec(&serde_json::json!({ "text": text })).unwrap(),
        )),
        metadata: RawJson(Bytes::from_static(b"{}")),
    }
}

fn op(n: &str) -> SurfaceId {
    SurfaceId::Op(n.to_string())
}
fn fault(n: &str, s: u16) -> SurfaceId {
    SurfaceId::Fault(n.to_string(), s)
}

/// A well-formed resource id that the reference has never seen (plain id — a `:`-bearing id is
/// rejected at the wire as 400, which is a different fault than "well-formed but absent" → 404).
fn missing(id: &str) -> ResourceId {
    ResourceId::head(Scope::This, Id(id.into()))
}

/// Seed a resource with `put` and VERIFY the seed took. Every case whose assertion depends on a
/// pre-existing resource must go through this.
///
/// `not_implemented` is an `Ok` signal, so a bare `put(..).await?` "succeeds" against a subject with
/// no `put` at all, and the case then fails later with a misleading diagnostic — or, as
/// `delete+erased` once did, passes outright. A case must fail on its OWN terms, naming the breach,
/// rather than lean on a downstream error.
async fn seed(r: &RemoteScope, target: &ResourceId, text: &str) -> Result<(), String> {
    let res = r
        .put(target.clone(), note_body(text), Guards::default())
        .await
        .map_err(|e| format!("seed put transport: {e:?}"))?;
    if res.not_implemented {
        return Err(format!(
            "seed put advertised but not_implemented — the precondition for this case never ran \
             (target {:?})",
            target.id
        ));
    }
    Ok(())
}

async fn record<F>(name: &str, covered: &mut BTreeSet<SurfaceId>, failures: &mut Vec<String>, fut: F)
where
    F: Future<Output = Result<Vec<SurfaceId>, String>>,
{
    match fut.await {
        Ok(rows) => {
            for r in rows {
                covered.insert(r);
            }
        }
        Err(e) => failures.push(format!("{name}: {e}")),
    }
}

// ---- cases ------------------------------------------------------------------

/// EVERY PROBLEM CODE THE SUBJECT CAN EMIT MUST BE IN D.9's REGISTRY. Claims no row.
///
/// The third direction of one registry invariant, and the only one that looks at a PRODUCER:
/// #455 asked whether each registry entry has a status home (eleven had none); `e7db3df5` asked
/// whether each code named by a fault verb is registered (three were not); this asks what the
/// subject can actually put on the wire.
///
/// `code` is normative wire output — core.lumen:853 gives each registry entry a stable
/// problem-type URI `tag:bdp.dev,2026:problem/<code>` — so a code outside D.9 has no URI and a
/// client told to branch on it has nothing to branch against. **The near-misses are the dangerous
/// ones**: a client following the spec branches on `resource-not-found` and is handed `not-found`,
/// which does not match and is not obviously wrong when read.
///
/// EXHAUSTIVE BY EXECUTION, NOT BY READING. `BdpError` is a closed enum of thirteen variants and
/// `from_error` matches on it, so constructing every variant and calling it yields the complete
/// vocabulary. This is deliberately not a grep of `wire.rs`: reading the producer is how I built a
/// register for the capability case that missed two live divergences the running server showed.
async fn every_emittable_problem_code_is_registered(_host: &str) -> Result<Vec<SurfaceId>, String> {
    use bdp_primitives::{BdpError as E, ConstraintViolation as CV};
    let rid = || ResourceId::head(Scope::This, Id("probe".into()));
    let rev = || Rev("r1".into());
    let all: Vec<E> = vec![
        E::NotFound(rid()),
        E::Erased { id: rid(), at: rev() },
        E::AlreadyExists(rid()),
        E::RevisionMismatch { id: rid(), expected: rev(), found: Some(rev()) },
        E::Conflict(CV::Uniqueness { fromprop: "p".into(), to: rid() }),
        E::Conflict(CV::Cycle { family: "f".into(), from: rid(), to: rid() }),
        E::Conflict(CV::Cardinality { fromprop: "p".into(), detail: "d".into() }),
        E::Unprocessable("u".into()),
        E::LimitExceeded { capability: "c".into(), limit: "l".into(), detail: "d".into() },
        E::CursorExpired(Cursor(Bytes::from_static(b"c"))),
        E::ChannelNotPullable { channel: rid(), direction: "sink".into() },
        E::ChannelNotPushable { channel: rid(), direction: "source".into() },
        E::ChannelClosed { channel: rid() },
        E::AlreadySettled { id: rid() },
        E::Backend("b".into()),
    ];

    // Codes this subject emits that D.9 does not register. Registered so the gate is green on the
    // known set and red on a new one; the spec-side spelling is named where one exists, because
    // that is the repair, not a rename of the registry.
    // THREE ENTRIES LEFT THIS LIST BY BEING FIXED, not by being re-judged: `not-found`,
    // `erased` and `already-exists` were near-misses of D.9's `resource-not-found`,
    // `resource-erased` and `identity-taken`, and the subject now emits the canonical spellings.
    // D.9 is the registry and needed no ruling for that -- the same reasoning as bringing the
    // subject to the frozen wire. The staleness guard below is what told me: it failed naming all
    // three the moment the rename landed, which is the only reason this list is not now a false
    // claim about its own subject.
    const REGISTERED: &[(&str, &str)] = &[
        ("unprocessable", "not in D.9; the 422 bound case is `limit-exceeded`, so this is a second unregistered 422"),
        ("channel-not-pullable", "named in core.lumen pull but absent from D.9 — see #455; a covered gate row keys on this spelling"),
        ("channel-not-pushable", "named in core.lumen push but absent from D.9 — see #455; a covered gate row keys on this spelling"),
        ("channel-closed", "not in D.9 and not named anywhere in core.lumen"),
        ("already-settled", "not in D.9; cancel's declared 409 state conflict has no registered code"),
        ("backend", "not in D.9; a 500 code, and D.8 has no 5xx row beyond the 4xx/5xx catch-all"),
    ];

    let registry: BTreeSet<String> = bdp_gate::problem_codes().into_iter().collect();
    let known: BTreeSet<&str> = REGISTERED.iter().map(|(c, _)| *c).collect();
    let mut emitted: BTreeSet<String> = BTreeSet::new();
    for e in &all {
        let (_status, problem) = bdp_protocol::wire::WireProblem::from_error(e);
        // AND THE PROBLEM-TYPE URI, which nothing asserted until now. core.lumen:853: "`type` is a
        // stable, machine-readable problem-type URI identifier (`tag:bdp.dev,2026:problem/<code>`,
        // one per `code`), not a bare token. A `tag:` URI (RFC 4151) identifies without being
        // dereferenceable, which RFC 9457 §3.1.1 permits."
        //
        // This subject emitted `https://bdp.dev/problems/<code>` — a near-miss of the same kind as
        // the code spellings: an http(s) URI INVITES dereferencing a URL that does not exist, which
        // is the precise thing the `tag:` scheme is chosen to prevent. Changing it broke no test,
        // because no test looked, so the assertion lands with the fix.
        let want = format!("tag:bdp.dev,2026:problem/{}", problem.code);
        if problem.r#type != want {
            return Err(format!(
                "the Problem `type` for code `{}` is {:?}, not the spec's {:?} — a `tag:` URI \
                 identifies without being dereferenceable; an http(s) one invites a fetch of a URL \
                 that need not exist",
                problem.code, problem.r#type, want
            ));
        }
        emitted.insert(problem.code);
    }
    if emitted.len() < 10 {
        return Err(format!(
            "only {} distinct codes collected from {} constructed variants — the probe is not \
             exercising the producer and every check below passes vacuously: {emitted:?}",
            emitted.len(),
            all.len()
        ));
    }

    let unregistered: Vec<&String> = emitted
        .iter()
        .filter(|c| !registry.contains(c.as_str()) && !known.contains(c.as_str()))
        .collect();
    if !unregistered.is_empty() {
        return Err(format!(
            "problem code(s) this subject can emit that are absent from D.9's registry and not \
             registered in this case: {unregistered:?}. A code outside D.9 has no stable \
             problem-type URI, so a client cannot branch on it."
        ));
    }
    let fixed: Vec<&&str> = REGISTERED
        .iter()
        .map(|(c, _)| c)
        .filter(|c| registry.contains(**c) || !emitted.contains(&c.to_string()))
        .collect();
    if !fixed.is_empty() {
        return Err(format!(
            "this case registers emittable-but-unregistered code(s) that are now either REGISTERED \
             in D.9 or no longer emitted, so the register is a false claim — remove them: {fixed:?}"
        ));
    }
    // And the three that ARE conformant must stay so: if one of these ever leaves the registry or
    // stops being emitted, that is a regression this case should name.
    for good in ["cursor-expired", "revision-mismatch", "limit-exceeded"] {
        if !emitted.contains(good) {
            return Err(format!("`{good}` is no longer emitted by this subject at all"));
        }
        if !registry.contains(good) {
            return Err(format!("`{good}` has left D.9's registry"));
        }
    }
    Ok(Vec::new())
}


/// THE CAPABILITY SURFACE IS THE SPEC'S, OR IT IS NOT DISCOVERABLE. Claims no row — this is an
/// obligation, and the tier-1 gate counts faults, which is exactly why nothing here was ever seen.
///
/// core.lumen:1611 is normative and makes presence the SOLE criterion of support: "a primitive is
/// supported iff its capability is present". So the capability document is not metadata — it is
/// the only way a client learns what it may call. `Capabilities = { core, scope, packs? }`, `core`
/// is a RECORD keyed by primitive, and its eleven fields are closed (`call`/`cancel` advertise
/// under their own package per core.lumen:1570, hence eleven for thirteen).
///
/// WHY THIS IS AN ASSERT-PRESENT CHECK AND NOT AN IF-ADVERTISED ONE: a case shaped
/// `if advertised { require X }` loses its gate in SILENCE the day the advertisement moves, while
/// one asserting the shape is present fails loudly. The silent form is what let every divergence
/// below survive — the gate's own `call`/`cancel` cases read `r.capabilities()` through the trait,
/// which proxies whatever the wire happens to carry, so an unfiltered wire makes them pass and a
/// conformant one would make them SKIP. Five rows ride on that.
///
/// Registered rather than red, matching this suite's practice for a known gap, and guarded in both
/// directions: a NEW divergence fails, and a registered one that has been FIXED also fails, so the
/// register cannot rot into a description of a defect that no longer exists.
async fn the_capability_surface_is_the_specs_shape(host: &str) -> Result<Vec<SurfaceId>, String> {
    // What the spec says must be true, each paired with how this subject actually answers.
    const REGISTERED: &[&str] = &[
        "served at `/:capabilities`, not the spec's `/sys/capabilities` (core.lumen reserves `sys` for in-band system resources)",
        "the primitive member is named `primitives`, not `core`",
        "`primitives` is an ARRAY of single-key objects, not a RECORD keyed by primitive",
        "advertises `apply`, which core.lumen:1570 puts under its own package, not core",
        "advertises `call`, which core.lumen:1570 puts under its own package, not core",
        "advertises `cancel`, which core.lumen:1570 puts under its own package, not core",
        "advertises `resolve`, which is not a primitive at all and has no core capability field",
        "`revisions` is a CoreCapabilities field this scope does not advertise, though the operation works and this gate covers rows for it — core.lumen:1611 makes presence the sole criterion of support, so a conformant client must read it as unsupported",
        "`push` is a CoreCapabilities field this scope does not advertise, though the operation works and this gate covers rows for it — core.lumen:1611 makes presence the sole criterion of support, so a conformant client must read it as unsupported",
        "advertises `changes`, a RETIRED primitive — the changefeed was remapped onto `pull` (`/sys/changes` as a source Channel), and the advertisement outlived it",
    ];

    let mut found: Vec<String> = Vec::new();

    // The spec's path must serve the document. Asserted FIRST and positively: if `/sys/capabilities`
    // ever starts working, this register entry must go, and that is a fix we want to be told about.
    let sys = send(Outgoing {
        method: "GET",
        host,
        target: "/sys/capabilities",
        headers: Vec::new(),
        body: Vec::new(),
    })
    .await
    .map_err(|e| format!("raw /sys/capabilities: {e:?}"))?;
    if sys.status >= 400 {
        found.push(REGISTERED[0].to_string());
    }

    let resp = send(Outgoing {
        method: "GET",
        host,
        target: "/:capabilities",
        headers: Vec::new(),
        body: Vec::new(),
    })
    .await
    .map_err(|e| format!("raw /:capabilities: {e:?}"))?;
    let doc: serde_json::Value = serde_json::from_slice(&resp.body)
        .map_err(|e| format!("capabilities body is not JSON: {e}"))?;

    let core = doc.get("core");
    if core.is_none() {
        found.push(REGISTERED[1].to_string());
    }
    let member = core.or_else(|| doc.get("primitives"));
    let Some(member) = member else {
        return Err(format!("capabilities document has neither `core` nor `primitives`: {doc}"));
    };

    // Collect the advertised primitive names out of EITHER shape, so the key check runs even while
    // the shape is wrong — otherwise the shape divergence would mask every key divergence behind it.
    let mut keys: Vec<String> = Vec::new();
    if let Some(arr) = member.as_array() {
        found.push(REGISTERED[2].to_string());
        for entry in arr {
            if let Some(o) = entry.as_object() {
                keys.extend(o.keys().cloned());
            }
        }
    } else if let Some(o) = member.as_object() {
        keys.extend(o.keys().cloned());
    }

    let allowed = bdp_gate::core_capability_fields();

    // THE INVERSE DIRECTION, which this case did not have. Everything below asks "is every
    // advertised key allowed?" — which runs in the same direction as the spec's own closed list, so
    // the list guarantees it and only the other direction carries information. A peer's move:
    // **when an assertion runs in the same direction as the code's own filter, assert the
    // inverse.**
    //
    // The inverse here is not "every spec field must be advertised" — a scope legitimately omits
    // the capability for a primitive it does not offer. It is the Q1/Q2 interlock's other leg:
    // **an operation this gate COVERS must be advertised**, because core.lumen:1611 makes presence
    // the sole criterion of support ("a primitive is supported iff its capability is present").
    // An op that works and is unadvertised tells a conformant client it is unsupported.
    //
    // Found by self-starting this sweep rather than waiting for an instance to prompt it, which is
    // the thing neither I nor the peer had been doing: four sweeps today, none self-started.
    for op in ["get", "list", "pull", "create", "put", "patch", "delete", "revisions", "export", "import", "push"] {
        if !allowed.iter().any(|a| a == op) {
            continue; // not a core capability field; nothing to advertise it with
        }
        let covered_op = SurfaceId::Op(op.to_string());
        let _ = &covered_op;
        if !keys.iter().any(|k| k == op) {
            found.push(format!(
                "`{op}` is a CoreCapabilities field this scope does not advertise, though the operation works and this gate covers rows for it — core.lumen:1611 makes presence the sole criterion of support, so a conformant client must read it as unsupported"
            ));
        }
    }

    for k in &keys {
        if !allowed.iter().any(|a| a == k) {
            let entry = REGISTERED
                .iter()
                .find(|r| r.contains(&format!("`{k}`")))
                .map(|r| r.to_string())
                .unwrap_or_else(|| format!("advertises `{k}`, which is not a CoreCapabilities field"));
            found.push(entry);
        }
    }

    // Both directions.
    let mut unregistered: Vec<&String> =
        found.iter().filter(|f| !REGISTERED.contains(&f.as_str())).collect();
    unregistered.sort();
    if !unregistered.is_empty() {
        return Err(format!(
            "NEW capability-surface divergence(s) from the spec, not in this case's register:\n  - {}",
            unregistered.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n  - ")
        ));
    }
    let fixed: Vec<&&str> = REGISTERED.iter().filter(|r| !found.iter().any(|f| f == *r)).collect();
    if !fixed.is_empty() {
        return Err(format!(
            "this case still registers capability-surface divergence(s) that are now FIXED, so the \
             register has become a false claim — remove them:\n  - {}",
            fixed.iter().map(|s| **s).collect::<Vec<_>>().join("\n  - ")
        ));
    }
    Ok(Vec::new())
}


/// `create` (server-allocated id) then `get` the resource back. Covers op/create + op/get.
async fn create_then_get(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let created = r
        .create(None, note_body("hi"))
        .await
        .map_err(|e| format!("create transport: {e:?}"))?;
    if created.not_implemented {
        return Err("create advertised but not_implemented".into());
    }
    let id = created.value.ok_or("create: no id returned")?;
    let got = r.get(&id, None).await.map_err(|e| format!("get transport: {e:?}"))?;
    if got.not_implemented || got.value.is_none() {
        return Err("get: no representation for the just-created id".into());
    }
    Ok(vec![op("create"), op("get")])
}

/// `get` an id the reference never created → 404 NotFound. Covers op/get/fault/404.
async fn get_missing_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    match r.get(&missing("never-existed"), None).await {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("get", 404)]),
        other => Err(format!("expected NotFound (404), got {other:?}")),
    }
}

/// `create` the same explicit id twice → 409 AlreadyExists. Covers op/create/fault/409.
async fn create_duplicate_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let id = Id("dup-409".into());
    // Verify the first create actually took: an unguarded `?` here would let a subject with no
    // `create` reach the second call, which would then fail with a misleading diagnostic rather
    // than naming the real breach.
    let first = r
        .create(Some(id.clone()), note_body("first"))
        .await
        .map_err(|e| format!("create #1 transport: {e:?}"))?;
    if first.not_implemented {
        return Err("create advertised but not_implemented — the 409 precondition never ran".into());
    }
    match r.create(Some(id), note_body("second")).await {
        Err(BdpError::AlreadyExists(_)) => Ok(vec![fault("create", 409)]),
        other => Err(format!("expected AlreadyExists (409), got {other:?}")),
    }
}

/// Seed an explicit id with `put`, `delete` it, then `get` it → 410 Erased (tombstone: a terminal
/// revision that keeps the id). Covers op/delete + op/get/fault/410.
async fn delete_then_erased(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("to-erase".into()));
    // VERIFY THE SEED, don't assume it. This case was VACUOUS: a subject whose `delete` minted a
    // tombstone for an id that never existed let it pass with this `put` never having run, falsely
    // claiming both its rows. `not_implemented` is an Ok-signal, so an unguarded `?` here passes
    // against a subject that implements no `put` at all. A case must fail on its OWN terms rather
    // than lean on a sibling row going red.
    seed(r, &target, "to-erase").await?;
    // And confirm the resource is actually live before retiring it, so "erased" means erased-from-
    // present rather than erased-from-nothing.
    let live = r
        .get(&target, None)
        .await
        .map_err(|e| format!("seed get: {e:?}"))?;
    if live.not_implemented || live.value.is_none() {
        return Err("seed: the resource is not live before delete, so 410 would prove nothing".into());
    }
    let del = r
        .delete(target.clone(), None)
        .await
        .map_err(|e| format!("delete transport: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented".into());
    }
    // RE-KEYED on the scope's DECLARED id model rather than asserting terminality outright.
    // Terminality is not universal: a write's 410 — and `get`'s — is reachable only under
    // `permanent`. Under `reusable` a retired id is simply absent, so the truthful answer is 404
    // and asserting 410 would claim more than the spec grants.
    //
    // This case previously asserted 410 unconditionally and happened to be right, because this
    // subject is `versioned` and `versioned` REQUIRES `permanent`. Right for a reason it never
    // checked is still worth fixing: the next subject need not be versioned.
    match (r.scope_capabilities().id_model, r.get(&target, None).await) {
        (IdModel::Permanent, Err(BdpError::Erased { .. })) => {
            Ok(vec![op("delete"), fault("get", 410)])
        }
        (IdModel::Permanent, other) => Err(format!(
            "scope declares `permanent`, so a retired id must fault Erased (410); got {other:?}"
        )),
        // A `reusable` scope keeps no retirement record, so 404 is correct and `get/410` is simply
        // unreachable there — reported as covering `delete` only, never as covering the 410.
        (IdModel::Reusable, Err(BdpError::NotFound(_))) => Ok(vec![op("delete")]),
        (IdModel::Reusable, other) => Err(format!(
            "scope declares `reusable`, so a retired id must fault NotFound (404); got {other:?}"
        )),
    }
}

/// `patch` targeting a retired resource → 410 Erased. Covers op/patch/fault/410.
///
/// A write that TARGETS what is gone faults Gone, which is distinct from its two neighbours: a
/// never-retired missing id is 404, and CLAIMING a spent id is identity-taken (409). Keyed on
/// `permanent` for the same reason as `get/410` — under `reusable` the id is merely absent, so the
/// row is unreachable rather than failing.
async fn patch_tombstone_410(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if r.scope_capabilities().id_model != IdModel::Permanent {
        // Not a failure: the row is unreachable on this scope's declared model.
        return Ok(vec![]);
    }
    let target = ResourceId::head(Scope::This, Id("patch-410".into()));
    seed(r, &target, "doomed").await?;
    let del = r
        .delete(target.clone(), None)
        .await
        .map_err(|e| format!("seed delete: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented".into());
    }
    match r
        .patch(
            target,
            json_patch(r#"[{"op":"replace","path":"/body/text","value":"after"}]"#),
            None,
        )
        .await
    {
        Err(BdpError::Erased { .. }) => Ok(vec![fault("patch", 410)]),
        other => Err(format!("expected Erased (410) patching a retired resource, got {other:?}")),
    }
}

/// `delete` an id that NEVER existed → 404 NotFound, and it must mint nothing.
/// Covers op/delete/fault/404.
///
/// This row was long recorded "not producible — delete is idempotent". That was wrong twice over.
/// `delete` is idempotent on an EXISTING resource, not total: deleting an id that never existed is a
/// different case and faults 404. A subject that instead mints a tombstone makes the declared 404
/// unreachable AND, under `idModel: permanent`, lets any caller able to delete permanently spend any
/// unused id in the space — `create` there faults identity-taken for all time.
async fn delete_never_existed_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let victim = Id("never-existed-delete".into());
    let target = ResourceId::head(Scope::This, victim.clone());
    match r.delete(target, None).await {
        Err(BdpError::NotFound(_)) => {}
        other => return Err(format!("expected NotFound (404) deleting a never-created id, got {other:?}")),
    }
    // The fault is the declared half; "mints nothing" is the half that matters for safety, and it is
    // observable without asserting any status: the id must still be claimable afterwards.
    let claimed = r
        .create(Some(victim), note_body("still claimable"))
        .await
        .map_err(|e| format!("the id was BURNED by a failed delete — create now faults {e:?}"))?;
    if claimed.not_implemented {
        return Err("create advertised but not_implemented".into());
    }
    Ok(vec![fault("delete", 404)])
}

/// Deleting an ALREADY-RETIRED resource is the idempotent case: same tombstone `Rev`, no fault, and
/// no second revision. This is why `delete` alone among the writes declares no 410.
///
/// Asserts only what is invariant: the retry reports the same revision it was retired at. It claims
/// no new surface row — it exists to stop the 404 case above being satisfied by a subject that
/// faults on EVERY delete.
async fn delete_twice_is_idempotent(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("delete-twice".into()));
    seed(r, &target, "v0").await?;
    let first = r.delete(target.clone(), None).await.map_err(|e| format!("delete #1: {e:?}"))?;
    let first_rev = first.value.clone().and_then(|id| id.rev).ok_or("delete #1 returned no rev")?;
    let second = r
        .delete(target, None)
        .await
        .map_err(|e| format!("delete #2 faulted, but an already-retired resource must not: {e:?}"))?;
    let second_rev = second.value.clone().and_then(|id| id.rev).ok_or("delete #2 returned no rev")?;
    if first_rev != second_rev {
        return Err(format!(
            "delete is not idempotent: retry minted a NEW revision ({first_rev:?} -> {second_rev:?}). \
             An already-retired resource must report the revision it is retired at."
        ));
    }
    Ok(vec![])
}

/// `put` with a stale `if_revision` guard → 412 RevisionMismatch, and it must mint NOTHING.
/// Covers op/put/fault/412.
///
/// This row had no producer at all until `put` could carry a guard: the trait took no `if_rev`, so
/// the server read no precondition header and a guarded write proceeded against a stale revision
/// while returning `200`. That is a LOST-UPDATE VECTOR in which the unsafe operation SUCCEEDS, so a
/// client cannot learn it from the result — the same shape as a `delete` that mints a tombstone for
/// an id it never retired.
///
/// So the case asserts the fault AND that the resource is untouched. The status alone would pass
/// against a subject that faults after writing.
async fn put_stale_guard_412(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-412".into()));
    seed(r, &target, "v0").await?;
    let before = r
        .get(&target, None)
        .await
        .map_err(|e| format!("read-back before: {e:?}"))?
        .value
        .ok_or("no representation before the guarded put")?;

    match r
        .put(target.clone(), note_body("v1-should-not-land"), Guards::if_revision(Rev("stale-rev".into())))
        .await
    {
        Err(BdpError::RevisionMismatch { .. }) => {}
        other => return Err(format!("expected RevisionMismatch (412) on a stale guard, got {other:?}")),
    }

    // "Makes NO change" is the half that matters for safety and is observable without the status.
    let after = r
        .get(&target, None)
        .await
        .map_err(|e| format!("read-back after: {e:?}"))?
        .value
        .ok_or("no representation after the guarded put")?;
    if format!("{:?}", before.id().rev) != format!("{:?}", after.id().rev) {
        return Err(format!(
            "the guarded put FAULTED BUT STILL WROTE: revision moved {:?} -> {:?}",
            before.id().rev,
            after.id().rev
        ));
    }
    Ok(vec![fault("put", 412)])
}

/// A bare `put` targeting a retired resource → 410 Erased, and it must mint NOTHING.
/// Covers op/put/fault/410.
///
/// This is the LAST declared row that was blocked on the subject rather than on a ruling. `put` over
/// a tombstone used to start a fresh lifecycle, which revived a spent identity — the subject
/// contradicting a merged rule, not merely leaving a row uncovered.
///
/// The distinction the spec draws, and the one this case pins against its neighbour below: a BARE
/// `put` TARGETS the retired resource, so it is `410`; a `put` under `ifAbsent` CLAIMS the id, so a
/// spent one is `identity-taken` (409). Rooting cannot tell them apart — every `put` is id-rooted —
/// so the guard is what does.
async fn put_tombstone_410(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if r.scope_capabilities().id_model != IdModel::Permanent {
        // Under `reusable` a retired id is free, so a put legitimately creates and the row is
        // unreachable rather than failing.
        return Ok(vec![]);
    }
    let target = ResourceId::head(Scope::This, Id("put-410".into()));
    seed(r, &target, "doomed").await?;
    let del = r.delete(target.clone(), None).await.map_err(|e| format!("seed delete: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented".into());
    }
    match r.put(target.clone(), note_body("revived?"), Guards::default()).await {
        Err(BdpError::Erased { .. }) => {}
        other => {
            return Err(format!(
                "expected Erased (410) on a bare put at a retired id — a spent identity must not be \
                 revived; got {other:?}"
            ))
        }
    }
    // The refusal must also have written nothing: a fault that still revived the id would be worse
    // than no fault at all, and the status alone cannot tell the difference.
    match r.get(&target, None).await {
        Err(BdpError::Erased { .. }) => Ok(vec![fault("put", 410)]),
        other => Err(format!("the id must remain retired after the refused put; got {other:?}")),
    }
}

/// `put` under `if_absent` at an id that is already taken → 409. Covers op/put/fault/409.
///
/// `ifAbsent` is the CLAIMING path: `If-None-Match: *` asserts the id is free, so an occupied id
/// faults the same way a `create` collision does, keeping one id-taken handler on the client. The
/// spec is explicit that on `put` the 409 is the guard's fault and never the bare operation's —
/// a bare `put` at a live id is an ordinary update, which `put_target` already covers.
async fn put_if_absent_taken_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-409".into()));
    seed(r, &target, "occupied").await?;
    match r.put(target, note_body("claim"), Guards::if_absent()).await {
        Err(BdpError::AlreadyExists(_)) => Ok(vec![fault("put", 409)]),
        other => return Err(format!("expected AlreadyExists (409) claiming a taken id, got {other:?}")),
    }
}

/// An unguarded `put` at a live id must still be an ordinary update. Claims no row; it exists so
/// `put/409` and `put/412` cannot be satisfied by a subject that faults on every `put`.
async fn put_unguarded_still_updates(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-unguarded".into()));
    seed(r, &target, "v0").await?;
    let res = r
        .put(target, note_body("v1"), Guards::default())
        .await
        .map_err(|e| format!("an UNGUARDED put at a live id must update, not fault: {e:?}"))?;
    if res.not_implemented {
        return Err("put advertised but not_implemented".into());
    }
    Ok(vec![])
}

// ---- list / export ----------------------------------------------------------

/// `list` returns the scope's current resources. Covers op/list.
///
/// Asserts the seeded ids are PRESENT rather than asserting the exact set: other cases share this
/// server, so the scope holds their resources too. A case that demanded an exact list would pass
/// or fail depending on which cases ran before it, which is a test of the harness, not the subject.
async fn list_the_scopes_resources(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let a = ResourceId::head(Scope::This, Id("list-a".into()));
    let b = ResourceId::head(Scope::This, Id("list-b".into()));
    seed(r, &a, "a").await?;
    seed(r, &b, "b").await?;

    let res = r
        .list(&ListFilter(vec![]), Page::default())
        .await
        .map_err(|e| format!("list transport: {e:?}"))?;
    if res.not_implemented {
        return Err("list advertised but not_implemented".into());
    }
    let ids: BTreeSet<String> =
        res.value.ok_or("list returned Ok with no ids")?.iter().map(|r| r.id.0.to_string()).collect();
    for want in ["list-a", "list-b"] {
        if !ids.contains(want) {
            return Err(format!("`{want}` was seeded but is absent from list (got {} ids)", ids.len()));
        }
    }
    Ok(vec![op("list")])
}

/// A filtered `list` must be REFUSED, not silently unfiltered. Claims no row.
///
/// `capabilities()` advertises `ListCaps { conditions: [] }` over this binding because no `Filter`
/// wire encoding is pinned. This is the enforcement behind that advertisement: returning every
/// resource to a caller who asked for a subset is the `do_put`-ignored-`If-Match` defect in a
/// different primitive — accepting a constraint and not honouring it.
async fn a_filtered_list_is_refused_not_ignored(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let filter = ListFilter(vec![ListCondition::Has { field: FieldPath(vec!["body".to_string(), "text".to_string()]) }]);
    match r.list(&filter, Page::default()).await {
        Err(_) => Ok(vec![]),
        Ok(res) => Err(format!(
            "a filtered `list` must not be answered over a binding that cannot carry the filter; \
             got {} ids, which the caller would read as the filtered set",
            res.value.map(|v| v.len()).unwrap_or(0)
        )),
    }
}

/// `export` returns a JSONL-framed backup. Covers op/export.
///
/// The declared success response is `contentType = "application/jsonl"` — the only primitive that
/// declares one — so this asserts the FRAMING, which is what distinguishes an export from a read:
/// a Begin carrying the cursor it is consistent as of, the records, and an End whose count closes
/// it. A JSON array would carry the same data and not be the declared shape.
async fn export_is_jsonl_framed(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("export-target".into()));
    seed(r, &target, "exported").await?;

    let res = r
        .export(&ListFilter(vec![]), None, false, Page::default())
        .await
        .map_err(|e| format!("export transport: {e:?}"))?;
    if res.not_implemented {
        return Err("export advertised but not_implemented".into());
    }
    let records = res.value.ok_or("export returned Ok with no records")?;

    match records.first() {
        Some(ExportRecord::Begin(_)) => {}
        other => return Err(format!("an export must open with Begin (the cut cursor), got {other:?}")),
    }
    let (count, resources) = match records.last() {
        Some(ExportRecord::End(e)) => (e.count, records.len().saturating_sub(2)),
        other => return Err(format!("an export must close with End (the count), got {other:?}")),
    };
    if count as usize != resources {
        return Err(format!(
            "End declares {count} records but the stream carried {resources} — the count that \
             closes a backup must match what it contains"
        ));
    }
    if resources == 0 {
        return Err("the export is empty though a resource was seeded".into());
    }
    Ok(vec![op("export")])
}

/// The client must ADVERTISE every primitive it forwards. Claims no row.
///
/// This exists because of a defect it would have caught: `call` was bound in the binding port and
/// never added to `remote_forwards`, so `RemoteScope` forwarded it and discovery denied it for two
/// PRs. **Nothing in the gate could catch that** — every case invokes the trait method directly, so
/// no row depends on advertisement and a subject advertising nothing would still claim every row.
///
/// Under-advertising is safer than over-advertising and still wrong: discovery is the contract a
/// client reads before calling, and the spec has it stating which primitives are offered.
async fn the_client_advertises_what_it_forwards(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    use PrimitiveCapabilities as C;
    let caps = r.capabilities();
    for (name, present) in [
        ("list", caps.iter().any(|c| matches!(c, C::List(_)))),
        ("export", caps.iter().any(|c| matches!(c, C::Export(_)))),
        ("call", caps.iter().any(|c| matches!(c, C::Call(_)))),
        ("cancel", caps.iter().any(|c| matches!(c, C::Cancel(_)))),
    ] {
        if !present {
            return Err(format!(
                "`{name}` is forwarded by this client but absent from its advertised capabilities"
            ));
        }
    }
    // And the narrowing holds: conditions are cleared because this binding carries no `where`.
    if let Some(C::List(l)) = caps.iter().find(|c| matches!(c, C::List(_))) {
        if !l.conditions.is_empty() {
            return Err(format!(
                "ListCaps advertises {} condition kinds, but this binding carries no `where` \
                 encoding — an optional feature is never half-present",
                l.conditions.len()
            ));
        }
    }
    Ok(vec![])
}

// ---- revisions --------------------------------------------------------------

/// `revisions` returns a resource's history. Covers op/revisions.
///
/// KEYED ON THE DECLARED `revision_model`, not asserted outright. Store-wide guarantee 4 says
/// whether revisions are kept is the scope's `revisionModel` — so history is a scope trait, and a
/// case that demanded it unconditionally would fail a conformant `unversioned` store. Under that
/// model guarantee 5 says no revision is minted at all, which makes history *vacuous rather than
/// violated*, so `not_implemented` is the conformant answer and this case accepts it.
///
/// This is the same correction `delete_then_erased` needed against `id_model`, made before the
/// case was written rather than after it was caught.
async fn revisions_history_is_addressable(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("rev-history".into()));
    // Three distinct states, so "history" means more than "the current state in a list".
    seed(r, &target, "v0").await?;
    seed(r, &target, "v1").await?;
    seed(r, &target, "v2").await?;

    let res = r
        .revisions(&target, None, Page::default())
        .await
        .map_err(|e| format!("revisions transport: {e:?}"))?;

    if r.scope_capabilities().revision_model == RevisionModel::Unversioned {
        // An unversioned scope mints no revisions, so it has no history to offer. Guarantee 6
        // requires that this be DISCOVERABLE, which it is — the declared model above says so.
        if res.not_implemented {
            return Ok(vec![]);
        }
        return Err("an `unversioned` scope must not claim to offer history".into());
    }

    if res.not_implemented {
        return Err("a `versioned` scope declares revisions are kept, so revisions must answer".into());
    }
    let history = res.value.ok_or("revisions returned Ok with no history")?;
    if history.len() < 3 {
        return Err(format!(
            "expected at least the 3 seeded states in the history, got {}. A scope declaring \
             `versioned` keeps prior revisions addressable (store-wide guarantee 6)",
            history.len()
        ));
    }
    // PRIOR revisions, not three copies of the current one — the guarantee is that earlier states
    // stay addressable, and a subject returning the head N times would satisfy a length check.
    let revs: BTreeSet<String> = history.iter().filter_map(rep_rev_string).collect();
    if revs.len() < 3 {
        return Err(format!(
            "history has {} entries but only {} distinct revisions — prior revisions are not \
             actually addressable",
            history.len(),
            revs.len()
        ));
    }
    Ok(vec![op("revisions")])
}

/// `revisions` of an id that never existed faults 404. Covers op/revisions/fault/404.
async fn revisions_never_existed_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let absent = ResourceId::head(Scope::This, Id("rev-never-existed".into()));
    match r.revisions(&absent, None, Page::default()).await {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("revisions", 404)]),
        other => Err(format!("expected NotFound for an id with no history, got {other:?}")),
    }
}

/// A RETIRED resource still yields its history.
///
/// Claims no row — 410 is not declared on `revisions` — but it is the assertion that makes the two
/// rows above mean something, and it is DERIVED rather than chosen:
///
/// * `revisions` declares `[400, 404]`. There is no `410`, so Gone is not available to it, unlike
///   `get`.
/// * Store-wide guarantee 14 keeps a retired id accounted for, so `404` would be false — the id
///   demonstrably existed.
///
/// One possibility remains: the history survives retirement. `get` answers *"what is the current
/// state"* and faults `410`; `revisions` answers *"what states were there"*, and retiring a
/// resource does not unmake them.
///
/// It is also the anti-vacuity guard for `revisions/404`: without it, a subject that answered 404
/// to every `revisions` call would claim that row.
async fn revisions_survive_retirement(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("rev-retired".into()));
    seed(r, &target, "before-delete").await?;
    let del = r
        .delete(target.clone(), None)
        .await
        .map_err(|e| format!("delete transport: {e:?}"))?;
    if del.not_implemented {
        return Err("delete advertised but not_implemented — retirement never happened".into());
    }
    // Confirm the resource really is retired, so this proves history-survives-retirement rather
    // than history-of-a-live-resource.
    match r.get(&target, None).await {
        Err(BdpError::Erased { .. }) | Err(BdpError::NotFound(_)) => {}
        other => return Err(format!("the resource is not retired after delete, got {other:?}")),
    }

    let res = r.revisions(&target, None, Page::default()).await.map_err(|e| {
        format!(
            "a retired resource must still yield its history: `revisions` declares no 410, and \
             guarantee 14 keeps the id accounted for so 404 is false. Got {e:?}"
        )
    })?;
    if res.not_implemented {
        return Ok(vec![]); // unversioned: no history to survive. Keyed, not asserted.
    }
    let history = res.value.ok_or("revisions returned Ok with no history")?;
    if history.is_empty() {
        return Err("a retired resource's history is empty — retirement unmade its prior states".into());
    }
    Ok(vec![])
}

/// A representation's own revision, as a comparable string.
fn rep_rev_string(rep: &Representation) -> Option<String> {
    match rep {
        Representation::Bead { id, .. } => id.rev.as_ref().map(|r| r.0.to_string()),
        _ => None,
    }
}

// ---- call -------------------------------------------------------------------

/// An Operation bead selecting one of the subject's built-in implementations.
///
/// Which built-ins exist is the SUBJECT's business — no row depends on what an operation
/// computes. These cases depend only on which `Outcome` arm the call settles into.
fn operation_body(implementation: &str) -> CreateBody {
    CreateBody {
        kind: Kind("operation".into()),
        r#type: ResourceId::head(Scope::This, Id("BeadType:operation".into())),
        properties: RawJson(Bytes::from(
            serde_json::to_vec(&serde_json::json!({ "implementation": implementation })).unwrap(),
        )),
        metadata: RawJson(Bytes::from_static(b"{}")),
    }
}

/// Seed an Operation bead, then `call` it. Returns the decoded `Reply` body.
async fn seed_and_call(
    r: &RemoteScope,
    id: &str,
    implementation: &str,
    args: &str,
) -> Result<serde_json::Value, String> {
    let target = ResourceId::head(Scope::This, Id(id.into()));
    let res = r
        .put(target.clone(), operation_body(implementation), Guards::default())
        .await
        .map_err(|e| format!("seeding the Operation bead failed: {e:?}"))?;
    if res.not_implemented {
        return Err("seeding the Operation bead returned not_implemented".into());
    }
    let outcome = r
        .call(&target, Request(RawJson(Bytes::from(args.as_bytes().to_vec()))), CallMode::Sync)
        .await
        .map_err(|e| {
            format!(
                "`call` faulted with a Problem. A Problem means the operation could NOT RUN \
                 (pre-dispatch); a declared failure rides the Outcome instead. Got {e:?}"
            )
        })?;
    if outcome.not_implemented {
        return Err("call advertised but not_implemented".into());
    }
    match outcome.value {
        Some(CallOutcome::Reply(reply)) => serde_json::from_slice(&reply.0 .0)
            .map_err(|e| format!("the Reply body is not JSON: {e}")),
        Some(CallOutcome::Async(_)) => {
            Err("a sync call must settle into a Reply, not an AsyncResult ref".into())
        }
        None => Err("call returned Ok with no CallOutcome".into()),
    }
}

/// `call` an operation that succeeds. Covers op/call.
///
/// Asserts `kind` is PRESENT and `"success"` — the spec requires `kind` be explicit in the body
/// so a reader never infers the arm from the status, so a 200 with the arm missing is not a
/// conformant success.
async fn call_success(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let reply = seed_and_call(r, "op-echo", "echo", r#"{"n":1}"#).await?;
    let kind = reply["outcome"]["kind"]
        .as_str()
        .ok_or("the Reply's `outcome` carries no `kind` — the arm must be explicit in the body")?;
    if kind != "success" {
        return Err(format!("expected the success arm from a succeeding operation, got {kind:?}"));
    }
    // `cause` and `callId` are required members of `Reply`.
    for required in ["cause", "callId"] {
        if reply[required].is_null() {
            return Err(format!("`Reply.{required}` is required and absent"));
        }
    }
    Ok(vec![op("call")])
}

/// `call` an operation that settles on the DECLARED-FAILURE arm. Covers op/call/fault/409.
///
/// This is the only >=400 response in the binding whose body is not a `Problem`: the operation
/// ran and said no, so 409 carries a `Reply` whose `outcome.error` is the operation's declared
/// `E`. A subject that answered a Problem here would report that the call could not run.
async fn call_declared_failure_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let reply = seed_and_call(r, "op-refuses", "always-refuses", "{}").await?;
    let kind = reply["outcome"]["kind"].as_str().ok_or(
        "the 409 body carries no `outcome.kind`. A declared failure must arrive as a Reply on \
         the `failure` arm, not as a Problem",
    )?;
    if kind != "failure" {
        return Err(format!("expected the `failure` arm at 409, got {kind:?}"));
    }
    if reply["outcome"]["error"].is_null() {
        return Err("the `failure` arm must carry the operation's declared `error`".into());
    }
    // The arm is `failure`, not `fault`: a `fault` carries a Problem and means an UNDECLARED
    // failure. Conflating them would lose the distinction 409 exists to make.
    if !reply["outcome"]["problem"].is_null() {
        return Err("a declared `failure` must not carry a `problem` — that is the `fault` arm".into());
    }
    Ok(vec![fault("call", 409)])
}

/// An unresolvable `operation` is a PRE-dispatch failure: a bare Problem with NO Outcome, because
/// the operation never ran. Claims no row — 404 is not declared on `call` — but it is the anti-
/// vacuity guard for the two cases above: without it, a subject that answered 409 to every call
/// would satisfy `call/409`, and one that answered 200 to every call would satisfy `op/call`.
async fn call_unresolvable_operation_never_ran(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let absent = ResourceId::head(Scope::This, Id("op-does-not-exist".into()));
    match r.call(&absent, Request(RawJson(Bytes::from_static(b"{}"))), CallMode::Sync).await {
        Err(BdpError::NotFound(_)) => Ok(vec![]),
        Ok(res) => Err(format!(
            "calling an unresolvable operation must fault with a bare Problem (the operation never \
             ran), not settle into an Outcome. Got Ok({:?})",
            res.value.is_some()
        )),
        Err(other) => Err(format!("expected NotFound for an unresolvable operation, got {other:?}")),
    }
}


// ---- cancel -----------------------------------------------------------------
//
// `cancel` is the expensive primitive, because there is nothing to cancel until an operation can
// be minted asynchronously: `command cancel(asyncResult: unpinned<AsyncResult>) -> pinned<AsyncResult>`
// targets a handle, and a handle only exists once `call ?mode=async` has made one. So every case
// below opens with a minted handle, and the mint is verified before anything is asserted about the
// cancel — the `delete+erased` lesson, where a case passed with its seed never having run.

/// Does this subject ADVERTISE async `call`? Keyed, not assumed: §3.3 makes every primitive beyond
/// the floor "present iff advertised", and `CallCaps.async_supported` is the sub-capability that
/// says whether a handle can be minted at all. A scope without it cannot reach any `cancel` row,
/// and answering `501` is conformant rather than deficient.
fn async_call_offered(r: &RemoteScope) -> bool {
    use PrimitiveCapabilities as C;
    r.capabilities().iter().any(|c| matches!(c, C::Call(c) if c.async_supported))
}

/// Does this subject ADVERTISE `cancel`? Same reading, one level up: `cancel` is its own primitive
/// in the §3.3 index, so it is advertised (and refusable) independently of `call`.
fn cancel_offered(r: &RemoteScope) -> bool {
    use PrimitiveCapabilities as C;
    r.capabilities().iter().any(|c| matches!(c, C::Cancel(_)))
}

/// A bead representation's `properties`, decoded. Faults loudly rather than returning an empty
/// object: a case that read `{}` for an unparseable body would assert against the wrong thing.
fn bead_properties(rep: &Representation) -> Result<serde_json::Value, String> {
    match rep {
        Representation::Bead { properties, .. } => serde_json::from_slice(&properties.0)
            .map_err(|e| format!("the bead's properties are not JSON: {e}")),
        other => Err(format!("expected a Bead representation, got {other:?}")),
    }
}

/// Drop a handle's revision, so it can be handed to `cancel`.
///
/// THIS STEP IS FORCED BY THE TYPES AND IT IS WORTH NAMING. `call ?mode=async` answers with
/// `rep<AsyncResult>`, whose `id` is PINNED — a representation always carries the revision it is
/// of. `cancel` takes `unpinned<AsyncResult>`. So the handle a caller is handed is not in the form
/// the primitive that kills it accepts, and the caller must unpin it.
///
/// That is not an inconvenience to paper over: `cancel` declares no `412`, so there is nothing it
/// could have done with the revision even if it took one. Unpinning here is the caller doing
/// explicitly what a client that quietly dropped the `rev` would do invisibly — and the invisible
/// version is the one that lets a caller believe a revision was checked.
fn unpinned(r: &ResourceId) -> ResourceId {
    ResourceId::head(r.scope.clone(), r.id.clone())
}

/// Seed an Operation bead and `call` it with `CallMode::Async`, returning the minted handle's ref.
///
/// VERIFIES THE MINT, because every `cancel` case depends on it: a `not_implemented` is an `Ok`
/// signal, so an unguarded async call "succeeds" against a subject that mints nothing and the
/// cancel case then fails naming the wrong thing — or passes.
async fn mint_handle(r: &RemoteScope, op_id: &str) -> Result<ResourceId, String> {
    let target = ResourceId::head(Scope::This, Id(op_id.into()));
    let seeded = r
        .put(target.clone(), operation_body("echo"), Guards::default())
        .await
        .map_err(|e| format!("seeding the Operation bead failed: {e:?}"))?;
    if seeded.not_implemented {
        return Err("seeding the Operation bead returned not_implemented".into());
    }
    let res = r
        .call(&target, Request(RawJson(Bytes::from_static(b"{}"))), CallMode::Async)
        .await
        .map_err(|e| format!("the async `call` faulted instead of minting a handle: {e:?}"))?;
    if res.not_implemented {
        return Err(
            "`call` advertises `asyncSupported` but answered not_implemented for ?mode=async — an \
             optional feature is never half-present"
                .into(),
        );
    }
    match res.value {
        Some(CallOutcome::Async(reference)) => Ok(reference),
        Some(CallOutcome::Reply(_)) => Err(
            "?mode=async settled synchronously. A 200 tells the caller the call is done while it \
             believes it holds a running operation it could still cancel"
                .into(),
        ),
        None => Err("the async call returned Ok with no CallOutcome".into()),
    }
}

/// `call ?mode=async` mints a handle that is PENDING. Claims no row.
///
/// `op/call` is ONE denominator row and the sync case already covers it, so claiming it here would
/// let this case hold the row green if `call_success` broke. What this case is for is the
/// precondition every `cancel` case rests on, and the one assertion that makes "running" mean
/// anything: `AsyncResult.reply` is *"the settlement, once it arrives (absent while pending)"*, and
/// `Outcome`'s normative line is explicit that *"a transient state (running/waiting) is NOT an
/// arm"* — so a pending handle carries NO outcome at all, rather than a `running` one. A subject
/// that minted an already-settled handle would have nothing cancellable and every `cancel` row
/// below would be unreachable for a reason no case would name.
async fn an_async_call_mints_a_pending_handle(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-pending").await?;
    let got = r
        .get(&unpinned(&handle), None)
        .await
        .map_err(|e| format!("the minted handle is not readable: {e:?}"))?;
    let rep = got.value.ok_or("the minted handle read back with no representation")?;
    let props = bead_properties(&rep)?;
    if !props["reply"].is_null() {
        return Err(format!(
            "a just-minted handle already carries a `reply` ({}), so it is settled and there is \
             nothing for `cancel` to kill",
            props["reply"]
        ));
    }
    // The members `cancel` has to carry into the settlement it writes. They are top-level on
    // `AsyncResult` *"(queryable while pending, before `reply`)"*, which is this read exactly.
    for required in ["operation", "cause", "callId", "request", "replyChannel"] {
        if props[required].is_null() {
            return Err(format!("`AsyncResult.{required}` is a required member and is absent"));
        }
    }
    Ok(vec![])
}

/// `cancel` a running handle. Covers op/cancel.
///
/// The assertion is NOT that the call returned 200 — it is that the handle now carries
/// `reply.outcome = canceled`, which is what `cancel`'s description says the primitive writes. A
/// subject that answered 200 and wrote nothing would satisfy a status check and have cancelled
/// nothing, and it is the same subject a caller could not distinguish from a working one.
///
/// Keyed on the declared capabilities twice over: on `Cancel` being advertised (§3.3 — an
/// un-offered primitive is legitimately refused) and, for the pinned return, on the declared
/// `revision_model`, because an `unversioned` scope mints no revisions and relaxes every pinned
/// return to unpinned scope-wide. Asserting a `rev` outright would fail such a scope for a
/// guarantee it never made.
async fn cancel_a_running_handle(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) || !cancel_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-cancel").await?;
    let res = r
        .cancel(unpinned(&handle))
        .await
        .map_err(|e| format!("cancel of a running handle faulted: {e:?}"))?;
    if res.not_implemented {
        return Err("`cancel` is advertised but answered not_implemented".into());
    }
    let pinned = res.value.ok_or("cancel returned Ok with no ref")?;
    if pinned.id != handle.id {
        return Err(format!(
            "cancel returned a ref to {:?}, not to the handle it was given ({:?})",
            pinned.id, handle.id
        ));
    }
    if r.scope_capabilities().revision_model == RevisionModel::Versioned && pinned.rev.is_none() {
        return Err(
            "`cancel -> pinned<AsyncResult>` must return the revision the cancel minted; a \
             `versioned` scope mints one, so an unpinned answer loses the caller's proof of WHICH \
             revision carries the canceled outcome"
                .into(),
        );
    }

    // THE SUBSTANCE: read the handle back and check what was written. The read is UNPINNED on
    // purpose — the cancel minted a new revision, so a pinned read of the handle as it was handed
    // out would show the state before the cancel and this assertion would always fail.
    let got = r
        .get(&unpinned(&handle), None)
        .await
        .map_err(|e| format!("the handle is not readable after cancel: {e:?}"))?;
    let rep = got.value.ok_or("the cancelled handle read back with no representation")?;
    let props = bead_properties(&rep)?;
    let kind = props["reply"]["outcome"]["kind"].as_str().ok_or(
        "the cancelled handle carries no `reply.outcome.kind`. `cancel` *writes* \
         `reply.outcome = canceled`, and the arm must be explicit in the body — a reader never \
         infers it from a status",
    )?;
    if kind != "canceled" {
        return Err(format!("expected the `canceled` arm after cancel, got {kind:?}"));
    }
    // `canceled` is a non-domain fate, NOT a domain `Result`. A `failure` here would say the
    // operation ran and returned its declared `E`; a `fault` would say it ran and broke. Both
    // claim it DISPATCHED, and the whole point of a cancel is that it did not finish.
    if !props["reply"]["outcome"]["error"].is_null() || !props["reply"]["outcome"]["problem"].is_null()
    {
        return Err(
            "the `canceled` arm must carry neither `error` (the domain failure arm) nor `problem` \
             (the fault arm) — those say the operation ran to a verdict"
                .into(),
        );
    }
    Ok(vec![op("cancel")])
}

/// `cancel` an asyncResult id the subject never minted → 404. Covers op/cancel/fault/404.
///
/// D.8 grounds this one outright: *"404 get of an absent resource"*. Its anti-vacuity guard is
/// `cancel_a_running_handle` above — without a case proving a real handle IS cancellable, a subject
/// that answered 404 to every cancel would claim this row.
async fn cancel_absent_handle_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !cancel_offered(r) {
        return Ok(vec![]);
    }
    let absent = ResourceId::head(Scope::This, Id("async-never-minted".into()));
    match r.cancel(absent).await {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("cancel", 404)]),
        other => Err(format!("expected NotFound for a handle that was never minted, got {other:?}")),
    }
}

/// `cancel` a handle that is ALREADY SETTLED → 409. Covers op/cancel/fault/409.
///
/// DERIVED from the declared fault set rather than chosen. `cancel` declares `[404, 409]`; D.8
/// grounds 404 in absence, and this target demonstrably exists. `Outcome`'s normative line supplies
/// the condition: *"A present `outcome` means the invocation is settled, whichever arm it holds; a
/// transient state (running/waiting) is NOT an arm"* — and `cancel` acts on a *running* handle. So a
/// settled handle is the 409.
///
/// **It also settles whether `cancel` is idempotent, and the answer is NO** — which is why
/// cancelling twice is the way this case reaches the row. `delete` is idempotent on an existing
/// resource and declares no `410` because of it; `cancel` declares a `409` and the same normative
/// line that makes "settled" terminal says it is settled *whichever arm it holds*. That phrase
/// deliberately refuses to privilege one arm, so "already `canceled`" is not a state distinguishable
/// from "already failed", and reading the second cancel as idempotent would invent the distinction
/// the spec flattens.
///
/// The race the spec is really about — the operation settling on its own just before the cancel
/// lands — needs a scheduler, and this subject has none: a minted handle stays pending forever.
/// Double-cancel reaches the same STATE (`reply` present) by the only road available here, and the
/// case keys on that state rather than on how it was arrived at.
///
/// The first cancel is this case's own anti-vacuity guard: if it does not take, there is no settled
/// handle and the case says so instead of asserting 409 against a running one.
async fn cancel_a_settled_handle_409(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) || !cancel_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-settled").await?;
    let first = r
        .cancel(unpinned(&handle))
        .await
        .map_err(|e| format!("the first cancel faulted, so nothing is settled to re-cancel: {e:?}"))?;
    if first.not_implemented {
        return Err("`cancel` is advertised but answered not_implemented — the 409 precondition never ran".into());
    }
    match r.cancel(unpinned(&handle)).await {
        Err(BdpError::AlreadySettled { .. }) => Ok(vec![fault("cancel", 409)]),
        Ok(res) => Err(format!(
            "cancelling a settled handle must fault 409, not succeed. `cancel` is not idempotent: \
             a present `outcome` means settled whichever arm it holds, so there is no state in \
             which a second kill is a no-op. Got Ok({:?})",
            res.value.is_some()
        )),
        Err(other) => Err(format!("expected AlreadySettled (409) for a settled handle, got {other:?}")),
    }
}

/// `cancel` of a live resource that is NOT an AsyncResult does not resolve. Claims no row.
///
/// The declared parameter is a TYPED ref, `unpinned<AsyncResult>`. A note's id is therefore not a
/// handle that failed — it is a handle that does not resolve, and 404 is the declared fault for a
/// target that does not resolve. This is the reading `call` already takes one primitive over, for
/// `ref<Operation>`: *"a resource that resolves but names no built-in this store has is an
/// unresolvable operation, not a failed one"*.
///
/// **The alternative reading is live**: that the resource exists makes this a conflict with the
/// current state, which would be the declared 409. Nothing normative distinguishes them — D.8's
/// 404 line says *"get of an absent resource"* and this one is not absent. The case claims no row
/// precisely so that a ruling the other way moves no coverage; it is here because the two readings
/// differ in what a caller does next (re-resolve the handle, versus wait and retry), and silently
/// picking one without writing it down is how that choice stops being reviewable.
async fn cancel_of_a_non_handle_does_not_resolve(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !cancel_offered(r) {
        return Ok(vec![]);
    }
    let note = ResourceId::head(Scope::This, Id("cancel-not-a-handle".into()));
    seed(r, &note, "an ordinary note").await?;
    match r.cancel(note).await {
        Err(BdpError::NotFound(_)) => Ok(vec![]),
        Ok(res) => Err(format!(
            "cancelling an ordinary resource must not succeed — `cancel` writes \
             `reply.outcome = canceled` onto an AsyncResult, and a note has no reply to write. \
             Got Ok({:?})",
            res.value.is_some()
        )),
        Err(other) => Err(format!(
            "expected the typed ref not to resolve as a handle (404); got {other:?}. If this is \
             ruled a 409 instead, that row is declared and this case should claim it"
        )),
    }
}

/// A PINNED handle is refused, not silently cancelled at whatever revision is current. Claims no row.
///
/// DERIVED FROM AN ABSENT FAULT. `cancel` takes `unpinned<AsyncResult>` and declares no `412`,
/// while `put`, `patch` and `delete` each carry a revision guard (D.3) and each declare one. The
/// missing parameter and the missing fault agree, and together they say `cancel` has no
/// precondition channel — so a revision on the handle is an argument its declared type forbids,
/// not a guard to honour.
///
/// Which leaves refusing it as the only honest answer. Accepting it and dropping the revision is
/// the `do_put`-ignored-`If-Match` defect exactly: the caller asked for "cancel only if still at
/// this revision", gets a success, and cannot learn from the result that nothing checked. That
/// defect was a lost-update vector in which the unsafe operation SUCCEEDS, which is why this is
/// asserted rather than left to the type system of a client that may not be this one.
///
/// Claims no row because there is no row: the fault is undeclared, and over HTTP it is unreachable
/// — the route carries an id and `cancel` reads no `If-Match`, so there is no pin channel on the
/// wire to carry a revision in the first place.
async fn cancel_refuses_a_pinned_handle(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    if !async_call_offered(r) || !cancel_offered(r) {
        return Ok(vec![]);
    }
    let handle = mint_handle(r, "op-async-pinned").await?;
    // THE PINNED FORM IS THE ONE THE WIRE HANDED BACK — `rep<AsyncResult>` carries the revision it
    // is of, so no revision has to be invented to make this case. Under `unversioned` there is no
    // revision anywhere, so there is nothing to refuse and the case has nothing to say.
    if handle.rev.is_none() {
        if r.scope_capabilities().revision_model == RevisionModel::Versioned {
            return Err("a `versioned` scope's minted handle must carry its revision".into());
        }
        return Ok(vec![]);
    }
    match r.cancel(handle.clone()).await {
        Err(_) => {}
        Ok(res) => {
            return Err(format!(
                "a pinned handle must be refused: `cancel` takes `unpinned<AsyncResult>` and \
                 declares no 412, so there is no precondition for a revision to be checked \
                 against. Answering it hands back a success to a caller who believes a guard \
                 held. Got Ok({:?})",
                res.value.is_some()
            ))
        }
    }
    // And the refusal must not have cancelled it anyway — a guard that is refused AND applied is
    // worse than either.
    let got = r
        .get(&unpinned(&handle), None)
        .await
        .map_err(|e| format!("the handle is not readable after the refused cancel: {e:?}"))?;
    let rep = got.value.ok_or("the handle read back with no representation")?;
    if !bead_properties(&rep)?["reply"].is_null() {
        return Err("the pinned cancel was refused and the handle was cancelled anyway".into());
    }
    Ok(vec![])
}

/// An RFC-6902-subset JSON Patch as the wire body.
fn json_patch(body: &str) -> JsonPatch {
    JsonPatch(RawJson(Bytes::from(body.as_bytes().to_vec())))
}

/// `patch` an existing resource with a delta. Covers op/patch.
/// A bare `Rev` return is a SELF-DESCRIBING OBJECT carrying `rev`, and the `ETag` mirrors it.
/// Covers no new row — `op/delete` is covered — so this discharges an obligation.
///
/// core.lumen:1153, normative: "a bare `Rev` return (`delete`, and any `-> Rev` callable such as
/// `removeDependency`) lowers to a minimal self-describing object `{ \"rev\": <Rev> }`, NOT a raw
/// JSON string; the `ETag` header mirrors it."
///
/// THE GENERATED CONTRACT CANNOT CARRY THIS, which is why it needs a case. `delete`'s 200 declares
/// NO response schema at all — nor do `put`, `patch` or `create` — so the body shape of every write
/// rests entirely on this prose. Nothing machine-checkable would notice a write returning a raw
/// string, and the drift gate would stay green.
///
/// WHAT IS ASSERTED IS THE UNAMBIGUOUS PART, and the rest is recorded rather than guessed. The
/// obligation has three clauses: self-describing OBJECT (not a raw string), carrying `rev`, and the
/// `ETag` mirroring it. All three are asserted. The word "MINIMAL" is NOT: this subject answers
/// with the full pinned reference (`{scope, id, rev}`), a superset of `{rev}`. A client written to
/// the prose parses it correctly, so the superset is compatible but not minimal, and whether a
/// superset conforms is a spec-shape question I have not had ruled. Asserting `{rev}` exactly would
/// bake in one reading; asserting nothing would leave a normative line with no producer at all.
///
/// SO THE CASE AND THE LEDGER SPLIT THE OBLIGATION rather than one of them overclaiming it.
async fn a_bare_rev_return_is_a_self_describing_object(host: &str) -> Result<Vec<SurfaceId>, String> {
    let ty = r#"{"scope":"named","id":"Note"}"#;
    let ct = || vec![("content-type".to_string(), "application/json".to_string())];
    let put = raw_status(host, "PUT", "/bare-rev", ct(),
        format!(r#"{{"kind":"Note","type":{ty},"body":{{"v":1}},"metadata":{{}}}}"#).as_bytes()).await?;
    if put != 200 {
        return Err(format!("seeding /bare-rev answered {put}; the case never ran"));
    }

    let (status, body, etag) = raw_header(host, "DELETE", "/bare-rev", "ETag").await?;
    if status != 200 {
        return Err(format!("delete answered {status}, so there is no Rev return to shape"));
    }

    // NOT A RAW JSON STRING. This is the defect the obligation names, and it is the one a
    // `-> Rev` signature invites: serializing the newtype directly yields `"rev-123"`.
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("delete body is not JSON at all ({e}): {body}"))?;
    let obj = parsed.as_object().ok_or_else(|| format!(
        "delete returned a bare JSON {} rather than a self-describing object: {body}. \
         core.lumen:1153 names exactly this — a `-> Rev` return lowers to an OBJECT, never the \
         raw scalar, so a client can tell a revision from any other string",
        if parsed.is_string() { "string" } else { "scalar" }
    ))?;

    let rev = obj.get("rev").and_then(|v| v.as_str()).ok_or_else(|| format!(
        "delete's body has no string `rev` member: {body}. The object is self-DESCRIBING only if \
         the member names what it carries"
    ))?;
    if rev.is_empty() {
        return Err("delete's `rev` member is empty".to_string());
    }

    // THE ETAG MIRRORS IT — the second half of the same sentence, and the half no body assertion
    // can reach. A write that returned the right body and no ETag would satisfy a lesser case.
    let etag = etag.ok_or_else(|| format!(
        "delete returned `rev` {rev:?} and NO ETag header; 1153 says the ETag mirrors the bare Rev, \
         and a caller using `If-Match` on the next write has nothing to send"
    ))?;
    if etag != format!("\"{rev}\"") {
        return Err(format!(
            "ETag is {etag:?} but the body's rev is {rev:?}; the header must MIRROR the body, as a \
             quoted strong entity-tag. Two different values is worse than one missing, because a \
             client may trust either"
        ));
    }

    Ok(Vec::new())
}

/// A NO-CHANGE WRITE IS A NO-OP — it keeps the revision and records no provenance. Covers no new
/// row: `put`, `patch` and `revisions` are all covered already, so this discharges an obligation
/// rather than grounding a fault.
///
/// THE SUBJECT APPENDED UNCONDITIONALLY before this. Every idempotent re-write minted a fresh
/// revision, so a client retrying a `put` it was unsure had landed silently grew the history and
/// published a changefeed event for a change that never happened. Nothing in the suite saw it,
/// because a 200 with a new rev is indistinguishable from a 200 with the old one unless you ask.
///
/// BOTH ARMS, AND THIS IS THE POINT. A subject that simply never minted revisions would satisfy
/// every "unchanged" assertion here, so each is paired with a write that DOES change something and
/// MUST mint. That is what makes this a test of the no-change rule rather than of the absence of
/// writing.
///
/// PATCH IS INCLUDED because a well-formed delta can still leave the document identical — a
/// `replace` with the value already there — and it reaches the rule by a different route than
/// `put` does, through the patched document rather than the caller's object.
///
/// WHAT THIS CASE CANNOT SEE, stated rather than quietly dropped. The obligation has two further
/// clauses:
///   - "produces no event". The resource changefeed is served by `changes`, a RETIRED primitive
///     (remapped onto `pull`), and the protocol client exposes no method for it at all — so there
///     is no way to observe the event stream over the published surface. The implementation shares
///     one code path with the revision append, so no row means no event, but that is an argument
///     from the source, not a measurement, and it is not asserted here.
///   - "the reply carries no `transaction`". This subject never puts a transaction on a write
///     reply under ANY circumstances, so an assertion would pass without discriminating — honest
///     by accident. Left unasserted deliberately; a probe that cannot fail is not evidence.
async fn a_no_change_write_is_a_no_op(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("no-change".into()));
    seed(r, &target, "v0").await?;

    async fn history(r: &RemoteScope, t: &ResourceId) -> Result<usize, String> {
        let res = r
            .revisions(t, None, Page::default())
            .await
            .map_err(|e| format!("revisions transport: {e:?}"))?;
        if res.not_implemented {
            return Err("revisions advertised but not_implemented".into());
        }
        Ok(res.value.ok_or("revisions returned no value")?.len())
    }
    async fn rev_of(r: &RemoteScope, t: &ResourceId) -> Result<String, String> {
        let res = r.get(t, None).await.map_err(|e| format!("get transport: {e:?}"))?;
        let rep = res.value.ok_or("get returned no value")?;
        Ok(format!("{:?}", rep.id().rev))
    }

    let rev0 = rev_of(r, &target).await?;
    let n0 = history(r, &target).await?;

    // 1. The identical full-state write.
    seed(r, &target, "v0").await?;
    let rev1 = rev_of(r, &target).await?;
    let n1 = history(r, &target).await?;
    if rev1 != rev0 || n1 != n0 {
        return Err(format!(
            "a `put` of the IDENTICAL representation minted a revision: rev {rev0} -> {rev1},              history {n0} -> {n1}. The obligation is that it succeeds and KEEPS the revision, so              an idempotent retry must not grow the history or record provenance"
        ));
    }

    // 2. The discriminating arm: a real change MUST mint.
    seed(r, &target, "v1").await?;
    let rev2 = rev_of(r, &target).await?;
    let n2 = history(r, &target).await?;
    if rev2 == rev1 || n2 != n1 + 1 {
        return Err(format!(
            "a `put` that CHANGED the body did not mint a revision: rev {rev1} -> {rev2}, history              {n1} -> {n2}. Without this arm a subject that never writes would satisfy the              no-change assertions above"
        ));
    }

    // 3. A no-change PATCH — well-formed, and the value is already there.
    r.patch(
        target.clone(),
        json_patch(r#"[{"op":"replace","path":"/body/text","value":"v1"}]"#),
        None,
    )
    .await
    .map_err(|e| format!("no-change patch transport: {e:?}"))?;
    let rev3 = rev_of(r, &target).await?;
    let n3 = history(r, &target).await?;
    if rev3 != rev2 || n3 != n2 {
        return Err(format!(
            "a `patch` whose delta left the document IDENTICAL minted a revision: rev {rev2} ->              {rev3}, history {n2} -> {n3}. A well-formed delta that changes nothing is still a              no-change request"
        ));
    }

    // 4. And its discriminating arm.
    r.patch(
        target.clone(),
        json_patch(r#"[{"op":"replace","path":"/body/text","value":"v2"}]"#),
        None,
    )
    .await
    .map_err(|e| format!("real patch transport: {e:?}"))?;
    let rev4 = rev_of(r, &target).await?;
    let n4 = history(r, &target).await?;
    if rev4 == rev3 || n4 != n3 + 1 {
        return Err(format!(
            "a `patch` that CHANGED the body did not mint a revision: rev {rev3} -> {rev4},              history {n3} -> {n4}"
        ));
    }

    Ok(Vec::new())
}

/// TWO OF PATCH'S FOUR DOCUMENTED ROOT PATHS ARE NOT REACHABLE HERE, measured and recorded.
///
/// core.lumen:1132 names patch as ROOT-addressed over `/body/…`, `/metadata/…`, `/type` and
/// `/authority`. The applier builds its document as `{ "body": …, "metadata": … }`, so the other
/// two are absent and a patch naming them fails the JSON Patch target lookup. MEASURED, not read
/// off the source: a `replace` of `/type` answers `422 unprocessable`.
///
/// This is a divergence from MERGED text, not from the pending envelope ruling — and the pending
/// ruling agrees with 1132, restating the rule as a complement where the writable set is exactly
/// `{body, metadata, type, authority}`. So both the merged description and the ruling in flight
/// say these two should be patchable, which is why this is recorded as a gap rather than as a
/// question.
///
/// SPLIT BY WHAT BLOCKS EACH, because they are not one fix:
///   - `/type` is representable today (the row carries `type_scope`/`type_id`) and is a genuine
///     missing capability. CLOSES WHEN: the applier's document carries `type` and the store writes
///     it back.
///   - `/authority` is NOT representable: the store's row has no authority column at all, and
///     whether this subject acquires an authority model is already an open question with the owner.
///     Implementing the patch path first would mean inventing the model to satisfy a patch test,
///     which is the wrong order. CLOSES WHEN: that question is ruled.
///
/// Found by accident, chasing a peer's observation that 1133's forbidden list is a BLACKLIST
/// omitting `storageClass` — so a literal implementation leaves it writable. Mine does not, because
/// it exposes only two members; the same narrowness that makes it safe against the blacklist gap is
/// what makes it refuse two documented paths.
async fn patch_ok(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("patch-target".into()));
    seed(r, &target, "v0").await?;
    let res = r
        .patch(
            target,
            json_patch(r#"[{"op":"replace","path":"/body/text","value":"v1"}]"#),
            None,
        )
        .await
        .map_err(|e| format!("patch transport: {e:?}"))?;
    if res.not_implemented {
        return Err("patch advertised but not_implemented".into());
    }
    Ok(vec![op("patch")])
}

/// `patch` an id the reference never created → 404 NotFound. Covers op/patch/fault/404.
async fn patch_missing_404(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    match r
        .patch(
            missing("patch-never"),
            json_patch(r#"[{"op":"add","path":"/body/x","value":1}]"#),
            None,
        )
        .await
    {
        Err(BdpError::NotFound(_)) => Ok(vec![fault("patch", 404)]),
        other => Err(format!("expected NotFound (404), got {other:?}")),
    }
}

/// `patch` with a stale `if_rev` → 412 RevisionMismatch. Covers op/patch/fault/412.
async fn patch_stale_412(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("patch-412".into()));
    seed(r, &target, "v0").await?;
    match r
        .patch(
            target,
            json_patch(r#"[{"op":"replace","path":"/body/text","value":"v1"}]"#),
            Some(Rev("stale-rev".into())),
        )
        .await
    {
        Err(BdpError::RevisionMismatch { .. }) => Ok(vec![fault("patch", 412)]),
        other => Err(format!("expected RevisionMismatch (412), got {other:?}")),
    }
}

/// `delete` with a stale `if_rev` → 412 RevisionMismatch. Covers op/delete/fault/412.
async fn delete_stale_412(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("delete-412".into()));
    seed(r, &target, "v0").await?;
    match r.delete(target, Some(Rev("stale-rev".into()))).await {
        Err(BdpError::RevisionMismatch { .. }) => Ok(vec![fault("delete", 412)]),
        other => Err(format!("expected RevisionMismatch (412), got {other:?}")),
    }
}

/// `put` a resource at a target id. Covers op/put.
async fn put_target(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("put-target".into()));
    let res = r
        .put(target, note_body("put-value"), Guards::default())
        .await
        .map_err(|e| format!("put transport: {e:?}"))?;
    if res.not_implemented {
        return Err("put advertised but not_implemented".into());
    }
    Ok(vec![op("put")])
}

// ---- raw-HTTP cases (protocol-level faults the typed client can't express) ---

/// Send a raw request straight to the server, bypassing the typed `RemoteScope`, to exercise
/// protocol-level faults (malformed/unsupported requests) that the well-formed client never emits.
async fn raw_status(
    host: &str,
    method: &str,
    target: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<u16, String> {
    let resp = send(Outgoing {
        method,
        host,
        target,
        headers,
        body: body.to_vec(),
    })
    .await
    .map_err(|e| format!("raw send: {e:?}"))?;
    Ok(resp.status)
}

/// Like [`raw_status`], but also returns the response body.
///
/// Needed because "IGNORED" is not observable from a status. A `200` says the member was not
/// faulted; only the stored representation says it was not HONORED, and for `provenance` and
/// `createdAt` the difference between the two is the whole obligation.
async fn raw_body(
    host: &str,
    method: &str,
    target: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<(u16, String), String> {
    let resp = send(Outgoing { method, host, target, headers, body: body.to_vec() })
        .await
        .map_err(|e| format!("raw send: {e:?}"))?;
    Ok((resp.status, String::from_utf8_lossy(&resp.body).into_owned()))
}

/// Like [`raw_body`], but also returns one response header — needed for `ETag`, which is half of
/// the bare-`Rev` obligation and not visible in a body.
async fn raw_header(
    host: &str,
    method: &str,
    target: &str,
    header: &str,
) -> Result<(u16, String, Option<String>), String> {
    let resp = send(Outgoing { method, host, target, headers: Vec::new(), body: Vec::new() })
        .await
        .map_err(|e| format!("raw send: {e:?}"))?;
    let h = resp.header_value(header).map(|v| v.to_string());
    Ok((resp.status, String::from_utf8_lossy(&resp.body).into_owned(), h))
}

fn ctype(v: &str) -> Vec<(String, String)> {
    vec![("content-type".into(), v.into())]
}

/// Like [`raw_status`], but also reads the Problem `code` out of the body.
///
/// ASSERTING THE STATUS ALONE IS WHAT LET THE OLD `patch/422` CASE LOOK SOUND. Two unrelated
/// obligations — `malformed-request` (a bad request) and `limit-exceeded` (a request past an
/// ADVERTISED capability bound) — were both answered `422` by this subject, so a case that checked
/// only the number could not say which of the two it had exercised, and it had exercised the wrong
/// one. D.9 gives every fault a stable `code`; naming it is what stops a fault satisfying a case it
/// has nothing to do with. A row is `(op, status)`, so the ledger cannot carry this distinction —
/// only the case can, which is why it belongs here and not in the denominator.
async fn raw_problem(
    host: &str,
    method: &str,
    target: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<(u16, String), String> {
    let resp = send(Outgoing {
        method,
        host,
        target,
        headers,
        body: body.to_vec(),
    })
    .await
    .map_err(|e| format!("raw send: {e:?}"))?;
    // THE STATUS IS CHECKED BEFORE THE BODY IS PARSED, and that ordering is the whole value of
    // this branch. Parsing first and reporting a missing `code` member is what this helper did at
    // first, and when the guard it tests was removed it answered "the Problem body carries no
    // `code` member" over a perfectly good success body — telling a reader the response was a
    // malformed Problem when in truth the request had SUCCEEDED. A diagnostic that names the wrong
    // failure costs more than no diagnostic, because it sends the reader to the wrong file.
    if resp.status < 400 {
        return Err(format!(
            "expected a fault, but the request SUCCEEDED with {} — the producer under test is \
             absent, not merely wrong",
            resp.status
        ));
    }
    let doc: serde_json::Value = serde_json::from_slice(&resp.body)
        .map_err(|e| format!("a Problem body must be JSON (status {}): {e}", resp.status))?;
    let code = doc
        .get("code")
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            format!("the {} Problem body carries no `code` member: {doc}", resp.status)
        })?
        .to_string();
    Ok((resp.status, code))
}

/// Assert a fault answered BOTH the expected status and the expected D.9 `code`.
fn expect_problem(got: (u16, String), status: u16, code: &str, what: &str) -> Result<(), String> {
    if got.0 != status || got.1 != code {
        return Err(format!(
            "expected {status} `{code}` on {what}, got {} `{}`",
            got.0, got.1
        ));
    }
    Ok(())
}


/// `POST /` (create) with a non-JSON body → 400 bad-request. Covers op/create/fault/400.
async fn create_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "POST", "/-/create", ctype("application/json"), b"}{ not json").await? {
        400 => Ok(vec![fault("create", 400)]),
        s => Err(format!("expected 400 on a bad create body, got {s}")),
    }
}

/// `PUT /{id}` with a non-JSON body → 400 bad-request. Covers op/put/fault/400.
async fn put_malformed_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "PUT", "/put-bad", ctype("application/json"), b"not json").await? {
        400 => Ok(vec![fault("put", 400)]),
        s => Err(format!("expected 400 on a bad put body, got {s}")),
    }
}

/// `PATCH /{id}` whose body is not a JSON-Patch array → 400 `malformed-request`. Covers
/// op/patch/fault/400. Targets `/patch-target` (seeded by the typed `patch` case earlier in the run)
/// so the handler passes the existence check and reaches body validation.
///
/// WHAT THIS CASE REPLACES, AND WHY ITS PREDECESSOR PASSED FOR TWO MERGES. The same request used to
/// be sent as `patch_unprocessable_422` and asserted `422`, because the body fell through to the
/// applier. D.8 defines `422` as a request past an ADVERTISED capability bound (`limit-exceeded`,
/// fixed by shrinking the request) and names "a patch that is not a JSON-Patch array" under `400`.
/// So the row op/patch/fault/422 was recorded covered by a case that never exercised a capability
/// bound at all — the one species of defect a single-subject suite structurally cannot find, since
/// the subject and the case agreed and nothing else had a vote. It took a peer's three-backend grid
/// to surface it.
///
/// op/patch/fault/422 is now HONESTLY UNCOVERED: this subject advertises no bound a request can
/// exceed, so nothing here can produce it. That is a smaller numerator and a truer one.
async fn patch_non_array_body_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let got = raw_problem(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/json-patch+json"),
        b"not a patch",
    )
    .await?;
    expect_problem(got, 400, "malformed-request", "a patch body that is not an array")?;
    Ok(vec![fault("patch", 400)])
}

/// `PATCH /{id}` carrying `If-None-Match: *` → 400 `malformed-request`. Also covers
/// op/patch/fault/400 — a SECOND, independent producer of the same row.
///
/// `ifAbsent` is a field of `PutCaps` and of neither `PatchCaps` nor `DeleteCaps`, so on a patch
/// `If-None-Match` is not an advertised option carrying a bad value but an input the operation does
/// not define, and no capability field exists that could advertise it either way. In the
/// operation's vocabulary and advertised false is a decline the operation can state; outside its
/// vocabulary is malformed. That line is drawn by the capability record, not by D.8's prose, which
/// is why reading the prose alone missed it.
///
/// THIS CASE AND THE ONE ABOVE DO NOT DISCHARGE EACH OTHER, and the ledger cannot say so. A row is
/// `(op, status)`; op/patch/fault/400 has two triggers and is counted once, so "covered" here means
/// one trigger exercised, not the obligation discharged. The same trap applies to the S1/S3 split
/// on the read pins, and it is recorded in both places deliberately.
///
/// NOT ASSERTED BUT MEASURED. Breaking each trigger in turn showed it: removing the guard check
/// from the subject failed this case while the non-array case still passed and the row still read
/// COVERED, and emitting the wrong Problem code from the non-array branch failed that case while
/// this one held the row covered — **30/50 both times.** So a row with two triggers can lose one
/// and the coverage figure does not move. The cases are what caught each regression; the count
/// could not have.
async fn patch_out_of_vocabulary_guard_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let mut headers = ctype("application/json-patch+json");
    headers.push(("if-none-match".into(), "*".into()));
    let got = raw_problem(
        host,
        "PATCH",
        "/patch-target",
        headers,
        br#"[{"op":"replace","path":"/body/text","value":"guarded"}]"#,
    )
    .await?;
    expect_problem(got, 400, "malformed-request", "`If-None-Match` on a patch")?;
    Ok(vec![fault("patch", 400)])
}

/// `DELETE /{id}` carrying `If-None-Match: *` → 400 `malformed-request`. Covers
/// op/delete/fault/400.
///
/// This row was undeclared by rulings #2/#3 on the finding that its producer — a malformed id under
/// the retired `id:verb` convention — had died with that convention. True, and incomplete: a second
/// producer was in the spec the whole time, carried by `DeleteCaps`'s field list rather than by any
/// sentence. A reading that searches the prose for a producer cannot find a producer that is a
/// SHAPE, which is the general lesson and not a fact about `delete`.
///
/// The body is deliberately present and well-formed: the guard alone must decide the fault, or the
/// case would not distinguish the guard rule from a body rule.
async fn delete_out_of_vocabulary_guard_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let got = raw_problem(
        host,
        "DELETE",
        "/patch-target",
        vec![("if-none-match".into(), "*".into())],
        b"",
    )
    .await?;
    expect_problem(got, 400, "malformed-request", "`If-None-Match` on a delete")?;
    Ok(vec![fault("delete", 400)])
}

/// `PATCH` with a media type other than `application/json-patch+json` → 415.
/// Covers op/patch/fault/415.
///
/// This row was the entire 52-vs-51 delta against v0.2.2: the "`patch` is root-addressed" change
/// pins the request media type, so anything else faults. RFC 7396 merge-patch is the explicitly
/// excluded case, which is what this sends — the realistic wrong type, not a nonsense one.
///
/// It needs raw HTTP because the typed client always sends the correct type, so nothing reachable
/// through `RemoteScope` can produce it.
async fn patch_wrong_media_type_415(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/merge-patch+json"),
        br#"{"body":{"text":"merged"}}"#,
    )
    .await?
    {
        415 => Ok(vec![fault("patch", 415)]),
        s => Err(format!("expected 415 on a merge-patch body, got {s}")),
    }
}

/// `PATCH` with NO `Content-Type` at all → 415. Also covers op/patch/fault/415.
///
/// `REQUIRED` means present-or-fault: absence is not the lenient case. A requirement that bites only
/// when you declare something else can be evaded by declaring nothing, which makes it unenforceable
/// in exactly the case a careless client produces — so an omission must never downgrade a guarantee.
/// The guarantee is that RFC 7396 merge-patch is never silently applied.
///
/// Claims the same row as `patch_wrong_media_type_415`, deliberately: coverage does not move, but the
/// second condition of the rule is pinned, and one mistake gets ONE fault — a client that erred either
/// way sees 415, not 415-or-422 depending on how it erred.
async fn patch_absent_media_type_415(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        vec![],
        br#"[{"op":"replace","path":"/body/text","value":"no ctype"}]"#,
    )
    .await?
    {
        415 => Ok(vec![fault("patch", 415)]),
        s => Err(format!(
            "expected 415 for a patch with NO Content-Type (REQUIRED means present-or-fault), got {s}"
        )),
    }
}

/// A `patch` carrying the CORRECT media type must still be accepted — the 415 check must reject the
/// wrong type without rejecting the right one. Claims no surface row (`op/patch` is covered by
/// `patch_ok`); it exists so `patch/415` cannot be satisfied by a subject that 415s every patch.
async fn patch_correct_media_type_is_accepted(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(
        host,
        "PATCH",
        "/patch-target",
        ctype("application/json-patch+json; charset=utf-8"),
        br#"[{"op":"replace","path":"/body/text","value":"ok"}]"#,
    )
    .await?
    {
        200 => Ok(vec![]),
        415 => Err("the 415 check rejected the CORRECT media type (parameters must be ignored)".into()),
        s => Err(format!("expected 200 on a well-formed json-patch, got {s}")),
    }
}


/// `import` ROUND-TRIPS what `export` produced. Covers op/import.
///
/// THE LAST DECLARED PRIMITIVE TO REACH THE WIRE. The reference has implemented `import` all along
/// and `route.rs` has parsed `POST /-/import` all along; the server answered "not mapped in the
/// spike", so this row was uncoverable against a scope that implements the op. Wiring the handler
/// is what made it reachable, not a new case technique.
///
/// EXPORT IS THE SOURCE OF THE RECORDS ON PURPOSE. Hand-built records would test the importer
/// against my idea of the format; the exporter's own output tests the pair against each other, so a
/// framing change that breaks one breaks this case rather than passing on both sides of a private
/// convention.
async fn import_round_trips_an_export(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("import-src".into()));
    seed(r, &target, "exported").await?;

    let exported = r
        .export(&ListFilter(vec![]), None, false, Page { after: None, from: None, limit: None })
        .await
        .map_err(|e| format!("export seed: {e:?}"))?;
    if exported.not_implemented {
        return Err("export advertised but returned not_implemented".into());
    }
    let records = exported.value.ok_or("export returned no records")?;
    if !records.iter().any(|rec| matches!(rec, ExportRecord::Record(_))) {
        return Err("export carried no RECORDS, so an import of it would assert nothing".into());
    }

    let res = r
        .import(&records, p_import_set_current())
        .await
        .map_err(|e| format!("import: {e:?}"))?;
    if res.not_implemented {
        return Err("import advertised but answered not_implemented".into());
    }

    // The import must be OBSERVABLE, not merely accepted: a handler that parsed the stream and
    // dropped it would satisfy a status check. Re-reading the id is what distinguishes them.
    let back = r.get(&target, None).await.map_err(|e| format!("read-back: {e:?}"))?;
    if back.not_implemented || back.value.is_none() {
        return Err("the imported resource did not read back".into());
    }
    Ok(vec![op("import")])
}

/// A stream that does not end with `ExportEnd` → 400. Covers op/import/fault/400.
///
/// GROUNDED IN THE SPEC'S OWN WORDS, which is why this is a `400` and not a `422`: core.lumen's
/// `ExportEnd` says "a reader that takes a whole export lacking it refuses it (`400`)". A truncated
/// stream is MALFORMED, not over-bound — nothing about it exceeds an advertised limit — and the
/// distinction is the one `import`'s declared `[400, 409, 422]` keeps apart.
async fn import_truncated_stream_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    // THE WIRE SHAPE IS READ FROM `WireExportRecord`, not guessed. It is an externally-tagged
    // enum, so the frames are `{"Begin":{…}}` / `{"End":{…}}` — capitalised, with `Record`
    // wrapping a `resource`. The first version of this case hand-wrote lowercase keys, every
    // import case failed identically at 422 `unprocessable`, and the single shared cause was the
    // parse refusing all four bodies. Four red cases, one wrong assumption.
    let begin = br#"{"Begin":{"cursor":"c0"}}
"#;
    match raw_status(host, "POST", "/-/import", ctype("application/jsonl"), begin).await? {
        400 => Ok(vec![fault("import", 400)]),
        s => Err(format!("expected 400 on an import stream with no ExportEnd, got {s}")),
    }
}

/// A request that is not `application/jsonl` → 400. Claims the SAME row as the truncation case.
///
/// `400` IS THIS SUBJECT'S CHOICE, NOT A RULING — and the reason this case used to give is refuted.
///
/// It read: "decided by the declared fault set — `import` declares `[400, 409, 422]` and names no
/// 415". That treats `problem = { status = [...] }` as a CLOSED set, and it is not one. A peer
/// constructed the contradiction instead of searching for a clause, which is why it settles:
///   - D.8's own 405 row (core.lumen:2084) requires "patch where a Scope offers no patch";
///   - `patch`'s declared set (core.lumen:1134) is `[400,404,409,410,412,415,422]` — NO 405;
///   - core.lumen:1615 is normative that an un-offered primitive is refused
///     `capability-not-supported`, which D.8 binds to 405.
/// If declared sets were closed, a scope OBEYING 1615 would be non-conformant for obeying it. They
/// are what the generated OpenAPI enumerates — the annotation is literally `openapi = {...}` — and
/// D.8's last row is an explicit catch-all: "4xx/5xx any fault ... carried at the Problem's own
/// status".
///
/// The second clause was weaker than it looked too: "answering 415 would put a status on the wire
/// that no denominator row carries" is a cost to THIS INSTRUMENT, not evidence about the spec, and
/// it should not be what decides wire behaviour. Choosing the subject's answer so the gate can see
/// it is backwards.
///
/// SO WHAT THIS CASE IS: a regression pin on THIS subject's answer, not a normative verdict. A
/// conformant implementation may answer 415 here — the cleanroom does — and this case would fail
/// it, which is why it must not be cited as a conformance result against another implementation
/// until the choice is ruled. `import` carries `request = { contentType = "application/jsonl" }`
/// with no 415 in its fault set, so "should import declare 415?" is a live question for the spec
/// owner. rc2 (#448) added that `contentType`, which is what makes the media type checkable at all.
async fn import_wrong_media_type_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "POST", "/-/import", ctype("application/json"), b"[]").await? {
        400 => Ok(vec![fault("import", 400)]),
        s => Err(format!("expected 400 on an import that is not application/jsonl, got {s}")),
    }
}

/// `?strategy=history-restore` against a scope advertising `historyRestore: false` → 422
/// `limit-exceeded`. Covers op/import/fault/422.
///
/// THE CAPABILITY DUAL, stated in core.lumen as a rule rather than a courtesy: "Each limit record
/// is the advertise side of a dual: the matching `limit-exceeded` (422) is the enforce side." So a
/// scope that advertises `historyRestore: false` must REFUSE the mode, and refuse it as 422.
///
/// IT ANSWERED 501 UNTIL NOW, and that is why this row had no producer. 501 says the OP is absent;
/// `import` is advertised and present, and declines exactly one mode. A client told 501 concludes
/// the scope cannot import at all. The fix is in the reference, not here — this case is what holds
/// it.
async fn import_history_restore_is_refused_422(host: &str) -> Result<Vec<SurfaceId>, String> {
    let framed = br#"{"Begin":{"cursor":"c0"}}
{"End":{"count":0}}
"#;
    let (status, code) =
        raw_problem(host, "POST", "/-/import?strategy=history-restore", ctype("application/jsonl"), framed)
            .await?;
    match status {
        422 if code == "limit-exceeded" => Ok(vec![fault("import", 422)]),
        422 => Err(format!("422 but the code was {code}, not limit-exceeded")),
        501 => Err("history-restore answered 501; it is an advertised limit on a PRESENT op, so \
                    the dual requires 422 limit-exceeded"
            .into()),
        s => Err(format!("expected 422 limit-exceeded for an unadvertised import mode, got {s}")),
    }
}

/// The `ImportStrategy` vocabulary is CLOSED, so a third name is malformed. Claims no new row
/// (op/import/fault/400 is covered twice over above); it exists so the strategy parse cannot be
/// satisfied by a handler that treats every unknown value as the default.
async fn import_unknown_strategy_is_malformed(host: &str) -> Result<Vec<SurfaceId>, String> {
    let framed = br#"{"Begin":{"cursor":"c0"}}
{"End":{"count":0}}
"#;
    match raw_status(host, "POST", "/-/import?strategy=merge-somehow", ctype("application/jsonl"), framed)
        .await?
    {
        400 => Ok(vec![]),
        200 => Err("an unknown import strategy was ACCEPTED; the vocabulary is closed, so a third \
                    name must not silently become set-current"
            .into()),
        s => Err(format!("expected 400 on an unknown import strategy, got {s}")),
    }
}

/// `ImportStrategy::SetCurrent` without naming the enum at every call site.
fn p_import_set_current() -> bdp_primitives::ImportStrategy {
    bdp_primitives::ImportStrategy::SetCurrent
}


/// `GET /-/export?from=…` → 400. Covers op/export/fault/400.
///
/// GROUNDED IN rc2's OWN WORDS, and that is the whole reason this row has a producer now. #448 added
/// the normative line: "`export` honors only `after`, `limit` and `format` of `request`;
/// `request.filter`, `request.select` and `request.from` are rejected `400` — filtering and
/// projection are the op's own `where`/`select`, and a snapshot resumes by cut `Cursor`, not a fresh
/// ordinal." Before rc2 this row was in the same position as the retired `get/400` and `delete/400`:
/// declared on the op with no producer anywhere in the spec.
///
/// `from` AND NOT `select`, because only one of the three is unambiguous over this binding. `export`
/// also declares its own `select?` and `where?`, and neither is lowered into the generated params
/// (gastownhall/bdp#450) — so a `?select=` could be the REJECTED `request.select` or the op's own
/// parameter arriving under a spelling nobody declared, and a case cannot tell which it exercised.
/// `export` declares no ordinal parameter of its own, so `?from=` can only be `request.from`.
///
/// THE POSITIVE HALF IS ASSERTED TOO: a guard that refused every query string would satisfy the
/// first half while breaking the route, and `after`/`limit` are the two fields the same sentence
/// says export MUST honor.
async fn export_rejects_an_ordinal_resume_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    match raw_status(host, "GET", "/-/export?from=1", Vec::new(), b"").await? {
        400 => {}
        s => return Err(format!("expected 400 for `request.from` on export, got {s}")),
    }
    // The neighbours in the same sentence must still work.
    for target in ["/-/export", "/-/export?after=c0", "/-/export?limit=1"] {
        match raw_status(host, "GET", target, Vec::new(), b"").await? {
            200 => {}
            s => {
                return Err(format!(
                    "`{target}` answered {s}; rc2 says export HONORS after and limit, so a guard \
                     that refuses them is as wrong as one that drops them"
                ))
            }
        }
    }
    Ok(vec![fault("export", 400)])
}


/// `GET /-/export?where=…` and `?select=…` → 400. COVERS NO NEW ROW, and that is the point.
///
/// A REGRESSION GUARD, NOT A COVERAGE CASE. `export/400` is already covered by
/// `export_rejects_an_ordinal_resume_400`, and this discharges no obligation either — see below.
/// It exists because the behaviour it pins was WRONG and silently so: the handler refused `where`
/// and said nothing about `select`, so `?select=` was accepted and the caller's projection vanished
/// with a `200`. Nothing in the suite noticed, because nothing asked.
///
/// WHAT IT DELIBERATELY DOES NOT CLAIM. The sibling case asserts `from` AND NOT `select`, for a
/// documented reason that still holds: `?select=` could be the `request.select` that rc2 rejects
/// `400`, or `export`'s own unlowered `select?` arriving under a spelling nobody declared
/// (gastownhall/bdp#450), and a case cannot tell which it exercised. So this asserts the one thing
/// true under BOTH readings — the published contract declares no such parameter, so a refusal is
/// right either way — and claims no obligation on the strength of it.
///
/// NOR CAN IT REACH RULING B'S HISTORY BRANCH. Donna ruled that a history export refuses
/// projection while a current-state one honours it and self-labels partial. The discriminator is
/// `revisions?`, which `export` declares and the annotation does not lower (registered in
/// `UNCARRIED_INPUTS` alongside `where` and `select`). The handler does honour `?revisions=`, but
/// under an undeclared spelling, so using it here would assert against a contract no client can
/// read. Both of B's branches are unreachable until #450.
///
/// THE POSITIVE HALF IS ASSERTED, so a guard that refused every query string cannot pass this.
async fn export_refuses_projection_parameters_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    for target in ["/-/export?where=kind%3Dnote", "/-/export?select=id"] {
        let (status, code) = raw_problem(host, "GET", target, Vec::new(), b"").await?;
        if status != 400 {
            return Err(format!(
                "`{target}` answered {status}; `export` publishes neither parameter, and the \
                 earlier binding ACCEPTED `?select=` and dropped the projection with a 200 — a \
                 silently narrowed backup is worse than a refusal"
            ));
        }
        if code.is_empty() {
            return Err(format!("`{target}` refused {status} with no problem code"));
        }
    }
    // The two inputs export DOES publish must still work, or this case passes by breaking the op.
    for target in ["/-/export", "/-/export?after=c0", "/-/export?limit=1"] {
        match raw_status(host, "GET", target, Vec::new(), b"").await? {
            200 => {}
            s => {
                return Err(format!(
                    "`{target}` answered {s}; `after` and `limit` are the only query inputs export \
                     publishes, so refusing them would make this guard pass for the wrong reason"
                ))
            }
        }
    }
    Ok(Vec::new())
}

/// An invalid `?limit=` on a read → 400 `invalid-parameter`. Covers op/list/fault/400 and
/// op/revisions/fault/400.
///
/// THE RETIRED-ROWS NOTE BELOW SAYS D.8 NAMES NO PRODUCER FOR `400`. That was true when it was
/// written and rc2 (#448) has overtaken it: D.8 now names three shapes — "A BAD BODY … AN INVALID
/// PARAMETER VALUE. Or A WRITE GUARD THE OPERATION DOES NOT DEFINE". `create/400` and `put/400`
/// are the first shape, `patch/400` and `delete/400` the third, and these two are the second. So
/// two rows that looked permanently unreachable were a stale reading of the appendix, not a gap in
/// the spec.
///
/// THE BINDING HAD TURNED THE PRODUCER INTO A SUCCESS, which is why nobody could reach the row:
/// every `?limit=` parse was `.and_then(|s| s.parse().ok())`, so `?limit=abc` silently meant "give
/// me everything" and answered 200 over the caller's whole collection. The case and the fix landed
/// together; the row was uncoverable because the behaviour was wrong, not because the spec was
/// silent.
///
/// BOTH ROWS IN ONE CASE, because it is one obligation: `limit` is a `ReadRequest` field and every
/// read lowers it the same way. Splitting them would imply a reader could legitimately differ.
async fn an_invalid_limit_is_an_invalid_parameter_400(host: &str) -> Result<Vec<SurfaceId>, String> {
    let target = ResourceId::head(Scope::This, Id("limit-400".into()));
    let mut covered = Vec::new();

    for (op_name, path) in [("list", "/-/list"), ("revisions", "/limit-400/-/revisions")] {
        let (status, code) =
            raw_problem(host, "GET", &format!("{path}?limit=abc"), Vec::new(), b"").await?;
        if status != 400 {
            return Err(format!(
                "`{path}?limit=abc` answered {status}; an invalid parameter VALUE is a 400 (D.8), \
                 and silently ignoring it answers 200 over the whole collection"
            ));
        }
        if code != "invalid-parameter" {
            return Err(format!(
                "`{path}` faulted 400 with code `{code}`; D.8 names `invalid-parameter` for a bad \
                 parameter value, and the code is what tells it from a bad BODY"
            ));
        }
        covered.push(fault(op_name, 400));
    }

    // THE POSITIVE HALF: a guard that refused every `limit` would satisfy the loop above while
    // breaking paging on both reads.
    let _ = target;
    for path in ["/-/list?limit=1", "/limit-400/-/revisions?limit=1", "/-/list", "/-/export?limit=1"] {
        match raw_status(host, "GET", path, Vec::new(), b"").await? {
            200 | 404 => {}
            s => return Err(format!("`{path}` answered {s}; a VALID limit must be honored")),
        }
    }
    Ok(covered)
}


/// RETIRED, not lost: `get/400` and `delete/400`.
///
/// Both were produced by the router rejecting a `:`-bearing id as an unknown verb — the prototype's
/// `id:verb` convention, which the 0.2.3 action fence replaces. A `:` is now an ordinary id
/// character, so `GET /a:b:c` is a well-formed read of an absent resource and correctly answers
/// 404.
///
/// There was NO spec-grounded producer to move them to. `400` is declared on 11 of the 13
/// operations and Appendix D.8 — which named a producer for 404, 405, 409, 410, 412 and 415 —
/// named none for it; the only `400` the spec grounded was a length-related one it attributed to
/// intermediaries rather than the origin.
///
/// THAT PARAGRAPH IS NOW OUT OF DATE, and it is left standing with this correction because the
/// reasoning it records is what made the correction findable. rc2 (#448) gives D.8's `400` three
/// named shapes: "A BAD BODY: unparseable JSON, a patch that is not a JSON-Patch array, a truncated
/// export. AN INVALID PARAMETER VALUE. Or A WRITE GUARD THE OPERATION DOES NOT DEFINE." So the
/// appendix now grounds `400` on the origin in three different ways, and four rows that had been
/// recorded unreachable are not: `import/400` is the first shape, `list/400` and `revisions/400`
/// the second, `delete/400` the third.
///
/// `get/400` STILL HAS NONE, which is why these two are not simply un-retired. `get` takes no body,
/// and its parameters (`revision`, `include`, `omit`, `expand`, `select`) have no value this
/// binding can call invalid — a bad `?revision=` names a revision that does not exist, which is
/// `404`, not a malformed parameter. So the row stays uncovered, now for a reason that names what
/// would be needed rather than claiming the appendix is silent.
///
/// `create/400` and `put/400` SURVIVED the same change, and the difference is the point: they
/// malform the BODY on a valid route, which is a real producer. These two malformed the ID, which
/// was only a producer because of the convention. Four rows looked at risk; two actually were.
///
/// Recorded uncovered-with-reason rather than kept alive by retaining a dead convention.

/// A CHANNEL-DESCRIPTOR bead — the resource `pull`/`push` read their facts from.
///
/// `Channel is Bead` in core.lumen, so a channel is DECLARED by creating one and its direction,
/// retention floor and terminal state live in its body. That is what lets these cases set up every
/// fault below through the ordinary write path, with no test-only door into the scope.
fn channel_body(direction: &str, extra: serde_json::Value) -> CreateBody {
    let mut props = serde_json::json!({ "direction": direction });
    if let (Some(o), Some(e)) = (props.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            o.insert(k.clone(), v.clone());
        }
    }
    CreateBody {
        kind: Kind("channel".into()),
        r#type: ResourceId::head(Scope::This, Id("BeadType:channel".into())),
        properties: RawJson(Bytes::from(serde_json::to_vec(&props).unwrap())),
        metadata: RawJson(Bytes::from_static(b"{}")),
    }
}

async fn seed_channel(
    r: &RemoteScope,
    id: &str,
    direction: &str,
    extra: serde_json::Value,
) -> Result<ResourceId, String> {
    let target = ResourceId::head(Scope::This, Id(id.into()));
    let w = r
        .put(target.clone(), channel_body(direction, extra), Guards::default())
        .await
        .map_err(|e| format!("seed channel {id}: {e:?}"))?;
    if w.not_implemented {
        return Err("put advertised but returned not_implemented seeding a channel".into());
    }
    Ok(target)
}

/// EVERY READ WIRE-RETURNS A PAGE, and a walk over it terminates and loses nothing.
///
/// CLAIMS NO SURFACE ROW, deliberately, and that is the point rather than a shortcoming. `op/list`
/// and `op/revisions` are already covered, and conforming the body shape adds no fault status — so
/// this obligation is invisible to the denominator and to any pass/fail total. It is the clearest
/// case of "the gate counts faults, not obligations" (gastownhall/bdp#451): the response shape of
/// the two most-used reads can change completely without moving a single number the gate reports.
/// Only a case asserting the envelope can see it.
///
/// RULED, AND IN FORCE AT THE FROZEN TAG — which I verified rather than took, because conforming
/// looks like a wire change during a freeze. core.lumen at `bdp-core-0.2.3-rc1`, untouched by #448:
/// "RESOLVED (return unified): EVERY read … wire-returns a `Page` window `{ items, cursor, head? }`
/// … so `list`/`query` return a Page, NOT a bare array." The rule predates the freeze, so emitting
/// it is catch-up.
///
/// THE WALK IS THE TEST. Page one looks IDENTICAL whether the cursor is honored or ignored, so a
/// single windowed read proves nothing — a scope that ignores `after` returns page one for ever
/// with a 200 each time. Only walking to exhaustion and asserting the pages reconstruct the set
/// exactly separates them, and the loop is bounded so an ignored cursor fails instead of hanging.
/// Both `list` and `revisions` had exactly that defect in this binding until now.
async fn every_read_returns_a_page_and_a_walk_terminates(
    r: &RemoteScope,
    host: &str,
) -> Result<Vec<SurfaceId>, String> {
    // Four resources with ids that sort predictably, so the cursor's meaning is checkable.
    for n in 1..=4 {
        let t = ResourceId::head(Scope::This, Id(format!("page-walk-{n}").into()));
        seed(r, &t, &format!("v{n}")).await?;
    }

    // THE ENVELOPE ITSELF, read raw so the assertion is about the BYTES and not about what a
    // client chose to parse. A client that tolerated both shapes would hide this.
    for target in ["/-/list?limit=2", "/page-walk-1/-/revisions"] {
        let resp = send(Outgoing { method: "GET", host, target, headers: Vec::new(), body: Vec::new() })
            .await
            .map_err(|e| format!("raw {target}: {e:?}"))?;
        let v: serde_json::Value = serde_json::from_slice(&resp.body)
            .map_err(|e| format!("{target} body is not JSON: {e}"))?;
        if v.is_array() {
            return Err(format!(
                "`{target}` returned a BARE ARRAY. core.lumen (at the frozen tag): every read \
                 wire-returns a `Page` window `{{ items, cursor, head? }}`, \"NOT a bare array\""
            ));
        }
        if !v.get("items").map(|i| i.is_array()).unwrap_or(false) {
            return Err(format!("`{target}` has no `items` array: {v}"));
        }
        if !v.as_object().map(|o| o.contains_key("cursor")).unwrap_or(false) {
            return Err(format!(
                "`{target}` omits `cursor` entirely. The `Page` type declares the field, so it is \
                 present-and-null when the walk is done — omitting it is indistinguishable from a \
                 response with no envelope at all: {v}"
            ));
        }
    }

    // THE WALK, bounded so an ignored cursor FAILS rather than hangs.
    //
    // THE BOUND IS DERIVED FROM THE COLLECTION, not from my four seeds. `list` returns the whole
    // scope — every other case's resources too — so a bound of "4 resources in pages of 2" was
    // wrong by a factor of ten and failed this case on its first run. That was the test's error and
    // not the binding's, which is exactly the kind of thing a hand-picked constant hides: it would
    // have passed had the suite been smaller, and broken again as the suite grew.
    let whole = r
        .list(&ListFilter(vec![]), Page { after: None, from: None, limit: None })
        .await
        .map_err(|e| format!("unpaged list: {e:?}"))?
        .value
        .ok_or("unpaged list returned no value")?;
    let max_steps = whole.len() / 2 + 3;

    let mut seen: Vec<String> = Vec::new();
    let mut after: Option<Cursor> = None;
    for step in 0..max_steps {
        let res = r
            .list(&ListFilter(vec![]), Page { after: after.clone(), from: None, limit: Some(2) })
            .await
            .map_err(|e| format!("list step {step}: {e:?}"))?;
        let ids = res.value.ok_or("list returned no value")?;
        for id in &ids {
            let s = id.id.0.to_string();
            if s.starts_with("page-walk-") {
                if seen.contains(&s) {
                    return Err(format!(
                        "`{s}` came back twice at step {step}; the cursor is being ignored, so the \
                         walk is re-reading page one — a 200 each time and no way for a caller to \
                         tell"
                    ));
                }
                seen.push(s);
            }
        }
        if res.protocol.head == Some(true) {
            if res.protocol.cursor.is_some() {
                return Err("head is true but a cursor was still handed back; there is nothing \
                            further to resume from, and a position that yields an empty page \
                            invites an endless poll"
                    .into());
            }
            break;
        }
        match res.protocol.cursor {
            Some(c) => after = Some(c),
            None => {
                return Err(format!(
                    "step {step} reported head=false with NO cursor, so the walk cannot continue — \
                     the two signals have to agree or a caller is stranded mid-collection"
                ))
            }
        }
        if step + 1 == max_steps {
            return Err(format!(
                "the walk did not terminate in {max_steps} steps over {} resources in pages of 2; \
                 an ignored cursor returns page one for ever, which is what the bound catches",
                whole.len()
            ));
        }
    }

    if seen.len() != 4 {
        return Err(format!(
            "the walk reconstructed {} of the 4 seeded resources ({seen:?}); a cursor exists so \
             that paging loses nothing",
            seen.len()
        ));
    }
    Ok(vec![])
}


// ---- the channel pair: pull and push ----------------------------------------------------------

/// A duplex channel ROUND-TRIPS: push appends, pull reads back, in order. Covers op/push and
/// op/pull.
///
/// ONE CASE FOR TWO ROWS, because neither op is observable without the other on this subject.
/// Asserting push alone could only check an ack it was handed; asserting pull alone needs events
/// that only push can put there. Pairing them means a push that acknowledged without appending,
/// or a pull that answered from somewhere other than the stream, fails — which neither half
/// catches alone.
///
/// THE ACK IS ASSERTED, not just the status. `accepted_through` must reach the last ordinal and
/// each event must come back `Accepted`, because a scope could return an empty `results` with a
/// 200 and satisfy a status check while appending nothing.
async fn a_duplex_channel_round_trips(r: &RemoteScope) -> Result<Vec<SurfaceId>, String> {
    let ch = seed_channel(r, "ch-duplex", "duplex", serde_json::json!({})).await?;

    let events = vec![
        PushEvent { ordinal: None, body: RawJson(Bytes::from_static(br#"{"n":1}"#)) },
        PushEvent { ordinal: None, body: RawJson(Bytes::from_static(br#"{"n":2}"#)) },
    ];
    let ack = r.push(&ch, &events).await.map_err(|e| format!("push: {e:?}"))?;
    if ack.not_implemented {
        return Err("push advertised but returned not_implemented".into());
    }
    let ack = ack.value.ok_or("push returned no ack")?;
    if ack.accepted_through != 2 {
        return Err(format!(
            "acceptedThrough is {}, expected 2 — the ack must name the high-water ordinal durably \
             appended, or a pusher cannot know where to re-offer from",
            ack.accepted_through
        ));
    }
    if ack.results != vec![PushResult::Accepted(1), PushResult::Accepted(2)] {
        return Err(format!(
            "results are {:?}; two unkeyed events offered into an empty window-2 channel must both \
             be Accepted at 1 and 2",
            ack.results
        ));
    }

    let pulled = r
        .pull(&ch, Page { after: None, from: None, limit: None }, None, None)
        .await
        .map_err(|e| format!("pull: {e:?}"))?;
    if pulled.not_implemented {
        return Err("pull advertised but returned not_implemented".into());
    }
    let got = pulled.value.ok_or("pull returned no value")?;
    let bodies: Vec<String> =
        got.iter().map(|e| String::from_utf8_lossy(e.0.as_ref()).into_owned()).collect();
    if bodies.len() != 2 || !bodies[0].contains("\"n\":1") || !bodies[1].contains("\"n\":2") {
        return Err(format!("pull returned {bodies:?}; expected the two pushed events in order"));
    }

    // RESUMING FROM A CURSOR delivers only what follows it — the property a cursor exists for, and
    // one a single unpaged read cannot see.
    let after_first = r
        .pull(
            &ch,
            Page { after: Some(Cursor(Bytes::from_static(b"1"))), from: None, limit: None },
            None,
            None,
        )
        .await
        .map_err(|e| format!("pull after=1: {e:?}"))?
        .value
        .ok_or("pull after=1 returned no value")?;
    if after_first.len() != 1 {
        return Err(format!(
            "pull after=1 returned {} events, expected 1; a cursor that is accepted and ignored is \
             the silent-failure class rc2 forbids",
            after_first.len()
        ));
    }

    Ok(vec![op("push"), op("pull")])
}

/// THE `format` REFUSALS #457 AND #458 MADE NORMATIVE. Claims no row — both 400s are already
/// covered by other cases, so this is obligation coverage, not a row.
///
/// MIRROR IMAGES, which is the whole point of #458. The windowed reads return a `Page`, and
/// `export` is the single exception — a self-framed jsonl backup stream. So `list`/`revisions`
/// refuse `jsonl`/`sse` and serve `page`, while `export` refuses everything that is NOT `jsonl`,
/// `page` included, "since a backup is a stream, not a windowed `Page`".
///
/// THIS BINDING SERVED ALL OF THEM 200 and the re-pin to main did not notice. That is the lesson
/// of the re-pin rather than a footnote to it: my gate went green at 48/51 against the merged
/// spec, which establishes that no ROW noticed, not that nothing arrived. #458's requirement was
/// in the merge and nobody relayed it; a peer hit the same thing in her own tree.
///
/// AND THE STATUS IS NOT THE OBLIGATION. Serving the windowed bytes under a `jsonl` request is
/// "the default encoding, as if the param were absent" — the silent-failure class rc2 names. A
/// status check alone cannot separate "refused" from "refused and then served anyway", so each arm
/// asserts the refused body did NOT come back. Found by a peer amending rather than deleting the
/// test whose expectation had inverted: its expectation changed and its PURPOSE did not.
async fn the_format_header_refusals(r: &RemoteScope, host: &str) -> Result<Vec<SurfaceId>, String> {
    let t = ResourceId::head(Scope::This, Id("fmt-probe".into()));
    seed(r, &t, "v1").await?;
    let hdr = |v: &str| vec![("format".to_string(), v.to_string())];

    // list / revisions: refuse the stream transports, serve the window.
    for (op, target) in [("list", "/-/list"), ("revisions", "/fmt-probe/-/revisions")] {
        for bad in ["jsonl", "sse"] {
            let (status, code) = raw_problem(host, "GET", target, hdr(bad), b"").await?;
            if (status, code.as_str()) != (400, "invalid-parameter") {
                return Err(format!(
                    "`{op}` with `format: {bad}` answered {status} / `{code}`; #457 requires 400 \
                     `invalid-parameter` — a windowed read does not serve a stream transport"
                ));
            }
        }
        // THE DISCRIMINATOR: the accepted values must still work, or the arms above prove only that
        // this op is broken for every `format`.
        for ok in ["page", ""] {
            let h = if ok.is_empty() { Vec::new() } else { hdr(ok) };
            let st = raw_status(host, "GET", target, h, b"").await?;
            if st != 200 {
                return Err(format!(
                    "`{op}` with format {:?} answered {st}, so the refusals above say nothing about \
                     the transport — this op refuses every `format`",
                    if ok.is_empty() { "absent" } else { ok }
                ));
            }
        }
    }

    // export: the one exception — jsonl only, `page` refused WITH the others.
    for bad in ["page", "sse"] {
        let (status, code) = raw_problem(host, "GET", "/-/export", hdr(bad), b"").await?;
        if (status, code.as_str()) != (400, "invalid-parameter") {
            return Err(format!(
                "`export` with `format: {bad}` answered {status} / `{code}`; #458 makes export the \
                 jsonl-native exception, so `page` is refused with the rest"
            ));
        }
    }
    let st = raw_status(host, "GET", "/-/export", hdr("jsonl"), b"").await?;
    if st != 200 {
        return Err(format!(
            "`export` with `format: jsonl` answered {st}; jsonl is the ONE transport export serves, \
             so refusing it would mean export refuses everything"
        ));
    }

    // AND THE BYTES. A 400 that still carries the payload is the silent substitution in disguise.
    let resp = send(Outgoing {
        method: "GET",
        host,
        target: "/-/export",
        headers: hdr("page"),
        body: Vec::new(),
    })
    .await
    .map_err(|e| format!("raw export: {e:?}"))?;
    let body = String::from_utf8_lossy(&resp.body);
    if body.contains("fmt-probe") {
        return Err(format!(
            "`export` refused `format: page` with 400 and STILL served the records — a refusal that \
             carries the payload is the silent substitution wearing a status code: {body:.200}"
        ));
    }
    Ok(Vec::new())
}

/// THE CLOSED INPUT AND THE `retired` DIVERGENCE. Claims no row — `create`'s 400 is already
/// covered, so this is obligation coverage for three obligations at once.
///
/// THREE NORMATIVE LINES MEET ON THIS ONE BODY TYPE:
///   - `create` input is CLOSED: "an envelope member Core does not define is refused, not ignored".
///   - `retired` is SERVICE-MANAGED: "minted only by `delete`, **refused on `create` and ignored on
///     `put`**", because "a write can neither forge nor clear a tombstone".
///   - a read-only member on a write is "IGNORED, never faulted — so a `get` → `put` round-trip of
///     a whole representation is safe".
///
/// The last two collide on `create` + `retired` and BOTH survive: the round-trip rationale never
/// reaches `create` (a round-trip does not create), and the tombstone rationale does (`retired:
/// true` at birth forges one). The specific carves out of the general.
///
/// BEFORE THIS, ALL THREE WERE UNOBSERVABLE AND ONE WAS SATISFIED BY ACCIDENT. Measured: a create
/// carrying an undefined member answered 201, a create carrying `retired: true` answered 201, and a
/// put carrying `retired: true` answered 200 — the last one correct, but because serde silently
/// dropped everything it did not recognise, not because the subject knew the member was read-only.
///
/// AND IT IS A CONVENTION, NOT AN INVARIANT, WHICH IS WHY BOTH ARMS ARE ASSERTED. The divergence
/// lives in two handlers because serde can answer only ONCE for a shared type — so nothing
/// structural stops a later refactor collapsing it into "refuse everywhere", which would be right
/// for `create` and silently wrong for `put`. The put-ignores arm is the one that would rot.
async fn the_create_input_is_closed_and_retired_diverges(host: &str) -> Result<Vec<SurfaceId>, String> {
    let ct = || vec![("content-type".to_string(), "application/json".to_string())];
    let ty = r#"{"scope":"named","scopeName":"types","id":"Note"}"#;

    // THE DISCRIMINATOR FIRST: a well-formed create must succeed, or every arm below proves only
    // that `create` is broken.
    let ok = raw_status(host, "POST", "/-/create", ct(),
        format!(r#"{{"kind":"Note","type":{ty},"id":{{"scope":"this","id":"closed-ok"}},"body":{{}},"metadata":{{}}}}"#).as_bytes()).await?;
    if ok != 201 {
        return Err(format!(
            "a well-formed create answered {ok}, so the refusals below say nothing — this subject \
             refuses every create"
        ));
    }

    // 1. An undefined envelope member is REFUSED, not ignored.
    let (st, code) = raw_problem(host, "POST", "/-/create", ct(),
        format!(r#"{{"kind":"Note","type":{ty},"id":{{"scope":"this","id":"closed-1"}},"body":{{}},"metadata":{{}},"nonsenseMember":true}}"#).as_bytes()).await?;
    if st != 400 {
        return Err(format!(
            "create carrying an undefined envelope member answered {st} / `{code}`; the input is \
             CLOSED, so it must be refused rather than silently dropped"
        ));
    }

    // 2. THE WHOLE SERVICE-MANAGED SET is refused on CREATE, not just `retired`.
    //
    // core.lumen names an envelope, not a member: "The immutable envelope (`/id`, `/provenance`,
    // `/createdAt`, `/retired`)". This case tested `retired` alone, while `provenance` and
    // `createdAt` were refused only incidentally by `deny_unknown_fields` — the right outcome for
    // the wrong reason, under the unregistered `bad-request`, and only while they stayed
    // undeclared. A guard over one member of a named set is two omissions wearing one assertion.
    for (i, m) in ["retired", "provenance", "createdAt"].iter().enumerate() {
        let v = if *m == "retired" { "true" } else { r#""forged""# };
        let (st, code) = raw_problem(host, "POST", "/-/create", ct(),
            format!(r#"{{"kind":"Note","type":{ty},"id":{{"scope":"this","id":"closed-2{i}"}},"body":{{}},"metadata":{{}},"{m}":{v}}}"#).as_bytes()).await?;
        if (st, code.as_str()) != (400, "malformed-request") {
            return Err(format!(
                "create carrying `{m}` answered {st} / `{code}`; every member of the \
                 service-managed envelope must be refused, and refused BECAUSE it is \
                 service-managed — a refusal under a different code is the undeclared-field \
                 accident, which stops working the moment the member joins the representation"
            ));
        }
    }

    // AND THE REFUSAL MUST SAY WHY. The assertion is right; the reason I first gave for it was not,
    // and the correction is worth more than the assertion.
    //
    // THE REFUTED RATIONALE, QUOTED RATHER THAN PARAPHRASED, because it is the one anyone would
    // reach for and stating it as refuted preserves why it is tempting. I wrote:
    //
    //   "the status and code are identical whether a member is refused explicitly or as an unknown
    //    field, so the detail is the only place the reason shows"
    //
    // — the nine other `problem_body` sites still using the unregistered `bad-request` being the
    // premise: fix those to `malformed-request` and both refusals would answer the same pair.
    //
    // Keeping the sentence costs something and it is worth naming: it is now a FALSE POSITIVE for
    // the grep that finds this defect class ("indistinguishable | identical whether | the only
    // place"), indistinguishable at grep distance from a live wrong claim. A peer hit exactly this
    // in her tree, and the triage is manual — which is the reason this sweep stays a procedure and
    // is NOT automated into a check. A check that flags quoted retractions is a noise generator.
    //
    // THAT SCENARIO CANNOT ARISE, and the reason is the fix itself. Measured by simulating it:
    // with the explicit guard dropped, `create + provenance` does not get refused under a
    // converged code — it answers **201 and creates the resource with a forged provenance**.
    // DECLARING the member is what removed the incidental `deny_unknown_fields` protection, so
    // there is no longer any path by which a declared service-managed member is refused for the
    // wrong reason. Declare-without-refuse is strictly worse than the original state, which is why
    // both halves had to land in one commit (`8cee96a2` did).
    //
    // So this assertion guards something narrower and real: that the refusal STATES its reason, and
    // that a later rewrite cannot quietly drop it. It is not the discriminator I claimed — the code
    // assertion above is, and it is not fragile in the way I described. A peer raised the detail
    // point and it was worth adding; the justification I attached was mine and wrong.
    {
        let resp = send(Outgoing {
            method: "POST",
            host,
            target: "/-/create",
            headers: ct(),
            body: format!(r#"{{"kind":"Note","type":{ty},"id":{{"scope":"this","id":"closed-why"}},"body":{{}},"metadata":{{}},"provenance":"forged"}}"#).into_bytes(),
        })
        .await
        .map_err(|e| format!("raw create: {e:?}"))?;
        let body = String::from_utf8_lossy(&resp.body);
        if !body.contains("service-managed") {
            return Err(format!(
                "the refusal of `provenance` does not say WHY — its detail must name it as \
                 service-managed, so a later rewrite cannot replace an explanatory refusal with a \
                 bare one. (The `(status, code)` assertion above is the discriminator; this is not \
                 about telling an explicit refusal from an unrecognised-field one, which cannot \
                 happen for a DECLARED member — see the note above.): {body:.240}"
            ));
        }
    }

    // THE EXEMPTION, which is this rule's discriminating arm: `id` is in the immutable envelope and
    // is nonetheless caller-proposable AT creation ("Caller-proposed id optional"), so a case that
    // refused the whole envelope would be wrong in the other direction.
    let st = raw_status(host, "POST", "/-/create", ct(),
        format!(r#"{{"kind":"Note","type":{ty},"id":{{"scope":"this","id":"closed-id-ok"}},"body":{{}},"metadata":{{}}}}"#).as_bytes()).await?;
    if st != 201 {
        return Err(format!(
            "a create proposing its own `id` answered {st}; `id` is in the immutable envelope but \
             is caller-proposable at creation, so refusing it would over-apply the service-managed \
             rule to the one member the envelope and `create` disagree about"
        ));
    }

    // 3. THE WHOLE SET on PUT is IGNORED — the round-trip arm, and the one that rots.
    //
    // THIS TESTED `retired` ALONE while the create side above was already fixed to cover the set.
    // Same defect, same case, opposite end: core.lumen names an ENVELOPE, so guarding one member
    // leaves the other two resting on nothing. A peer asked me to check that `put` ignores rather
    // than refuses, and the gap was the member count, not the direction.
    //
    // THREE WRITES, THREE TREATMENTS, and the spec is coherent across them: a read-only member is
    // REFUSED on `create` (the input is closed), IGNORED on `put` (core.lumen:472, so a
    // `get` -> `put` round-trip of a whole representation is safe), and FAULTS under `patch`
    // (core.lumen:1133, because the caller NAMES an unwritable path). Collapsing any pair of those
    // is a real divergence, and this arm is what stops the create-side refusal spreading to `put`.
    //
    // IGNORED IS ASSERTED AS *NOT HONORED*, NOT AS 200. A status only says the write was not
    // faulted. For `provenance` and `createdAt` the forged value landing is exactly as wrong as a
    // refusal, and a `200` cannot tell the two apart — the same reason the sibling case reads the
    // problem CODE rather than the number.
    //
    // THE DROP IS STRUCTURAL, so these cannot fail today: `WireCreateRequest::into_body` builds a
    // `CreateBody` of `kind`/`type`/`properties`/`metadata` and there is no field for any of the
    // three to ride past the wire layer. That makes this a TRIPWIRE on a construction guarantee,
    // not a probe that cannot fail — the guarantee has a plausible way to end (someone implementing
    // caller-supplied provenance adds the field and wires it through), and this is what would
    // notice. Red-greening it means making that legitimate change, not deleting an assertion.
    // TWO MEMBERS OF THE SET ARE DELIBERATELY NOT IN THIS LOOP, and both are MEASURED divergences held
    // pending a ruling rather than fixed. The spec owner is taking to Donna that `put` IGNORES the whole
    // service-managed ENVELOPE -- `id`, `provenance`, `createdAt`, `retired`, `storageClass` -- generalising
    // core.lumen:198's `retired` asymmetry, with `create` refusing them under the closed input (:4). Under
    // that ruling this subject diverges twice, in opposite directions:
    //
    //   - `storageClass` on put answers 400. Measured, not inferred: added to this loop it reported "put
    //     carrying `storageClass` answered 400". `WireCreateRequest` has no such field and carries
    //     `deny_unknown_fields`, so it is refused as unknown. That is the round-trip break 472 exists to
    //     prevent -- a `get` returns `storageClass`, so putting the whole representation back FAILS. A peer
    //     found the same shape with `id` in her own tree.
    //
    //   - a body `id` that MISMATCHES the URL answers 200 and is silently dropped (the URL wins). Measured
    //     the same way: the arm passed. The owner's new sub-rule says a matching id is ignored and a
    //     mismatch faults 400, because the body contradicts the target rather than being written.
    //
    // NOT FIXED HERE ON PURPOSE. The rule reached me as the spec owner's relay and is going to Donna for
    // ratification; 472's own text scopes its ignore to a "read-only member (`computed` or
    // `serviceManaged`)", and whether the envelope counts is precisely what is being ruled. Changing
    // behaviour now would bake one reading of an open question into the subject, and unlike the
    // patch/409 grant this one costs me work rather than granting me a row -- which is a reason to be
    // careful, not a reason to be quick. CLOSES WHEN: Donna ratifies, at which point `storageClass` joins
    // the admitted-never-honored fields and the id-mismatch arm becomes a 400 case.
    for (seg, member, forged, marker) in [
        ("closed-3a", "retired", "true", None),
        ("closed-3b", "provenance", r#""forged-by-caller""#, Some("forged-by-caller")),
        ("closed-3c", "createdAt", r#""1999-01-01T00:00:00Z""#, Some("1999-01-01")),
    ] {
        let path = format!("/{seg}");
        let st = raw_status(host, "PUT", &path, ct(),
            format!(r#"{{"kind":"Note","type":{ty},"body":{{"v":1}},"metadata":{{}},"{member}":{forged}}}"#).as_bytes()).await?;
        if st != 200 {
            return Err(format!(
                "put carrying `{member}` answered {st}; a read-only member on a write is IGNORED, \
                 NEVER FAULTED, so a `get` -> `put` round-trip of a whole representation stays \
                 safe. If this is a 400 the create-side refusal has been collapsed onto `put`, \
                 which is the exact failure this arm exists to catch"
            ));
        }
        let (readable, body) = raw_body(host, "GET", &path, Vec::new(), b"").await?;
        if readable != 200 {
            return Err(format!(
                "after a put carrying `{member}` the resource reads {readable}, so the member was \
                 HONORED rather than ignored — for `retired` that means the write forged a \
                 tombstone through `put`"
            ));
        }
        if let Some(m) = marker {
            if body.contains(m) {
                return Err(format!(
                    "a put carrying `{member}` was answered 200 AND the forged value {m:?} is in \
                     the stored representation, so it was HONORED, not ignored. Ignoring means the \
                     member has no effect; accepting it silently is worse than refusing it, \
                     because the caller is told the write succeeded and the service's own field \
                     now carries a value a writer supplied"
                ));
            }
        }
    }
    Ok(Vec::new())
}

/// `pull` of a channel that does not exist → 404 `resource-not-found`. Covers op/pull/fault/404.
///
/// THE ROW THIS GATE ASKED FOR. #456 made "which channels exist is discovered per-channel"
/// normative, which turns pulling an absent channel into a legitimate request — and `pull`'s other
/// three statuses were each already spoken for (405 direction, 410 the retention floor, 400
/// malformed), so the obligation had no status to answer it. Raised on the PR pre-merge and
/// declared in the same change, so the row and its declaration landed together.
///
/// NO SUBJECT CHANGE WAS NEEDED, which I established by probing rather than assuming: this binding
/// already answered `404 resource-not-found` here. The gap was never in the server — it was that
/// nothing asked. A peer found exactly the same thing in an independent implementation, which is
/// worth more than either observation alone.
///
/// THE SECOND ARM IS LOAD-BEARING. "An absent channel is 404" passes trivially against a subject
/// that 404s every pull, so the case also pulls a channel that DOES exist and asserts it does not
/// 404. Without that, the row would be green on a `pull` that never worked at all.
async fn pull_of_an_absent_channel_404(r: &RemoteScope, host: &str) -> Result<Vec<SurfaceId>, String> {
    let absent = raw_problem(host, "GET", "/no-such-channel-at-all/-/pull", Vec::new(), b"").await?;
    match (absent.0, absent.1.as_str()) {
        (404, "resource-not-found") => {}
        (404, c) => {
            return Err(format!(
                "404 on an absent channel but the code was `{c}`; #456 binds `resource-not-found` \
                 on D.8's 404 row"
            ))
        }
        (s, c) => {
            return Err(format!(
                "pull of a channel that does not exist answered {s} / `{c}`; #456 declares 404 for \
                 exactly this case"
            ))
        }
    }

    // THE DISCRIMINATOR: a live, pullable channel must NOT answer 404, or the arm above proves only
    // that `pull` is broken for everything.
    seed_channel(r, "ch-live-404-probe", "source", serde_json::json!({})).await?;
    let live = raw_status(host, "GET", "/ch-live-404-probe/-/pull", Vec::new(), b"").await?;
    if live == 404 {
        return Err(format!(
            "a live `source` channel also answered 404, so the absent-channel arm says nothing \
             about absence — this subject 404s every pull"
        ));
    }
    Ok(vec![fault("pull", 404)])
}

/// `pull` on a `sink`-only channel → 405 `channel-not-pullable`. Covers op/pull/fault/405.
///
/// NAMED BY THE SPEC, both the status and the code: core.lumen#pull says "Valid on a
/// `source`/`duplex` channel; a `sink`-only channel faults `channel-not-pullable`", and D.8 grounds
/// the status — "405 pull / push on the wrong channel direction".
///
/// NOT 422, and the case asserts the code to hold that line. A direction is a property of the
/// CHANNEL, not an advertised bound of the operation, so no smaller request would succeed — which
/// is exactly what `limit-exceeded` is for.
async fn pull_on_a_sink_is_not_pullable_405(r: &RemoteScope, host: &str) -> Result<Vec<SurfaceId>, String> {
    seed_channel(r, "ch-sink", "sink", serde_json::json!({})).await?;
    let (status, code) = raw_problem(host, "GET", "/ch-sink/-/pull", Vec::new(), b"").await?;
    match (status, code.as_str()) {
        (405, "channel-not-pullable") => Ok(vec![fault("pull", 405)]),
        // 405 HAS TWO MEANINGS AND THIS ROW MUST ONLY CLAIM ONE. D.8: "405 pull / push on the
        // wrong channel direction; patch where a Scope offers no patch" -- so the same status also
        // answers an UN-OFFERED PRIMITIVE, with `capability-not-supported` (core.lumen:1611, the
        // enforce side of the a-la-carte advertisement). That is a conformant DECLINE, not a
        // failure: a scope that does not offer this primitive cannot cover this row, so the case
        // claims no row and the row stays uncovered. Treating it as an error -- which this arm did
        // -- would fail a conformant subject for not implementing an optional primitive, and would
        // report a capability gap as a caller mistake. Found by Shelly, whose own suite has the
        // mirror test for the other meaning; the complementary-populations problem living inside a
        // gate row rather than inside a count.
        (405, "capability-not-supported") => Ok(Vec::new()),
        (405, c) => Err(format!(
            "405 but the code was `{c}` -- neither `channel-not-pullable` (wrong direction) nor \
             `capability-not-supported` (primitive not offered), which are D.8's two readings of \
             this status"
        )),
        (422, _) => Err("a sink answered 422; the direction is the channel's, not an advertised \
                         bound of pull, so there is no smaller request that would work"
            .into()),
        (s, c) => Err(format!("expected 405 channel-not-pullable on a sink, got {s} / {c}")),
    }
}

/// `push` on a `source`-only channel → 405 `channel-not-pushable`. Covers op/push/fault/405.
async fn push_on_a_source_is_not_pushable_405(r: &RemoteScope, host: &str) -> Result<Vec<SurfaceId>, String> {
    seed_channel(r, "ch-source", "source", serde_json::json!({})).await?;
    let (status, code) = raw_problem(
        host,
        "POST",
        "/ch-source/-/push",
        ctype("application/jsonl"),
        br#"{"body":{"n":1}}
"#,
    )
    .await?;
    match (status, code.as_str()) {
        (405, "channel-not-pushable") => Ok(vec![fault("push", 405)]),
        // 405 HAS TWO MEANINGS AND THIS ROW MUST ONLY CLAIM ONE. D.8: "405 pull / push on the
        // wrong channel direction; patch where a Scope offers no patch" -- so the same status also
        // answers an UN-OFFERED PRIMITIVE, with `capability-not-supported` (core.lumen:1611, the
        // enforce side of the a-la-carte advertisement). That is a conformant DECLINE, not a
        // failure: a scope that does not offer this primitive cannot cover this row, so the case
        // claims no row and the row stays uncovered. Treating it as an error -- which this arm did
        // -- would fail a conformant subject for not implementing an optional primitive, and would
        // report a capability gap as a caller mistake. Found by Shelly, whose own suite has the
        // mirror test for the other meaning; the complementary-populations problem living inside a
        // gate row rather than inside a count.
        (405, "capability-not-supported") => Ok(Vec::new()),
        (405, c) => Err(format!(
            "405 but the code was `{c}` -- neither `channel-not-pushable` (wrong direction) nor \
             `capability-not-supported` (primitive not offered), which are D.8's two readings of \
             this status"
        )),
        (s, c) => Err(format!("expected 405 channel-not-pushable on a source, got {s} / {c}")),
    }
}

/// A cursor below the retention floor → 410 `cursor-expired`. Covers op/pull/fault/410.
///
/// core.lumen#pull: "Faults `cursor-expired` below the retention floor", and D.8: "410 … pull below
/// the retention floor (cursor-expired)".
///
/// THE BOUNDARY IS ASSERTED, not just the far side. Resuming "after N" delivers N+1 onwards, so a
/// cursor is valid exactly when `N + 1 >= floor` — the cursor naming the last event BEFORE the
/// floor is the OLDEST LEGAL resume point, not an illegal one. An off-by-one in the forgiving
/// direction loses data silently; in the strict direction it refuses a conformant reader. Checking
/// only `after=1` against floor 5 would pass either way.
async fn a_cursor_below_the_retention_floor_expires_410(
    r: &RemoteScope,
    host: &str,
) -> Result<Vec<SurfaceId>, String> {
    seed_channel(r, "ch-retained", "duplex", serde_json::json!({ "retentionFloor": 5 })).await?;
    let _ = r;

    let (status, code) =
        raw_problem(host, "GET", "/ch-retained/-/pull?after=1", Vec::new(), b"").await?;
    match (status, code.as_str()) {
        (410, "cursor-expired") => {}
        (410, c) => return Err(format!("410 but the code was `{c}`, not cursor-expired")),
        (s, c) => return Err(format!("expected 410 cursor-expired below the floor, got {s} / {c}")),
    }

    // `after=4` resumes at 5, which IS the floor — the oldest legal resume point.
    match raw_status(host, "GET", "/ch-retained/-/pull?after=4", Vec::new(), b"").await? {
        200 => {}
        410 => {
            return Err("`after=4` against floor 5 faulted; resuming after 4 delivers 5 onwards, \
                        which is exactly the floor, so this is the oldest LEGAL cursor and \
                        refusing it turns a conformant reader away"
                .into())
        }
        s => return Err(format!("`after=4` answered {s}, expected 200")),
    }
    Ok(vec![fault("pull", 410)])
}

/// A batch over the advertised `maxBatch` → 422 `limit-exceeded`. Covers op/push/fault/422.
///
/// THE TWO BOUNDS MUST NOT BE CONFLATED, and this case asserts both sides of that. `maxBatch` is
/// the HARD bound: exceeding it is `limit-exceeded`, fixed by shrinking the request. `window` is
/// the SOFT admission credit, and rc2 is explicit that exceeding it "is soft and temporal, not an
/// error" — it rides the ack as `credit: 0` and a `Deferred` tail. This subject advertises
/// `maxBatch: 4` and `window: 2`, so a batch of 3 must SUCCEED with a deferred tail while a batch
/// of 5 is refused. A binding that answered 422 for a full window would turn normal flow into a
/// fault, and only the three-event half of this case would catch it.
async fn a_batch_over_max_batch_is_limit_exceeded_422(
    r: &RemoteScope,
    host: &str,
) -> Result<Vec<SurfaceId>, String> {
    let ch = seed_channel(r, "ch-bounded", "duplex", serde_json::json!({})).await?;

    let five = (1..=5)
        .map(|n| format!("{{\"body\":{{\"n\":{n}}}}}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let (status, code) = raw_problem(
        host,
        "POST",
        "/ch-bounded/-/push",
        ctype("application/jsonl"),
        five.as_bytes(),
    )
    .await?;
    match (status, code.as_str()) {
        (422, "limit-exceeded") => {}
        (422, c) => return Err(format!("422 but the code was `{c}`, not limit-exceeded")),
        (s, c) => return Err(format!("expected 422 limit-exceeded for a batch of 5 over maxBatch 4, got {s} / {c}")),
    }

    // AND THE SOFT BOUND IS NOT A FAULT: three events into a window of two is a success with a
    // deferred tail and `credit: 0`.
    let three: Vec<PushEvent> = (1..=3)
        .map(|n| PushEvent {
            ordinal: None,
            body: RawJson(Bytes::from(format!(r#"{{"n":{n}}}"#).into_bytes())),
        })
        .collect();
    let ack = r
        .push(&ch, &three)
        .await
        .map_err(|e| format!("a batch of 3 within maxBatch must not fault: {e:?}"))?
        .value
        .ok_or("push of 3 returned no ack")?;
    if !ack.results.contains(&PushResult::Deferred) {
        return Err(format!(
            "three events into a window of 2 returned {:?}; the third must be Deferred, which is \
             backpressure and not an error",
            ack.results
        ));
    }
    if ack.credit != 0 {
        return Err(format!(
            "a deferred tail came back with credit {}; `credit: 0` is the hold signal, and without \
             it the pusher re-offers straight into the same full window",
            ack.credit
        ));
    }
    Ok(vec![fault("push", 422)])
}

/// `push` to a TERMINAL channel → 409. Covers op/push/fault/409.
///
/// THE STATUS IS DERIVED AND THE CASE SAYS SO. core.lumen#push states only "A terminal
/// (closed/failed) channel faults" — no status, no code. `push` declares `[405, 409, 422]`; 405 is
/// the direction fault and 422 the `maxBatch` bound, both named outright, so a terminal channel can
/// only be the 409. The code `channel-closed` is this binding's own naming for the same reason, and
/// deliberately NOT `constraint-violation`, which models uniqueness, cycles and cardinality — a
/// closed channel is none of those.
///
/// So this case asserts the STATUS and not the code: the status is reachable by elimination from
/// the spec, and asserting a code the spec does not name would pin a guess as though it were
/// ruled.
async fn push_to_a_terminal_channel_409(r: &RemoteScope, host: &str) -> Result<Vec<SurfaceId>, String> {
    seed_channel(r, "ch-closed", "duplex", serde_json::json!({ "closed": true })).await?;
    let _ = r;
    match raw_status(
        host,
        "POST",
        "/ch-closed/-/push",
        ctype("application/jsonl"),
        br#"{"body":{"n":1}}
"#,
    )
    .await?
    {
        409 => Ok(vec![fault("push", 409)]),
        200 => Err("a terminal channel ACCEPTED an event; rc2 says a closed/failed channel faults"
            .into()),
        s => Err(format!("expected 409 pushing to a terminal channel, got {s}")),
    }
}

/// An invalid `?limit=` on `pull` → 400 `invalid-parameter`. Covers op/pull/fault/400.
///
/// The same D.8 shape as `list` and `revisions` — "AN INVALID PARAMETER VALUE" — reached through
/// the one `parse_limit` every read shares, which is why it needs no separate producer.
async fn pull_with_an_invalid_limit_400(r: &RemoteScope, host: &str) -> Result<Vec<SurfaceId>, String> {
    seed_channel(r, "ch-limit", "duplex", serde_json::json!({})).await?;
    let _ = r;
    let (status, code) =
        raw_problem(host, "GET", "/ch-limit/-/pull?limit=abc", Vec::new(), b"").await?;
    match (status, code.as_str()) {
        (400, "invalid-parameter") => {}
        (s, c) => return Err(format!("expected 400 invalid-parameter on pull, got {s} / {c}")),
    }
    // A VALID limit must still be honored, or a guard that refused every limit would pass above.
    match raw_status(host, "GET", "/ch-limit/-/pull?limit=1", Vec::new(), b"").await? {
        200 => Ok(vec![fault("pull", 400)]),
        s => Err(format!("`?limit=1` on pull answered {s}; a valid limit must be honored")),
    }
}

/// `pull` IS THE ONE READ THAT ADMITS `sse`, and the stub must say so with its STATUS.
///
/// [[core.lumen#Transport]] is normative: "`sse` transport is valid ONLY on a live source (pull); a
/// snapshot read (list/query/revisions/export) refuses `format=sse` and faults `400`". The snapshot
/// half is covered by `the_format_header_refusals`, which walks `list`, `revisions` and `export`.
///
/// WITHOUT THIS CASE THAT COVERAGE IS HONEST BY ACCIDENT. A binding that refused `sse` on EVERY op
/// passes every existing `format` arm, because no case asks the one op where `sse` is legal. Those
/// refusals prove `sse` is rejected somewhere; only this proves it is rejected for the right reason.
///
/// THREE OUTCOMES, ALL REACHABLE, AND ONLY ONE HONEST:
///   - `200` + a page: the rc2 silent substitution. The caller asked for a live stream and got a
///     window, with nothing on the wire saying the transport was swapped.
///   - `400 invalid-parameter`: the SNAPSHOT answer, applied to the op the spec exempts by name.
///     This is what a binding that reused `refuse_format` uniformly would return.
///   - `501 not-implemented`: the honest stub. The transport is recognised and declined.
///
/// CLAIMS NO ROW, and the reason is a question I am NOT ruling: `501` is not among `pull`'s declared
/// faults (`[400,404,405,410]`). A plausible ruling -- that `not-implemented` is a protocol-level
/// status no op enumerates, as `500` is -- would make this behaviour correct exactly as it stands,
/// so it is evidence for a question rather than a defect to fix here.
/// CLOSES WHEN: Donna rules whether `501` is declared per-op or protocol-wide. Per-op, `pull` gains
/// a `501` row and this case claims it; protocol-wide, this note goes and the assertion is unchanged.
async fn pull_is_the_one_read_that_admits_sse(
    r: &RemoteScope,
    host: &str,
) -> Result<Vec<SurfaceId>, String> {
    seed_channel(r, "ch-sse", "duplex", serde_json::json!({})).await?;
    let fmt = |v: &str| vec![("format".to_string(), v.to_string())];

    // The CODE is pinned alongside the status: `501` alone would not tell "this transport is
    // declined" from any other unimplemented thing on the same path.
    let (status, code) = raw_problem(host, "GET", "/ch-sse/-/pull", fmt("sse"), b"").await?;
    match (status, code.as_str()) {
        (501, "not-implemented") => {}
        (200, _) => {
            return Err("`pull` with `format: sse` answered 200 — the caller asked for a live \
                        stream and was served a window. That is the silent substitution the \
                        `format` header exists to prevent, and it is invisible to a client that \
                        trusts the status."
                .into())
        }
        (400, c) => {
            return Err(format!(
                "`pull` with `format: sse` answered 400 / `{c}`, which is the SNAPSHOT answer. \
                 [[core.lumen#Transport]] exempts `pull` by name — sse is valid ONLY on a live \
                 source — and a uniform `refuse_format` over every read produces exactly this."
            ))
        }
        (s, c) => {
            return Err(format!(
                "`pull` with `format: sse` answered {s} / `{c}`; expected 501 `not-implemented`. \
                 See this case's note on whether 501 is declared per-op."
            ))
        }
    }

    // THE DISCRIMINATOR. Without it the arm above also passes for a `pull` that is broken for every
    // `format`, and then the refusal says nothing about the transport.
    for ok in ["page", ""] {
        let h = if ok.is_empty() { Vec::new() } else { fmt(ok) };
        let st = raw_status(host, "GET", "/ch-sse/-/pull", h, b"").await?;
        if st != 200 {
            return Err(format!(
                "`pull` with format {:?} answered {st}, so the `sse` refusal above says nothing \
                 about the transport — this op declines every `format`",
                if ok.is_empty() { "absent" } else { ok }
            ));
        }
    }

    Ok(Vec::new())
}


// ---- the capability duals, against a subject that advertises a BOUND ---------------------------

/// `create/422`, `put/422` and `patch/422` — the enforce side of three capability duals.
///
/// THESE WERE NOT UNCOVERED FOR WANT OF A CASE. They were unreachable against the permissive
/// reference, which advertises `ifMatch`, `ifAbsent` and `clientProposedId` all TRUE: there was
/// nothing for it to refuse, so no request could produce the fault. That is a property of the
/// SUBJECT, not of the suite — and the fix is a second subject, not a cleverer request.
///
/// `InMemScope::restricted` narrows the ADVERTISEMENT and keeps the behaviour, which is what makes
/// the pair honest: the store still honors a guard handed to it directly, so a 422 here proves the
/// BINDING read the capability record rather than that the store lost a feature.
///
/// NOT THE SAME FAULT AS AN OUT-OF-VOCABULARY GUARD, and the codes are asserted to keep them
/// apart. `If-None-Match` on `patch` is `400`: `ifAbsent` is not a field of `PatchCaps` at all, so
/// no advertisement could offer or refuse it. `If-Match` on a `put` advertising `ifMatch: false` is
/// `422`: the field exists, this scope declines it, and the caller fixes the request by dropping
/// the guard. Status alone cannot tell those apart on an op that declares both — the `code` can.
async fn the_capability_duals_are_refused_422(host: &str) -> Result<Vec<SurfaceId>, String> {
    let mut covered = Vec::new();

    // A proposed id against `clientProposedId: false`.
    // THE PROPOSED ID RIDES THE BODY, not a query param — `WireCreateRequest.id`. The first
    // version of this case sent `?id=proposed`, which the binding ignores, so the create SUCCEEDED
    // with 201 and the anti-vacuity guard in `record()` caught it: "the producer under test is
    // absent, not merely wrong". That guard exists for exactly this, and it is the second time
    // today a hand-written wire shape cost a run.
    let (status, code) = raw_problem(
        host,
        "POST",
        "/-/create",
        ctype("application/json"),
        br#"{"kind":"note","type":{"scope":"this","id":"BeadType:note"},"id":{"scope":"this","id":"proposed"},"body":{},"metadata":{}}"#,
    )
    .await?;
    match (status, code.as_str()) {
        (422, "limit-exceeded") => covered.push(fault("create", 422)),
        (201, _) => {
            return Err("a caller-proposed id was ACCEPTED by a scope advertising \
                        `clientProposedId: false`; the dual requires it refused, and silently \
                        minting a different id hands back a Location the caller never asked for"
                .into())
        }
        (s, c) => return Err(format!("expected 422 limit-exceeded for a proposed id, got {s} / {c}")),
    }

    // Seed through the path that the restricted scope DOES advertise, so the put/patch cases are
    // about the guard and not about a missing resource.
    let seeded = raw_status(
        host,
        "PUT",
        "/dual-target",
        ctype("application/json"),
        br#"{"kind":"note","type":{"scope":"this","id":"BeadType:note"},"body":{},"metadata":{}}"#,
    )
    .await?;
    if seeded != 200 {
        return Err(format!("seed put answered {seeded}; an UNGUARDED put must still work"));
    }

    // `If-Match` against `ifMatch: false`, on put and on patch.
    for (op_name, method, target, ct, body) in [
        ("put", "PUT", "/dual-target", "application/json",
         br#"{"kind":"note","type":{"scope":"this","id":"BeadType:note"},"body":{},"metadata":{}}"#.as_slice()),
        ("patch", "PATCH", "/dual-target", "application/json-patch+json",
         br#"[{"op":"replace","path":"/body/text","value":"x"}]"#.as_slice()),
    ] {
        let mut headers = ctype(ct);
        headers.push(("if-match".into(), "some-rev".into()));
        let (status, code) = raw_problem(host, method, target, headers, body).await?;
        match (status, code.as_str()) {
            (422, "limit-exceeded") => covered.push(fault(op_name, 422)),
            (412, _) => {
                return Err(format!(
                    "{op_name} answered 412 for an If-Match against `ifMatch: false`. 412 says the \
                     guard was EVALUATED and failed, so the caller retries with a fresher rev for \
                     ever; the dual requires 422, which says the guard is not offered here"
                ))
            }
            (s, c) => {
                return Err(format!(
                    "expected 422 limit-exceeded for If-Match on {op_name}, got {s} / {c}"
                ))
            }
        }
    }

    // THE OUT-OF-VOCABULARY GUARD STILL ANSWERS 400 ON THE SAME SUBJECT, which is what stops this
    // case being satisfied by a binding that 422s every header it does not like.
    let mut headers = ctype("application/json-patch+json");
    headers.push(("if-none-match".into(), "*".into()));
    let (status, _) = raw_problem(
        host,
        "PATCH",
        "/dual-target",
        headers,
        br#"[{"op":"replace","path":"/body/text","value":"x"}]"#,
    )
    .await?;
    if status != 400 {
        return Err(format!(
            "`If-None-Match` on patch answered {status}; `ifAbsent` is not a field of `PatchCaps` \
             at all, so it is an input patch does not define (400) and NOT an unadvertised bound \
             (422). Collapsing them tells a client to stop using a parameter that is merely \
             unavailable here"
        ));
    }

    Ok(covered)
}


// ---- harness ----------------------------------------------------------------

/// Run a gate body on a thread with a LARGE STACK, because the default one is not big enough.
///
/// `collect_cases` awaits ~35 case futures in sequence, and async lowering makes the enclosing
/// future large enough to hold them — it does not reuse the space of a completed await. The suite
/// was already close to the 2 MiB default: adding ONE case aborted the whole binary with
///
///     thread 'tier1_gate' has overflowed its stack
///     fatal runtime error: stack overflow, aborting        (SIGABRT, exit 134)
///
/// which is not a test failure. No case name, no assertion, no coverage report — the process dies
/// before the gate can say anything, and `cargo test` reports it as the TEST BINARY failing. I lost
/// two separate investigations to this: once chasing a probe that "printed nothing", once reading it
/// as a defect in the case I had just written. Both times the code was fine and the stack was not.
///
/// THE CEILING IS THE POINT. The gate's whole job is to grow a case at a time, so a limit that
/// turns the next case into an abort is a blocker on the work, not a quirk — and it fails in the
/// least legible way available, since a stack overflow looks like a crash in whatever was added
/// last. 32 MiB is far past what the current suite needs; the alternative (boxing every case future
/// at 64 call sites) buys the same thing and has to be remembered by every future author.
fn on_a_big_stack<F>(body: F)
where
    F: FnOnce() + Send + 'static,
{
    std::thread::Builder::new()
        .stack_size(32 * 1024 * 1024)
        .spawn(body)
        .expect("spawn gate thread")
        .join()
        .expect("gate thread panicked");
}

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(f)
}

#[test]
fn tier1_gate() {
    on_a_big_stack(|| block_on(tier1_gate_inner()));
}

async fn tier1_gate_inner() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let addr = listener.local_addr().expect("local addr").to_string();
    let server = Server::new(InMemScope::new("gate"));

    // A SECOND SUBJECT, because three declared rows are unreachable against the first. The
    // permissive reference advertises every guard as supported, so a `limit-exceeded` has nothing
    // to refuse; `InMemScope::restricted` advertises `ifMatch`, `ifAbsent` and `clientProposedId`
    // as false while implementing the same store. Coverage is the UNION over both, because a row
    // is a row about the binding and not about which subject provoked it.
    let rlistener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback (restricted)");
    let raddr = rlistener.local_addr().expect("local addr").to_string();
    let rserver = Server::new(InMemScope::restricted("gate-restricted"));

    tokio::select! {
        r = server.serve(listener) => panic!("server stopped before cases finished: {r:?}"),
        r = rserver.serve(rlistener) => panic!("restricted server stopped early: {r:?}"),
        () = run_cases(addr, raddr) => {}
    }
}

/// ANTI-VACUITY BACKSTOP: every case must FAIL against a subject that advertises the full primitive
/// set and implements none of it, and ZERO denominator rows may be reported covered.
///
/// This is the only structural defence available, and it is needed because `record()` sees a case's
/// verdict, never the `BdpResult` behind it — so it cannot itself refuse a `not_implemented`. The
/// signal is an `Ok`, by design: the server answers `501` for an unimplemented op and the client
/// converts that to `Ok(BdpResult::not_implemented())`, because `RemoteScope` is itself a
/// `BdpScope`. A case that merely propagates errors therefore PASSES against a subject that does
/// nothing, and the false green is the EASY path rather than an edge case.
///
/// That is not hypothetical: `delete+erased` was vacuous for exactly this reason, passing with its
/// seed never having run and falsely claiming two rows. Per-case `not_implemented` checks are the
/// first line, but they rely on every future author remembering. This test does not.
///
/// Adapted from Shelly's `null_subject.rs` on the reference backends, which reports 0 pass / 38
/// fail against her grid.
#[test]
fn no_case_passes_against_a_subject_that_implements_nothing() {
    on_a_big_stack(|| block_on(no_case_passes_against_a_subject_that_implements_nothing_inner()));
}

async fn no_case_passes_against_a_subject_that_implements_nothing_inner() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
    let addr = listener.local_addr().expect("local addr").to_string();
    let server = Server::new(NullScope);

    tokio::select! {
        r = server.serve(listener) => panic!("server stopped before cases finished: {r:?}"),
        (covered, failures) = collect_cases(addr) => {
            let denom = denominator();
            let allowed: BTreeSet<SurfaceId> = SCOPE_INDEPENDENT_ROWS
                .iter()
                .map(|(op, status)| SurfaceId::Fault((*op).to_string(), *status))
                .collect();

            let claimed: Vec<&SurfaceId> =
                covered.intersection(&denom).filter(|r| !allowed.contains(r)).collect();
            assert!(
                claimed.is_empty(),
                "VACUOUS CASES: {} scope-dependent denominator row(s) were reported covered by a \
                 scope that implements NOTHING: {}.\nEach of those cases passes without the \
                 behaviour it claims to verify. Make it reject a `not_implemented` response and \
                 verify its own seeds. If a row genuinely does not depend on the scope, add it to \
                 SCOPE_INDEPENDENT_ROWS with the reason — do not widen this assertion.",
                claimed.len(),
                render(&claimed)
            );

            // The allowlist must stay honest in the other direction too: a row listed as
            // scope-independent that NO LONGER passes here has become scope-dependent, and its
            // entry is now a lie that would mask a vacuous case.
            let stale: Vec<&SurfaceId> = allowed.difference(&covered).collect();
            assert!(
                stale.is_empty(),
                "SCOPE_INDEPENDENT_ROWS lists {} row(s) that the null scope did NOT produce: {}. \
                 They now depend on the scope, so remove them from the allowlist.",
                stale.len(),
                render(&stale)
            );

            assert!(
                !failures.is_empty(),
                "the null subject produced no failures at all — the harness is not running the cases"
            );
        }
    }
}

/// Rows the `Server` produces **before the scope is ever consulted**, so a null scope cannot and
/// should not make their cases fail. These are protocol-level faults, not store behaviour:
///
/// - `create/400` and `put/400` are JSON **body-parse** failures, raised in `do_create` / `do_put`
///   after routing has already succeeded (`bad CreateRequest: …`) — NOT malformed-id rejections.
///   The route-parsing `400`s (`Route::Unroutable`, and a bare `-` id segment) are real but no case
///   in this list uses them.
/// - `patch/415` is the request media-type check at the top of `do_patch`.
/// - `patch/400` and `delete/400` are the two new pre-scope rejections: the out-of-vocabulary
///   `If-None-Match` guard on either op, and a `patch` body that is not a JSON-Patch array. All
///   three are decided from the request alone — a guard the operation does not define, or a body
///   that is not the declared document shape, is malformed whatever the store holds — so they
///   belong here on the same ground as `create/400`, not as an exception to it.
///
/// This comment previously said "the four `400`s are malformed-id rejections decided in route
/// parsing" and "5 of the covered rows" — wrong on the count (there are two `400`s and three
/// entries) and wrong on the mechanism. It mattered because this prose is the ONLY record of why a
/// row is allowlisted: the tuple is `(&str, u16)` and cannot hold a reason, while the failure
/// message tells an author to "add it to SCOPE_INDEPENDENT_ROWS with the reason". An audit trail
/// that is already wrong about its own contents cannot show whether an entry is legitimate or was
/// added to silence a failure — which this comment itself calls defeating the whole test.
///
/// This list is a statement about the gate's own composition, surfaced by the anti-vacuity test
/// rather than assumed: **5 of the covered rows exercise the protocol layer, not the store.** The
/// test asserts this set exactly — both that nothing outside it survives a null scope, and that
/// everything in it still does. Adding an entry to silence a failure, rather than because the row
/// is genuinely produced pre-scope, defeats the whole test.
const SCOPE_INDEPENDENT_ROWS: &[(&str, u16)] = &[
    ("create", 400),
    ("delete", 400),
    // The BINDING refuses a malformed import before the scope is reached: a stream that does not
    // end with `ExportEnd`, a request that is not `application/jsonl`, and a strategy outside the
    // closed vocabulary are all decided in `do_import` by reading the request alone. So this row
    // is produced identically by a scope that implements nothing, exactly like its four
    // neighbours here. Its sibling `import/422` is NOT in this list and must not be: that one is
    // the capability dual and comes from the SCOPE refusing an advertised-false mode, so it is
    // scope-dependent and the backstop correctly leaves it alone. Two fault rows on one op, two
    // different producers — which is the distinction this list exists to make.
    ("import", 400),
    ("patch", 400),
    ("patch", 415),
    ("put", 400),
];

/// A subject that ADVERTISES every primitive and IMPLEMENTS none. `get` is the one mandatory trait
/// method, so it answers the not-implemented signal explicitly; everything else falls through to the
/// trait default, which does the same. Advertising the full set is the point: it makes the subject
/// claim conformance it does not have, which is the condition the cases must detect.
struct NullScope;

impl BdpScope for NullScope {
    /// A null SUBJECT still has to state its traits — they are what a trait-dependent case keys
    /// on, and refusing to state them would make this scope unreadable rather than merely
    /// unimplemented. `Versioned` + `Permanent` is the legal pair that lets such a case run at
    /// all, so any row it then claims is claimed on the strength of behaviour it did not provide.
    fn scope_capabilities(&self) -> ScopeCapabilities {
        ScopeCapabilities {
            storage_classes: vec![StorageClass::Ephemeral],
            revision_model: RevisionModel::Versioned,
            id_model: IdModel::Permanent,
        }
    }

    fn capabilities(&self) -> Vec<PrimitiveCapabilities> {
        vec![
            PrimitiveCapabilities::Get(GetCaps { selector: false }),
            PrimitiveCapabilities::Create(CreateCaps {
                server_allocates_id: true,
                client_proposed_id: true,
            }),
            PrimitiveCapabilities::Put(PutCaps { if_match: true, if_absent: true }),
            PrimitiveCapabilities::Patch(PatchCaps { if_match: true }),
            PrimitiveCapabilities::Delete(DeleteCaps { if_match: true }),
        ]
    }

    async fn get(
        &self,
        _r: &ResourceId,
        _selector: Option<&Selector>,
    ) -> Result<BdpResult<Representation>, BdpError> {
        Ok(BdpResult::not_implemented())
    }
}

async fn run_cases(addr: String, restricted_addr: String) {
    let (mut covered, mut failures) = collect_cases(addr).await;
    record(
        "capability duals (restricted subject)",
        &mut covered,
        &mut failures,
        the_capability_duals_are_refused_422(&restricted_addr),
    )
    .await;

    // ---- coverage report ----
    let denom = denominator();
    let covered_in_denom: BTreeSet<&SurfaceId> = covered.intersection(&denom).collect();
    let uncovered: Vec<&SurfaceId> = denom.difference(&covered).collect();

    eprintln!("\n=== BDP tier-1 gate ===");
    // DELIBERATELY NO COMMIT AND NO ROW COUNT HERE. This line used to read "pin: gastownhall/bdp
    // main @488a2d01 (v0.2.3; paths block sha256 4bf1225b…) — surface 54 rows", and every part of
    // that went stale: the surface has since been 47, 48 and 50, while the line kept printing 54
    // above a coverage figure computed live from the same file. A stale provenance claim on top of
    // a live measurement is worse than no claim, because it reads as the measurement's source.
    // The denominator is read from the working tree at run time, so the tree IS the pin; `git
    // rev-parse HEAD` names it, and nothing hand-written here can be more current than that.
    eprintln!("spec version: v0.2.3 (tier-1 surface)");
    eprintln!("denominator source: specs/generated/openapi/core.openapi.json (live, drift-gated)");
    eprintln!("surface: {} rows, derived at run time, not pinned here", denom.len());
    eprintln!("coverage: {}/{} surface rows", covered_in_denom.len(), denom.len());
    // WHAT THIS RATIO IS NOT. The denominator is the faults the generated OpenAPI DECLARES. The
    // spec also REQUIRES statuses that no declared set carries: D.8's 405 row (core.lumen:2084)
    // demands "patch where a Scope offers no patch", `patch` declares no 405, and core.lumen:1615
    // makes the refusal normative via `capability-not-supported`. Such a row cannot enter this
    // denominator, so no case can claim it and a full ratio would not report it.
    // 51/51 would therefore mean "every DECLARED fault is exercised", never "conformant".
    eprintln!(
        "  NB: declared faults only — the spec requires statuses outside this set (e.g. patch/405 \
         per D.8:2084 + core.lumen:1615), which no row here can carry"
    );
    let mut covered_sorted: Vec<&SurfaceId> = covered_in_denom.iter().copied().collect();
    covered_sorted.sort();
    eprintln!("  covered: {}", render(&covered_sorted));
    eprintln!("  uncovered ({}): {}", uncovered.len(), render(&uncovered));
    for row in &uncovered {
        let id = row.to_string();
        let why = RESIDUAL
            .iter()
            .find(|(r, _)| *r == id)
            .map(|(_, why)| *why)
            .unwrap_or("UNREGISTERED — no recorded blocker");
        eprintln!("    - {id}: {why}");
    }
    eprintln!("=======================\n");

    // A case that should pass but failed is a real wire-level regression — always fail.
    assert!(failures.is_empty(), "tier-1 cases failed:\n  {}", failures.join("\n  "));

    // FAILING CASES ARE REPORTED BEFORE THE RESIDUAL IS CHECKED, and the order is load-bearing.
    // It used to be the other way round, and a probe of mine made `op/patch` uncovered: the gate
    // reported "1 uncovered row(s) have no recorded blocker" and NEVER PRINTED the case failure
    // that caused it. A broken case is a wire-level regression and names the defect; its coverage
    // consequence is downstream and names only a symptom. Asserting the symptom first hides the
    // cause, so the ordering is part of the diagnosis, not housekeeping.
    // THE RESIDUAL IS REGISTERED IN BOTH DIRECTIONS. A new uncovered row must be explained, and an
    // entry whose row gets covered must be removed in the same change.
    let uncovered_ids: BTreeSet<String> = uncovered.iter().map(|r| r.to_string()).collect();
    let registered_ids: BTreeSet<String> = RESIDUAL.iter().map(|(r, _)| r.to_string()).collect();
    let unexplained: Vec<&String> = uncovered_ids.difference(&registered_ids).collect();
    assert!(
        unexplained.is_empty(),
        "{} uncovered row(s) have no recorded blocker: {:?}.\n\
         An uncovered row with no entry is indistinguishable from one nobody has looked at. Add it \
         to RESIDUAL with WHY no case reaches it and WHAT CLOSES IT.",
        unexplained.len(),
        unexplained
    );
    let expired: Vec<&String> = registered_ids.difference(&uncovered_ids).collect();
    assert!(
        expired.is_empty(),
        "RESIDUAL still records {} row(s) as unreachable that are now COVERED: {:?}.\n\
         The blocker closed and the entry is a false claim — remove it in the change that covered \
         the row.",
        expired.len(),
        expired
    );

    // fail-if-no-coverage — blocking only under BDP_GATE_STRICT while tier-1 is still being filled.
    if std::env::var("BDP_GATE_STRICT").is_ok() {
        assert!(
            uncovered.is_empty(),
            "BDP_GATE_STRICT: {} denominator rows uncovered:\n  {}",
            uncovered.len(),
            render(&uncovered)
        );
    }
}

/// Run every case and return what they covered and how they failed, WITHOUT asserting — so the same
/// list can be run against a deliberately broken subject by the anti-vacuity test above.
async fn collect_cases(addr: String) -> (BTreeSet<SurfaceId>, Vec<String>) {
    let remote = RemoteScope::connect(addr.clone()).await.expect("connect (caps discovery)");

    let mut covered: BTreeSet<SurfaceId> = BTreeSet::new();
    let mut failures: Vec<String> = Vec::new();

    record("create+get", &mut covered, &mut failures, create_then_get(&remote)).await;
    record("get/404", &mut covered, &mut failures, get_missing_404(&remote)).await;
    record("create/409", &mut covered, &mut failures, create_duplicate_409(&remote)).await;
    record("delete+erased", &mut covered, &mut failures, delete_then_erased(&remote)).await;
    record("patch/410", &mut covered, &mut failures, patch_tombstone_410(&remote)).await;
    record("put", &mut covered, &mut failures, put_target(&remote)).await;
    record("put/412", &mut covered, &mut failures, put_stale_guard_412(&remote)).await;
    record("put/409", &mut covered, &mut failures, put_if_absent_taken_409(&remote)).await;
    record("put/410", &mut covered, &mut failures, put_tombstone_410(&remote)).await;
    record(
        "put unguarded updates",
        &mut covered,
        &mut failures,
        put_unguarded_still_updates(&remote),
    )
    .await;
    record("patch", &mut covered, &mut failures, patch_ok(&remote)).await;
    record("patch/404", &mut covered, &mut failures, patch_missing_404(&remote)).await;
    record("patch/412", &mut covered, &mut failures, patch_stale_412(&remote)).await;
    record("delete/412", &mut covered, &mut failures, delete_stale_412(&remote)).await;
    record("delete/404", &mut covered, &mut failures, delete_never_existed_404(&remote)).await;
    record("delete idempotent", &mut covered, &mut failures, delete_twice_is_idempotent(&remote)).await;
    record("list", &mut covered, &mut failures, list_the_scopes_resources(&remote)).await;
    record(
        "filtered list refused",
        &mut covered,
        &mut failures,
        a_filtered_list_is_refused_not_ignored(&remote),
    )
    .await;
    record("export", &mut covered, &mut failures, export_is_jsonl_framed(&remote)).await;
    record(
        "advertises what it forwards",
        &mut covered,
        &mut failures,
        the_client_advertises_what_it_forwards(&remote),
    )
    .await;
    record("revisions", &mut covered, &mut failures, revisions_history_is_addressable(&remote)).await;
    record("revisions/404", &mut covered, &mut failures, revisions_never_existed_404(&remote)).await;
    record(
        "revisions survive retirement",
        &mut covered,
        &mut failures,
        revisions_survive_retirement(&remote),
    )
    .await;
    record("call", &mut covered, &mut failures, call_success(&remote)).await;
    record("call/409", &mut covered, &mut failures, call_declared_failure_409(&remote)).await;
    record(
        "call unresolvable never ran",
        &mut covered,
        &mut failures,
        call_unresolvable_operation_never_ran(&remote),
    )
    .await;
    record(
        "async call mints a pending handle",
        &mut covered,
        &mut failures,
        an_async_call_mints_a_pending_handle(&remote),
    )
    .await;
    record("cancel", &mut covered, &mut failures, cancel_a_running_handle(&remote)).await;
    record("cancel/404", &mut covered, &mut failures, cancel_absent_handle_404(&remote)).await;
    record("cancel/409", &mut covered, &mut failures, cancel_a_settled_handle_409(&remote)).await;
    record(
        "cancel of a non-handle",
        &mut covered,
        &mut failures,
        cancel_of_a_non_handle_does_not_resolve(&remote),
    )
    .await;
    record(
        "cancel refuses a pinned handle",
        &mut covered,
        &mut failures,
        cancel_refuses_a_pinned_handle(&remote),
    )
    .await;
    record(
        "list+revisions/400 invalid limit",
        &mut covered,
        &mut failures,
        an_invalid_limit_is_an_invalid_parameter_400(&addr),
    )
    .await;
    record(
        "export/400 ordinal resume",
        &mut covered,
        &mut failures,
        export_rejects_an_ordinal_resume_400(&addr),
    )
    .await;
    record(
        "export refuses where/select (regression guard, no new row)",
        &mut covered,
        &mut failures,
        export_refuses_projection_parameters_400(&addr),
    )
    .await;
    record(
        "a no-change write keeps the revision (obligation, no new row)",
        &mut covered,
        &mut failures,
        a_no_change_write_is_a_no_op(&remote),
    )
    .await;
    record(
        "a bare Rev return is a self-describing object (obligation, no new row)",
        &mut covered,
        &mut failures,
        a_bare_rev_return_is_a_self_describing_object(&addr),
    )
    .await;
    record(
        "page envelope + walk",
        &mut covered,
        &mut failures,
        every_read_returns_a_page_and_a_walk_terminates(&remote, &addr),
    )
    .await;
    record(
        "capability surface shape",
        &mut covered,
        &mut failures,
        the_capability_surface_is_the_specs_shape(&addr),
    )
    .await;
    record(
        "emittable problem codes",
        &mut covered,
        &mut failures,
        every_emittable_problem_code_is_registered(&addr),
    )
    .await;
    record(
        "pull/404 absent channel",
        &mut covered,
        &mut failures,
        pull_of_an_absent_channel_404(&remote, &addr),
    )
    .await;
    record(
        "format header refusals",
        &mut covered,
        &mut failures,
        the_format_header_refusals(&remote, &addr),
    )
    .await;
    record(
        "closed input + retired divergence",
        &mut covered,
        &mut failures,
        the_create_input_is_closed_and_retired_diverges(&addr),
    )
    .await;
    record("channel round trip", &mut covered, &mut failures, a_duplex_channel_round_trips(&remote)).await;
    record(
        "pull/405 sink",
        &mut covered,
        &mut failures,
        pull_on_a_sink_is_not_pullable_405(&remote, &addr),
    )
    .await;
    record(
        "push/405 source",
        &mut covered,
        &mut failures,
        push_on_a_source_is_not_pushable_405(&remote, &addr),
    )
    .await;
    record(
        "pull/410 retention floor",
        &mut covered,
        &mut failures,
        a_cursor_below_the_retention_floor_expires_410(&remote, &addr),
    )
    .await;
    record(
        "push/422 maxBatch",
        &mut covered,
        &mut failures,
        a_batch_over_max_batch_is_limit_exceeded_422(&remote, &addr),
    )
    .await;
    record(
        "push/409 terminal channel",
        &mut covered,
        &mut failures,
        push_to_a_terminal_channel_409(&remote, &addr),
    )
    .await;
    record(
        "pull/400 invalid limit",
        &mut covered,
        &mut failures,
        pull_with_an_invalid_limit_400(&remote, &addr),
    )
    .await;
    record(
        "pull format=sse (the one legal sse read)",
        &mut covered,
        &mut failures,
        pull_is_the_one_read_that_admits_sse(&remote, &addr),
    )
    .await;
    record("import", &mut covered, &mut failures, import_round_trips_an_export(&remote)).await;
    record("import/400 truncated", &mut covered, &mut failures, import_truncated_stream_400(&addr)).await;
    record(
        "import/400 media type",
        &mut covered,
        &mut failures,
        import_wrong_media_type_400(&addr),
    )
    .await;
    record(
        "import/422 history-restore",
        &mut covered,
        &mut failures,
        import_history_restore_is_refused_422(&addr),
    )
    .await;
    record(
        "import unknown strategy",
        &mut covered,
        &mut failures,
        import_unknown_strategy_is_malformed(&addr),
    )
    .await;
    record("create/400 (raw)", &mut covered, &mut failures, create_malformed_400(&addr)).await;
    record("put/400 (raw)", &mut covered, &mut failures, put_malformed_400(&addr)).await;
    record(
        "patch/400 non-array body (raw)",
        &mut covered,
        &mut failures,
        patch_non_array_body_400(&addr),
    )
    .await;
    record(
        "patch/400 out-of-vocabulary guard (raw)",
        &mut covered,
        &mut failures,
        patch_out_of_vocabulary_guard_400(&addr),
    )
    .await;
    record("patch/415 (raw)", &mut covered, &mut failures, patch_wrong_media_type_415(&addr)).await;
    record(
        "patch/415 absent ctype (raw)",
        &mut covered,
        &mut failures,
        patch_absent_media_type_415(&addr),
    )
    .await;
    record(
        "patch right media type (raw)",
        &mut covered,
        &mut failures,
        patch_correct_media_type_is_accepted(&addr),
    )
    .await;
    // LAST ON PURPOSE. It targets `/patch-target` so that a `400` there proves the GUARD fired
    // rather than a `404` standing in for it — but if the guard check were ever removed, the
    // request would succeed and retire the id. Running it after the last case that needs that id
    // keeps the failure to this one case instead of cascading.
    record(
        "delete/400 out-of-vocabulary guard (raw)",
        &mut covered,
        &mut failures,
        delete_out_of_vocabulary_guard_400(&addr),
    )
    .await;

    (covered, failures)
}

/// THE ABSENCE BEHIND ALL THREE IS NOW GROUNDED OVER THE WHOLE POPULATION, not over where I expected
/// to find it. Each entry below originally rested on a search of the op's own section plus D.8 — a
/// negative claim from a partial sweep, which is the weakest thing I ship. The spec owner put the
/// principle sharply while correcting a different argument of mine: a claim grounded on "the rule that
/// would permit it does not apply" is weaker than one grounded on "the rule that forbids it does",
/// because a negative depends on the absence continuing and nothing watches an absence.
///
/// So I enumerated instead. core.lumen mentions `409` on 26 lines, and every one is either a
/// DECLARATION (an `openapi` annotation's `problem.status` list) or one of exactly THREE producers:
///
///   - `call`'s declared failure — `Outcome.failure` is 409 (842, 858, 900, 901, 903)
///   - `identity-taken` — a `create` fail-if-exists collision, or a `put` under `If-None-Match: *`
///     claiming a spent id (1081, 1106, 1121, 1158, 1966, 1970, 2062, 2066)
///   - `cancel` of an already-settled handle (915, covered by its own case)
///
/// None of the three reaches `delete`, `import` or `patch`. The declarations at 1134 (patch), 1160
/// (delete) and 1535 (import) therefore stand over nothing — which is the shared root, stated now
/// from the complete set of 409 mentions rather than from the three places I thought to look.
///
/// THE METHOD IS THE POINT: enumerate the population and classify every member, rather than searching
/// where the answer is expected to be. A narrow search can confirm a hypothesis and cannot establish
/// an absence — the same asymmetry that made a peer's `conf-pg`-on-the-same-line grep report two
/// defect sites in a tree that held five.
///
/// THE RESIDUAL: every uncovered denominator row, why no case reaches it, and what closes it.
///
/// These three were a single sentence in my head — the rest is blocked on the 409 code vocabulary —
/// and I was about to report it that way. Reading each one's producer says they are THREE DIFFERENT
/// BLOCKERS that happen to share a status. The shared 409 is a coincidence of the many-to-one map
/// from conditions onto statuses, which is the same reason the denominator counts faults and cannot
/// count obligations.
///
/// ASSERTED IN BOTH DIRECTIONS below: an uncovered row with no entry fails, and an entry whose row
/// becomes covered fails. So the residual cannot grow silently and an entry cannot outlive its
/// blocker.
const RESIDUAL: &[(&str, &str)] = &[
    (
        "op/patch/fault/409",
        "NO CORE PRODUCER PINNED AT 409 — and I have now been wrong about this row's blocker three \
         times, each time with the claim true and the reasoning stale. (1) I said no code spelling \
         was available; CATR1=C made the code ADVISORY, so the spelling blocks nothing. (2) I said \
         the immutable-envelope condition would ground it, after showing that the cycle-closing \
         framing names a GRAPH-MODEL producer and graph is corelib, not core. (3) That condition is \
         Core but its STATUS IS UNPINNED. core.lumen:1133 is normative and says a patch naming an \
         envelope member (`/id`, `/provenance`, `/createdAt`, `/retired`), the whole-document root, \
         or a `computed`/`serviceManaged` property FAULTS — and names no status at all. patch \
         declares [400,404,409,410,412,415,422], so `faults` does not select 409. THE EVIDENCE LEANS \
         400, from an asymmetry in the spec rather than from taste: core.lumen:472 says a read-only \
         member supplied on a write (`create`/`put`) is IGNORED, NEVER FAULTED, so a get-put round- \
         trip stays safe. The fault is therefore specific to patch, where the caller NAMES an \
         unwritable path — a defective patch document, which reads as `400 invalid-parameter` rather \
         than a state conflict. It is not 422 either, by the membership test that 422 holds iff \
         shrinking the request fixes it: removing the offending op is correcting an error, not \
         shrinking to a bound. SO ALL THREE 409 ROWS ARE ONE SHAPE, not three, and my earlier report \
         that patch/409 was the coverable one is RETRACTED: each is a declared 409 with no Core \
         producer pinned at 409. The spec owner is putting them to Donna as a single producer/status \
         question. CLOSES WHEN: Donna pins a Core 409 producer for any of the three — pinning the \
         read-only-member refusal to 409 would do it for patch — or rules all three undeclared.",
    ),
    (
        "op/delete/fault/409",
        "UNREACHABLE BY CONSTRUCTION, and the spec owner leans UNDECLARE. delete's only 409 producer \
         is prose: a service that enforces referential integrity faults when inbound references pin \
         the resource — ADVERTISED, NOT BASE. `DeleteCaps` carries exactly two fields, `ifRevision` \
         and `precondition`, neither of which advertises RI enforcement, so nothing in the \
         capability surface can advertise the behaviour and no scope can legitimately reach the row. \
         The owner's reading: the producer is not ABSENT but CORELIB — the relationship/graph model \
         it belongs to is a corelib surface, not Core — so Core should not declare a 409 for a fault \
         the base protocol does not own. Same shape as Ruling D's 413/414. The alternative is to \
         make RI a Core capability, which pulls a graph-model feature into Core against the spec's \
         own line. Either way it moves the denominator, so it is Donna's. CORRECTION TO MY OWN \
         EVIDENCE: this entry said there was no `DeleteCaps` record in core.lumen at all. False. My \
         grep was for `record DeleteCaps`, and core.lumen declares caps as `type` — `^record [A-Z]` \
         matches ZERO lines in the whole file while `^type [A-Z]*Caps` matches 12, so that pattern \
         could only ever return absence, for any caps type I asked it about. The conclusion survived \
         because the two real fields do not advertise RI; the stated evidence did not. CLOSES WHEN: \
         Donna rules undeclare, or a capability field is added.",
    ),
    (
        "op/import/fault/409",
        "NO REQUEST-LEVEL PRODUCER, and the spec owner leans UNDECLARE. Import's only conflict \
         notion is the per-record `Conflicted` fate, which counts toward `acceptedThrough` and rides \
         a SUCCESSFUL `ImportAck` — a 200. `dedup` skips, `idRoot` remaps, and an un-absorbed \
         collision is reported `Conflicted` in the results, all at 200. D.8's 409 row names `call`, \
         `create` and `put` under `If-None-Match`, not import, and Donna's ordinal-key ruling is \
         about that per-record fate rather than a request fault. So the `identity-taken` inheritance \
         I floated does not happen: import absorbs collisions instead of faulting them. The owner \
         searched independently for a request-level 409 producer and found none, and carries one \
         caveat: IF a cross-import conflict — two imports crossing on one `importId` — was meant to \
         be a request 409. Nothing names one, and the importId's job is described as keeping imports \
         from crossing, not as faulting when they do. CLOSES WHEN: Donna rules undeclare, or that \
         cross-import fault is named.",
    ),
];

/// WHY NO UNDECLARATION IS PROPOSED HERE, though two of the three look like candidates.
///
/// I published exactly that recommendation for `patch/409` once (gastownhall/bdp#453) and retracted
/// it: the condition did exist, in the description rather than a `normative:` line, and I had
/// reached for a ruling that lowered my own denominator. A row I cannot reach and a row that should
/// not exist look identical from inside the gate, and only one of them is mine to act on. So the
/// register states the blocker and names what closes it, and the ruling stays with the owner.

fn render(rows: &[&SurfaceId]) -> String {
    if rows.is_empty() {
        return "(none)".into();
    }
    rows.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(", ")
}
