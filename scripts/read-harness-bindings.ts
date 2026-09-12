import { createHash } from "node:crypto";

/** Fixed-order executed observer support, shared by packaged and matrix lanes.
 * runner.ts has its own runner binding. Target implementation is not observer support;
 * the existing installedPayload entry binding does not assert transitive payload closure.
 */
export const READ_OBSERVER_SUPPORT_PATHS = Object.freeze([
  "scripts/read-harness-bindings.ts",
  "packages/client/test-support/testing.ts",
  "packages/client/test-support/successor-read.ts",
  "packages/conformance/test-support/testing.ts",
  "packages/conformance/test-support/bd-workspace.ts",
  "packages/conformance/src/conditional-header.ts",
  "packages/conformance/src/executable-manifest.ts",
]);

export function deriveReadHarnessBindings(read: (source: string) => Uint8Array) {
  const support = READ_OBSERVER_SUPPORT_PATHS.map(read);
  const digest = (parts: readonly Uint8Array[]) =>
    createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  const matrix = (target: string) =>
    digest([
      read(`apps/${target}/src/read-matrix.test.ts`),
      read("packages/server/test-support/testing.ts"),
      ...support,
    ]);
  return {
    packaged: digest([read("scripts/generate-read-cohort.mts"), ...support]),
    matrix: { bdptest: matrix("bdptest"), bdpbd: matrix("bdpbd") },
  };
}
