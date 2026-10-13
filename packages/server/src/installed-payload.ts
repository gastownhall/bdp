import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Actual local installed runtime dependency closure; no caller-selected root. */
export async function installedPayloadIdentity() {
  // Hash the actual installed package closure, including URI/schema compiler
  // dependencies. Node and deployment/TLS are outside this payload identity.
  const payload = createHash("sha256");
  async function bindPackage(root: string, identity: string, ancestors: readonly string[]) {
    if (ancestors.includes(root) || ancestors.length >= 32)
      throw new TypeError("unsupported runtime dependency cycle/depth");
    const manifestPath = path.join(root, "package.json");
    if ((await lstat(manifestPath)).isSymbolicLink())
      throw new TypeError("internal runtime payload symlink unsupported");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    async function bindFiles(relative: string) {
      // Package roots have already been resolved by Node (including pnpm links).
      // Internal links are unsupported rather than silently omitted from identity.
      if (relative && (await lstat(path.join(root, relative))).isSymbolicLink())
        throw new TypeError("internal runtime payload symlink unsupported");
      for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort(
        (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        if (entry.isSymbolicLink())
          throw new TypeError("internal runtime payload symlink unsupported");
        const file = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) await bindFiles(file);
        else if (entry.isFile() && /\.(?:[cm]?js|json|node|wasm)$/.test(entry.name)) {
          const bytes = await readFile(path.join(root, file));
          payload.update(`${identity}/${file}:${bytes.length}:`).update(bytes);
        }
      }
    }
    if (manifest.name === "@bdp/server" || manifest.name === "@bdp/protocol") {
      // Workspace-only source/configuration is not part of the installed package.
      const bytes = await readFile(manifestPath);
      payload.update(`${identity}/package.json:${bytes.length}:`).update(bytes);
      await bindFiles("dist");
      if (manifest.name === "@bdp/protocol") await bindFiles("schemas");
    } else await bindFiles("");
    const require = createRequire(manifestPath);
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      let dependencyRoot = path.dirname(require.resolve(dependency));
      for (;;) {
        try {
          const value = JSON.parse(
            await readFile(path.join(dependencyRoot, "package.json"), "utf8"),
          );
          if (value.name === dependency) break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const parent = path.dirname(dependencyRoot);
        if (parent === dependencyRoot) throw new TypeError("runtime dependency manifest missing");
        dependencyRoot = parent;
      }
      await bindPackage(dependencyRoot, `${identity}>${dependency}`, [...ancestors, root]);
    }
  }
  await bindPackage(fileURLToPath(new URL("../", import.meta.url)), "@bdp/server", []);
  return payload.digest("hex");
}
