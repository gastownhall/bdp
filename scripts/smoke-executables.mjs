import { withPackedWorkspace, withPackedChild } from "./packed-workspace.mjs";
import { observeCanonicalReference } from "./canonical-reference-observation.mjs";
import { observeInstalledReference } from "./installed-reference-observation.mjs";
import { isolatedWorkspace } from "./smoke-safety.mjs";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executables = ["bdp", "bdptest", "bdpbd"];
const legacyOnly = process.argv.length === 3 && process.argv[2] === "--legacy";
if (process.argv.length !== 2 && !legacyOnly)
  throw new Error("Usage: smoke-executables.mjs [--legacy]");

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

function run(signal, _executable, entry, argument, extraEnv = {}) {
  return withPackedChild(signal, entry, [argument], {
    cwd: workspaceRoot,
    env: { ...hermeticEnv, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: 5_000,
  });
}

function runWithoutArguments(signal, entry, extraEnv = {}) {
  return withPackedChild(signal, entry, [], {
    cwd: workspaceRoot,
    env: { ...hermeticEnv, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: 5_000,
  });
}

function lifecycle(signal, entry, args, shutdown, extraEnv = {}) {
  let stderr = "",
    sent = false,
    child;
  return withPackedChild(
    signal,
    entry,
    args,
    {
      cwd: workspaceRoot,
      env: { ...hermeticEnv, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: 5_000,
      onStderr(chunk) {
        stderr += chunk;
        if (shutdown && !sent && stderr.includes('"event":"lifecycle.started"')) {
          sent = true;
          child.kill("SIGTERM");
        }
      },
    },
    (record) => {
      child = record.child;
      return record.result;
    },
  );
}
function runLifecycle(signal, _executable, entry, sendShutdownSignal, extraEnv = {}) {
  return lifecycle(signal, entry, [], sendShutdownSignal, extraEnv);
}
function runLifecycleWithConfig(signal, _executable, entry, configFile) {
  return lifecycle(signal, entry, ["--config", configFile], true);
}
function runServe(signal, _executable, entry, extraEnv = {}, args = ["--serve"]) {
  return withPackedChild(signal, entry, args, {
    cwd: workspaceRoot,
    env: { ...hermeticEnv, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: 5_000,
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

async function fetchWithRetry(url, signal, attempts = 20, delayMs = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    signal.throwIfAborted();
    try {
      return await fetch(url, { signal });
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      await new Promise((settle) => setTimeout(settle, delayMs));
    }
  }
  throw lastError ?? new Error(`no response from ${url}`);
}

function runAdmittedReadSmoke(signal, executable, entry, port, workspace) {
  let stderr = "",
    resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  return withPackedChild(
    signal,
    entry,
    ["--serve"],
    {
      cwd: workspaceRoot,
      env: {
        ...hermeticEnv,
        BDP_SERVER_ADVERTISED_PROFILE: "read",
        BDP_SERVER_PORT: String(port),
        BDP_SCOPE_URL: "https://public.example/local-test/",
        ...(executable === "bdpbd" ? { BDP_BD_WORKSPACE: workspace } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: 5_000,
      onStderr(chunk) {
        stderr += chunk;
        if (stderr.includes('"event":"server.started"')) resolveStarted();
      },
    },
    async (record, childSignal) => {
      // A failed/closed child also settles readiness; cleanup then aborts any probe.
      await Promise.race([
        started,
        record.result.then(() => {
          throw new Error(`${executable} admitted Read smoke exited before ready`);
        }),
      ]);
      const response = await fetchWithRetry(
        `http://127.0.0.1:${port}/local-test/bdp.json`,
        childSignal,
      );
      const discovery = await response.json();
      if (
        response.status !== 200 ||
        discovery.profile !== "read" ||
        discovery.scope !== "https://public.example/local-test/"
      )
        throw new Error(`${executable} admitted Read discovery was not a Read document`);
      record.child.kill("SIGTERM");
      const result = await record.result;
      if (result.code !== 0 || !stderr.includes('"event":"server.stopped"'))
        throw new Error(`${executable} admitted Read smoke did not stop cleanly`);
      return { code: result.code, stderr };
    },
  );
}

function fail(executable, reason) {
  // The startup.config diagnostic can carry credentials in `auth.token`, so
  // failures name the failing check rather than dumping the full config.
  throw new Error(`${executable} smoke failure: ${reason}`);
}

function startupConfigFor(diagnostics) {
  return diagnostics.find((entry) => entry.event === "startup.config")?.config;
}

await withPackedWorkspace(async (installed, signal) => {
  signal.throwIfAborted();
  for (const executable of executables) {
    signal.throwIfAborted();
    const entry = installed.entry(executable);
    const help = await run(signal, executable, entry, "--help");
    if (help.code !== 0 || !help.stdout.startsWith(`Usage: ${executable}`) || help.stderr !== "") {
      throw new Error(`${executable} --help failed`);
    }

    const expectedVersion = await installed.version(executable);
    const version = await run(signal, executable, entry, "--version");
    if (
      version.code !== 0 ||
      version.stdout.trim() !== `${executable} ${expectedVersion}` ||
      version.stderr !== ""
    ) {
      throw new Error(`${executable} --version failed`);
    }

    const usageError = await run(signal, executable, entry, "--secret-token");
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
    const flagError = await run(signal, executable, entry, "--config=");
    const flagDiagnostics = parseDiagnostics(flagError.stderr, executable);
    if (
      flagError.code !== 2 ||
      flagDiagnostics[0]?.message !== "--config requires a non-empty path; use --help for usage"
    ) {
      throw new Error(`${executable} did not surface the --config error`);
    }

    console.log(`${executable}: installed --help, --version, and diagnostics passed`);
  }

  // The canonical client is interactive at its entry point; server executables
  // retain lifecycle mode. The packed tarball ships each server's role, so its
  // startup.config diagnostic proves role scoping keeps unrelated sections out.
  signal.throwIfAborted();
  const noArguments = await runWithoutArguments(signal, installed.entry("bdp"), {
    XDG_CONFIG_HOME: path.join(installed.temporaryRoot, "no-default-scope"),
  });
  if (
    noArguments.code !== 0 ||
    !noArguments.stdout.startsWith("Usage: bdp ") ||
    !noArguments.stdout.includes("Default Scope: not configured") ||
    noArguments.stderr !== ""
  ) {
    fail("bdp", "no-argument invocation did not show help and the unset default Scope");
  }
  console.log("bdp: no-argument help and unset default Scope passed");

  for (const executable of ["bdptest", "bdpbd"]) {
    const lifecycle = await runLifecycle(
      signal,
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
  const bdptestMapped = await runLifecycle(signal, "bdptest", installed.entry("bdptest"), true, {
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

  const bdpbdMapped = await runLifecycle(signal, "bdpbd", installed.entry("bdpbd"), true, {
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
  signal.throwIfAborted();
  for (const executable of ["bdptest", "bdpbd"]) {
    const lifecycle = await runLifecycleWithConfig(
      signal,
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
  signal.throwIfAborted();
  for (const executable of ["bdptest", "bdpbd"]) {
    const refusal = await runServe(signal, executable, installed.entry(executable), {}, [
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
  signal.throwIfAborted();
  for (const executable of ["bdptest", "bdpbd"]) {
    const refusedProfiles = [undefined, "read-update", "transactional"];
    if (!installed.hasReadConformanceEvidence(executable)) refusedProfiles.push("read");
    for (const advertisedProfile of refusedProfiles) {
      const env =
        advertisedProfile === undefined ? {} : { BDP_SERVER_ADVERTISED_PROFILE: advertisedProfile };
      const refusal = await runServe(signal, executable, installed.entry(executable), env);
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
        signal,
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

  if (!legacyOnly) {
    signal.throwIfAborted();
    const canonicalObservation = await observeCanonicalReference(
      installed.installRoot,
      installed.temporaryRoot,
    );
    signal.throwIfAborted();
    console.log(
      JSON.stringify({ event: "installed.canonical-reference.observed", ...canonicalObservation }),
    );
  }

  signal.throwIfAborted();
  const installedObservation = await observeInstalledReference(
    installed.installedReferenceEntry,
    installed.temporaryRoot,
  );
  signal.throwIfAborted();
  console.log(JSON.stringify({ event: "installed.reference.observed", ...installedObservation }));

  // Role isolation: an invalid value in a section the client does not read must
  // not block its no-argument help and default-Scope display.
  const bdpIsolated = await runWithoutArguments(signal, installed.entry("bdp"), {
    XDG_CONFIG_HOME: path.join(installed.temporaryRoot, "isolated-client-config"),
    BDP_BDPTEST_FIXTURE: "bad name",
    BDP_SERVER_ADVERTISED_PROFILE: "not-a-profile",
  });
  if (
    bdpIsolated.code !== 0 ||
    !bdpIsolated.stdout.startsWith("Usage: bdp ") ||
    !bdpIsolated.stdout.includes("Default Scope: not configured") ||
    bdpIsolated.stderr !== ""
  ) {
    fail("bdp", "role isolation failed: unrelated invalid env variables blocked startup");
  }
  console.log("bdp: no-argument help ignores invalid bdptest/server values");
});
