import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Aliases every `@bdp/*` library package to its TypeScript source so `pnpm
 * test` works from a clean checkout without a prior build. A package may also
 * own a source-only `test-support/testing.ts` subpath for cross-package integration tests;
 * it is deliberately absent from package exports and installed consumers.
 * Each package's production `exports` map still points at `dist/index.js`.
 *
 * Only `packages/*` are scanned: those are the export-bearing libraries that
 * tests import as `@bdp/*`. `apps/*` are CLI binaries with no `exports` and a
 * `src/main.ts` entrypoint, so aliasing them would register a target that
 * does not exist and mask a misconfigured import. The manifest is read
 * directly — a missing or malformed `package.json` fails the Vitest config
 * with the offending path instead of being silently skipped.
 */
function collectWorkspaceSourceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  const packagesDir = path.join(workspaceRoot, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const manifestPath = path.join(packageDir, "package.json");
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`${manifestPath}: failed to read or parse package.json`, {
        cause: error,
      });
    }
    if (!isPlainObject(manifest) || typeof manifest.name !== "string") {
      throw new Error(`${manifestPath}: package.json must define a string "name"`);
    }
    const name = manifest.name;
    if (!name.startsWith("@bdp/")) continue;
    const sourceEntry = path.join(packageDir, "src", "index.ts");
    if (!existsSync(sourceEntry)) {
      throw new Error(
        `${manifestPath}: workspace package ${name} is missing its source entrypoint at ${sourceEntry}`,
      );
    }
    const testingEntry = path.join(packageDir, "test-support", "testing.ts");
    if (existsSync(testingEntry)) aliases[`${name}/testing`] = testingEntry;
    aliases[name] = sourceEntry;
  }
  return aliases;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default defineConfig({
  resolve: { alias: collectWorkspaceSourceAliases() },
  test: {
    coverage: { enabled: false },
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.mjs"],
    passWithNoTests: false,
    // Install the non-emitted admission mock before cross-package test modules
    // can instantiate @bdp/server through an adapter dependency.
    setupFiles: ["./packages/server/test-support/read-conformance-mock.ts"],
  },
});
