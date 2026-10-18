# Exploratory BDP mapping for Memory

Nonnormative research artifact, October 17, 2026. The
[Memory Release proposal](./memory.md) defines product behavior. This document and
[definitions.json](./definitions.json) explore one possible BDP encoding. They are
not a required representation, installable product catalog or release prerequisite.
The accepted product contract should supply the source for a later BDP mapping.

## What is retained

The graph contains seven illustrative Bead-Type definitions and six Link-Type
definitions, with six specialization-to-Memory and five specialization-to-Association
declarations. Namespaces
and revision tokens are examples. Property schemas mirror the product authoring
artifacts; repeated copies must stay identical. The `$id` inside a JSON Schema is
a technical schema identifier, not a field on a Memory Bead.

This experiment uses the candidate
[BDP Types profile](../../profiles/types/types.md) for definition representation,
conformance, ownership and correlated endpoint constraints. Those mechanisms have
their own adoption and wire-compatibility questions. Publishing these examples does
not amend current Core or require native Go Memory to implement Type-definition Beads,
registries, installation, public Type editing or a general conformance engine.

The product now uses body for the primary content of every Memory Type. Its child
schemas need not add different required fields. Memory declares optional open-string
status for all seven Bead Types; applicability context stays in application metadata.
The exploratory graph's property copies reflect this choice; semantic Type meaning does not follow from structural
schema differences. Association is directly authorable and is the common Link Type;
the five other Link Types declare conformance to it and inherit optional note and status.
Family selection includes conforming Types; exact Association selection remains
distinct. This does not add a seventh Link Type or qualify a runtime query engine.

## Broader endpoint experiment

The retained descriptors also explore external endpoint arms that are outside the
selected local Memory Release slice. The corresponding four earlier Link excerpts
are in [bdp-exploration.json](../../../fixtures/specs/memory/bdp-exploration.json).
They are not default product examples. An expected external role is an assertion,
not proof of membership, existence, availability or immutability. No remote fetch
or remote owner mutation is implied.

Each allowed arm remains a pair: matching a source from one arm and a target from
another does not make a valid pair. Pinned local endpoint constraints in this
experiment depend on illustrative exact contracts. The release proposal instead
states the concrete Issue/Memory role and citation outcomes directly.

## Work for the eventual mapping

Once BDP's definition format and operation contracts are accepted, reconcile:

- Public identities and historical Type meaning; whole-affiliation updates and
  preservation of old record meanings.
- Ownership declarations and source-version effects, including retyping transitions.
- Local current/exact admission and any separately selected external-reference support.
- Current Core's ownership bounds/view closure and the candidate profile's syntax.
- Stable Link-ID re-pinning, floating-Link deletion and pinned survivors.
- The accepted shared provenance and single-field Inception/revert decisions.

These are mapping obligations and broader protocol work, not reasons to expand the
product proposal into a generic Type specification. User-defined constraints such
as positive participation minima need their own lifecycle decisions before adoption;
the supplied Memory relationships add no such minima, pair uniqueness or acyclicity.

## Optional artifact check

The default checker reads only Memory Release schemas, cases and property examples.
The optional mode additionally checks this encoding's shared schemas, exact fixture
closure and repeated property copies:

```sh
uv run --no-project --with 'jsonschema[format]' python scripts/check_memory_examples.py --with-bdp-exploration
```

Neither mode qualifies mutation, endpoint resolution, CLI, History, provenance,
public schema adoption or installed product support. Historical council evidence
retains its original source identity; it does not automatically review this mapping.
