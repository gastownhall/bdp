#!/usr/bin/env bash
# Emit a read-only selection member; this script does not submit it.
set -euo pipefail

# Assemble the read-only member description.
(
  # Capture current ready notes under an internal batch name.
  bd list --batch-bind ready-notes --type note --property 'status = "ready"' \
    --dry-run-mode batch || exit

) > csv-read-only.jsonl

