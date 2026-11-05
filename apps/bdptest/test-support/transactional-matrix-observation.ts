/** Private unchanged installed-observation harness; no test registration or product export. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  createJsonSchemaValidator,
  type ExactHttpModeOptions,
  type HttpExchangeResponse,
} from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
  runCumulativeTransactionalMatrix,
} from "@bdp/conformance/testing";
import {
  createTransactionalExecutionBinding,
  installedTransactionBinding,
} from "./transactional-execution-binding.js";
import schema from "../../../specs/profiles/core/bdp-v0.schema.json" with { type: "json" };
const root = fileURLToPath(new URL("../../../", import.meta.url));

export const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal?: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};

export const scope = "https://reference.invalid/acme/";

export const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed-process.js");

const source = (file: string) => ({
  bytes: readFileSync(path.join(root, "packages/conformance/test-support/transactional", file)),
});

export const fixtureSource = source("fixture-v1.json"),
  manifestSource = source("manifest-v1.json");

export const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  { manifest: manifestSource, fixture: fixtureSource },
);

export function artifacts() {
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

export const sourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

export function errorCauses(error: unknown): Set<unknown> {
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

export type ObservationSession = Readonly<{
  scenario: string;
  reopen: boolean;
  sessionOrdinal: number;
}>;

export type InstalledObservation = {
  result: Awaited<ReturnType<typeof runCumulativeTransactionalMatrix>>;
  sessions: Record<string, unknown>[];
  baseline: ReturnType<typeof installedTransactionBinding>;
};

export async function observe(control?: {
  readonly budgetMs?: number;
  /** Negative-test deadline begins after the first real exchange, with startup still bounded. */
  readonly afterFirstExchangeBudgetMs?: number;
  readonly scenarioSelection?: readonly string[];
  readonly collapsePrincipalB?: boolean;
  readonly onDispatch?: (request: PrincipalDispatchInput, session: ObservationSession) => void;
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
  readonly afterExchange?: (
    response: HttpExchangeResponse,
    signal: AbortSignal,
    session: ObservationSession,
  ) => Promise<void>;
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
  let observationSession: ObservationSession | undefined;
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
      { method: "GET", url: `${scope}bdp/beads?limit=32` },
      { method: "GET", url: `${scope}events/` },
      { method: "POST", url: `${scope}operations/create-bead` },
      { method: "POST", url: `${scope}operations/sequence` },
      { method: "POST", url: `${scope}operations/update-bead` },
      { method: "GET", url: `${scope}a` },
      { method: "GET", url: `${scope}l` },
      { method: "GET", url: `${scope}new` },
      { method: "GET", url: `${scope}changes/?after=genesis` },
      { method: "GET", url: `${scope}bdp/links?limit=32` },
      { method: "GET", url: `${scope}b` },
      { method: "GET", url: `${scope}c` },
      { method: "POST", url: `${scope}operations/update-where` },
      { method: "POST", url: `${scope}operations/delete-where` },
      { method: "HEAD", url: `${scope}a` },
      { method: "GET", url: `${scope}missing` },
      { method: "HEAD", url: `${scope}missing` },
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
        observationSession = Object.freeze({ scenario, reopen, sessionOrdinal: sessions.length });
        sessions.push({ ...child.ready, ...observationSession });
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
            const session = observationSession;
            if (!session)
              throw new Error("ordinary exchange requires a launched observation session");
            control?.onDispatch?.(
              Object.freeze({
                method: request.method,
                url: request.url,
                credentialRef: request.credentialRef,
              }),
              session,
            );
            const response = await target!.target.execute(request);
            if (observationSession !== session)
              throw new Error("observation session changed during ordinary exchange");
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
            await control?.afterExchange?.(response, signal, session);
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

export type PrincipalTokens = {
  operator: string;
  reader: string;
  principalA: string;
  principalARotated: string;
  principalB: string;
};

export type PrincipalDispatchInput = Readonly<{
  method: string;
  url: string;
  credentialRef: string | undefined;
}>;

export function principalCredentialRoles(tokens: PrincipalTokens, collapsePrincipalB = false) {
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

export function principalHeaders(
  roles: ReturnType<typeof principalCredentialRoles>,
  ref: string,
  denyReceipt: boolean,
): Record<string, string> {
  if (ref === "anonymous") return {};
  const role = roles.find((candidate) => candidate.ref === ref);
  if (!role) throw new Error("unknown principal credential reference");
  return { authorization: `Bearer ${denyReceipt ? "deliberately-unknown" : role.token}` };
}
