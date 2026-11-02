# Experimental instance authoring

[Markdown authoring bundles for Beads and Links](markdown-bead-bundles.md) preserves the Memory experiment’s nascent v0.1 DSL. It proposes YAML frontmatter for a root Bead, tables for owned outgoing Links, and sections for independently identified child Beads. It also explores publication into GitHub Issues and repository files. Those are authoring ideas, not selected BDP wire or import/export behavior.

Identity-to-file binding, exact revision pins, Link editing/reparenting/deletion, child identity creation and Issue-body encoding remain unresolved. The draft’s implicit property/metadata classification and its working Type vocabulary also need review against current BDP. A table row or Markdown heading does not create a stored Bead or Link, and this import implements no converter.

The [experimental-area boundary](../README.md) applies. [Format provenance and version accounting](../../specs/formats/README.md) records the original source and historical evidence; later edits must not inherit those earlier qualification claims.
