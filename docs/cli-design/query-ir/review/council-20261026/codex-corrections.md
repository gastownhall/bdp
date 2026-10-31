# Native Codex correction confirmation

Confirmed both final-review fixes by read-only source/shape inspection of the live author files. No source was edited, and this pass did not run the schema validator, evaluator, HTTP service, CLI or provider.

- **Problem closure fixed:** `$defs.problem` no longer adds outer `additionalProperties:false`, preserving the inherited extension policy. Its conditional required/forbidden `missing` and `archivedAt` rules remain. Added cases cover accepted revision-unretained with missing, rejected revision-unretained without missing, accepted resource-pruned with archivedAt, and rejected ordinary resource-not-found with History missing payload.
- **Literal traversal fixed:** the capability node walker now returns at an AST literal before descending into its value. Added positive List-only cases carry op-shaped walk and typeIs objects as ordinary comparison data with traversal/family/pin features declined.

The binding corpus now contains 54 cases by direct count. Both concrete blockers from codex-final.md are addressed; no broader review was performed in this confirmation.
