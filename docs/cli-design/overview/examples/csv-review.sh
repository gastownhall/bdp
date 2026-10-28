#!/usr/bin/env bash
# Assemble authored batch members; this script does not submit them.
set -euo pipefail

# Collect emitted members; a failed command stops this assembly.
(
  # Bind the check identity allocated when the batch executes.
  bd create --batch-bind checks --type note \
    --properties '{"title":"CSV acceptance checks","body":"Check headings for empty and non-empty selections.","status":"draft"}' \
    --dry-run-mode batch || exit

  # Describe the connection to that generated identity.
  bd link create csv-draft batch-ref::checks --batch-bind connection \
    --type explains --properties '{"title":"Acceptance checks"}' \
    --dry-run-mode batch || exit

  # Capture draft notes including the earlier staged creation.
  bd list --batch-bind draft-notes --type note --property 'status = "draft"' \
    --dry-run-mode batch || exit

  # Describe updating the fixed captured identities.
  bd update batch-ref::draft-notes --set-property status=ready \
    --dry-run-mode batch || exit

  # Describe the guide edit guarded by its approved revision.
  bd update csv-draft --if-revision =guide-i --set-metadata validation=pending \
    --dry-run-mode batch || exit

) > csv-review.jsonl
