//! Wire DTOs (serde) mirroring the BDP JSON rep at pin `b555931c`, plus conversions to/from
//! the runtime-native `bdp_primitives` types. The conversions are where trait↔wire friction
//! shows up — each awkward spot is tagged `FRICTION:` and logged in `NOTES.md`.
//!
//! DTOs live HERE, not in `bdp-primitives`: the shared trait stays free of serde/wire concerns,
//! and this crate owns the whole impedance-matching layer.

use std::sync::Arc;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use bdp_primitives as p;

// ---- raw JSON passthrough -------------------------------------------------------

fn raw_to_value(r: &p::RawJson) -> Box<RawValue> {
    let s = std::str::from_utf8(&r.0).unwrap_or("").trim();
    let text = if s.is_empty() { "{}" } else { s };
    RawValue::from_string(text.to_string())
        .unwrap_or_else(|_| RawValue::from_string("null".to_string()).unwrap())
}

fn value_to_raw(v: &RawValue) -> p::RawJson {
    p::RawJson(Bytes::copy_from_slice(v.get().as_bytes()))
}

fn opt_raw_to_value(r: &p::RawJson) -> Option<Box<RawValue>> {
    if r.0.is_empty() {
        None
    } else {
        Some(raw_to_value(r))
    }
}

// ---- ResourceId <-> { scope?, id, rev? } ---------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireResourceId {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scope: Option<String>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rev: Option<String>,
}

impl WireResourceId {
    pub fn from_trait(r: &p::ResourceId) -> Self {
        Self {
            scope: match &r.scope {
                p::Scope::This => None, // FRICTION: `This` has no wire token; absence = operating scope
                p::Scope::Web => Some("web".to_string()),
                p::Scope::Named(n) => Some(n.0.to_string()),
            },
            id: r.id.0.to_string(),
            rev: r.rev.as_ref().map(|rv| rv.0.to_string()),
        }
    }
    pub fn to_trait(&self) -> p::ResourceId {
        p::ResourceId {
            scope: match self.scope.as_deref() {
                None => p::Scope::This,
                Some("web") => p::Scope::Web,
                Some(other) => p::Scope::Named(p::ScopeName(Arc::from(other))),
            },
            id: p::Id(Arc::from(self.id.as_str())),
            rev: self.rev.as_ref().map(|s| p::Rev(Arc::from(s.as_str()))),
        }
    }
}

// ---- CreateRequest (body of create/put) ----------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireCreateRequest {
    pub kind: String,
    #[serde(rename = "type")]
    pub r#type: WireResourceId,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub id: Option<WireResourceId>, // caller-proposed identity (unpinned)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub properties: Option<Box<RawValue>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub metadata: Option<Box<RawValue>>,
}

impl WireCreateRequest {
    pub fn from_body(id: Option<&p::Id>, body: &p::CreateBody) -> Self {
        Self {
            kind: body.kind.0.to_string(),
            r#type: WireResourceId::from_trait(&body.r#type),
            id: id.map(|i| WireResourceId { scope: None, id: i.0.to_string(), rev: None }),
            properties: opt_raw_to_value(&body.properties),
            metadata: opt_raw_to_value(&body.metadata),
        }
    }
    /// The proposed id (if any) and the CreateBody. FRICTION: the wire carries `id` inside the
    /// body AND (for put) in the URL; the trait splits `create(Option<Id>, CreateBody)` vs
    /// `put(ResourceId, CreateBody)`, so the id lives in different places per op.
    pub fn into_body(self) -> (Option<p::Id>, p::CreateBody) {
        let proposed = self.id.map(|w| p::Id(Arc::from(w.id.as_str())));
        let body = p::CreateBody {
            kind: p::Kind(Arc::from(self.kind.as_str())),
            r#type: self.r#type.to_trait(),
            properties: self.properties.as_deref().map(value_to_raw).unwrap_or_default(),
            metadata: self.metadata.as_deref().map(value_to_raw).unwrap_or_default(),
        };
        (proposed, body)
    }
}

// ---- Provenance -----------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireProvenance {
    pub principals: Vec<Box<RawValue>>,
    pub inception: String,
    #[serde(rename = "committedAt")]
    pub committed_at: String,
    #[serde(rename = "previousRevision", skip_serializing_if = "Option::is_none", default)]
    pub previous_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub message: Option<String>,
}

impl WireProvenance {
    pub fn from_trait(pr: &p::Provenance) -> Self {
        Self {
            principals: pr.principals.iter().map(|pp| raw_to_value(&pp.0)).collect(),
            inception: match pr.inception {
                p::Inception::Create => "create",
                p::Inception::Import => "import",
                p::Inception::Revive => "revive",
                p::Inception::Unknown => "unknown",
            }
            .to_string(),
            committed_at: pr.committed_at.0.to_string(),
            previous_revision: pr.previous_revision.as_ref().map(|r| r.0.to_string()),
            message: pr.message.clone(),
        }
    }
    pub fn to_trait(&self) -> p::Provenance {
        p::Provenance {
            principals: self.principals.iter().map(|v| p::Principal(value_to_raw(v))).collect(),
            inception: match self.inception.as_str() {
                "create" => p::Inception::Create,
                "import" => p::Inception::Import,
                "revive" => p::Inception::Revive,
                _ => p::Inception::Unknown,
            },
            committed_at: p::Timestamp(Arc::from(self.committed_at.as_str())),
            message: self.message.clone(),
            previous_revision: self.previous_revision.as_ref().map(|s| p::Rev(Arc::from(s.as_str()))),
        }
    }
}

// ---- representation (get response: Bead | Generic) ------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
// Externally tagged (`{"Bead": {...}}` / `{"Generic": {...}}`). FRICTION: (a) the spec
// discriminates Bead|Generic STRUCTURALLY (by shape / `kind`), not by an envelope tag — a
// conformant decoder wouldn't see this wrapper; (b) serde's *internally* tagged form can't
// round-trip the raw-JSON (`RawValue`) property/metadata bodies, which forced this choice.
pub enum WireRepresentation {
    Bead(WireBead),
    Generic(WireGeneric),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireBead {
    pub kind: String,
    pub id: WireResourceId,
    #[serde(rename = "type")]
    pub r#type: WireResourceId,
    #[serde(rename = "storageClass")]
    pub storage_class: Box<RawValue>, // FRICTION: trait Representation::Bead has NO storageClass;
                                      // the server fabricates one here and the client drops it.
    pub properties: Box<RawValue>,
    pub metadata: Box<RawValue>,
    pub provenance: WireProvenance,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGeneric {
    pub kind: String,
    pub id: WireResourceId,
    #[serde(rename = "contentType")]
    pub content_type: String,
    pub body: Box<RawValue>,
    pub provenance: WireProvenance,
}

fn synth_storage_class() -> Box<RawValue> {
    RawValue::from_string(r#"{"durable":{"versioned":true}}"#.to_string()).unwrap()
}

impl WireRepresentation {
    pub fn from_trait(rep: &p::Representation) -> Self {
        match rep {
            p::Representation::Bead {
                id, kind, r#type, created_at, properties, metadata, provenance,
            } => WireRepresentation::Bead(WireBead {
                kind: kind.0.to_string(),
                id: WireResourceId::from_trait(id),
                r#type: WireResourceId::from_trait(r#type),
                storage_class: synth_storage_class(),
                properties: raw_to_value(properties),
                metadata: raw_to_value(metadata),
                provenance: WireProvenance::from_trait(provenance),
                created_at: created_at.0.to_string(),
            }),
            p::Representation::Resource { id, content_type, body, provenance } => {
                let body_json = match body {
                    p::Body::Text(t) => RawValue::from_string(
                        serde_json::to_string(t).unwrap_or_else(|_| "\"\"".to_string()),
                    )
                    .unwrap(),
                    p::Body::Binary(b) => RawValue::from_string(
                        serde_json::to_string(&String::from_utf8_lossy(b).into_owned())
                            .unwrap_or_else(|_| "\"\"".to_string()),
                    )
                    .unwrap(),
                };
                WireRepresentation::Generic(WireGeneric {
                    kind: "generic".to_string(),
                    id: WireResourceId::from_trait(id),
                    content_type: content_type.0.to_string(),
                    body: body_json,
                    provenance: WireProvenance::from_trait(provenance),
                })
            }
            // FRICTION: `Representation` is `#[non_exhaustive]`; a variant added upstream has no
            // wire mapping until this crate learns it. The spike degrades to an empty Generic.
            other => WireRepresentation::Generic(WireGeneric {
                kind: "unknown".to_string(),
                id: WireResourceId::from_trait(other.id()),
                content_type: "application/octet-stream".to_string(),
                body: RawValue::from_string("null".to_string()).unwrap(),
                provenance: WireProvenance {
                    principals: vec![],
                    inception: "unknown".to_string(),
                    committed_at: String::new(),
                    previous_revision: None,
                    message: None,
                },
            }),
        }
    }

    pub fn to_trait(self) -> p::Representation {
        match self {
            WireRepresentation::Bead(b) => p::Representation::Bead {
                id: b.id.to_trait(),
                kind: p::Kind(Arc::from(b.kind.as_str())),
                r#type: b.r#type.to_trait(),
                created_at: p::Timestamp(Arc::from(b.created_at.as_str())),
                properties: value_to_raw(&b.properties),
                metadata: value_to_raw(&b.metadata),
                provenance: b.provenance.to_trait(),
                // b.storage_class intentionally dropped — no home on the trait.
            },
            WireRepresentation::Generic(g) => p::Representation::Resource {
                id: g.id.to_trait(),
                content_type: p::MediaType(Arc::from(g.content_type.as_str())),
                body: p::Body::Text(g.body.get().to_string()),
                provenance: g.provenance.to_trait(),
            },
        }
    }
}

// ---- BDP-* protocol-meta headers (Lydia's provisional envelope convention) -------
// The `BdpResult` envelope splits payload (body) from protocol-meta. Lydia's scheme: protocol
// meta → `BDP-*` response headers, data → body, outcome → status. This prototypes the header
// half so the envelope actually ROUND-TRIPS (NOTES §E: previously dropped). Extends the
// appendix's existing `BDP-Cause/Provenance/Transaction/Metadata` header family.

pub fn protocol_to_headers(meta: &p::ProtocolMeta) -> Vec<(String, String)> {
    let mut h = Vec::new();
    // (a) RATIFIED: rev rides as the entity `ETag` (quoted) — rev IS an ETag by construction
    // (opaque, equality-only, = content hash), so standard HTTP caching / If-Match just works.
    // BDP-Rev is dropped as redundant. (A rev that is NOT the response entity's own would need a
    // distinct header — not hit in this spike; flagged in BINDING.md.)
    if let Some(rev) = &meta.rev {
        h.push(("ETag".into(), format!("\"{}\"", rev.0)));
    }
    if let Some(head) = meta.head {
        h.push(("BDP-Head".into(), head.to_string()));
    }
    if let Some(txn) = &meta.transaction {
        h.push(("BDP-Transaction".into(), txn.0.to_string()));
    }
    // (c) RATIFIED: base64url (no padding) — same encoding works in the header and in `?after=`.
    if let Some(cur) = &meta.cursor {
        h.push(("BDP-Cursor".into(), crate::http::b64url_encode(&cur.0)));
    }
    // (b) RATIFIED: one `BDP-Warning` header line per warning (HTTP multi-value; no comma-ambiguity).
    for w in &meta.warnings {
        h.push(("BDP-Warning".into(), format!("{}: {}", w.code, w.detail)));
    }
    h
}

pub fn protocol_from_headers(resp: &crate::http::HttpResponse) -> p::ProtocolMeta {
    let mut m = p::ProtocolMeta::default();
    if let Some(v) = resp.header_value("etag") {
        m.rev = Some(p::Rev(Arc::from(v.trim_matches('"'))));
    }
    if let Some(v) = resp.header_value("bdp-head") {
        m.head = v.parse().ok();
    }
    if let Some(v) = resp.header_value("bdp-transaction") {
        m.transaction = Some(p::Transaction(Arc::from(v)));
    }
    if let Some(v) = resp.header_value("bdp-cursor") {
        m.cursor = Some(p::Cursor(Bytes::from(crate::http::b64url_decode(v))));
    }
    m.warnings = resp
        .header_values("bdp-warning")
        .into_iter()
        .map(|s| {
            let (code, detail) = s.split_once(": ").unwrap_or((s, ""));
            p::Warning { code: code.to_string(), detail: detail.to_string() }
        })
        .collect();
    m
}

// ---- Write (apply write-set arm) ------------------------------------------------
// Externally tagged with the spec's arm names (bCreate/bPut/bPatch/bDelete). 1:1 with the
// trait's `Write` enum — a clean seam (NOTES §F noted this alignment).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WireWrite {
    #[serde(rename = "bCreate")]
    Create { draft: WireCreateRequest },
    #[serde(rename = "bPut")]
    Put {
        resource: WireResourceId,
        body: WireCreateRequest,
        // The guards must round-trip here too. A batched write inside `apply` has no request line
        // of its own, so if the wire form omitted them an `apply` would silently drop a guard —
        // the same class of defect as a server that accepts `If-Match` and ignores it.
        #[serde(rename = "ifMatch", skip_serializing_if = "Option::is_none", default)]
        if_match: Option<String>,
        #[serde(rename = "ifAbsent", default, skip_serializing_if = "std::ops::Not::not")]
        if_absent: bool,
    },
    #[serde(rename = "bPatch")]
    Patch {
        resource: WireResourceId,
        patch: Box<RawValue>,
        #[serde(rename = "ifMatch", skip_serializing_if = "Option::is_none", default)]
        if_match: Option<String>,
    },
    #[serde(rename = "bDelete")]
    Delete {
        resource: WireResourceId,
        #[serde(rename = "ifMatch", skip_serializing_if = "Option::is_none", default)]
        if_match: Option<String>,
    },
}

impl WireWrite {
    pub fn from_trait(w: &p::Write) -> Self {
        match w {
            p::Write::Create { id, body } => WireWrite::Create {
                draft: WireCreateRequest::from_body(id.as_ref(), body),
            },
            p::Write::Put { target, body, guards } => WireWrite::Put {
                resource: WireResourceId::from_trait(target),
                body: WireCreateRequest::from_body(None, body),
                if_match: guards.if_revision.as_ref().map(|r| r.0.to_string()),
                if_absent: guards.if_absent,
            },
            p::Write::Patch { target, patch, if_rev } => WireWrite::Patch {
                resource: WireResourceId::from_trait(target),
                patch: raw_to_value(&patch.0),
                if_match: if_rev.as_ref().map(|r| r.0.to_string()),
            },
            p::Write::Delete { target, if_rev } => WireWrite::Delete {
                resource: WireResourceId::from_trait(target),
                if_match: if_rev.as_ref().map(|r| r.0.to_string()),
            },
        }
    }

    pub fn into_trait(self) -> p::Write {
        match self {
            WireWrite::Create { draft } => {
                let (id, body) = draft.into_body();
                p::Write::Create { id, body }
            }
            WireWrite::Put { resource, body, if_match, if_absent } => {
                let (_id, body) = body.into_body();
                p::Write::Put {
                    target: resource.to_trait(),
                    body,
                    guards: p::Guards {
                        if_revision: if_match.map(|s| p::Rev(std::sync::Arc::from(s.as_str()))),
                        if_absent,
                        precondition: None,
                    },
                }
            }
            WireWrite::Patch { resource, patch, if_match } => p::Write::Patch {
                target: resource.to_trait(),
                patch: p::JsonPatch(value_to_raw(&patch)),
                if_rev: if_match.map(|s| p::Rev(Arc::from(s.as_str()))),
            },
            WireWrite::Delete { resource, if_match } => p::Write::Delete {
                target: resource.to_trait(),
                if_rev: if_match.map(|s| p::Rev(Arc::from(s.as_str()))),
            },
        }
    }
}

// ---- Problem (RFC 9457 error body) ----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireProblem {
    pub r#type: String,
    pub title: String,
    pub status: u16,
    pub code: String,
    pub retry: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
    // RFC 9457 extension members. Populated per problem type so a client can branch on the general
    // `code` yet still see the specifics (not just a prose `detail`):
    //   - `limit-exceeded`: which advertised bound (`capability`/`limit`);
    //   - `constraint-violation`: which constraint (`constraint` discriminator, e.g. "uniqueness"),
    //     plus `property` and the existing holder (`conflicts_with`) for uniqueness (Lydia §70).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub capability: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub limit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub constraint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub property: Option<String>,
    #[serde(rename = "conflictsWith", skip_serializing_if = "Option::is_none", default)]
    pub conflicts_with: Option<String>,
}

impl WireProblem {
    /// Map a `BdpError` to (http status, Problem body). Structured extension members
    /// (`capability`/`limit`, `property`/`conflicts_with`) are set per problem type — one `code`
    /// for the mechanism, precision in the fields (Lydia §69).
    pub fn from_error(e: &p::BdpError) -> (u16, Self) {
        let (mut capability, mut limit, mut constraint, mut property, mut conflicts_with) =
            (None, None, None, None, None);
        let (status, code, title, detail) = match e {
            p::BdpError::NotFound(id) => (404, "not-found", "Resource not found", Some(format!("{:?}", id))),
            p::BdpError::Erased { id, at } => (410, "erased", "Resource erased", Some(format!("{:?} at {:?}", id, at))),
            // Lydia §71: create-fail-if-exists is an EXISTENCE conflict, NOT a declared constraint —
            // its own 409 code, never `constraint-violation`.
            p::BdpError::AlreadyExists(id) => (409, "already-exists", "Resource already exists", Some(format!("{:?}", id))),
            p::BdpError::RevisionMismatch { expected, found, .. } => (
                412,
                "revision-mismatch",
                "Revision precondition failed",
                Some(format!("expected {:?}, found {:?}", expected, found)),
            ),
            // Lydia §70: the whole ConstraintViolation family shares ONE problem code
            // `constraint-violation` (409, the kebab of the enum category); the specific constraint
            // is a structured discriminator field, so new constraint types ride the same code
            // instead of proliferating codes. Uniqueness carries the blessed `property`/`conflictsWith`
            // (branch point for a client); cycle/cardinality carry the discriminator + detail (their
            // richer structured fields await the Types co-design with Donna).
            p::BdpError::Conflict(c) => {
                let msg = match c {
                    p::ConstraintViolation::Uniqueness { fromprop, to } => {
                        constraint = Some("uniqueness".to_string());
                        property = Some(fromprop.clone());
                        conflicts_with = Some(to.id.0.to_string());
                        format!("property '{fromprop}' value already held by {}", to.id.0)
                    }
                    p::ConstraintViolation::Cycle { family, from, to } => {
                        constraint = Some("cycle".to_string());
                        format!("cycle in '{family}': {} -> {}", from.id.0, to.id.0)
                    }
                    p::ConstraintViolation::Cardinality { fromprop, detail } => {
                        constraint = Some("cardinality".to_string());
                        property = Some(fromprop.clone());
                        format!("{fromprop}: {detail}")
                    }
                };
                (409, "constraint-violation", "Constraint violation", Some(msg))
            }
            p::BdpError::Unprocessable(m) => (422, "unprocessable", "Unprocessable request", Some(m.clone())),
            // Donna-ruled: advertised op, request over its advertised limits → 422 `limit-exceeded`
            // (NOT 501/not-implemented). Distinct from generic `unprocessable` by the problem code.
            p::BdpError::LimitExceeded { capability: cap, limit: lim, detail } => {
                capability = Some(cap.clone());
                limit = Some(lim.clone());
                (422, "limit-exceeded", "Request exceeds advertised limits", Some(detail.clone()))
            }
            p::BdpError::CursorExpired(_) => (410, "cursor-expired", "Cursor expired", None),
            p::BdpError::Backend(m) => (500, "backend", "Backend error", Some(m.clone())),
        };
        (
            status,
            Self {
                r#type: format!("https://bdp.dev/problems/{}", code),
                title: title.to_string(),
                status,
                code: code.to_string(),
                retry: "never".to_string(),
                detail,
                capability,
                limit,
                constraint,
                property,
                conflicts_with,
            },
        )
    }
}

// ---- Capabilities (discovery: GET /:capabilities) -------------------------------
// Externally tagged, lowercase op keys (`{"get":{"selector":false}}`, `{"unversioned":{}}`).
// Mirrors `bdp_primitives::PrimitiveCapabilities` so the server can advertise its scope's REAL
// `capabilities()` and a `RemoteScope` can PROXY them. Per Donna's advertised⟹implemented ruling,
// the wire must faithfully carry the advertised set — INCLUDING the `Unversioned` flag, else an
// unversioned scope's unpinned refs (`rev = None`) look pinned to the client (Connie finding #1).
// `PrimitiveCapabilities` is `#[non_exhaustive]`: an unknown future variant has no wire arm and is
// dropped (`from_trait` returns `None`) rather than silently mis-encoded.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WireCapability {
    #[serde(rename = "get")]
    Get { #[serde(default)] selector: bool },
    #[serde(rename = "resolve")]
    Resolve {
        #[serde(default)] selector: bool,
        #[serde(rename = "maxBatch", skip_serializing_if = "Option::is_none", default)] max_batch: Option<u32>,
    },
    #[serde(rename = "list")]
    List {
        #[serde(default)] conditions: Vec<String>,
        #[serde(default)] selector: bool,
        #[serde(default)] sort: bool,
        #[serde(rename = "maxLimit", skip_serializing_if = "Option::is_none", default)] max_limit: Option<u32>,
    },
    #[serde(rename = "changes")]
    Changes { #[serde(default)] sse: bool, #[serde(default)] jsonl: bool, #[serde(default)] filter: bool, #[serde(default)] selector: bool },
    #[serde(rename = "pull")]
    Pull { #[serde(default)] sse: bool, #[serde(default)] jsonl: bool, #[serde(default)] filter: bool, #[serde(default)] selector: bool },
    #[serde(rename = "export")]
    Export { #[serde(default)] revisions: bool },
    #[serde(rename = "create")]
    Create {
        #[serde(rename = "serverAllocatesId", default)] server_allocates_id: bool,
        #[serde(rename = "clientProposedId", default)] client_proposed_id: bool,
    },
    #[serde(rename = "put")]
    Put {
        #[serde(rename = "ifMatch", default)]
        if_match: bool,
        #[serde(rename = "ifAbsent", default)]
        if_absent: bool,
    },
    #[serde(rename = "patch")]
    Patch { #[serde(rename = "ifMatch", default)] if_match: bool },
    #[serde(rename = "delete")]
    Delete { #[serde(rename = "ifMatch", default)] if_match: bool },
    #[serde(rename = "apply")]
    Apply {
        #[serde(rename = "maxWrites", skip_serializing_if = "Option::is_none", default)] max_writes: Option<u32>,
        #[serde(default)] acyclicity: bool,
    },
    #[serde(rename = "import")]
    Import { #[serde(rename = "historyRestore", default)] history_restore: bool },
    #[serde(rename = "evaluate")]
    Evaluate {
        #[serde(rename = "bdpAst", default)] bdp_ast: bool,
        #[serde(rename = "bdpText", default)] bdp_text: bool,
        #[serde(rename = "lumenAst", default)] lumen_ast: bool,
        #[serde(rename = "lumenText", default)] lumen_text: bool,
        #[serde(rename = "stgSpecific", default)] stg_specific: bool,
    },
    #[serde(rename = "call")]
    Call { #[serde(rename = "asyncSupported", default)] async_supported: bool },
    #[serde(rename = "aliases")]
    Aliases { #[serde(default)] indexed: bool },
    #[serde(rename = "unversioned")]
    Unversioned {},
}

fn condition_to_str(c: &p::ConditionKind) -> &'static str {
    use p::ConditionKind as K;
    match c {
        K::Compare => "compare",
        K::Matches => "matches",
        K::Has => "has",
        K::Missing => "missing",
        K::Contains => "contains",
        K::ContainsAny => "containsAny",
        K::Excludes => "excludes",
        K::IsType => "isType",
    }
}

fn condition_from_str(s: &str) -> Option<p::ConditionKind> {
    use p::ConditionKind as K;
    Some(match s {
        "compare" => K::Compare,
        "matches" => K::Matches,
        "has" => K::Has,
        "missing" => K::Missing,
        "contains" => K::Contains,
        "containsAny" => K::ContainsAny,
        "excludes" => K::Excludes,
        "isType" => K::IsType,
        _ => return None, // unknown condition kind: drop it rather than invent one
    })
}

impl WireCapability {
    /// `None` for an unknown (`#[non_exhaustive]`) future variant this crate hasn't learned.
    pub fn from_trait(c: &p::PrimitiveCapabilities) -> Option<Self> {
        use p::PrimitiveCapabilities as C;
        Some(match c {
            C::Get(g) => WireCapability::Get { selector: g.selector },
            C::Resolve(r) => WireCapability::Resolve { selector: r.selector, max_batch: r.max_batch },
            C::List(l) => WireCapability::List {
                conditions: l.conditions.iter().map(|k| condition_to_str(k).to_string()).collect(),
                selector: l.selector,
                sort: l.sort,
                max_limit: l.max_limit,
            },
            C::Changes(x) => WireCapability::Changes { sse: x.sse, jsonl: x.jsonl, filter: x.filter, selector: x.selector },
            C::Pull(x) => WireCapability::Pull { sse: x.sse, jsonl: x.jsonl, filter: x.filter, selector: x.selector },
            C::Export(x) => WireCapability::Export { revisions: x.revisions },
            C::Create(x) => WireCapability::Create { server_allocates_id: x.server_allocates_id, client_proposed_id: x.client_proposed_id },
            C::Put(c) => WireCapability::Put { if_match: c.if_match, if_absent: c.if_absent },
            C::Patch(x) => WireCapability::Patch { if_match: x.if_match },
            C::Delete(x) => WireCapability::Delete { if_match: x.if_match },
            C::Apply(x) => WireCapability::Apply { max_writes: x.max_writes, acyclicity: x.acyclicity },
            C::Import(x) => WireCapability::Import { history_restore: x.history_restore },
            C::Evaluate(x) => WireCapability::Evaluate {
                bdp_ast: x.bdp_ast, bdp_text: x.bdp_text, lumen_ast: x.lumen_ast, lumen_text: x.lumen_text, stg_specific: x.stg_specific,
            },
            C::Call(x) => WireCapability::Call { async_supported: x.async_supported },
            C::Aliases(a) => WireCapability::Aliases { indexed: a.indexed },
            C::Unversioned(_) => WireCapability::Unversioned {},
            _ => return None,
        })
    }

    pub fn into_trait(self) -> p::PrimitiveCapabilities {
        use p::*;
        match self {
            WireCapability::Get { selector } => PrimitiveCapabilities::Get(GetCaps { selector }),
            WireCapability::Resolve { selector, max_batch } => PrimitiveCapabilities::Resolve(ResolveCaps { selector, max_batch }),
            WireCapability::List { conditions, selector, sort, max_limit } => PrimitiveCapabilities::List(ListCaps {
                conditions: conditions.iter().filter_map(|s| condition_from_str(s)).collect(),
                selector,
                sort,
                max_limit,
            }),
            WireCapability::Changes { sse, jsonl, filter, selector } => PrimitiveCapabilities::Changes(ChangesCaps { sse, jsonl, filter, selector }),
            WireCapability::Pull { sse, jsonl, filter, selector } => PrimitiveCapabilities::Pull(PullCaps { sse, jsonl, filter, selector }),
            WireCapability::Export { revisions } => PrimitiveCapabilities::Export(ExportCaps { revisions }),
            WireCapability::Create { server_allocates_id, client_proposed_id } => PrimitiveCapabilities::Create(CreateCaps { server_allocates_id, client_proposed_id }),
            WireCapability::Put { if_match, if_absent } => PrimitiveCapabilities::Put(PutCaps { if_match, if_absent }),
            WireCapability::Patch { if_match } => PrimitiveCapabilities::Patch(PatchCaps { if_match }),
            WireCapability::Delete { if_match } => PrimitiveCapabilities::Delete(DeleteCaps { if_match }),
            WireCapability::Apply { max_writes, acyclicity } => PrimitiveCapabilities::Apply(ApplyCaps { max_writes, acyclicity }),
            WireCapability::Import { history_restore } => PrimitiveCapabilities::Import(ImportCaps { history_restore }),
            WireCapability::Evaluate { bdp_ast, bdp_text, lumen_ast, lumen_text, stg_specific } => PrimitiveCapabilities::Evaluate(EvaluateCaps {
                bdp_ast, bdp_text, lumen_ast, lumen_text, stg_specific,
            }),
            WireCapability::Call { async_supported } => PrimitiveCapabilities::Call(CallCaps { async_supported }),
            WireCapability::Aliases { indexed } => PrimitiveCapabilities::Aliases(AliasesCaps { indexed }),
            WireCapability::Unversioned {} => PrimitiveCapabilities::Unversioned(UnversionedCaps {}),
        }
    }
}

/// Encode a scope's advertised capabilities for the discovery response.
/// The discovery document. It carries BOTH advertised surfaces because they answer different
/// questions: `scope` is what the store GUARANTEES, `primitives` is what you may CALL. Before this
/// the endpoint returned the bare primitive array, so a client had no way to read the scope's
/// traits — which left a conformance case for a trait-dependent fault (a write's `410` under
/// `permanent`, `delete`'s `404`) with nothing to key on, and no honest option but to assert the
/// behaviour unconditionally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireDiscovery {
    pub scope: WireScopeCapabilities,
    pub primitives: Vec<WireCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireScopeCapabilities {
    #[serde(rename = "storageClasses")]
    pub storage_classes: Vec<String>,
    #[serde(rename = "revisionModel")]
    pub revision_model: String,
    #[serde(rename = "idModel")]
    pub id_model: String,
}

impl WireScopeCapabilities {
    pub fn from_trait(c: &p::ScopeCapabilities) -> Self {
        Self {
            storage_classes: c.storage_classes.iter().map(|k| match k {
                p::StorageClass::Durable => "durable",
                p::StorageClass::Ephemeral => "ephemeral",
                p::StorageClass::Intrinsic => "intrinsic",
            }.to_string()).collect(),
            revision_model: match c.revision_model {
                p::RevisionModel::Versioned => "versioned",
                p::RevisionModel::Unversioned => "unversioned",
            }.to_string(),
            id_model: match c.id_model {
                p::IdModel::Permanent => "permanent",
                p::IdModel::Reusable => "reusable",
            }.to_string(),
        }
    }

    /// Decode back to the trait form. An UNRECOGNISED value is not silently defaulted — a client
    /// that cannot read the model must not act as though it read one, which is the same rule as
    /// `If-None-Match` not treating an unknown value as `*`.
    pub fn to_trait(&self) -> Result<p::ScopeCapabilities, String> {
        let storage_classes = self.storage_classes.iter().map(|k| match k.as_str() {
            "durable" => Ok(p::StorageClass::Durable),
            "ephemeral" => Ok(p::StorageClass::Ephemeral),
            "intrinsic" => Ok(p::StorageClass::Intrinsic),
            other => Err(format!("unknown storage class {other:?}")),
        }).collect::<Result<Vec<_>, _>>()?;
        let revision_model = match self.revision_model.as_str() {
            "versioned" => p::RevisionModel::Versioned,
            "unversioned" => p::RevisionModel::Unversioned,
            other => return Err(format!("unknown revision model {other:?}")),
        };
        let id_model = match self.id_model.as_str() {
            "permanent" => p::IdModel::Permanent,
            "reusable" => p::IdModel::Reusable,
            other => return Err(format!("unknown id model {other:?}")),
        };
        Ok(p::ScopeCapabilities { storage_classes, revision_model, id_model })
    }
}

pub fn caps_to_wire(caps: &[p::PrimitiveCapabilities]) -> Vec<WireCapability> {
    caps.iter().filter_map(WireCapability::from_trait).collect()
}

/// Decode an advertised-capabilities response back to the trait form.
pub fn caps_from_wire(wire: Vec<WireCapability>) -> Vec<p::PrimitiveCapabilities> {
    wire.into_iter().map(WireCapability::into_trait).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::HttpResponse;

    #[test]
    fn capabilities_roundtrip_through_wire_incl_unversioned_and_limits() {
        use p::*;
        let caps = vec![
            PrimitiveCapabilities::Get(GetCaps { selector: true }),
            PrimitiveCapabilities::Create(CreateCaps { server_allocates_id: true, client_proposed_id: false }),
            PrimitiveCapabilities::Apply(ApplyCaps { max_writes: Some(100), acyclicity: true }),
            PrimitiveCapabilities::List(ListCaps {
                conditions: vec![ConditionKind::Compare, ConditionKind::IsType],
                selector: false,
                sort: true,
                max_limit: Some(500),
            }),
            // The flag whose loss is Connie finding #1 — it MUST survive the wire.
            PrimitiveCapabilities::Unversioned(UnversionedCaps {}),
            // aliases capability (resource-model.md §65), with its `indexed` perf hint.
            PrimitiveCapabilities::Aliases(AliasesCaps { indexed: true }),
        ];
        // Round-trip through the JSON wire form a server would send and a client would parse.
        let bytes = serde_json::to_vec(&caps_to_wire(&caps)).unwrap();
        let back = caps_from_wire(serde_json::from_slice(&bytes).unwrap());

        assert!(back.iter().any(|c| matches!(c, PrimitiveCapabilities::Unversioned(_))), "Unversioned lost over the wire");
        // limits preserved, not flattened to booleans
        let apply = back.iter().find_map(|c| match c { PrimitiveCapabilities::Apply(a) => Some(a), _ => None }).unwrap();
        assert_eq!(apply.max_writes, Some(100));
        assert!(apply.acyclicity);
        let list = back.iter().find_map(|c| match c { PrimitiveCapabilities::List(l) => Some(l), _ => None }).unwrap();
        assert_eq!(list.conditions, vec![ConditionKind::Compare, ConditionKind::IsType]);
        assert_eq!(list.max_limit, Some(500));
        let get = back.iter().find_map(|c| match c { PrimitiveCapabilities::Get(g) => Some(g), _ => None }).unwrap();
        assert!(get.selector);
        let aliases = back.iter().find_map(|c| match c { PrimitiveCapabilities::Aliases(a) => Some(a), _ => None }).unwrap();
        assert!(aliases.indexed, "aliases.indexed lost over the wire");
    }

    #[test]
    fn limit_exceeded_maps_to_422_with_code_and_extension_members() {
        let e = p::BdpError::LimitExceeded {
            capability: "list".into(),
            limit: "conditions".into(),
            detail: "condition kind `containsAny` not advertised".into(),
        };
        let (status, prob) = WireProblem::from_error(&e);
        assert_eq!(status, 422);
        assert_eq!(prob.code, "limit-exceeded");
        assert_eq!(prob.capability.as_deref(), Some("list"));
        assert_eq!(prob.limit.as_deref(), Some("conditions"));
        // Distinct from generic unprocessable at the SAME status — keyed by the problem code.
        let (gen_status, gen) = WireProblem::from_error(&p::BdpError::Unprocessable("bad".into()));
        assert_eq!(gen_status, 422);
        assert_eq!(gen.code, "unprocessable");
        assert!(gen.capability.is_none() && gen.limit.is_none());
    }

    #[test]
    fn uniqueness_conflict_maps_to_constraint_violation_with_discriminator() {
        use std::sync::Arc;
        let e = p::BdpError::Conflict(p::ConstraintViolation::Uniqueness {
            fromprop: "name".into(),
            to: p::ResourceId::head(p::Scope::This, p::Id(Arc::from("alias-doc-1"))),
        });
        let (status, prob) = WireProblem::from_error(&e);
        assert_eq!(status, 409);
        // Lydia §70: ONE code for the constraint family; the constraint is a structured discriminator.
        assert_eq!(prob.code, "constraint-violation");
        assert_eq!(prob.constraint.as_deref(), Some("uniqueness"));
        assert_eq!(prob.property.as_deref(), Some("name"));
        assert_eq!(prob.conflicts_with.as_deref(), Some("alias-doc-1"));
        // Another constraint in the family rides the SAME code, discriminated by `constraint`
        // (no separate `conflict` code) — uniqueness-only fields stay unset.
        let (_, card) = WireProblem::from_error(&p::BdpError::Conflict(p::ConstraintViolation::Cardinality {
            fromprop: "owner".into(),
            detail: "too many".into(),
        }));
        assert_eq!(card.code, "constraint-violation");
        assert_eq!(card.constraint.as_deref(), Some("cardinality"));
        assert!(card.conflicts_with.is_none());
    }

    #[test]
    fn existence_and_concurrency_conflicts_keep_their_own_codes() {
        use std::sync::Arc;
        // Lydia §71 guardrails: these are NOT declared-constraint violations, so they must NOT
        // fold into `constraint-violation`.
        let (s1, exists) = WireProblem::from_error(&p::BdpError::AlreadyExists(
            p::ResourceId::head(p::Scope::This, p::Id(Arc::from("note-2"))),
        ));
        assert_eq!((s1, exists.code.as_str()), (409, "already-exists"));
        assert!(exists.constraint.is_none());

        let (s2, rev) = WireProblem::from_error(&p::BdpError::RevisionMismatch {
            id: p::ResourceId::head(p::Scope::This, p::Id(Arc::from("x"))),
            expected: p::Rev(Arc::from("rev-1")),
            found: None,
        });
        assert_eq!((s2, rev.code.as_str()), (412, "revision-mismatch"));
    }

    #[test]
    fn protocol_envelope_roundtrips_through_headers() {
        let meta = p::ProtocolMeta {
            rev: Some(p::Rev(Arc::from("rev-9"))),
            head: Some(true),
            transaction: Some(p::Transaction(Arc::from("txn-1"))),
            cursor: Some(p::Cursor(Bytes::from_static(b"\x00\xffcur"))),
            warnings: vec![
                p::Warning { code: "a".into(), detail: "one".into() },
                p::Warning { code: "b".into(), detail: "two".into() },
            ],
        };
        let headers = protocol_to_headers(&meta);
        // (a) rev → ETag (quoted), no BDP-Rev; (b) one BDP-Warning line per warning.
        assert!(headers.iter().any(|(k, v)| k == "ETag" && v == "\"rev-9\""));
        assert!(!headers.iter().any(|(k, _)| k == "BDP-Rev"));
        assert_eq!(headers.iter().filter(|(k, _)| k == "BDP-Warning").count(), 2);

        let resp = HttpResponse { status: 200, headers, body: vec![] };
        let back = protocol_from_headers(&resp);
        assert_eq!(back.rev.unwrap().0.as_ref(), "rev-9");
        assert_eq!(back.head, Some(true));
        assert_eq!(back.transaction.unwrap().0.as_ref(), "txn-1");
        assert_eq!(back.cursor.unwrap().0.as_ref(), b"\x00\xffcur"); // (c) base64url round-trips
        assert_eq!(back.warnings.len(), 2);
        assert_eq!(back.warnings[0].code, "a");
        assert_eq!(back.warnings[1].detail, "two");
    }
}
