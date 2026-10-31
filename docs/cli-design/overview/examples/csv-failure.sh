#!/usr/bin/env bash
# Assemble authored batch members; this script does not submit them.
set -euo pipefail

# Collect emitted members; a failed command stops this assembly.
(
  # Describe a fresh review note.
  bd create --id csv-review-attempt --type note \
    --properties '{"title":"Another CSV review"}' --dry-run-mode batch || exit

  # Describe an edit requiring the stale guide revision.
  bd update csv-draft --if-revision =guide-h \
    --set-metadata validation=pending --dry-run-mode batch || exit

) > csv-failure.jsonl
