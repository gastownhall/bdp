# Memory Types — proposed model

Draft for review, October 13, 2026. **Recommendation: one Memory Bead Type with
knowledge-form kinds, and six distinct informational Link Types.** This is the
forward-looking proposal. MUST, SHOULD and MAY express the proposed contract;
they do not claim adoption into canonical BDP or implementation readiness.
The [earlier A/B comparison](memory-approaches.md) is preserved as design background.
A reviewer can read this proposal without reading that comparison.

A worker can save a note quickly, then develop it into a procedure or decision.
The identity survives. Relationships say whether another record provides guidance,
supports a conclusion, challenges it, or offers a replacement. Those meanings
have separate Link Type IDs and endpoint rules. Issue, Dependency and Activity
retain their externally defined meanings.

## 1. Scope, authority and notation

Inputs: [Chris’s Memory proposal, revision 4](https://github.com/gastownhall/beads/issues/5877),
including R1–R31/R27a and the [relationship/applicability follow-up](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303);
[Provenance V2](https://github.com/gastownhall/beads/issues/7510);
and [BDP main verified at 627b560](https://github.com/gastownhall/bdp/blob/627b560c0daf1a76b292615718c86670255ac9af/docs/specs/bdp.md).
The requirements were reread October 13; that BDP head was rechecked when this
proposal was prepared. [Prior-art research](../../docs/design/memory-type-prior-art-20261013.md)
provides examples, not additional requirements.

BDP owns the shared data model, Type definitions and observable validation rules.
Beads owns authoring, command adaptation, storage/index choices and operator
workflows. Registering these Types alone does not implement the shared operations
or CLI behavior below. Current BDP remains authoritative until amended.

**External definitions.** Issue is the established Bead Type; Dependency is the
established Link Type, with its pending kind discriminator. Their classification,
validation, direction and workflow effects are not changed here. Their legacy
shape is not precedent for this design. Activity and revisionProvenance come from
Provenance V2. There is no additional activity, run or causality mechanism in this
proposal. A decision Issue is not automatically a decision Memory.

**Notation.** `K` is a publisher-controlled namespace, expanded in examples as
`https://example.org/memory-types/`; it is not a chosen registry host. A Type ID
identifies a Type definition Bead under the Type-lifecycle proposal. The intrinsic
`type` reference of each saved Resource revision pins an immutable definition,
including its structure and semantics. `{uri, revision}` denotes an exact reference;
an unpinned resource URI floats. Type publication, installation and version-label
encoding are separate work. JSON below illustrates properties and authoring payloads,
not complete canonical wire schemas.

**Shared direction used here.** Types are flat: no stipulated conformance,
inheritance or implicit membership. Each endpoint accepts any nominal Type ID in
its explicit OR list; both endpoint checks must pass. `ANY` means any local Bead;
an empty list accepts none. Neither notation introduces a wire member. Existing
`conformsTo` arrays must not be silently reinterpreted from AND to OR.

Nominal lists span definition versions; matching an ID does not prove semantic
compatibility. Exact-definition or compatibility-family constraints remain open.
Comparison uses canonical Type identities, never names, URL prefixes or shared
properties. An explicit update may change a Bead's or Link's nominal Type while
preserving its Resource identity. This is the proposed direction following the
operator's promotion discussion, and requires a shared amendment; §5 states the
validation obligations and unresolved mechanics. It replaces immutable nominal
affiliation as an assumption of this proposal, not by editing historical revisions.

The recommendation includes schema-defined kind, details and applicability.
That is an explicit proposed refinement of Chris R3's metadata convention.
Structured human-readable output also needs an explicit R7 decision (§7). The
minimal authoring path remains an unclassified note; no classification prompt
is required to save ordinary knowledge.

## 2. Catalog

| Type identity | Name | Resource category and purpose |
| --- | --- | --- |
| K/memory | Memory | Bead; all knowledge forms, selected by properties.kind |
| K/memory-related | MemoryRelated | Link; informational navigation |
| K/memory-guidance | MemoryGuidance | Link; intended guidance for an Issue |
| K/memory-applies-to | MemoryAppliesTo | Link; claimed applicability to a target |
| K/memory-supports | MemorySupports | Link; support for exact target content |
| K/memory-challenges | MemoryChallenges | Link; a reason to reconsider exact target content |
| K/memory-supersedes | MemorySupersedes | Link; offered replacement for exact target content |

These seven definitions are the proposed catalog, not production assignments.
Generic Bead and Link Types are a separate possible facility (§10), not additional
Memory definitions. Each Link Type has its own endpoint rules and meaning; it
has no defined relation-kind property. Installing another Type adds no membership
to this catalog or to an existing query/endpoint list.

## 3. Memory Bead

### 3.1 Kinds and fields

Memory kind values are note, observation, decision, procedure, policy and lesson.
The saved kind is required. An unclassified create defaults to note with empty
details; an omitted kind on update preserves it. The service MUST NOT infer kind
from body headings, title, Issue.issue_type or a Link. The Type identity stays
K/memory for every form.

An extension kind is an absolute HTTP(S) URI owned by its definer. It is preserved
as an opaque discriminator; this edition validates only the common fields and
that details is an object for such a kind. It does not fetch the URI, install a
schema or infer meaning. Unknown short names are rejected as likely mistakes.
A generic reader reports the unknown kind and can still read the common Memory
fields. Unknown-kind validation is explicitly weaker, not falsely “fully validated”.
A deployment needing stronger extension-kind guarantees requires an additional
registered per-kind validator; that mechanism is not present in today’s BDP
Type descriptor and is a concrete extra cost of this proposal.

Independently registered user Bead/Link Types remain possible. A custom Bead Type
is a different nominal identity: installation alone does not include it in Memory
queries or add it to restrictive endpoint lists. ANY targets already accept it.
A publisher can introduce a URI kind on K/memory to retain that nominal membership, with the weaker validation described
above. User-defined informational Link Types remain first-class and count under
Memory's wildcard ownership; they need not be members of the supplied Link catalog.
This preserves R17's open Type vocabulary without inventing implicit membership.

All fields in this table are under `properties`. Common Resource identity,
revision, metadata, owned Links and revisionProvenance are outside properties.

| Field | Saved representation and rule |
| --- | --- |
| title | Required nonblank UTF-8 string; supplied or derived during authoring |
| body | Required UTF-8 Markdown string, possibly empty; stored verbatim |
| inception | Optional object: method is native, converted, imported or unknown; optional origin is the transfer/origin reference, not another source list |
| applicability | Optional object with required nonblank description and optional validFrom/validUntil RFC 3339 instants |
| extensions | Optional open JSON object for application fields outside this edition’s defined property names |
| kind | Required discriminator described in §3.1; note is the unclassified default |
| details | The knowledge-form fields defined below |

Native creation defaults Inception to `{"method":"native"}`; an import/conversion
path records only what it knows and does not fabricate historical authorship.
Omitted legacy Inception means unknown, not native. Updating Inception versions
the Memory. Replacing it must be explicit; ordinary content edits preserve it.
The exact source identifier of an import is optional; origin does not imply
that the source supplied evidence for the Memory’s content.

Applicability describes the author’s claimed conditions, not authorization or a
machine proof that a note is safe to apply. If supplied, validFrom is inclusive
and validUntil exclusive; compare normalized instants, require from < until when
both exist, and reject malformed timestamps. Omitted bounds mean no boundary was
specified, not proof of validity outside a known interval. Omitted applicability
means unspecified. A clock crossing a bound never changes stored state. The
server validates shape and ordering, not the truth of the description.

Creation MUST receive a nonblank title or body. With body but no title, the
Memory authoring surface derives a title before storage. With title but no body,
it saves body as an empty string. Complete structured reads return both. Empty
body is a found record, not absence. Headings and frontmatter in body never
become properties or Links. No body is synthesized from prompts or activity.

As a proposed authoring default, a derived title is the first nonblank body line
trimmed to 80 Unicode code points, without parsing Markdown. This concrete authoring choice
remains reviewable; it is not an existing product guarantee. Existing
record updates preserve omitted properties; explicit removals use the shared
update mechanism. Metadata is a separate versioned object, never a hidden body.

| Knowledge form | details fields | Semantic promise |
| --- | --- | --- |
| note | Empty object | Unclassified durable knowledge; not a truth certification |
| observation | statement required, nonblank; observedAt optional RFC 3339 instant | Someone records an observation; observation time is caller supplied and distinct from commit time |
| decision | choice required, nonblank; alternatives optional ordered array of nonblank strings | A recorded choice; body explains reasons/tradeoffs; no automatic approval or Issue closure |
| procedure | steps required, ordered nonempty array of nonblank strings | Reusable instructions; body provides context; no step execution/status engine |
| policy | rule required, nonblank; authority optional Resource reference | A recorded rule and optionally its claimed authority; no access rights or compliance inference |
| lesson | takeaway required, nonblank | A reusable lesson; body explains experience and limits |

Missing alternatives means unrecorded; an explicit empty array means no alternatives
listed. Neither proves exhaustive consideration. Procedure step numbers are list
positions, not stable step identities; a future addressable-step contract would
be a real extension. Unknown fields in the defined details shapes are rejected;
application additions belong in extensions or metadata. A recorded choice/rule/
statement is authoritative in its structured field. If body repeats it, there is
no synchronization or semantic-consistency checker; authoring tools SHOULD render
structured content alongside the body instead of silently maintaining a duplicate.

A plain generic Memory never requires any of the specialized details. These
stronger forms are an opt-in use of structured schemas, not an extra requirement
on every R4 remember operation.

### 3.2 Properties schema

This JSON Schema validates a complete saved properties object, after authoring
defaults. Date-time/URI formats are semantic admission checks even in validators
that treat JSON Schema format as annotation. Cross-field time ordering, canonical
references, endpoint checks and shared operations require the rules in this section.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["title", "body", "kind", "details"],
  "properties": {
    "title": {"type": "string", "pattern": "\\S"},
    "body": {"type": "string"},
    "inception": {
      "type": "object",
      "required": ["method"],
      "properties": {
        "method": {"enum": ["native", "converted", "imported", "unknown"]},
        "origin": {
          "oneOf": [
            {"type": "string", "format": "uri"},
            {
              "type": "object",
              "required": ["uri", "revision"],
              "properties": {
                "uri": {"type": "string", "format": "uri"},
                "revision": {"type": "string", "minLength": 1}
              },
              "additionalProperties": false
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "applicability": {
      "type": "object",
      "required": ["description"],
      "properties": {
        "description": {"type": "string", "pattern": "\\S"},
        "validFrom": {"type": "string", "format": "date-time"},
        "validUntil": {"type": "string", "format": "date-time"}
      },
      "additionalProperties": false
    },
    "extensions": {"type": "object"},
    "kind": {
      "oneOf": [
        {"enum": ["note", "observation", "decision", "procedure", "policy", "lesson"]},
        {"type": "string", "pattern": "^https?://"}
      ]
    },
    "details": {"type": "object"}
  },
  "additionalProperties": true,
  "allOf": [
    {
      "if": {"properties": {"kind": {"const": "note"}}},
      "then": {"properties": {"details": {"type": "object", "additionalProperties": false}}}
    },
    {
      "if": {"properties": {"kind": {"const": "observation"}}},
      "then": {
        "properties": {
          "details": {
            "type": "object",
            "required": ["statement"],
            "properties": {
              "statement": {"type": "string", "pattern": "\\S"},
              "observedAt": {"type": "string", "format": "date-time"}
            },
            "additionalProperties": false
          }
        }
      }
    },
    {
      "if": {"properties": {"kind": {"const": "decision"}}},
      "then": {
        "properties": {
          "details": {
            "type": "object",
            "required": ["choice"],
            "properties": {
              "choice": {"type": "string", "pattern": "\\S"},
              "alternatives": {"type": "array", "items": {"type": "string", "pattern": "\\S"}}
            },
            "additionalProperties": false
          }
        }
      }
    },
    {
      "if": {"properties": {"kind": {"const": "procedure"}}},
      "then": {
        "properties": {
          "details": {
            "type": "object",
            "required": ["steps"],
            "properties": {
              "steps": {"type": "array", "minItems": 1, "items": {"type": "string", "pattern": "\\S"}}
            },
            "additionalProperties": false
          }
        }
      }
    },
    {
      "if": {"properties": {"kind": {"const": "policy"}}},
      "then": {
        "properties": {
          "details": {
            "type": "object",
            "required": ["rule"],
            "properties": {
              "rule": {"type": "string", "pattern": "\\S"},
              "authority": {
                "oneOf": [
                  {"type": "string", "format": "uri"},
                  {
                    "type": "object",
                    "required": ["uri", "revision"],
                    "properties": {
                      "uri": {"type": "string", "format": "uri"},
                      "revision": {"type": "string", "minLength": 1}
                    },
                    "additionalProperties": false
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        }
      }
    },
    {
      "if": {"properties": {"kind": {"const": "lesson"}}},
      "then": {
        "properties": {
          "details": {
            "type": "object",
            "required": ["takeaway"],
            "properties": {"takeaway": {"type": "string", "pattern": "\\S"}},
            "additionalProperties": false
          }
        }
      }
    }
  ]
}
```

## 4. Informational Link Types

These meanings are distinct from existing Dependency kinds even where English
labels overlap. Existing related/supersedes Dependencies are not converted or
reinterpreted. Select the Type identities in §2 explicitly.

| Link Type | Allowed source Types | Allowed target Types | Assertion and target pin |
| --- | --- | --- | --- |
| MemoryRelated | ANY | ANY | Navigation only; floating or pinned, no claim of use or support |
| MemoryGuidance | [Issue] | [Memory] | Intended guidance; floating or pinned, no claim it was read |
| MemoryAppliesTo | [Memory] | ANY | Source claims relevance/applicability to target; floating or pinned |
| MemorySupports | [Memory] | [Memory] | Source offers support for target content; exact target pin required |
| MemoryChallenges | [Memory] | [Memory] | Source offers reason to reconsider target content; exact target pin required |
| MemorySupersedes | [Memory] | [Memory] | Source offered as replacement for target content; exact target pin required |

Memory here is K/memory, including every kind. No endpoint validator dispatches
on note, decision, procedure or another kind. Related deliberately permits
Issue→Memory, Memory→Issue and Issue→Issue. It does not require either end to be
Memory; that broader meaning is the recommended repair to the comparison draft's
source restriction. These Links are directed records; clients may inspect incoming
and outgoing Links for navigation without inventing a reciprocal stored Link.

A Link’s `source` and `target` are ordinary BDP reference members, not copies in
properties. At least one endpoint MUST be an in-Scope Bead. Known local endpoint
Type mismatches and self-links (same canonical endpoint identity, regardless
of pins) fail before mutation. Source pins, when supplied, retain their ordinary
exact-reference meaning; owned-state mutation remains governed by the source
identity, not permission to edit a pinned historical revision.

An in-Scope floating endpoint must be live at admission; an exact local endpoint
must name a valid retained historical state under the required Memory graph
profile. A remote endpoint is not fetched to admit the Link; its expected
Memory/Issue role is a declared expectation, not a verified Type. Reads separate
that expectation from observed availability/Type. An unavailable remote target
is not reported as known deleted. A relationship may therefore be recorded with
an unverified remote role; the service must never report local-style validation
of that role. Related permits opaque external references at either end. Other
rows admit bead-shaped external references where a Bead role is required, and any
external URI for unrestricted targets. These policies constrain reference shape,
not remotely verified Type.
At least one endpoint must still be local for every row.

The pin requirement for supports/challenges/supersedes is an explicit new design
choice in this proposal. It prevents an assertion about one conclusion
from silently applying to a rewritten conclusion. `related` remains available
for a weaker floating association. The source remains free to evolve; a query
about what was asserted at a particular time must read an exact source/Link
revision, not infer a historical snapshot from the target pin alone.

Supersedes does not assert global exclusivity or create a total order. Multiple
replacements may coexist for different conditions. A cycle is reported as
recorded data, not resolved into a winner; consumers must bound traversal and
must not infer transitive replacement, truth or authority. Corrections to the
same record ordinarily create revisions; a new decision may deliberately use a
new identity and a supersedes Link. The author makes that distinction.

Link properties include an optional nonblank `note`, explaining this relationship,
and an optional `extensions` JSON object. Application-specific relationship
annotations go in common Link metadata. A note on the Link describes the
relationship; it is not a second authoritative decision rationale. Unknown
top-level properties are preserved without acquiring defined semantics. None of
these Links changes Issue readiness,
executes a procedure, follows References recursively or grants access.
Any Link with a Memory endpoint, including a user-defined Link Type, MUST be
non-workflow: blocking and other Issue-workflow relationships are rejected.
This constrains Memory participation without redefining Dependency itself.

Memory owns **every outgoing Link**, including independently registered user
Link Types, through wildcard ownership. Every owned-Link creation, property/
metadata change, pin update or deletion versions the Memory source atomically;
incoming changes never version the target. This draft tests a total owned-Link
maximum of **1024** per Memory; excess fails before mutation. That proposed
bound is not an inherited universal product limit.
It must be reviewed against real authoring sizes before adoption.

Issue ownership and Dependency behavior are external contracts. Defining a new
Memory relationship does not silently edit the Issue descriptor. Admission of
a non-owned informational Link from an Issue follows the existing Issue contract;
if a particular deployment rejects such Links, that capability gap must be
reported rather than changing Issue semantics in this file. An Activity’s subject
reference to a Link is still governed by Provenance V2, not a graph endpoint here.

Each of the six Link Types uses this complete properties schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {"note": {"type": "string", "pattern": "\\S"}, "extensions": {"type": "object"}},
  "additionalProperties": true
}
```

The open root preserves unknown properties; an incidental property named kind
has no defined relation-selection effect. The intrinsic Type alone selects the
Link meaning. Target-pin requirements, self-link checks, historical endpoint
admission and non-workflow participation need shared enforcement beyond properties
schemas and nominal endpoint lists. Their descriptor/wire support is an adoption
gate, not an inferred capability of the current Type descriptor.

### 4.1 Defaults, maxima and listing

Link endpoints default to floating. A caller may supply a pin or explicitly
request resolve-current-and-pin. A required pin is never silently supplied for a
bare reference. Type affiliations, in contrast, always pin on storage; update
omission preserves the existing exact affiliation.

Maximums apply to the enforcing Scope's own Link table, including external
endpoint identities. They count per endpoint identity across all pins and floating
references; another Scope's Links are outside the count. No mechanical minimums
or per-revision arity are proposed. A maximum may count an explicit OR set of
Link Types together. All applicable Type and Scope rules must pass; Scope rules
may tighten, not relax, a Type rule. Remote Type eligibility remains unverified,
separate from counts based on known Link Types and endpoint identities. Descriptor
placement and encoding of grouped maxima remain shared work.

A Link listing for a Bead identity includes floating endpoints and all explicit
pins. A revision filter matches only that stored endpoint pin, not floating
references that currently resolve to it. Only-floating selection is separate.
A retained-Link-version query applies these filters to each historical Link
version's own endpoint. None is a historical graph snapshot. Wire and CLI query
support must be specified; this document stays with revision-flag terminology.

BDP's ordered atomic batch validates each staged operation. With maximum-only
constraints, deleting an old Link before creating its replacement permits a valid
intermediate zero, rolls everything back on failure and exposes no committed gap.
That example needs neither final-state-only validation nor a special replacement
primitive. [Upstream bd batch as surveyed](https://github.com/gastownhall/beads/blob/d4ca89369f72e4666fe76493e4cab700a7e73320/cmd/bd/batch.go)
is transactional for its narrow Issue/Dependency grammar; it does not establish
generic Link command coverage.

## 5. Updates, Type changes and queries

### 5.1 Changing a Memory kind

A Memory can change from observation to decision under the same identity and
nominal Type. The caller explicitly supplies the new kind and valid replacement
details. Incompatible old details are not silently retained or discarded. The
combined write succeeds atomically or not at all. Earlier exact revisions retain
their original kind and details. This does not assert the record was always a
decision. Omitted kind preserves the saved kind.

The supplied Link constraints accept Memory regardless of kind, so this change
alone does not invalidate them. A consumer needing the previous content uses an
exact pin. A server cannot promise a rewritten Memory remains useful advice.

### 5.2 Explicit nominal Type changes

The proposal assumes support for changing the Type of an existing Bead or Link
through an explicit update, preserving Resource identity. The resulting revision
pins the selected definition. Omission preserves both nominal identity and pin;
publication or installation of a definition never migrates an instance implicitly.
A Bead remains a Bead and a Link remains a Link: this does not authorize conversion
between Resource categories.

The new properties and selected Type must validate together. No field is dropped,
renamed or given a new meaning merely because the caller changed the Type. A
conversion supplies its data transformation explicitly. Previous revisions retain
their exact original Type definitions and data. Reference pins never retarget.

For a Bead Type change, recheck affected floating endpoints in the Scope's own
Link table against each Link's pinned definition. A pinned endpoint is checked
against the referenced historical Bead state, whose Type has not changed. Other
Scopes cannot participate in this transaction; their floating references may
observe the new Type and cannot carry a global validity guarantee.

For a Link Type change, validate the new definition's endpoint and pin rules and
re-evaluate affected maxima and source ownership. A MemorySupports Link may become
MemoryChallenges under the same identity through an explicit valid Type update;
a Link with an Issue source cannot become MemorySupports while retaining those
endpoints. The new Type changes the current assertion, not earlier Link revisions.
This does not authorize changing endpoint identities; same-identity re-pinning
is its own shared operation (§6).

A Type change that would leave invalid local graph state must fail atomically.
Related Link repairs may use an ordered atomic batch when a valid operation order
exists. Do not assume every migration has such an order or that batch skips
intermediate validation. In particular, changing a Bead's ownership declaration
can change its current owned-Link projection. The shared design must specify
validation against old/new ownership, resulting revisions, authorization, receipts
and atomicity before this operation ships. Historical owned sets must not be
rewritten. This Memory proposal requires those outcomes but does not invent their
wire mechanism or claim the general migration problem solved.

### 5.3 Query behavior and extensibility

To find all Memories, select nominal K/memory; all six kinds and extension URI
kinds participate. To find decisions, add properties.kind=decision. To find
support, select K/memory-supports; to find support and challenges together, use
an explicit OR of those two Link Type IDs. No conformance closure is needed.

Queries match the affiliation of the Resource revision being queried. A current
query stops matching the old Type after a Type change; a retained old revision
still matches its recorded Type. A definition-pinned Type filter matches that
exact affiliation; a nominal Type filter spans its definition revisions. Resource
revision filtering is distinct from Type-definition revision filtering.

An independent custom Bead Type is excluded from a Memory-only query and from
restricted Memory endpoints, even with identical properties. ANY endpoints
already accept it. Query adoption and Link-definition adoption are separate,
explicit choices. Installing a Type does neither. A revised Link definition must
be explicitly selected; existing Links preserve their definition pins. Broadening
an endpoint set is not automatically compatible with earlier consumers' guarantees.

A URI kind permits experimentation inside Memory with weaker details validation.
Strict additional kind validation needs a separate validator mechanism or an
independent managed Type. There is no automatic fetching of a URI-kind schema.

Property and multi-Type selectors need supported, ordered and bounded query
semantics. Filtering one page or concatenating independent first pages must not
be advertised as a complete result. Indexes are implementation choices; no
performance measurement is claimed. Editors preserve unfamiliar kinds/details
and other unknown fields, or refuse an unsafe edit instead of erasing them.

## 6. Shared operations and Beads behavior

These obligations are consumed from shared BDP/Beads services; a JSON Schema or
Type declaration alone cannot implement them. This proposal does not redefine Issue,
Dependency, Activity, revisionProvenance, transactions or authorization.

- Every durable Memory change, including metadata, Inception and the owned Link
  set, creates a retained version. An identical write is a no-op. Actor/context
  alone does not manufacture a revision. Reject unversioned Memory writes.
- Guarded writes reject a stale source revision with the shared current-version
  outcome. Unguarded accepted writes report the replaced revision and its
  attribution. Link mutation plus owned-source revision must be atomic. This
  specification does not invent a general cross-Bead transaction API.
- Provenance V2 supplies actor, commit time, assisting agent, message, recorded
  sources and completeness. Do not add a second derived-from field or synchronize
  source entries into Links. Source omission/reset follows V2. A policy citation
  or support Link does not authenticate a participant or establish approval.
- A post-facto report is an Activity under V2. Later supporting/challenging
  knowledge can be a new Memory with an incoming Link to an older decision pin;
  it does not rewrite that decision’s original sources.
- Current deletion yields no live Memory body. Retained exact revisions remain
  addressable under History; expired/erased states yield the authorized specific
  gone result, never current content. Deletion and erasure are distinct.
- To meet Chris R20, local incident Links whose reference to a deleted Bead floats
  are removed, while Links pinned to retained history survive. Owned sources
  changed by cleanup receive new revisions; deletion results enumerate affected
  Links/sources within authorized bounds. Historical owned sets never change.
  Restoring a deleted Memory creates a new revision under the same identity and
  does not resurrect removed Links or take a reused key back.
- To meet R23, re-pinning the same endpoint identity preserves Link identity and
  records a new Link/source revision. Retargeting to a different identity is not
  granted by that requirement. **Current BDP still specifies immutable pins and
  incident-Link deletion refusal.** This proposal needs explicit shared-graph
  amendments; it does not silently override those rules or claim readiness.
- Activity retention after its subject is deleted is the separate V2 rule. It
  cannot be inferred from graph-Link cascade policy. Late Activity admission for
  pruned subjects does not weaken the retained-pin checks on new graph Links.
- Keys use canonical identity resolution, never content-derived identity. The
  shared alias facility must settle Chris’s open key-placement/version/restore
  question. No Type-specific shadow key store is permitted. This remains a
  shared-contract decision, not a field quietly added here.

`remember`, `recall`, `memories` and `forget` remain Beads adapters to canonical
Memory records. This draft selects no new CLI flag grammar. Unclassified creation
must remain easy and write-only; a remembered single token never becomes a read.
A supplied classification/form or target Type requires its structured fields
explicitly; a service does not infer a decision choice or procedure steps from
Markdown. Friendly authoring prompts can collect them without being a stored
“template” mechanism.

Discovery returns compact summaries and exact selected revision addresses,
deterministic ordering, match information and honest continuation/completeness.
It does not load bodies. Explicit recall returns one complete selected record,
including body, metadata, owned Links, Inception and revision provenance under
that surface’s contract. Kind/Type-specific structured details MUST accompany a
full structured read; a plain body-only view is not the full record. Do not
silently duplicate details into the stored body just to make that view complete.

Issue display, ordinary graph traversal and generated guidance never recursively
load Memory bodies. Generated guidance gives actual supported command forms;
it must not advertise syntax from this draft. R25’s explicit legacy body-carrying
list interfaces and R27a’s summary/excluded/body-carrying boundaries must be
mapped surface by surface, including automatic export exclusions. Type recognition
alone does not grant permission to return bodies or metadata in a summary.

Connected interchange must preserve IDs, exact pins, classification/Type meaning,
metadata, provenance and required definitions, or fail before publishing a partial
connected unit. It must not merge records by key or title. Legacy conversion
preserves empty values and unknown origin/source/actor information honestly.
This proposal is not a historical-backup or synchronization protocol.

## 7. Properties, metadata and complete reading

In this proposal, title/body, Inception, applicability and the specified details
are schema-defined properties. A form’s required structure is testable before
storage. Common metadata remains an open, versioned annotation object: team
labels, UI layout hints and integration identifiers may live there. Metadata
may be important and validated by an application; the BDP properties schema does
not validate it. extensions provides an explicit open property area but grants
no universal interpretation of unknown members.

Both a CLI and an independent BDP client can reject a decision Memory with no
choice, a procedure Memory with no steps, or an
invalid applicability interval. This is more than a different display label.

The cost is equally concrete: Chris R3 deliberately leaves application fields
in metadata. Retaining that rule unchanged means moving applicability and
specialized details to an agreed metadata namespace, with application validation
or another explicit shared validation facility. Without that facility, ordinary
BDP validation would accept a record whose supposed decision/procedure data is
missing or malformed. Specialized forms are optional to use, but their field
placement remains a proposed refinement of R3. Even if plain notes satisfy the
basic capture need, this catalog must not be called unchanged R3 compliance.

Structured choice/steps also extend R7’s body-centric reading experience: a plain
body-only output can omit substantive information. This proposal therefore needs
an explicit complete human rendering of body plus structured details, or must
choose to keep substantive knowledge in Markdown and use structure only for
annotations. This is a product decision to test, not hidden by the schema.

The top-level schemas remain open, and the defined nested details shapes reject
undeclared members. The extensions object is an optional application convention,
not the only legal home for additional properties. Adding a newly constrained
field, changing dollars to
cents, or changing what a relationship asserts is not automatically a compatible
revision. Both structural and semantic compatibility promises from Type design
still apply. This proposal does not settle publication/version tooling.

## 8. Worked records

These are full illustrative authoring payloads after defaults except that common
identity/revision/provenance fields are omitted. Type revision tokens illustrate
exact affiliation; they are not SemVer encodings. The actual saved records also
carry the common provenance and owned-state representation.

```json
{
  "type": {"uri": "https://example.org/memory-types/memory", "revision": "definition-1"},
  "properties": {
    "kind": "decision",
    "title": "Supplier choice",
    "body": "Acme met the delivery requirement at an acceptable cost. Beta missed the delivery window.",
    "details": {"choice": "Use Acme for the next quarter", "alternatives": ["Beta"]},
    "applicability": {"description": "Purchasing for the western region in the next quarter"},
    "inception": {"method": "native"}
  },
  "metadata": {}
}
```
```json
{
  "type": {"uri": "https://example.org/memory-types/memory-supports", "revision": "definition-1"},
  "source": "https://example.org/project/beads/assessment",
  "target": {"uri": "https://example.org/project/beads/supplier-choice", "revision": "decision-r1"},
  "properties": {
    "note": "The assessment supports the delivery-time basis of this decision."
  },
  "metadata": {}
}
```

**Office sequence:** create assessment M1 as observation; create decision M2 as
decision with exact original input sources in V2; link M1 supports M2@r1. A later
finding M3 challenges M2@r1 without changing M2. If M1 itself is recategorized as
a decision, its identity survives but its sources and history must make the new
claim understandable; no writer is credited retroactively. A different supplier
choice may instead be a new M4 superseding M2@r1. Changing kind does not itself
mean supersession.

**Technician sequence:** create M5 kind=procedure with steps and applicability to
housing B. An existing Issue gets guidance to M5’s identity; an actual report
uses Activity externally and records the exact procedure edition when known.
An observation M6 challenges M5@r2 after a different housing fails. Updating M5’s
steps creates r3, not a new Memory identity. The old pin still names r2. The same
Issue does not become blocked merely because a challenge exists.

## 9. Acceptance cases and requirements

These are proposed observable outcomes and requirements walkthroughs, not executed
product acceptance tests. They include the technician and supplier examples used
to assess the hybrid. They do not establish complete R1–R31 implementation.

| Case | Expected outcome |
| --- | --- |
| Save an unclassified note with title only | Accept; kind=note, body empty and details empty; recall succeeds |
| Save body without title | Derive title before storage; no inferred classification |
| Decision without choice; procedure with empty steps | Reject before mutation |
| observedAt omitted | Unknown; never substitute commit time |
| applicability from >= until | Reject; clock crossings alone never version the record |
| Unknown short kind decison | Reject as an unsupported discriminator |
| Unknown absolute HTTP(S) URI kind | Preserve common fields and opaque details; do not claim specialized validation |
| Unknown top-level property | Preserve; no automatic semantic meaning |
| Note becomes procedure at the same identity | Explicit kind/details update; earlier pins retain the note |
| Issue points to policy or procedure for guidance | Accept MemoryGuidance to either Memory kind; no readiness effect |
| Issue points to Memory for navigation only | Accept MemoryRelated; no false guidance/use assertion |
| Memory cites an Issue as background | MemoryRelated can carry that navigation; original inputs use V2 sources separately |
| Assessment supports a supplier decision | Accept MemorySupports with exact decision target pin |
| Observation challenges a procedure edition | Accept MemoryChallenges with exact procedure target pin |
| Supports with Issue source | Reject; endpoint Type mismatch |
| Supports without target pin | Reject; no silent current-version pinning |
| Policy or decision supersedes an earlier record | Accept valid exact-target MemorySupersedes; no automatic retirement |
| Self-link with two different revision pins | Reject; canonical endpoint identity is the same |
| Independent InspectionFinding Type installed | Excluded from restricted Memory endpoints/queries; accepted by ANY ends |
| Nominal Type change with omitted or invalid transformed properties | No implicit conversion; reject if resulting state fails validation |
| Generic Bead promoted to valid Memory | Preserve identity once shared Type-update/ownership support exists; old pins retain generic state |
| Type change invalidates an existing floating local endpoint | Reject unless explicit transaction repairs leave every staged state valid |
| Endpoint pinned before target changes nominal Type | Continue evaluating its historical Type; no latest fallback |
| Supports explicitly changes Type to Challenges | Preserve Link identity if all new rules pass; version Link and owned Memory source |
| Second Link exceeds a maximum using another revision pin | Reject; pins create no extra identity-based slots |
| Second Link exceeds an applicable maximum at an external URI | Reject based on this Scope's table; remote visibility is not required for the known count |
| Atomic delete-old/create-new replacement fails during create | Roll back the deletion; no partial committed replacement |
| Existing Dependency related/supersedes | Preserve its existing Type and meaning |
| Delete, restore or prune a Memory target | Apply §6; a passing properties schema is insufficient evidence of lifecycle support |

**Known limit:** a Link that must accept only procedure and reject every other
Memory kind cannot express that distinction with [Memory]. It needs a separate
nominal Procedure Type or a new property-sensitive constraint. No examined Memory
requirement demands that server-enforced distinction. A procedure-only authoring
prompt or search filter does not by itself require such a graph invariant.

With explicit nominal Type updates available, separate knowledge-form Types no
longer necessarily force new identities on reclassification. The recommendation
for one Memory Type therefore rests on one all-Memory query and one endpoint
identity, useful kind-based authoring, and the absence of a demonstrated need for
form-specific endpoint enforcement. Distinct forms still share one definition's
evolution and schema branches. That tradeoff can be revisited without claiming
identity preservation uniquely favors this design.

| Proposal requirements | Coverage and remaining dependency |
| --- | --- |
| R1–R4 | Canonical knowledge record and deliberate authoring; optional structured forms; R3 departure explicit |
| R5, R13–R16 | Shared History, restore, erasure, retention and deletion support required |
| R6–R10 | Memory/kind discovery, bounded summaries, exact full reads and structured Links; no automatic context assembly |
| R11–R12 | Version durable/owned-state changes; V2 revision provenance and distinct Inception |
| R17–R23 | Open informational vocabulary, wildcard ownership, local/remote checks; graph lifecycle and re-pinning amendments needed |
| R24–R26/R31 | One canonical model behind existing commands; explicit Beads migration and output cutover |
| R27/R27a | Atomic connected publication and exposure policy per surface; Type registration alone is insufficient |
| R28–R30 | Public structured records and shared authorization; consumers judge truth, staleness and applicability |

## 10. Generic Types and promotion

A future generic Bead Type and generic Link Type could define only kind, possibly
as intrinsic Types. That lets people experiment without publishing a definition
for every application label. Their saved affiliations still pin definitions;
they are typed records with normal identity/history. Under the open-root rule,
“only kind” means the only defined property, not a ban on other properties.
Their names, intrinsic status, kind grammar, constraints and packaging are not
selected by this Memory catalog.

GenericBead(kind=memory) is not Memory. GenericLink(kind=supports) is not
MemorySupports. A constraint selecting the generic Type admits all its kinds,
and a maximum over that Type counts all its kinds. Generic records do not gain
Memory's validation, ownership or authoring behavior just through a label.

Explicit nominal Type updates provide the promotion path:

| Resource revision | Type affiliation | Meaning |
| --- | --- | --- |
| r1 | Exact generic Bead definition | Experimental procedure label and content |
| r2 | Same exact generic definition | Refined experimental content |
| r3 | Exact Memory definition | Valid kind=procedure, title/body and structured steps |

The identity stays fixed. Pins to r1/r2 retain the original Type and content;
floating references see r3. The promotion explicitly supplies a valid transformed
record and satisfies §5.2's local graph/ownership rules. A generic Link can
similarly become MemorySupports only if its endpoints and exact target pin meet
that Type's rules. This is a future shared capability, not a shipped command.

## 11. Review readiness and remaining decisions

“Ready” here means specified for review. “NYI” means not implemented or qualified
by this contribution; it does not claim every underlying product facility is absent.

| Area | Specification/design status | Implementation status / next decision |
| --- | --- | --- |
| One Memory and six Link Types | Ready for review; catalog and complete properties schemas included | Catalog installation and runtime validation NYI here; choose publisher IDs |
| Flat Type IDs and endpoint OR | Explicit shared direction | Canonical amendment and conformance coverage required |
| Explicit nominal Type updates | Proposed identity-preserving behavior and cases | NYI here; settle old/new ownership, revalidation, authorization and atomic results |
| Properties versus metadata | Recommended structured fields, explicit R3 refinement | Product decision required; no silent R3 compliance claim |
| Structured recall | Complete details required in structured output | Decide R7 human rendering and compatibility cutover |
| Related with unrestricted endpoints | Recommended, including Issue→Memory and Issue→Issue | Review breadth/name; no hidden either-end-Memory rule |
| Endpoint pins, maxima and queries | Rules stated; identity-based counting and explicit selectors | Descriptor/wire support, external counts and CLI affordances remain to specify |
| History, deletion, re-pinning and restore | Required outcomes in §6 | Shared graph/History changes and end-to-end qualification required |
| Provenance | Uses external V2 proposal | V2 adoption/integration remains separate; no duplicate fields introduced |
| Authoring defaults and owned-Link bound | 80-code-point derived title and 1024 maximum proposed | Review against product usage before adoption |
| Type lifecycle and packaging | Exact definitions and explicit adoption assumed | Installation/update/removal, retention, compatibility policy and bundle format remain shared decisions |
| Generic Types | Optional promotion scenario documented | Intrinsic status and definitions unselected; not a dependency for basic Memory capture |
| Beads migration and exposure | Obligations identified | Command adapters, aliases, outputs, imports/exports and capability claims require implementation work |

Before adoption, reconcile this recommendation with the canonical BDP specification
and the [Type lifecycle design](../../docs/design/type-lifecycle-preview2.md), which
still records earlier conformance and stable-nominal-affiliation assumptions.
Encode approved descriptors, operations, errors and conformance cases together.
This proposal is ready for design review; it grants no implementation staging,
release qualification or merge approval.
