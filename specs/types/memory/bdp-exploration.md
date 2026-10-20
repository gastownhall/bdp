# Exploratory BDP mapping for Memory

Nonnormative research artifact, October 18, 2026. The [product proposal](./memory.md)
defines the project-driven vocabulary. [definitions.json](./definitions.json)
explores an encoding of eight Bead Types and the single references Link Type.
Seven declarations connect the named Bead specializations to Memory. All identities,
revision labels and namespaces are illustrative, not production allocations.

The property copies match the owned schemas: title/body plus optional open-string
status on Memory, and optional note/status on references. Body carries primary
content. The named specializations need no extra required primary fields to have
distinct meanings. The three local endpoint pairs preserve their source/target
correlation; no external endpoint or additional relationship is selected here.

This experiment uses the candidate [BDP Types profile](../../profiles/types/types.md).
It neither adopts that representation nor requires native Memory to deploy a Type
registry, public Type editing or a generalized constraint engine. Once the shared
format is accepted, derive its mapping from the accepted product contract.

Before product integration, resolve public identities and exact historical meaning,
source ownership and Type transitions, local current/exact admission, retained-state
and deletion behavior, shared provenance, installed limits and exact-source evidence.
A new example revision label does not rewrite an older retained definition.

```sh
uv run --no-project --with 'jsonschema[format]' python scripts/check_memory_examples.py --with-bdp-exploration
```

The default mode checks only product schemas and property excerpts. This optional
mode also checks candidate encoding/copies and exact fixture closure. Neither mode
qualifies endpoint admission, mutations, History, CLI or installed product behavior.
