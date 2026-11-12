#!/usr/bin/env bash
# Build the projected artifacts from specs/core.lumen. No Rust, no network.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
mkdir -p build
tools/lumen/lumen build specs/core.lumen \
  --emit openapi=build/openapi.json \
  --emit jsonschema=build/schema.bundle.json
echo "built: build/openapi.json  build/schema.bundle.json"
