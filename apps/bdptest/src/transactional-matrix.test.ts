import { execFileSync, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  createJsonSchemaValidator,
  createRawHttpExchangeExecutor,
  type ExactHttpModeOptions,
  type HttpExchangeResponse,
} from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
  runCumulativeTransactionalMatrix,
  assertSameServedProfileConfiguration,
} from "@bdp/conformance/testing";
import {
  createTransactionalExecutionBinding,
  installedTransactionBinding,
} from "../test-support/transactional-execution-binding.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal?: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const scope = "https://reference.invalid/acme/";
const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed-process.js");
const source = (file: string) => ({
  bytes: readFileSync(path.join(root, "packages/conformance/test-support/transactional", file)),
});
const fixtureSource = source("fixture-v1.json"),
  manifestSource = source("manifest-v1.json");
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  { manifest: manifestSource, fixture: fixtureSource },
);
function artifacts() {
  const task = `${scope}types/task`,
    link = `${scope}types/relationship`,
    propertiesSchema = `${scope}schemas/properties`;
  const descriptors = [
    { id: task, name: "Task", describes: "bead", conformsTo: [], propertiesSchema },
    {
      id: link,
      name: "Relationship",
      describes: "link",
      conformsTo: [],
      propertiesSchema,
      source: { conformsTo: [task], external: "opaque" },
      target: { conformsTo: [task], external: "opaque" },
    },
  ];
  return {
    descriptors: descriptors.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
    schemas: [
      {
        retrievalUri: propertiesSchema,
        utf8: JSON.stringify({
          $id: propertiesSchema,
          type: "object",
          properties: { title: { type: "string" } },
          additionalProperties: false,
        }),
      },
    ],
  };
}
const sourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
function errorCauses(error: unknown): Set<unknown> {
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof AggregateError) for (const cause of value.errors) visit(cause);
    if (value instanceof Error && value.cause !== undefined) visit(value.cause);
  };
  visit(error);
  return seen;
}
async function observe(control?: {
  readonly budgetMs?: number;
  readonly invalidReceiptCredentials?: boolean | "set-update" | "set-delete";
  /** Negative-only removal of one already declared canonical set route. */
  readonly omitRoute?: {
    readonly method: "POST";
    readonly url: `${typeof scope}operations/${"update-where" | "delete-where"}`;
  };
  readonly signal?: AbortSignal;
  readonly children?: ChildProcess[];
  /** Negative-test gate after actual ordinary wire, never a response replacement. */
  readonly afterExchange?: (response: HttpExchangeResponse, signal: AbortSignal) => Promise<void>;
  readonly ready?: (ready: Record<string, unknown>) => Record<string, unknown>;
  readonly manifest?: (value: {
    scenarios: { id: string; actions: Record<string, unknown>[] }[];
  }) => void;
}) {
  const budgetMs = control?.budgetMs ?? 90000;
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 90000)
    throw new Error("invalid cohort budget");
  const controller = new AbortController();
  const signal = control?.signal
    ? AbortSignal.any([control.signal, controller.signal])
    : controller.signal;
  signal.throwIfAborted();
  const changed = JSON.parse(manifestSource.bytes.toString()) as {
    scenarios: { id: string; actions: Record<string, unknown>[] }[];
  };
  control?.manifest?.(changed);
  const runBundle = control?.manifest
    ? createCumulativeTransactionalArtifactBundle(loadProfileContractSelection("transactional"), {
        fixture: fixtureSource,
        manifest: { bytes: Buffer.from(JSON.stringify(changed)) },
      })
    : bundle;
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-installed-"));
  const operator = randomBytes(32).toString("base64url"),
    reader = randomBytes(32).toString("base64url");
  const configuration = {
    scope,
    directory: path.join(directory, "bootstrap"),
    create: true,
    credentials: [
      { token: operator, principal: "same", canMutate: true },
      { token: reader, principal: "same", canMutate: false },
    ],
    artifacts: artifacts(),
  };
  let target: ReturnType<typeof createTransactionalExecutionBinding> | undefined;
  const sessions: Record<string, unknown>[] = [];
  const deniedReceiptUrls = new Set<string>();
  const timer = setTimeout(
    () => controller.abort(new Error("installed cohort deadline")),
    budgetMs,
  );
  let observed:
    | {
        result: Awaited<ReturnType<typeof runCumulativeTransactionalMatrix>>;
        sessions: Record<string, unknown>[];
        baseline: ReturnType<typeof installedTransactionBinding>;
      }
    | undefined;
  let failure: unknown;
  const cleanupFailures: unknown[] = [];
  try {
    const bootstrap = await launchInstalledTransaction(entry, configuration, signal);
    control?.children?.push(bootstrap.child);
    let baseline: ReturnType<typeof installedTransactionBinding>;
    try {
      baseline = installedTransactionBinding(bootstrap.ready, sourceCommit, fixtureSource);
    } finally {
      await bootstrap.close();
    }
    const routes = bundle.manifest.scenarios
      .flatMap((s) => s.actions ?? [])
      .flatMap((a) => {
        if (a.family !== "http") return [];
        const base =
          a.target.binding === "scope" ? scope : bundle.fixture.bindings?.[a.target.binding];
        if (!base) throw new Error("predeclared target unavailable");
        const url = new URL(a.target.path ?? "", base);
        for (const [key, value] of Object.entries(a.target.query ?? {})) {
          if (typeof value !== "string") throw new Error("literal query required");
          url.searchParams.set(key, value);
        }
        return [{ method: a.method, url: url.href }];
      });
    const uniqueRoutes = routes.filter(
      (r, i) => routes.findIndex((o) => o.url === r.url && o.method === r.method) === i,
    );
    // Independently authored route inventory, not a second derivation from the manifest.
    expect(uniqueRoutes).toEqual([
      { method: "GET", url: `${scope}beads/a` },
      { method: "POST", url: `${scope}operations/batch` },
      { method: "GET", url: `${scope}links/l` },
      { method: "GET", url: `${scope}beads/?limit=32` },
      { method: "GET", url: `${scope}events/` },
      { method: "GET", url: `${scope}beads/new` },
      { method: "GET", url: `${scope}beads/b` },
      { method: "GET", url: `${scope}beads/c` },
      { method: "POST", url: `${scope}operations/update-where` },
      { method: "POST", url: `${scope}operations/delete-where` },
    ]);
    const omitted = control?.omitRoute;
    if (omitted) {
      expect([`${scope}operations/update-where`, `${scope}operations/delete-where`]).toContain(
        omitted.url,
      );
      expect(omitted.method).toBe("POST");
      expect(
        uniqueRoutes.filter((r) => r.url === omitted.url && r.method === omitted.method),
      ).toHaveLength(1);
    }
    const exactMode: ExactHttpModeOptions = {
      scope,
      profile: "transactional",
      routes: uniqueRoutes.filter(
        (r) => !omitted || r.url !== omitted.url || r.method !== omitted.method,
      ),
      maximumRequestHeaderBytes: 16384,
      maximumRequestBodyBytes: 65536,
      defaultCredentialRef: "operator",
      credentialHandles: [
        { id: "operator", headerNames: ["authorization"] },
        { id: "reader", headerNames: ["authorization"] },
        { id: "anonymous", headerNames: [] },
      ],
      resolveCredentials: ({ credentialRef, url }) =>
        credentialRef === "anonymous"
          ? {}
          : {
              authorization: `Bearer ${(control?.invalidReceiptCredentials === true && url.startsWith(`${scope}receipts/`)) || deniedReceiptUrls.has(url) ? "deliberately-unknown" : credentialRef === "operator" ? operator : reader}`,
            },
    };
    target = createTransactionalExecutionBinding({
      baseline,
      sourceCommit,
      fixtureSource,
      exactMode,
      launch: async (scenario, reopen, signal) => {
        if (signal.aborted) throw new Error("launch aborted");
        const child = await launchInstalledTransaction(
          entry,
          {
            ...configuration,
            directory: path.join(directory, scenario),
            create: !reopen,
          },
          signal,
        );
        control?.children?.push(child.child);
        sessions.push({ ...child.ready, scenario, reopen });
        return control?.ready ? { ...child, ready: control.ready(child.ready) } : child;
      },
    });
    const result = await runCumulativeTransactionalMatrix(
      {
        scope,
        signal,
        profile: "transactional",
        seed: 0,
        artifactBundle: runBundle,
        execute: async () => {
          throw new Error("generic HTTP executor forbidden");
        },
        exactExecution: {
          execute: async (request) => {
            const response = await target!.target.execute(request);
            if (
              typeof control?.invalidReceiptCredentials === "string" &&
              response.status === 200 &&
              [
                baseline.operationTargets.updateWhere,
                baseline.operationTargets.deleteWhere,
              ].includes(response.url)
            ) {
              const receipt = JSON.parse(response.bodyText) as {
                id?: unknown;
                idempotencyKey?: unknown;
              };
              if (
                receipt.idempotencyKey === control.invalidReceiptCredentials &&
                typeof receipt.id === "string"
              )
                deniedReceiptUrls.add(receipt.id);
            }
            await control?.afterExchange?.(response, signal);
            signal.throwIfAborted();
            return response;
          },
          configuration: target.target.exactConfiguration!,
        },
        harness: {
          ...target.target.harness,
          cleanup: async (...args) => {
            try {
              await target!.target.harness.cleanup(...args);
            } catch (error) {
              cleanupFailures.push(error);
              throw error;
            }
          },
        },
        schemaValidator: createJsonSchemaValidator(schema),
        declaredTargetLabel: "private-installed-transactional-partial",
        prepareTimeoutMs: 10000,
        cleanupTimeoutMs: 10000,
        requestTimeoutMs: 5000,
      },
      target.context,
    );
    observed = { result, sessions, baseline };
  } catch (error) {
    failure = error;
  } finally {
    // The runner can report abort as row state; retain the cohort's original
    // reason before a subsequent child/session cleanup failure is aggregated.
    if (failure === undefined && signal.aborted) failure = signal.reason;
    try {
      await target?.target.close();
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    } finally {
      clearTimeout(timer);
      rmSync(directory, { recursive: true, force: true });
    }
  }
  if (cleanupFailures.length) {
    const causes = [...new Set([...(failure === undefined ? [] : [failure]), ...cleanupFailures])];
    throw new AggregateError(causes, "installed cohort cleanup failed");
  }
  if (failure !== undefined) throw failure;
  signal.throwIfAborted();
  if (!observed) throw new Error("missing installed observation");
  return observed;
}
it("observes ten partial Transactional contracts through packed-capable actual installed HTTP", async () => {
  const started = performance.now(),
    children: ChildProcess[] = [];
  const observed = await observe({ children });
  const implemented = new Set(bundle.manifest.scenarios.map((s) => s.id));
  expect(loadProfileContractSelection("transactional").required).toHaveLength(250);
  expect(observed.result.scenarios).toHaveLength(255); // Includes five optional catalog rows.
  for (const row of observed.result.scenarios.filter((s) => implemented.has(s.id)))
    expect(row, JSON.stringify(row, null, 2)).toMatchObject({ state: "pass" });
  expect(observed.result.scenarios.filter((s) => s.state === "pass")).toHaveLength(10);
  expect(observed.result.claimEligible).toBe(false);
  expect(observed.sessions).toHaveLength(17);
  expect(children).toHaveLength(18); // Seventeen scenario/reopen sessions plus separate bootstrap.
  expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
    true,
  );
  expect(observed.result.declarations).toMatchObject({
    exactConfigurationDigest: "634214546089490d235fa404166dc868a0feb5dc2a8af2a566a6ad33664b4b1a",
  });
  const dynamic = observed.result.scenarios
    .flatMap((s) => s.exchanges)
    .filter((e) => e.dynamicExactConfiguration);
  expect(dynamic.length).toBeGreaterThan(0);
  expect(
    dynamic.every(
      (e) =>
        e.request.exact?.writeState === "complete" && e.sourceReceiptObservation && e.servedSession,
    ),
  ).toBe(true);
  expect(dynamic.every((e) => e.request.exact?.bodyDigest === undefined)).toBe(true);
  const reopened = dynamic.filter((e) => e.request.id.startsWith("reopened-"));
  expect(reopened.map((e) => e.request.id).sort()).toEqual([
    "reopened-completed",
    "reopened-conflict-root",
    "reopened-failed",
    "reopened-m-delete",
    "reopened-m-update",
    "reopened-pagination-page",
    "reopened-pagination-page-head",
    "reopened-pagination-root",
    "reopened-set-cardinality-failed",
    "reopened-set-delete-completed",
    "reopened-set-update-completed",
    "reopened-z-delete",
    "reopened-z-update",
  ]);
  for (const exchange of reopened) {
    expect(exchange.servedSession?.generation).toBeGreaterThan(
      exchange.sourceReceiptObservation!.session.generation,
    );
    expect(exchange.servedSession?.runtimeConfigurationIdentity).toBe(
      exchange.sourceReceiptObservation!.session.runtimeConfigurationIdentity,
    );
    expect(exchange.servedSession?.configurationDigest).toBe(
      exchange.sourceReceiptObservation!.session.configurationDigest,
    );
    const original = exchange.sourceReceiptObservation!;
    expect(exchange.request.url).toBe(
      original.pointer === "/next" ? original.page : original.receipt,
    );
    // Report headers intentionally omit private context. Require the successful
    // actual client-projection assertions, including the first reopened HEAD.
    const declared = bundle.manifest.scenarios
      .find((r) => r.id === original.session.scenario)!
      .actions!.find((a) => a.id === exchange.request.id)!;
    const observedAction = observed.result.scenarios
      .find((r) => r.id === original.session.scenario)!
      .actions!.find((a) => a.action.id === exchange.request.id)!;
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"]) {
      const required = declared.assertions.find(
        (a) => a.kind === "json-pointer" && a.pointer === `/headers/${name}` && a.exists === true,
      )!;
      expect(required).toBeDefined();
      expect(observedAction.assertions.find((a) => a.id === required.id)?.passed).toBe(true);
    }
    if (exchange.request.method === "HEAD") expect(exchange.response?.decodedBodyBytes).toBe(0);
  }
  const newRows = observed.result.scenarios.filter(
    (row) => row.id === "transactional.set.mutation" || row.id === "transactional.set.zero-match",
  );
  for (const row of newRows)
    for (const exchange of row.exchanges) {
      if (exchange.request.method === "POST")
        expect(exchange.request.exact!.bodyOctets).toBeLessThanOrEqual(2048);
      expect(exchange.response!.decodedBodyBytes).toBeLessThanOrEqual(32768);
    }
  const pagination = observed.result.scenarios.find(
    (row) => row.id === "transactional.receipt.pagination",
  )!;
  for (const exchange of pagination.exchanges) {
    if (exchange.request.method === "POST")
      expect(exchange.request.exact!.bodyOctets).toBeLessThanOrEqual(16384);
    expect(exchange.response!.decodedBodyBytes).toBeLessThanOrEqual(32768);
  }
  const completedConflict = observed.result.scenarios.find(
    (row) => row.id === "transactional.idempotency.conflict",
  )!;
  for (const exchange of completedConflict.exchanges) {
    if (exchange.request.method === "POST")
      expect(exchange.request.exact!.bodyOctets).toBeLessThanOrEqual(2048);
    expect(exchange.response!.decodedBodyBytes).toBeLessThanOrEqual(8192);
  }
  expect(performance.now() - started).toBeLessThanOrEqual(63000);
  console.log(
    JSON.stringify({
      kind: "installed-tx-ten-partial-summary",
      sourceCommit,
      elapsedMs: performance.now() - started,
      actions: bundle.manifest.scenarios.reduce((n, s) => n + (s.actions?.length ?? 0), 0),
      sessions: observed.sessions.length,
      childLaunches: children.length,
      closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
      artifacts: bundle.digests,
      baseline: observed.baseline,
      claimEligible: false,
    }),
  );
  if (process.env.BDP_TRANSACTIONAL_OBSERVATION_OUTPUT)
    writeFileSync(
      process.env.BDP_TRANSACTIONAL_OBSERVATION_OUTPUT,
      JSON.stringify({ sourceCommit, entry, ...observed }, null, 2) + "\n",
    );
}, 120000);

it.each([
  "runtimeConfigurationIdentity",
  "artifactIdentity",
  "policyIdentity",
  "authenticationIdentity",
  "authorityMode",
])(
  "refuses changed installed %s before actions",
  async (field) => {
    const observed = await observe({
      ready: (ready) => ({
        ...ready,
        [field]:
          field === "authorityMode"
            ? "listener"
            : field === "artifactIdentity"
              ? `development-schema5-${"f".repeat(64)}`
              : "f".repeat(64),
      }),
    });
    const attempted = observed.result.scenarios.filter((s) => s.category !== "not-implemented");
    expect(attempted.some((s) => s.state === "harness-error")).toBe(true);
    expect(observed.result.scenarios.flatMap((s) => s.exchanges)).toHaveLength(0);
  },
  120000,
);
it("refuses missing metadata at bootstrap instead of accepting a nonattesting fixture", () => {
  expect(() =>
    installedTransactionBinding(
      { scope, profile: "transactional", history: false, claimEligible: false },
      sourceCommit,
      fixtureSource,
    ),
  ).toThrow("metadata");
});
it.each(["binding", "method", "credential", "body-assertion"])(
  "refuses altered private receipt %s without manufacturing observations",
  async (kind) => {
    const observed = await observe({
      manifest: (value) => {
        const action = value.scenarios[0]!.actions.find(
          (a) => a.operation === "transactional.receipt-read",
        )!;
        if (kind === "body-assertion")
          action.assertions = [
            {
              id: "deliberate-counterfactual",
              kind: "json-pointer",
              pointer: "/body/results/0/resource/properties/title",
              exists: true,
              equals: "never-observed",
            },
          ];
        else
          action.input =
            kind === "binding"
              ? { binding: "subject", method: "GET" }
              : kind === "method"
                ? { binding: "commit-receipt", method: "POST" }
                : { binding: "commit-receipt", method: "GET", credentialRef: "reader" };
      },
    });
    const first = observed.result.scenarios.find(
      (s) => s.id === "transactional.batch.atomic-commit",
    )!;
    if (kind === "body-assertion") expect(first.state).toBe("fail");
    else {
      const reason =
        kind === "binding"
          ? "receipt not authorized by original wire observation"
          : "invalid private receipt input";
      expect(first).toMatchObject({ state: "harness-error", reason });
      expect(first.actions?.at(-1)?.executionError?.message).toBe(reason);
    }
    expect(first.exchanges.filter((e) => e.dynamicExactConfiguration)).toHaveLength(
      kind === "body-assertion" ? 1 : 0,
    );
  },
  120000,
);

it("observes per-handle authorization and separately bound permission-swapped configurations", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-permissions-"));
  const tokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  const children: Awaited<ReturnType<typeof launchInstalledTransaction>>[] = [];
  try {
    const bindings: ReturnType<typeof installedTransactionBinding>[] = [];
    for (const swapped of [false, true]) {
      const child = await launchInstalledTransaction(entry, {
        scope,
        directory: path.join(directory, String(swapped)),
        create: true,
        credentials: tokens.map((token, i) => ({
          token,
          principal: "same",
          canMutate: swapped ? i === 1 : i === 0,
        })),
        artifacts: artifacts(),
      });
      children.push(child);
      const bound = installedTransactionBinding(child.ready, sourceCommit, fixtureSource);
      bindings.push(bound);
      const address = new URL(child.ready.listenUrl as string),
        url = `${scope}operations/batch`;
      const mode: ExactHttpModeOptions = {
        scope,
        profile: "transactional",
        routes: [{ method: "POST", url }],
        maximumRequestHeaderBytes: 16384,
        maximumRequestBodyBytes: 65536,
        defaultCredentialRef: "first",
        credentialHandles: [
          { id: "first", headerNames: ["authorization"] },
          { id: "second", headerNames: ["authorization"] },
        ],
        resolveCredentials: ({ credentialRef }) => ({
          authorization: `Bearer ${tokens[credentialRef === "first" ? 0 : 1]}`,
        }),
      };
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        { exactMode: mode, requestTimeoutMs: 5000 },
      );
      for (const [i, credentialRef] of ["first", "second"].entries()) {
        const response = await execute({
          method: "POST",
          url,
          signal: AbortSignal.timeout(5000),
          credentialRef,
          raw: {
            headerLines: [
              { name: "content-type", value: "application/json" },
              { name: "idempotency-key", value: credentialRef },
            ],
            bodyBytes: Buffer.from(
              JSON.stringify({
                operations: [
                  {
                    operation: "createBead",
                    id: `beads/${credentialRef}`,
                    type: `${scope}types/task`,
                    properties: { title: "authorized" },
                  },
                ],
              }),
            ),
          },
        });
        expect(response.status).toBe((swapped ? i === 1 : i === 0) ? 200 : 403);
      }
      expect(installedTransactionBinding(child.ready, sourceCommit, fixtureSource)).toEqual(bound);
    }
    expect(bindings[0]!.served.installedContractsDigest).toBe(
      bindings[1]!.served.installedContractsDigest,
    );
    for (const field of ["policyDigest", "authenticationDigest"] as const)
      expect(bindings[0]!.served[field]).not.toBe(bindings[1]!.served[field]);
    expect(bindings[0]!.runtimeConfigurationIdentity).not.toBe(
      bindings[1]!.runtimeConfigurationIdentity,
    );
    expect(() =>
      assertSameServedProfileConfiguration(bindings[0]!.served, bindings[1]!.served),
    ).toThrow();
  } finally {
    for (const child of children.reverse()) await child.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);

it("keeps the installed bootstrap inert on import and refuses missing IPC or invalid configuration", async () => {
  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(new URL(`file://${entry}`).href)});`,
    ],
    { cwd: "/tmp", encoding: "utf8", timeout: 10000 },
  );
  expect(imported.status).toBe(0);
  expect(imported.stdout).toBe("");
  expect(imported.stderr).toBe("");
  const direct = spawnSync(process.execPath, [entry], {
    cwd: "/tmp",
    encoding: "utf8",
    timeout: 10000,
  });
  expect(direct.status).toBe(2);
  expect(direct.stdout).toBe("");
  expect(direct.stderr).toBe("installed transaction qualification failed\n");
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-invalid-launch-"));
  try {
    await expect(
      launchInstalledTransaction(entry, {
        scope,
        directory,
        create: true,
        credentials: [],
        artifacts: artifacts(),
      }),
    ).rejects.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);

it("drains on inherited IPC disconnect and releases the installed owner for reopen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-disconnect-"));
  const configuration = {
    scope,
    directory,
    create: true,
    credentials: [
      { token: randomBytes(32).toString("base64url"), principal: "p", canMutate: true },
    ],
    artifacts: artifacts(),
  };
  const child = await launchInstalledTransaction(entry, configuration);
  try {
    child.child.disconnect();
    await child.close();
    const reopened = await launchInstalledTransaction(entry, { ...configuration, create: false });
    try {
      expect(reopened.ready.runtimeConfigurationIdentity).toBe(
        child.ready.runtimeConfigurationIdentity,
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await child.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);

it("retains ordinary Resource /id capture without granting receipt authority", async () => {
  const observed = await observe({
    manifest(value) {
      const row = value.scenarios.find((s) => s.id === "transactional.batch.atomic-commit")!;
      row.actions.find((a) => a.id === "a-point")!.captures = [
        { binding: "ordinary-resource-id", from: { kind: "json-pointer", pointer: "/id" } },
      ];
    },
  });
  expect(
    observed.result.scenarios.find((s) => s.id === "transactional.batch.atomic-commit"),
  ).toMatchObject({ state: "pass" });
}, 30000);

it.each(["ordinary-resource-id"])(
  "does not follow an ordinary Resource /id through binding %s",
  async (binding) => {
    const observed = await observe({
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.batch.atomic-commit")!;
        row.actions.find((a) => a.id === "a-point")!.captures = [
          { binding, from: { kind: "json-pointer", pointer: "/id" } },
        ];
        row.actions.push({
          id: "ordinary-id-as-receipt",
          family: "client",
          operation: "transactional.receipt-read",
          input: { binding, method: "GET" },
          captures: [],
          assertions: [
            { id: "status", kind: "json-pointer", pointer: "/status", exists: true, equals: 200 },
          ],
        });
      },
    });
    const row = observed.result.scenarios.find(
      (s) => s.id === "transactional.batch.atomic-commit",
    )!;
    expect(row).toMatchObject({
      state: "harness-error",
      reason: "receipt not authorized by original wire observation",
    });
    expect(
      row.exchanges.some((e) => e.request.id === "a-point" && e.response?.status === 200),
    ).toBe(true);
    expect(row.exchanges.some((e) => e.request.id === "ordinary-id-as-receipt")).toBe(false);
  },
  30000,
);

it("aborts the actual cohort budget after real wire and drains all installed children", async () => {
  const children: ChildProcess[] = [];
  let seen = false,
    published = false;
  const started = performance.now();
  const run = observe({
    budgetMs: 2000,
    children,
    afterExchange: async (response, signal) => {
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      seen = true;
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    },
  }).then((value) => {
    published = true;
    return value;
  });
  const failure = await run.catch((error: unknown) => error);
  expect(
    [...errorCauses(failure)].some(
      (cause) => cause instanceof Error && cause.message === "installed cohort deadline",
    ),
  ).toBe(true);
  expect(seen).toBe(true);
  expect(published).toBe(false);
  expect(performance.now() - started).toBeLessThan(15000);
  expect(children.length).toBeGreaterThanOrEqual(2);
  expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(published).toBe(false);
}, 20000);

it("refuses a pre-aborted cohort before starting an installed child", async () => {
  const children: ChildProcess[] = [];
  await expect(
    observe({ signal: AbortSignal.abort(new Error("pre-aborted cohort")), children }),
  ).rejects.toThrow("pre-aborted cohort");
  expect(children).toHaveLength(0);
});

it("cancels installed startup through its signal and never publishes a late ready", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-startup-abort-"));
  const configuration = {
    scope,
    directory,
    create: true,
    credentials: [
      { token: randomBytes(32).toString("base64url"), principal: "p", canMutate: true },
    ],
    artifacts: artifacts(),
  };
  try {
    const first = await launchInstalledTransaction(entry, configuration);
    await first.close();
    const controller = new AbortController();
    const pending = launchInstalledTransaction(
      entry,
      { ...configuration, create: false },
      controller.signal,
    );
    controller.abort(new Error("startup cancelled"));
    await expect(pending).rejects.toThrow("startup cancelled");
    const reopened = await launchInstalledTransaction(entry, { ...configuration, create: false });
    await reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);

it("rejects captured receipt binding reuse before installed preparation", async () => {
  const children: ChildProcess[] = [];
  await expect(
    observe({
      children,
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.batch.atomic-commit")!;
        row.actions.find((a) => a.id === "a-point")!.captures = [
          { binding: "commit-receipt", from: { kind: "json-pointer", pointer: "/id" } },
        ];
      },
    }),
  ).rejects.toThrow("scenario manifest: validation failed");
  expect(children).toHaveLength(0);
});

it("records dynamic source/session configuration even when actual receipt HTTP returns401", async () => {
  const observed = await observe({ invalidReceiptCredentials: true });
  const row = observed.result.scenarios.find((s) => s.id === "transactional.batch.atomic-commit")!;
  expect(row.state).toBe("fail");
  const exchange = row.exchanges.find(
    (e) => e.response?.status === 401 && e.request.url.includes("/receipts/"),
  )!;
  expect(exchange).toBeDefined();
  expect(exchange.dynamicExactConfiguration?.routes).toEqual([
    { method: "GET", url: exchange.sourceReceiptObservation!.receipt },
  ]);
  expect(exchange.dynamicExactConfigurationDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(exchange.servedSession).toBeDefined();
  expect(exchange.sourceReceiptObservation).toBeDefined();
  expect(exchange.request.exact?.writeState).toBe("complete");
  expect(exchange.assertions.find((a) => a.id === "actual-status")?.passed).toBe(false);
}, 30000);

it("retains original cohort abort alongside an actual failed child cleanup", async () => {
  const controller = new AbortController(),
    original = new Error("cohort deadline control"),
    children: ChildProcess[] = [];
  const observed = await observe({
    signal: controller.signal,
    children,
    afterExchange: async () => {
      children.at(-1)!.kill("SIGKILL");
      controller.abort(original);
      throw original;
    },
  }).catch((error: unknown) => error);
  expect(observed).toBeInstanceOf(AggregateError);
  const seen = errorCauses(observed);
  expect(seen.has(original)).toBe(true);
  expect(
    [...seen].some(
      (value) =>
        value instanceof Error &&
        value.message === "installed transaction child did not close cleanly",
    ),
  ).toBe(true);
  expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
    true,
  );
}, 20000);

it.each(["matched", "order", "index", "poststate"] as const)(
  "rejects the schema-valid wrong set %s expectation against actual installed results",
  async (kind) => {
    const assertion =
      kind === "matched"
        ? "matched"
        : kind === "order"
          ? "a-id"
          : kind === "index"
            ? "b-index"
            : "properties";
    const actionId = kind === "poststate" ? "target-a-updated" : "set-update";
    const observed = await observe({
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.set.singleton-targets")!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertions = action.assertions as { id: string; equals?: unknown }[];
        assertions.find((a) => a.id === assertion)!.equals =
          kind === "matched"
            ? { operationIndex: 0, outcome: "matched", count: 3 }
            : kind === "order"
              ? `${scope}beads/b`
              : kind === "index"
                ? 1
                : { title: "never-observed" };
      },
    });
    const row = observed.result.scenarios.find(
      (s) => s.id === "transactional.set.singleton-targets",
    )!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(200);
    expect(exchange.assertions.find((a) => a.id === assertion)?.passed).toBe(false);
  },
  120000,
);

it("allows a valid cross-wired set receipt binding but rejects its wrong result oracle", async () => {
  const observed = await observe({
    manifest(value) {
      const row = value.scenarios.find((s) => s.id === "transactional.set.singleton-targets")!;
      const action = row.actions.find((a) => a.id === "set-delete-facts")!;
      action.input = { binding: "set-update-receipt", method: "GET" };
      action.assertions = [
        {
          id: "expected-delete-count",
          kind: "json-pointer",
          pointer: "/body/results/0/count",
          exists: true,
          equals: 1,
        },
      ];
    },
  });
  const row = observed.result.scenarios.find(
    (s) => s.id === "transactional.set.singleton-targets",
  )!;
  expect(row.state).toBe("fail");
  const exchange = row.exchanges.find((e) => e.request.id === "set-delete-facts")!;
  expect(exchange.sourceReceiptObservation?.action).toBe("set-update");
  expect(exchange.request.exact?.writeState).toBe("complete");
  expect(exchange.response?.status).toBe(200);
  expect(
    row.actions
      ?.find((a) => a.action.id === "set-delete-facts")
      ?.assertions?.find((a) => a.id === "expected-delete-count")?.passed,
  ).toBe(false);
}, 120000);

it.each(["update-where", "delete-where"] as const)(
  "refuses an omitted %s route at exact plan preflight before scenario startup or any wire",
  async (suffix) => {
    const children: ChildProcess[] = [];
    let exchanges = 0;
    await expect(
      observe({
        omitRoute: { method: "POST", url: `${scope}operations/${suffix}` },
        children,
        afterExchange: async () => {
          exchanges++;
        },
      }),
    ).rejects.toThrow(
      "Selected exact HTTP requests do not match the configured execution boundary",
    );
    expect(exchanges).toBe(0);
    // Only the attestation bootstrap launched, already closed before preflight.
    // No scenario session or POST source exists from which to grant authority.
    expect(children).toHaveLength(1);
    expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
  },
  120000,
);

it.each(["set-update", "set-delete"] as const)(
  "records the %s source and exact failed dynamic request when its receipt credentials are denied",
  async (action) => {
    const observed = await observe({ invalidReceiptCredentials: action });
    const row = observed.result.scenarios.find(
      (s) => s.id === "transactional.set.singleton-targets",
    )!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.sourceReceiptObservation?.action === action)!;
    expect(exchange.sourceReceiptObservation?.credentialRef).toBe("operator");
    expect(exchange.sourceReceiptObservation?.responseDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(exchange.dynamicExactConfiguration?.routes).toEqual([
      { method: "GET", url: exchange.sourceReceiptObservation!.receipt },
    ]);
    expect(exchange.servedSession).toBeDefined();
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(401);
    expect(exchange.assertions.find((a) => a.id === "actual-status")?.passed).toBe(false);
  },
  120000,
);

it.each([
  [
    "second postimage",
    "transactional.set.mutation",
    "m-updated-b",
    "properties",
    { title: "never-observed" },
  ],
  [
    "rollback metadata",
    "transactional.set.mutation",
    "m-rollback-a",
    "metadata",
    { tag: "never-observed" },
  ],
  ["receipt order", "transactional.set.mutation", "m-update", "a-id", `${scope}beads/b`],
  [
    "Event order",
    "transactional.set.mutation",
    "m-update-events",
    "ordered-facts",
    [
      ["created", `${scope}beads/b`, 0],
      ["created", `${scope}beads/c`, 1],
      ["created", `${scope}beads/a`, 2],
      ["updated", `${scope}beads/b`, 0],
      ["updated", `${scope}beads/a`, 1],
    ],
  ],
  [
    "zero results",
    "transactional.set.zero-match",
    "z-update",
    "exact-results",
    [{ operationIndex: 0, outcome: "matched", count: 1 }],
  ],
  [
    "zero Events",
    "transactional.set.zero-match",
    "z-update-events",
    "ordered-facts",
    [
      ["created", `${scope}beads/a`, 0],
      ["updated", `${scope}beads/a`, 0],
    ],
  ],
  ["no effect", "transactional.set.zero-match", "z-update", "no-effect", true],
] as const)(
  "discriminates actual set effects against wrong %s expectation",
  async (kind, id, actionId, assertionId, wrong) => {
    const observed = await observe({
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === id)!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertion = (action.assertions as { id: string }[]).find(
          (a) => a.id === assertionId,
        ) as {
          equals?: unknown;
          exists?: boolean;
        };
        if (kind === "no effect") assertion.exists = true;
        else assertion.equals = wrong;
      },
    });
    const row = observed.result.scenarios.find((s) => s.id === id)!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(200);
    expect(exchange.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
  },
  120000,
);

it.each([
  ["root next", "p-root-read", "next-page", null],
  ["inline boundary", "p-update", "p30-id", `${scope}beads/p31`],
  ["page member", "p-page-read", "p31-id", `${scope}beads/p30`],
  ["page parent", "p-page-read", "parent", `${scope}receipts/wrong`],
  ["historical title", "p-page-retained", "historical-title", "later"],
  ["terminal next", "p-page-read", "no-next", `${scope}receipts/wrong/pages/next`],
] as const)(
  "discriminates receipt pagination against wrong %s expectation",
  async (_kind, actionId, assertionId, wrong) => {
    const observed = await observe({
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.receipt.pagination")!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertion = (
          action.assertions as { id: string; equals?: unknown; equalsBinding?: string }[]
        ).find((a) => a.id === assertionId)!;
        delete assertion.equalsBinding;
        assertion.equals = wrong;
      },
    });
    const row = observed.result.scenarios.find((s) => s.id === "transactional.receipt.pagination")!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(200);
    const assertionResults =
      actionId === "p-update"
        ? exchange.assertions
        : row.actions!.find((a) => a.action.id === actionId)!.assertions;
    expect(assertionResults.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
  },
  120000,
);

it.each([
  ["conflict code", "c-conflict", "problem-code", "malformed-request", 409],
  ["reopened conflict status", "c-conflict-reopened", "http-status", 200, 409],
  [
    "current record",
    "c-state",
    "ordered-state",
    [[`${scope}beads/b`, `${scope}types/task`, { title: "original" }, { tag: "conflict" }]],
    200,
  ],
  ["retained replay body", "c-retry-reopened", "retained-body", {}, 200],
  [
    "unchanged Event",
    "c-events-reopened",
    "ordered-facts",
    [[`${scope}events/`, "created", `${scope}beads/b`, 0]],
    200,
  ],
] as const)(
  "discriminates completed-key conflict against wrong %s expectation",
  async (kind, actionId, assertionId, wrong, status) => {
    const children: ChildProcess[] = [];
    const observed = await observe({
      children,
      manifest(value) {
        const row = value.scenarios.find((s) => s.id === "transactional.idempotency.conflict")!;
        const action = row.actions.find((a) => a.id === actionId)!;
        const assertion = (
          action.assertions as { id: string; equals?: unknown; equalsBinding?: string }[]
        ).find((a) => a.id === assertionId)!;
        delete assertion.equalsBinding;
        assertion.equals = wrong;
      },
    });
    const row = observed.result.scenarios.find(
      (s) => s.id === "transactional.idempotency.conflict",
    )!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(status);
    expect(exchange.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
    expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
      true,
    );
    console.log(
      JSON.stringify({
        kind: "installed-tx-completed-conflict-control",
        control: kind,
        sourceCommit,
        actionId,
        assertionId,
        observedStatus: exchange.response?.status,
        writeState: exchange.request.exact?.writeState,
        failures: exchange.assertions.filter((a) => !a.passed).map((a) => a.id),
        childLaunches: children.length,
        closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
        artifacts: observed.result.artifacts,
        declarations: observed.result.declarations,
        baseline: observed.baseline,
        claimEligible: false,
      }),
    );
  },
  120000,
);
