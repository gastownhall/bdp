import { realpath, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";

export function assertServerExports(manifest) {
  const expected = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
  if (!isDeepStrictEqual(manifest.exports, expected))
    throw new Error("packed server exports differ from the approved root-only surface");
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

/** Resolve an existing seeded directory before passing it to the smoke child.
 * This checks this worktree only; it is not a general scan for other repositories.
 * Filesystem replacement after this administrative check is outside its contract. */
export async function isolatedWorkspace(supplied, workspaceRoot) {
  const root = await realpath(workspaceRoot);
  const candidate = await realpath(supplied);
  if (within(root, candidate) || within(path.resolve(workspaceRoot), path.resolve(supplied)))
    throw new Error("BDP_E2E_BD_WORKSPACE must be outside the repository working tree");
  if (!(await stat(candidate)).isDirectory())
    throw new Error("BDP_E2E_BD_WORKSPACE must be a directory");
  return candidate;
}
