import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { testOnlyImportViolations } from "./dependency-boundary-rules.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const allowedRuntimeInternalDependencies = new Map([
  ["@bdp/protocol", []],
  ["@bdp/config", ["@bdp/protocol"]],
  ["@bdp/client", ["@bdp/protocol"]],
  ["@bdp/server", ["@bdp/protocol"]],
  ["@bdp/conformance", ["@bdp/protocol"]],
  ["@bdp/bd-domain", ["@bdp/client", "@bdp/protocol"]],
  ["@bdp/adapter-in-memory", ["@bdp/protocol", "@bdp/server"]],
  ["@bdp/adapter-bd", ["@bdp/protocol", "@bdp/server"]],
  ["@bdp/bdp", ["@bdp/bd-domain", "@bdp/client", "@bdp/config", "@bdp/protocol"]],
  ["@bdp/bdptest", ["@bdp/adapter-in-memory", "@bdp/config", "@bdp/server"]],
  ["@bdp/bdpbd", ["@bdp/adapter-bd", "@bdp/config", "@bdp/server"]],
]);

const allowedDevInternalDependencies = new Map([
  ["@bdp/bdptest", ["@bdp/bd-domain", "@bdp/client", "@bdp/conformance"]],
  ["@bdp/bdpbd", ["@bdp/bd-domain", "@bdp/client", "@bdp/conformance"]],
]);
async function typescriptSources(directory) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "dist" && entry.name !== "node_modules")
        sources.push(...(await typescriptSources(entryPath)));
    } else if (/\.(?:c|m)?tsx?$/.test(entry.name)) {
      sources.push(entryPath);
    }
  }
  return sources;
}

async function workspaceManifests(directory) {
  const entries = await readdir(path.join(workspaceRoot, directory), { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = path.join(workspaceRoot, directory, entry.name, "package.json");
        const contents = await readFile(manifestPath, "utf8");
        return { manifestPath, manifest: JSON.parse(contents) };
      }),
  );
}

const manifests = [
  ...(await workspaceManifests("packages")),
  ...(await workspaceManifests("apps")),
];
const workspaceNames = new Set(manifests.map(({ manifest }) => manifest.name));
const errors = [];

for (const [packageName, allowed] of allowedRuntimeInternalDependencies) {
  if (!workspaceNames.has(packageName)) {
    errors.push(`boundary map contains missing workspace package ${packageName}`);
  }
  for (const dependency of allowed) {
    if (!workspaceNames.has(dependency)) {
      errors.push(`${packageName} allows missing workspace dependency ${dependency}`);
    }
  }
}

for (const [packageName, allowed] of allowedDevInternalDependencies) {
  if (!workspaceNames.has(packageName)) {
    errors.push(`dev boundary map contains missing workspace package ${packageName}`);
  }
  for (const dependency of allowed) {
    if (!workspaceNames.has(dependency)) {
      errors.push(`${packageName} allows missing dev-only workspace dependency ${dependency}`);
    }
  }
}

for (const { manifestPath, manifest } of manifests) {
  const allowedRuntime = allowedRuntimeInternalDependencies.get(manifest.name);
  if (allowedRuntime === undefined) {
    errors.push(`${path.relative(workspaceRoot, manifestPath)}: unregistered workspace package`);
    continue;
  }

  const runtimeDeclared = Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }).filter((dependency) => dependency.startsWith("@bdp/"));
  const devDeclared = Object.keys(manifest.devDependencies ?? {}).filter((dependency) =>
    dependency.startsWith("@bdp/"),
  );

  for (const dependency of runtimeDeclared) {
    if (!allowedRuntime.includes(dependency)) {
      errors.push(`${manifest.name} may not have runtime dependency ${dependency}`);
    }
  }

  const allowedDev = allowedDevInternalDependencies.get(manifest.name) ?? [];
  for (const dependency of devDeclared) {
    if (!allowedDev.includes(dependency)) {
      errors.push(`${manifest.name} may not have dev-only dependency ${dependency}`);
    }
  }

  const packageRoot = path.dirname(manifestPath);
  const tsconfig = JSON.parse(await readFile(path.join(packageRoot, "tsconfig.json"), "utf8"));
  const referenced = await Promise.all(
    (tsconfig.references ?? []).map(async (reference) => {
      const referencedManifest = path.resolve(packageRoot, reference.path, "package.json");
      return JSON.parse(await readFile(referencedManifest, "utf8")).name;
    }),
  );

  // Production project references mirror runtime edges. Test-only workspace
  // imports are resolved by tsconfig.check.json and must remain out of this graph.
  for (const dependency of runtimeDeclared) {
    if (!referenced.includes(dependency)) {
      errors.push(
        `${manifest.name} declares runtime dependency ${dependency} without a matching project reference`,
      );
    }
  }

  for (const dependency of referenced) {
    if (!runtimeDeclared.includes(dependency)) {
      errors.push(
        `${manifest.name} references ${dependency} without declaring it as a runtime dependency`,
      );
    }
  }

  for (const sourcePath of await typescriptSources(packageRoot)) {
    const contents = await readFile(sourcePath, "utf8");
    const relativeSourcePath = path.relative(workspaceRoot, sourcePath).split(path.sep).join("/");
    for (const specifier of testOnlyImportViolations(contents, relativeSourcePath))
      errors.push(
        `${relativeSourcePath}: production source may not import test-only subpath ${specifier}`,
      );
  }
}

const rootTsconfig = JSON.parse(await readFile(path.join(workspaceRoot, "tsconfig.json"), "utf8"));
const rootReferences = new Set(
  await Promise.all(
    (rootTsconfig.references ?? []).map(async (reference) => {
      const referencedManifest = path.resolve(workspaceRoot, reference.path, "package.json");
      return JSON.parse(await readFile(referencedManifest, "utf8")).name;
    }),
  ),
);

for (const packageName of workspaceNames) {
  if (!rootReferences.has(packageName)) {
    errors.push(`root TypeScript build does not reference ${packageName}`);
  }
}

for (const packageName of rootReferences) {
  if (!workspaceNames.has(packageName)) {
    errors.push(`root TypeScript build references non-workspace package ${packageName}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Dependency boundaries valid for ${manifests.length} workspace packages.`);
}
