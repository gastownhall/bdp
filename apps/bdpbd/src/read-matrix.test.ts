import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createBdProcessScopePort } from "@bdp/adapter-bd";
import { BLOCKING_LINK_TYPE_ID, readyBeadsFromClient, readyBeadsFromRecords } from "@bdp/bd-domain";
import { BdpClient, createFetchTransport } from "@bdp/client";
import { createBdpClientScenarioActionExecutor } from "@bdp/client/testing";
import { DEFAULT_SERVER_READ_LIMITS, type ServerReadLimitsConfig } from "@bdp/config";
import {
  type ConformanceArtifactBundle,
  type ConformanceFixture,
  createConformanceArtifactBundle,
  createJsonSchemaValidator,
  createRawHttpScenarioTarget,
  type JsonValue,
  runConformanceMatrix,
} from "@bdp/conformance";
import {
  type ControlledReadActionSession,
  controlledReadAdvertisedLimitsCapability,
  controlledReadCapability,
  controlledReadEpochHeader,
  controlledReadExternalEndpointCapability,
  controlledReadExternalTypePublisherCapability,
  controlledReadProblemCapability,
  controlledReadScopeRestoreCapability,
  controlledReadUnauthenticatedChallenge,
  controlledReadViewHeader,
  createControlledReadActionExecutor,
  emitMatrixRunForCohort,
  resolveBdExecutable as resolveExecutable,
  runBdWorkspaceCommand as runCommand,
  seedBdWorkspace,
  startControlledTypeDescriptorPublisher,
} from "@bdp/conformance/testing";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createPublicReadControls,
  createReadServer,
  listenNodeHttpServer,
  type ServerAdvertisedReadLimits,
  type ServerReadControls,
} from "@bdp/server";
import {
  createControlledReadSessionForTesting,
  createReadProblemTablePortForTesting,
  createReadResourceFaultPortForTesting,
  establishReadConformanceEvidenceForTesting,
} from "@bdp/server/testing";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string =>
  readFileSync(path.join(root, relativePath), "utf8");
const readBytes = (relativePath: string): Uint8Array => readFileSync(path.join(root, relativePath));
const scope = "https://scope.example/acme/";
const commandTimeoutMs = 10_000;
const commandMaxOutputBytes = 1_048_576;
const bdLinkLocalId = (source: string, target: string, type: string): string => {
  const opaque = (value: string): string =>
    `b64_${Buffer.from(value, "utf8").toString("base64url")}`;
  return `links/${opaque(source)}/${opaque(target)}/${opaque(type)}`;
};

interface FixtureOracles {
  readonly [key: string]: JsonValue;
  readonly resources: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly collections: {
    readonly "bead-titles": readonly string[];
    readonly "link-records": readonly (readonly JsonValue[])[];
    readonly "type-ids": readonly string[];
  };
  readonly "structural-predicates": Readonly<Record<string, readonly string[]>>;
  readonly "incident-links": Readonly<Record<string, readonly string[]>>;
}

interface BdFixture extends ConformanceFixture {
  readonly realization: "bdpbd";
  readonly bd: {
    readonly acceptedBuildIdentities: readonly {
      readonly provenance: "homebrew-local" | "source-build-hosted-ci";
      readonly versionJson: Readonly<Record<string, JsonValue>>;
      readonly versionText: string;
    }[];
    readonly actor: string;
    readonly prefix: string;
    readonly beads: readonly {
      readonly id: string;
      readonly title: string;
      readonly type: string;
      readonly priority: number;
      readonly status: "open" | "closed" | "deferred";
      readonly created_at: string;
    }[];
    readonly links: readonly {
      readonly source: string;
      readonly target: string;
      readonly type: string;
    }[];
  };
  readonly typeDescriptors: readonly Readonly<Record<string, JsonValue>>[];
  readonly expectations: {
    readonly readyTitles: readonly string[];
    readonly beadCount: number;
    readonly linkCount: number;
    readonly typeCount: number;
  };
  readonly oracles: FixtureOracles;
}

interface ReferenceFixture extends ConformanceFixture {
  readonly realization: "bdptest";
  readonly beads: readonly {
    readonly localId: string;
    readonly type: string;
    readonly revision: string;
    readonly properties: Readonly<Record<string, JsonValue>> & {
      readonly title: string;
      readonly status: string;
      readonly priority: number;
      readonly created_at: string;
    };
  }[];
  readonly links: readonly {
    readonly localId: string;
    readonly type: string;
    readonly revision: string;
    readonly source: string;
    readonly target: string;
    readonly properties: Readonly<Record<string, JsonValue>>;
  }[];
  readonly typeDescriptors: readonly {
    readonly id: string;
    readonly describes: "bead" | "link";
  }[];
  readonly expectations: {
    readonly readyTitles: readonly string[];
    readonly beadCount: number;
    readonly linkCount: number;
    readonly typeCount: number;
  };
  readonly oracles: FixtureOracles;
}

// Hosted CI supplies an exact source-built bd 1.0.5 executable and makes this
// lane mandatory. Local verification exercises an installed pinned binary by default.
const configuredBdExecutable = normalizeMatrixExecutableOverride(
  process.env.BDP_BD_MATRIX_EXECUTABLE,
);
const implicitLocalBdExecutable = isCiEnvironment(process.env.CI)
  ? undefined
  : findExecutable("bd", process.env.PATH ?? "");
const runRealBdMatrix =
  configuredBdExecutable !== undefined || implicitLocalBdExecutable !== undefined;
const requireRealBdMatrix = process.env.BDP_REQUIRE_BD_MATRIX === "1";

describe("bdpbd Read realization", () => {
  it("honors the required real-bd matrix gate", () => {
    expect(requireRealBdMatrix && !runRealBdMatrix).toBe(false);
  });

  it("accepts only the two coherent checked-in bd 1.0.5 build identities", () => {
    const fixture = createReadArtifactBundle("packages/conformance/fixtures/read-bdpbd-v1.json")
      .fixture as BdFixture;
    const identities = fixture.bd.acceptedBuildIdentities;
    expect(identities).toEqual([
      {
        provenance: "homebrew-local",
        versionJson: {
          branch: "v1.0.5",
          build: "Homebrew",
          schema_version: 1,
          version: "1.0.5",
        },
        versionText: "bd version 1.0.5 (Homebrew)",
      },
      {
        provenance: "source-build-hosted-ci",
        versionJson: {
          build: "dev",
          schema_version: 1,
          version: "1.0.5",
        },
        versionText: "bd version 1.0.5 (dev)",
      },
    ]);
    for (const identity of identities) {
      expect(() =>
        assertAcceptedBdIdentity(
          identity.versionJson,
          identity.versionText,
          identities,
          identity.provenance,
        ),
      ).not.toThrow();
    }
    expect(() =>
      assertAcceptedBdIdentity(
        identities[0]?.versionJson,
        identities[1]?.versionText ?? "",
        identities,
        "mixed tuple",
      ),
    ).toThrow("bd executable identity is not an accepted checked-in build");
    expect(() =>
      assertAcceptedBdIdentity(
        { branch: "v1.0.5", build: "unknown", schema_version: 1, version: "1.0.5" },
        "bd version 1.0.5 (unknown)",
        identities,
        "unknown tuple",
      ),
    ).toThrow("bd executable identity is not an accepted checked-in build");
  });

  it("treats a blank executable override as unset and rejects executable directories", async () => {
    expect(normalizeMatrixExecutableOverride("  ")).toBeUndefined();
    expect(isCiEnvironment("1")).toBe(true);
    expect(isCiEnvironment("true")).toBe(true);
    expect(isCiEnvironment("false")).toBe(false);
    expect(executableCandidates("bd", "")).toEqual([]);
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-bdpbd-executable-directory-"));
    try {
      await expect(resolveExecutable(directory, "")).rejects.toThrow(
        "pinned bd executable was not found on PATH",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("bounds and cancels the matrix command helper with hostile children", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-bdpbd-command-helper-"));
    const executable = path.join(directory, "hostile-command");
    try {
      await writeFile(
        executable,
        `#!/usr/bin/env node
process.on("SIGTERM", () => {});
if (process.argv[2] === "overflow") {
  process.stdout.write("[]");
  process.stderr.write("x".repeat(1024));
}
setTimeout(() => process.exit(0), 1500);
`,
      );
      await chmod(executable, 0o755);

      await expect(
        runCommand(
          executable,
          ["overflow"],
          directory,
          { PATH: process.env.PATH ?? "" },
          {
            signal: new AbortController().signal,
            timeoutMs: 5_000,
            maxOutputBytes: 64,
          },
        ),
      ).rejects.toThrow("bd command exceeded its output bound");

      const controller = new AbortController();
      const operation = runCommand(
        executable,
        ["slow"],
        directory,
        { PATH: process.env.PATH ?? "" },
        {
          signal: controller.signal,
          timeoutMs: 5_000,
          maxOutputBytes: 64,
        },
      );
      controller.abort(new Error("cancel matrix command"));
      await expect(operation).rejects.toThrow("cancel matrix command");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reconstructs restore evidence in an independent workspace copy", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-bdpbd-restored-workspace-"));
    const source = path.join(directory, "source");
    const restored = path.join(directory, "restored");
    const statePath = path.join(".beads", "state.json");
    try {
      await mkdir(path.join(source, ".beads"), { recursive: true });
      await writeFile(path.join(source, statePath), '{"generation":"seeded"}\n');

      await reconstructRestoredWorkspace(source, restored);
      expect(await realpath(restored)).not.toBe(await realpath(source));
      expect(await readFile(path.join(restored, statePath), "utf8")).toBe(
        '{"generation":"seeded"}\n',
      );

      await writeFile(path.join(source, statePath), '{"generation":"mutated-source"}\n');
      expect(await readFile(path.join(restored, statePath), "utf8")).toBe(
        '{"generation":"seeded"}\n',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("proves the checked-in target realizations have equivalent readiness semantics", () => {
    expectLogicalReadinessEquivalence(
      createReadArtifactBundle("packages/conformance/fixtures/read-reference-v1.json"),
      createReadArtifactBundle("packages/conformance/fixtures/read-bdpbd-v1.json"),
    );
  });

  it.each([
    ["Link ID", 0, "links/corrupt"],
    ["Link Type ID", 1, "types/corrupt"],
    ["Link revision", 2, "99"],
    ["source Bead ID", 3, "beads/corrupt-source"],
    ["source Type ID", 4, "types/corrupt-source"],
    ["target Bead ID", 5, "beads/corrupt-target"],
    ["target Type ID", 6, "types/corrupt-target"],
    ["Link properties", 7, { corrupt: true }],
  ] as const)("rejects corruption of the %s in the bdpbd Link oracle", (_field, index, value) => {
    const referenceBundle = createReadArtifactBundle(
      "packages/conformance/fixtures/read-reference-v1.json",
    );
    const bdBundle = createReadArtifactBundle("packages/conformance/fixtures/read-bdpbd-v1.json");
    const corruptedFixture = structuredClone(bdBundle.fixture) as BdFixture;
    const linkRecords = corruptedFixture.oracles.collections["link-records"] as JsonValue[][];
    const firstRecord = linkRecords[0];
    if (firstRecord === undefined) throw new Error("bdpbd fixture has no Link oracle records");
    firstRecord[index] = value;

    expect(() =>
      expectLogicalReadinessEquivalence(referenceBundle, {
        ...bdBundle,
        fixture: corruptedFixture,
      }),
    ).toThrow();
  });

  it.runIf(runRealBdMatrix)(
    "passes every checked-in plan through an isolated public bd CLI workspace (requires local pinned bd or BDP_BD_MATRIX_EXECUTABLE)",
    async () => {
      const withdrawEvidence = establishReadConformanceEvidenceForTesting("bdpbd");
      const seedController = new AbortController();
      const seedTimer = setTimeout(
        () => seedController.abort(new Error("bdpbd seed exceeded its total deadline")),
        60_000,
      );
      seedTimer.unref();
      let temporaryRoot: string | undefined;
      let scenarioTarget: ReturnType<typeof createRawHttpScenarioTarget> | undefined;
      let descriptorPublisher:
        | Awaited<ReturnType<typeof startControlledTypeDescriptorPublisher>>
        | undefined;
      let controlledSession: ControlledReadActionSession | undefined;
      try {
        temporaryRoot = await mkdtemp(path.join(tmpdir(), "bdp-bdpbd-matrix-"));
        const home = path.join(temporaryRoot, "home");
        const workspace = path.join(temporaryRoot, "workspace");
        const restoredWorkspace = path.join(temporaryRoot, "restored-workspace");
        const externalEndpointWorkspace = path.join(temporaryRoot, "external-endpoint-workspace");
        await Promise.all([mkdir(home), mkdir(workspace), mkdir(externalEndpointWorkspace)]);
        const gitconfig = path.join(home, "gitconfig");
        await writeFile(
          gitconfig,
          "[user]\n\tname = bdp-conformance\n\temail = bdp-conformance@invalid\n",
        );
        const environment = {
          PATH: process.env.PATH ?? "",
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
          HOME: home,
          GIT_CONFIG_GLOBAL: gitconfig,
          GIT_CONFIG_SYSTEM: "/dev/null",
          BD_NON_INTERACTIVE: "1",
          CI: "true",
        };
        const executable = await resolveExecutable(
          configuredBdExecutable ?? implicitLocalBdExecutable ?? "bd",
          environment.PATH,
        );
        const artifactBundle = createReadArtifactBundle(
          "packages/conformance/fixtures/read-bdpbd-v1.json",
        );
        const fixture = artifactBundle.fixture as BdFixture;
        await inspectBdIdentity(executable, workspace, environment, fixture, seedController.signal);
        // The workspaces are deliberately independent. Seed them concurrently so
        // host contention cannot make setup consume most of the matrix deadline.
        await Promise.all([
          seedWorkspace(executable, workspace, environment, fixture, seedController.signal),
          seedWorkspace(
            executable,
            externalEndpointWorkspace,
            environment,
            fixture,
            seedController.signal,
          ),
        ]);
        // Restore evidence must cross both identity boundaries: the new listener
        // gets a new Scope and a reconstructed on-disk bd workspace. The later
        // controlled deletion remains an in-memory view overlay; demo-f is never
        // physically deleted from either bd database.
        await reconstructRestoredWorkspace(workspace, restoredWorkspace);
        await runCommand(
          executable,
          [
            "--actor",
            fixture.bd.actor,
            "dep",
            "add",
            "demo-f",
            "external:beads:mol-run-assignee",
            "--type",
            "related",
          ],
          externalEndpointWorkspace,
          environment,
          { signal: seedController.signal },
        );
        const realBdReadyTitles = await expectRealBdReadyOracle(
          executable,
          workspace,
          environment,
          fixture,
          seedController.signal,
        );
        clearTimeout(seedTimer);

        const createMatrixPort = (scopeUrl: string, workspacePath: string) =>
          createBdProcessScopePort(scopeUrl, {
            executable,
            workspace: workspacePath,
            environment,
            timeoutMs: commandTimeoutMs,
            maxOutputBytes: commandMaxOutputBytes,
          });
        scenarioTarget = createRawHttpScenarioTarget(async (scenario, _scope, _seed, bound) => {
          const advertisedLimits = scenario.setup.requires.includes(
            controlledReadAdvertisedLimitsCapability,
          );
          const controlled =
            scenario.setup.requires.includes(controlledReadCapability) ||
            scenario.setup.requires.includes(controlledReadScopeRestoreCapability) ||
            scenario.setup.requires.includes(controlledReadProblemCapability) ||
            advertisedLimits;
          const externalEndpointScenario = scenario.setup.requires.includes(
            controlledReadExternalEndpointCapability,
          );
          // Each scenario owns a fresh adapter cache, while the external row also owns its workspace.
          const sessionPort = createMatrixPort(
            scope,
            externalEndpointScenario ? externalEndpointWorkspace : workspace,
          );
          const session = await startBdpbdSession(
            sessionPort,
            bound,
            scenario.setup.requires.includes("unexpected-internal-fault"),
            scenario.setup.requires.includes(controlledReadProblemCapability),
            advertisedLimits ? DEFAULT_SERVER_READ_LIMITS : undefined,
            controlled
              ? (session) => {
                  controlledSession = session;
                }
              : undefined,
            () => {
              controlledSession = undefined;
            },
            (restoredScope) => createMatrixPort(restoredScope, restoredWorkspace),
          );
          return session;
        });
        const referenceFixture = createReadArtifactBundle(
          "packages/conformance/fixtures/read-reference-v1.json",
        ).fixture as ReferenceFixture;
        if (
          artifactBundle.manifest.scenarios.some((scenario) =>
            scenario.setup.requires.includes(controlledReadExternalTypePublisherCapability),
          )
        ) {
          if (!fixture.capabilities.includes(controlledReadExternalTypePublisherCapability))
            throw new Error("bdpbd fixture lacks its external Type publisher capability");
          descriptorPublisher = await startControlledTypeDescriptorPublisher(
            fixture.typeDescriptors,
          );
        }

        const schema = JSON.parse(readText("schemas/bdp-v0.schema.json")) as Record<
          string,
          unknown
        >;
        const schemaValidator = createJsonSchemaValidator(schema);
        const clientActions = createBdpClientScenarioActionExecutor({
          fetchImplementation: scenarioTarget.fetch,
          ...(descriptorPublisher === undefined
            ? {}
            : { externalTypeDescriptorFetchImplementation: descriptorPublisher.fetch }),
        });
        const result = await runConformanceMatrix({
          scope,
          profile: "read",
          seed: 0,
          artifactBundle,
          execute: scenarioTarget.execute,
          actionExecutor: createControlledReadActionExecutor(
            scenarioTarget.fetch,
            clientActions,
            () => controlledSession,
            schemaValidator,
          ),
          harness: scenarioTarget.harness,
          schemaValidator,
          declaredTargetLabel: "in-process-bdpbd-real-bd-non-attesting",
        });

        const resultsById = new Map(result.scenarios.map((scenario) => [scenario.id, scenario]));
        for (const plan of artifactBundle.manifest.scenarios) {
          const observed = resultsById.get(plan.id);
          expect(observed, `${plan.id}: ${JSON.stringify(observed)}`).toMatchObject({
            state: "pass",
          });
        }
        expect(
          result.scenarios
            .filter(({ id }) => !artifactBundle.manifest.scenarios.some((plan) => plan.id === id))
            .every(
              ({ state, category }) => state === "harness-error" && category === "not-implemented",
            ),
        ).toBe(true);
        expect(result.claimEligible).toBe(false);
        await emitMatrixRunForCohort("bdpbd", result);

        const readinessSession = await startBdpbdSession(
          createMatrixPort(scope, workspace),
          fixture,
        );
        try {
          await expectPublicReadinessEquivalence(
            readinessSession.dialRoute.port,
            fixture,
            referenceFixture,
            realBdReadyTitles,
          );
        } finally {
          await readinessSession.close(new AbortController().signal);
        }
      } finally {
        clearTimeout(seedTimer);
        try {
          await descriptorPublisher?.close();
        } finally {
          try {
            await scenarioTarget?.close();
          } finally {
            try {
              if (temporaryRoot !== undefined)
                await rm(temporaryRoot, { recursive: true, force: true });
            } finally {
              withdrawEvidence();
            }
          }
        }
      }
    },
    90_000,
  );
});

function normalizeMatrixExecutableOverride(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function isCiEnvironment(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized !== undefined &&
    normalized.length > 0 &&
    !["0", "false", "no", "off"].includes(normalized)
  );
}

function createReadArtifactBundle(fixturePath: string) {
  return createConformanceArtifactBundle({
    catalog: {
      bytes: readBytes("packages/conformance/catalog/read-v1.json"),
      label: "catalog/read-v1.json",
    },
    manifest: {
      bytes: readBytes("packages/conformance/matrices/read-v1.json"),
      label: "matrices/read-v1.json",
    },
    fixture: {
      bytes: readBytes(fixturePath),
      label: fixturePath.replace("packages/conformance/", ""),
    },
  });
}

const expectedBeads = [
  ["A", "open", "task"],
  ["B", "open", "task"],
  ["C", "closed", "task"],
  ["D", "open", "task"],
  ["E", "deferred", "bug"],
  ["F", "open", "decision"],
  ["I", "open", "task"],
  ["J", "open", "task"],
  ["K", "closed", "task"],
] as const;
const expectedBlockingEdges = [
  ["A", "C"],
  ["B", "A"],
  ["D", "C"],
  ["F", "E"],
  ["I", "A"],
  ["I", "C"],
  ["J", "C"],
  ["J", "K"],
] as const;
const expectedReadyTitles = ["J", "D", "A"] as const;

function expectLogicalReadinessEquivalence(
  referenceBundle: ConformanceArtifactBundle,
  bdBundle: ConformanceArtifactBundle,
): void {
  const reference = referenceBundle.fixture as ReferenceFixture;
  const bd = bdBundle.fixture as BdFixture;
  expect(reference.realization).toBe("bdptest");
  expect(bd.realization).toBe("bdpbd");
  const referenceTitleById = new Map(
    reference.beads.map(({ localId, properties }) => [localId, properties.title]),
  );
  const referenceLocalLinks = reference.links.filter(
    ({ source, target }) => referenceTitleById.has(source) && referenceTitleById.has(target),
  );
  const bdTitleById = new Map(bd.bd.beads.map(({ id, title }) => [id, title]));
  const shortType = (id: string): string => id.slice(id.lastIndexOf("/") + 1);
  const toFixtureId = (id: string): string => (id.startsWith(scope) ? id.slice(scope.length) : id);
  const sortRows = <Row extends readonly JsonValue[]>(rows: readonly Row[]): readonly Row[] =>
    [...rows].sort((left, right) => {
      const leftBytes = JSON.stringify(left);
      const rightBytes = JSON.stringify(right);
      return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
    });

  const referenceBeads = sortRows(
    reference.beads.map(({ type, properties }) => [
      properties.title,
      properties.status,
      shortType(type),
    ]),
  );
  const bdBeads = sortRows(bd.bd.beads.map(({ title, status, type }) => [title, status, type]));
  expect(referenceBeads).toEqual(sortRows(expectedBeads));
  expect(bdBeads).toEqual(referenceBeads);

  const referenceRoles = new Map(
    reference.typeDescriptors.map(({ id, describes }) => [id, describes]),
  );
  for (const bead of reference.beads) expect(referenceRoles.get(bead.type)).toBe("bead");
  for (const link of reference.links) expect(referenceRoles.get(link.type)).toBe("link");

  const expectedBdTypeRoles = new Map<string, "bead" | "link">(
    reference.typeDescriptors.map(({ id, describes }) => [id, describes]),
  );
  expectedBdTypeRoles.set("types/related", "link");
  expect([...bd.oracles.collections["type-ids"]].sort()).toEqual(
    [...expectedBdTypeRoles.keys()].sort(),
  );
  const expectedBdRoles = [...expectedBdTypeRoles.values()];
  expect({
    bead: expectedBdRoles.filter((role) => role === "bead").length,
    link: expectedBdRoles.filter((role) => role === "link").length,
  }).toEqual({ bead: 8, link: 5 });

  const projectedBdRoles = new Map<string, "bead" | "link">();
  const addProjectedRole = (id: string, role: "bead" | "link"): void => {
    expect(projectedBdRoles.get(id) ?? role).toBe(role);
    projectedBdRoles.set(id, role);
    expect(expectedBdTypeRoles.get(toFixtureId(id))).toBe(role);
  };
  for (const bead of bd.bd.beads) {
    const descriptor = reference.typeDescriptors.find(({ id }) => shortType(id) === bead.type);
    expect(descriptor?.describes).toBe("bead");
    if (descriptor !== undefined) addProjectedRole(descriptor.id, "bead");
  }
  for (const link of bd.bd.links) {
    const id =
      link.type === "blocks"
        ? BLOCKING_LINK_TYPE_ID
        : new URL(`types/${encodeURIComponent(link.type)}`, scope).href;
    addProjectedRole(id, "link");
  }

  const referenceBlockingEdges = sortRows(
    referenceLocalLinks.flatMap(({ source, target, type }) =>
      type === BLOCKING_LINK_TYPE_ID
        ? [[referenceTitleById.get(source) ?? "", referenceTitleById.get(target) ?? ""]]
        : [],
    ),
  );
  const bdBlockingEdges = sortRows(
    bd.bd.links.flatMap(({ source, target, type }) =>
      type === "blocks" ? [[bdTitleById.get(source) ?? "", bdTitleById.get(target) ?? ""]] : [],
    ),
  );
  expect(referenceBlockingEdges).toEqual(sortRows(expectedBlockingEdges));
  expect(bdBlockingEdges).toEqual(referenceBlockingEdges);

  const bdBeadById = new Map(bd.bd.beads.map((bead) => [bead.id, bead]));
  const projectedTypeId = (name: string, describes: "bead" | "link"): string =>
    reference.typeDescriptors.find(
      ({ id, describes: role }) => role === describes && shortType(id) === name,
    )?.id ?? toFixtureId(new URL(`types/${encodeURIComponent(name)}`, scope).href);
  const seededLinkRecords = bd.bd.links.map(({ source, target, type }) => {
    const sourceBead = bdBeadById.get(source);
    const targetBead = bdBeadById.get(target);
    if (sourceBead === undefined || targetBead === undefined)
      throw new Error("bdpbd realization has a Link endpoint without a seeded Bead");
    const id = new URL(bdLinkLocalId(source, target, type), scope).href;
    const projectedLinkType = projectedTypeId(type, "link");
    const sourceId = new URL(`beads/${encodeURIComponent(source)}`, scope).href;
    const sourceType = projectedTypeId(sourceBead.type, "bead");
    const targetId = new URL(`beads/${encodeURIComponent(target)}`, scope).href;
    const targetType = projectedTypeId(targetBead.type, "bead");
    const revision = projectedResourceRevisionForOracle({
      id,
      type: new URL(projectedLinkType, scope).href,
      source: { id: sourceId, type: new URL(sourceType, scope).href },
      target: { id: targetId, type: new URL(targetType, scope).href },
      properties: {},
    });
    return [
      toFixtureId(id),
      projectedLinkType,
      revision,
      toFixtureId(sourceId),
      sourceType,
      toFixtureId(targetId),
      targetType,
      {},
    ] satisfies readonly JsonValue[];
  });
  expect(sortRows(bd.oracles.collections["link-records"])).toEqual(sortRows(seededLinkRecords));
  expect(sortRows(bd.oracles.collections["bead-titles"].map((title) => [title]))).toEqual(
    sortRows(bd.bd.beads.map(({ title }) => [title])),
  );
  expectBdOracleParity(reference, bd, referenceTitleById, bdTitleById);

  expect({ beads: reference.beads.length, links: referenceLocalLinks.length }).toEqual({
    beads: 9,
    links: 9,
  });
  expect({ beads: bd.bd.beads.length, links: bd.bd.links.length }).toEqual({
    beads: reference.beads.length,
    links: referenceLocalLinks.length,
  });
  expect(reference.expectations).toMatchObject({ beadCount: 9, linkCount: 11, typeCount: 12 });
  expect(bd.expectations).toMatchObject({ beadCount: 9, linkCount: 9, typeCount: 13 });
  expect(bd.oracles.collections["bead-titles"]).toHaveLength(bd.expectations.beadCount);
  expect(bd.oracles.collections["link-records"]).toHaveLength(bd.expectations.linkCount);
  expect(bd.oracles.collections["type-ids"]).toHaveLength(bd.expectations.typeCount);

  const deriveReadyTitles = (
    beads: readonly {
      readonly id: string;
      readonly title: string;
      readonly status: string;
      readonly priority: number;
      readonly created_at: string;
    }[],
    blockingEdges: readonly { readonly source: string; readonly target: string }[],
  ): readonly string[] => {
    const statusById = new Map(beads.map(({ id, status }) => [id, status]));
    return beads
      .filter(
        ({ id, status }) =>
          status === "open" &&
          blockingEdges
            .filter(({ source }) => source === id)
            .every(({ target }) => statusById.get(target) === "closed"),
      )
      .sort(
        (left, right) =>
          left.priority - right.priority ||
          right.created_at.localeCompare(left.created_at) ||
          left.id.localeCompare(right.id),
      )
      .map(({ title }) => title);
  };
  const referenceReady = deriveReadyTitles(
    reference.beads.map(({ localId, properties }) => ({
      id: localId,
      title: properties.title,
      status: properties.status,
      priority: properties.priority,
      created_at: properties.created_at,
    })),
    reference.links
      .filter(({ type }) => type === BLOCKING_LINK_TYPE_ID)
      .map(({ source, target }) => ({ source, target })),
  );
  const bdReady = deriveReadyTitles(
    bd.bd.beads,
    bd.bd.links
      .filter(({ type }) => type === "blocks")
      .map(({ source, target }) => ({ source, target })),
  );
  expect(referenceReady).toEqual(expectedReadyTitles);
  expect(bdReady).toEqual(referenceReady);
  expect(reference.expectations.readyTitles).toEqual(referenceReady);
  expect(bd.expectations.readyTitles).toEqual(referenceReady);

  const shippedReferenceReady = readyBeadsFromRecords(projectReferenceReadyRecords(reference), {
    blockingLinkType: BLOCKING_LINK_TYPE_ID,
  }).map(({ bead }) => String(bead.properties.title));
  const shippedBdReady = readyBeadsFromRecords(projectBdReadyRecords(reference, bd), {
    blockingLinkType: BLOCKING_LINK_TYPE_ID,
  }).map(({ bead }) => String(bead.properties.title));
  expect(shippedReferenceReady).toEqual(expectedReadyTitles);
  expect(shippedBdReady).toEqual(expectedReadyTitles);
}

function projectedResourceRevisionForOracle(value: JsonValue): string {
  return `sha256_${createHash("sha256").update(canonicalJsonForOracle(value)).digest("base64url")}`;
}

function canonicalJsonForOracle(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForOracle).join(",")}]`;
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonForOracle(record[key] as JsonValue)}`)
    .join(",")}}`;
}

function expectBdOracleParity(
  reference: ReferenceFixture,
  bd: BdFixture,
  referenceTitleById: ReadonlyMap<string, string>,
  bdTitleById: ReadonlyMap<string, string>,
): void {
  const beadA = bd.bd.beads.find(({ id }) => id === "demo-a");
  if (beadA === undefined) throw new Error("bdpbd realization is missing demo-a");
  expect(bd.oracles.resources["bead.demo-a"]).toMatchObject({
    id: "beads/demo-a",
    properties: {
      id: beadA.id,
      status: beadA.status,
      title: beadA.title,
      priority: beadA.priority,
      created_at: beadA.created_at,
    },
  });
  const linkBA = bd.bd.links.find(
    ({ source, target, type }) => source === "demo-b" && target === "demo-a" && type === "blocks",
  );
  if (linkBA === undefined) throw new Error("bdpbd realization is missing demo-b blocks demo-a");
  expect(bd.oracles.resources["link.demo-b-a"]).toEqual({
    id: "links/b64_ZGVtby1i/b64_ZGVtby1h/b64_YmxvY2tz",
    source: "beads/demo-b",
    target: "beads/demo-a",
    properties: {},
  });

  const referenceLinkKey = (id: string): string | undefined => {
    const link = reference.links.find(({ localId }) => localId === id);
    if (link === undefined) return `missing:${id}`;
    if (!referenceTitleById.has(link.source) || !referenceTitleById.has(link.target))
      return undefined;
    return `${referenceTitleById.get(link.source) ?? "?"}->${
      referenceTitleById.get(link.target) ?? "?"
    }:${link.type === BLOCKING_LINK_TYPE_ID ? "blocks" : "nonblocking"}`;
  };
  const bdLinkKey = (id: string): string => {
    const link = bd.bd.links.find(
      ({ source, target, type }) => bdLinkLocalId(source, target, type) === id,
    );
    if (link === undefined) return `missing:${id}`;
    return `${bdTitleById.get(link.source) ?? "?"}->${bdTitleById.get(link.target) ?? "?"}:${
      link.type === "blocks" ? "blocks" : "nonblocking"
    }`;
  };
  const normalizeGroup = (
    group: Readonly<Record<string, readonly string[]>>,
    linkKey: (id: string) => string | undefined,
    allValuesAreLinks: boolean,
  ): Readonly<Record<string, readonly string[]>> =>
    Object.fromEntries(
      Object.entries(group).map(([key, values]) => [
        key,
        values
          .map((value) => (allValuesAreLinks || key.startsWith("links-") ? linkKey(value) : value))
          .filter((value): value is string => value !== undefined)
          .sort(),
      ]),
    );
  expect(normalizeGroup(bd.oracles["structural-predicates"], bdLinkKey, false)).toEqual(
    normalizeGroup(reference.oracles["structural-predicates"], referenceLinkKey, false),
  );
  expect(normalizeGroup(bd.oracles["incident-links"], bdLinkKey, true)).toEqual(
    normalizeGroup(reference.oracles["incident-links"], referenceLinkKey, true),
  );
}

function projectReferenceReadyRecords(
  reference: ReferenceFixture,
): Parameters<typeof readyBeadsFromRecords>[0] {
  const beadById = new Map(reference.beads.map((bead) => [bead.localId, bead]));
  return reference.beads.map((bead) => ({
    id: new URL(bead.localId, scope).href,
    type: bead.type,
    revision: bead.revision,
    properties: bead.properties,
    links: {
      items: reference.links
        .filter(({ source }) => source === bead.localId)
        .map((link) => ({
          id: new URL(link.localId, scope).href,
          type: link.type,
          revision: link.revision,
          source: {
            id: new URL(link.source, scope).href,
            type: beadById.get(link.source)?.type ?? "",
          },
          target: {
            id: new URL(link.target, scope).href,
            type: beadById.get(link.target)?.type ?? "",
          },
          properties: link.properties,
        })),
      next: null,
    },
  })) as Parameters<typeof readyBeadsFromRecords>[0];
}

function projectBdReadyRecords(
  reference: ReferenceFixture,
  bd: BdFixture,
): Parameters<typeof readyBeadsFromRecords>[0] {
  const typeByName = new Map(
    reference.typeDescriptors.map(({ id, describes }) => [
      `${describes}:${id.slice(id.lastIndexOf("/") + 1)}`,
      id,
    ]),
  );
  const beadType = (name: string): string =>
    typeByName.get(`bead:${name}`) ?? `${scope}types/${name}`;
  const linkType = (name: string): string =>
    typeByName.get(`link:${name}`) ?? `${scope}types/${name}`;
  const beadById = new Map(bd.bd.beads.map((bead) => [bead.id, bead]));
  return bd.bd.beads.map((bead) => ({
    id: `${scope}beads/${bead.id}`,
    type: beadType(bead.type),
    revision: "1",
    properties: {
      id: bead.id,
      title: bead.title,
      status: bead.status,
      priority: bead.priority,
      created_at: bead.created_at,
    },
    links: {
      items: bd.bd.links
        .filter(({ source }) => source === bead.id)
        .map((link) => ({
          id: `${scope}links/${link.source}-${link.target}-${link.type}`,
          type: linkType(link.type),
          revision: "1",
          source: {
            id: `${scope}beads/${link.source}`,
            type: beadType(beadById.get(link.source)?.type ?? ""),
          },
          target: {
            id: `${scope}beads/${link.target}`,
            type: beadType(beadById.get(link.target)?.type ?? ""),
          },
          properties: {},
        })),
      next: null,
    },
  })) as Parameters<typeof readyBeadsFromRecords>[0];
}

async function startBdpbdSession(
  port: ReturnType<typeof createBdProcessScopePort>,
  fixture: ConformanceFixture,
  injectInternalFault = false,
  injectProblemTable = false,
  controlledLimits?: ServerReadLimitsConfig,
  installControlledSession?: (session: ControlledReadActionSession) => void,
  releaseControlledSession: () => void = () => undefined,
  restorePortForScope?: (scope: string) => ReturnType<typeof createBdProcessScopePort>,
  scopeUrl = scope,
) {
  const faultingResource = new URL(requireBinding(fixture, "bead.demo-a"), scopeUrl).href;
  const faultPort = injectInternalFault
    ? createReadResourceFaultPortForTesting(port, {
        resource: "bead",
        id: faultingResource,
        error: new Error(
          `private injected adapter fault [${requireInternalFaultSentinel(fixture)}]`,
        ),
      })
    : port;
  const sessionPort = injectProblemTable
    ? createReadProblemTablePortForTesting(faultPort, { scope: scopeUrl })
    : faultPort;
  const controlled =
    installControlledSession === undefined
      ? undefined
      : createControlledReadSessionForTesting({
          scope: scopeUrl,
          source: sessionPort,
          viewHeader: controlledReadViewHeader,
          epochHeader: controlledReadEpochHeader,
          unauthenticatedChallenge: controlledReadUnauthenticatedChallenge,
          ...(injectProblemTable
            ? {
                unauthenticatedProblemUrl: new URL("beads/?limit=1", scopeUrl).href,
              }
            : {}),
          ...(controlledLimits === undefined ? {} : { limits: controlledLimits }),
        });
  const readControls =
    controlled?.readControls ??
    createPublicReadControls({ scope: scopeUrl, limits: DEFAULT_SERVER_READ_LIMITS });
  let server: ReturnType<typeof createReadServer>;
  try {
    server = createReadServer({
      scope: scopeUrl,
      target: "bdpbd",
      admittedProfile: admitReadServerProfile("read", "bdpbd"),
      port: controlled?.port ?? sessionPort,
      advertisedLimits: advertisedLimitsFor(readControls),
      readControls,
    });
  } catch (error) {
    releaseControlledSession();
    throw error;
  }
  try {
    const listener = createNodeHttpServer(server);
    let listenerFailure: unknown;
    try {
      await listenNodeHttpServer(listener, {
        host: "127.0.0.1",
        port: 0,
        onError: (error) => {
          listenerFailure ??= error;
        },
      });
      const address = listener.address();
      if (address === null || typeof address === "string")
        throw new Error("bdpbd matrix listener did not expose a TCP address");
      if (controlled !== undefined) {
        const exposed: ControlledReadActionSession = {
          ...controlled,
          restoreScope: async ({ requestedScope, signal }) => {
            if (signal.aborted) throw signal.reason;
            if (requestedScope === undefined)
              throw new Error("bdpbd restore requires a new canonical Scope URL");
            const restoredScope = new URL(requestedScope).href;
            const original = new URL(scopeUrl);
            const restoredUrl = new URL(restoredScope);
            const pathsOverlap =
              original.origin === restoredUrl.origin &&
              (original.pathname.startsWith(restoredUrl.pathname) ||
                restoredUrl.pathname.startsWith(original.pathname));
            if (
              restoredScope !== requestedScope ||
              !restoredScope.endsWith("/") ||
              restoredScope === scopeUrl ||
              pathsOverlap
            )
              throw new Error("bdpbd restore Scope must be canonical and non-overlapping");
            const restoredPort = restorePortForScope?.(restoredScope);
            if (restoredPort === undefined)
              throw new Error("bdpbd restore port factory is unavailable");
            const restored = await startBdpbdSession(
              restoredPort,
              fixture,
              false,
              false,
              undefined,
              undefined,
              () => undefined,
              undefined,
              restoredScope,
            );
            return {
              scope: restoredScope,
              fetch: createSemanticDialFetch(restored.dialRoute.port),
              close: () => restored.close(new AbortController().signal),
            };
          },
        };
        installControlledSession?.(exposed);
      }
      return {
        capabilities:
          controlled === undefined
            ? fixture.capabilities.filter((capability) => capability !== controlledReadCapability)
            : fixture.capabilities,
        bindings: fixture.bindings,
        dialRoute: {
          transport: "plain" as const,
          host: "127.0.0.1",
          port: address.port,
        },
        close: async (_signal: AbortSignal) => {
          const failures: unknown[] = [];
          try {
            try {
              await closeNodeHttpServer(listener);
            } catch (error) {
              failures.push(error);
            }
            try {
              await server.close();
            } catch (error) {
              failures.push(error);
            }
          } finally {
            releaseControlledSession();
          }
          if (listenerFailure !== undefined) failures.unshift(listenerFailure);
          if (failures.length > 0)
            throw new AggregateError(failures, "bdpbd matrix target cleanup failed");
        },
      };
    } catch (error) {
      if (listener.listening) await closeNodeHttpServer(listener).catch(() => undefined);
      releaseControlledSession();
      throw error;
    }
  } catch (error) {
    await server.close();
    releaseControlledSession();
    throw error;
  }
}

function advertisedLimitsFor(controls: ServerReadControls): ServerAdvertisedReadLimits {
  return {
    page: {
      defaultItems: controls.pagination.limits.defaultPageItems,
      maximumItems: controls.pagination.limits.maxPageItems,
    },
    selector: controls.selectorLimits,
    cursorTtlMilliseconds: controls.pagination.limits.cursorTtlMs,
  };
}

function createSemanticDialFetch(dialPort: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const semanticUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const dialUrl = new URL(semanticUrl);
    dialUrl.protocol = "http:";
    dialUrl.hostname = "127.0.0.1";
    dialUrl.port = String(dialPort);
    const response = await fetch(dialUrl, init);
    const semanticResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(semanticResponse, "url", { value: semanticUrl });
    return semanticResponse;
  }) as typeof fetch;
}

function requireInternalFaultSentinel(fixture: ConformanceFixture): string {
  const privateFixture = fixture.private;
  const value =
    typeof privateFixture === "object" && privateFixture !== null && !Array.isArray(privateFixture)
      ? (privateFixture as Readonly<Record<string, unknown>>).internalFaultSentinel
      : undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new Error("fixture private internal-fault sentinel is required");
  return value;
}

function requireBinding(fixture: Pick<ConformanceFixture, "bindings">, binding: string): string {
  const value = fixture.bindings[binding];
  if (value === undefined) throw new Error(`fixture binding '${binding}' is required`);
  return value;
}

async function expectPublicReadinessEquivalence(
  dialPort: number,
  fixture: BdFixture,
  reference: ReferenceFixture,
  realBdReadyTitles: readonly string[],
): Promise<void> {
  const dialFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const semanticUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const dialUrl = new URL(semanticUrl);
    dialUrl.protocol = "http:";
    dialUrl.hostname = "127.0.0.1";
    dialUrl.port = String(dialPort);
    const response = await fetch(dialUrl, init);
    const semanticResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(semanticResponse, "url", { value: semanticUrl });
    return semanticResponse;
  }) as typeof fetch;
  const client = new BdpClient({ scope, transport: createFetchTransport(dialFetch) });
  try {
    const page = await client.perform({ kind: "collection", collection: "beads" });
    if ("code" in page) throw new Error(`public bdpbd status read failed: ${page.code}`);
    const actualStatuses = Object.fromEntries(
      page.items.map(({ properties }) => [properties.title, properties.status]),
    );
    const expectedStatuses = Object.fromEntries(
      fixture.bd.beads.map(({ title, status }) => [title, status]),
    );
    const referenceStatuses = Object.fromEntries(
      reference.beads.map(({ properties }) => [properties.title, properties.status]),
    );
    expect(actualStatuses).toEqual(expectedStatuses);
    expect(actualStatuses).toEqual(referenceStatuses);

    const ready = await readyBeadsFromClient(client, { blockingLinkType: BLOCKING_LINK_TYPE_ID });
    if ("code" in ready) throw new Error(`public bdpbd readiness failed: ${ready.code}`);
    const readyTitles = ready.map(({ bead }) => bead.properties.title);
    expect(readyTitles).toEqual(fixture.expectations.readyTitles);
    expect(readyTitles).toEqual(reference.expectations.readyTitles);
    expect(readyTitles).toEqual(realBdReadyTitles);
  } finally {
    await client.close();
  }
}

async function inspectBdIdentity(
  executable: string,
  workspace: string,
  environment: Readonly<Record<string, string>>,
  fixture: BdFixture,
  signal: AbortSignal,
): Promise<void> {
  const resolved = await realpath(executable);
  const hash = createHash("sha256")
    .update(await readFile(resolved))
    .digest("hex");
  const hostLocalDiagnostic = `host-local bd: real_path=${resolved} sha256=${hash}`;
  const actor = fixture.bd.actor;
  const versionJson = await runCommand(
    executable,
    ["--actor", actor, "version", "--json"],
    workspace,
    environment,
    { signal },
  );
  const versionText = await runCommand(
    executable,
    ["--actor", actor, "--version"],
    workspace,
    environment,
    { signal },
  );
  assertAcceptedBdIdentity(
    JSON.parse(versionJson.stdout) as unknown,
    versionText.stdout.trim(),
    fixture.bd.acceptedBuildIdentities,
    hostLocalDiagnostic,
  );
}

function assertAcceptedBdIdentity(
  versionJson: unknown,
  versionText: string,
  accepted: BdFixture["bd"]["acceptedBuildIdentities"],
  diagnostic: string,
): void {
  if (
    !accepted.some(
      (identity) =>
        isDeepStrictEqual(versionJson, identity.versionJson) &&
        versionText === identity.versionText,
    )
  )
    throw new Error(`bd executable identity is not an accepted checked-in build: ${diagnostic}`);
}

async function seedWorkspace(
  executable: string,
  workspace: string,
  environment: Readonly<Record<string, string>>,
  fixture: BdFixture,
  signal: AbortSignal,
): Promise<void> {
  await seedBdWorkspace(executable, workspace, environment, fixture.bd, signal);
}

async function reconstructRestoredWorkspace(source: string, destination: string): Promise<void> {
  if (path.resolve(source) === path.resolve(destination))
    throw new Error("restored bd workspace must be distinct from its seeded source");
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  if ((await realpath(source)) === (await realpath(destination)))
    throw new Error("restored bd workspace copy aliases its seeded source");
}

async function expectRealBdReadyOracle(
  executable: string,
  workspace: string,
  environment: Readonly<Record<string, string>>,
  fixture: BdFixture,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const result = await runCommand(
    executable,
    ["--actor", fixture.bd.actor, "ready", "--limit", "0", "--json"],
    workspace,
    environment,
    { signal },
  );
  const value = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(value)) throw new Error("bd ready oracle did not return an array");
  const titles = value.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("title" in entry) ||
      typeof entry.title !== "string"
    )
      throw new Error("bd ready oracle returned an invalid item");
    return entry.title;
  });
  expect(titles).toEqual(fixture.expectations.readyTitles);
  return titles;
}

function executableCandidates(command: string, searchPath: string): readonly string[] {
  if (command.includes(path.sep)) return [path.resolve(command)];
  return searchPath
    .split(path.delimiter)
    .filter((directory) => directory.length > 0)
    .map((directory) => path.resolve(directory, command));
}

function findExecutable(command: string, searchPath: string): string | undefined {
  for (const candidate of executableCandidates(command, searchPath)) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next explicit PATH entry.
    }
  }
  return undefined;
}
