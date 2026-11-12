#!/usr/bin/env bash
# Build the projected artifacts from specs/core.lumen. No Rust, no network.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
mkdir -p build
sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
tools/lumen/lumen build specs/core.lumen \
  --source "core.lumen @ ${sha}" \
  --emit openapi=build/openapi.json \
  --emit jsonschema=build/schema.bundle.json \
  --emit markdown=build/reference.md
echo "built: build/openapi.json  build/schema.bundle.json  build/reference.md"
