import { observeInstalledReference } from "./installed-reference-observation.mjs";
import { createRequire } from "node:module";
import { assertServerExports, isolatedWorkspace } from "./smoke-safety.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executables = ["bdp", "bdptest", "bdpbd"];

// Every assertion below is about the compiled-in defaults, and every startup
// setting is readable from a `BDP_*` variable. A developer who exports
// BDP_MODE or BDP_CONFIG in their shell would otherwise be smoke-testing their own
// configuration. The pack and install steps keep the real environment, which they
// need for npm_execpath and the registry.
const hermeticEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("BDP_")),
);

// Sections each executable's diagnostic should carry. This mirrors the
// role-scoped views in `@bdp/config`: passing a role to loadStartupConfig
// restricts both validation and output to precisely these keys.
const EXPECTED_SECTIONS = {
  bdp: ["auth", "mode", "scope"],
  bdptest: ["bdptest", "mode", "scope", "server"],
  bdpbd: ["bd", "mode", "scope", "server"],
};

function parseDiagnostics(stderr, executable) {
  return stderr
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${executable} emitted a non-JSON diagnostic: ${line}`, { cause: error });
      }
    });
}

function spawnWithOutput(command, args, cwd = workspaceRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function assertBuildOutput() {
  for (const workspaceDirectory of ["packages", "apps"]) {
    const workspacePackages = await readdir(path.join(workspaceRoot, workspaceDirectory), {
      withFileTypes: true,
    });
    for (const workspacePackage of workspacePackages.filter((entry) => entry.isDirectory())) {
      const outputDirectory = path.join(
        workspaceRoot,
        workspaceDirectory,
        workspacePackage.name,
        "dist",
      );
      const outputFiles = await readdir(outputDirectory, { recursive: true });
      const testArtifact = outputFiles.find((entry) => entry.includes(".test."));
      if (testArtifact) {
        throw new Error(`${workspacePackage.name} emitted test artifact ${testArtifact}`);
      }
    }
  }
}

async function installPackedWorkspace() {
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry) throw new Error("pnpm did not provide npm_execpath");

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "bdp-smoke-"));
  const packRoot = path.join(temporaryRoot, "packs");
  const installRoot = path.join(temporaryRoot, "install");
  try {
    await mkdir(packRoot);
    await spawnWithOutput(process.execPath, [
      pnpmEntry,
      "--filter",
      "./packages/**",
      "--filter",
      "./apps/**",
      "-r",
      "pack",
      "--pack-destination",
      packRoot,
    ]);

    const tarballs = (await readdir(packRoot))
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => path.join(packRoot, entry));
    await mkdir(installRoot);
    await writeFile(path.join(installRoot, "package.json"), '{"private":true}\n');
    await spawnWithOutput("npm", [
      "install",
      "--prefix",
      installRoot,
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      ...tarballs,
    ]);

    const installedServerRoot = path.join(installRoot, "node_modules", "@bdp", "server");
    const installedServerOutput = await readdir(path.join(installedServerRoot, "dist"));
    // Intentional package-surface tripwire: adding or removing a shipped server
    // module is a deliberate reviewed change, not an incidental build artifact.
    const expectedServerOutput = new Set([
      "installed-payload.d.ts",
      "installed-payload.d.ts.map",
      "installed-payload.js",
      "installed-payload.js.map",
      "transaction-installed-configuration.d.ts",
      "transaction-installed-configuration.d.ts.map",
      "transaction-installed-configuration.js",
      "transaction-installed-configuration.js.map",
      "transaction-installed.d.ts",
      "transaction-installed.d.ts.map",
      "transaction-installed.js",
      "transaction-installed.js.map",
      "transaction-installed-process.d.ts",
      "transaction-installed-process.d.ts.map",
      "transaction-installed-process.js",
      "transaction-installed-process.js.map",

      "alias-evaluator.d.ts",
      "alias-evaluator.d.ts.map",
      "alias-evaluator.js",
      "alias-evaluator.js.map",
      "development-composition.d.ts",
      "development-composition.d.ts.map",
      "development-composition.js",
      "development-composition.js.map",
      "read-http-routing.d.ts",
      "read-http-routing.d.ts.map",
      "read-http-routing.js",
      "read-http-routing.js.map",
      "authority-read.d.ts",
      "authority-read.d.ts.map",
      "authority-read.js",
      "authority-read.js.map",
      "installed-schema-pattern.d.ts",
      "installed-schema-pattern.d.ts.map",
      "installed-schema-pattern.js",
      "installed-schema-pattern.js.map",
      "installed-schema-decimal.d.ts",
      "installed-schema-decimal.d.ts.map",
      "installed-schema-decimal.js",
      "installed-schema-decimal.js.map",
      "installed-schema-recursion.d.ts",
      "installed-schema-recursion.d.ts.map",
      "installed-schema-recursion.js",
      "installed-schema-recursion.js.map",
      "installed-schema-evaluator.d.ts",
      "installed-schema-evaluator.d.ts.map",
      "installed-schema-evaluator.js",
      "installed-schema-evaluator.js.map",
      "installed-schema-value.d.ts",
      "installed-schema-value.d.ts.map",
      "installed-schema-value.js",
      "installed-schema-value.js.map",
      "installed-schema-builtins.d.ts",
      "installed-schema-builtins.d.ts.map",
      "installed-schema-builtins.js",
      "installed-schema-builtins.js.map",
      "installed-schema-graph.d.ts",
      "installed-schema-graph.d.ts.map",
      "installed-schema-graph.js",
      "installed-schema-graph.js.map",
      "installed-schema-shape.d.ts",
      "installed-schema-shape.d.ts.map",
      "installed-schema-shape.js",
      "installed-schema-shape.js.map",
      "installed-schema-uri.d.ts",
      "installed-schema-uri.d.ts.map",
      "installed-schema-uri.js",
      "installed-schema-uri.js.map",
      "installed-contract-artifact.d.ts",
      "installed-contract-artifact.d.ts.map",
      "installed-contract-artifact.js",
      "installed-contract-artifact.js.map",
      "member-executor.d.ts",
      "member-executor.d.ts.map",
      "member-executor.js",
      "member-executor.js.map",
      "member-identity.d.ts",
      "member-identity.d.ts.map",
      "member-identity.js",
      "member-identity.js.map",
      "member-numeric-diagnostics.d.ts",
      "member-numeric-diagnostics.d.ts.map",
      "member-numeric-diagnostics.js",
      "member-numeric-diagnostics.js.map",
      "recovery-store.d.ts",
      "recovery-store.d.ts.map",
      "recovery-store.js",
      "recovery-store.js.map",
      "resource-evaluator.d.ts",
      "resource-evaluator.d.ts.map",
      "resource-evaluator.js",
      "resource-evaluator.js.map",
      "json-value-equality.d.ts",
      "json-value-equality.d.ts.map",
      "json-value-equality.js",
      "json-value-equality.js.map",
      "retained-disclosure.d.ts",
      "retained-disclosure.d.ts.map",
      "retained-disclosure.js",
      "retained-disclosure.js.map",
      "semantic-identity.d.ts",
      "semantic-identity.d.ts.map",
      "semantic-identity.js",
      "semantic-identity.js.map",
      "transaction-set.d.ts",
      "transaction-set.d.ts.map",
      "transaction-set.js",
      "transaction-set.js.map",
      "transaction-batch.d.ts",
      "transaction-batch.d.ts.map",
      "transaction-batch.js",
      "transaction-batch.js.map",
      "transaction-comparison.d.ts",
      "transaction-comparison.d.ts.map",
      "transaction-comparison.js",
      "transaction-comparison.js.map",
      "transaction-dependencies.d.ts",
      "transaction-dependencies.d.ts.map",
      "transaction-dependencies.js",
      "transaction-dependencies.js.map",
      "transaction-sse.d.ts",
      "transaction-sse.d.ts.map",
      "transaction-sse.js",
      "transaction-sse.js.map",
      "node-http-disconnect.d.ts",
      "node-http-disconnect.d.ts.map",
      "node-http-disconnect.js",
      "node-http-disconnect.js.map",
      "transaction-authorization.d.ts",
      "transaction-authorization.d.ts.map",
      "transaction-authorization.js",
      "transaction-authorization.js.map",
      "transaction-changefeed.d.ts",
      "transaction-changefeed.d.ts.map",
      "transaction-changefeed.js",
      "transaction-changefeed.js.map",
      "transaction-events.d.ts",
      "transaction-events.d.ts.map",
      "transaction-events.js",
      "transaction-events.js.map",
      "transaction-snapshot.d.ts",
      "transaction-snapshot.d.ts.map",
      "transaction-snapshot.js",
      "transaction-snapshot.js.map",
      "transaction-read.d.ts",
      "transaction-read.d.ts.map",
      "transaction-read.js",
      "transaction-read.js.map",
      "transaction-sequence.d.ts",
      "transaction-sequence.d.ts.map",
      "transaction-sequence.js",
      "transaction-sequence.js.map",
      "transaction-store.d.ts",
      "transaction-store.d.ts.map",
      "transaction-store.js",
      "transaction-store.js.map",
      "transaction-schema-http.d.ts",
      "transaction-schema-http.d.ts.map",
      "transaction-schema-http.js",
      "transaction-schema-http.js.map",
      "transaction-http.d.ts",
      "transaction-http.d.ts.map",
      "transaction-http.js",
      "transaction-http.js.map",
      "transaction-runtime-configuration.d.ts",
      "transaction-runtime-configuration.d.ts.map",
      "transaction-runtime-configuration.js",
      "transaction-runtime-configuration.js.map",
      "transaction-runtime.d.ts",
      "transaction-runtime.d.ts.map",
      "transaction-runtime.js",
      "transaction-runtime.js.map",
      "transaction-consistency.d.ts",
      "transaction-consistency.d.ts.map",
      "transaction-consistency.js",
      "transaction-consistency.js.map",
      "transaction-discovery.d.ts",
      "transaction-discovery.d.ts.map",
      "transaction-discovery.js",
      "transaction-discovery.js.map",
      "transaction-service.d.ts",
      "transaction-service.d.ts.map",
      "transaction-service.js",
      "transaction-service.js.map",
      "transaction-submission.d.ts",
      "transaction-submission.d.ts.map",
      "transaction-submission.js",
      "transaction-submission.js.map",
      "sequence-executor.d.ts",
      "sequence-executor.d.ts.map",
      "sequence-executor.js",
      "sequence-executor.js.map",
      "development.d.ts",
      "development.d.ts.map",
      "development.js",
      "development.js.map",
      "installed-reference-configuration.d.ts",
      "installed-reference-configuration.d.ts.map",
      "installed-reference-configuration.js",
      "installed-reference-configuration.js.map",
      "installed-reference.d.ts",
      "installed-reference.d.ts.map",
      "installed-reference.js",
      "installed-reference.js.map",
      "installed-reference-process.d.ts",
      "installed-reference-process.d.ts.map",
      "installed-reference-process.js",
      "installed-reference-process.js.map",
      "development-contracts.d.ts",
      "development-contracts.d.ts.map",
      "development-contracts.js",
      "development-contracts.js.map",
      "development-runtime.d.ts",
      "development-runtime.d.ts.map",
      "development-runtime.js",
      "development-runtime.js.map",
      "development-authority.d.ts",
      "development-authority.d.ts.map",
      "development-authority.js",
      "development-authority.js.map",
      "index.d.ts",
      "index.d.ts.map",
      "index.js",
      "index.js.map",
      "read-conformance-capability.d.ts",
      "read-conformance-capability.d.ts.map",
      "read-conformance-capability.js",
      "read-conformance-capability.js.map",
      "node-http-target.d.ts",
      "node-http-target.d.ts.map",
      "node-http-target.js",
      "node-http-target.js.map",
      "read-http.d.ts",
      "read-http.d.ts.map",
      "read-http.js",
      "read-http.js.map",
      "read-pagination.d.ts",
      "read-pagination.d.ts.map",
      "read-pagination.js",
      "read-pagination.js.map",
      "reference-deployment.d.ts",
      "reference-deployment.d.ts.map",
      "reference-deployment.js",
      "reference-deployment.js.map",
      "reference-deployment-state.d.ts",
      "reference-deployment-state.d.ts.map",
      "reference-deployment-state.js",
      "reference-deployment-state.js.map",
      "read-request.d.ts",
      "read-request.d.ts.map",
      "read-request.js",
      "read-request.js.map",
      "read-sequence-lifecycle.d.ts",
      "read-sequence-lifecycle.d.ts.map",
      "read-sequence-lifecycle.js",
      "read-sequence-lifecycle.js.map",
      "read-update-runtime-limits.d.ts",
      "read-update-runtime-limits.d.ts.map",
      "read-update-runtime-limits.js",
      "read-update-runtime-limits.js.map",
      "read-selector.d.ts",
      "read-selector.d.ts.map",
      "read-selector.js",
      "read-selector.js.map",
    ]);
    if (
      installedServerOutput.length !== expectedServerOutput.size ||
      installedServerOutput.some((entry) => !expectedServerOutput.has(entry))
    ) {
      const missing = [...expectedServerOutput].filter(
        (entry) => !installedServerOutput.includes(entry),
      );
      const unexpected = installedServerOutput.filter((entry) => !expectedServerOutput.has(entry));
      throw new Error(
        `packed server output mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
      );
    }
    const installedServerFiles = await readdir(installedServerRoot, { recursive: true });
    if (installedServerFiles.some((entry) => entry.split(path.sep).includes("test-support")))
      throw new Error("packed server must not contain test-support files");
    const installedServerManifest = JSON.parse(
      await readFile(path.join(installedServerRoot, "package.json"), "utf8"),
    );
    assertServerExports(installedServerManifest);
    const consumer = createRequire(path.join(installRoot, "consumer.cjs"));
    if (
      (await realpath(consumer.resolve("@bdp/server"))) !==
      (await realpath(path.join(installedServerRoot, "dist", "index.js")))
    )
      throw new Error("packed server public root does not resolve to its approved entry");
    if (
      (await realpath(consumer.resolve("@bdp/server/development"))) !==
      (await realpath(path.join(installedServerRoot, "dist", "development.js")))
    )
      throw new Error("packed development facade does not resolve to its explicit entry");
    const deploymentEntry = consumer.resolve("@bdp/server/reference-configuration");
    if (
      (await realpath(deploymentEntry)) !==
      (await realpath(path.join(installedServerRoot, "dist", "reference-deployment.js")))
    )
      throw new Error("packed deployment loader does not resolve to its approved entry");
    const deployment = await import(pathToFileURL(deploymentEntry).href);
    if (
      Object.keys(deployment).sort().join(",") !==
      "ReferenceDeploymentError,loadReferenceDeployment"
    )
      throw new Error("packed deployment entry exposes unexpected capabilities");
    const publicDeclaration = await readFile(
      path.join(installedServerRoot, "dist", "reference-deployment.d.ts"),
      "utf8",
    );
    for (const name of [
      "reference-deployment-state",
      "installed-reference-configuration",
      "transaction-runtime",
      "TransactionRuntime",
      "credentials",
      "projectedInput",
      "authenticate",
      "metadata(",
      "readOptions(",
    ])
      if (publicDeclaration.includes(name))
        throw new Error("packed deployment declaration exposes private capture types");
    await observePackedDeploymentLoader(deployment, temporaryRoot);
    const protocol = await import(pathToFileURL(consumer.resolve("@bdp/protocol")).href);
    const transactionFixture = JSON.parse(
      await readFile(path.join(workspaceRoot, "fixtures/transactional/discovery.json"), "utf8"),
    );
    for (const [name, body] of [
      ["parseTransactionalDiscovery", transactionFixture.exchanges[0].response.body],
      ["parseTransactionalOperationDirectory", transactionFixture.exchanges[1].response.body],
    ]) {
      const parsed = protocol[name](body);
      if (JSON.stringify(parsed) !== JSON.stringify(body) || !Object.isFrozen(parsed))
        throw new Error("packed Transactional parser changed its structural fixture");
      let rejected = false;
      try {
        protocol[name]({ ...body, unsupported: true });
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("packed Transactional parser accepted an unknown member");
    }
    // The public root must preserve its original pagination surface even though
    // the same private engine also supports Transactional source context.
    const publicServer = await import(pathToFileURL(consumer.resolve("@bdp/server")).href);
    if (
      "assembleTransactionDiscovery" in publicServer ||
      "TRANSACTION_HTTP_OPERATIONS" in publicServer ||
      "createTransactionService" in publicServer ||
      "createTransactionHttpHandler" in publicServer ||
      "startTransactionRuntime" in publicServer ||
      "snapshotTransactionMinimum" in publicServer ||
      "waitForTransactionMinimum" in publicServer ||
      "checkTransactionMinimum" in publicServer ||
      "transactionReceiptMaximum" in publicServer ||
      "prepareTransactionSetCore" in publicServer ||
      "prepareSetCore" in publicServer
    )
      throw new Error("packed root exposes private transaction service");
    if (
      "loadReferenceDeployment" in publicServer ||
      "referenceDeploymentState" in publicServer ||
      "registerReferenceDeployment" in publicServer
    )
      throw new Error("packed root exposes deployment preparation or private registry");
    if ("createContextualReadPagination" in publicServer)
      throw new Error("packed root exposes private contextual pagination factory");
    const pagination = publicServer.createReadPagination({
      scope: "https://example.test/s/",
      defaultPageItems: 1,
      maxPageItems: 2,
      cursorTtlMs: 1000,
      retainedStateCapacity: 10,
      maxRetainedCursorPositionsPerSnapshot: 5,
      retainedSnapshotByteCapacity: 5,
      retainedSnapshotNodeCapacity: 3,
      maxOpaqueTokenLength: 40,
      tokenGenerationAttempts: 2,
      idleCleanup: "on-demand",
      clock: () => 0,
      generateOpaqueToken: () => "cursor",
    });
    try {
      if (
        Object.keys(pagination).sort().join(",") !==
        "cleanupExpired,close,continuePage,firstPage,limits,validateLimit"
      )
        throw new Error("packed public pagination API changed");
      const input = {
        items: [1, 2],
        authorizationView: "v",
        scopeEpoch: "e",
        projection: "p",
        continuationUrl: "https://example.test/s/beads/",
      };
      Object.defineProperty(input, "sourceContext", {
        enumerable: true,
        get() {
          throw new Error("public context getter executed");
        },
      });
      const extra = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("public extra argument inspected");
          },
        },
      );
      const page = Reflect.apply(pagination.firstPage, pagination, [input, extra]);
      if (page.items.length !== 1 || page.items[0] !== 1 || typeof page.next !== "string")
        throw new Error("packed public pagination result changed");
    } finally {
      pagination.close();
    }
    for (const module of installedServerOutput.filter(
      (name) =>
        (name.startsWith("installed-schema-") || name.startsWith("transaction-")) &&
        name.endsWith(".js"),
    )) {
      try {
        consumer.resolve(`@bdp/server/dist/${module}`);
        throw new Error("packed private implementation module unexpectedly resolves");
      } catch (error) {
        if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
      }
    }

    for (const specifier of [
      "@bdp/conformance/transactional-observation",
      "@bdp/conformance/dist/transactional-observation.js",
      "@bdp/server/reference-deployment",
      "@bdp/server/dist/reference-deployment.js",
      "@bdp/server/reference-deployment-state",
      "@bdp/server/dist/reference-deployment-state.js",
      "@bdp/server/development-composition",
      "@bdp/server/dist/development-composition.js",
      "@bdp/server/installed-payload",
      "@bdp/server/dist/installed-payload.js",
      "@bdp/server/transaction-installed-configuration",
      "@bdp/server/dist/transaction-installed-configuration.js",
      "@bdp/server/transaction-installed",
      "@bdp/server/dist/transaction-installed.js",
      "@bdp/server/transaction-installed-process",
      "@bdp/server/dist/transaction-installed-process.js",
      "@bdp/server/transaction-runtime-configuration",
      "@bdp/server/dist/transaction-runtime-configuration.js",
      "@bdp/server/transaction-snapshot",
      "@bdp/server/dist/transaction-snapshot.js",
      "@bdp/server/transaction-sse",
      "@bdp/server/dist/transaction-sse.js",
      "@bdp/server/node-http-disconnect",
      "@bdp/server/dist/node-http-disconnect.js",
      "@bdp/server/transaction-changefeed",
      "@bdp/server/dist/transaction-changefeed.js",
      "@bdp/server/read-http-routing",
      "@bdp/server/dist/read-http-routing.js",
      "@bdp/server/read-pagination",
      "@bdp/server/dist/read-pagination.js",
      "@bdp/server/installed-reference-configuration",
      "@bdp/server/dist/installed-reference-configuration.js",
      "@bdp/server/installed-reference",
      "@bdp/server/dist/installed-reference.js",
      "@bdp/server/installed-reference-process",
      "@bdp/server/dist/installed-reference-process.js",
      "@bdp/server/development-contracts",
      "@bdp/server/dist/development-contracts.js",
      "@bdp/server/development-runtime",
      "@bdp/server/dist/development-runtime.js",
      "@bdp/server/development-authority",
    ]) {
      try {
        consumer.resolve(specifier);
        throw new Error("packed private development runtime unexpectedly resolves");
      } catch (error) {
        if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
      }
    }

    const conformanceOutput = await readdir(
      path.join(installRoot, "node_modules", "@bdp", "conformance", "dist"),
    );
    for (const suffix of [".js", ".js.map", ".d.ts", ".d.ts.map"])
      if (!conformanceOutput.includes(`transactional-observation${suffix}`))
        throw new Error("packed private receipt recorder output missing");

    const capabilityUrl = pathToFileURL(
      path.join(
        installRoot,
        "node_modules",
        "@bdp",
        "server",
        "dist",
        "read-conformance-capability.js",
      ),
    ).href;
    const { hasReadConformanceEvidence } = await import(capabilityUrl);

    return {
      entry(executable) {
        return path.join(installRoot, "node_modules", ".bin", executable);
      },
      temporaryRoot,
      installedReferenceEntry: path.join(
        installedServerRoot,
        "dist",
        "installed-reference-process.js",
      ),
      hasReadConformanceEvidence,
      async version(executable) {
        const manifestPath = path.join(
          installRoot,
          "node_modules",
          "@bdp",
          executable,
          "package.json",
        );
        return JSON.parse(await readFile(manifestPath, "utf8")).version;
      },
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function run(executable, entry, argument, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry, [argument], {
      cwd: workspaceRoot,
      env: { ...hermeticEnv, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${executable} ${argument} timed out`));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function runLifecycle(executable, entry, sendShutdownSignal, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry, [], {
      cwd: workspaceRoot,
      env: { ...hermeticEnv, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let shutdownSent = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${executable} lifecycle timed out`));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (sendShutdownSignal && !shutdownSent && stderr.includes('"event":"lifecycle.started"')) {
        shutdownSent = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function runLifecycleWithConfig(executable, entry, configFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry, ["--config", configFile], {
      cwd: workspaceRoot,
      env: hermeticEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let shutdownSent = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${executable} --config lifecycle timed out`));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!shutdownSent && stderr.includes('"event":"lifecycle.started"')) {
        shutdownSent = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function runServe(executable, entry, extraEnv = {}, args = ["--serve"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry, args, {
      cwd: workspaceRoot,
      env: { ...hermeticEnv, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${executable} --serve did not fail closed before binding`));
    }, 5_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * The bdpbd admitted smoke needs an isolated workspace path and must never
 * point at the repository. An operator may supply a seeded one via
 * BDP_E2E_BD_WORKSPACE; without it the smoke mints an empty directory under
 * its own temporary root. That is sufficient by observation: the admitted
 * probe reads only discovery, which the packaged server serves without ever
 * dispatching to bd, so no seeding and no bd executable are required.
 */
async function provideBdWorkspace(temporaryRoot) {
  const supplied = process.env.BDP_E2E_BD_WORKSPACE;
  if (supplied !== undefined && supplied !== "") {
    return isolatedWorkspace(supplied, workspaceRoot);
  }
  const minted = path.join(temporaryRoot, "bd-smoke-workspace");
  await mkdir(minted, { recursive: true });
  return minted;
}

async function probeFreePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port probe did not bind");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function fetchWithRetry(url, attempts = 20, delayMs = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((settle) => setTimeout(settle, delayMs));
    }
  }
  throw lastError ?? new Error(`no response from ${url}`);
}

function runAdmittedReadSmoke(executable, entry, port, workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn(entry, ["--serve"], {
      cwd: workspaceRoot,
      env: {
        ...hermeticEnv,
        BDP_SERVER_ADVERTISED_PROFILE: "read",
        BDP_SERVER_PORT: String(port),
        // The bind transport can be plain HTTP behind a proxy while the public
        // canonical Scope remains HTTPS and uses a different authority.
        BDP_SCOPE_URL: "https://public.example/local-test/",
        // Never the repository: pointing bd at the working tree would let a
        // smoke run mutate the repo it is meant to be testing. The caller
        // provides an isolated path (operator-supplied or freshly minted).
        ...(executable === "bdpbd" ? { BDP_BD_WORKSPACE: workspace } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let probing = false;
    let finished = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${executable} admitted Read smoke timed out`));
    }, 5_000);
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", async (chunk) => {
      stderr += chunk;
      if (!stderr.includes('"event":"server.started"') || probing || finished) return;
      probing = true;
      try {
        // server.started precedes the listener accepting, so a single shot can
        // lose a startup race. e2e-ready retries for exactly this reason; the
        // outer timeout stays authoritative.
        const response = await fetchWithRetry(`http://127.0.0.1:${port}/local-test/bdp.json`);
        const discovery = await response.json();
        if (
          response.status !== 200 ||
          discovery.profile !== "read" ||
          discovery.scope !== "https://public.example/local-test/"
        ) {
          throw new Error(`${executable} admitted Read discovery was not a Read document`);
        }
        child.kill("SIGTERM");
      } catch (error) {
        child.kill("SIGKILL");
        finish(error);
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0 || !stderr.includes('"event":"server.stopped"')) {
        finish(new Error(`${executable} admitted Read smoke did not stop cleanly`));
      } else {
        finish(undefined, { code, stderr });
      }
    });
  });
}

function fail(executable, reason) {
  // The startup.config diagnostic can carry credentials in `auth.token`, so
  // failures name the failing check rather than dumping the full config.
  throw new Error(`${executable} smoke failure: ${reason}`);
}

function startupConfigFor(diagnostics) {
  return diagnostics.find((entry) => entry.event === "startup.config")?.config;
}

await assertBuildOutput();
const installed = await installPackedWorkspace();
try {
  for (const executable of executables) {
    const entry = installed.entry(executable);
    const help = await run(executable, entry, "--help");
    if (help.code !== 0 || !help.stdout.startsWith(`Usage: ${executable}`) || help.stderr !== "") {
      throw new Error(`${executable} --help failed`);
    }

    const expectedVersion = await installed.version(executable);
    const version = await run(executable, entry, "--version");
    if (
      version.code !== 0 ||
      version.stdout.trim() !== `${executable} ${expectedVersion}` ||
      version.stderr !== ""
    ) {
      throw new Error(`${executable} --version failed`);
    }

    const usageError = await run(executable, entry, "--secret-token");
    const diagnostics = parseDiagnostics(usageError.stderr, executable);
    if (
      usageError.code !== 2 ||
      usageError.stdout !== "" ||
      usageError.stderr.includes("--secret-token") ||
      diagnostics.length !== 1 ||
      Object.keys(diagnostics[0] ?? {}).length !== 4 ||
      diagnostics[0]?.level !== "error" ||
      diagnostics[0]?.event !== "cli.usage" ||
      diagnostics[0]?.executable !== executable ||
      diagnostics[0]?.message !== "1 unsupported argument(s); use --help for usage"
    ) {
      throw new Error(`${executable} structured usage diagnostic failed`);
    }

    // The flag error itself is fixed text, so it is safe to surface verbatim.
    const flagError = await run(executable, entry, "--config=");
    const flagDiagnostics = parseDiagnostics(flagError.stderr, executable);
    if (
      flagError.code !== 2 ||
      flagDiagnostics[0]?.message !== "--config requires a non-empty path; use --help for usage"
    ) {
      throw new Error(`${executable} did not surface the --config error`);
    }

    console.log(`${executable}: installed --help, --version, and diagnostics passed`);
  }

  // Lifecycle + role-scoped view assertions. The packed tarball ships each
  // executable's role, so its startup.config diagnostic proves both that the
  // shared contract compiled through unchanged and that role scoping keeps
  // unrelated sections out of the emitted config.
  for (const executable of executables) {
    const lifecycle = await runLifecycle(
      executable,
      installed.entry(executable),
      executable !== "bdp",
    );
    const diagnostics = parseDiagnostics(lifecycle.stderr, executable);
    const started = diagnostics.some((entry) => entry.event === "lifecycle.started");
    const stopped = diagnostics.some((entry) => entry.event === "lifecycle.stopped");
    const cleanShutdown = lifecycle.code === 0 && stopped;
    if (lifecycle.stdout !== "" || !started || !cleanShutdown) {
      fail(executable, "lifecycle did not start and stop cleanly");
    }

    const startupConfig = startupConfigFor(diagnostics);
    if (startupConfig === undefined) fail(executable, "no startup.config diagnostic emitted");

    const emittedSections = Object.keys(startupConfig).sort();
    const expected = EXPECTED_SECTIONS[executable];
    if (JSON.stringify(emittedSections) !== JSON.stringify(expected)) {
      fail(
        executable,
        `startup.config sections were [${emittedSections.join(", ")}]; expected [${expected.join(", ")}]`,
      );
    }

    // server.advertisedProfile is deliberately unset by default so no server
    // silently claims a profile. bdpbd and bdptest share this same field on
    // purpose — admitReadServerProfile enforces the profile-guarantee rule
    // regardless of which adapter is behind it.
    if (executable === "bdptest" || executable === "bdpbd") {
      if (Object.hasOwn(startupConfig.server, "advertisedProfile")) {
        fail(executable, "server.advertisedProfile should be unset by default");
      }
    }
    if (executable === "bdptest" && Object.hasOwn(startupConfig.bdptest, "fixture")) {
      fail(executable, "bdptest.fixture should be unset by default");
    }

    if (executable === "bdptest" && Object.hasOwn(startupConfig.bdptest, "deploymentFile"))
      fail(executable, "bdptest.deploymentFile should be unset by default");

    console.log(`${executable}: installed clean lifecycle passed`);
  }

  // Non-default env mappings actually reach the resolved diagnostic through
  // the packed tarball. Both server executables read the same
  // server.advertisedProfile, and each server has its own additional
  // section-specific mapping.
  const bdptestMapped = await runLifecycle("bdptest", installed.entry("bdptest"), true, {
    BDP_SERVER_ADVERTISED_PROFILE: "read-update",
    BDP_BDPTEST_FIXTURE: "smoke-fixture",
    BDP_BDPTEST_DEPLOYMENT_FILE: path.join(
      installed.temporaryRoot,
      "must-not-open-deployment.json",
    ),
  });
  const bdptestConfig = startupConfigFor(parseDiagnostics(bdptestMapped.stderr, "bdptest"));
  if (
    bdptestConfig?.server?.advertisedProfile !== "read-update" ||
    bdptestConfig?.bdptest?.fixture !== "smoke-fixture" ||
    bdptestConfig?.bdptest?.deploymentFile !==
      path.join(installed.temporaryRoot, "must-not-open-deployment.json") ||
    bdptestMapped.code !== 0 ||
    parseDiagnostics(bdptestMapped.stderr, "bdptest").some(
      (entry) => entry.event === "server.started",
    )
  ) {
    fail("bdptest", "profile/fixture/deployment path did not round-trip without serving");
  }
  console.log(
    "bdptest: profile/fixture/deployment path round-trip without opening deployment or serving",
  );

  const bdpbdMapped = await runLifecycle("bdpbd", installed.entry("bdpbd"), true, {
    BDP_SERVER_ADVERTISED_PROFILE: "read-update",
    BDP_BD_EXECUTABLE: "/opt/bd/smoke",
  });
  const bdpbdConfig = startupConfigFor(parseDiagnostics(bdpbdMapped.stderr, "bdpbd"));
  if (
    bdpbdConfig?.server?.advertisedProfile !== "read-update" ||
    bdpbdConfig?.bd?.executable !== "/opt/bd/smoke"
  ) {
    fail("bdpbd", "BDP_SERVER_ADVERTISED_PROFILE / BDP_BD_EXECUTABLE did not round-trip");
  }
  console.log("bdpbd: server.advertisedProfile and bd.executable round-trip through tarball");

  const lifecycleConfig = path.join(installed.temporaryRoot, "lifecycle-config.json");
  await writeFile(
    lifecycleConfig,
    `${JSON.stringify({ server: { advertisedProfile: "read" } })}\n`,
  );
  for (const executable of ["bdptest", "bdpbd"]) {
    const lifecycle = await runLifecycleWithConfig(
      executable,
      installed.entry(executable),
      lifecycleConfig,
    );
    const diagnostics = parseDiagnostics(lifecycle.stderr, executable);
    if (
      lifecycle.code !== 0 ||
      lifecycle.stdout !== "" ||
      !diagnostics.some(
        (entry) =>
          entry.event === "lifecycle.started" &&
          entry.message === `${executable} lifecycle started`,
      ) ||
      diagnostics.some(
        (entry) => entry.event === "startup.profile_refused" || entry.event === "server.started",
      )
    ) {
      fail(executable, "--config without --serve did not remain in lifecycle mode");
    }
    console.log(`${executable}: --config alone remains lifecycle-only`);
  }
  // With shipping Read evidence recorded, a "read" profile admits and binds, so
  // proving that --config cannot bypass admission needs a profile admission
  // still refuses. The config-supplied value must reach admission and be
  // refused before any bind.
  const refusedServeConfig = path.join(installed.temporaryRoot, "refused-serve-config.json");
  await writeFile(
    refusedServeConfig,
    `${JSON.stringify({ server: { advertisedProfile: "read-update" } })}\n`,
  );
  for (const executable of ["bdptest", "bdpbd"]) {
    const refusal = await runServe(executable, installed.entry(executable), {}, [
      "--serve",
      "--config",
      refusedServeConfig,
    ]);
    const diagnostics = parseDiagnostics(refusal.stderr, executable);
    const finding = diagnostics.find((entry) => entry.event === "startup.profile_refused");
    if (
      refusal.code !== 2 ||
      refusal.stdout !== "" ||
      !finding?.message?.includes("cannot advertise the cumulative 'read-update' profile") ||
      diagnostics.some((entry) => entry.event === "server.started")
    ) {
      fail(executable, "--config combined with --serve did not fail closed before binding");
    }
    console.log(`${executable}: --serve --config remains fail-closed before bind`);
  }

  // Public server admission requires recorded Read evidence for the target.
  // Configuration records operator intent; it cannot manufacture
  // implementation capability. Cumulative profiles and an unset profile still
  // exit before listen; the Read token admits exactly when the installed
  // payload carries evidence, and the admitted path is then proved live below.
  for (const executable of ["bdptest", "bdpbd"]) {
    const refusedProfiles = [undefined, "read-update", "transactional"];
    if (!installed.hasReadConformanceEvidence(executable)) refusedProfiles.push("read");
    for (const advertisedProfile of refusedProfiles) {
      const env =
        advertisedProfile === undefined ? {} : { BDP_SERVER_ADVERTISED_PROFILE: advertisedProfile };
      const refusal = await runServe(executable, installed.entry(executable), env);
      const diagnostics = parseDiagnostics(refusal.stderr, executable);
      const finding = diagnostics.find((entry) => entry.event === "startup.profile_refused");
      const expectedMessage =
        advertisedProfile === undefined
          ? "must be explicitly configured"
          : advertisedProfile === "read"
            ? "until its cumulative black-box Read matrix passes"
            : `cannot advertise the cumulative '${advertisedProfile}' profile`;
      if (
        refusal.code !== 2 ||
        refusal.stdout !== "" ||
        finding?.level !== "error" ||
        finding?.executable !== executable ||
        !finding?.message?.includes(expectedMessage) ||
        diagnostics.some(
          (entry) => entry.event === "server.started" || entry.event === "server.stopped",
        )
      ) {
        fail(executable, `profile '${advertisedProfile ?? "unset"}' did not fail before bind`);
      }
    }
    if (installed.hasReadConformanceEvidence(executable)) {
      await runAdmittedReadSmoke(
        executable,
        installed.entry(executable),
        // An ephemeral port per run: a fixed number turns any colliding
        // listener on the host into a spurious smoke failure.
        await probeFreePort(),
        executable === "bdpbd" ? await provideBdWorkspace(installed.temporaryRoot) : undefined,
      );
      console.log(`${executable}: public Read admission serves discovery and stops cleanly`);
    }
    console.log(`${executable}: public profile admission fails closed before bind`);
  }

  const installedObservation = await observeInstalledReference(
    installed.installedReferenceEntry,
    installed.temporaryRoot,
  );
  console.log(JSON.stringify({ event: "installed.reference.observed", ...installedObservation }));

  // Role isolation: an invalid value in a section this role does not read
  // must not block startup. `--version` short-circuits before loadStartupConfig
  // and would therefore never exercise the configuration path — use the normal
  // bdp lifecycle so isolation is actually observed.
  const bdpIsolated = await runLifecycle("bdp", installed.entry("bdp"), false, {
    BDP_BDPTEST_FIXTURE: "bad name",
    BDP_SERVER_ADVERTISED_PROFILE: "not-a-profile",
  });
  if (bdpIsolated.code !== 0 || bdpIsolated.stdout !== "") {
    fail("bdp", "role isolation failed: unrelated invalid env variables blocked startup");
  }
  const bdpIsolatedDiagnostics = parseDiagnostics(bdpIsolated.stderr, "bdp");
  const bdpIsolatedConfig = startupConfigFor(bdpIsolatedDiagnostics);
  if (bdpIsolatedConfig === undefined) {
    fail("bdp", "role isolation lifecycle did not emit startup.config");
  }
  const bdpIsolatedSections = Object.keys(bdpIsolatedConfig).sort();
  if (JSON.stringify(bdpIsolatedSections) !== JSON.stringify(EXPECTED_SECTIONS.bdp)) {
    fail("bdp", "role isolation lifecycle emitted the wrong section set");
  }
  console.log("bdp: role isolation lifecycle ignores invalid bdptest/server values");
} finally {
  await rm(installed.temporaryRoot, { recursive: true, force: true });
}

/** Pure installed-loader witness; this guard owns the occupied intended port.
 * Success excludes acquisition of that configured listener. Source forbidden-call
 * instrumentation separately observes attempted startup calls. Store paths stay
 * absent. This is not installed service evidence. */
async function observePackedDeploymentLoader(deployment, temporaryRoot) {
  const guard = createServer();
  await new Promise((resolve, reject) => {
    guard.once("error", reject);
    guard.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = guard.address();
    if (address === null || typeof address === "string")
      throw new Error("missing owned loader witness port");
    const scope = "https://packed-deployment.test/s/",
      token = "packed_deployment_secret_01234567890123456789";
    const file = path.join(temporaryRoot, "pure-deployment.json");
    const descriptor = `${scope}types/item`,
      schema = `${scope}schemas/item`;
    const artifacts = {
      descriptors: [
        {
          retrievalUri: descriptor,
          utf8: JSON.stringify({
            id: descriptor,
            name: "Item",
            describes: "bead",
            conformsTo: [],
            propertiesSchema: schema,
          }),
        },
      ],
      schemas: [
        {
          retrievalUri: schema,
          utf8: JSON.stringify({
            $id: schema,
            type: "object",
            properties: { n: { type: "integer" } },
            additionalProperties: false,
          }),
        },
      ],
    };
    const inert = (value) => {
      if (typeof value === "function") throw new Error("packed deployment returned a capability");
      if (value !== null && typeof value === "object") {
        if (!Object.isFrozen(value)) throw new Error("packed deployment returned mutable data");
        for (const [key, child] of Object.entries(value)) {
          if (
            [
              "credentials",
              "token",
              "authenticate",
              "metadata",
              "readOptions",
              "projectedInput",
              "installed",
              "preflight",
            ].includes(key)
          )
            throw new Error("packed deployment exposes private state");
          inert(child);
        }
      }
    };
    for (const profile of ["read-update", "transactional"]) {
      const directory = path.join(temporaryRoot, `absent-${profile}-store`);
      const configuration =
        profile === "read-update"
          ? {
              directory,
              create: true,
              credentials: [{ token, principal: "writer" }],
              policies: { writer: { create: true, write: true, hidden: [], readOnly: [] } },
              contracts: { descriptors: [], schemas: [] },
              maximumEndpointMultiplicity: [],
            }
          : {
              directory,
              create: true,
              credentials: [{ token, principal: "writer", canMutate: true }],
              artifacts,
            };
      const input = {
        deploymentFile: file,
        scope: { url: scope },
        server: {
          host: "127.0.0.1",
          port: address.port,
          advertisedProfile: profile,
          limits: {
            page: {
              defaultItems: profile === "read-update" ? 20 : 2,
              maximumItems: profile === "read-update" ? 100 : 32,
            },
            selector: { bytes: 4096, depth: 32, nodes: 256 },
            cursorTtlMilliseconds: profile === "read-update" ? 60000 : 1000,
          },
        },
      };
      const body = { format: "bdptest-reference-deployment-1", profile, configuration };
      await writeFile(file, JSON.stringify(body));
      const result = await deployment.loadReferenceDeployment(input);
      inert(result);
      if (
        result.profile !== profile ||
        result.canonicalScope !== scope ||
        result.listener.port !== address.port ||
        JSON.stringify(result).includes(token)
      )
        throw new Error("packed deployment returned incorrect or secret-bearing summary");
      for (const candidate of [
        { ...body, profile: profile === "read-update" ? "transactional" : "read-update" },
        {
          ...body,
          configuration: {
            ...configuration,
            [profile === "read-update" ? "contracts" : "artifacts"]: {
              descriptors: [{ retrievalUri: descriptor, utf8: "packed_payload_sentinel" }],
              schemas: [],
            },
          },
        },
      ]) {
        await writeFile(file, JSON.stringify(candidate));
        let refused = false;
        try {
          await deployment.loadReferenceDeployment(input);
        } catch (error) {
          if (
            !(error instanceof deployment.ReferenceDeploymentError) ||
            error.code !== "contract" ||
            "cause" in error ||
            [token, "packed_payload_sentinel"].some((secret) =>
              `${error} ${JSON.stringify(error)}`.includes(secret),
            )
          )
            throw error;
          refused = true;
        }
        if (!refused) throw new Error("packed deployment accepted an invalid contract");
      }
      try {
        await realpath(directory);
        throw new Error("packed loader created a store directory");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!guard.listening || guard.address().port !== address.port)
        throw new Error("packed loader disturbed the owned witness listener");
    }
    console.log(
      "installed pure reference deployment loader: RU/TX, refusals and inert boundary passed",
    );
  } finally {
    await new Promise((resolve, reject) =>
      guard.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
