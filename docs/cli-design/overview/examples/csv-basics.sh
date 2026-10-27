#!/usr/bin/env bash
# Assemble authored batch members; this script does not submit them.
set -euo pipefail

# Collect emitted members; a failed command stops this assembly.
(
  # Describe the column-headings note with an explicit ID.
  bd create --id csv-headings --type note \
    --properties '{"title":"CSV column headings","status":"ready"}' \
    --dry-run-mode batch || exit

  # Describe the empty-export note with another explicit ID.
  bd create --id csv-empty-output --type note \
    --properties '{"title":"CSV empty selection","status":"ready"}' \
    --dry-run-mode batch || exit

  # Describe their connection using the ordinary IDs.
  bd link create csv-headings csv-empty-output --id csv-acceptance-order \
    --type explains --dry-run-mode batch || exit

) > csv-basics.jsonl
