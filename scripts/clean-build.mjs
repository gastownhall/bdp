import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

for (const group of ["packages", "apps"]) {
  const groupPath = path.join(workspaceRoot, group);
  const entries = await readdir(groupPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await rm(path.join(groupPath, entry.name, "dist"), { recursive: true, force: true });
  }
}
