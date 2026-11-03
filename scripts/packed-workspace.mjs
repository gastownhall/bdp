/** Shared actual tarball custody/installation; callers own their observations. */
import { createRequire } from "node:module";
import { assertServerExports } from "./smoke-safety.mjs";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cleanupFailures = new WeakSet();

/** Preserve both an operation failure and a later cleanup failure. */
async function cleanAfter(operation, cleanup) {
  let value,
    failure,
    failed = false;
  try {
    value = await operation();
  } catch (error) {
    failure = error;
    failed = true;
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    const error = failed
      ? new AggregateError([failure, cleanupError], "Operation and cleanup failed", {
          cause: failure,
        })
      : cleanupError;
    cleanupFailures.add(error);
    throw error;
  }
  if (failed) throw failure;
  return value;
}

/** One actual child group, its asynchronous observer and their complete settlement. */
export async function withPackedChild(
  signal,
  command,
  args,
  options,
  observe = (record) => record.result,
) {
  signal.throwIfAborted();
  const active = new AbortController();
  const childSignal = AbortSignal.any([signal, active.signal]);
  const record = spawnChild(command, args, options);
  void record.result.catch((error) => active.abort(error));
  console.log(JSON.stringify({ event: "packed-child.started", pid: record.child.pid, command }));
  let interrupt, observing;
  const aborted = new Promise((_, reject) => {
    interrupt = () => {
      reject(signal.reason);
      void terminateChild(record).catch(() => undefined);
    };
  });
  signal.addEventListener("abort", interrupt, { once: true });
  if (signal.aborted) interrupt();
  return cleanAfter(
    async () => {
      observing = Promise.resolve().then(() => observe(record, childSignal));
      const result = await Promise.race([observing, aborted]);
      signal.throwIfAborted();
      return result;
    },
    async () => {
      signal.removeEventListener("abort", interrupt);
      active.abort(new Error("Packed child observation settled"));
      // An aborted fetch/observer must settle too: no work outlives its installation.
      await cleanAfter(
        () => terminateChild(record),
        () => observing?.catch(() => undefined),
      );
      console.log(JSON.stringify({ event: "packed-child.terminated", pid: record.child.pid }));
    },
  );
}

async function spawnWithOutput(command, args, cwd, signal) {
  return withPackedChild(
    signal,
    command,
    args,
    {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: 30_000,
    },
    async (record) => {
      const { code, signal: childSignal, stdout, stderr } = await record.result;
      if (code !== 0 || childSignal !== null)
        throw new Error(`${command} exited ${code ?? childSignal}: ${stderr || stdout}`);
      return { stdout, stderr };
    },
  );
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

async function installPackedWorkspace(signal) {
  signal.throwIfAborted();
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry) throw new Error("pnpm did not provide npm_execpath");

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "bdp-smoke-"));
  const packRoot = path.join(temporaryRoot, "packs");
  const installRoot = path.join(temporaryRoot, "install");
  try {
    await mkdir(packRoot);
    await spawnWithOutput(
      process.execPath,
      [
        pnpmEntry,
        "--filter",
        "./packages/**",
        "--filter",
        "./apps/**",
        "-r",
        "pack",
        "--pack-destination",
        packRoot,
      ],
      workspaceRoot,
      signal,
    );

    const tarballs = (await readdir(packRoot))
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => path.join(packRoot, entry));
    await mkdir(installRoot);
    await writeFile(path.join(installRoot, "package.json"), '{"private":true}\n');
    await spawnWithOutput(
      "npm",
      [
        "install",
        "--prefix",
        installRoot,
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        ...tarballs,
      ],
      workspaceRoot,
      signal,
    );

    const installedServerRoot = path.join(installRoot, "node_modules", "@bdp", "server");
    const installedServerOutput = await readdir(path.join(installedServerRoot, "dist"));
    // Intentional package-surface tripwire: adding or removing a shipped server
    // module is a deliberate reviewed change, not an incidental build artifact.
    const expectedServerOutput = new Set([
      "reference.js",
      "reference.js.map",
      "reference.d.ts",
      "reference.d.ts.map",
      "retained-v01",
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
    const retainedOutput = await readdir(path.join(installedServerRoot, "dist", "retained-v01"));
    const retainedModules = [
      "alias-contract",
      "alias-witness",
      "batch-contract",
      "batch-evaluate",
      "batch-recovery",
      "collections",
      "contract",
      "events",
      "http",
      "link-contract",
      "object-edits",
      "recovery",
      "reference-comparison",
      "reference-input",
      "store",
    ];
    const expectedRetained = retainedModules.flatMap((name) =>
      [".js", ".js.map", ".d.ts", ".d.ts.map"].map((suffix) => name + suffix),
    );
    if (
      retainedOutput.length !== expectedRetained.length ||
      retainedOutput.some((name) => !expectedRetained.includes(name))
    )
      throw new Error(
        "packed canonical reference implementation differs from its closed reviewed module set",
      );
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
      "@bdp/server/retained-v01/http",
      "@bdp/server/dist/retained-v01/http.js",
      "@bdp/server/retained-v01/store",
      "@bdp/server/dist/retained-v01/store.js",
      "@bdp/conformance/transactional-observation",
      "@bdp/conformance/dist/transactional-observation.js",
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
      installRoot,
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
    return cleanAfter(
      () => {
        throw error;
      },
      () => rm(temporaryRoot, { recursive: true, force: true }),
    );
  }
}

/** Own signals, subprocess lifetime and installation cleanup through observation. */
export async function withPackedWorkspace(observe) {
  const lifetime = new AbortController();
  let cleanupFailed = false;
  const interrupt = (name) => {
    if (lifetime.signal.aborted) return;
    const exitCode = name === "SIGINT" ? 130 : 143;
    process.exitCode = exitCode;
    // Rejected top-level await otherwise overwrites exitCode with1. Preserve the
    // interrupt status without exiting before asynchronous owned cleanup finishes.
    process.once("exit", () => {
      process.exitCode = cleanupFailed ? 1 : exitCode;
    });
    lifetime.abort(new Error(`Packed workspace interrupted by ${name}`));
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    await assertBuildOutput();
    lifetime.signal.throwIfAborted();
    const installed = await installPackedWorkspace(lifetime.signal);
    console.log(
      JSON.stringify({
        event: "packed-workspace.installed",
        temporaryRoot: installed.temporaryRoot,
      }),
    );
    const result = await cleanAfter(
      async () => {
        lifetime.signal.throwIfAborted();
        const result = await observe(installed, lifetime.signal);
        lifetime.signal.throwIfAborted();
        return result;
      },
      async () => {
        await rm(installed.temporaryRoot, { recursive: true, force: true });
        console.log(
          JSON.stringify({
            event: "packed-workspace.removed",
            temporaryRoot: installed.temporaryRoot,
          }),
        );
      },
    );
    lifetime.signal.throwIfAborted();
    return result;
  } catch (error) {
    cleanupFailed = cleanupFailures.has(error);
    if (cleanupFailed) process.exitCode = 1;
    throw error;
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
}
