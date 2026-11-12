#!/usr/bin/env bash
# Build the projected artifacts from specs/core.lumen. No Rust/Go required; python3 only.
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
  --emit rust=build/bdpcore.rs \
  --emit cli=build/cli.md \
  --emit markdown=specs/generated/core.md
command -v gofmt   >/dev/null 2>&1 && gofmt -w build/bdpcore.go   || true
command -v rustfmt >/dev/null 2>&1 && rustfmt --edition 2021 build/bdpcore.rs || true
echo "built: openapi.json schema.bundle.json bdpcore.go bdpcore.rs cli.md (build/) + specs/generated/core.md"
