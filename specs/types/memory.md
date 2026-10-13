# Memory Types — two complete candidate designs

Draft for discussion, October 13, 2026. **Neither approach is selected.** MUST,
SHOULD and MAY below describe the respective candidate, not adopted BDP law.
This file contains the Type definitions and their observable consequences in two
sections. It is the working specification for this comparison; earlier design
notes are background, not a third candidate.

Inputs: [Chris’s Memory proposal, revision 4](https://github.com/gastownhall/beads/issues/5877),
including R1–R31/R27a and its [relationship/applicability follow-up](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303);
[Provenance V2](https://github.com/gastownhall/beads/issues/7510);
and [BDP main checked at 90d3fd3](https://github.com/gastownhall/bdp/blob/90d3fd3385e5b0422c2c406e3c0dc38918873e04/docs/specs/bdp.md).
The issue bodies were reread October 13. [Prior-art research](../../docs/design/memory-type-prior-art-20261013.md)
supplies examples, not additional requirements.

**External definitions:** Issue is the existing Bead Type; Dependency is the
existing Link Type, with a pending kind discriminator. Their names, classifications,
validation, workflow effects and direction are not redefined here. Their legacy
shape is not precedent for either candidate. Activity and revision provenance
come exclusively from Provenance V2; this file adds no activity/run/causality
mechanism. A decision Issue is not automatically a decision Memory.

**Notation:** `K` denotes a publisher-controlled Type namespace; examples expand
it as `https://example.org/memory-types/`, which is not a proposed registry host.
`K/memory` names a stable Type identity; a stored Type affiliation additionally
pins its immutable definition revision under the Type-lifecycle proposal. Type
packaging, version-label encoding and installation plumbing are external. Resource
references are URI or `{uri, revision}`; an omitted resource pin is floating.
“Memory-family” below means the approach’s declared Memory Type plus Types
conforming to its exact admitted definition, not a string-prefix test or an
implicit nominal-Type match.

**Comparison control:** both approaches provide the same six knowledge forms,
six informational relationship meanings, fields, authoring checks, examples and
lifecycle obligations. They differ in whether these distinctions are encoded in
properties or nominal Type identities. The minimal Chris baseline needs only a
generic Memory and an informational `related` relationship. The other forms and
relations are optional application vocabulary to exercise his follow-up scenarios.
No operator must classify an ordinary note to save it.

Both deliberately test schema-defined applicability and form-specific data.
**This is a proposed departure from R3’s placement of application classification,
validity and similar information in metadata**, not a claim of unchanged R3
conformance. Each section specifies the cost of moving those fields back. Origin
(Inception) is distinct from the writer or information sources of a revision.

## Approach A — one Memory Type and one relationship Type, with discriminators

### A.1 Catalog and identification

| Type identity | Resource category | Definition |
| --- | --- | --- |
| K/memory | Bead | All six knowledge forms; properties.kind selects the form |
| K/memory-relationship | Link | All six relationship meanings; properties.kind selects the relation |

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
Type descriptor and is a concrete extra cost of this variant.

Independently registered user Bead/Link Types remain possible. A conforming custom
Memory must preserve the fields, versioning and ownership rules below; user-defined informational Link Types
are first-class and must not be forced into this discriminator Type. They count
under Memory’s wildcard ownership. This preserves R17’s open Type vocabulary even
though this candidate’s six supplied relationships share one Type.

### A.2 Bead fields and validation

All fields in this table are under `properties`. Common Resource identity,
revision, metadata, owned Links and revisionProvenance are outside properties.

| Field | Saved representation and rule |
| --- | --- |
| title | Required nonblank UTF-8 string; supplied or derived during authoring |
| body | Required UTF-8 Markdown string, possibly empty; stored verbatim |
| inception | Optional object: method is native, converted, imported or unknown; optional origin is the transfer/origin reference, not another source list |
| applicability | Optional object with required nonblank description and optional validFrom/validUntil RFC 3339 instants |
| extensions | Optional open JSON object for application fields outside this edition’s defined property names |
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

For this comparison, a derived title is the first nonblank body line trimmed to
80 Unicode code points, without parsing Markdown. This concrete authoring choice
is identical in both candidates and can be replaced in both together. Existing
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
stronger forms are an opt-in test of meaningful schemas, not an extra requirement
on every R4 remember operation.

### A.3 Properties schema

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
  "additionalProperties": false,
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
### A.4 Informational relationships

The following six meanings are distinct from the externally defined Dependency
kinds, even where the English label overlaps. No existing Dependency is retyped,
and no existing supersedes/related direction is changed by this specification.
This Memory vocabulary MUST use the identities declared in this approach.

| Meaning | Source → target | Meaning and pin rule |
| --- | --- | --- |
| related | Any Bead → any resource, with at least one observed local Memory-family endpoint | Navigation only; either endpoint may be pinned; no claim of use or support |
| guidance | Issue → Memory-family | Intended guidance for the Issue; target may float or pin; does not claim it was read |
| applies-to | Memory-family → any Bead or external resource | The Memory declares relevance/applicability to the target; target may float or pin; conditions remain explicit |
| supports | Memory-family → Memory-family | Source offers support for the target’s content; target pin required |
| challenges | Memory-family → Memory-family | Source offers a reason to reconsider the target’s content; target pin required |
| supersedes | Memory-family → Memory-family | Source is offered as replacement for the target’s content; target pin required; no automatic retirement or retargeting |

A Link’s `source` and `target` are ordinary BDP reference members, not copies in
properties. At least one endpoint MUST be an in-Scope Bead. Known local endpoint
kind/Type mismatches and self-links (same canonical endpoint identity, regardless
of pins) fail before mutation. Source pins, when supplied, retain their ordinary
exact-reference meaning; owned-state mutation remains governed by the source
identity, not permission to edit a pinned historical revision.

An in-Scope floating endpoint must be live at admission; an exact local endpoint
must name a valid retained historical state under the required Memory graph
profile. A remote endpoint is not fetched to admit the Link; its expected
Memory/Issue role is a declared expectation, not a verified kind. Reads separate
that expectation from observed availability/kind. An unavailable remote target
is not reported as known deleted. A relationship may therefore be recorded with
an unverified remote role; the service must never report local-style validation
of that role. Related requires an actual local Memory endpoint so an arbitrary
pair of external claims cannot qualify.

The pin requirement for supports/challenges/supersedes is an explicit new design
choice shared by both approaches. It prevents an assertion about one conclusion
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
defined property names are rejected. None of these Links changes Issue readiness,
executes a procedure, follows References recursively or grants access.
Any Link with a Memory endpoint, including a user-defined Link Type, MUST be
non-workflow: blocking and other Issue-workflow relationships are rejected.
This constrains Memory participation without redefining Dependency itself.

Memory owns **every outgoing Link**, including independently registered user
Link Types, through wildcard ownership. Every owned-Link creation, property/
metadata change, pin update or deletion versions the Memory source atomically;
incoming changes never version the target. This draft tests a total owned-Link
maximum of **1024** per Memory; excess fails before mutation. That candidate
bound is the same in both approaches, not an inherited universal product limit.
It must be reviewed against real authoring sizes before adoption.

Issue ownership and Dependency behavior are external contracts. Defining a new
Memory relationship does not silently edit the Issue descriptor. Admission of
a non-owned informational Link from an Issue follows the existing Issue contract;
if a particular deployment rejects such Links, that capability gap must be
reported rather than changing Issue semantics in this file. An Activity’s subject
reference to a Link is still governed by Provenance V2, not a graph endpoint here.

A relationship’s saved kind is required: related, guidance, applies-to, supports,
challenges or supersedes, or an extension HTTP(S) URI. An omitted kind on creation
defaults to related; update omission preserves it. Its properties schema is:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["kind"],
  "properties": {
    "kind": {
      "oneOf": [
        {"enum": ["related", "guidance", "applies-to", "supports", "challenges", "supersedes"]},
        {"type": "string", "pattern": "^https?://"}
      ]
    },
    "note": {"type": "string", "pattern": "\\S"},
    "extensions": {"type": "object"}
  },
  "additionalProperties": false
}
```

A known relationship kind MUST pass the corresponding endpoint row above.
For an extension kind, apply only the related row’s structural endpoint bounds
(at least one local Memory, no self-link, at least one local Bead), without
asserting related semantics. No unknown kind may acquire workflow effects.

The K/memory-relationship descriptor can express only the broad endpoint envelope.
Its schema can check properties.kind but cannot read endpoint Types. The authority
therefore needs a Memory relationship validator that dispatches on kind; accepting
Issue → Issue with kind=supports because the broad descriptor accepts it is a
conformance failure. Merely installing today’s descriptor cannot enforce this
candidate. Missing that validator must make the capability unsupported, not a
silently weaker implementation.

### A.5 Updates, reclassification and querying

A Memory can change from observation to decision under the **same identity**.
The write must explicitly select decision and supply a valid replacement details
object; incompatible old details are not silently retained or discarded. The
combined mutation succeeds atomically or not at all. Old exact revisions still
have their old kind/details. This records a change of classification, not an
inference that the old observation was always a decision.

This edition’s Links constrain Memory-family membership, not individual Memory
kinds, so that reclassification does not invalidate them. An application that
later requires “target must be decision” needs an additional predicate contract
and incident-Link revalidation policy; it cannot claim today’s Type-only endpoint
constraint expresses that rule.

A relationship can change from supports to challenges while keeping its Link ID
because its declared Type stays K/memory-relationship. Require an explicit kind
update, valid endpoints/pin and an ordinary new Link revision. If source is Memory,
version that source too. Reusing an ID preserves continuity of the relationship
record while changing what it says. This is intentionally permitted in A and is
a behavior a reviewer must accept or reject. Changing guidance to supports for an
Issue source fails its endpoint check; it must not leave half an update.

To query decisions: select Memory-family and properties.kind=decision. To query
support Links: select K/memory-relationship and properties.kind=supports, plus any
independently registered Link Types whose own contracts the consumer selects.
Never treat all instances of the relationship Type as support. Indexes may help,
but do not change authorization or bounded-result completeness. A properties-only
filter without the Type/family qualification may match unrelated JSON records.

A generic Memory query includes all supplied forms through one nominal Type;
custom conforming Types still require an explicit family/conformance query.
Old clients must preserve unfamiliar URI kinds and details rather than coerce
those records to note. An editor unable to preserve the current form fails safely
instead of erasing fields on save.

### A.6 Shared-operation obligations and Beads behavior

These obligations are consumed from shared BDP/Beads services; a JSON Schema or
Type declaration alone cannot implement them. Neither approach redefines Issue,
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
  incident-Link deletion refusal.** Both candidates need explicit shared-graph
  amendments; neither silently overrides those rules or claims readiness.
- Activity retention after its subject is deleted is the separate V2 rule. It
  cannot be inferred from graph-Link cascade policy. Late Activity admission for
  pruned subjects does not weaken the retained-pin checks on new graph Links.
- Keys use canonical identity resolution, never content-derived identity. The
  shared alias facility must settle Chris’s open key-placement/version/restore
  question. No Type-specific shadow key store is permitted. This remains a
  shared-contract decision, not a field quietly added by either approach.

`remember`, `recall`, `memories` and `forget` remain Beads adapters to canonical
Memory records. This draft selects no new CLI flag grammar. Unclassified creation
must remain easy and write-only; a remembered single token never becomes a read.
A supplied classification/form or specialized Type requires its structured fields
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
Neither candidate is a historical-backup or synchronization protocol.

### A.7 Properties, metadata and the R3 tradeoff

For this candidate, title/body, Inception, applicability and the specified details
are schema-defined properties. A form’s required structure is testable before
storage. Common metadata remains an open, versioned annotation object: team
labels, UI layout hints and integration identifiers may live there. Metadata
may be important and validated by an application; the BDP properties schema does
not validate it. extensions provides an explicit open property area but grants
no universal interpretation of unknown members.

The exact benefit being tested is concrete: both a CLI and an independent BDP
client can reject a Decision with no choice, a Procedure with no steps, or an
invalid applicability interval. This is more than a different display label.

The cost is equally concrete: Chris R3 deliberately leaves application fields
in metadata. Retaining that rule unchanged means moving applicability and
specialized details to an agreed metadata namespace, with application validation
or another explicit shared validation facility. Without that facility, ordinary
BDP validation would accept a record whose supposed decision/procedure data is
missing or malformed. If these stronger shapes are only optional application
Types/conventions, the minimal generic Memory remains R3-compatible; claiming
the whole extended vocabulary as mandatory Memory core would require amending R3.

Structured choice/steps also extend R7’s body-centric reading experience: a plain
body-only output can omit substantive information. Both candidates therefore need
an explicit complete human rendering of body plus structured details, or must
choose to keep substantive knowledge in Markdown and use structure only for
annotations. This is a product decision to test, not hidden by either schema.

The schema shapes intentionally reject undeclared defined fields and have an
open extensions object. Adding a newly constrained field, changing dollars to
cents, or changing what a relationship asserts is not automatically a compatible
revision. Both structural and semantic compatibility promises from Type design
still apply. This experiment does not settle publication/version tooling.

### A.8 Worked records

These are full illustrative authoring payloads after defaults except that common
identity/revision/provenance fields are omitted. Type revision tokens illustrate
exact affiliation; they are not SemVer encodings. The actual saved records also
carry inherited provenance and owned-state representation.

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
  "type": {"uri": "https://example.org/memory-types/memory-relationship", "revision": "definition-1"},
  "source": "https://example.org/project/beads/assessment",
  "target": {"uri": "https://example.org/project/beads/supplier-choice", "revision": "decision-r1"},
  "properties": {
    "kind": "supports",
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

### A.9 What fails, and what A makes expensive

| Exercise | Required outcome or exposed cost |
| --- | --- |
| Generic note with title and empty body | Accept after defaults; recall succeeds with empty body |
| kind=decision with no choice | Reject before mutation; a display label alone is insufficient |
| kind=procedure with empty steps | Reject before mutation |
| observedAt omitted | Unknown; never substitute the commit time |
| applicability from >= until | Reject before mutation; no automatic lifetime transitions |
| Unknown short kind decison | Reject; do not invent a category from a typo |
| Unknown URI kind | Preserve/read common fields; admit only under the explicitly weaker extension contract |
| Observation → decision, same ID | Accept only with valid atomic replacement; old revision stays observation |
| supports → challenges, same Link ID | Allowed explicit semantic change; source ownership produces a new source revision |
| Issue → Memory with kind=supports | Reject despite the broad descriptor; needs kind-aware endpoint validator |
| Support target pin omitted | Reject; related is available for a weaker association |
| New useful field only for decisions | Change the enclosing Memory definition or use its extension area; all kind branches share that Type’s evolution |
| One publisher wants strict warranty-record kind validation | Requires an extension validator or a separate conforming Type; the simple two-Type catalog no longer tells the full story |
| Existing Dependency related/supersedes | Leave untouched; no automatic conversion or inferred equivalence |
| Deleted/pruned target | Apply A.6; unsupported shared lifecycle is a gate, not a schema success |

A’s concrete advantages are same-identity reclassification, one supplied Memory
Type filter and two supplied definitions. Its concrete liabilities are branching
validation and queries, semantic Link-kind changes under stable identity, shared
definition evolution, and extra machinery for strict extension-kind/endpoint
validation. Moving kind into metadata would weaken the admission contract unless
another validator were introduced; it is not an equivalent simplification.

### A.10 Requirement coverage and adoption gates

| Proposal requirements | Candidate coverage and remaining dependency |
| --- | --- |
| R1–R4 | Canonical knowledge record, title/body and deliberate authoring; optional extended forms; R3 structured-field departure explicit |
| R5, R13–R16 | Shared History required; restore, erasure, retention and deletion semantics require end-to-end service support |
| R6–R10 | Family discovery, bounded summaries, exact full reads and structured Links; no automatic context assembly |
| R11–R12 | Version every durable/owned-state change; inherit V2 attribution and separate editable Inception |
| R17–R23 | Open informational vocabulary, wildcard ownership, local/remote checks; stable-ID re-pinning and surviving pinned Links require BDP amendments |
| R24–R26/R31 | One canonical model behind old commands; safe migration and explicit compatibility/output cutover remain Beads work |
| R27/R27a | Atomic connected publication and declared exposure per surface; cannot be supplied by registering Types |
| R28–R30 | Public structured records and shared authorization; outside tools judge truth, staleness and applicability |

**Ready for review:** candidate definitions, field rules, endpoint rules, examples
and failure cases in this section. **Not selected or implemented by this work:**
Type identifiers/definitions in a production catalog, exact conformance-version
matching, property-versus-metadata policy, authoring/output migration, alias
placement, profile/capability admission, lifecycle amendments and packaging.
No schema fragment in this document is a new canonical BDP wire schema. Before
adoption, encode the selected definitions, shared-operation requirements and
errors in the canonical specification and conformance suite together.

## Approach B — separately identified Bead and Link Types

### B.1 Catalog and identification

| Type identity | Resource category | Definition / conformance |
| --- | --- | --- |
| K/memory | Bead | Concrete unclassified Memory, and base contract for every form below |
| K/observation | Bead | Observation, conforms to the exact admitted K/memory definition |
| K/decision | Bead | Decision, conforms to the exact admitted K/memory definition |
| K/procedure | Bead | Procedure, conforms to the exact admitted K/memory definition |
| K/policy | Bead | Policy, conforms to the exact admitted K/memory definition |
| K/lesson | Bead | Lesson, conforms to the exact admitted K/memory definition |
| K/memory-related | Link | related meaning from B.4 |
| K/memory-guidance | Link | guidance meaning from B.4 |
| K/memory-applies-to | Link | applies-to meaning from B.4 |
| K/memory-supports | Link | supports meaning from B.4 |
| K/memory-challenges | Link | challenges meaning from B.4 |
| K/memory-supersedes | Link | supersedes meaning from B.4 |

No properties.kind or metadata kind duplicates the declared Type. An unclassified
create selects K/memory; explicit specialized authoring selects its Type and
required fields. The service MUST NOT infer that choice from prose, Issue kind
or linked records. Each supplied definition has its own exact revision. A
Decision definition may evolve independently of Procedure, subject to their own
compatibility promises and the fixed base conformance dependency.

User-defined Memory Types may conform to the base. User-defined informational
Link Types remain first-class and count under wildcard ownership. A reader can
interpret common Memory fields when it has a trusted/usable conformance path;
an unfamiliar nominal Type is not automatically a Memory by name or URI prefix.
If conformance evidence is unavailable, return an unknown classification or the
ordinary capability/validation failure, never omit records while claiming a
complete Memory-family result. Offline reading need not fetch a remote schema.

There are six supplied Bead Types and six supplied Link Types. There is no extra
abstract Link base solely for this catalog; clients that want a combined Link
view must deliberately select the six identities or a separately agreed family.

### B.2 Bead fields and validation

All fields in this table are under `properties`. Common Resource identity,
revision, metadata, owned Links and revisionProvenance are outside properties.

| Field | Saved representation and rule |
| --- | --- |
| title | Required nonblank UTF-8 string; supplied or derived during authoring |
| body | Required UTF-8 Markdown string, possibly empty; stored verbatim |
| inception | Optional object: method is native, converted, imported or unknown; optional origin is the transfer/origin reference, not another source list |
| applicability | Optional object with required nonblank description and optional validFrom/validUntil RFC 3339 instants |
| extensions | Optional open JSON object for application fields outside this edition’s defined property names |
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

For this comparison, a derived title is the first nonblank body line trimmed to
80 Unicode code points, without parsing Markdown. This concrete authoring choice
is identical in both candidates and can be replaced in both together. Existing
record updates preserve omitted properties; explicit removals use the shared
update mechanism. Metadata is a separate versioned object, never a hidden body.

| Knowledge form | details fields | Semantic promise |
| --- | --- | --- |
| note | Optional object of opaque extensions; no specialized guarantees | Unclassified durable knowledge; not a truth certification |
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
stronger forms are an opt-in test of meaningful schemas, not an extra requirement
on every R4 remember operation.

### B.3 Properties schemas and conformance

There is no kind field. B uses the same common fields and details shapes as A,
but the declared Type selects the applicable shape. To make this section usable
independently, the shapes are repeated below. The base Memory conformance schema
must remain open to additional properties so specialized Types can satisfy it:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["title", "body"],
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
    "details": {"type": "object"}
  },
  "additionalProperties": true
}
```

K/memory uses this open schema directly, including for nominally unclassified
records. Extra fields and nonempty details are preserved as opaque application
data; they do not make the record a Decision or validate a choice. Its authoring
default omits details. This is a deliberate difference from A’s closed note shape:
the same base must accept the specialized records that conform to it.

The supplied specialized schemas close their complete effective property set to
the common fields plus details; they require details and the corresponding shape
below. Do not close a parent schema in a way that prevents its children from
adding fields. If a closed unclassified Note is required, B needs a separate Note
Type conforming to the open Memory base, adding a seventh Bead Type. This draft
instead keeps the unclassified base open and makes that cost explicit.

**K/observation: details schema**

```json
{
  "type": "object",
  "required": ["statement"],
  "properties": {
    "statement": {"type": "string", "pattern": "\\S"},
    "observedAt": {"type": "string", "format": "date-time"}
  },
  "additionalProperties": false
}
```

**K/decision: details schema**

```json
{
  "type": "object",
  "required": ["choice"],
  "properties": {
    "choice": {"type": "string", "pattern": "\\S"},
    "alternatives": {"type": "array", "items": {"type": "string", "pattern": "\\S"}}
  },
  "additionalProperties": false
}
```

**K/procedure: details schema**

```json
{
  "type": "object",
  "required": ["steps"],
  "properties": {"steps": {"type": "array", "minItems": 1, "items": {"type": "string", "pattern": "\\S"}}},
  "additionalProperties": false
}
```

**K/policy: details schema**

```json
{
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
```

**K/lesson: details schema**

```json
{
  "type": "object",
  "required": ["takeaway"],
  "properties": {"takeaway": {"type": "string", "pattern": "\\S"}},
  "additionalProperties": false
}
```

The full effective schema for K/decision, showing the composition without an
external schema fetch, is:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["title", "body", "details"],
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
    "details": {
      "type": "object",
      "required": ["choice"],
      "properties": {
        "choice": {"type": "string", "pattern": "\\S"},
        "alternatives": {"type": "array", "items": {"type": "string", "pattern": "\\S"}}
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

The other supplied specialized schemas use exactly that common property set,
replace only the details schema with their definition above, and require the
same title/body/details fields. This is an exact schema-generation rule, not
permission for each implementation to choose its own fields. Concrete base
K/memory uses the open base schema above, with optional object-valued details. Format
assertions and time-ordering admission rules in B.2 remain mandatory.

A custom conforming Type must meet the inherited Memory rules, including no
workflow lifecycle and wildcard ownership, but may define its own additional
properties. Exact definition binding, conformance closure and aggregate-bound
composition must be specified by the shared Type system. Until then, these are
reviewable required relationships rather than falsely deployable descriptors.

### B.4 Informational relationships

The following six meanings are distinct from the externally defined Dependency
kinds, even where the English label overlaps. No existing Dependency is retyped,
and no existing supersedes/related direction is changed by this specification.
This Memory vocabulary MUST use the identities declared in this approach.

| Meaning | Source → target | Meaning and pin rule |
| --- | --- | --- |
| related | Any Bead → any resource, with at least one observed local Memory-family endpoint | Navigation only; either endpoint may be pinned; no claim of use or support |
| guidance | Issue → Memory-family | Intended guidance for the Issue; target may float or pin; does not claim it was read |
| applies-to | Memory-family → any Bead or external resource | The Memory declares relevance/applicability to the target; target may float or pin; conditions remain explicit |
| supports | Memory-family → Memory-family | Source offers support for the target’s content; target pin required |
| challenges | Memory-family → Memory-family | Source offers a reason to reconsider the target’s content; target pin required |
| supersedes | Memory-family → Memory-family | Source is offered as replacement for the target’s content; target pin required; no automatic retirement or retargeting |

A Link’s `source` and `target` are ordinary BDP reference members, not copies in
properties. At least one endpoint MUST be an in-Scope Bead. Known local endpoint
kind/Type mismatches and self-links (same canonical endpoint identity, regardless
of pins) fail before mutation. Source pins, when supplied, retain their ordinary
exact-reference meaning; owned-state mutation remains governed by the source
identity, not permission to edit a pinned historical revision.

An in-Scope floating endpoint must be live at admission; an exact local endpoint
must name a valid retained historical state under the required Memory graph
profile. A remote endpoint is not fetched to admit the Link; its expected
Memory/Issue role is a declared expectation, not a verified kind. Reads separate
that expectation from observed availability/kind. An unavailable remote target
is not reported as known deleted. A relationship may therefore be recorded with
an unverified remote role; the service must never report local-style validation
of that role. Related requires an actual local Memory endpoint so an arbitrary
pair of external claims cannot qualify.

The pin requirement for supports/challenges/supersedes is an explicit new design
choice shared by both approaches. It prevents an assertion about one conclusion
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
defined property names are rejected. None of these Links changes Issue readiness,
executes a procedure, follows References recursively or grants access.
Any Link with a Memory endpoint, including a user-defined Link Type, MUST be
non-workflow: blocking and other Issue-workflow relationships are rejected.
This constrains Memory participation without redefining Dependency itself.

Memory owns **every outgoing Link**, including independently registered user
Link Types, through wildcard ownership. Every owned-Link creation, property/
metadata change, pin update or deletion versions the Memory source atomically;
incoming changes never version the target. This draft tests a total owned-Link
maximum of **1024** per Memory; excess fails before mutation. That candidate
bound is the same in both approaches, not an inherited universal product limit.
It must be reviewed against real authoring sizes before adoption.

Issue ownership and Dependency behavior are external contracts. Defining a new
Memory relationship does not silently edit the Issue descriptor. Admission of
a non-owned informational Link from an Issue follows the existing Issue contract;
if a particular deployment rejects such Links, that capability gap must be
reported rather than changing Issue semantics in this file. An Activity’s subject
reference to a Link is still governed by Provenance V2, not a graph endpoint here.


Each relationship Type uses the same properties schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {"note": {"type": "string", "pattern": "\\S"}, "extensions": {"type": "object"}},
  "additionalProperties": false
}
```

There is no relation-kind property. Each Type descriptor supplies its own source
and target constraints: Memory conformance where B.4 says Memory-family, Issue
where it says Issue, unrestricted target where it says any resource. No new
Issue/Dependency Type is defined here. Related’s “at least one Memory” disjunction
still needs a semantic admission check beyond independent endpoint constraints.
Required target pins, self-link rejection, exact-history admission and local/
remote distinctions likewise remain semantic checks; separate Types do not make
all rules expressible in JSON Schema or today’s descriptor.

The narrower descriptors eliminate A’s kind-dependent Issue-versus-Memory
endpoint dispatch for guidance/supports/challenges/supersedes. They do not supply
historical resolution, retention, authenticity or the semantics of prose.

### B.5 Updates, reclassification and querying

A saved Decision remains nominally a Decision. It can change choice, alternatives,
body, sources and other permitted state through explicit new revisions under
that Type. A change to choice does not automatically create another identity;
creating a separately identifiable new decision is an authoring decision. Old
pins retain old values and meaning.

An Observation cannot become a Decision under the same Bead identity under our
stable nominal affiliation direction. To make that change, create a Decision,
record the relevant Observation revision as a source when appropriate, and
optionally link the records or supersede the Observation when replacement is
actually intended. Do not automatically delete the old record, move its keys or
retarget incoming Links. If the workflow fundamentally needs one identity to
change between those roles, B does not meet it without changing the nominal
Type-affiliation rule. Calling the operation “migration” does not remove that cost.

A MemorySupport Link cannot become a MemoryChallenge Link under the same Link
identity. Create the new typed Link and remove the old one explicitly. For a
Memory source, each accepted mutation versions the source; a combined operation
requires a shared atomic facility if the consumer needs to avoid an intermediate
both/neither state. This file does not assume such an operation exists. History
must expose the real sequence if the operations are separate. Same-identity
endpoint re-pinning remains the independent shared R23 issue in B.6.

To query decisions, select K/decision (or explicitly select its conforming
extensions). To query support, select K/memory-supports. A nominal K/memory filter
alone finds unclassified Memory, not all specialized Types. The user-facing
Memory collection MUST explicitly include conforming Types using a declared
family/conformance capability. If the server cannot provide complete authorized
bounded results for that query, it cannot advertise a complete Memory collection;
client-side filtering of one nominal-Type page is insufficient.

A generic Memory renderer can render common fields but must expose additional
structured details on a full read. It cannot promise a useful complete human
rendering of an unknown specialized Type without a generic structured fallback.
A writer unable to preserve that Type’s properties fails before save. Import and
installation must include or resolve the required Type definitions without
substituting a similarly named local Type.

### B.6 Shared-operation obligations and Beads behavior

These obligations are consumed from shared BDP/Beads services; a JSON Schema or
Type declaration alone cannot implement them. Neither approach redefines Issue,
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
  incident-Link deletion refusal.** Both candidates need explicit shared-graph
  amendments; neither silently overrides those rules or claims readiness.
- Activity retention after its subject is deleted is the separate V2 rule. It
  cannot be inferred from graph-Link cascade policy. Late Activity admission for
  pruned subjects does not weaken the retained-pin checks on new graph Links.
- Keys use canonical identity resolution, never content-derived identity. The
  shared alias facility must settle Chris’s open key-placement/version/restore
  question. No Type-specific shadow key store is permitted. This remains a
  shared-contract decision, not a field quietly added by either approach.

`remember`, `recall`, `memories` and `forget` remain Beads adapters to canonical
Memory records. This draft selects no new CLI flag grammar. Unclassified creation
must remain easy and write-only; a remembered single token never becomes a read.
A supplied classification/form or specialized Type requires its structured fields
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
Neither candidate is a historical-backup or synchronization protocol.

### B.7 Properties, metadata and the R3 tradeoff

For this candidate, title/body, Inception, applicability and the specified details
are schema-defined properties. A form’s required structure is testable before
storage. Common metadata remains an open, versioned annotation object: team
labels, UI layout hints and integration identifiers may live there. Metadata
may be important and validated by an application; the BDP properties schema does
not validate it. extensions provides an explicit open property area but grants
no universal interpretation of unknown members.

The exact benefit being tested is concrete: both a CLI and an independent BDP
client can reject a Decision with no choice, a Procedure with no steps, or an
invalid applicability interval. This is more than a different display label.

The cost is equally concrete: Chris R3 deliberately leaves application fields
in metadata. Retaining that rule unchanged means moving applicability and
specialized details to an agreed metadata namespace, with application validation
or another explicit shared validation facility. Without that facility, ordinary
BDP validation would accept a record whose supposed decision/procedure data is
missing or malformed. If these stronger shapes are only optional application
Types/conventions, the minimal generic Memory remains R3-compatible; claiming
the whole extended vocabulary as mandatory Memory core would require amending R3.

Structured choice/steps also extend R7’s body-centric reading experience: a plain
body-only output can omit substantive information. Both candidates therefore need
an explicit complete human rendering of body plus structured details, or must
choose to keep substantive knowledge in Markdown and use structure only for
annotations. This is a product decision to test, not hidden by either schema.

The specialized schema shapes reject undeclared fields and have an open
extensions object; the base Memory schema remains open for conformance. Adding a newly constrained field, changing dollars to
cents, or changing what a relationship asserts is not automatically a compatible
revision. Both structural and semantic compatibility promises from Type design
still apply. This experiment does not settle publication/version tooling.

### B.8 Worked records

The same decision and same supporting relationship as A, with the same substantive
fields. The only representation change is removing discriminators and choosing
the specialized Type identities. Common record/provenance fields are omitted on
the same illustrative basis as A.

```json
{
  "type": {"uri": "https://example.org/memory-types/decision", "revision": "definition-1"},
  "properties": {
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
  "properties": {"note": "The assessment supports the delivery-time basis of this decision."},
  "metadata": {}
}
```

**Office sequence:** M1 is an Observation, M2 a Decision with exact original V2
sources, and their Link has Type MemorySupport. M3 can later be another Observation
with a MemoryChallenge Link to M2@r1. Unlike A, turning M1 itself into a Decision
requires a new identity; retaining M1 and recording a new decision preserves both
roles but leaves existing M1 references attached to M1. A new choice M4 may use a
MemorySupersedes Link to M2@r1, without reclassifying or deleting M2.

**Technician sequence:** M5 is a Procedure, guidance is a MemoryGuidance Link from
an existing Issue, and M6 is an Observation challenging M5@r2. Procedure steps
can change under the same M5 identity just as in A. If what began as an unclassified
K/memory note later needs the Procedure contract, B requires a new identity.
That matters for gradual capture in the field: classification can be deferred,
but upgrading to a specialized nominal Type is not a free same-record operation.
Activity reports and exact recorded procedure inputs are unchanged from A.

### B.9 What fails, and what B makes expensive

| Exercise | Required outcome or exposed cost |
| --- | --- |
| Generic Memory with title and empty body | Accept; no special Type or classification required |
| Decision with no choice | Reject before mutation, as in A |
| Procedure with empty steps | Reject before mutation, as in A |
| observedAt omitted | Unknown, never commit time, as in A |
| applicability from >= until | Reject, as in A |
| Generic Memory with extra properties or nonempty details | Accept as opaque data; the open base gives no specialized guarantees |
| Unknown specialized Type without definition/conformance evidence | Cannot claim validated Memory membership; preserve opaque records only under the applicable generic read contract |
| Observation → Decision, same ID | Reject; requires another identity under the stable nominal affiliation model |
| MemorySupport → MemoryChallenge, same Link ID | Reject; replacement uses another Link identity and explicit mutation sequence |
| Issue → MemorySupport | Reject through narrower endpoint constraints; no kind branch needed |
| Support target pin omitted | Reject; separate Type still needs this semantic check |
| New useful field only for Decisions | Evolve Decision’s definition; Procedure’s nominal definition need not change, but compatibility and base conformance still apply |
| Custom WarrantyMemory Type | Use ordinary Type definition and Memory conformance; it adds definition/dependency/validation obligations |
| Query nominal K/memory for all knowledge | Incomplete by construction; family query must include specialized/conforming Types |
| Existing Dependency related/supersedes | Leave untouched, as in A |
| Deleted/pruned target | Apply B.6; specialized Types do not solve the shared lifecycle gap |

B’s concrete advantages are directly selectable contracts, narrower endpoint
constraints and independently versioned supplied form/relation definitions.
Its concrete liabilities are twelve supplied definitions and their dependencies,
family discovery, unknown-Type handling, identity changes on reclassification,
and multi-operation replacement when a Link changes semantic role. Moving all
specialized fields into metadata would retain the Type identities but remove
most of their validation benefit unless another validator is supplied.

### B.10 Requirement coverage and adoption gates

| Proposal requirements | Candidate coverage and remaining dependency |
| --- | --- |
| R1–R4 | Canonical knowledge record, title/body and deliberate authoring; optional extended forms; R3 structured-field departure explicit |
| R5, R13–R16 | Shared History required; restore, erasure, retention and deletion semantics require end-to-end service support |
| R6–R10 | Family discovery, bounded summaries, exact full reads and structured Links; no automatic context assembly |
| R11–R12 | Version every durable/owned-state change; inherit V2 attribution and separate editable Inception |
| R17–R23 | Open informational vocabulary, wildcard ownership, local/remote checks; stable-ID re-pinning and surviving pinned Links require BDP amendments |
| R24–R26/R31 | One canonical model behind old commands; safe migration and explicit compatibility/output cutover remain Beads work |
| R27/R27a | Atomic connected publication and declared exposure per surface; cannot be supplied by registering Types |
| R28–R30 | Public structured records and shared authorization; outside tools judge truth, staleness and applicability |

**Ready for review:** candidate definitions, field rules, endpoint rules, examples
and failure cases in this section. **Not selected or implemented by this work:**
Type identifiers/definitions in a production catalog, exact conformance-version
matching, property-versus-metadata policy, authoring/output migration, alias
placement, profile/capability admission, lifecycle amendments and packaging.
No schema fragment in this document is a new canonical BDP wire schema. Before
adoption, encode the selected definitions, shared-operation requirements and
errors in the canonical specification and conformance suite together.

### B.11 Side-by-side experiments to decide between the drafts

This is not a recommendation to select B. Execute the same examples against the
two written contracts and decide which consequences are desirable.

| Experiment | A | B | Decision exposed |
| --- | --- | --- | --- |
| A hurried worker saves a note, later structures it as a procedure | Same identity; kind/details update | New identity for Procedure; old references remain on note | Is gradual same-record specialization required? |
| An analyst changes an observation into a decision | Same identity, preserved historical kinds | New decision cites old observation | Is this recategorization or creation of another record? |
| An evaluation changes from support to challenge | Same Link ID can change kind | New Link ID; remove old explicitly | Should semantic role be stable under Link identity? |
| A Decision-specific endpoint is required later | Property predicate/admission extension | Type/conformance constraint | Do actual consumers need this selectivity? |
| A plain note contains an unexpected field | Closed note schema rejects it | Open Memory base preserves it without interpretation | Is a seventh, closed Note Type worthwhile? |
| A consumer asks for all knowledge | One supplied nominal Type, plus custom conforming Types | Explicit family query for all supplied forms | Who implements complete family discovery? |
| A third party introduces a strict new knowledge form | Extra kind validator or custom Type | Another conforming Type | Does A merely recreate Type plumbing inside kind? |
| R3 keeps application structure exclusively in metadata | Lose core validation of those fields unless added elsewhere | Same loss despite distinct Type IDs | Are stronger application schemas worth an explicit R3 refinement? |
| A procedure acquires one extra optional field | Compatibility analysis still required | Same, within Procedure’s definition | Optional does not automatically mean compatible |
| A Link targets a deleted Memory revision | Shared BDP lifecycle amendment needed | Same amendment needed | Keep Type design separate from lifecycle claims |

No new norms are selected merely because Issue or Dependency uses a discriminator.
Conversely, no separate Type is justified here merely by calling its definition
a “common contract.” The concrete identity, query, validation and evolution
outcomes above are the material for the next decision.
