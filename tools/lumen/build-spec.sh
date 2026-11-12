#!/usr/bin/env bash
# Build the projected artifacts from specs/core.lumen. No Rust, no network. python3 only.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
mkdir -p build specs/generated
# --link-prefix ../ fixes the source's relative links for specs/generated/ (markdown only).
# No --source stamp: the committed reference must be byte-reproducible so CI can regenerate-and-diff.
tools/lumen/lumen build specs/core.lumen \
  --link-prefix ../ \
  --emit openapi=build/openapi.json \
  --emit jsonschema=build/schema.bundle.json \
  --emit go=build/bdpcore.go \
  --emit markdown=specs/generated/core.md
# gofmt is a nicety, not a dependency: canonicalise the Go if a toolchain is present.
command -v gofmt >/dev/null 2>&1 && gofmt -w build/bdpcore.go || true
echo "built: build/openapi.json  build/schema.bundle.json  build/bdpcore.go  specs/generated/core.md"
