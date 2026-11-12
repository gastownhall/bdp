#!/usr/bin/env bash
# Build the projected artifacts from specs/core.lumen. No Rust, no network.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
mkdir -p build specs/generated
# --link-prefix ../ fixes the source's relative links for specs/generated/ (markdown only).
# No --source stamp: the committed reference must be byte-reproducible so CI can regenerate-and-diff.
tools/lumen/lumen build specs/core.lumen \
  --link-prefix ../ \
  --emit openapi=build/openapi.json \
  --emit jsonschema=build/schema.bundle.json \
  --emit markdown=specs/generated/core.md
echo "built: build/openapi.json  build/schema.bundle.json  specs/generated/core.md"
