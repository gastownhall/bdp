import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
      "index.d.ts",
      "index.d.ts.map",
      "index.js",
      "index.js.map",
      "read-conformance-capability.d.ts",
      "read-conformance-capability.d.ts.map",
      "read-conformance-capability.js",
      "read-conformance-capability.js.map",
      "read-pagination.d.ts",
      "read-pagination.d.ts.map",
      "read-pagination.js",
      "read-pagination.js.map",
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
    if (JSON.stringify(installedServerManifest.exports ?? {}).includes("test-support"))
      throw new Error("packed server must not export test-support files");

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
    if (path.resolve(supplied) === workspaceRoot)
      throw new Error("BDP_E2E_BD_WORKSPACE must not be the repository working tree");
    return supplied;
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

    console.log(`${executable}: installed clean lifecycle passed`);
  }

  // Non-default env mappings actually reach the resolved diagnostic through
  // the packed tarball. Both server executables read the same
  // server.advertisedProfile, and each server has its own additional
  // section-specific mapping.
  const bdptestMapped = await runLifecycle("bdptest", installed.entry("bdptest"), true, {
    BDP_SERVER_ADVERTISED_PROFILE: "read-update",
    BDP_BDPTEST_FIXTURE: "smoke-fixture",
  });
  const bdptestConfig = startupConfigFor(parseDiagnostics(bdptestMapped.stderr, "bdptest"));
  if (
    bdptestConfig?.server?.advertisedProfile !== "read-update" ||
    bdptestConfig?.bdptest?.fixture !== "smoke-fixture"
  ) {
    fail("bdptest", "BDP_SERVER_ADVERTISED_PROFILE / BDP_BDPTEST_FIXTURE did not round-trip");
  }
  console.log("bdptest: server.advertisedProfile and bdptest.fixture round-trip through tarball");

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
