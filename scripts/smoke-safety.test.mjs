import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { assertServerExports, isolatedWorkspace } from "./smoke-safety.mjs";

it("pins the allowed public package root and refuses missing or broad exports", () => {
  const exports = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
  expect(() => assertServerExports({ exports })).not.toThrow();
  for (const candidate of [
    undefined,
    { ...exports, "./dist/*": "./dist/*" },
    { ...exports, "./private": "./dist/installed-schema-evaluator.js" },
  ])
    expect(() => assertServerExports({ exports: candidate })).toThrow("root-only surface");
});
it("refuses root, descendants and symlink aliases while accepting an external sibling", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "bdp-smoke-safety-"));
  try {
    const root = path.join(temporary, "repo"),
      child = path.join(root, "packages"),
      outside = path.join(temporary, "repo-external");
    await mkdir(child, { recursive: true });
    await mkdir(outside);
    await symlink(root, path.join(temporary, "root-alias"));
    await symlink(child, path.join(outside, "child-alias"));
    await symlink(outside, path.join(temporary, "outside-alias"));
    for (const candidate of [
      root,
      `${root}/`,
      child,
      path.join(temporary, "root-alias"),
      path.join(outside, "child-alias"),
    ])
      await expect(isolatedWorkspace(candidate, root)).rejects.toThrow("outside the repository");
    expect(await isolatedWorkspace(outside, root)).toBe(await realpath(outside));
    expect(await isolatedWorkspace(path.join(temporary, "outside-alias"), root)).toBe(
      await realpath(outside),
    );
    await writeFile(path.join(outside, "file"), "x");
    await expect(isolatedWorkspace(path.join(outside, "file"), root)).rejects.toThrow(
      "must be a directory",
    );
    await expect(isolatedWorkspace(path.join(outside, "missing"), root)).rejects.toThrow();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
