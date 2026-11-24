import { readFileSync } from "node:fs";
const root = new URL("../../../", import.meta.url);
export const PROTOCOL_SPECIFICATION_PATHS = [
  "docs/history/profiles/core/core.md",
  "docs/history/profiles/write/write.md",
  "docs/history/profiles/types/types.md",
  "docs/history/profiles/events/events.md",
];
/** Read the actual named current document. Old cumulative citations use the
 * separate pinned historical reader, never an in-memory replacement monolith.
 */
export function readSpecificationSource(source: string): string {
  const resolved = new URL(source, root);
  if (!resolved.href.startsWith(root.href))
    throw new Error("artifact path escapes the repository root");
  return readFileSync(resolved, "utf8");
}
export function isProtocolSpecificationSource(source: string): boolean {
  return PROTOCOL_SPECIFICATION_PATHS.includes(source);
}
