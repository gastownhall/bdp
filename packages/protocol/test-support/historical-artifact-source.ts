import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
/** Exact accepted carrier source only. No current-schema or network fallback. */
export function historicalArtifactSchema(): Buffer {
  const bytes = readFileSync(
    new URL("historical-artifact-692d/bdp-v0.1.schema.json", import.meta.url),
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    "e0de70f5d1da926bedb4fac0343e0f561e91136511c4949cffd56ba5b6c60b8f"
  )
    throw new Error("historical artifact schema drift");
  return bytes;
}
/** Historical illustrative batch DSL; it is not the current Write authority. */
export function historicalWriteSketch(): string {
  const storage = readFileSync(
    new URL(
      "../../conformance/test-support/historical-citation-692d/specs/profiles/write/write.md.json",
      import.meta.url,
    ),
    "utf8",
  );
  const text: unknown = JSON.parse(storage);
  if (
    typeof text !== "string" ||
    createHash("sha256").update(text).digest("hex") !==
      "6b0fa7090066aff9d0a5994fb0899d9a3e77b4a8ce168d36c69564c71221fdb6"
  )
    throw new Error("historical Write sketch source drift");
  return text;
}
