import { execFileSync, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
import schema from "../../../specs/profiles/core/bdp-v0.schema.json" with { type: "json" };
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
type InstalledObservation = {
  result: Awaited<ReturnType<typeof runCumulativeTransactionalMatrix>>;
  sessions: Record<string, unknown>[];
  baseline: ReturnType<typeof installedTransactionBinding>;
};
async function observe(control?: {
  readonly budgetMs?: number;
  /** Negative-test deadline begins after the first real exchange, with startup still bounded. */
  readonly afterFirstExchangeBudgetMs?: number;
  readonly scenarioSelection?: readonly string[];
  readonly collapsePrincipalB?: boolean;
  readonly onDispatch?: (request: PrincipalDispatchInput) => void;
  /** Retain genuine returned evidence before cleanup can fail; never replace it. */
  readonly onObserved?: (observed: InstalledObservation) => void;
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
  const afterFirstExchangeBudgetMs = control?.afterFirstExchangeBudgetMs;
  if (
    afterFirstExchangeBudgetMs !== undefined &&
    (!Number.isSafeInteger(afterFirstExchangeBudgetMs) ||
      afterFirstExchangeBudgetMs < 1 ||
      afterFirstExchangeBudgetMs > budgetMs)
  )
    throw new Error("invalid after-first-exchange cohort budget");
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
  const tokens: PrincipalTokens = {
    operator: randomBytes(32).toString("base64url"),
    reader: randomBytes(32).toString("base64url"),
    principalA: randomBytes(32).toString("base64url"),
    principalARotated: randomBytes(32).toString("base64url"),
    principalB: randomBytes(32).toString("base64url"),
  };
  const roles = principalCredentialRoles(tokens, control?.collapsePrincipalB ?? false);
  const configuration = {
    scope,
    directory: path.join(directory, "bootstrap"),
    create: true,
    credentials: roles.map(({ token, principal, canMutate }) => ({ token, principal, canMutate })),
    artifacts: artifacts(),
  };
  let target: ReturnType<typeof createTransactionalExecutionBinding> | undefined;
  const sessions: Record<string, unknown>[] = [];
  const deniedReceiptUrls = new Set<string>();
  const expireCohort = () => controller.abort(new Error("installed cohort deadline"));
  const timer = setTimeout(expireCohort, budgetMs);
  let firstExchangeTimer: ReturnType<typeof setTimeout> | undefined;
  let observed: InstalledObservation | undefined;
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
      { method: "POST", url: `${scope}operations/batch` },
      { method: "GET", url: `${scope}beads/?limit=32` },
      { method: "GET", url: `${scope}events/` },
      { method: "POST", url: `${scope}operations/create-bead` },
      { method: "POST", url: `${scope}operations/sequence` },
      { method: "POST", url: `${scope}operations/update-bead` },
      { method: "GET", url: `${scope}beads/a` },
      { method: "GET", url: `${scope}links/l` },
      { method: "GET", url: `${scope}beads/new` },
      { method: "GET", url: `${scope}changes/?after=genesis` },
      { method: "GET", url: `${scope}links/?limit=32` },
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
        ...roles.map(({ ref }) => ({ id: ref, headerNames: ["authorization"] })),
        { id: "anonymous", headerNames: [] },
      ],
      resolveCredentials: ({ credentialRef, url }) =>
        principalHeaders(
          roles,
          credentialRef,
          (control?.invalidReceiptCredentials === true && url.startsWith(`${scope}receipts/`)) ||
            deniedReceiptUrls.has(url),
        ),
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
        ...(control?.scenarioSelection === undefined
          ? {}
          : { scenarioSelection: control.scenarioSelection }),
        execute: async () => {
          throw new Error("generic HTTP executor forbidden");
        },
        exactExecution: {
          execute: async (request) => {
            control?.onDispatch?.(
              Object.freeze({
                method: request.method,
                url: request.url,
                credentialRef: request.credentialRef,
              }),
            );
            const response = await target!.target.execute(request);
            if (afterFirstExchangeBudgetMs !== undefined && firstExchangeTimer === undefined) {
              firstExchangeTimer = setTimeout(expireCohort, afterFirstExchangeBudgetMs);
            }
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
    control?.onObserved?.(observed);
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
      clearTimeout(firstExchangeTimer);
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
it("observes sixteen partial Transactional contracts through packed-capable actual installed HTTP", async () => {
  const started = performance.now(),
    children: ChildProcess[] = [];
  const crossWire = crossCarrierWire(),
    minimumWire = commandMinimumWire(),
    memberWire = sequenceMemberWire(),
    principalWire = principalNamespaceWire();
  const observed = await observe({
    children,
    onDispatch: principalWire.onDispatch,
    afterExchange: withPrincipalWire(
      principalWire,
      composedMemberWire(crossWire, minimumWire, memberWire),
    ),
    onObserved(observed) {
      if (process.env.BDP_TRANSACTIONAL_OBSERVATION_OUTPUT)
        writeFileSync(
          process.env.BDP_TRANSACTIONAL_OBSERVATION_OUTPUT,
          JSON.stringify(
            {
              sourceCommit,
              entry,
              ...observed,
              supplemental: minimumWire.summary(),
              sequenceMemberSupplemental: memberWire.summary(),
              principalSupplemental: principalWire.summary(observed),
            },
            null,
            2,
          ) + "\n",
        );
    },
  });
  const implemented = new Set(bundle.manifest.scenarios.map((s) => s.id));
  expect(loadProfileContractSelection("transactional").required).toHaveLength(251);
  expect(observed.result.scenarios).toHaveLength(256); // Includes five optional catalog rows.
  for (const row of observed.result.scenarios.filter((s) => implemented.has(s.id)))
    expect(row, JSON.stringify(row, null, 2)).toMatchObject({ state: "pass" });
  expect(observed.result.scenarios.filter((s) => s.state === "pass")).toHaveLength(16);
  expect(observed.result.claimEligible).toBe(false);
  expect(observed.sessions).toHaveLength(23);
  expect(children).toHaveLength(24); // Twenty-three scenario/reopen sessions plus separate bootstrap.
  expect(children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(
    true,
  );
  expect(observed.result.declarations).toMatchObject({
    exactConfigurationDigest: "9a9404e74dd41fcb39b9c3bb5fc86917ff972dfdbc95faa5f53d13b35bb60bec",
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
  const newRows = observed.result.scenarios.filter((row) =>
    [
      "transactional.set.mutation",
      "transactional.set.zero-match",
      "transactional.batch.no-op-entries",
      "transactional.batch.deletion-safety",
    ].includes(row.id),
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
  const noop = observed.result.scenarios.find(
    (row) => row.id === "transactional.batch.no-op-entries",
  )!;
  expect(noop.exchanges.map((e) => e.request.id)).toEqual([
    "n-seed",
    "n-seed-facts",
    "n-seed-groups",
    "n-noop",
    "n-noop-facts",
    "n-noop-beads",
    "n-noop-link",
    "n-noop-events",
    "n-noop-groups",
    "n-changed",
    "n-changed-facts",
    "n-changed-beads",
    "n-changed-link",
    "n-changed-events",
    "n-changed-groups",
  ]);
  // Result.actions contains client observations only; result.exchanges contains
  // all actual HTTP, including each client's receipt GET.
  expect(noop.actions!.map((a) => a.action.id)).toEqual([
    "n-seed-facts",
    "n-noop-facts",
    "n-changed-facts",
  ]);
  for (const exchange of noop.exchanges)
    expect(exchange.assertions.every((a) => a.passed)).toBe(true);
  for (const action of noop.actions!) {
    expect(action.assertions.every((a) => a.passed)).toBe(true);
    expect(noop.exchanges.find((e) => e.request.id === action.action.id)).toBeDefined();
  }
  // A successful final action includes scoped URL capture validation after its
  // assertions. Presence alone would still accept a null continuation.
  expect(noop.state).toBe("pass");
  expect(noop.exchanges.at(-1)!.request.id).toBe("n-changed-groups");
  const deletion = observed.result.scenarios.find(
    (row) => row.id === "transactional.batch.deletion-safety",
  )!;
  expect(deletion.exchanges.map((e) => e.request.id)).toEqual([
    "d-seed",
    "d-seed-facts",
    "d-seed-events",
    "d-seed-groups",
    "d-incoming-survives",
    "d-incoming-survives-beads",
    "d-incoming-survives-links",
    "d-incoming-survives-events",
    "d-incoming-survives-groups",
    "d-outgoing-survives",
    "d-outgoing-survives-beads",
    "d-outgoing-survives-links",
    "d-outgoing-survives-events",
    "d-outgoing-survives-groups",
    "d-delete",
    "d-delete-facts",
    "d-final-beads",
    "d-final-links",
    "d-deleted-a",
    "d-final-events",
    "d-final-groups",
  ]);
  expect(deletion.actions!.map((a) => a.action.id)).toEqual(["d-seed-facts", "d-delete-facts"]);
  for (const exchange of deletion.exchanges)
    expect(exchange.assertions.every((a) => a.passed)).toBe(true);
  for (const action of deletion.actions!) {
    expect(action.assertions.every((a) => a.passed)).toBe(true);
    expect(deletion.exchanges.find((e) => e.request.id === action.action.id)).toBeDefined();
  }
  expect(deletion.state).toBe("pass");
  expect(deletion.exchanges.at(-1)!.request.id).toBe("d-final-groups");
  const cross = observed.result.scenarios.find((r) => r.id === crossCarrierId)!;
  expect(cross.exchanges.map((e) => e.request.id)).toEqual(crossCarrierActionIds);
  expect(cross.exchanges.map((e) => e.request.method)).toEqual([
    "POST",
    "GET",
    "POST",
    "POST",
    "POST",
    "GET",
    "POST",
    "POST",
    "POST",
    "POST",
    "GET",
    "GET",
  ]);
  expect(cross.actions!.map((a) => a.action.id)).toEqual(["x-created-facts", "x-updated-facts"]);
  for (const exchange of cross.exchanges) {
    expect(exchange.assertions.every((a) => a.passed)).toBe(true);
    if (exchange.request.method === "POST")
      expect(exchange.request.exact!.bodyOctets).toBeLessThanOrEqual(2048);
    expect(exchange.response!.decodedBodyBytes).toBeLessThanOrEqual(8192);
  }
  for (const action of cross.actions!) expect(action.assertions.every((a) => a.passed)).toBe(true);
  expect(cross.state).toBe("pass");
  expect(cross.exchanges.at(-1)!.request.id).toBe("x-events");
  crossWire.finish();
  assertCommandMinimumPositive(observed, minimumWire);
  assertMemberPositive(observed, memberWire);
  assertPrincipalPositive(observed, principalWire);
  expect(observed.result.scenarios.reduce((n, row) => n + row.exchanges.length, 0)).toBe(220);
  expect(performance.now() - started).toBeLessThanOrEqual(63000);
  console.log(
    JSON.stringify({
      // Predecessor logs retain installed-tx-twelve/thirteen/fourteen-partial-summary.
      kind: "installed-tx-sixteen-partial-summary",
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
        const action = value.scenarios
          .find((r) => r.id === "transactional.batch.atomic-commit")!
          .actions.find((a) => a.operation === "transactional.receipt-read")!;
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
    budgetMs: 10000,
    afterFirstExchangeBudgetMs: 100,
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
    expect(observed.result.claimEligible).toBe(false);
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
        claimEligible: observed.result.claimEligible,
      }),
    );
  },
  120000,
);

it("pins the matching no-op installed route digest and fifteen-action ledger", () => {
  assertPrincipalStatic();
  assertMemberReplayLedger(memberReplayLedger);
  expect(() => assertMemberReplayLedger([])).toThrow("sequence-member-replay-ledger");
  expect(() => assertMemberReplayLedger([["s-replay", "s-first-receipt", "whole-json"]])).toThrow(
    "sequence-member-replay-ledger",
  );
  const digest = createHash("sha256")
    .update(JSON.stringify(memberRequests()[0]!.body))
    .digest("hex");
  expect(digest).toBe("f3cde631127aaf530ea5349330e6c7bb46766b02b135f9c7c59acfcd2f2c71c7");
  expect(digest).not.toBe(
    createHash("sha256").update(JSON.stringify(minimumRequests()[4]!.body)).digest("hex"),
  );
  for (const index of [0, 4])
    expect(memberHandoff(index, `${scope}operations/sequence`, digest, undefined, "complete")).toBe(
      true,
    );
  for (const index of [1, 2, 3, 5, 6, 7])
    expect(memberHandoff(index, `${scope}operations/sequence`, digest, undefined, "complete")).toBe(
      false,
    );
  expect(
    memberHandoff(0, `${scope}operations/sequence`, digest, "carrier-create", "complete"),
  ).toBe(false);
  expect(memberHandoff(0, `${scope}operations/sequence`, digest, undefined, "partial")).toBe(false);
  for (const key of ["member-a", "member-fail", "member-b"]) {
    expect(key.startsWith("minimum-")).toBe(false);
    expect(["carrier-create", "carrier-update"]).not.toContain(key);
  }
  assertMinimumReplayLedger(minimumReplayLedger);
  expect(() => assertMinimumReplayLedger(minimumReplayLedger.slice(1))).toThrow(
    "minimum-replay-comparison-ledger",
  );
  const redirected = minimumReplayLedger.map((pair) => [...pair]);
  redirected[0]![1] = "m-create-b";
  expect(() => assertMinimumReplayLedger(redirected)).toThrow("minimum-replay-comparison-ledger");
  // Previous command-minimum route order: 02dd7d9f35e7482c07ce1550a6572232cc48ba6858cd66f8dfc8f5384f3628be.
  // Previous fifteen-route order: a9a17908b6fa87674d5f573b584f4a1ce1d41d7909fadf48b65e9b05397ddfd4.
  // Previous twelve-route digest: 1ba7cbbffc4fb40df2c3f12640bc636e70076cfa25bdd6952b83ec1bb1fe0035.
  // Canonical exact-mode preimage authored from the approved route inventory;
  // only these five fields enter the runner digest, not credentials or ports.
  const preimage = JSON.stringify({
    maximumRequestBodyBytes: 65536,
    maximumRequestHeaderBytes: 16384,
    profile: "transactional",
    routes: [
      { method: "POST", url: `${scope}operations/batch` },
      { method: "GET", url: `${scope}beads/?limit=32` },
      { method: "GET", url: `${scope}events/` },
      { method: "POST", url: `${scope}operations/create-bead` },
      { method: "POST", url: `${scope}operations/sequence` },
      { method: "POST", url: `${scope}operations/update-bead` },
      { method: "GET", url: `${scope}beads/a` },
      { method: "GET", url: `${scope}links/l` },
      { method: "GET", url: `${scope}beads/new` },
      { method: "GET", url: `${scope}changes/?after=genesis` },
      { method: "GET", url: `${scope}links/?limit=32` },
      { method: "GET", url: `${scope}beads/b` },
      { method: "GET", url: `${scope}beads/c` },
      { method: "POST", url: `${scope}operations/update-where` },
      { method: "POST", url: `${scope}operations/delete-where` },
    ],
    scope,
  });
  expect(createHash("sha256").update(preimage).digest("hex")).toBe(
    "9a9404e74dd41fcb39b9c3bb5fc86917ff972dfdbc95faa5f53d13b35bb60bec",
  );
  expect(Buffer.byteLength(preimage)).toBe(1228);
  // The reordered first use must not grant or remove any old route authority.
  const oldRoutes = [
    { method: "GET", url: `${scope}beads/a` },
    { method: "POST", url: `${scope}operations/batch` },
    { method: "GET", url: `${scope}links/l` },
    { method: "GET", url: `${scope}beads/?limit=32` },
    { method: "GET", url: `${scope}events/` },
    { method: "GET", url: `${scope}beads/new` },
    { method: "GET", url: `${scope}changes/?after=genesis` },
    { method: "GET", url: `${scope}links/?limit=32` },
    { method: "GET", url: `${scope}beads/b` },
    { method: "GET", url: `${scope}beads/c` },
    { method: "POST", url: `${scope}operations/update-where` },
    { method: "POST", url: `${scope}operations/delete-where` },
    { method: "POST", url: `${scope}operations/create-bead` },
    { method: "POST", url: `${scope}operations/sequence` },
    { method: "POST", url: `${scope}operations/update-bead` },
  ];
  const routeKey = (route: { method: string; url: string }) => `${route.method} ${route.url}`;
  expect(
    (JSON.parse(preimage).routes as { method: string; url: string }[]).map(routeKey).sort(),
  ).toEqual(oldRoutes.map(routeKey).sort());
  const row = bundle.manifest.scenarios.find((r) => r.id === "transactional.batch.no-op-entries")!;
  expect(row.actions!.map((a) => a.id)).toEqual([
    "n-seed",
    "n-seed-facts",
    "n-seed-groups",
    "n-noop",
    "n-noop-facts",
    "n-noop-beads",
    "n-noop-link",
    "n-noop-events",
    "n-noop-groups",
    "n-changed",
    "n-changed-facts",
    "n-changed-beads",
    "n-changed-link",
    "n-changed-events",
    "n-changed-groups",
  ]);
  expect(row.actions!.filter((a) => a.family === "http")).toHaveLength(12);
  expect(row.actions!.filter((a) => a.family === "client")).toHaveLength(3);
  expect(row.actions!.flatMap((a) => a.assertions)).toHaveLength(223);
  expect(row.actions!.at(-1)!.captures).toEqual([
    { binding: "n-changed-next", from: { kind: "json-pointer", pointer: "/next" } },
  ]);
});

it.each(["bead-property", "link-metadata", "group-inventory-and-head"] as const)(
  "discriminates matching no-op evidence against %s",
  async (control) => {
    const children: ChildProcess[] = [];
    const actionId = control === "group-inventory-and-head" ? "n-noop-groups" : "n-noop";
    const observed = await observe({
      children,
      manifest(value) {
        const row = value.scenarios.find((r) => r.id === "transactional.batch.no-op-entries")!;
        const action = row.actions.find((a) => a.id === actionId)!;
        if (control === "group-inventory-and-head") {
          const assertions = action.assertions as { id: string; equals?: unknown }[];
          assertions.find((a) => a.id === "group-inventory")!.equals = [["pos-1"], ["pos-2"]];
          assertions.find((a) => a.id === "observed-head")!.equals = "pos-2";
        } else {
          const raw = action.raw as { body: { value: string } };
          const body = JSON.parse(raw.body.value);
          if (control === "bead-property")
            body.operations[0].propertiesChange[0].value = "different";
          else body.operations[1].metadataChange[0].value = { tag: "different" };
          raw.body.value = JSON.stringify(body);
        }
      },
    });
    expect(observed.result.claimEligible).toBe(false);
    expect(observed.result.artifacts.manifestDigest).not.toBe(bundle.digests.manifestDigest);
    const row = observed.result.scenarios.find(
      (r) => r.id === "transactional.batch.no-op-entries",
    )!;
    expect(row.state).toBe("fail");
    const exchange = row.exchanges.find((e) => e.request.id === actionId)!;
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.response?.status).toBe(200);
    const failed = exchange.assertions.filter((a) => !a.passed).map((a) => a.id);
    expect(exchange.assertions.find((a) => a.id === "schema")?.passed).toBe(true);
    if (control !== "group-inventory-and-head")
      expect(exchange.assertions.find((a) => a.id === "disposition")?.passed).toBe(true);
    const intended =
      control === "bead-property"
        ? ["bead-retained-record"]
        : control === "link-metadata"
          ? ["link-retained-record"]
          : ["group-inventory", "observed-head"];
    for (const id of intended) expect(failed).toContain(id);
    if (control === "group-inventory-and-head")
      expect([...failed].sort()).toEqual([...intended].sort());
    expect(row.exchanges.at(-1)!.request.id).toBe(actionId);
    expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
    expect(children.length).toBeLessThanOrEqual(24);
    const exchanges = observed.result.scenarios.reduce((n, r) => n + r.exchanges.length, 0);
    expect(exchanges).toBeLessThanOrEqual(control === "group-inventory-and-head" ? 214 : 209);
    for (const later of observed.result.scenarios.filter(
      (r) => bundle.manifest.scenarios.some((p) => p.id === r.id) && r.id !== row.id,
    ))
      expect(later.state).toBe("pass");
    console.log(
      JSON.stringify({
        kind: "installed-tx-matching-noop-control",
        control,
        sourceCommit,
        actionId,
        observedStatus: exchange.response!.status,
        writeState: exchange.request.exact!.writeState,
        intended,
        failures: failed,
        exchanges,
        sessions: observed.sessions.length,
        childLaunches: children.length,
        closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
        artifacts: observed.result.artifacts,
        declarations: observed.result.declarations,
        baseline: observed.baseline,
        claimEligible: observed.result.claimEligible,
      }),
    );
    if (process.env.BDP_TRANSACTIONAL_NOOP_CONTROL_OUTPUT)
      writeFileSync(
        `${process.env.BDP_TRANSACTIONAL_NOOP_CONTROL_OUTPUT}-${control}.json`,
        JSON.stringify({ sourceCommit, entry, ...observed }, null, 2) + "\n",
      );
  },
  120000,
);

const deletionControlNames = [
  "incoming-order",
  "outgoing-order",
  "committed-prefix-state",
] as const;
type DeletionControl = (typeof deletionControlNames)[number];
// Only these three fixed derivative carriers are supported. The positive request
// and response facts are authored independently; no observed body supplies an oracle.
function applyDeletionControl(
  value: { scenarios: { id: string; actions: Record<string, unknown>[] }[] },
  control: DeletionControl,
) {
  const direction = control === "outgoing-order" ? "outgoing" : "incoming";
  const actionId = `d-${direction}-survives`;
  const row = value.scenarios.find((r) => r.id === "transactional.batch.deletion-safety")!;
  const action = row.actions.find((a) => a.id === actionId)!;
  const oldAssertions = action.assertions as Record<string, unknown>[];
  const task = `${scope}types/task`,
    relationship = `${scope}types/relationship`;
  const prefix = `${direction}-survives-prefix`;
  const links = direction === "incoming" ? ["l", "r"] : ["r", "l"];
  const operations = [
    {
      operation: "updateBead",
      bead: "beads/b",
      propertiesChange: [{ op: "replace", path: "/title", value: prefix }],
      metadataChange: [{ op: "replace", path: "", value: { phase: prefix } }],
    },
    ...links.map((id) => ({ operation: "deleteLink", link: `links/${id}` })),
    ...(control === "committed-prefix-state" ? [] : [{ operation: "deleteBead", bead: "beads/a" }]),
  ];
  const raw = action.raw as { body: { encoding: string; value: string } };
  raw.body = { encoding: "utf8", value: JSON.stringify({ operations }) };
  const pointer = (id: string, pointer: string, equals: unknown) => ({
    id: `control-${id}`,
    kind: "json-pointer",
    pointer,
    exists: true,
    equals,
  });
  const deleted = [...links, ...(control === "committed-prefix-state" ? [] : ["a"])];
  const positive: Record<string, unknown>[] = [
    { id: "control-position", kind: "header", name: "bdp-scope-position", equals: "pos-2" },
    pointer("completed", "/status", "completed"),
    pointer("detail", "/detail", "available"),
    pointer("required", "/requiredPosition", "pos-2"),
    pointer("effect", "/effectPosition", "pos-2"),
    pointer("inline", "/next", null),
    {
      id: "control-ordered-results",
      kind: "json-array-tuples",
      pointer: "/results",
      ordered: true,
      projections: [{ pointer: "/operationIndex" }, { pointer: "/outcome" }],
      equals: [[0, "updated"], ...deleted.map((_, i) => [i + 1, "deleted"])],
    },
    pointer("updated-id", "/results/0/resource/id", `${scope}beads/b`),
    pointer("updated-type", "/results/0/resource/type", task),
    pointer("updated-properties", "/results/0/resource/properties", { title: prefix }),
    pointer("updated-metadata", "/results/0/resource/metadata", { phase: prefix }),
    ...deleted.flatMap((id, i) => [
      pointer(`${id}-kind`, `/results/${i + 1}/deleted/resourceKind`, id === "a" ? "bead" : "link"),
      pointer(
        `${id}-id`,
        `/results/${i + 1}/deleted/resource/id`,
        `${scope}${id === "a" ? "beads" : "links"}/${id}`,
      ),
      pointer(
        `${id}-type`,
        `/results/${i + 1}/deleted/resource/type`,
        id === "a" ? task : relationship,
      ),
      {
        id: `control-${id}-revision`,
        kind: "json-pointer",
        pointer: `/results/${i + 1}/deleted/resource/revision`,
        exists: true,
        equalsBinding: `d-${id}-revision`,
      },
    ]),
  ];
  const stableIds = [
    "http-status",
    "present-bdp-scope-epoch",
    "present-bdp-authorization-view",
    "present-bdp-scope-position",
    "schema",
    "request-headers",
    "request-body",
  ];
  // Control3 must pass every POST assertion before the next real state GET can
  // reveal its changed b. Retaining baseline context/failed-receipt facts here
  // would stop too early and invalidate the state sensitivity claim.
  action.assertions =
    control === "committed-prefix-state"
      ? [...oldAssertions.filter((a) => stableIds.includes(a.id as string)), ...positive]
      : [...oldAssertions, ...positive];
  const assertions = action.assertions as Record<string, unknown>[];
  const added = assertions
    .filter((a) => !oldAssertions.some((o) => o.id === a.id))
    .map((a) => a.id as string);
  const removed = oldAssertions
    .filter((a) => !assertions.some((o) => o.id === a.id))
    .map((a) => a.id as string);
  return {
    actionId,
    finalActionId: control === "committed-prefix-state" ? "d-incoming-survives-beads" : actionId,
    positiveIds: positive.map((a) => a.id as string),
    stableIds,
    added,
    removed,
    netAssertions: assertions.length - oldAssertions.length,
  };
}

it("pins deletion-safety derivative carriers, complete positives, and measured source bounds", () => {
  assertPrincipalStatic();
  assertMemberControl();
  assertCrossCarrierControls();
  assertCommandMinimumControls();
  const canonical = JSON.parse(manifestSource.bytes.toString());
  const canonicalCount = canonical.scenarios.flatMap(
    (r: { actions: { assertions: unknown[] }[] }) => r.actions.flatMap((a) => a.assertions),
  ).length;
  const rows = [];
  for (const control of deletionControlNames) {
    const changed = structuredClone(canonical);
    const description = applyDeletionControl(changed, control);
    const row = changed.scenarios.find(
      (r: { id: string }) => r.id === "transactional.batch.deletion-safety",
    )!;
    const action = row.actions.find((a: { id: string }) => a.id === description.actionId)!;
    const body = JSON.parse(action.raw.body.value);
    const direction = control === "outgoing-order" ? "outgoing" : "incoming";
    expect(
      body.operations.map((op: { operation: string; bead?: string; link?: string }) => [
        op.operation,
        op.bead ?? op.link,
      ]),
    ).toEqual([
      ["updateBead", "beads/b"],
      ["deleteLink", direction === "incoming" ? "links/l" : "links/r"],
      ["deleteLink", direction === "incoming" ? "links/r" : "links/l"],
      ...(control === "committed-prefix-state" ? [] : [["deleteBead", "beads/a"]]),
    ]);
    expect(body.operations[0]).toEqual({
      operation: "updateBead",
      bead: "beads/b",
      propertiesChange: [{ op: "replace", path: "/title", value: `${direction}-survives-prefix` }],
      metadataChange: [
        { op: "replace", path: "", value: { phase: `${direction}-survives-prefix` } },
      ],
    });
    expect(description.positiveIds).toEqual([
      "control-position",
      "control-completed",
      "control-detail",
      "control-required",
      "control-effect",
      "control-inline",
      "control-ordered-results",
      "control-updated-id",
      "control-updated-type",
      "control-updated-properties",
      "control-updated-metadata",
      ...(direction === "incoming" ? ["l", "r"] : ["r", "l"]).flatMap((id) => [
        `control-${id}-kind`,
        `control-${id}-id`,
        `control-${id}-type`,
        `control-${id}-revision`,
      ]),
      ...(control === "committed-prefix-state"
        ? []
        : ["control-a-kind", "control-a-id", "control-a-type", "control-a-revision"]),
    ]);
    if (control === "committed-prefix-state") {
      expect(description.removed).toEqual([
        "serving-context",
        "disposition",
        "detail",
        "required-position",
        "no-effect",
        "no-results",
        "no-next",
        "problem",
      ]);
      expect(action.assertions.map((a: { id: string }) => a.id)).toEqual([
        ...description.stableIds,
        ...description.positiveIds,
      ]);
      expect(row.actions.find((a: { id: string }) => a.id === description.finalActionId)).toEqual(
        canonical.scenarios
          .find((r: { id: string }) => r.id === row.id)
          .actions.find((a: { id: string }) => a.id === description.finalActionId),
      );
    } else {
      expect(description.removed).toEqual([]);
      expect(action.assertions.find((a: { id: string }) => a.id === "disposition").equals).toBe(
        "failed",
      );
    }
    expect(row.actions).toHaveLength(21);
    const count = changed.scenarios.flatMap((r: { actions: { assertions: unknown[] }[] }) =>
      r.actions.flatMap((a) => a.assertions),
    ).length;
    expect(count).toBe(canonicalCount + description.netAssertions);
    const normal = JSON.stringify(changed, null, 2) + "\n",
      wire = JSON.stringify(changed);
    let nodes = 0;
    const pending: unknown[] = [changed];
    while (pending.length) {
      const value = pending.pop();
      nodes++;
      if (value && typeof value === "object") pending.push(...Object.values(value));
    }
    // Historical root-accepted maximum701716B/18263nodes plus4096B/64nodes.
    // Command-minimum measured maximum756707B/19731nodes plus4096B/64nodes.
    expect(Buffer.byteLength(normal)).toBeLessThanOrEqual(847979);
    expect(nodes).toBeLessThanOrEqual(22128);
    const loaded = createCumulativeTransactionalArtifactBundle(
      loadProfileContractSelection("transactional"),
      { fixture: fixtureSource, manifest: { bytes: Buffer.from(wire) } },
    );
    rows.push({
      control,
      ...description,
      normalBytes: Buffer.byteLength(normal),
      wireBytes: Buffer.byteLength(wire),
      nodes,
      canonicalAssertions: canonicalCount,
      derivativeAssertions: count,
      normalDigest: createHash("sha256").update(normal).digest("hex"),
      executionManifestDigest: loaded.digests.manifestDigest,
      rawRequestBytes: Buffer.byteLength(action.raw.body.value),
      actionAssertionIds: action.assertions.map((a: { id: string }) => a.id),
    });
    if (process.env.BDP_TRANSACTIONAL_DELETION_PREFLIGHT_OUTPUT)
      writeFileSync(
        `${process.env.BDP_TRANSACTIONAL_DELETION_PREFLIGHT_OUTPUT}-${control}.json`,
        normal,
      );
  }
  expect(new Set(rows.map((r) => r.executionManifestDigest)).size).toBe(3);
  if (process.env.BDP_TRANSACTIONAL_DELETION_PREFLIGHT_OUTPUT)
    writeFileSync(
      `${process.env.BDP_TRANSACTIONAL_DELETION_PREFLIGHT_OUTPUT}-ledger.json`,
      JSON.stringify(rows, null, 2) + "\n",
    );
});

it.each(deletionControlNames)(
  "discriminates operation-time deletion evidence against %s",
  async (control) => {
    const children: ChildProcess[] = [];
    let description: ReturnType<typeof applyDeletionControl> | undefined;
    const observed = await observe({
      children,
      manifest(value) {
        description = applyDeletionControl(value, control);
      },
    });
    expect(observed.result.claimEligible).toBe(false);
    expect(observed.result.artifacts.manifestDigest).not.toBe(bundle.digests.manifestDigest);
    const row = observed.result.scenarios.find(
      (r) => r.id === "transactional.batch.deletion-safety",
    )!;
    expect(row.state).toBe("fail");
    const post = row.exchanges.find((e) => e.request.id === description!.actionId)!;
    expect(post.request.exact?.writeState).toBe("complete");
    expect(post.response?.status).toBe(200);
    for (const id of [...description!.stableIds, ...description!.positiveIds])
      expect(post.assertions.find((a) => a.id === id)?.passed, id).toBe(true);
    const failedPost = post.assertions.filter((a) => !a.passed).map((a) => a.id);
    const final = row.exchanges.at(-1)!;
    expect(final.request.id).toBe(description!.finalActionId);
    const failures = final.assertions.filter((a) => !a.passed).map((a) => a.id);
    if (control === "committed-prefix-state") {
      expect(failedPost).toEqual([]);
      expect(row.exchanges.slice(0, -1).every((e) => e.assertions.every((a) => a.passed))).toBe(
        true,
      );
      expect(row.actions!.every((a) => a.assertions.every((s) => s.passed))).toBe(true);
      expect(final.response?.status).toBe(200);
      expect(final.assertions.find((a) => a.id === "schema")?.passed).toBe(true);
      expect(failures).toContain("complete-b");
      expect(failures).toContain("ordered-identities");
    } else {
      expect(failedPost).toContain("disposition");
      expect([...failedPost].sort()).toEqual(
        [
          "serving-context",
          "disposition",
          "required-position",
          "no-effect",
          "no-results",
          "no-next",
          "problem",
        ].sort(),
      );
    }
    expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
    expect(children.length).toBeLessThanOrEqual(24);
    const exchanges = observed.result.scenarios.reduce((n, r) => n + r.exchanges.length, 0);
    expect(exchanges).toBeLessThanOrEqual(
      control === "incoming-order" ? 204 : control === "outgoing-order" ? 209 : 205,
    );
    for (const later of observed.result.scenarios.filter(
      (r) => bundle.manifest.scenarios.some((p) => p.id === r.id) && r.id !== row.id,
    ))
      expect(later.state).toBe("pass");
    console.log(
      JSON.stringify({
        kind: "installed-tx-deletion-control",
        control,
        sourceCommit,
        ...description,
        failedPost,
        finalAction: final.request.id,
        finalStatus: final.response?.status,
        failures,
        exchanges,
        sessions: observed.sessions.length,
        childLaunches: children.length,
        closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
        artifacts: observed.result.artifacts,
        declarations: observed.result.declarations,
        baseline: observed.baseline,
        claimEligible: observed.result.claimEligible,
      }),
    );
    if (process.env.BDP_TRANSACTIONAL_DELETION_CONTROL_OUTPUT)
      writeFileSync(
        `${process.env.BDP_TRANSACTIONAL_DELETION_CONTROL_OUTPUT}-${control}.json`,
        JSON.stringify({ sourceCommit, entry, ...observed }, null, 2) + "\n",
      );
  },
  120000,
);

const crossCarrierId = "transactional.idempotency.cross-carrier";
const crossCarrierActionIds = [
  "x-create",
  "x-created-facts",
  "x-create-batch",
  "x-create-sequence",
  "x-update",
  "x-updated-facts",
  "x-two-sequence",
  "x-update-singleton",
  "x-create-singleton-retry",
  "x-create-batch-retry",
  "x-current",
  "x-events",
];
const crossCarrierControls = ["batch-semantic-conflict", "sequence-fresh-key"] as const;
type CrossCarrierControl = (typeof crossCarrierControls)[number];
type CrossCarrierManifest = { scenarios: { id: string; actions: Record<string, unknown>[] }[] };
const crossCreate = () => ({
  id: "beads/a",
  type: `${scope}types/task`,
  properties: { title: "carrier-original" },
});
const crossUpdate = () => ({
  bead: "beads/a",
  propertiesChange: [{ op: "replace", path: "/title", value: "carrier-current" }],
});
function crossCarrierRequests(control?: CrossCarrierControl) {
  const create = crossCreate(),
    update = crossUpdate();
  return [
    ["create-bead", create, "carrier-create"],
    [
      "batch",
      {
        operations: [
          {
            operation: "createBead",
            ...create,
            ...(control === "batch-semantic-conflict"
              ? { properties: { title: "carrier-conflict" } }
              : {}),
          },
        ],
      },
      "carrier-create",
    ],
    [
      "sequence",
      {
        operations: [
          {
            operation: "createBead",
            ...create,
            idempotencyKey:
              control === "sequence-fresh-key" ? "carrier-create-new" : "carrier-create",
            name: "first",
          },
        ],
      },
      undefined,
    ],
    ["batch", { operations: [{ operation: "updateBead", ...update }] }, "carrier-update"],
    [
      "sequence",
      {
        operations: [
          { operation: "createBead", ...create, idempotencyKey: "carrier-create", name: "again" },
          { operation: "updateBead", ...update, idempotencyKey: "carrier-update" },
        ],
      },
      undefined,
    ],
    ["update-bead", update, "carrier-update"],
    ["create-bead", create, "carrier-create"],
    ["batch", { operations: [{ operation: "createBead", ...create }] }, "carrier-create"],
    ["beads/?limit=32", undefined, undefined],
    ["events/", undefined, undefined],
  ] as const;
}
/** Existing afterExchange observes only ordinary wire; client receipt GETs are
 * validated by the manifest. No report redaction is used as a value source. */
function crossCarrierWire(control?: CrossCarrierControl) {
  const requests = crossCarrierRequests(control);
  const maximum =
    control === "batch-semantic-conflict" ? 2 : control === "sequence-fresh-key" ? 3 : 10;
  const facts: { epoch: string; view: string; revision?: string }[] = [];
  let active = false;
  return {
    async afterExchange(response: HttpExchangeResponse) {
      const request = response.exactRequest;
      const key = request?.headerLines.find(
        (h) => h.name.toLowerCase() === "idempotency-key",
      )?.value;
      if (!active) {
        if (response.url !== `${scope}operations/create-bead` || key !== "carrier-create") return;
        active = true;
      }
      if (facts.length === maximum) {
        expect(key === "carrier-create" || key === "carrier-update").toBe(false);
        expect(
          ["create-bead", "sequence", "update-bead"].map((route) => `${scope}operations/${route}`),
        ).not.toContain(response.url);
        return;
      }
      const index = facts.length;
      const [route, body, expectedKey] = requests[index]!;
      expect(response.url).toBe(`${scope}${body === undefined ? "" : "operations/"}${route}`);
      expect(request).toBeDefined();
      expect(request!.writeState).toBe("complete");
      expect(key).toBe(expectedKey);
      expect(request!.bodyPresent).toBe(body !== undefined);
      if (body !== undefined)
        expect(request!.bodyDigest).toBe(
          createHash("sha256").update(JSON.stringify(body)).digest("hex"),
        );
      expect(response.status).toBe(
        control === "batch-semantic-conflict" && index === 1 ? 409 : 200,
      );
      const epoch = response.headers["bdp-scope-epoch"],
        view = response.headers["bdp-authorization-view"];
      expect(typeof epoch).toBe("string");
      expect(epoch?.length).toBeGreaterThan(0);
      expect(typeof view).toBe("string");
      expect(view?.length).toBeGreaterThan(0);
      expect(response.headers["bdp-scope-position"]).toBe(index < 3 ? "pos-1" : "pos-2");
      if (facts.length) {
        expect(epoch).toBe(facts[0]!.epoch);
        expect(view).toBe(facts[0]!.view);
      }
      let revision: string | undefined;
      if (index === 0 || index === 3) {
        const observed = JSON.parse(response.bodyText);
        expect(observed.idempotencyKey).toBe(index === 0 ? "carrier-create" : "carrier-update");
        expect(observed.status).toBe("completed");
        expect(observed.results).toHaveLength(1);
        expect(observed.results[0].resource).toMatchObject({
          id: `${scope}beads/a`,
          type: `${scope}types/task`,
          properties: { title: index === 0 ? "carrier-original" : "carrier-current" },
          metadata: {},
        });
        revision = observed.results[0].resource.revision;
        expect(typeof revision).toBe("string");
        expect(revision?.length).toBeGreaterThan(0);
      }
      facts.push({ epoch: epoch!, view: view!, ...(revision === undefined ? {} : { revision }) });
    },
    finish() {
      expect(active).toBe(true);
      expect(facts).toHaveLength(maximum);
      if (control === undefined) expect(facts[3]!.revision).not.toBe(facts[0]!.revision);
    },
  };
}
function applyCrossCarrierControl(value: CrossCarrierManifest, control: CrossCarrierControl) {
  const row = value.scenarios.find((r) => r.id === crossCarrierId)!;
  const actionId = control === "batch-semantic-conflict" ? "x-create-batch" : "x-create-sequence";
  const action = row.actions.find((a) => a.id === actionId)!;
  const raw = action.raw as { body: { value: string } };
  raw.body.value = JSON.stringify(
    crossCarrierRequests(control)[control === "batch-semantic-conflict" ? 1 : 2]![1],
  );
  const assertions = action.assertions as Record<string, unknown>[];
  const positive: Record<string, unknown>[] =
    control === "batch-semantic-conflict"
      ? [
          { id: "control-status", kind: "status", equals: 409 },
          { id: "control-schema", kind: "json-schema", schema: "#/$defs/transactionalProblem" },
          {
            id: "control-media",
            kind: "header",
            name: "content-type",
            equals: "application/problem+json",
          },
          ...(
            [
              ["type", "https://github.com/gastownhall/bdp/problems/conflict"],
              ["code", "idempotency-conflict"],
              ["status", 409],
              ["retry", "never"],
            ] as const
          ).map(([name, equals]) => ({
            id: `control-${name === "status" ? "problem-status" : name}`,
            kind: "json-pointer",
            pointer: `/${name}`,
            exists: true,
            equals,
          })),
        ]
      : [
          {
            id: "control-member",
            kind: "json-array-tuples",
            pointer: "/results",
            ordered: true,
            projections: [
              "/operationIndex",
              "/operationName",
              "/type",
              "/code",
              "/status",
              "/retry",
            ].map((pointer) => ({ pointer })),
            equals: [
              [
                0,
                "first",
                "https://github.com/gastownhall/bdp/problems/conflict",
                "identity-taken",
                409,
                "never",
              ],
            ],
          },
          {
            id: "control-no-resource",
            kind: "json-pointer",
            pointer: "/results/0/resource",
            exists: false,
          },
          {
            id: "control-no-outcome",
            kind: "json-pointer",
            pointer: "/results/0/outcome",
            exists: false,
          },
        ];
  const retained = assertions.map((a) => a.id as string);
  assertions.push(...positive);
  return {
    actionId,
    retained,
    removed: [] as string[],
    positiveIds: positive.map((a) => a.id as string),
    failingIds:
      control === "batch-semantic-conflict"
        ? [
            "http-status",
            "schema",
            "media",
            "serving-context",
            "disposition",
            "detail",
            "key",
            "no-next",
            "required-position",
            "effect-position",
            "literal-result",
            "retained-root",
            "retained-body",
          ]
        : ["presentation", "created-record"],
  };
}
function assertCrossCarrierControls() {
  const canonical = JSON.parse(manifestSource.bytes.toString());
  const canonicalExecutionDigest = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  const descriptions = [];
  const validator = createJsonSchemaValidator(schema);
  for (const control of crossCarrierControls) {
    const changed = structuredClone(canonical);
    const description = applyCrossCarrierControl(changed, control);
    const row = changed.scenarios.find((r: { id: string }) => r.id === crossCarrierId)!;
    expect(row.actions.map((a: { id: string }) => a.id)).toEqual(crossCarrierActionIds);
    const action = row.actions.find((a: { id: string }) => a.id === description.actionId)!;
    expect(action.assertions.map((a: { id: string }) => a.id)).toEqual([
      ...description.retained,
      ...description.positiveIds,
    ]);
    expect(description.removed).toEqual([]);
    for (const id of description.failingIds) expect(description.retained).toContain(id);
    expect(action.assertions.find((a: { id: string }) => a.id === "request-body")).toEqual({
      id: "request-body",
      kind: "request-authored-body",
    });
    const normal = JSON.stringify(changed, null, 2) + "\n";
    let nodes = 0;
    const pending: unknown[] = [changed];
    while (pending.length) {
      const value = pending.pop();
      nodes++;
      if (value && typeof value === "object") pending.push(...Object.values(value));
    }
    // Historical measurement-only derivative guards were650386B/17275nodes.
    // Historical root-accepted maximum701716B/18263nodes plus4096B/64nodes.
    // Command-minimum measured maximum756707B/19731nodes plus4096B/64nodes.
    expect(Buffer.byteLength(normal)).toBeLessThanOrEqual(847979);
    expect(nodes).toBeLessThanOrEqual(22128);
    const loaded = createCumulativeTransactionalArtifactBundle(
      loadProfileContractSelection("transactional"),
      { fixture: fixtureSource, manifest: { bytes: Buffer.from(JSON.stringify(changed)) } },
    );
    for (const scenario of loaded.manifest.scenarios)
      for (const action of scenario.actions ?? [])
        for (const assertion of action.assertions)
          if (assertion.kind === "json-schema") validator.resolve(assertion.schema);
    expect(loaded.digests.manifestDigest).not.toBe(canonicalExecutionDigest);
    descriptions.push({
      control,
      ...description,
      normalBytes: Buffer.byteLength(normal),
      nodes,
      executionManifestDigest: loaded.digests.manifestDigest,
    });
  }
  expect(new Set(descriptions.map((d) => d.executionManifestDigest)).size).toBe(2);
  expect(descriptions.map((d) => d.positiveIds)).toEqual([
    [
      "control-status",
      "control-schema",
      "control-media",
      "control-type",
      "control-code",
      "control-problem-status",
      "control-retry",
    ],
    ["control-member", "control-no-resource", "control-no-outcome"],
  ]);
}
it.each(crossCarrierControls)(
  "discriminates retained cross-carrier evidence against %s",
  async (control) => {
    const children: ChildProcess[] = [],
      wire = crossCarrierWire(control),
      minimumWire = commandMinimumWire(),
      memberWire = sequenceMemberWire(),
      principalWire = principalNamespaceWire();
    let description: ReturnType<typeof applyCrossCarrierControl> | undefined;
    const observed = await observe({
      children,
      onDispatch: principalWire.onDispatch,
      afterExchange: withPrincipalWire(
        principalWire,
        composedMemberWire(wire, minimumWire, memberWire),
      ),
      onObserved(observed) {
        if (process.env.BDP_TRANSACTIONAL_CROSS_CARRIER_CONTROL_OUTPUT)
          writeFileSync(
            `${process.env.BDP_TRANSACTIONAL_CROSS_CARRIER_CONTROL_OUTPUT}-${control}.json`,
            JSON.stringify(
              {
                sourceCommit,
                entry,
                ...observed,
                principalSupplemental: principalWire.summary(observed),
              },
              null,
              2,
            ) + "\n",
          );
      },
      manifest(value) {
        description = applyCrossCarrierControl(value, control);
      },
    });
    expect(description).toBeDefined();
    const row = observed.result.scenarios.find((r) => r.id === crossCarrierId)!;
    expect(row.state).toBe("fail");
    expect(observed.result.claimEligible).toBe(false);
    const prefix = control === "batch-semantic-conflict" ? 3 : 4;
    expect(row.exchanges.map((e) => e.request.id)).toEqual(crossCarrierActionIds.slice(0, prefix));
    expect(row.actions!.map((a) => a.action.id)).toEqual(["x-created-facts"]);
    expect(row.actions!.every((a) => a.assertions.every((x) => x.passed))).toBe(true);
    for (const exchange of row.exchanges.slice(0, -1))
      expect(exchange.assertions.every((a) => a.passed)).toBe(true);
    const final = row.exchanges.at(-1)!;
    expect(final.request.id).toBe(description!.actionId);
    expect(final.request.exact?.writeState).toBe("complete");
    expect(final.response?.status).toBe(control === "batch-semantic-conflict" ? 409 : 200);
    expect(final.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual(
      description!.failingIds,
    );
    for (const id of [
      ...description!.positiveIds,
      "request-headers",
      "request-body",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
    ])
      expect(final.assertions.find((a) => a.id === id)?.passed).toBe(true);
    for (const later of observed.result.scenarios.filter(
      (r) => bundle.manifest.scenarios.some((p) => p.id === r.id) && r.id !== row.id,
    ))
      expect(later.state).toBe("pass");
    wire.finish();
    assertCommandMinimumPositive(observed, minimumWire);
    assertMemberPositive(observed, memberWire);
    assertPrincipalPositive(observed, principalWire);
    expect(children).toHaveLength(24);
    expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
    const exchanges = observed.result.scenarios.reduce((n, r) => n + r.exchanges.length, 0);
    expect(exchanges).toBe(control === "batch-semantic-conflict" ? 211 : 212);
    console.log(
      JSON.stringify({
        kind: "installed-tx-cross-carrier-control",
        control,
        sourceCommit,
        ...description,
        observedStatus: final.response!.status,
        writeState: final.request.exact!.writeState,
        failures: final.assertions.filter((a) => !a.passed).map((a) => a.id),
        exchanges,
        childLaunches: children.length,
        closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
        artifacts: observed.result.artifacts,
        declarations: observed.result.declarations,
        claimEligible: false,
      }),
    );
  },
  120000,
);

const commandMinimumId = "read-update.http.command-minimum-fields";
const minimumActionIds = [
  "m-create-a",
  "m-replay-a",
  "m-create-b",
  "m-replay-b",
  "m-create-c",
  "m-replay-c",
  "m-body-conflict",
  "m-stale-update",
  "m-retained-a",
  "m-current",
  "m-events",
];
const minimumRawIds = minimumActionIds.filter((id) => id !== "m-retained-a");
const minimumControls = ["minimum-batch-body-conflict", "minimum-readonly-credential"] as const;
type MinimumControl = (typeof minimumControls)[number];
const minimumReplayLedger: readonly (readonly string[])[] = [
  ["m-replay-a", "m-create-a", "whole-json"],
  ["m-replay-b", "m-create-b", "whole-json"],
  ["m-replay-c", "m-create-c", "whole-json"],
];
function assertMinimumReplayLedger(ledger: readonly (readonly string[])[]) {
  if (
    JSON.stringify(ledger) !==
    JSON.stringify([
      ["m-replay-a", "m-create-a", "whole-json"],
      ["m-replay-b", "m-create-b", "whole-json"],
      ["m-replay-c", "m-create-c", "whole-json"],
    ])
  )
    throw new Error("minimum-replay-comparison-ledger");
}
function minimumRequests(control?: MinimumControl) {
  const create = (name: string) => ({
    id: `beads/${name}`,
    type: `${scope}types/task`,
    properties: { title: `minimum-${name}` },
  });
  const batch = (title: string) => ({
    operations: [{ operation: "createBead", ...create("b"), properties: { title } }],
  });
  const sequence = {
    operations: [{ operation: "createBead", ...create("c"), idempotencyKey: "minimum-c" }],
  };
  const minimumNames = ["bdp-minimum-scope-position", "bdp-scope-epoch", "bdp-authorization-view"];
  const fields = (values: readonly string[]) =>
    values.map((value, i) => ({ name: minimumNames[i]!, value }));
  const M = fields(["not a position!", "", "view-one, view-two"]),
    F = fields(["pos-99", "foreign-epoch", "foreign-view"]),
    Z = fields(["", "", ""]),
    P = [{ name: "bdp-scope-epoch", value: "foreign-epoch" }],
    O: { name: string; value: string }[] = [];
  const post = (
    route: string,
    body: unknown,
    key: string | undefined,
    extra: { name: string; value: string }[],
  ) => ({
    url: `${scope}operations/${route}`,
    body,
    headers: [
      { name: "content-type", value: "application/json" },
      ...(key === undefined ? [] : [{ name: "idempotency-key", value: key }]),
      { name: "accept", value: "application/json" },
      ...extra,
    ],
  });
  return [
    post("create-bead", create("a"), "minimum-a", M),
    post("create-bead", create("a"), "minimum-a", O),
    post("batch", batch("minimum-b"), "minimum-b", P),
    post(
      "batch",
      batch(control === "minimum-batch-body-conflict" ? "minimum-conflict" : "minimum-b"),
      "minimum-b",
      Z,
    ),
    post("sequence", sequence, undefined, F),
    post("sequence", sequence, undefined, M),
    post("batch", batch("minimum-conflict"), "minimum-b", F),
    post(
      "update-bead",
      {
        bead: "beads/a",
        expectedRevision: "minimum-wrong-revision",
        propertiesChange: [{ op: "replace", path: "/title", value: "minimum-stale" }],
      },
      "minimum-stale",
      M,
    ),
    { url: `${scope}beads/?limit=32`, body: undefined, headers: O },
    { url: `${scope}events/`, body: undefined, headers: O },
  ];
}
/** Supplemental assertions on actual unredacted wire. The ledger alone drives
 * replay equality; no arbitrary JSON capture or report-body recovery is used. */
function commandMinimumWire(control?: MinimumControl) {
  assertMinimumReplayLedger(minimumReplayLedger);
  const requests = minimumRequests(control),
    validator = createJsonSchemaValidator(schema);
  const maximum =
    control === "minimum-readonly-credential"
      ? 1
      : control === "minimum-batch-body-conflict"
        ? 4
        : 10;
  const observedIds: string[] = [],
    performed: string[][] = [],
    baselines = new Map<string, Record<string, unknown>>(),
    resources: Record<string, unknown>[] = [];
  let active = false,
    epoch: string | undefined,
    view: string | undefined,
    originalRoot: string | undefined,
    originalResponseDigest: string | undefined;
  const problem = (code: string, retry = "never") => ({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    code,
    status: 409,
    retry,
  });
  return {
    async afterExchange(response: HttpExchangeResponse) {
      const request = response.exactRequest;
      const key = request?.headerLines.find(
        (h) => h.name.toLowerCase() === "idempotency-key",
      )?.value;
      if (!active) {
        if (response.url !== `${scope}operations/create-bead` || key !== "minimum-a") return;
        active = true;
      }
      if (observedIds.length === maximum) {
        expect(key?.startsWith("minimum-") ?? false).toBe(false);
        // Other rows may legitimately use these routes; a repeated minimum
        // sequence is discriminated by its exact authored body, not its URL.
        if (response.url === `${scope}operations/sequence`)
          expect(request?.bodyDigest).not.toBe(
            createHash("sha256").update(JSON.stringify(requests[4]!.body)).digest("hex"),
          );
        return;
      }
      const index = observedIds.length,
        id = minimumRawIds[index]!,
        expected = requests[index]!;
      expect(response.url).toBe(expected.url);
      expect(request).toBeDefined();
      expect(request!.source).toBe("raw-http1-serializer");
      expect(request!.writeState).toBe("complete");
      expect(request!.bodyPresent).toBe(expected.body !== undefined);
      // Credentials and generated framing are checked by the runner's exact
      // request assertions; never retain or serialize their secret values.
      expect(
        request!.headerLines.slice(0, expected.headers.length).map((header) => header.name),
      ).toEqual(expected.headers.map((header) => header.name));
      expect(request!.headerLines.slice(0, expected.headers.length)).toEqual(expected.headers);
      expect(
        request!.headerLines
          .slice(expected.headers.length)
          .some((header) => header.name.toLowerCase().startsWith("bdp-")),
      ).toBe(false);
      expect(request!.bodyDigest).toBe(
        expected.body === undefined
          ? undefined
          : createHash("sha256").update(JSON.stringify(expected.body)).digest("hex"),
      );
      const body = JSON.parse(response.bodyText);
      const readonlyRefusal = control === "minimum-readonly-credential";
      const conflict =
        id === "m-body-conflict" ||
        (control === "minimum-batch-body-conflict" && id === "m-replay-b");
      const schemaRef =
        readonlyRefusal || conflict
          ? "transactionalProblem"
          : index < 4 || id === "m-stale-update"
            ? "mutationReceipt"
            : index < 6
              ? "transactionalSequenceResponse"
              : id === "m-current"
                ? "currentBeadCollection"
                : "eventPage";
      expect(validator.validate(`#/$defs/${schemaRef}`, body)).toEqual([]);
      expect(response.status).toBe(readonlyRefusal ? 403 : conflict ? 409 : 200);
      expect(response.headers["content-type"]).toBe(
        readonlyRefusal || conflict ? "application/problem+json" : "application/json",
      );
      if (readonlyRefusal) {
        expect(body).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/authorization",
          code: "forbidden",
          status: 403,
          retry: "after-state-change",
        });
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers[name]).toBeUndefined();
      } else {
        const currentEpoch = response.headers["bdp-scope-epoch"],
          currentView = response.headers["bdp-authorization-view"];
        expect(typeof currentEpoch).toBe("string");
        expect(currentEpoch?.length).toBeGreaterThan(0);
        expect(typeof currentView).toBe("string");
        expect(currentView?.length).toBeGreaterThan(0);
        expect(response.headers["bdp-scope-position"]).toBe(
          index < 2 ? "pos-1" : index < 4 ? "pos-2" : "pos-3",
        );
        if (epoch !== undefined) {
          expect(currentEpoch).toBe(epoch);
          expect(currentView).toBe(view);
        }
        if (conflict) expect(body).toEqual(problem("idempotency-conflict"));
        else if (index < 6) {
          const name = index < 2 ? "a" : index < 4 ? "b" : "c",
            position = `pos-${Math.floor(index / 2) + 1}`;
          expect(body.results).toHaveLength(1);
          const result = body.results[0],
            resource = result.resource;
          expect(result).toEqual({
            operationIndex: 0,
            outcome: "created",
            resource,
          });
          expect(resource).toMatchObject({
            id: `${scope}beads/${name}`,
            type: `${scope}types/task`,
            properties: { title: `minimum-${name}` },
            metadata: {},
          });
          expect(resource.properties).toEqual({ title: `minimum-${name}` });
          expect(resource.metadata).toEqual({});
          expect(typeof resource.revision).toBe("string");
          expect(resource.revision.length).toBeGreaterThan(0);
          expect(resource).not.toHaveProperty("revisionProvenance");
          expect(resource).not.toHaveProperty("ownedLinks");
          if (index < 4) {
            expect(body).toMatchObject({
              status: "completed",
              detail: "available",
              idempotencyKey: `minimum-${name}`,
              scopeEpoch: currentEpoch,
              authorizationView: currentView,
              requiredPosition: position,
              effectPosition: position,
              next: null,
            });
            expect(typeof body.id).toBe("string");
            expect(body.id.startsWith(`${scope}receipts/`)).toBe(true);
            expect(body.id.slice(`${scope}receipts/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
          } else {
            expect(body).not.toHaveProperty("id");
            expect(body).not.toHaveProperty("receipt");
            expect(result).not.toHaveProperty("problem");
          }
          const pair = minimumReplayLedger.find(([replay]) => replay === id);
          if (pair) {
            if (pair[2] !== "whole-json") throw new Error("minimum-replay-comparison-ledger");
            expect(baselines.has(pair[1]!)).toBe(true);
            expect(body).toEqual(baselines.get(pair[1]!));
            performed.push([...pair]);
          } else {
            // No baseline exists until all independent schema/literal/absence
            // checks above have passed.
            baselines.set(id, structuredClone(body));
            resources.push(structuredClone(resource));
          }
          if (id === "m-create-a") {
            originalRoot = body.id;
            expect(response.wireResponseBytes).toBeDefined();
            originalResponseDigest = createHash("sha256")
              .update(response.wireResponseBytes!)
              .digest("hex");
          }
        } else if (id === "m-stale-update") {
          expect(body).toMatchObject({
            status: "failed",
            detail: "available",
            idempotencyKey: "minimum-stale",
            requiredPosition: "pos-3",
            scopeEpoch: currentEpoch,
            authorizationView: currentView,
            problem: {
              ...problem("revision-mismatch", "after-state-change"),
              operationIndex: 0,
            },
          });
          expect(body.problem).toEqual({
            ...problem("revision-mismatch", "after-state-change"),
            operationIndex: 0,
          });
          for (const field of ["effectPosition", "results", "next"])
            expect(body).not.toHaveProperty(field);
        } else if (id === "m-current") {
          expect(body.items).toEqual(resources);
          expect(body.items).toHaveLength(3);
          expect(body.next).toBeNull();
        } else {
          expect(body.events).toHaveLength(3);
          expect(body.next).toBeNull();
          // Private installed-fixture identity spelling, not a normative Event-ID format.
          const projectedIdentity = [
            ["epoch", currentEpoch],
            ["view", currentView],
            ["source", `${scope}events/`],
          ]
            .map((tagged) =>
              createHash("sha256").update(JSON.stringify(tagged)).digest("base64url"),
            )
            .join("_");
          for (const [i, name] of ["a", "b", "c"].entries()) {
            const event = body.events[i],
              resource = resources[i]!;
            expect(event).toMatchObject({
              id: `ev_${projectedIdentity}_${["pos-1", "pos-2", "pos-3"][i]}_0`,
              source: `${scope}events/`,
              type: "created",
              subject: `${scope}beads/${name}`,
              subjectType: `${scope}types/task`,
              ordinal: 0,
            });
            expect(event.data).toEqual({
              revision: resource.revision,
              properties: resource.properties,
              metadata: resource.metadata,
            });
            if (i < 2)
              expect(event.transaction).toBe(baselines.get(`m-create-${name}`)!.transaction);
          }
        }
        epoch = currentEpoch;
        view = currentView;
      }
      observedIds.push(id);
    },
    summary() {
      return {
        kind: "command-minimum-wire-supplement",
        control: control ?? "positive",
        active,
        observedIds: [...observedIds],
        performedComparisons: performed.map((pair) => [...pair]),
        originalRoot,
        originalResponseDigest,
      };
    },
    finish() {
      expect(active).toBe(true);
      expect(observedIds).toEqual(minimumRawIds.slice(0, maximum));
      expect(performed).toEqual(
        minimumReplayLedger.slice(
          0,
          control === "minimum-readonly-credential"
            ? 0
            : control === "minimum-batch-body-conflict"
              ? 1
              : 3,
        ),
      );
    },
  };
}
function assertCommandMinimumPositive(
  observed: Awaited<ReturnType<typeof observe>>,
  wire: ReturnType<typeof commandMinimumWire>,
) {
  const row = observed.result.scenarios.find((r) => r.id === commandMinimumId)!;
  const declared = bundle.manifest.scenarios.find((r) => r.id === commandMinimumId)!;
  expect(row.state).toBe("pass");
  expect(row.exchanges.map((e) => e.request.id)).toEqual(minimumActionIds);
  expect(row.exchanges.map((e) => e.request.method)).toEqual([
    "POST",
    "POST",
    "POST",
    "POST",
    "POST",
    "POST",
    "POST",
    "POST",
    "GET",
    "GET",
    "GET",
  ]);
  expect(row.actions!.map((a) => a.action.id)).toEqual(["m-retained-a"]);
  for (const exchange of row.exchanges) {
    expect(exchange.transportError).toBeUndefined();
    expect(exchange.harnessError).toBeUndefined();
    expect(exchange.assertions.every((a) => a.passed)).toBe(true);
    if (exchange.request.id !== "m-retained-a")
      expect(exchange.assertions.map((a) => a.id)).toEqual(
        declared.actions!.find((a) => a.id === exchange.request.id)!.assertions.map((a) => a.id),
      );
    expect(exchange.request.exact?.writeState).toBe("complete");
    expect(exchange.request.exact!.bodyOctets).toBeLessThanOrEqual(2048);
    expect(exchange.response!.decodedBodyBytes).toBeLessThanOrEqual(8192);
  }
  const action = row.actions![0]!,
    dynamic = row.exchanges[8]!,
    facts = wire.summary();
  expect(action.assertions.every((a) => a.passed)).toBe(true);
  expect(action.assertions.map((a) => a.id)).toEqual(
    declared.actions!.find((a) => a.id === "m-retained-a")!.assertions.map((a) => a.id),
  );
  expect(action.executionError).toBeUndefined();
  expect(row.cleanupError).toBeUndefined();
  expect(row.prerequisiteFailure).toBeUndefined();
  expect(action.output).toEqual({ kind: "json" });
  expect(dynamic.sourceReceiptObservation).toMatchObject({
    action: "m-create-a",
    pointer: "/id",
    receipt: facts.originalRoot,
    responseDigest: facts.originalResponseDigest,
    credentialRef: "operator",
  });
  expect(dynamic.request.url).toBe(facts.originalRoot);
  expect(dynamic.request.exact?.bodyPresent).toBe(false);
  expect(dynamic.dynamicExactConfiguration).toMatchObject({
    scope,
    profile: "transactional",
    routes: [{ method: "GET", url: facts.originalRoot }],
  });
  // This fixture never reopens: equality here is an observed same-session fact,
  // not a universal requirement on retained receipt identity.
  expect(dynamic.servedSession).toEqual(dynamic.sourceReceiptObservation!.session);
  // Existing private validate(GET) compared complete original/current bodies
  // before client projection. Internal exact request assertion proves O headers.
  expect(dynamic.assertions.map((a) => [a.id, a.passed])).toEqual([
    ["actual-status", true],
    ["actual-request", true],
    ["actual-body", true],
  ]);
  wire.finish();
}
function applyCommandMinimumControl(value: CrossCarrierManifest, control: MinimumControl) {
  const row = value.scenarios.find((r) => r.id === commandMinimumId)!;
  const actionId = control === "minimum-batch-body-conflict" ? "m-replay-b" : "m-create-a";
  const action = row.actions.find((a) => a.id === actionId)!;
  if (control === "minimum-batch-body-conflict")
    (action.raw as { body: { value: string } }).body.value = JSON.stringify(
      minimumRequests(control)[3]!.body,
    );
  else action.credentialRef = "reader";
  return {
    actionId,
    failingIds:
      control === "minimum-batch-body-conflict"
        ? [
            "http-status",
            "schema",
            "media",
            "disposition",
            "detail",
            "key",
            "no-next",
            "required-position",
            "effect-position",
            "same-context",
            "literal-result",
          ]
        : [
            "http-status",
            "schema",
            "media",
            "present-bdp-scope-epoch",
            "present-bdp-authorization-view",
            "present-bdp-scope-position",
            "serving-position",
            "disposition",
            "detail",
            "key",
            "no-next",
            "required-position",
            "effect-position",
            "literal-result",
          ],
  };
}
function assertCommandMinimumControls() {
  const canonical = JSON.parse(manifestSource.bytes.toString()),
    validator = createJsonSchemaValidator(schema);
  const digests: string[] = [];
  for (const control of minimumControls) {
    const changed = structuredClone(canonical),
      description = applyCommandMinimumControl(changed, control);
    const original = canonical.scenarios.find((r: { id: string }) => r.id === commandMinimumId),
      row = changed.scenarios.find((r: { id: string }) => r.id === commandMinimumId);
    expect(row.actions.map((a: { id: string }) => a.id)).toEqual(minimumActionIds);
    for (const [i, action] of row.actions.entries())
      expect(action.assertions).toEqual(original.actions[i].assertions);
    expect(changed.scenarios.filter((r: { id: string }) => r.id !== commandMinimumId)).toEqual(
      canonical.scenarios.filter((r: { id: string }) => r.id !== commandMinimumId),
    );
    const target = row.actions.find((a: { id: string }) => a.id === description.actionId);
    for (const id of description.failingIds)
      expect(target.assertions.some((a: { id: string }) => a.id === id)).toBe(true);
    const loaded = createCumulativeTransactionalArtifactBundle(
      loadProfileContractSelection("transactional"),
      {
        fixture: fixtureSource,
        manifest: { bytes: Buffer.from(JSON.stringify(changed)) },
      },
    );
    for (const scenario of loaded.manifest.scenarios)
      for (const action of scenario.actions ?? [])
        for (const assertion of action.assertions)
          if (assertion.kind === "json-schema") validator.resolve(assertion.schema);
    expect(loaded.digests.manifestDigest).not.toBe(
      createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    );
    digests.push(loaded.digests.manifestDigest);
  }
  expect(new Set(digests).size).toBe(2);
}
it.each(minimumControls)(
  "discriminates command minimum evidence against %s",
  async (control) => {
    const children: ChildProcess[] = [],
      wire = commandMinimumWire(control);
    let description: ReturnType<typeof applyCommandMinimumControl> | undefined;
    const observed = await observe({
      children,
      scenarioSelection: [commandMinimumId],
      afterExchange: wire.afterExchange,
      manifest(value) {
        description = applyCommandMinimumControl(value, control);
      },
      onObserved(observed) {
        if (process.env.BDP_TRANSACTIONAL_MINIMUM_CONTROL_OUTPUT)
          writeFileSync(
            `${process.env.BDP_TRANSACTIONAL_MINIMUM_CONTROL_OUTPUT}-${control}.json`,
            JSON.stringify(
              { sourceCommit, entry, ...observed, supplemental: wire.summary() },
              null,
              2,
            ) + "\n",
          );
      },
    });
    expect(description).toBeDefined();
    expect(observed.result.selectedScenarioIds).toEqual([commandMinimumId]);
    expect(observed.result.scenarios).toHaveLength(1);
    expect(observed.result.claimEligible).toBe(false);
    const row = observed.result.scenarios[0]!,
      count = control === "minimum-batch-body-conflict" ? 4 : 1;
    expect(row.state).toBe("fail");
    expect(row.cleanupError).toBeUndefined();
    expect(row.prerequisiteFailure).toBeUndefined();
    expect(row.exchanges.map((e) => e.request.id)).toEqual(minimumActionIds.slice(0, count));
    expect(row.exchanges.every((e) => e.request.method === "POST")).toBe(true);
    expect(row.actions ?? []).toHaveLength(0);
    for (const exchange of row.exchanges) {
      expect(exchange.transportError).toBeUndefined();
      expect(exchange.harnessError).toBeUndefined();
      expect(exchange.request.exact?.writeState).toBe("complete");
    }
    for (const exchange of row.exchanges.slice(0, -1))
      expect(exchange.assertions.every((a) => a.passed)).toBe(true);
    const last = row.exchanges.at(-1)!;
    expect(last.assertions.map((a) => a.id)).toEqual(
      bundle.manifest.scenarios
        .find((r) => r.id === commandMinimumId)!
        .actions!.find((a) => a.id === description!.actionId)!
        .assertions.map((a) => a.id),
    );
    expect(last.request.id).toBe(description!.actionId);
    expect(last.response?.status).toBe(control === "minimum-batch-body-conflict" ? 409 : 403);
    expect(last.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual(
      description!.failingIds,
    );
    for (const id of ["request-headers", "request-body"])
      expect(last.assertions.find((a) => a.id === id)?.passed).toBe(true);
    wire.finish();
    expect(observed.sessions).toHaveLength(1);
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
    console.log(
      JSON.stringify({
        kind: "installed-tx-command-minimum-control",
        control,
        sourceCommit,
        exchanges: row.exchanges.length,
        childLaunches: children.length,
        supplemental: wire.summary(),
        claimEligible: false,
      }),
    );
  },
  120000,
);

const memberId = "transactional.sequence.member-transactions";
const memberActionIds = [
  "s-sequence",
  "s-first-receipt",
  "s-first-facts",
  "s-failed-receipt",
  "s-failed-facts",
  "s-last-receipt",
  "s-last-facts",
  "s-replay",
  "s-current",
  "s-events",
];
const memberRawIds = memberActionIds.filter((id) => !id.endsWith("-facts"));
const memberReplayLedger: readonly (readonly string[])[] = [
  ["s-replay", "s-sequence", "whole-json"],
];
function assertMemberReplayLedger(ledger: readonly (readonly string[])[]) {
  if (JSON.stringify(ledger) !== JSON.stringify([["s-replay", "s-sequence", "whole-json"]]))
    throw new Error("sequence-member-replay-ledger");
}
function memberRequests(negative = false) {
  const first = {
      operation: "createBead",
      id: "beads/a",
      type: `${scope}types/task`,
      properties: { title: "member-first" },
    },
    last = {
      operation: "createBead",
      id: "beads/b",
      type: `${scope}types/task`,
      properties: { title: "member-last" },
    },
    missing = { operation: "deleteBead", bead: "beads/missing" };
  const sequence = {
    operations: [
      { ...first, idempotencyKey: "member-a" },
      { ...missing, ...(negative ? { bead: "beads/a" } : {}), idempotencyKey: "member-fail" },
      { ...last, idempotencyKey: "member-b" },
    ],
  };
  const post = (route: string, body: unknown, key?: string) => ({
    url: `${scope}operations/${route}`,
    body,
    headers: [
      { name: "accept", value: "application/json" },
      { name: "content-type", value: "application/json" },
      ...(key === undefined ? [] : [{ name: "idempotency-key", value: key }]),
    ],
  });
  return [
    post("sequence", sequence),
    post("batch", { operations: [first] }, "member-a"),
    post("batch", { operations: [missing] }, "member-fail"),
    post("batch", { operations: [last] }, "member-b"),
    post("sequence", sequence),
    {
      url: `${scope}beads/?limit=32`,
      body: undefined,
      headers: [{ name: "accept", value: "application/json" }],
    },
    {
      url: `${scope}events/`,
      body: undefined,
      headers: [{ name: "accept", value: "application/json" }],
    },
  ];
}
const memberFailureIds = [
  "serving-position",
  "middle-type",
  "middle-code",
  "middle-status",
  "middle-retry",
  "middle-no-outcome",
  "middle-no-deleted",
];
function memberHandoff(
  index: number,
  url: string,
  digest: string | undefined,
  key: string | undefined,
  writeState: string | undefined,
) {
  return (
    (index === 0 || index === 4) &&
    url === `${scope}operations/sequence` &&
    digest === "f3cde631127aaf530ea5349330e6c7bb46766b02b135f9c7c59acfcd2f2c71c7" &&
    key === undefined &&
    writeState === "complete"
  );
}
/** Full actual values stay local to assertions. Reports retain only identities,
 * digests and performed-pair inventory; receipt helper equality is separate. */
function sequenceMemberWire(negative = false) {
  assertMemberReplayLedger(memberReplayLedger);
  const validator = createJsonSchemaValidator(schema),
    requests = memberRequests(negative);
  const observedIds: string[] = [],
    performed: string[][] = [],
    resources: Record<string, unknown>[] = [],
    receipts: Record<string, unknown>[] = [],
    receiptFacts: { action: string; root: string; digest: string }[] = [];
  let initial: unknown, epoch: string | undefined, view: string | undefined;
  const problem = (index: number) => ({
    type: "https://github.com/gastownhall/bdp/problems/not-found",
    code: "resource-not-found",
    status: 404,
    retry: "after-state-change",
    operationIndex: index,
  });
  function resource(actual: Record<string, unknown>, name: string, title: string) {
    expect(typeof actual.revision).toBe("string");
    expect((actual.revision as string).length).toBeGreaterThan(0);
    expect(actual).toEqual({
      id: `${scope}beads/${name}`,
      type: `${scope}types/task`,
      properties: { title },
      metadata: {},
      revision: actual.revision,
    });
  }
  return {
    count: () => observedIds.length,
    async afterExchange(response: HttpExchangeResponse) {
      const index = observedIds.length,
        id = memberRawIds[index]!,
        expected = requests[index]!;
      expect(index).toBeLessThan(negative ? 1 : 7);
      expect(response.url).toBe(expected.url);
      const request = response.exactRequest!;
      expect(request.source).toBe("raw-http1-serializer");
      expect(request.writeState).toBe("complete");
      expect(request.bodyPresent).toBe(expected.body !== undefined);
      // Check names before values so an unexpected credential cannot appear in diagnostics.
      expect(request.headerLines.slice(0, expected.headers.length).map((h) => h.name)).toEqual(
        expected.headers.map((h) => h.name),
      );
      expect(request.headerLines.slice(0, expected.headers.length)).toEqual(expected.headers);
      expect(
        request.headerLines
          .slice(expected.headers.length)
          .some((h) => h.name.toLowerCase().startsWith("bdp-")),
      ).toBe(false);
      expect(request.bodyDigest).toBe(
        expected.body === undefined
          ? undefined
          : createHash("sha256").update(JSON.stringify(expected.body)).digest("hex"),
      );
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/json");
      const body = JSON.parse(response.bodyText);
      expect(
        validator.validate(
          `#/$defs/${index === 0 || index === 4 ? "transactionalSequenceResponse" : index < 4 ? "mutationReceipt" : index === 5 ? "currentBeadCollection" : "eventPage"}`,
          body,
        ),
      ).toEqual([]);
      const actualEpoch = response.headers["bdp-scope-epoch"],
        actualView = response.headers["bdp-authorization-view"];
      expect(typeof actualEpoch).toBe("string");
      expect(actualEpoch?.length).toBeGreaterThan(0);
      expect(typeof actualView).toBe("string");
      expect(actualView?.length).toBeGreaterThan(0);
      expect(response.headers["bdp-scope-position"]).toBe(negative ? "pos-3" : "pos-2");
      if (epoch !== undefined) {
        expect(actualEpoch).toBe(epoch);
        expect(actualView).toBe(view);
      }
      if (index === 0 || index === 4) {
        expect(Object.keys(body)).toEqual(["results"]);
        expect(body.results).toHaveLength(3);
        resource(body.results[0].resource, "a", "member-first");
        resource(body.results[2].resource, "b", "member-last");
        for (const i of [0, 2])
          expect(body.results[i]).toEqual({
            operationIndex: i,
            outcome: "created",
            resource: body.results[i].resource,
          });
        if (negative) {
          expect(body.results[1]).toEqual({
            operationIndex: 1,
            outcome: "deleted",
            deleted: {
              resourceKind: "bead",
              resource: {
                id: `${scope}beads/a`,
                type: `${scope}types/task`,
                revision: body.results[0].resource.revision,
              },
            },
          });
          expect(body.results[1].deleted.resource).not.toHaveProperty("properties");
          expect(body.results[1].deleted.resource).not.toHaveProperty("metadata");
        } else expect(body.results[1]).toEqual(problem(1));
        const pair = memberReplayLedger.find(([replay]) => replay === id);
        if (pair) {
          expect(initial).toBeDefined();
          expect(body).toEqual(initial);
          performed.push([...pair]);
        } else {
          initial = structuredClone(body);
          resources.push(
            structuredClone(body.results[0].resource),
            structuredClone(body.results[2].resource),
          );
        }
      } else if (index < 4) {
        const failed = index === 2,
          position = index === 3 ? "pos-2" : "pos-1",
          key = ["member-a", "member-fail", "member-b"][index - 1];
        expect(body).toMatchObject({
          status: failed ? "failed" : "completed",
          detail: "available",
          idempotencyKey: key,
          scopeEpoch: actualEpoch,
          authorizationView: actualView,
          requiredPosition: position,
        });
        expect(typeof body.id).toBe("string");
        expect(body.id.startsWith(`${scope}receipts/`)).toBe(true);
        expect(body.id.slice(`${scope}receipts/`.length)).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(new URL(body.id).href).toBe(body.id);
        expect(typeof body.transaction).toBe("string");
        expect(body.transaction.length).toBeGreaterThan(0);
        expect(typeof body.expiresAt).toBe("string");
        expect(Number.isFinite(Date.parse(body.expiresAt))).toBe(true);
        if (failed) {
          expect(body.problem).toEqual(problem(0));
          for (const field of ["effectPosition", "results", "next"])
            expect(body).not.toHaveProperty(field);
        } else {
          expect(body.effectPosition).toBe(position);
          expect(body.next).toBeNull();
          expect(body.results).toEqual([
            { operationIndex: 0, outcome: "created", resource: resources[index === 1 ? 0 : 1] },
          ]);
          expect(body).not.toHaveProperty("problem");
        }
        receipts.push(structuredClone(body));
        expect(response.wireResponseBytes).toBeDefined();
        receiptFacts.push({
          action: id,
          root: body.id,
          digest: createHash("sha256").update(response.wireResponseBytes!).digest("hex"),
        });
      } else if (index === 5) {
        expect(body.items).toEqual(resources);
        expect(body.next).toBeNull();
      } else {
        expect(body.events).toHaveLength(2);
        expect(body.next).toBeNull();
        const identity = [
          ["epoch", actualEpoch],
          ["view", actualView],
          ["source", `${scope}events/`],
        ]
          .map((tagged) => createHash("sha256").update(JSON.stringify(tagged)).digest("base64url"))
          .join("_");
        for (const [i, name] of ["a", "b"].entries()) {
          const event = body.events[i],
            record = resources[i]!;
          expect(typeof event.time).toBe("string");
          expect(Number.isFinite(Date.parse(event.time))).toBe(true);
          expect(event).toEqual({
            id: `ev_${identity}_${i === 0 ? "pos-1" : "pos-2"}_0`,
            source: `${scope}events/`,
            type: "created",
            subject: `${scope}beads/${name}`,
            subjectType: `${scope}types/task`,
            ordinal: 0,
            time: event.time,
            transaction: receipts[i === 0 ? 0 : 2]!.transaction,
            data: {
              revision: record.revision,
              properties: record.properties,
              metadata: record.metadata,
            },
          });
        }
      }
      epoch = actualEpoch;
      view = actualView;
      observedIds.push(id);
    },
    summary: () => ({
      kind: "sequence-member-wire-supplement",
      negative,
      observedIds: [...observedIds],
      performedComparisons: performed.map((p) => [...p]),
      receiptFacts: receiptFacts.map((f) => ({ ...f })),
    }),
    finish() {
      expect(observedIds).toEqual(negative ? ["s-sequence"] : memberRawIds);
      expect(performed).toEqual(negative ? [] : memberReplayLedger);
      if (!negative) {
        expect(new Set(receipts.map((r) => r.id)).size).toBe(3);
        expect(new Set(receipts.map((r) => r.transaction)).size).toBe(3);
      }
    },
  };
}
function composedMemberWire(
  cross: ReturnType<typeof crossCarrierWire>,
  minimum: ReturnType<typeof commandMinimumWire>,
  member: ReturnType<typeof sequenceMemberWire>,
) {
  let handedOff = false;
  return async (response: HttpExchangeResponse) => {
    await minimum.afterExchange(response);
    const request = response.exactRequest,
      key = request?.headerLines.find((h) => h.name.toLowerCase() === "idempotency-key")?.value;
    const exempt = memberHandoff(
      member.count(),
      response.url,
      request?.bodyDigest,
      key,
      request?.writeState,
    );
    if (exempt && !handedOff) {
      cross.finish();
      handedOff = true;
    }
    if (!exempt) await cross.afterExchange(response);
    if (handedOff) await member.afterExchange(response);
  };
}
function assertMemberPositive(
  observed: Awaited<ReturnType<typeof observe>>,
  wire: ReturnType<typeof sequenceMemberWire>,
) {
  const row = observed.result.scenarios.find((r) => r.id === memberId)!,
    declared = bundle.manifest.scenarios.find((r) => r.id === memberId)!;
  expect(row.state).toBe("pass");
  expect(row.cleanupError).toBeUndefined();
  expect(row.prerequisiteFailure).toBeUndefined();
  expect(row.exchanges.map((e) => e.request.id)).toEqual(memberActionIds);
  expect(row.exchanges.map((e) => e.request.method)).toEqual([
    "POST",
    "POST",
    "GET",
    "POST",
    "GET",
    "POST",
    "GET",
    "POST",
    "GET",
    "GET",
  ]);
  expect(row.actions!.map((a) => a.action.id)).toEqual([
    "s-first-facts",
    "s-failed-facts",
    "s-last-facts",
  ]);
  for (const exchange of row.exchanges) {
    expect(exchange.transportError).toBeUndefined();
    expect(exchange.harnessError).toBeUndefined();
    expect(exchange.assertions.every((a) => a.passed)).toBe(true);
    expect(exchange.request.exact?.writeState).toBe("complete");
    if (!exchange.request.id.endsWith("-facts"))
      expect(exchange.assertions.map((a) => a.id)).toEqual(
        declared.actions!.find((a) => a.id === exchange.request.id)!.assertions.map((a) => a.id),
      );
  }
  for (const [i, index] of [2, 4, 6].entries()) {
    const exchange = row.exchanges[index]!,
      action = row.actions![i]!,
      fact = wire.summary().receiptFacts[i]!;
    expect(action.assertions.map((a) => a.id)).toEqual(
      declared.actions!.find((a) => a.id === action.action.id)!.assertions.map((a) => a.id),
    );
    expect(action.assertions.every((a) => a.passed)).toBe(true);
    expect(action.executionError).toBeUndefined();
    expect(action.output).toEqual({ kind: "json" });
    expect(exchange.sourceReceiptObservation).toMatchObject({
      action: fact.action,
      pointer: "/id",
      receipt: fact.root,
      responseDigest: fact.digest,
      credentialRef: "operator",
    });
    expect(exchange.request.url).toBe(fact.root);
    expect(exchange.request.exact?.bodyPresent).toBe(false);
    expect(exchange.dynamicExactConfiguration).toMatchObject({
      scope,
      profile: "transactional",
      routes: [{ method: "GET", url: fact.root }],
    });
    expect(exchange.servedSession).toEqual(exchange.sourceReceiptObservation!.session);
    expect(exchange.assertions.map((a) => [a.id, a.passed])).toEqual([
      ["actual-status", true],
      ["actual-request", true],
      ["actual-body", true],
    ]);
  }
  wire.finish();
}
function applyMemberControl(value: CrossCarrierManifest) {
  const row = value.scenarios.find((r) => r.id === memberId)!;
  (row.actions[0]!.raw as { body: { value: string } }).body.value = JSON.stringify(
    memberRequests(true)[0]!.body,
  );
}
function assertMemberControl() {
  const value = JSON.parse(manifestSource.bytes.toString()) as CrossCarrierManifest,
    original = structuredClone(value);
  applyMemberControl(value);
  expect(value.scenarios.find((r) => r.id === memberId)!.actions).toHaveLength(10);
  const changed = value.scenarios.find((r) => r.id === memberId)!.actions[0]!;
  expect((changed.raw as { body: { value: string } }).body.value).toBe(
    JSON.stringify(memberRequests(true)[0]!.body),
  );
  (changed.raw as { body: { value: string } }).body.value = JSON.stringify(
    memberRequests()[0]!.body,
  );
  expect(value).toEqual(original);
  applyMemberControl(value);
  expect(() =>
    createCumulativeTransactionalArtifactBundle(loadProfileContractSelection("transactional"), {
      manifest: { bytes: Buffer.from(JSON.stringify(value)) },
      fixture: fixtureSource,
    }),
  ).not.toThrow();
}
it("discriminates sequence member transactions against a successful middle delete", async () => {
  const children: ChildProcess[] = [],
    wire = sequenceMemberWire(true);
  const observed = await observe({
    children,
    scenarioSelection: [memberId],
    manifest: applyMemberControl,
    afterExchange: wire.afterExchange,
    onObserved(observed) {
      if (process.env.BDP_TRANSACTIONAL_SEQUENCE_MEMBER_CONTROL_OUTPUT)
        writeFileSync(
          process.env.BDP_TRANSACTIONAL_SEQUENCE_MEMBER_CONTROL_OUTPUT,
          JSON.stringify(
            { sourceCommit, entry, ...observed, supplemental: wire.summary() },
            null,
            2,
          ) + "\n",
        );
    },
  });
  expect(observed.result.selectedScenarioIds).toEqual([memberId]);
  expect(observed.result.claimEligible).toBe(false);
  expect(observed.result.scenarios).toHaveLength(1);
  const row = observed.result.scenarios[0]!,
    exchange = row.exchanges[0]!;
  expect(row.state).toBe("fail");
  expect(row.cleanupError).toBeUndefined();
  expect(row.prerequisiteFailure).toBeUndefined();
  expect(row.actions ?? []).toHaveLength(0);
  expect(row.exchanges).toHaveLength(1);
  expect(exchange.request.id).toBe("s-sequence");
  expect(exchange.request.method).toBe("POST");
  expect(exchange.request.exact?.writeState).toBe("complete");
  expect(exchange.response?.status).toBe(200);
  expect(exchange.transportError).toBeUndefined();
  expect(exchange.harnessError).toBeUndefined();
  expect(exchange.assertions.map((a) => a.id)).toEqual(
    bundle.manifest.scenarios
      .find((r) => r.id === memberId)!
      .actions![0]!.assertions.map((a) => a.id),
  );
  expect(exchange.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual(memberFailureIds);
  for (const id of [
    "http-status",
    "schema",
    "media",
    "request-headers",
    "request-body",
    "middle-no-resource",
  ])
    expect(exchange.assertions.find((a) => a.id === id)?.passed).toBe(true);
  wire.finish();
  expect(observed.sessions).toHaveLength(1);
  expect(children).toHaveLength(2);
  expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
  console.log(
    JSON.stringify({
      kind: "installed-tx-sequence-member-control",
      sourceCommit,
      exchanges: 1,
      childLaunches: children.length,
      closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
      failures: exchange.assertions.filter((a) => !a.passed).map((a) => a.id),
      supplemental: wire.summary(),
      claimEligible: observed.result.claimEligible,
    }),
  );
}, 120000);

const principalId = "read-update.idempotency.principal-isolation";
const principalRequests = [
  {
    action: "pk-a-create",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "principal-a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"a"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "54f0fefb0965a8210bb22cf09601c18296ef450489eff1aef5a8bea8b99d83b8",
    status: 200,
    dispatchUrl: "https://reference.invalid/acme/operations/batch",
    reportedUrl: "https://reference.invalid/acme/operations/batch",
  },
  {
    action: "pk-b-create",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "principal-b",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/task","properties":{"title":"b"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "b26bbe9a43f5cc9b54d7fe7778786b33e5e8d613bf30248de3af65f5eac0cdc8",
    status: 200,
    dispatchUrl: "https://reference.invalid/acme/operations/batch",
    reportedUrl: "https://reference.invalid/acme/operations/batch",
  },
  {
    action: "pk-a-rotated",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "principal-a-rotated",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"a"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "54f0fefb0965a8210bb22cf09601c18296ef450489eff1aef5a8bea8b99d83b8",
    status: 200,
    dispatchUrl: "https://reference.invalid/acme/operations/batch",
    reportedUrl: "https://reference.invalid/acme/operations/batch",
  },
  {
    action: "pk-b-replay",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "principal-b",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/task","properties":{"title":"b"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "b26bbe9a43f5cc9b54d7fe7778786b33e5e8d613bf30248de3af65f5eac0cdc8",
    status: 200,
    dispatchUrl: "https://reference.invalid/acme/operations/batch",
    reportedUrl: "https://reference.invalid/acme/operations/batch",
  },
  {
    action: "pk-a-conflict",
    method: "POST",
    url: "https://reference.invalid/acme/operations/batch",
    credentialRef: "principal-a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
      {
        name: "content-type",
        value: "application/json",
      },
      {
        name: "idempotency-key",
        value: "principal-shared",
      },
    ],
    body: '{"operations":[{"operation":"createBead","id":"beads/c","type":"https://reference.invalid/acme/types/task","properties":{"title":"c"},"metadata":{}}]}',
    bodyBytes: 150,
    bodySha256: "3de2f9bb5fb4b4b0537d252ba722b05a3385414129cf35fc6ab0355720f9ff62",
    status: 409,
    dispatchUrl: "https://reference.invalid/acme/operations/batch",
    reportedUrl: "https://reference.invalid/acme/operations/batch",
  },
  {
    action: "pk-current",
    method: "GET",
    url: "https://reference.invalid/acme/beads/?limit=32",
    credentialRef: "principal-a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
    ],
    body: null,
    bodyBytes: 0,
    bodySha256: null,
    status: 200,
    dispatchUrl: "https://reference.invalid/acme/beads/?limit=32",
    reportedUrl: "https://reference.invalid/acme/beads/?<redacted>",
  },
  {
    action: "pk-events",
    method: "GET",
    url: "https://reference.invalid/acme/events/",
    credentialRef: "principal-a",
    headerLines: [
      {
        name: "accept",
        value: "application/json",
      },
    ],
    body: null,
    bodyBytes: 0,
    bodySha256: null,
    status: 200,
    dispatchUrl: "https://reference.invalid/acme/events/",
    reportedUrl: "https://reference.invalid/acme/events/",
  },
] as const;
const principalFailureIds = [
  "http-status",
  "schema",
  "media",
  "serving-position",
  "disposition",
  "detail",
  "key",
  "receipt-id",
  "transaction",
  "required-position",
  "effect-position",
  "no-next",
  "result-indices",
  "resource-id",
  "resource-type",
  "resource-revision",
  "resource-properties",
  "resource-metadata",
] as const;
const principalPassingIds = [
  "present-bdp-scope-epoch",
  "present-bdp-authorization-view",
  "present-bdp-scope-position",
  "request-headers",
  "request-body",
  "no-owned-links",
  "no-provenance",
] as const;

type PrincipalTokens = {
  operator: string;
  reader: string;
  principalA: string;
  principalARotated: string;
  principalB: string;
};
type PrincipalDispatchInput = Readonly<{
  method: string;
  url: string;
  credentialRef: string | undefined;
}>;
function principalCredentialRoles(tokens: PrincipalTokens, collapsePrincipalB = false) {
  return [
    { ref: "operator", token: tokens.operator, principal: "same", canMutate: true },
    { ref: "reader", token: tokens.reader, principal: "same", canMutate: false },
    { ref: "principal-a", token: tokens.principalA, principal: "principal-a", canMutate: true },
    {
      ref: "principal-a-rotated",
      token: tokens.principalARotated,
      principal: "principal-a",
      canMutate: true,
    },
    {
      ref: "principal-b",
      token: tokens.principalB,
      principal: collapsePrincipalB ? "principal-a" : "principal-b",
      canMutate: true,
    },
  ];
}
function principalHeaders(
  roles: ReturnType<typeof principalCredentialRoles>,
  ref: string,
  denyReceipt: boolean,
): Record<string, string> {
  if (ref === "anonymous") return {};
  const role = roles.find((candidate) => candidate.ref === ref);
  if (!role) throw new Error("unknown principal credential reference");
  return { authorization: `Bearer ${denyReceipt ? "deliberately-unknown" : role.token}` };
}
const principalReplayLedger = [
  ["pk-a-rotated", "pk-a-create", "whole-json"],
  ["pk-b-replay", "pk-b-create", "whole-json"],
] as const;
function assertPrincipalReplayLedger(value: readonly (readonly string[])[]) {
  if (
    JSON.stringify(value) !==
    JSON.stringify([
      ["pk-a-rotated", "pk-a-create", "whole-json"],
      ["pk-b-replay", "pk-b-create", "whole-json"],
    ])
  )
    throw new Error("principal-replay-ledger");
}
function assertPrincipalStatic() {
  const tokens = {
    operator: "op",
    reader: "read",
    principalA: "a",
    principalARotated: "rotated",
    principalB: "b",
  };
  const expected = [
    { ref: "operator", token: "op", principal: "same", canMutate: true },
    { ref: "reader", token: "read", principal: "same", canMutate: false },
    { ref: "principal-a", token: "a", principal: "principal-a", canMutate: true },
    { ref: "principal-a-rotated", token: "rotated", principal: "principal-a", canMutate: true },
    { ref: "principal-b", token: "b", principal: "principal-b", canMutate: true },
  ];
  const roles = principalCredentialRoles(tokens);
  expect(roles).toEqual(expected);
  expect(principalCredentialRoles(tokens, true)).toEqual([
    ...expected.slice(0, 4),
    { ref: "principal-b", token: "b", principal: "principal-a", canMutate: true },
  ]);
  for (const role of expected) {
    expect(principalHeaders(roles, role.ref, false)).toEqual({
      authorization: `Bearer ${role.token}`,
    });
    expect(principalHeaders(roles, role.ref, true)).toEqual({
      authorization: "Bearer deliberately-unknown",
    });
  }
  for (const denied of [false, true]) {
    expect(principalHeaders(roles, "anonymous", denied)).toEqual({});
    expect(() => principalHeaders(roles, "unknown", denied)).toThrow(
      "unknown principal credential reference",
    );
  }
  assertPrincipalReplayLedger(principalReplayLedger);
  expect(() => assertPrincipalReplayLedger(principalReplayLedger.slice(1))).toThrow(
    "principal-replay-ledger",
  );
  const redirected: string[][] = principalReplayLedger.map((pair) => [...pair]);
  redirected[0]![1] = "pk-b-create";
  expect(() => assertPrincipalReplayLedger(redirected)).toThrow("principal-replay-ledger");
  const weakened: string[][] = principalReplayLedger.map((pair) => [...pair]);
  weakened[0]![2] = "subset";
  expect(() => assertPrincipalReplayLedger(weakened)).toThrow("principal-replay-ledger");
  for (const literal of principalRequests) {
    expect(literal.url).toBe(literal.dispatchUrl);
    expect(literal.reportedUrl).toBe(
      literal.action === "pk-current" ? `${scope}beads/?<redacted>` : literal.dispatchUrl,
    );
    const digest =
      literal.body === null ? undefined : createHash("sha256").update(literal.body).digest("hex");
    expect(digest).toBe(literal.bodySha256 ?? undefined);
    expect(literal.body === null ? 0 : Buffer.byteLength(literal.body)).toBe(literal.bodyBytes);
    for (const index of [0, 4])
      expect(
        memberHandoff(
          index,
          literal.dispatchUrl,
          digest,
          literal.method === "POST" ? "principal-shared" : undefined,
          "complete",
        ),
      ).toBe(false);
  }
  expect(principalFailureIds).toHaveLength(18);
  expect(principalPassingIds).toHaveLength(7);
  const b = bundle.manifest.scenarios.find((r) => r.id === principalId)!.actions![1]!;
  expect(
    b.assertions.map((a) => a.id).filter((id) => !principalPassingIds.some((p) => p === id)),
  ).toEqual(principalFailureIds);
  expect(b.assertions.find((a) => a.id === "no-next")).toEqual({
    id: "no-next",
    kind: "json-pointer",
    pointer: "/next",
    exists: true,
    equals: null,
  });
  for (const [id, field] of [
    ["no-owned-links", "ownedLinks"],
    ["no-provenance", "revisionProvenance"],
  ])
    expect(b.assertions.find((a) => a.id === id)).toEqual({
      id,
      kind: "json-pointer",
      pointer: `/results/0/resource/${field}`,
      exists: false,
    });
}
/** Two safe boundaries: input carries the authored handle; response carries actual
 * serialized wire/body. The report's action ID is joined only after the run. */
function principalNamespaceWire(collapse = false) {
  assertPrincipalReplayLedger(principalReplayLedger);
  const maximum = collapse ? 2 : 7;
  const dispatches: (PrincipalDispatchInput & { ordinal: number })[] = [];
  const responses: {
    ordinal: number;
    url: string;
    status: number;
    bodyDigest: string;
    writeState: "complete";
    requestBodyBytes: number;
    requestBodyDigest: string | undefined;
    epoch: string;
    view: string;
    position: string;
  }[] = [];
  const performed: string[] = [];
  const receipts = new Map<string, Record<string, unknown>>();
  const resources: Record<string, unknown>[] = [];
  const validator = createJsonSchemaValidator(schema);
  function record(value: unknown): Record<string, unknown> {
    expect(value).not.toBeNull();
    expect(typeof value).toBe("object");
    expect(Array.isArray(value)).toBe(false);
    return value as Record<string, unknown>;
  }
  function nonempty(value: unknown): string {
    expect(typeof value).toBe("string");
    expect(value).not.toBe("");
    return value as string;
  }
  const problem = {
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    code: "idempotency-conflict",
    status: 409,
    retry: "never",
  };
  function joined(observed: InstalledObservation) {
    return (observed.result.scenarios.find((r) => r.id === principalId)?.exchanges ?? []).map(
      (exchange, i) => ({
        id: exchange.request.id,
        reportedUrl: exchange.request.url,
        method: dispatches[i]?.method,
        dispatchUrl: dispatches[i]?.url,
        credentialRef: dispatches[i]?.credentialRef,
        ordinal: dispatches[i]?.ordinal,
      }),
    );
  }
  return {
    onDispatch(input: PrincipalDispatchInput) {
      if (dispatches.length === maximum) {
        expect(["principal-a", "principal-a-rotated", "principal-b"]).not.toContain(
          input.credentialRef,
        );
        return;
      }
      expect(dispatches.length).toBe(responses.length);
      const literal = principalRequests[dispatches.length]!;
      expect(input).toEqual({
        method: literal.method,
        url: literal.dispatchUrl,
        credentialRef: literal.credentialRef,
      });
      dispatches.push(
        Object.freeze({
          ordinal: dispatches.length,
          method: input.method,
          url: input.url,
          credentialRef: input.credentialRef,
        }),
      );
    },
    async afterExchange(response: HttpExchangeResponse) {
      const exact = response.exactRequest;
      const key = exact?.headerLines.find((h) => h.name.toLowerCase() === "idempotency-key")?.value;
      if (responses.length === maximum) {
        expect(key).not.toBe("principal-shared");
        return;
      }
      const index = responses.length,
        literal = principalRequests[index]!;
      expect(dispatches).toHaveLength(index + 1);
      expect(response.url).toBe(literal.dispatchUrl);
      expect(exact).toBeDefined();
      expect(exact!.source).toBe("raw-http1-serializer");
      expect(exact!.writeState).toBe("complete");
      expect(exact!.headerLines.slice(0, literal.headerLines.length).map((h) => h.name)).toEqual(
        literal.headerLines.map((h) => h.name),
      );
      expect(exact!.headerLines.slice(0, literal.headerLines.length)).toEqual(literal.headerLines);
      expect(
        exact!.headerLines
          .slice(literal.headerLines.length)
          .some((h) => h.name.toLowerCase().startsWith("bdp-")),
      ).toBe(false);
      expect(exact!.bodyPresent).toBe(literal.body !== null);
      expect(exact!.bodyOctets).toBe(literal.bodyBytes);
      expect(exact!.bodyDigest).toBe(literal.bodySha256 ?? undefined);
      expect(exact!.bodyOctets).toBeLessThanOrEqual(2048);
      expect(Buffer.byteLength(response.bodyText)).toBeLessThanOrEqual(8192);
      const refused = index === 4 || (collapse && index === 1);
      expect(response.status).toBe(refused ? 409 : 200);
      expect(response.headers["content-type"]).toBe(
        refused ? "application/problem+json" : "application/json",
      );
      const body = record(JSON.parse(response.bodyText));
      expect(
        validator.validate(
          `#/$defs/${refused ? "transactionalProblem" : index < 4 ? "mutationReceipt" : index === 5 ? "currentBeadCollection" : "eventPage"}`,
          body,
        ),
      ).toEqual([]);
      const epoch = nonempty(response.headers["bdp-scope-epoch"]),
        view = nonempty(response.headers["bdp-authorization-view"]);
      const position = index === 0 || (collapse && index === 1) ? "pos-1" : "pos-2";
      expect(response.headers["bdp-scope-position"]).toBe(position);
      const a = receipts.get("pk-a-create");
      if (a) expect(epoch).toBe(a.scopeEpoch);
      if (refused) {
        expect(body).toStrictEqual(problem);
        expect(view).toBe(a!.authorizationView);
        performed.push(collapse ? "validated-b-conflict" : "validated-a-conflict");
      } else if (index < 2) {
        const name = index === 0 ? "a" : "b";
        expect(body.scopeEpoch).toBe(epoch);
        expect(body.authorizationView).toBe(view);
        expect(Array.isArray(body.results)).toBe(true);
        const results = body.results as unknown[];
        expect(results).toHaveLength(1);
        const resource = record(record(results[0]).resource);
        expect(validator.validate("#/$defs/beadRecord", resource)).toEqual([]);
        nonempty(resource.revision);
        expect(resource).toStrictEqual({
          id: `${scope}beads/${name}`,
          type: `${scope}types/task`,
          revision: resource.revision,
          properties: { title: name },
          metadata: {},
        });
        expect(results).toStrictEqual([{ operationIndex: 0, outcome: "created", resource }]);
        const id = nonempty(body.id),
          parsed = new URL(id),
          prefix = `${scope}receipts/`;
        expect(id.length).toBeLessThanOrEqual(8192);
        expect(Buffer.byteLength(id)).toBeLessThanOrEqual(8192);
        expect(parsed.href).toBe(id);
        expect([parsed.username, parsed.password, parsed.search, parsed.hash]).toEqual([
          "",
          "",
          "",
          "",
        ]);
        expect(id.startsWith(prefix)).toBe(true);
        expect(/^[A-Za-z0-9_-]+$/.test(id.slice(prefix.length))).toBe(true);
        nonempty(body.transaction);
        expect(body).toStrictEqual({
          id,
          status: "completed",
          detail: "available",
          idempotencyKey: "principal-shared",
          scopeEpoch: epoch,
          authorizationView: view,
          transaction: body.transaction,
          requiredPosition: position,
          effectPosition: position,
          results,
          next: null,
          expiresAt: body.expiresAt,
        });
        receipts.set(literal.action, body);
        resources.push(resource);
        if (collapse) performed.push("validated-a-terminal");
        else if (index === 1) {
          expect(body.id).not.toBe(a!.id);
          expect(body.transaction).not.toBe(a!.transaction);
          performed.push("namespace-distinct");
        }
      } else if (index < 4) {
        const pair = principalReplayLedger.find(([current]) => current === literal.action)!;
        expect(pair).toBeDefined();
        expect(pair[2]).toBe("whole-json");
        const saved = receipts.get(pair[1])!;
        expect(saved).toBeDefined();
        expect(view).toBe(saved.authorizationView);
        expect(body).toStrictEqual(saved);
        performed.push(pair.join(":"));
      } else if (index === 5) {
        expect(body).toStrictEqual({ items: resources, next: null });
        performed.push("complete-current");
      } else {
        expect(Array.isArray(body.events)).toBe(true);
        const events = body.events as Record<string, unknown>[];
        expect(events).toHaveLength(2);
        const hash = (tag: string, value: string) =>
          createHash("sha256")
            .update(JSON.stringify([tag, value]))
            .digest("base64url");
        const source = `${scope}events/`;
        const expected = resources.map((resource, i) => ({
          id: `ev_${hash("epoch", epoch)}_${hash("view", view)}_${hash("source", source)}_pos-${i + 1}_0`,
          ordinal: 0,
          type: "created",
          source,
          subject: resource.id,
          subjectType: `${scope}types/task`,
          transaction: receipts.get(i === 0 ? "pk-a-create" : "pk-b-create")!.transaction,
          time: events[i]!.time,
          data: {
            revision: resource.revision,
            properties: resource.properties,
            metadata: resource.metadata,
          },
        }));
        expect(body).toStrictEqual({ source, events: expected, next: null });
        performed.push("complete-events");
      }
      responses.push({
        ordinal: index,
        url: response.url,
        status: response.status,
        bodyDigest: createHash("sha256").update(response.bodyText).digest("hex"),
        writeState: "complete",
        requestBodyBytes: exact!.bodyOctets,
        requestBodyDigest: exact!.bodyDigest,
        epoch,
        view,
        position,
      });
    },
    finish(observed: InstalledObservation) {
      expect(dispatches).toHaveLength(maximum);
      expect(responses).toHaveLength(maximum);
      expect(performed).toEqual(
        collapse
          ? ["validated-a-terminal", "validated-b-conflict"]
          : [
              "namespace-distinct",
              "pk-a-rotated:pk-a-create:whole-json",
              "pk-b-replay:pk-b-create:whole-json",
              "validated-a-conflict",
              "complete-current",
              "complete-events",
            ],
      );
      const row = observed.result.scenarios.find((r) => r.id === principalId)!;
      expect(row.exchanges).toHaveLength(maximum);
      expect(joined(observed)).toEqual(
        principalRequests.slice(0, maximum).map((literal, ordinal) => ({
          id: literal.action,
          method: literal.method,
          dispatchUrl: literal.dispatchUrl,
          reportedUrl: literal.reportedUrl,
          credentialRef: literal.credentialRef,
          ordinal,
        })),
      );
      for (const [i, exchange] of row.exchanges.entries()) {
        expect(exchange.request.method).toBe(principalRequests[i]!.method);
        expect(exchange.transportError).toBeUndefined();
        expect(exchange.harnessError).toBeUndefined();
        expect(exchange.request.exact?.writeState).toBe("complete");
        expect(exchange.response?.status).toBe(responses[i]!.status);
      }
    },
    summary(observed: InstalledObservation) {
      return {
        mode: collapse ? "collapse-principal-b-to-a" : "positive",
        dispatches,
        responses,
        performed,
        joined: joined(observed),
        provenance:
          "input method/url/credentialRef; local zero-based ordinal; report id/reportedUrl; actual response metadata and completed request fingerprints; no wire credential attestation",
      };
    },
  };
}
function withPrincipalWire(
  principal: ReturnType<typeof principalNamespaceWire>,
  old: (response: HttpExchangeResponse) => Promise<void>,
) {
  return async (response: HttpExchangeResponse) => {
    await principal.afterExchange(response);
    await old(response);
  };
}
function assertPrincipalPositive(
  observed: InstalledObservation,
  wire: ReturnType<typeof principalNamespaceWire>,
) {
  const row = observed.result.scenarios.find((r) => r.id === principalId)!;
  expect(row.state).toBe("pass");
  expect(row.cleanupError).toBeUndefined();
  expect(row.prerequisiteFailure).toBeUndefined();
  expect(row.actions ?? []).toHaveLength(0);
  expect(row.exchanges.map((e) => e.request.id)).toEqual(principalRequests.map((r) => r.action));
  const declared = bundle.manifest.scenarios.find((r) => r.id === principalId)!;
  for (const [i, exchange] of row.exchanges.entries()) {
    expect(exchange.assertions.map((a) => a.id)).toEqual(
      declared.actions![i]!.assertions.map((a) => a.id),
    );
    expect(exchange.assertions.every((a) => a.passed)).toBe(true);
  }
  wire.finish(observed);
}
function principalOutputPath() {
  const output = process.env.BDP_TRANSACTIONAL_PRINCIPAL_CUMULATIVE_OUTPUT;
  if (output !== undefined && (!path.isAbsolute(output) || output.length > 4096))
    throw new Error("absolute principal observation output required");
  return output;
}
it("observes authenticated principal isolation and rotation through selected cumulative HTTP", async () => {
  const output = principalOutputPath(),
    children: ChildProcess[] = [],
    wire = principalNamespaceWire();
  const observed = await observe({
    children,
    scenarioSelection: [principalId],
    onDispatch: wire.onDispatch,
    afterExchange: wire.afterExchange,
    onObserved(observed) {
      if (output)
        writeFileSync(
          output,
          JSON.stringify(
            { sourceCommit, entry, ...observed, principalSupplemental: wire.summary(observed) },
            null,
            2,
          ) + "\n",
        );
    },
  });
  expect(observed.result.selectedScenarioIds).toEqual([principalId]);
  expect(observed.result.scenarios).toHaveLength(1);
  expect(observed.result.claimEligible).toBe(false);
  assertPrincipalPositive(observed, wire);
  expect(observed.sessions).toHaveLength(1);
  expect(children).toHaveLength(2);
  expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
  expect(observed.result.artifacts.manifestDigest).toBe(bundle.digests.manifestDigest);
  console.log(
    JSON.stringify({
      kind: "installed-tx-principal-positive",
      sourceCommit,
      exchanges: 7,
      childLaunches: children.length,
      closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
      principalSupplemental: wire.summary(observed),
      claimEligible: false,
    }),
  );
}, 120000);
it("discriminates principal isolation against a separately bound collapsed namespace", async () => {
  const output = principalOutputPath(),
    children: ChildProcess[] = [],
    wire = principalNamespaceWire(true);
  const observed = await observe({
    children,
    scenarioSelection: [principalId],
    collapsePrincipalB: true,
    onDispatch: wire.onDispatch,
    afterExchange: wire.afterExchange,
    onObserved(observed) {
      if (output)
        writeFileSync(
          output,
          JSON.stringify(
            { sourceCommit, entry, ...observed, principalSupplemental: wire.summary(observed) },
            null,
            2,
          ) + "\n",
        );
    },
  });
  expect(observed.result.selectedScenarioIds).toEqual([principalId]);
  expect(observed.result.scenarios).toHaveLength(1);
  expect(observed.result.claimEligible).toBe(false);
  const row = observed.result.scenarios[0]!;
  expect(row.state).toBe("fail");
  expect(row.cleanupError).toBeUndefined();
  expect(row.prerequisiteFailure).toBeUndefined();
  expect(row.actions ?? []).toHaveLength(0);
  expect(row.exchanges.map((e) => e.request.id)).toEqual(["pk-a-create", "pk-b-create"]);
  expect(row.exchanges[0]!.assertions.every((a) => a.passed)).toBe(true);
  const last = row.exchanges[1]!;
  expect(last.assertions.map((a) => a.id)).toEqual(
    bundle.manifest.scenarios
      .find((r) => r.id === principalId)!
      .actions![1]!.assertions.map((a) => a.id),
  );
  expect(last.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual(principalFailureIds);
  expect(last.assertions.filter((a) => a.passed).map((a) => a.id)).toEqual(principalPassingIds);
  wire.finish(observed);
  expect(observed.result.artifacts.manifestDigest).toBe(bundle.digests.manifestDigest);
  expect(observed.sessions).toHaveLength(1);
  expect(children).toHaveLength(2);
  expect(children.every((c) => c.exitCode !== null || c.signalCode !== null)).toBe(true);
  console.log(
    JSON.stringify({
      kind: "installed-tx-principal-collapse",
      sourceCommit,
      exchanges: 2,
      childLaunches: children.length,
      closedChildren: children.filter((c) => c.exitCode !== null || c.signalCode !== null).length,
      failures: last.assertions.filter((a) => !a.passed).map((a) => a.id),
      principalSupplemental: wire.summary(observed),
      claimEligible: false,
    }),
  );
}, 120000);
