#!/usr/bin/env bash
# Assemble authored batch members; this script does not submit them.
set -euo pipefail

# Collect emitted members; a failed command stops this assembly.
(
  # Capture explaining Links whose target notes are ready.
  bd link query 'outgoing("csv-draft") as edge through edge is explains where edge.target.status = "ready"' \
    --batch-bind ready-links --dry-run-mode batch || exit

  # Capture the target Beads before removing those Links.
  bd query '(outgoing("csv-draft") as edge through edge is explains where edge.target.status = "ready").target' \
    --batch-bind ready-checks --dry-run-mode batch || exit

  # Describe explicit deletion of the captured Links.
  bd link delete batch-ref::ready-links --force --dry-run-mode batch || exit

  # Describe deletion of the captured target Beads.
  bd delete batch-ref::ready-checks --force --dry-run-mode batch || exit

) > csv-cleanup.jsonl
