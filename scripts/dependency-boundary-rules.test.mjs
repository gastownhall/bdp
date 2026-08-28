import { describe, expect, it } from "vitest";

import {
  isTestOnlyInternalSpecifier,
  moduleSpecifiers,
  testOnlyImportViolations,
} from "./dependency-boundary-rules.mjs";

describe("dependency boundary source rules", () => {
  it("extracts static, dynamic, CommonJS, and createRequire module specifiers", () => {
    const contents = [
      'import value from "@bdp/protocol";',
      'export { value } from "@bdp/client";',
      'import type Alias = require("@bdp/server/testing");',
      'type Imported = import("@bdp/config").Config;',
      'void import("@bdp/conformance");',
      "void import(`@bdp/server/testing`);",
      'import "@bdp/server/\\u0074esting";',
      'require("../test-support/testing.js");',
      'createRequire(import.meta.url)("@bdp/server/testing");',
      'import { createRequire as makeRequire } from "node:module";',
      "const load = makeRequire(import.meta.url);",
      'load("@bdp/server/testing/internal");',
      'import moduleDefault from "node:module";',
      'moduleDefault.createRequire(import.meta.url)("@bdp/server/testing/default");',
      'import moduleEquals = require("node:module");',
      'moduleEquals.createRequire(import.meta.url)("@bdp/server/testing/import-equals");',
      "const nativeRequire = require;",
      'nativeRequire("../test-support/alias.js");',
      'require.resolve("@bdp/server/testing/resolve");',
    ].join("\n");

    expect(new Set(moduleSpecifiers(contents))).toEqual(
      new Set([
        "@bdp/protocol",
        "@bdp/client",
        "@bdp/server/testing",
        "@bdp/config",
        "@bdp/conformance",
        "../test-support/testing.js",
        "node:module",
        "@bdp/server/testing/internal",
        "@bdp/server/testing/default",
        "@bdp/server/testing/import-equals",
        "../test-support/alias.js",
        "@bdp/server/testing/resolve",
      ]),
    );
  });

  it("ignores import-like text in comments and string literals", () => {
    const contents = `
      // import value from "@bdp/server/testing";
      const example = 'require("@bdp/server/testing")';
      /** from "../test-support/testing.js" */
      obj.import("@bdp/server/testing");
    `;

    expect(moduleSpecifiers(contents)).toEqual([]);
  });

  it("rejects test-only imports from production while allowing test-owned sources", () => {
    const source = 'import { grant } from "../test-support/testing.js";';

    expect(testOnlyImportViolations(source, "packages/server/src/admission.ts")).toEqual([
      "../test-support/testing.js",
    ]);
    expect(testOnlyImportViolations(source, "packages/server/src/admission.test.ts")).toEqual([]);
    expect(testOnlyImportViolations(source, "packages/server/test-support/testing.ts")).toEqual([]);
    expect(
      testOnlyImportViolations(source, "test-support/worktree/packages/server/src/admission.ts"),
    ).toEqual(["../test-support/testing.js"]);
  });

  it("parses supported TypeScript decorators and attributes syntax errors to the source", () => {
    expect(
      moduleSpecifiers(
        '@sealed class Service { accessor state = 0; } import "@bdp/protocol";',
        "packages/server/src/decorated.ts",
      ),
    ).toEqual(["@bdp/protocol"]);
    expect(() => moduleSpecifiers("import {", "packages/server/src/broken.ts")).toThrow(
      "packages/server/src/broken.ts: could not be parsed for dependency-boundary analysis",
    );
  });

  it.each([
    "@bdp/server/testing",
    "@bdp/server/testing/internal",
    "../test-support/testing.js",
    "./test-support/helper.js",
  ])("classifies %s as test-only", (specifier) => {
    expect(isTestOnlyInternalSpecifier(specifier)).toBe(true);
  });

  it.each(["@bdp/server", "@bdp/server/testing-tools", "../src/testing.js"])(
    "does not classify %s as test-only",
    (specifier) => {
      expect(isTestOnlyInternalSpecifier(specifier)).toBe(false);
    },
  );
});
