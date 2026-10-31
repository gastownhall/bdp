import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
export const PROTOCOL_SPECIFICATION_PATHS = [
  "specs/profiles/core/core.md",
  "specs/profiles/write/write.md",
  "specs/conformance.md",
];

/** Old catalog source names are evidence: do not rewrite their bytes or hashes.
 * Assemble only current authoritative text, in memory, for citation validation.
 * The layout test separately checks real cross-file links and section ownership.
 * This is test support, not a published specification or a runtime fallback. */
export function readProtocolSpecification(): string {
  return PROTOCOL_SPECIFICATION_PATHS.map((source) => {
    const text = readFileSync(new URL(source, root), "utf8");
    const marker = "<!-- protocol-text -->\n\n";
    const body = text.includes(marker) ? text.slice(text.indexOf(marker) + marker.length) : text;
    return body.replace(/\]\((?:[^)#]*\/)?(?:core|write|conformance)\.md(#[^)]+)\)/g, "]($1)");
  }).join("\n");
}

export function readSpecificationSource(source: string): string {
  if (source === "docs/specs/bdp.md") return readProtocolSpecification();
  const resolved = new URL(source, root);
  if (!resolved.href.startsWith(root.href))
    throw new Error("artifact path escapes the repository root");
  return readFileSync(resolved, "utf8");
}

export function isProtocolSpecificationSource(source: string): boolean {
  return source === "docs/specs/bdp.md" || PROTOCOL_SPECIFICATION_PATHS.includes(source);
}
