# Packaged schema artifact

`bdp-v0.schema.json` is the distribution copy of the sole authoritative
[BDP v0 schema](../../../specs/profiles/core/bdp-v0.schema.json). It is not an
independent specification. `src/schema-bundle.test.ts` requires byte equality.
Keep the stable schema `$id` unchanged when relocating repository files.
