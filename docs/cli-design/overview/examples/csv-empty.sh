#!/usr/bin/env bash
# Assemble authored batch members; this script does not submit them.
set -euo pipefail

# Collect emitted members; a failed command stops this assembly.
(
  # Capture the now-empty set of draft notes.
  bd list --batch-bind draft-notes --type note --property 'status = "draft"' \
    --dry-run-mode batch || exit

  # Describe the no-op update of that captured set.
  bd update batch-ref::draft-notes --set-property status=ready --dry-run-mode batch || exit

) > csv-empty.jsonl
