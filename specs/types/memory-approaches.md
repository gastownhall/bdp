> **Historical comparison — October 13, 2026.** The forward-looking proposal is
> [Memory Types](memory.md). The A/B draft below is preserved from commit
> `1335b736f98b7602d4b020b62fd3b5486890d992` for comparison, including its hybrid
> experiment. Its immutable nominal-affiliation assumption and original Related
> restriction are historical alternatives, not requirements of the new proposal.
> Keep this body frozen; develop the recommendation in memory.md.

# Memory Types — two candidates using flat Type identities

Draft for discussion, October 13, 2026. **Neither approach is selected.** MUST,
SHOULD and MAY below describe the respective candidate, not adopted BDP law.
This file contains the Type definitions and their observable consequences in two
sections. It is the working specification for this comparison; earlier design
notes are background. A.11 tests a hybrid of the two written candidates; neither
full approach nor the hybrid has been selected.

Inputs: [Chris’s Memory proposal, revision 4](https://github.com/gastownhall/beads/issues/5877),
including R1–R31/R27a and its [relationship/applicability follow-up](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303);
[Provenance V2](https://github.com/gastownhall/beads/issues/7510);
and [BDP main checked at 627b560](https://github.com/gastownhall/bdp/blob/627b560c0daf1a76b292615718c86670255ac9af/docs/specs/bdp.md).
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

**Working premise for this experiment:** Bead Types and Link Types are flat.
There is no stipulated conformance, ancestry, inherited constraint or implicit
membership. An endpoint accepts a Bead when its nominal Type ID matches **any**
ID in that endpoint's explicit allowed list. Source and target checks must both
pass. `ANY` in the tables means any local Bead, not an empty allowed list;
an empty allowed list accepts no local Bead. These are design notations, not
new wire members or CLI syntax. Existing `conformsTo` arrays keep their current
AND meaning until an explicit protocol amendment; they must never be silently
reinterpreted as OR.

Lists in this experiment name stable Type identities across their definition
versions. Stored instance affiliations still pin exact definitions. Matching a
nominal ID does not prove compatibility between its versions. Exact-version or
major-family restrictions remain a separate decision; no SemVer or schema-based
matching is inferred. Type IDs are compared after canonical identity resolution,
not by display name, URL prefix, shared fields or a publisher's membership claim.

**Difference from current BDP:** current BDP supports declared conformance and
AND endpoint lists, not the flat/OR model tested here. Both candidates therefore
need an explicit shared Type/endpoint amendment. No new implementation is claimed.
For properties, both keep the current open-root rule: unknown top-level properties
are preserved, while declared nested detail objects can be closed. The earlier
draft's closed top-level schemas were a mistake; ordinary JSON Schema validation
alone did not establish that they were admissible BDP Type schemas.

**Simplification to test:** `related` now requires a local Memory source and
allows any target. This replaces the earlier “at least one end is Memory” rule
in both candidates. It is a reviewable proposal, not an operator ruling or a
change to existing Dependency. Independent endpoint OR lists cannot express
“either end, but at least one” or correlated source/target pairs.

**Shared Link mechanics agreed during this exercise.** Link endpoints default to
floating; callers explicitly supply exact pins or request resolve-current-and-pin.
A required pin is not silently supplied for a bare endpoint. In contrast, every
new Bead/Link affiliation pins the selected Type definition, and update omission
preserves that pin. These defaults depend on the role of a reference, not on
whether its target is represented as a Bead. CLI discussion stays in revision-flag
notation here; no suffix grammar is selected by this document.

Maximums count Links in the enforcing Scope's own table by endpoint identity,
across pinned and floating references. Other Scopes' tables are outside the count;
external endpoint identities in this table are not exempt. This extends current
BDP's local-endpoint aggregate rules and needs an explicit amendment. Remote Type
eligibility remains unverified; known Link Type/endpoint-identity counts do not
require remote Type verification. There are no mechanically enforced minimums,
and per-revision arity is deferred. A maximum may count an explicit OR set of
Link Types together. Applicable Type-defined and Scope-defined rules all apply;
the Scope can tighten but cannot relax a Type rule. Descriptor placement/encoding
of grouped maxima remains to specify.

An identity-filtered Link listing matches floating and all pinned endpoints.
An endpoint-revision filter matches only that explicit stored pin; floating-only
selection is separate and never resolved to a current revision for matching.
The analogous retained-Link-version query tests each version's own endpoint;
it is not a historical graph snapshot or a query of current endpoints followed
by unfiltered history expansion. Wire/query/CLI availability remains a gate.

BDP's Transactional batch is ordered and atomic, checking each staged operation.
For maximum-only constraints, delete the old Link before creating its replacement:
the interim zero is valid, failure rolls back both, and no intermediate gap is
published. Final-state-only validation or a special replacement operation is not
required for that case. [Current upstream bd batch](https://github.com/gastownhall/beads/blob/d4ca89369f72e4666fe76493e4cab700a7e73320/cmd/bd/batch.go)
is atomic for its narrow Issue/Dependency command grammar; generic Link command
coverage is a separate implementation requirement, not claimed by this draft.

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

Independently registered user Bead/Link Types remain possible. A custom Bead Type
is a different nominal identity: installation alone does not include it in Memory
queries or add it to restrictive endpoint lists. ANY targets already accept it. A publisher can introduce a URI kind on
K/memory to retain that nominal membership, with the weaker validation described
above. User-defined informational Link Types remain first-class and count under
Memory's wildcard ownership; they need not be kinds of this relationship Type.
This preserves R17's open Type vocabulary without inventing implicit membership.

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
### A.4 Informational relationships

The following six meanings are distinct from the externally defined Dependency
kinds, even where the English label overlaps. No existing Dependency is retyped,
and no existing supersedes/related direction is changed by this specification.
This Memory vocabulary MUST use the identities declared in this approach.

| Meaning | Source → target | Meaning and pin rule |
| --- | --- | --- |
| related | Local K/memory → any Bead or external resource | Navigation only; either endpoint may be pinned; no claim of use or support |
| guidance | Issue → K/memory | Intended guidance for the Issue; target may float or pin; does not claim it was read |
| applies-to | K/memory → any Bead or external resource | The Memory declares relevance/applicability to the target; target may float or pin; conditions remain explicit |
| supports | K/memory → K/memory | Source offers support for the target’s content; target pin required |
| challenges | K/memory → K/memory | Source offers a reason to reconsider the target’s content; target pin required |
| supersedes | K/memory → K/memory | Source is offered as replacement for the target’s content; target pin required; no automatic retirement or retargeting |

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
of that role. Related requires a local source whose nominal Type is listed;
its source rejects external references. Other rows admit bead-shaped external
references where a Bead role is required, and any external URI for unrestricted
targets. These policies constrain reference shape, not remotely verified Type.
At least one endpoint must still be local for every row.

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
  "additionalProperties": true
}
```

A known relationship kind MUST pass the corresponding endpoint row above.
For an extension kind, apply only the related row’s structural endpoint bounds
(local K/memory source, unrestricted target, no self-link), without
asserting related semantics. No unknown kind may acquire workflow effects.

The exact per-kind allowed nominal IDs are below. `Issue` abbreviates the
externally defined Issue Type ID; `Memory` means K/memory only.

| Relationship kind | Allowed source Types (OR) | Allowed target Types (OR) |
| --- | --- | --- |
| related | [Memory] | ANY |
| guidance | [Issue] | [Memory] |
| applies-to | [Memory] | ANY |
| supports | [Memory] | [Memory] |
| challenges | [Memory] | [Memory] |
| supersedes | [Memory] | [Memory] |

All six kinds share K/memory-relationship. Its single Type-level envelope is
source [Issue, Memory], target ANY. Even the proposed OR capability cannot make
that envelope enforce the per-kind rows: a properties schema can check kind but
cannot inspect endpoint Beads. Issue → Issue with kind=supports passes the envelope
and MUST fail the intended rule. External-source policy likewise varies by kind.
This candidate requires an additional kind-aware validation mechanism, or splitting
the Link Type. Neither is quietly supplied by flat Types plus OR. A server lacking
that mechanism cannot advertise full validation of these relationship kinds.

No existing descriptor field is renamed or reinterpreted by this table. The OR
envelope itself also requires the shared amendment described in the preamble.

### A.5 Updates, reclassification and querying

A Memory can change from observation to decision under the **same identity**.
The write must explicitly select decision and supply a valid replacement details
object; incompatible old details are not silently retained or discarded. The
combined mutation succeeds atomically or not at all. Old exact revisions still
have their old kind/details. This records a change of classification, not an
inference that the old observation was always a decision.

This edition’s Links accept the nominal K/memory identity, not individual Memory
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

To query decisions: select K/memory and properties.kind=decision. To query
support Links: select K/memory-relationship and properties.kind=supports, plus any
independently registered Link Types whose own contracts the consumer selects.
Never treat all instances of the relationship Type as support. Indexes may help,
but do not change authorization or bounded-result completeness. A properties-only
filter without the nominal Type qualification may match unrelated JSON records.

A generic Memory query selects K/memory and includes all its kinds, including URI
extension kinds. A separately named custom Type is excluded even if it has the
same properties. Including it requires changing the query's explicit ID list.
Endpoints restricted to K/memory still exclude it until their lists are revised;
ANY targets already allow it.
Installing a Type changes neither list. A kind filter requires a supported
property selector; a client must not filter one page and claim complete results.
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

The top-level schemas remain open, and the defined nested details shapes reject
undeclared members. The extensions object is an optional application convention,
not the only legal home for additional properties. Adding a newly constrained
field, changing dollars to
cents, or changing what a relationship asserts is not automatically a compatible
revision. Both structural and semantic compatibility promises from Type design
still apply. This experiment does not settle publication/version tooling.

### A.8 Worked records

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
| One publisher wants strict warranty-record kind validation | Requires an extension validator or a separate flat Type plus explicit query/Link list changes |
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
| R6–R10 | Explicit Type-list discovery, bounded summaries, exact full reads and structured Links; no automatic context assembly |
| R11–R12 | Version every durable/owned-state change; Use V2 attribution and separate editable Inception |
| R17–R23 | Open informational vocabulary, wildcard ownership, local/remote checks; stable-ID re-pinning and surviving pinned Links require BDP amendments |
| R24–R26/R31 | One canonical model behind old commands; safe migration and explicit compatibility/output cutover remain Beads work |
| R27/R27a | Atomic connected publication and declared exposure per surface; cannot be supplied by registering Types |
| R28–R30 | Public structured records and shared authorization; outside tools judge truth, staleness and applicability |

**Ready for review:** candidate definitions, field rules, endpoint rules, examples
and failure cases in this section. **Not selected or implemented by this work:**
Type identifiers/definitions in a production catalog, flat Type/OR amendments,
version-sensitive matching, property-versus-metadata policy, authoring/output
migration, alias
placement, profile/capability admission, lifecycle amendments and packaging.
No schema fragment in this document is a new canonical BDP wire schema. Before
adoption, encode the selected definitions, shared-operation requirements and
errors in the canonical specification and conformance suite together.

### A.11 Hybrid experiment — one Memory Bead Type, separate Link Types

This is the operator-requested test of combining A's Bead design with B's distinct
Link identities. It is a candidate, not a selected replacement for either complete
approach. The test asks whether the actual Memory requirements need endpoint
constraints on knowledge forms, or only meaningful relationships among memories.
Chris's revision-4 issue body and October 3 relationship/applicability comment
were reread for this exercise; the issue body was unchanged from the earlier scan.

**Concrete catalog.** Use A's K/memory Bead Type, kind/details validation and
same-identity reclassification. Use the six Link IDs from B.1, each with its own
meaning and explicitly stated endpoint rules. No Link has a relation-kind
property. Issue, Dependency and Activity remain externally defined Types. Every
Memory owns all outgoing Links under its explicit wildcard declaration; this
comes from Memory's definition, not from the Link catalog.

| Link Type | Allowed source Types | Allowed target Types | Additional proposed rule |
| --- | --- | --- | --- |
| MemoryRelated | ANY | ANY | Informational navigation; at least one local endpoint under ordinary BDP |
| MemoryGuidance | [Issue] | [Memory] | Intended guidance, not proof of use |
| MemoryAppliesTo | [Memory] | ANY | Claimed applicability, not an authorization grant |
| MemorySupports | [Memory] | [Memory] | Exact target pin required |
| MemoryChallenges | [Memory] | [Memory] | Exact target pin required |
| MemorySupersedes | [Memory] | [Memory] | Exact target pin required; no automatic winner or retirement |

All entries are flat nominal-ID selections, with OR for multi-ID lists. Memory
here means only K/memory. A Decision or Procedure is a kind of that same Type,
so these endpoint rules require no kind-aware validator. Related uses opaque
external-endpoint policy at both ends; other rows use bead-shaped external
references for specified Bead roles and opaque external targets for ANY. Local
Type mismatches fail; remote Type claims remain unverified. Pin requirements,
historical admission, self-link rules and workflow exclusion still require the
shared support identified elsewhere; endpoint Type lists alone are insufficient.

**A defect found by the test:** A.4/B.4's proposed local-Memory-source restriction
on Related does not cover R17's baseline Issue→Memory navigation. Guidance can
express intended guidance, but using it for every navigation link would change
the assertion. The hybrid table tests a broader Related with unrestricted ends;
it deliberately permits Issue→Issue navigation as well. It removes the
at-least-one-Memory restriction instead of hiding a cross-endpoint predicate.
This is a candidate repair, not a change to the existing Dependency related kind.
If Related must remain Memory-specific in either orientation, that is still a
constraint-language gap. The two original approach tables remain visible so the
failed assumption and this proposed repair can be reviewed.

**Tests against the requirements and worked scenarios**

| Case | Concrete representation / result | Need a separate knowledge-form Type? |
| --- | --- | --- |
| Capture an unclassified note, then structure it as a procedure (R4; technician scenario) | One Memory identity; explicit kind/details update; earlier pins retain the note state | No; separate Type would impose the identity change being avoided |
| Issue points to a policy or procedure for guidance (S5, S9) | MemoryGuidance Issue→Memory; target may float or pin; no readiness effect | No; both are valid guidance targets |
| Memory cites an Issue as supporting background (S10) | MemoryRelated Memory→Issue with an explicit pin where intended; V2 sources record original inputs separately | No; do not stretch MemorySupports to cover an endpoint its definition excludes |
| Issue links to a Memory for navigation only (R17) | Broadened hybrid MemoryRelated accepts Issue→Memory; the earlier source-only draft fails this case | No; failure concerns Related's direction, not the bead's kind |
| Assessment supports a supplier decision; later evidence challenges it (office scenario; October 3 follow-up) | MemorySupports/MemoryChallenges between Memories, targeting exact decision revisions | No; the relationship carries the assertion; kind aids search/display |
| Observation challenges a procedure for a newer pump housing (technician scenario) | MemoryChallenges targets the old procedure pin; the author may revise the procedure with new V2 sources | No; restricting Challenges to Decision targets would break this scenario |
| A new policy supersedes an old one; a new decision supersedes an earlier choice | MemorySupersedes between Memories; target pinned; no implied automatic retirement | No; the same replacement relation is useful for more than one form |
| Search only decisions; show incoming support or challenges | Nominal Memory plus kind filter for beads; explicit OR of the two Link Type IDs for relationships | No; query predicates and endpoint validity are separate |
| Add an independent application-specific knowledge Type | Excluded from Memory queries and restricted endpoint lists; ANY endpoints already accept it | Flat membership still requires deliberate integration, as in B |
| Preserve history, delete/restore, or report activity (R5, R11–R16, R20; V2) | Same shared History/graph/Activity obligations as A/B; no extra mechanism supplied by the hybrid | No form-specific Type solves these shared dependencies |

These are requirements walkthroughs, not executed product acceptance tests. They
do not prove complete R1–R31 implementation. The R3 departure for schema-defined
kind/details/applicability and R7 structured-rendering choice remain open.

**Try to break the hybrid.** Suppose an application needs a Link whose target
MUST be a procedure and MUST never be a decision, even when an independent client
writes it. The endpoint list [Memory] cannot enforce that distinction. The
application must choose a separate nominal Procedure Type or obtain an explicit
property-sensitive constraint mechanism. We are not adding that mechanism here.
None of the examined Memory requirements demands this strict distinction;
procedure-only authoring prompts or a kind-filtered search do not establish a
server-side invariant. If a real requirement does, revisit the bead-Type choice.

Changing a Memory's kind leaves existing identity-based relationships in place.
For floating Guidance, this intentionally allows the target to become another
form of useful guidance; readers see its current kind. A consumer requiring the
old content uses a pin. The server cannot promise that a rewritten record still
makes the advice useful. Distinct nominal Types would not prevent an author from
changing content incompatibly with a particular use inside the same Type either.

**Experiment result:** one Memory Type covers the examined knowledge forms without
requiring identity replacement during gradual authoring; distinct Link Types
express their different endpoint rules without A's kind-dependent dispatch.
This supports continuing with the hybrid as the leading candidate. It does not
select the catalog, the Related repair, stricter form predicates or implementation.

**Aside: generic Bead and Link Types for experimentation.** The operator proposed
a generic Type for each Resource category with kind as its only defined property,
possibly intrinsic. The idea fits the flat model: generic records use a stable
shared Type definition, while users experiment with kind values without publishing
a Type for each label. These are not untyped records; generic Type affiliations
would still pin definitions, and normal Resource identity/history rules apply.
Intrinsic/bootstrap status, names, kind grammar and packaging remain unselected.

A generic kind is an application label, not another nominal Type identity. A
GenericLink(kind=supports) does not satisfy a constraint selecting MemorySupports;
accepting GenericLink in a list admits every kind under that identity. Likewise,
a per-identity maximum over GenericLink counts all its kinds together unless a
separate predicate mechanism exists. A GenericBead(kind=memory) does not acquire
Memory's fields, recall behavior or wildcard ownership automatically. Because the
current top-level properties rule is open, “only kind” can mean only one defined
property; forbidding every other top-level property would need a separate change.

Promotion exposes the stable-affiliation decision: GenericBead→Memory, or
GenericLink→MemorySupports, requires another identity under the current rule.
Old references do not retarget, and old pins do not change. If preserving identity
through promotion is important, it must reopen that rule explicitly; the generic
escape hatch does not solve it. GenericLink also does not replace Related: one
has unspecified application kind semantics, the other a defined navigation meaning.

## Approach B — separately identified Bead and Link Types

### B.1 Catalog and identification

| Type identity | Resource category | Meaning |
| --- | --- | --- |
| K/memory | Bead | Unclassified note; one concrete Type, not a base Type |
| K/observation | Bead | Observation |
| K/decision | Bead | Decision |
| K/procedure | Bead | Procedure |
| K/policy | Bead | Policy |
| K/lesson | Bead | Lesson |
| K/memory-related | Link | related meaning from B.4 |
| K/memory-guidance | Link | guidance meaning from B.4 |
| K/memory-applies-to | Link | applies-to meaning from B.4 |
| K/memory-supports | Link | supports meaning from B.4 |
| K/memory-challenges | Link | challenges meaning from B.4 |
| K/memory-supersedes | Link | supersedes meaning from B.4 |

These are twelve independent Type identities with no parents. Calling the first
six “Memory Types” is shorthand in this document for that explicit list. It is
not a runtime Type, membership registry, prefix rule or conformance declaration.
In particular, a Decision is never nominally K/memory.

No properties.kind or metadata kind duplicates the declared Type. Unclassified
creation selects K/memory; specialized authoring explicitly selects its Type.
Prose, Issue kind and linked records never infer the selection. Every supplied
Type has its own exact definition revision and its own specified fields and
ownership rule. A common schema fragment may be reused as a fixed authoring
artifact, but that creates no Type relationship or inherited membership.

A third party may install K/inspection-finding or another globally identified
Type. It participates in none of these lists automatically. Query owners decide
whether to add it to their queries; Link-definition publishers decide whether to
add it to endpoint lists. Those are independent changes. Shared fields, a familiar
name and a publisher's “this is a Memory” claim do not authorize either change.
User-defined informational Link Types still count under each supplied Bead Type's
wildcard ownership, because wildcard ownership deliberately covers all Link IDs.

### B.2 Bead fields and validation

Each of the six supplied Bead definitions independently includes the fields and
behavior specified here, including the ownership and lifecycle requirements below.

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
| note | Empty object when supplied | Unclassified durable knowledge; not a truth certification |
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

### B.3 Independent properties schemas

There is no kind field. Each nominal Type specifies its complete properties
schema independently. The repeated fields and rules below are deliberate reuse
in the written specification, not inheritance. The first schema is for the
concrete, unclassified K/memory Type only:

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
    "details": {"type": "object", "additionalProperties": false}
  },
  "additionalProperties": true
}
```

Every full properties schema keeps its top-level object open, following the
current BDP rule. Unknown top-level fields are preserved as opaque application
data. K/memory may omit details or carry an empty details object; the nested object
is closed. Specialized Types require their independently defined details below.
There is no base-Type composition problem and no need for a seventh Note Type.
This experiment leaves the general open-root policy unchanged.

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
  "additionalProperties": true
}
```

The other supplied specialized schemas use exactly that common property set,
replace only the details schema with their definition above, and require the
same title/body/details fields. This is an exact schema-generation rule, not
permission for each implementation to choose its own fields. K/memory uses its
own schema above, with optional empty-object details. Format assertions and
time-ordering admission rules in B.2 remain mandatory.

A custom Type has its own definition. It does not inherit these fields, wildcard
ownership or no-workflow rules by resembling a supplied Type. Before adding it
to a query or Link list, that consumer's author must decide whether its documented
behavior is suitable. No implicit Type-system assertion substitutes for that review.

### B.4 Informational relationships

The following six meanings are distinct from the externally defined Dependency
kinds, even where the English label overlaps. No existing Dependency is retyped,
and no existing supersedes/related direction is changed by this specification.
This Memory vocabulary MUST use the identities declared in this approach.

| Meaning | Source → target | Meaning and pin rule |
| --- | --- | --- |
| related | Local listed Memory Type → any Bead or external resource | Navigation only; either endpoint may be pinned; no claim of use or support |
| guidance | Issue → a listed Memory Type | Intended guidance for the Issue; target may float or pin; does not claim it was read |
| applies-to | a listed Memory Type → any Bead or external resource | The Memory declares relevance/applicability to the target; target may float or pin; conditions remain explicit |
| supports | a listed Memory Type → a listed Memory Type | Source offers support for the target’s content; target pin required |
| challenges | a listed Memory Type → a listed Memory Type | Source offers a reason to reconsider the target’s content; target pin required |
| supersedes | a listed Memory Type → a listed Memory Type | Source is offered as replacement for the target’s content; target pin required; no automatic retirement or retargeting |

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
of that role. Related requires a local source whose nominal Type is listed;
its source rejects external references. Other rows admit bead-shaped external
references where a Bead role is required, and any external URI for unrestricted
targets. These policies constrain reference shape, not remotely verified Type.
At least one endpoint must still be local for every row.

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
  "additionalProperties": true
}
```

There is no relation-kind property. Each Link Type supplies its own complete
endpoint lists. Here the short names stand for the six exact nominal IDs in B.1;
Issue remains its separately defined Type ID. The lists are intentionally repeated
so their maintenance cost is visible. No `Memory` group is resolved at runtime.

| Link Type | Allowed source Types (OR) | Allowed target Types (OR) |
| --- | --- | --- |
| MemoryRelated | [Memory, Observation, Decision, Procedure, Policy, Lesson] | ANY |
| MemoryGuidance | [Issue] | [Memory, Observation, Decision, Procedure, Policy, Lesson] |
| MemoryAppliesTo | [Memory, Observation, Decision, Procedure, Policy, Lesson] | ANY |
| MemorySupports | [Memory, Observation, Decision, Procedure, Policy, Lesson] | [Memory, Observation, Decision, Procedure, Policy, Lesson] |
| MemoryChallenges | [Memory, Observation, Decision, Procedure, Policy, Lesson] | [Memory, Observation, Decision, Procedure, Policy, Lesson] |
| MemorySupersedes | [Memory, Observation, Decision, Procedure, Policy, Lesson] | [Memory, Observation, Decision, Procedure, Policy, Lesson] |

For a local endpoint, validation compares its nominal Type ID to its allowed
list. Thus Observation → Decision support succeeds; Issue → Decision support
fails. Requiring nominal Memory alone would reject Observation and Decision.
Identical properties do not affect either result. No ancestor lookup is needed.
For pinned endpoints, this candidate uses the referenced retained state; that is
part of the shared historical-validation amendment, not provided by Type lists.

Related's source-only rule makes its Type eligibility expressible using independent
endpoint constraints. Its external-source policy is none; the other external
policies are stated above. Allowing either orientation with at least one Memory
would require a different rule. Likewise source [Observation, Procedure] and
target [Decision, Issue] admit all four combinations; they cannot mean only
Observation → Decision and Procedure → Issue.

Explicit OR lists eliminate A's kind-dependent endpoint dispatch for the six
supplied meanings, once the flat/OR amendment exists. Required target pins,
self-link rejection, exact-history checks and non-workflow participation remain
separate requirements. Neither the current descriptor nor merely adding OR makes
all these rules enforceable. Runtime support must be specified and qualified.

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
Memory source, each accepted mutation versions the source. An ordered atomic
batch can delete the old Link and create the new one without exposing an
intermediate gap; maximum-only rules admit the intermediate zero. BDP supplies
that transaction model; generic CLI command coverage remains to implement.
Separate committed operations expose their real sequence. Same-identity
endpoint re-pinning remains the independent shared R23 issue in B.6.

To query decisions, select exactly K/decision. To query support Links, select
exactly K/memory-supports. To query the six supplied knowledge forms, explicitly
select this OR list:

```text
K/memory OR K/observation OR K/decision OR K/procedure OR K/policy OR K/lesson
```

A nominal K/memory query returns only unclassified notes. The query owner stores
and versions its chosen list as application/query configuration; it is not a new
BDP Type or globally extensible group. Existing lists do not change when another
Type is installed. A caller can ask for a different explicit list.

An implementation can use indexed Type-ID set matching. It needs no per-bead
ancestor traversal or Type-closure table. Complete paging still requires one
well-defined result order and continuation over the whole selected set. Current
single-Type URL filtering must not be silently interpreted as a multi-Type API.
A supported general selector or an explicit query-surface amendment must carry
OR selection. Multiple independent first pages concatenated client-side are not
a complete ordered page; a client merge needs all streams and valid continuation.
No latency or throughput claim is made without implementation measurements.

A renderer knows the six supplied forms by explicit Type-ID dispatch and displays
their body and structured details. An unfamiliar Type uses a generic structured
fallback or an explicitly installed renderer; it is not silently treated as Memory.
Writers preserve unknown properties or refuse an unsafe edit. Import retains exact
identities and definitions; it never substitutes a similar local Type.

**Extension exercise: InspectionFinding.** Initially, a newly installed independent
Type is excluded from the six-Type query and the explicit six-ID endpoint lists.
It is already allowed as a Related or AppliesTo target because those use ANY. Adding
it to the query exposes it there but still does not permit it in Supports. To
permit that Link, publish a revised Supports definition with the ID added to the
chosen endpoint list, install it, and explicitly use that definition for a new
Link or explicitly adopt it on an existing Link. Omitted affiliation on update
preserves an existing Link's old definition and its old lists. Installing the new
definition alone changes neither old Links nor existing query configuration.

Adding the ID to every occurrence in this catalog changes six Link definitions
and the all-knowledge query: Related source, Guidance target, AppliesTo source,
and both ends of Supports, Challenges and Supersedes. That is **nine endpoint
list occurrences across six definitions**. Each publisher can instead choose a
smaller integration. There is no automatic synchronization among these choices.
Broadening endpoint eligibility is not automatically a same-major compatible
change: old consumers may rely on the old allowed set. Publication must follow
the separately agreed structural and semantic compatibility policy.

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

Every full schema keeps its top-level properties open. The specified nested
details shapes reject unknown members, and extensions is an optional convention.
Adding a newly constrained field, changing dollars to
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
| Generic Memory with extra top-level properties | Accept and preserve as opaque data, as in A |
| Generic Memory with nonempty details | Reject; the nested note details shape is empty, as in A |
| New InspectionFinding installed with identical Observation properties | Exclude from six-ID query/endpoint lists; allow at ANY targets; shape establishes no membership |
| Observation → Decision, same ID | Reject; requires another identity under the stable nominal affiliation model |
| MemorySupport → MemoryChallenge, same Link ID | Reject; replacement uses another Link identity and explicit mutation sequence |
| Issue → MemorySupport | Reject through narrower endpoint constraints; no kind branch needed |
| Support target pin omitted | Reject; separate Type still needs this semantic check |
| New useful field only for Decisions | Evolve Decision’s definition; Procedure’s nominal definition need not change, but structural/semantic compatibility still applies |
| Custom WarrantyMemory Type | Define independently; query owners and Link publishers explicitly choose whether to add its ID |
| Query nominal K/memory for all knowledge | Returns only notes; use the explicit six-ID OR list |
| Query list updated, Supports list unchanged | Finding becomes discoverable but remains an invalid Supports endpoint |
| New Supports definition installed, existing Link untouched | Old Link retains its pinned definition and old endpoint lists |
| Related from Issue to Decision | Reject source; use a Related from Decision to Issue or Guidance when that meaning is intended |
| Empty allowed endpoint list | Accept no local Bead; ANY must be explicit |
| Existing Dependency related/supersedes | Leave untouched, as in A |
| Deleted/pruned target | Apply B.6; specialized Types do not solve the shared lifecycle gap |

B’s concrete advantages are directly selectable contracts, narrower endpoint
constraints and independently versioned supplied form/relation definitions.
Its concrete liabilities are twelve supplied definitions, repeated query/endpoint
lists, deliberate extension integration, unknown-Type handling, identity changes
on reclassification,
and multi-operation replacement when a Link changes semantic role. Moving all
specialized fields into metadata would retain the Type identities but remove
most of their validation benefit unless another validator is supplied.

### B.10 Requirement coverage and adoption gates

| Proposal requirements | Candidate coverage and remaining dependency |
| --- | --- |
| R1–R4 | Canonical knowledge record, title/body and deliberate authoring; optional extended forms; R3 structured-field departure explicit |
| R5, R13–R16 | Shared History required; restore, erasure, retention and deletion semantics require end-to-end service support |
| R6–R10 | Explicit Type-list discovery, bounded summaries, exact full reads and structured Links; no automatic context assembly |
| R11–R12 | Version every durable/owned-state change; Use V2 attribution and separate editable Inception |
| R17–R23 | Open informational vocabulary, wildcard ownership, local/remote checks; stable-ID re-pinning and surviving pinned Links require BDP amendments |
| R24–R26/R31 | One canonical model behind old commands; safe migration and explicit compatibility/output cutover remain Beads work |
| R27/R27a | Atomic connected publication and declared exposure per surface; cannot be supplied by registering Types |
| R28–R30 | Public structured records and shared authorization; outside tools judge truth, staleness and applicability |

**Ready for review:** candidate definitions, field rules, endpoint rules, examples
and failure cases in this section. **Not selected or implemented by this work:**
Type identifiers/definitions in a production catalog, flat Type/OR amendments,
version-sensitive matching, property-versus-metadata policy, authoring/output
migration, alias
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
| A Decision-specific endpoint is required later | Property predicate/admission extension | A one-ID endpoint list | Do actual consumers need this selectivity? |
| A plain note contains an unexpected top-level field | Preserve without defined meaning | Same | Both retain the current open-root rule |
| A consumer asks for all six supplied forms | One nominal Type query | Explicit six-ID OR query | Is list maintenance acceptable? |
| A third party introduces a strict new knowledge form | Extra kind validator or independent Type with list changes | Independent Type with list changes | Who opts into the new form? |
| Every supplied relationship should accept InspectionFinding | Separate-Type integration needs explicit changes; a URI kind on Memory qualifies nominally but has weaker validation | Nine list occurrences in six Link definitions, plus query configuration | Is explicit integration worth the stable boundary? |
| Related should work in either direction with one Memory end | Extra cross-endpoint validation | Same | Keep the proposed local-Memory-source simplification or add a richer rule? |
| R3 keeps application structure exclusively in metadata | Lose core validation of those fields unless added elsewhere | Same loss despite distinct Type IDs | Are stronger application schemas worth an explicit R3 refinement? |
| A procedure acquires one extra optional field | Compatibility analysis still required | Same, within Procedure’s definition | Optional does not automatically mean compatible |
| A Link targets a deleted Memory revision | Shared BDP lifecycle amendment needed | Same amendment needed | Keep Type design separate from lifecycle claims |

No new norms are selected merely because Issue or Dependency uses a discriminator.
Conversely, no separate Type is justified here merely by calling its definition
a “common contract.” The concrete identity, query, validation and evolution
outcomes above are the material for the next decision.
