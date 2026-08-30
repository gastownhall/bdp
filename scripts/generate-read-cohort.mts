import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createBdpClientScenarioActionExecutor } from "@bdp/client/testing";
import {
  type ConformanceArtifactBundle,
  type ConformanceFixture,
  createConformanceArtifactBundle,
  createJsonSchemaValidator,
  createRawHttpScenarioTarget,
  createReadCohortArtifact,
  deriveReadCohortNotApplicableRows,
  deriveReadCohortRequiredScenarioIds,
  deriveReadCohortSelfCertifiableIds,
  type ExecutableScenario,
  READ_COHORT_TARGETS,
  type ReadCohortBindings,
  type ReadCohortTarget,
  type ReadCohortTargetInput,
  readCohortEvidenceConstant,
  runConformanceMatrix,
  serializeReadCohortArtifact,
} from "@bdp/conformance";
import {
  controlledReadAdvertisedLimitsCapability,
  controlledReadCapability,
  controlledReadProblemCapability,
  controlledReadScopeRestoreCapability,
  resolveBdExecutable,
  runBdWorkspaceCommand,
  seedBdWorkspace,
  startControlledTypeDescriptorPublisher,
} from "@bdp/conformance/testing";

/**
 * The packaged Read cohort generator.
 *
 * This is production evidence tooling, not a test: it launches the BUILT
 * packaged payloads (`apps/<app>/dist/main.js`) over real HTTP — admitted by
 * the shipping evidence record, never by a test grant — and drives the
 * packaged-provenance rows against each target. The self-certified rows come
 * from the reviewed in-process matrix suites themselves, re-run with their
 * emit hook so the in-process segments are exactly the runs the matrices
 * assert on. The assembled cohort artifact is written to its one committed
 * location; the evidence constant is printed and must replace the transient
 * bootstrap constant in packages/server/src/read-conformance-capability.ts
 * within the same commit as the artifact.
 *
 * Preconditions, all fail-closed: a clean git tree (the recorded run head must
 * describe the tree the runs observed), a full `pnpm build`, a pinned local bd
 * (the D4 baseline gate runs first), and the two matrix suites green.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const SCOPE = "https://scope.example/acme/";
const ARTIFACT_RELATIVE_PATH = "docs/design/evidence/read-cohort/read-v1.json";
const SERVER_START_TIMEOUT_MS = 15_000;
const SERVER_STOP_TIMEOUT_MS = 5_000;

/** Capabilities only an in-process controlled composition can honor. */
const IN_PROCESS_ONLY_CAPABILITIES = new Set<string>([
  controlledReadCapability,
  controlledReadAdvertisedLimitsCapability,
  controlledReadProblemCapability,
  controlledReadScopeRestoreCapability,
]);

const INTERNAL_FAULT_CAPABILITY = "unexpected-internal-fault";
const EXTERNAL_ENDPOINT_CAPABILITY = "controlled-read-external-endpoint-v1";

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const readRepoBytes = (relativePath: string): Uint8Array =>
  readFileSync(path.join(root, relativePath));

function git(args: readonly string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args[0]} failed (${String(result.status)}): ${result.stderr}`);
  return result.stdout;
}

function runNode(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runProgram(process.execPath, args, env);
}

function runProgram(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port probe did not bind");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

interface PackagedServer {
  readonly port: number;
  close(): Promise<void>;
}

/** Launch one packaged payload with --serve and wait for a live discovery read. */
async function startPackagedServer(
  entry: string,
  env: Readonly<Record<string, string>>,
  port: number,
): Promise<PackagedServer> {
  const child = spawn(process.execPath, [path.join(root, entry), "--serve"], {
    cwd: root,
    env: {
      // Hermetic by construction: only what the payload needs reaches it.
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      ...env,
      BDP_SERVER_HOST: "127.0.0.1",
      BDP_SERVER_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code));
  });

  const scopePath = new URL(SCOPE).pathname;
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null)
      throw new Error(`packaged server ${entry} exited before startup: ${stderr}`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`packaged server ${entry} did not become ready: ${stderr}`);
    }
    if (stderr.includes('"event":"server.started"')) {
      try {
        const probe = await fetch(`http://127.0.0.1:${port}${scopePath}bdp.json`, {
          signal: AbortSignal.timeout(500),
        });
        if (probe.ok) break;
      } catch {
        // Startup race; the deadline stays authoritative.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    port,
    close: async () => {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), SERVER_STOP_TIMEOUT_MS);
      const code = await exited;
      clearTimeout(timer);
      if (code !== 0)
        throw new Error(`packaged server ${entry} did not stop cleanly (${String(code)})`);
      if (!stderr.includes('"event":"server.stopped"'))
        throw new Error(`packaged server ${entry} emitted no server.stopped diagnostic`);
    },
  };
}

interface PackagedRunPlan {
  readonly target: ReadCohortTarget;
  readonly entry: string;
  readonly fixturePath: string;
  readonly baseEnv: Readonly<Record<string, string>>;
  /** Per-scenario overrides that exist only as launch-time configuration. */
  environmentFor(scenario: ExecutableScenario, faultResource: string): Record<string, string>;
}

async function runPackagedTarget(
  plan: PackagedRunPlan,
  bundle: ConformanceArtifactBundle,
  packagedRows: readonly string[],
) {
  const fixture = bundle.fixture as ConformanceFixture & {
    readonly typeDescriptors?: readonly Readonly<Record<string, unknown>>[];
    readonly bindings: Readonly<Record<string, string>>;
  };
  const faultResource = new URL(requireBinding(fixture, "bead.demo-a"), SCOPE).href;
  const schemaValidator = createJsonSchemaValidator(
    JSON.parse(new TextDecoder().decode(readRepoBytes("schemas/bdp-v0.schema.json"))) as Record<
      string,
      unknown
    >,
  );
  const descriptors = fixture.typeDescriptors;
  if (!Array.isArray(descriptors)) throw new Error("fixture Type Descriptors are required");
  const publisher = await startControlledTypeDescriptorPublisher(descriptors);
  const scenarioTarget = createRawHttpScenarioTarget(async (scenario) => {
    const fault = scenario.setup.requires.includes(INTERNAL_FAULT_CAPABILITY);
    const server = await startPackagedServer(
      plan.entry,
      plan.environmentFor(scenario, fault ? faultResource : ""),
      await freePort(),
    );
    const capabilities = fixture.capabilities.filter(
      (capability) =>
        !IN_PROCESS_ONLY_CAPABILITIES.has(capability) &&
        (capability !== INTERNAL_FAULT_CAPABILITY || fault),
    );
    return {
      capabilities,
      bindings: fixture.bindings,
      dialRoute: { transport: "plain" as const, host: "127.0.0.1", port: server.port },
      close: async () => server.close(),
    };
  });
  try {
    const clientActions = createBdpClientScenarioActionExecutor({
      fetchImplementation: scenarioTarget.fetch,
      externalTypeDescriptorFetchImplementation: publisher.fetch,
    });
    const result = await runConformanceMatrix({
      scope: SCOPE,
      profile: "read",
      seed: 0,
      artifactBundle: bundle,
      execute: scenarioTarget.execute,
      actionExecutor: clientActions,
      harness: scenarioTarget.harness,
      schemaValidator,
      scenarioSelection: packagedRows,
      declaredTargetLabel: `packaged-${plan.target}`,
    });
    const failures = result.scenarios.filter((scenario) => scenario.state !== "pass");
    if (failures.length > 0)
      throw new Error(
        `packaged ${plan.target} run did not pass: ${failures
          .map((scenario) => `${scenario.id}=${scenario.state}(${scenario.reason ?? ""})`)
          .join(", ")}`,
      );
    return result;
  } finally {
    try {
      await scenarioTarget.close();
    } finally {
      await publisher.close();
    }
  }
}

function requireBinding(fixture: { readonly bindings: Record<string, string> }, name: string) {
  const value = fixture.bindings[name];
  if (value === undefined) throw new Error(`fixture binding '${name}' is required`);
  return value;
}

function loadBundle(fixtureRelativePath: string): ConformanceArtifactBundle {
  return createConformanceArtifactBundle({
    catalog: {
      bytes: readRepoBytes("packages/conformance/catalog/read-v1.json"),
      label: "catalog/read-v1.json",
    },
    manifest: {
      bytes: readRepoBytes("packages/conformance/matrices/read-v1.json"),
      label: "matrices/read-v1.json",
    },
    fixture: { bytes: readRepoBytes(fixtureRelativePath), label: fixtureRelativePath },
  });
}

/**
 * Binding digest conventions. The verifier does not recompute these; they are
 * recorded provenance, and each names the exact committed byte source that
 * played the role, so a reviewer can re-derive every value from the run head.
 */
const BINDING_SOURCES = {
  schema: "schemas/bdp-v0.schema.json",
  validator: "packages/conformance/src/schema-validator.ts",
  runner: "packages/conformance/src/runner.ts",
  packagedHarness: "scripts/generate-read-cohort.mts",
} as const;

/** The executor role spans the fetch and raw-socket lanes; digest both, fixed order. */
function executorDigest(): string {
  return sha256(
    Buffer.concat([
      readRepoBytes("packages/conformance/src/http-executor.ts"),
      readRepoBytes("packages/conformance/src/raw-http-scenario-target.ts"),
    ]),
  );
}

function canonicalJsonDigest(value: unknown): string {
  return sha256(JSON.stringify(sortKeysDeep(value)));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

describe("packaged Read cohort generation", () => {
  it("generates the two-target cohort artifact from packaged and matrix runs", async () => {
    // 1. The tree must be clean: the recorded run head has to describe the
    // exact sources behind the built payloads and the runs.
    const status = git(["status", "--porcelain"]).trim();
    expect(status, "generate from a clean tree; commit or stash first").toBe("");
    const runHead = git(["rev-parse", "HEAD"]).trim();

    // Dist presence alone cannot prove the payloads were built from this head;
    // a stale build would seal evidence for binaries the recorded run head does
    // not describe. Rebuilding from the just-proven-clean tree makes the
    // launched payloads the head's by construction.
    const build = await runProgram("pnpm", ["build"]);
    expect(build.code, `pnpm build failed:\n${build.stderr}${build.stdout}`).toBe(0);
    for (const built of [
      "apps/bdptest/dist/main.js",
      "apps/bdpbd/dist/main.js",
      "packages/server/dist/read-conformance-capability.js",
    ])
      expect(existsSync(path.join(root, built)), `${built} missing after pnpm build`).toBe(true);

    // 2. D4 pre-cohort gate: the pinned bd baseline must verify locally.
    const baseline = await runNode(["scripts/bd-baseline.mjs", "verify"]);
    expect(baseline.code, `baseline:verify failed: ${baseline.stderr}${baseline.stdout}`).toBe(0);
    const pin = await runNode(["scripts/bd-baseline.mjs", "pin"]);
    expect(pin.code, `baseline:pin failed: ${pin.stderr}`).toBe(0);
    const pinned = JSON.parse(pin.stdout) as {
      version: string;
      schema_version: number;
      observations_digest: string;
    };
    const bdExecutable = await resolveBdExecutable("bd", process.env.PATH ?? "");
    const bdIdentity = {
      version: pinned.version,
      schemaVersion: pinned.schema_version,
      observationsDigest: pinned.observations_digest,
    };

    // 3. Row split, derived from the committed catalog and manifest.
    const referenceBundle = loadBundle("packages/conformance/fixtures/read-reference-v1.json");
    const bdBundle = loadBundle("packages/conformance/fixtures/read-bdpbd-v1.json");
    const requiredRows = deriveReadCohortRequiredScenarioIds(referenceBundle.catalog);
    const selfCertifiedRows = deriveReadCohortSelfCertifiableIds(
      referenceBundle.manifest,
      requiredRows,
    );
    const selfCertified = new Set(selfCertifiedRows);
    const packagedRows = requiredRows.filter((id) => !selfCertified.has(id));
    expect(packagedRows.length + selfCertifiedRows.length).toBe(requiredRows.length);

    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "bdp-read-cohort-"));
    try {
      // 4. The in-process self-certified segments are the reviewed matrix runs,
      // emitted verbatim by the suites themselves after their own assertions.
      const emitDirectory = path.join(temporaryRoot, "matrix-runs");
      await mkdir(emitDirectory);
      const vitestEntry = path.join(root, "node_modules", "vitest", "vitest.mjs");
      for (const suite of [
        "apps/bdptest/src/read-matrix.test.ts",
        "apps/bdpbd/src/read-matrix.test.ts",
      ]) {
        const matrix = await runNode([vitestEntry, "run", suite], {
          BDP_EMIT_MATRIX_RUN_DIR: emitDirectory,
          BDP_REQUIRE_BD_MATRIX: "1",
        });
        expect(matrix.code, `${suite} failed:\n${matrix.stdout}\n${matrix.stderr}`).toBe(0);
      }
      const inProcessRuns = Object.fromEntries(
        READ_COHORT_TARGETS.map((target) => [
          target,
          JSON.parse(readFileSync(path.join(emitDirectory, `${target}.json`), "utf8")),
        ]),
      );

      // 5. Isolated bd workspaces for the packaged bdpbd runs. The dedicated
      // external-endpoint workspace carries the accepted real-bd realization:
      // a native local-source/external-target related dependency.
      const home = path.join(temporaryRoot, "home");
      const mainWorkspace = path.join(temporaryRoot, "workspace");
      const externalWorkspace = path.join(temporaryRoot, "external-endpoint-workspace");
      await Promise.all([mkdir(home), mkdir(mainWorkspace), mkdir(externalWorkspace)]);
      const gitconfig = path.join(home, "gitconfig");
      await writeFile(
        gitconfig,
        "[user]\n\tname = bdp-conformance\n\temail = bdp-conformance@invalid\n",
      );
      const bdEnvironment = {
        PATH: process.env.PATH ?? "",
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        HOME: home,
        GIT_CONFIG_GLOBAL: gitconfig,
        GIT_CONFIG_SYSTEM: "/dev/null",
        BD_NON_INTERACTIVE: "1",
        CI: "true",
      };
      const bdFixture = bdBundle.fixture as ConformanceFixture & {
        readonly bd: {
          readonly actor: string;
          readonly prefix: string;
          readonly beads: readonly {
            id: string;
            title: string;
            type: string;
            priority: number;
            status: string;
          }[];
          readonly links: readonly { source: string; target: string; type: string }[];
        };
      };
      const seedController = new AbortController();
      await Promise.all([
        seedBdWorkspace(
          bdExecutable,
          mainWorkspace,
          bdEnvironment,
          bdFixture.bd,
          seedController.signal,
        ),
        seedBdWorkspace(
          bdExecutable,
          externalWorkspace,
          bdEnvironment,
          bdFixture.bd,
          seedController.signal,
        ),
      ]);
      await runBdWorkspaceCommand(
        bdExecutable,
        [
          "--actor",
          bdFixture.bd.actor,
          "dep",
          "add",
          "demo-f",
          "external:beads:mol-run-assignee",
          "--type",
          "related",
        ],
        externalWorkspace,
        bdEnvironment,
        { signal: seedController.signal },
      );

      // 6. Packaged runs: launch the built payload per scenario, admitted by
      // the shipping evidence record, and drive exactly the packaged rows.
      const plans: readonly PackagedRunPlan[] = [
        {
          target: "bdptest",
          entry: "apps/bdptest/dist/main.js",
          fixturePath: "packages/conformance/fixtures/read-reference-v1.json",
          baseEnv: { BDP_SCOPE_URL: SCOPE, BDP_SERVER_ADVERTISED_PROFILE: "read" },
          environmentFor(_scenario, faultResource) {
            return {
              ...this.baseEnv,
              ...(faultResource === ""
                ? {}
                : { BDP_SERVER_INTERNAL_FAULT_RESOURCE: faultResource }),
            };
          },
        },
        {
          target: "bdpbd",
          entry: "apps/bdpbd/dist/main.js",
          fixturePath: "packages/conformance/fixtures/read-bdpbd-v1.json",
          baseEnv: {
            ...bdEnvironment,
            BDP_SCOPE_URL: SCOPE,
            BDP_SERVER_ADVERTISED_PROFILE: "read",
            BDP_BD_EXECUTABLE: bdExecutable,
          },
          environmentFor(scenario, faultResource) {
            const external = scenario.setup.requires.includes(EXTERNAL_ENDPOINT_CAPABILITY);
            return {
              ...this.baseEnv,
              BDP_BD_WORKSPACE: external ? externalWorkspace : mainWorkspace,
              ...(faultResource === ""
                ? {}
                : { BDP_SERVER_INTERNAL_FAULT_RESOURCE: faultResource }),
            };
          },
        },
      ];
      const fixtureCapabilities = (bundle: { readonly fixture: unknown }): readonly string[] =>
        (bundle.fixture as { readonly capabilities?: readonly string[] }).capabilities ?? [];
      const notApplicableFor = (bundle: ConformanceArtifactBundle) =>
        deriveReadCohortNotApplicableRows(
          bundle.manifest,
          requiredRows,
          fixtureCapabilities(bundle),
        );
      const packagedRuns: Record<string, Awaited<ReturnType<typeof runPackagedTarget>>> = {};
      for (const plan of plans) {
        const bundle = plan.target === "bdptest" ? referenceBundle : bdBundle;
        const excluded = new Set(notApplicableFor(bundle).map(({ scenarioId }) => scenarioId));
        packagedRuns[plan.target] = await runPackagedTarget(
          plan,
          bundle,
          packagedRows.filter((id) => !excluded.has(id)),
        );
      }

      // 7. Assemble the cohort. Binding digests follow the documented
      // conventions above; catalog/manifest/fixture are the run-measured
      // values, cross-checked by createReadCohortArtifact itself.
      const shared = {
        schema: sha256(readRepoBytes(BINDING_SOURCES.schema)),
        validator: sha256(readRepoBytes(BINDING_SOURCES.validator)),
        runner: sha256(readRepoBytes(BINDING_SOURCES.runner)),
        executor: executorDigest(),
      };
      const packagedHarnessDigest = sha256(readRepoBytes(BINDING_SOURCES.packagedHarness));
      const matrixHarnessDigest = {
        bdptest: sha256(readRepoBytes("apps/bdptest/src/read-matrix.test.ts")),
        bdpbd: sha256(readRepoBytes("apps/bdpbd/src/read-matrix.test.ts")),
      };
      const bdExecutableDigest = sha256(readFileSync(bdExecutable));
      const targets: ReadCohortTargetInput[] = [];
      for (const plan of plans) {
        const bundle = plan.target === "bdptest" ? referenceBundle : bdBundle;
        const run = packagedRuns[plan.target];
        if (run === undefined) throw new Error(`missing packaged run for ${plan.target}`);
        const measured = run.artifacts;
        const packagedBindings: ReadCohortBindings = {
          catalog: measured.catalogDigest,
          manifest: measured.manifestDigest,
          fixture: measured.fixtureDigest,
          ...shared,
          harness: packagedHarnessDigest,
          installedPayload: sha256(readRepoBytes(plan.entry)),
          // The launch recipe minus the per-launch port; per-scenario variants
          // are named rather than hidden.
          targetProcess: canonicalJsonDigest({
            entry: plan.entry,
            argv: ["--serve"],
            environment: plan.baseEnv,
            perScenario: {
              internalFaultRows: bundle.manifest.scenarios
                .filter((scenario) => scenario.setup.requires.includes(INTERNAL_FAULT_CAPABILITY))
                .map(({ id }) => id),
              externalEndpointWorkspaceRows:
                plan.target === "bdpbd"
                  ? bundle.manifest.scenarios
                      .filter((scenario) =>
                        scenario.setup.requires.includes(EXTERNAL_ENDPOINT_CAPABILITY),
                      )
                      .map(({ id }) => id)
                  : [],
            },
          }),
          workspace:
            plan.target === "bdptest" ? measured.fixtureDigest : canonicalJsonDigest(bdFixture.bd),
          ...(plan.target === "bdpbd" ? { bdExecutable: bdExecutableDigest } : {}),
        };
        const targetExcluded = new Set(
          notApplicableFor(bundle).map(({ scenarioId }) => scenarioId),
        );
        targets.push({
          target: plan.target,
          run,
          bindings: packagedBindings,
          ...(plan.target === "bdpbd" ? { bdIdentity } : {}),
          admission: "packaged",
          rows: packagedRows.filter((id) => !targetExcluded.has(id)),
          capabilities: fixtureCapabilities(bundle),
        });
        const inProcess = inProcessRuns[plan.target];
        const inProcessBindings: ReadCohortBindings = {
          catalog: inProcess.artifacts.catalogDigest,
          manifest: inProcess.artifacts.manifestDigest,
          fixture: inProcess.artifacts.fixtureDigest,
          ...shared,
          harness: matrixHarnessDigest[plan.target],
          ...(plan.target === "bdpbd" ? { bdExecutable: bdExecutableDigest } : {}),
        };
        targets.push({
          target: plan.target,
          run: inProcess,
          bindings: inProcessBindings,
          ...(plan.target === "bdpbd" ? { bdIdentity } : {}),
          admission: "in-process",
          rows: selfCertifiedRows.filter((id) => !targetExcluded.has(id)),
          capabilities: fixtureCapabilities(bundle),
        });
      }

      const artifact = createReadCohortArtifact({
        catalog: referenceBundle.catalog,
        manifest: referenceBundle.manifest,
        runHead,
        // D2: the deliberately uncovered optional variants, declared rather
        // than left implicit. Each is documented as deferred in
        // packages/conformance/matrices/README.md.
        uncovered: [
          {
            scenarioId: "read.discovery.optional-limits",
            variant: "absent-optional-limits",
            reason:
              "setup forces advertised limits into existence; a target advertising no limits is unexercised",
          },
          {
            scenarioId: "read.http.cache-cors",
            variant: "cors-enabled",
            reason: "the CORS-enabled positive branch is a deferred optional-capability variant",
          },
          {
            scenarioId: "read.http.method-405",
            variant: "cors-enabled-options",
            reason: "an OPTIONS requirement applies only when a CORS-enabled deployment exists",
          },
        ],
        targets,
      });
      // The runs took minutes; re-prove the tree still is what the recorded run
      // head says it is before sealing evidence over it. A mid-run edit would
      // have been observed by the source-aliased matrix suites while the
      // artifact recorded the pre-edit head.
      const finalStatus = git(["status", "--porcelain"]).trim();
      expect(finalStatus, "the tree changed during generation; regenerate from a clean tree").toBe(
        "",
      );
      expect(git(["rev-parse", "HEAD"]).trim(), "HEAD moved during generation").toBe(runHead);

      const bytes = serializeReadCohortArtifact(artifact);
      const artifactPath = path.join(root, ARTIFACT_RELATIVE_PATH);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, bytes);
      const constant = readCohortEvidenceConstant(bytes);

      process.stdout.write(
        `${JSON.stringify(
          {
            event: "cohort.generated",
            artifact: ARTIFACT_RELATIVE_PATH,
            runHead,
            constant,
            packagedRows: packagedRows.length,
            selfCertifiedRows: selfCertifiedRows.length,
            next: [
              `record '${constant}' for both targets in packages/server/src/read-conformance-capability.ts`,
              "rebuild, run every gate, and commit the artifact and constant together — nothing else in that commit",
            ],
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
