import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Test-source identity only: neither a release/version claim nor current authority. */
export const HISTORICAL_CITATION_692D_COMMIT = "692d801231c78e12b456d8c5213bdf137a6b534d";
const root = new URL("../../../", import.meta.url);
const SNAPSHOT_PINS = {
  "docs/design/requirements.md": {
    bytes: 19519,
    sha256: "0ae227c2801ba9d333f3ca63cb41eb3c70113302fda1e034bb4ab6b79b7f8b8c",
  },
  "specs/conformance.md": {
    bytes: 51973,
    sha256: "5bcfe0b2cc0134916c8cc348bf0ccdc0697e2de61fed789ef7876fceb2416b4d",
  },
  "specs/profiles/core/core.md": {
    bytes: 113069,
    sha256: "5772ccaeb2d6a68e43a92eeffe19db1d1f1c40b1c669ecb529513d90e948035e",
  },
  "specs/profiles/write/write.md": {
    bytes: 256862,
    sha256: "6b0fa7090066aff9d0a5994fb0899d9a3e77b4a8ce168d36c69564c71221fdb6",
  },
} as const;
const CATALOG_PINS = {
  "packages/conformance/catalog/read-v1.json": {
    bytes: 38684,
    sha256: "5fad85016d228aee7fb44dde108d6c1335e7ef558e8e86652bf19e8958e22989",
  },
  "packages/conformance/catalog/read-update-v1.json": {
    bytes: 85459,
    sha256: "8c744e7589f83f39b1ee07487cc8be3863425b83a46e6c9956d6dc75da52cd47",
  },
  "packages/conformance/catalog/owned-wildcard-v1.json": {
    bytes: 9592,
    sha256: "3d86b160a93dcc10455ce007923caa0976d3d7942d9d301e64e25d46df307305",
  },
  "packages/conformance/catalog/transactional-v1.json": {
    bytes: 95017,
    sha256: "e5696e1c2716274d9dcad9b2dc1e9143b80f40b81c2eac21069f02f101d16029",
  },
  "packages/conformance/catalog/history-v1.json": {
    bytes: 29267,
    sha256: "9c7339ed40b2710cfcf5b256c40a06778f43d8f5fadd95d8ca177d3d12b8aec1",
  },
  "packages/conformance/catalog/numeric-model-v1.json": {
    bytes: 6593,
    sha256: "7a6de2f8052d28f0779db6b7aef31032129a8740c230118892f5be944c91d156",
  },
} as const;
const PINS: Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>> = {
  ...SNAPSHOT_PINS,
  ...CATALOG_PINS,
};
export const HISTORICAL_CITATION_692D_CATALOG_PATHS = Object.freeze(Object.keys(CATALOG_PINS));
const PARTS = [
  "specs/profiles/core/core.md",
  "specs/profiles/write/write.md",
  "specs/conformance.md",
] as const;

/** Exact-byte negative-control seam; cannot override any pin or reader. */
export function assertHistoricalCitation692dBytes(source: string, bytes: Uint8Array): void {
  if (!Object.hasOwn(PINS, source))
    throw new Error(`Not a pinned historical citation 692d input: ${source}`);
  const fact = PINS[source]!;
  if (
    bytes.byteLength !== fact.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== fact.sha256
  )
    throw new Error(`Historical citation 692d byte drift: ${source}`);
}

/** The sole encoded snapshot: original Write text, including its final blank line. */
export function decodeHistoricalCitation692dWriteStorage(storage: string): Buffer {
  const value: unknown = JSON.parse(storage);
  if (typeof value !== "string")
    throw new Error("Historical citation 692d Write storage must contain one JSON string");
  const bytes = Buffer.from(value, "utf8");
  assertHistoricalCitation692dBytes("specs/profiles/write/write.md", bytes);
  return bytes;
}

function readSnapshot(source: string): string {
  if (!Object.hasOwn(SNAPSHOT_PINS, source))
    throw new Error(`Not a historical citation 692d source: ${source}`);
  const bytes =
    source === "specs/profiles/write/write.md"
      ? decodeHistoricalCitation692dWriteStorage(
          readFileSync(
            new URL("historical-citation-692d/specs/profiles/write/write.md.json", import.meta.url),
            "utf8",
          ),
        )
      : readFileSync(new URL(`historical-citation-692d/${source}`, import.meta.url));
  assertHistoricalCitation692dBytes(source, bytes);
  return bytes.toString("utf8");
}

/** Same existing section/link composition, applied only to four pinned snapshots. */
export function readHistoricalCitation692dSource(source: string): string {
  if (source !== "docs/specs/bdp.md") return readSnapshot(source);
  return PARTS.map((part) => {
    const text = readSnapshot(part);
    const marker = "<!-- protocol-text -->\n\n";
    const body = text.includes(marker) ? text.slice(text.indexOf(marker) + marker.length) : text;
    return body.replace(/\]\((?:[^)#]*\/)?(?:core|write|conformance)\.md(#[^)]+)\)/g, "]($1)");
  }).join("\n");
}

/** Read current catalog bytes only if they are exactly this historical cutline's input. */
export function readHistoricalCitation692dCatalog(source: string): string {
  if (!Object.hasOwn(CATALOG_PINS, source))
    throw new Error(`Not a historical citation 692d catalog: ${source}`);
  const bytes = readFileSync(new URL(source, root));
  assertHistoricalCitation692dBytes(source, bytes);
  return bytes.toString("utf8");
}

/** Physical source ownership for this historical audit only; no history/Types admission. */
export function isHistoricalCitation692dProtocolSource(source: string): boolean {
  return source === "docs/specs/bdp.md" || PARTS.some((part) => part === source);
}
