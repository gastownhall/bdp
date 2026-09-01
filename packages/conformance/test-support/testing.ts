import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";

import type { ScenarioActionExecution, ScenarioActionExecutor } from "../src/scenario-action.js";
import type { SchemaValidator } from "../src/schema-validator.js";

export {
  type BdCommandOptions,
  type BdCommandResult,
  type BdWorkspaceSeed,
  bdExecutableCandidates,
  resolveBdExecutable,
  runBdWorkspaceCommand,
  seedBdWorkspace,
} from "./bd-workspace.js";

/**
 * Emit a matrix run for the cohort generator. Opt-in via
 * BDP_EMIT_MATRIX_RUN_DIR: the matrices write their ConformanceRunResult
 * verbatim after their own assertions pass, so the in-process self-certified
 * segments of the cohort are the exact reviewed matrix runs rather than a
 * parallel composition that could drift from them.
 */
export async function emitMatrixRunForCohort(target: string, result: unknown): Promise<void> {
  const directory = process.env.BDP_EMIT_MATRIX_RUN_DIR;
  if (directory === undefined || directory === "") return;
  await writeFile(path.join(directory, `${target}.json`), `${JSON.stringify(result)}\n`);
}

export const controlledReadCapability = "controlled-read-pagination-v1";
export const controlledReadAdvertisedLimitsCapability = "controlled-read-advertised-limits-v1";
export const controlledReadProblemCapability = "controlled-read-problem-table-v1";
export const controlledReadScopeRestoreCapability = "controlled-read-scope-restore-v1";
export const controlledReadExternalEndpointCapability = "controlled-read-external-endpoint-v1";
export const controlledReadExternalTypePublisherCapability =
  "controlled-external-type-publisher-v1";
export const controlledReadViewHeader = "x-bdp-conformance-view";
export const controlledReadEpochHeader = "x-bdp-conformance-epoch";
export const controlledReadUnauthenticatedChallenge = 'Bearer realm="bdp-conformance"';

export interface ControlledTypeDescriptorPublisher {
  readonly fetch: typeof fetch;
  close(): Promise<void>;
}

/** Starts the reviewed credential-free external Type Descriptor authority. */
export async function startControlledTypeDescriptorPublisher(
  descriptors: readonly Readonly<Record<string, unknown>>[],
): Promise<ControlledTypeDescriptorPublisher> {
  const authority = "https://work.example";
  const bodies = new Map<string, string>();
  for (const descriptor of descriptors) {
    const id = requiredString(descriptor, "id");
    const url = new URL(id);
    if (
      url.origin !== authority ||
      url.href !== id ||
      id === `${authority}/types/redirect` ||
      bodies.has(id)
    )
      throw new Error("controlled Type Descriptor publisher received an invalid identity");
    bodies.set(id, JSON.stringify(descriptor));
  }
  const server = createServer((request, response) => {
    const target = new URL(request.url ?? "/", authority).href;
    if (request.headers.authorization !== undefined || request.headers.cookie !== undefined) {
      response.writeHead(400).end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(404).end();
      return;
    }
    if (target === `${authority}/types/redirect`) {
      response.writeHead(302, { location: "/types/task" }).end();
      return;
    }
    const body = bodies.get(target);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => reject(error);
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("controlled Type Descriptor publisher did not expose a TCP address");
  }
  const routedFetch: typeof fetch = async (input, init) => {
    const semantic =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const semanticUrl = new URL(semantic);
    if (semanticUrl.origin !== authority)
      throw new TypeError("controlled Type Descriptor Fetch accepts only https://work.example");
    const dial = new URL(semanticUrl.href);
    dial.protocol = "http:";
    dial.hostname = "127.0.0.1";
    dial.port = String(address.port);
    const response = await fetch(dial, { ...init, redirect: "manual" });
    const semanticResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(semanticResponse, "url", { value: semanticUrl.href });
    return semanticResponse;
  };
  return Object.freeze({
    fetch: routedFetch,
    close: () => {
      server.closeIdleConnections();
      return new Promise<void>((resolve, reject) => {
        const forceClose = setTimeout(() => server.closeAllConnections(), 1_000);
        forceClose.unref();
        server.close((error) => {
          clearTimeout(forceClose);
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
  });
}

export interface ControlledReadActionSession {
  advanceClock(milliseconds: number): void;
  materializeAdvertisedLimitFixture(): void;
  mutateSource(mutation: { readonly id: string; readonly revision: string }): void;
  excludeResourceFromAuthorizationView(id: string): void;
  deleteResource(id: string): void;
  restoreScope(options: {
    readonly requestedScope?: string;
    readonly currentScopeEpoch: string;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly scope: string;
    /** Test-only observation of the restored internal epoch; required for same-Scope restore. */
    readonly scopeEpoch?: string;
    readonly fetch: typeof fetch;
    close(): Promise<void>;
  }>;
  adapterReads(): number;
  adapterReadsByProjection(): Readonly<{ collection: number; incidentLinks: number }>;
  forbidAdapterReads(): () => void;
}

interface PageObservation {
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly next: string | null;
}

interface PageObservationContext {
  readonly schemaValidator: SchemaValidator;
  pages: number;
  schemaValid: boolean;
  mediaTypeValid: boolean;
  privateNoStore: boolean;
}

export function createControlledReadActionExecutor(
  fetchImplementation: typeof fetch,
  fallback: ScenarioActionExecutor,
  activeSession: () => ControlledReadActionSession | undefined,
  schemaValidator: SchemaValidator,
): ScenarioActionExecutor {
  return async (execution) => {
    if (execution.family !== "lifecycle") return fallback(execution);
    if (execution.operation === "problem-table-serialization")
      return observeProblemTable(execution, fetchImplementation, schemaValidator);
    const session = activeSession();
    if (session === undefined)
      throw new Error("controlled Read action executed without an active controlled session");
    const envelope: PageObservationContext = {
      schemaValidator,
      pages: 0,
      schemaValid: true,
      mediaTypeValid: true,
      privateNoStore: true,
    };
    let observed: unknown;
    switch (execution.operation) {
      case "bounded-selector-pagination":
        observed = await observeBoundedSelector(execution, fetchImplementation, session, envelope);
        break;
      case "advertised-limit-boundaries":
        observed = await observeAdvertisedLimitBoundaries(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
          envelope,
        );
        break;
      case "collection-snapshot-pagination":
        observed = await observeCollectionSnapshot(
          execution,
          fetchImplementation,
          session,
          envelope,
        );
        break;
      case "collection-cursor-errors":
        observed = await observeCursorErrors(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
          envelope,
        );
        break;
      case "incident-link-pagination":
        observed = await observeIncidentLinkPagination(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
          envelope,
        );
        break;
      case "nondisclosure-identities":
        observed = await observeNondisclosureIdentities(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
        );
        break;
      case "owned-closure":
        observed = await observeOwnedClosure(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
        );
        break;
      case "disclosure-authorization-gate":
        observed = await observeDisclosureAuthorizationGate(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
        );
        break;
      case "scope-restore-identity":
        observed = await observeScopeRestoreIdentity(
          execution,
          fetchImplementation,
          session,
          schemaValidator,
          envelope,
        );
        break;
      default:
        throw new Error("unsupported controlled Read lifecycle operation");
    }
    return {
      ...actionInput(observed, "controlled Read observation"),
      pagesSchemaValid: envelope.pages > 0 && envelope.schemaValid,
      pagesMediaTypeValid: envelope.pages > 0 && envelope.mediaTypeValid,
      pagesPrivateNoStore: envelope.pages > 0 && envelope.privateNoStore,
    };
  };
}

async function observeAdvertisedLimitBoundaries(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
  envelope: PageObservationContext,
) {
  const input = actionInput(execution.input, "advertised limit input");
  const pageDefault = requiredPositiveInteger(input, "pageDefault");
  const pageMaximum = requiredPositiveInteger(input, "pageMaximum");
  const selectorBytes = requiredPositiveInteger(input, "selectorBytes");
  const selectorDepth = requiredPositiveInteger(input, "selectorDepth");
  const selectorNodes = requiredPositiveInteger(input, "selectorNodes");
  const cursorTtlMilliseconds = requiredPositiveInteger(input, "cursorTtlMilliseconds");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  session.materializeAdvertisedLimitFixture();
  let publicRequests = 0;
  const first = await requestPage(
    fetchImplementation,
    new URL("beads/", execution.scope),
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const maximum = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", { limit: pageMaximum }),
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const aboveMaximum = await requestProblem(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", { limit: pageMaximum + 1 }).href,
    view,
    epoch,
    execution.signal,
    schemaValidator,
  );
  publicRequests += 1;
  const continuation = requiredNext(first);
  const beforeExpiry = await requestPage(
    fetchImplementation,
    continuation,
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  session.advanceClock(cursorTtlMilliseconds - 1);
  const replay = await requestPage(
    fetchImplementation,
    continuation,
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  session.advanceClock(1);
  const expired = await requestProblem(
    fetchImplementation,
    continuation,
    view,
    epoch,
    execution.signal,
    schemaValidator,
  );
  publicRequests += 1;
  const overByteSelector = "x".repeat(selectorBytes + 1);
  const overDepthSelector = `$[?${"!(".repeat(selectorDepth)}@.id${")".repeat(selectorDepth)}]`;
  const overNodeSelector = `$[?${balancedOrExpression(selectorNodes + 1)}]`;
  const selectorProblems = [];
  for (const [name, selector] of [
    ["bytes", overByteSelector],
    ["depth", overDepthSelector],
    ["nodes", overNodeSelector],
  ] as const) {
    try {
      selectorProblems.push(
        await requestProblem(
          fetchImplementation,
          collectionUrl(execution.scope, "beads", { selector }).href,
          view,
          epoch,
          execution.signal,
          schemaValidator,
        ),
      );
      publicRequests += 1;
    } catch (error) {
      throw new Error(`${name} selector limit probe failed`, { cause: error });
    }
  }
  return {
    outcome: "success",
    pageDefault,
    pageMaximum,
    defaultItemsObserved: first.items.length,
    defaultContinuationObserved: first.next !== null,
    maximumItemsObserved: maximum.items.length,
    maximumContinuationObserved: maximum.next !== null,
    aboveMaximum: {
      status: aboveMaximum.status,
      code: aboveMaximum.code,
      retry: aboveMaximum.retry,
      schemaValid: aboveMaximum.schemaValid,
      mediaType: aboveMaximum.mediaType,
      cachePrivateNoStore: aboveMaximum.cachePrivateNoStore,
    },
    replayBeforeExpiry:
      JSON.stringify(pageTuples(replay, execution.scope)) ===
        JSON.stringify(pageTuples(beforeExpiry, execution.scope)) &&
      (replay.next === null) === (beforeExpiry.next === null),
    expired: {
      status: expired.status,
      code: expired.code,
      retry: expired.retry,
      schemaValid: expired.schemaValid,
      mediaType: expired.mediaType,
      cachePrivateNoStore: expired.cachePrivateNoStore,
    },
    selectorLimitsObserved: selectorProblems.map((problem) => [
      problem.status,
      problem.code,
      problem.retry,
      problem.schemaValid,
    ]),
    publicRequests,
  };
}

function balancedOrExpression(minimumNodes: number): string {
  let expressions = Array.from({ length: Math.ceil((minimumNodes + 1) / 2) }, () => "@.id");
  while (expressions.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < expressions.length; index += 2) {
      const left = expressions[index];
      const right = expressions[index + 1];
      if (left === undefined) continue;
      next.push(right === undefined ? left : `(${left} || ${right})`);
    }
    expressions = next;
  }
  return expressions[0] ?? "@.id";
}

async function observeProblemTable(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  schemaValidator: SchemaValidator,
) {
  const input = actionInput(execution.input, "Problem table input");
  const codes = requiredStringArray(input, "codes");
  const rows = [];
  for (const code of codes) {
    const target =
      code === "unauthenticated"
        ? new URL("beads/?limit=1", execution.scope).href
        : new URL(`beads/__problem__/${encodeURIComponent(code)}`, execution.scope).href;
    const problem = await requestProblem(
      fetchImplementation,
      target,
      "problem-table",
      "problem-table",
      execution.signal,
      schemaValidator,
    );
    rows.push([
      problem.code,
      problem.family,
      problem.status,
      problem.retry,
      problem.type,
      problem.authenticationChallenge,
      problem.schemaValid,
      problem.mediaType,
      problem.cachePrivateNoStore,
    ]);
  }
  return { outcome: "success", rows };
}

async function observeNondisclosureIdentities(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
) {
  const input = actionInput(execution.input, "nondisclosure input");
  const hidden = requiredString(input, "hiddenId");
  const deleted = requiredString(input, "deletedId");
  const unknown = requiredString(input, "unknownId");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const hiddenUrl = new URL(hidden, execution.scope).href;
  const deletedUrl = new URL(deleted, execution.scope).href;
  const unknownUrl = new URL(unknown, execution.scope).href;
  const beforeHidden = await requestResource(
    fetchImplementation,
    hiddenUrl,
    view,
    epoch,
    execution.signal,
  );
  const beforeDeleted = await requestResource(
    fetchImplementation,
    deletedUrl,
    view,
    epoch,
    execution.signal,
  );
  if (beforeHidden.status !== 200 || beforeDeleted.status !== 200)
    throw new Error("nondisclosure fixture identities must be live before the transition");
  session.excludeResourceFromAuthorizationView(hiddenUrl);
  session.deleteResource(deletedUrl);
  const observations: Record<string, unknown> = {};
  const rawProblemBodies: Uint8Array[] = [];
  for (const [name, id] of [
    ["hidden", hiddenUrl],
    ["deleted", deletedUrl],
    ["unknown", unknownUrl],
  ] as const) {
    const observation = await observeNondisclosedResource(
      fetchImplementation,
      id,
      view,
      epoch,
      execution.signal,
      schemaValidator,
    );
    observations[name] = observation.semantic;
    rawProblemBodies.push(...observation.rawProblemBodies);
  }
  const hiddenCollection = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", {
      selector: `$[?@.id == ${JSON.stringify(hiddenUrl)}]`,
      limit: 4,
    }),
    view,
    epoch,
    execution.signal,
    { schemaValidator, pages: 0, schemaValid: true, mediaTypeValid: true, privateNoStore: true },
  );
  const deletedCollection = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", {
      selector: `$[?@.id == ${JSON.stringify(deletedUrl)}]`,
      limit: 4,
    }),
    view,
    epoch,
    execution.signal,
    { schemaValidator, pages: 0, schemaValid: true, mediaTypeValid: true, privateNoStore: true },
  );
  const representativeBody = rawProblemBodies[0];
  if (representativeBody === undefined)
    throw new Error("nondisclosure probes did not capture any public Problem body bytes");
  const bodyDigests = rawProblemBodies.map(sha256Hex);
  return {
    outcome: "success",
    hiddenLiveBefore: beforeHidden.status === 200,
    deletedLiveBefore: beforeDeleted.status === 200,
    hidden: observations.hidden,
    deleted: observations.deleted,
    unknown: observations.unknown,
    rawBodyEvidence: {
      probeCount: rawProblemBodies.length,
      byteIdentical: rawProblemBodies.every((body) => bytesEqual(body, representativeBody)),
      digestAlgorithm: "sha-256",
      distinctDigests: new Set(bodyDigests).size,
      representativeDigest: bodyDigests[0],
      representativeByteLength: representativeBody.byteLength,
    },
    hiddenAbsentFromCollection: hiddenCollection.items.length === 0,
    deletedAbsentFromCollection: deletedCollection.items.length === 0,
  };
}

async function observeDisclosureAuthorizationGate(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
) {
  const input = actionInput(execution.input, "disclosure gate input");
  const pruned = requiredString(input, "prunedId");
  const erased = requiredString(input, "erasedId");
  const unknown = requiredString(input, "unknownId");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const prunedUrl = new URL(pruned, execution.scope).href;
  const erasedUrl = new URL(erased, execution.scope).href;
  const unknownUrl = new URL(unknown, execution.scope).href;
  // The retained-history projection sees the 410 vocabulary at both subjects.
  const authorizedPruned = await requestProblem(
    fetchImplementation,
    prunedUrl,
    view,
    epoch,
    execution.signal,
    schemaValidator,
  );
  const authorizedErased = await requestProblem(
    fetchImplementation,
    erasedUrl,
    view,
    epoch,
    execution.signal,
    schemaValidator,
  );
  if (authorizedPruned.status !== 410 || authorizedErased.status !== 410)
    throw new Error("disclosure gate subjects must disclose 410 before the projection changes");
  // Excluding the subjects models a caller without the retained-history
  // authorization: every address, gone or never-existing, answers alike.
  session.excludeResourceFromAuthorizationView(prunedUrl);
  session.excludeResourceFromAuthorizationView(erasedUrl);
  const observations: Record<string, unknown> = {};
  const rawProblemBodies: Uint8Array[] = [];
  for (const [name, id] of [
    ["pruned", prunedUrl],
    ["erased", erasedUrl],
    ["unknown", unknownUrl],
  ] as const) {
    const observation = await observeNondisclosedResource(
      fetchImplementation,
      id,
      view,
      epoch,
      execution.signal,
      schemaValidator,
    );
    observations[name] = observation.semantic;
    rawProblemBodies.push(...observation.rawProblemBodies);
  }
  const representativeBody = rawProblemBodies[0];
  if (representativeBody === undefined)
    throw new Error("disclosure gate probes did not capture any public Problem body bytes");
  const bodyDigests = rawProblemBodies.map(sha256Hex);
  return {
    outcome: "success",
    authorizedPruned: {
      status: authorizedPruned.status,
      code: authorizedPruned.code,
      retry: authorizedPruned.retry,
    },
    authorizedErased: {
      status: authorizedErased.status,
      code: authorizedErased.code,
      retry: authorizedErased.retry,
    },
    pruned: observations.pruned,
    erased: observations.erased,
    unknown: observations.unknown,
    rawBodyEvidence: {
      probeCount: rawProblemBodies.length,
      byteIdentical: rawProblemBodies.every((body) => bytesEqual(body, representativeBody)),
      digestAlgorithm: "sha-256",
      distinctDigests: new Set(bodyDigests).size,
      representativeDigest: bodyDigests[0],
      representativeByteLength: representativeBody.byteLength,
    },
  };
}

/**
 * Proves the owned-closure law end to end: before the projection changes,
 * the source Bead is live and inlines the owned Link; excluding the owned
 * Link's TARGET then hides the target, the owned Link, and the owning
 * source — all answering the uniform not-found, byte-identical to a
 * never-existing address — while an unrelated Bead stays live and the
 * collections stop enumerating every hidden identity.
 */
async function observeOwnedClosure(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
) {
  const input = actionInput(execution.input, "owned-closure input");
  const source = requiredString(input, "source");
  const target = requiredString(input, "target");
  const link = requiredString(input, "link");
  const control = requiredString(input, "control");
  const unknown = requiredString(input, "unknown");
  const unknownLink = requiredString(input, "unknownLink");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const sourceUrl = new URL(source, execution.scope).href;
  const targetUrl = new URL(target, execution.scope).href;
  const linkUrl = new URL(link, execution.scope).href;
  const controlUrl = new URL(control, execution.scope).href;
  const unknownUrl = new URL(unknown, execution.scope).href;
  const unknownLinkUrl = new URL(unknownLink, execution.scope).href;
  const beforeResponse = await fetchImplementation(
    sourceUrl,
    requestInit(view, epoch, execution.signal),
  );
  const sourceLiveBefore = beforeResponse.status === 200;
  const beforeBody = sourceLiveBefore ? await readJsonRecord(beforeResponse) : undefined;
  if (!sourceLiveBefore) await discardBody(beforeResponse);
  const ownedLinksServedBefore =
    beforeBody !== undefined &&
    isPlainRecord(beforeBody.ownedLinks) &&
    Object.values(beforeBody.ownedLinks).some(
      (entry) =>
        Array.isArray(entry) && entry.some((owned) => isPlainRecord(owned) && owned.id === linkUrl),
    );
  const beforeTarget = await requestResource(
    fetchImplementation,
    targetUrl,
    view,
    epoch,
    execution.signal,
  );
  if (!sourceLiveBefore || beforeTarget.status !== 200)
    throw new Error("owned-closure fixture identities must be live before the exclusion");
  session.excludeResourceFromAuthorizationView(targetUrl);
  const observations: Record<string, unknown> = {};
  const rawProblemBodies: Uint8Array[] = [];
  for (const [name, id] of [
    ["target", targetUrl],
    ["source", sourceUrl],
    ["unknown", unknownUrl],
  ] as const) {
    const observation = await observeNondisclosedResource(
      fetchImplementation,
      id,
      view,
      epoch,
      execution.signal,
      schemaValidator,
    );
    observations[name] = observation.semantic;
    rawProblemBodies.push(...observation.rawProblemBodies);
  }
  // A Link URL has no `links` view — the plane refuses `?view=links` with
  // the same structural problem for known and unknown Links alike — so a
  // Link's nondisclosure surface is its resource and properties variants.
  for (const [name, id] of [
    ["link", linkUrl],
    ["unknownLink", unknownLinkUrl],
  ] as const) {
    const variants = [
      ["resource", id],
      ["properties", `${id}?view=properties`],
    ] as const;
    const probes = [];
    for (const [variant, probeTarget] of variants) {
      const observedProblem = await requestProblemWithBytes(
        fetchImplementation,
        probeTarget,
        view,
        epoch,
        execution.signal,
        schemaValidator,
      );
      rawProblemBodies.push(observedProblem.bodyBytes);
      const problem = observedProblem.problem;
      probes.push({
        variant,
        status: problem.status,
        code: problem.code,
        type: problem.type,
        retry: problem.retry,
        mediaType: problem.mediaType,
        schemaValid: problem.schemaValid,
        cachePrivateNoStore: problem.cachePrivateNoStore,
      });
    }
    observations[name] = { probeCount: probes.length, probes };
  }
  const afterControl = await requestResource(
    fetchImplementation,
    controlUrl,
    view,
    epoch,
    execution.signal,
  );
  const emptyEnvelope = () => ({
    schemaValidator,
    pages: 0,
    schemaValid: true,
    mediaTypeValid: true,
    privateNoStore: true,
  });
  const sourceCollection = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", {
      selector: `$[?@.id == ${JSON.stringify(sourceUrl)}]`,
      limit: 4,
    }),
    view,
    epoch,
    execution.signal,
    emptyEnvelope(),
  );
  const targetCollection = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", {
      selector: `$[?@.id == ${JSON.stringify(targetUrl)}]`,
      limit: 4,
    }),
    view,
    epoch,
    execution.signal,
    emptyEnvelope(),
  );
  const linkCollection = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "links", {
      selector: `$[?@.id == ${JSON.stringify(linkUrl)}]`,
      limit: 4,
    }),
    view,
    epoch,
    execution.signal,
    emptyEnvelope(),
  );
  const representativeBody = rawProblemBodies[0];
  if (representativeBody === undefined)
    throw new Error("owned-closure probes did not capture any public Problem body bytes");
  const bodyDigests = rawProblemBodies.map(sha256Hex);
  return {
    outcome: "success",
    sourceLiveBefore,
    targetLiveBefore: beforeTarget.status === 200,
    ownedLinksServedBefore,
    target: observations.target,
    source: observations.source,
    link: observations.link,
    unknown: observations.unknown,
    unknownLink: observations.unknownLink,
    rawBodyEvidence: {
      probeCount: rawProblemBodies.length,
      byteIdentical: rawProblemBodies.every((body) => bytesEqual(body, representativeBody)),
      digestAlgorithm: "sha-256",
      distinctDigests: new Set(bodyDigests).size,
      representativeDigest: bodyDigests[0],
      representativeByteLength: representativeBody.byteLength,
    },
    controlLiveAfter: afterControl.status === 200,
    sourceAbsentFromCollection: sourceCollection.items.length === 0,
    targetAbsentFromCollection: targetCollection.items.length === 0,
    linkAbsentFromCollection: linkCollection.items.length === 0,
  };
}

async function observeNondisclosedResource(
  fetchImplementation: typeof fetch,
  id: string,
  view: string,
  epoch: string,
  signal: AbortSignal,
  schemaValidator: SchemaValidator,
) {
  const variants = [
    ["resource", id],
    ["properties", `${id}?view=properties`],
    ["links", `${id}?view=links`],
  ] as const;
  const probes = [];
  const rawProblemBodies: Uint8Array[] = [];
  for (const [variant, target] of variants) {
    const observedProblem = await requestProblemWithBytes(
      fetchImplementation,
      target,
      view,
      epoch,
      signal,
      schemaValidator,
    );
    const problem = observedProblem.problem;
    rawProblemBodies.push(observedProblem.bodyBytes);
    probes.push({
      variant,
      status: problem.status,
      code: problem.code,
      type: problem.type,
      retry: problem.retry,
      mediaType: problem.mediaType,
      schemaValid: problem.schemaValid,
      cachePrivateNoStore: problem.cachePrivateNoStore,
    });
  }
  return {
    semantic: {
      probeCount: probes.length,
      probes,
    },
    rawProblemBodies,
  };
}

async function observeScopeRestoreIdentity(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
  envelope: PageObservationContext,
) {
  const input = actionInput(execution.input, "restore identity input");
  const stable = requiredString(input, "stableId");
  const deleted = requiredString(input, "deletedId");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const stableUrl = new URL(stable, execution.scope).href;
  const deletedUrl = new URL(deleted, execution.scope).href;
  const before = await requestResource(
    fetchImplementation,
    stableUrl,
    view,
    epoch,
    execution.signal,
  );
  const deletedBefore = await requestResource(
    fetchImplementation,
    deletedUrl,
    view,
    epoch,
    execution.signal,
  );
  if (before.status !== 200 || deletedBefore.status !== 200)
    throw new Error("restore fixture identities were not readable before restore");
  const preRestorePage = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, "beads", { limit: 1 }),
    view,
    epoch,
    execution.signal,
    envelope,
  );
  const preRestoreCursor = requiredNext(preRestorePage);
  session.deleteResource(deletedUrl);
  const requestedScope = optionalString(input, "restoredScope");
  const restored = await session.restoreScope({
    ...(requestedScope === undefined ? {} : { requestedScope }),
    currentScopeEpoch: epoch,
    signal: execution.signal,
  });
  try {
    const restoredScope = new URL(restored.scope).href;
    if (restoredScope !== restored.scope || !restoredScope.endsWith("/"))
      throw new Error("restore returned a non-canonical Scope URL");
    const stableAfterUrl = new URL(stable, restoredScope).href;
    const deletedAfterUrl = new URL(deleted, restoredScope).href;
    const sameScope = restoredScope === execution.scope;
    const restoredEpoch = sameScope
      ? requiredRestoredScopeEpoch(restored.scopeEpoch, epoch)
      : epoch;
    const discovery = await requestJson(
      restored.fetch,
      new URL("bdp.json", restoredScope).href,
      execution.signal,
    );
    const discoveryScope = requiredString(actionInput(discovery, "restored discovery"), "scope");
    const after = await requestResource(
      restored.fetch,
      stableAfterUrl,
      view,
      restoredEpoch,
      execution.signal,
    );
    const deletedAfter = await requestResourceStatusAndCode(
      restored.fetch,
      deletedAfterUrl,
      view,
      restoredEpoch,
      execution.signal,
      schemaValidator,
    );
    const staleCursor = sameScope
      ? await requestProblem(
          restored.fetch,
          preRestoreCursor,
          view,
          restoredEpoch,
          execution.signal,
          schemaValidator,
        )
      : undefined;
    const oldStable = sameScope
      ? undefined
      : await requestStatus(restored.fetch, stableUrl, view, epoch, execution.signal);
    const oldDeleted = sameScope
      ? undefined
      : await requestStatus(restored.fetch, deletedUrl, view, epoch, execution.signal);
    return {
      outcome: "success",
      mode: sameScope ? "same-scope" : "new-scope",
      stableLiveBefore: before.status === 200 && before.id === stableUrl,
      deletedLiveBefore: deletedBefore.status === 200 && deletedBefore.id === deletedUrl,
      discoveryMatchesRestoredScope: discoveryScope === restoredScope,
      scopeChanged: !sameScope,
      stableIdentityChanged: after.id !== before.id,
      stableAtRestoredScope: after.status === 200 && after.id === stableAfterUrl,
      deletedStatusAtRestoredScope: deletedAfter.status,
      deletedCodeAtRestoredScope: deletedAfter.code,
      scopeEpochChanged: sameScope ? restoredEpoch !== epoch : null,
      staleCursorStatus: staleCursor?.status ?? null,
      staleCursorCode: staleCursor?.code ?? null,
      oldStableStatus: oldStable ?? null,
      oldDeletedStatus: oldDeleted ?? null,
    };
  } finally {
    await restored.close();
  }
}

function requiredRestoredScopeEpoch(candidate: string | undefined, previous: string): string {
  if (candidate === undefined || candidate.length === 0)
    throw new Error("same-Scope restore did not report its restored Scope epoch");
  if (candidate === previous) throw new Error("same-Scope restore did not change its Scope epoch");
  return candidate;
}

async function observeBoundedSelector(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  envelope: PageObservationContext,
) {
  const input = actionInput(execution.input, "bounded Selector");
  const collection = requiredString(input, "collection");
  const selector = requiredString(input, "selector");
  const syntaxSelector = requiredString(input, "syntaxSelector");
  const overLimitSelector = requiredString(input, "overLimitSelector");
  const limit = requiredPositiveInteger(input, "limit");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const authorizationExcludedId = requiredString(input, "authorizationExcludedId");
  const limits = actionInput(input.selectorLimits, "Selector limits");
  if (
    limits.bytes !== 128 ||
    limits.depth !== 16 ||
    limits.nodes !== 64 ||
    Reflect.ownKeys(limits).length !== 3
  )
    throw new Error("bounded Selector input does not match the controlled session limits");
  const initial = collectionUrl(execution.scope, collection, { selector, limit });
  session.excludeResourceFromAuthorizationView(authorizationExcludedId);
  let publicRequests = 0;
  const readsBefore = session.adapterReads();
  const first = await requestPage(
    fetchImplementation,
    initial,
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const pages = [pageIds(first, execution.scope)];
  let next = first.next;
  const continuationObserved = next !== null;
  const releaseGuard = session.forbidAdapterReads();
  try {
    while (next !== null) {
      const page = await requestPage(
        fetchImplementation,
        next,
        view,
        epoch,
        execution.signal,
        envelope,
      );
      publicRequests += 1;
      pages.push(pageIds(page, execution.scope));
      next = page.next;
    }
  } finally {
    releaseGuard();
  }
  const validAdapterReads = session.adapterReads() - readsBefore;
  const ids = pages.flat().sort();
  const syntax = await fetchImplementation(
    collectionUrl(execution.scope, collection, { selector: syntaxSelector }),
    requestInit(view, epoch, execution.signal),
  );
  publicRequests += 1;
  const overLimit = await fetchImplementation(
    collectionUrl(execution.scope, collection, { selector: overLimitSelector }),
    requestInit(view, epoch, execution.signal),
  );
  publicRequests += 1;
  await Promise.all([discardBody(syntax), discardBody(overLimit)]);
  return {
    outcome: "success",
    ids,
    pageSizes: pages.map((page) => page.length),
    noDuplicates: new Set(ids).size === ids.length,
    complete: next === null,
    continuationObserved,
    syntaxRejected: syntax.status >= 400,
    overLimitRejected: overLimit.status >= 400,
    validAdapterReads,
    publicRequests,
  };
}

async function observeCollectionSnapshot(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  envelope: PageObservationContext,
) {
  const input = actionInput(execution.input, "collection snapshot");
  const collection = requiredString(input, "collection");
  const limit = requiredPositiveInteger(input, "limit");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const mutationInput = actionInput(input.mutation, "collection mutation");
  const candidateIds = requiredStringArray(mutationInput, "candidateIds");
  const mutationRevision = requiredString(mutationInput, "revision");
  const initial = collectionUrl(execution.scope, collection, { limit });
  let publicRequests = 0;
  const readsBefore = session.adapterReads();
  const first = await requestPage(
    fetchImplementation,
    initial,
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const pages = [pageTuples(first, execution.scope)];
  const firstIds = new Set(pages[0]?.map(([id]) => id));
  const mutationId = candidateIds.find((id) => !firstIds.has(id));
  if (mutationId === undefined)
    throw new Error("collection snapshot has no mutation candidate outside the first page");
  const mutation = { id: mutationId, revision: mutationRevision };
  const absoluteMutationId = new URL(mutation.id, execution.scope).href;
  const baseline = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, collection, {
      selector: `$[?@.id == "${absoluteMutationId}"]`,
      limit,
    }),
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const baselineMutationTuple = pageTuples(baseline, execution.scope).find(
    ([id]) => id === mutation.id,
  );
  if (baselineMutationTuple === undefined)
    throw new Error("collection snapshot baseline did not contain the mutation Resource");
  const continuationObserved = first.next !== null;
  session.mutateSource(mutation);
  let next = first.next;
  const readsBeforeContinuation = session.adapterReads();
  const releaseGuard = session.forbidAdapterReads();
  try {
    while (next !== null) {
      const page = await requestPage(
        fetchImplementation,
        next,
        view,
        epoch,
        execution.signal,
        envelope,
      );
      publicRequests += 1;
      pages.push(pageTuples(page, execution.scope));
      next = page.next;
    }
  } finally {
    releaseGuard();
  }
  const adapterReadsDuringContinuation = session.adapterReads() - readsBeforeContinuation;
  const freshTarget = collectionUrl(execution.scope, collection, {
    selector: `$[?@.id == "${absoluteMutationId}"]`,
    limit,
  });
  const fresh = await requestPage(
    fetchImplementation,
    freshTarget,
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const freshTuples = pageTuples(fresh, execution.scope);
  const originalMutationTuple = pages.flat().find(([id]) => id === mutation.id);
  const freshMutationTuple = freshTuples.find(([id]) => id === mutation.id);
  const ids = pages
    .flat()
    .map(([id]) => id)
    .sort();
  return {
    outcome: "success",
    ids,
    pageSizes: pages.map((page) => page.length),
    noDuplicates: new Set(ids).size === ids.length,
    complete: next === null,
    continuationObserved,
    baselineRevision: baselineMutationTuple[1],
    baselineRevisionDistinct: baselineMutationTuple[1] !== mutation.revision,
    oldMutationRevisionPreserved: originalMutationTuple?.[1] === baselineMutationTuple[1],
    underlyingMutationObserved: freshMutationTuple?.[1] === mutation.revision,
    freshRevision: freshMutationTuple?.[1] ?? null,
    adapterReads: session.adapterReads() - readsBefore,
    adapterReadsDuringContinuation,
    publicRequests,
  };
}

async function observeCursorErrors(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
  envelope: PageObservationContext,
) {
  const input = actionInput(execution.input, "cursor errors");
  const collection = requiredString(input, "collection");
  const limit = requiredPositiveInteger(input, "limit");
  const malformed = actionInput(input.malformedQuery, "malformed cursor query");
  const clockAdvanceMs = requiredPositiveInteger(input, "clockAdvanceMs");
  const initialView = requiredString(input, "initialView");
  const foreignView = requiredString(input, "foreignView");
  const initialEpoch = requiredString(input, "initialEpoch");
  const foreignEpoch = requiredString(input, "foreignEpoch");
  let publicRequests = 0;
  const readsBefore = session.adapterReads();
  const malformedUrl = collectionUrl(execution.scope, collection, {
    cursor: requiredString(malformed, "cursor"),
    limit: requiredString(malformed, "limit"),
  });
  const malformedResponse = await fetchImplementation(
    malformedUrl,
    requestInit(initialView, initialEpoch, execution.signal),
  );
  publicRequests += 1;
  await discardBody(malformedResponse);

  const initialUrl = collectionUrl(execution.scope, collection, { limit });
  const foreignFirst = await requestPage(
    fetchImplementation,
    initialUrl,
    initialView,
    initialEpoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const foreignNext = requiredNext(foreignFirst);
  const beforeForeign = await requestPage(
    fetchImplementation,
    foreignNext,
    initialView,
    initialEpoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const foreignResponse = await requestProblem(
    fetchImplementation,
    foreignNext,
    foreignView,
    initialEpoch,
    execution.signal,
    schemaValidator,
  );
  publicRequests += 1;
  const replay = await requestPage(
    fetchImplementation,
    foreignNext,
    initialView,
    initialEpoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;

  const expiringFirst = await requestPage(
    fetchImplementation,
    initialUrl,
    initialView,
    initialEpoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  session.advanceClock(clockAdvanceMs);
  const expiredResponse = await requestProblem(
    fetchImplementation,
    requiredNext(expiringFirst),
    initialView,
    initialEpoch,
    execution.signal,
    schemaValidator,
  );
  publicRequests += 1;

  const epochFirst = await requestPage(
    fetchImplementation,
    initialUrl,
    initialView,
    initialEpoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const epochResponse = await requestProblem(
    fetchImplementation,
    requiredNext(epochFirst),
    initialView,
    foreignEpoch,
    execution.signal,
    schemaValidator,
  );
  publicRequests += 1;
  return {
    malformedRejected: malformedResponse.status >= 400,
    expired: expiredResponse,
    foreignView: foreignResponse,
    epochFence: epochResponse,
    replayAfterForeign: "success",
    replayPreserved:
      JSON.stringify(pageTuples(replay, execution.scope)) ===
        JSON.stringify(pageTuples(beforeForeign, execution.scope)) &&
      (replay.next === null) === (beforeForeign.next === null),
    adapterReads: session.adapterReads() - readsBefore,
    publicRequests,
  };
}

async function observeIncidentLinkPagination(
  execution: ScenarioActionExecution,
  fetchImplementation: typeof fetch,
  session: ControlledReadActionSession,
  schemaValidator: SchemaValidator,
  envelope: PageObservationContext,
) {
  const input = actionInput(execution.input, "incident Link pagination");
  const collection = requiredString(input, "collection");
  const bead = requiredString(input, "bead");
  const direction = requiredString(input, "direction");
  const limit = requiredPositiveInteger(input, "limit");
  const view = requiredString(input, "view");
  const epoch = requiredString(input, "epoch");
  const clockAdvanceMs = requiredPositiveInteger(input, "clockAdvanceMs");
  const mutationInput = actionInput(input.mutation, "incident Link mutation");
  const candidateIds = requiredStringArray(mutationInput, "candidateIds");
  const mutationRevision = requiredString(mutationInput, "revision");
  const collectionTarget = collectionUrl(execution.scope, collection, { limit });
  const incidentTarget = new URL(bead, execution.scope);
  incidentTarget.searchParams.set("view", "links");
  incidentTarget.searchParams.set("direction", direction);
  incidentTarget.searchParams.set("limit", String(limit));
  const readsBefore = session.adapterReadsByProjection();
  let publicRequests = 2;
  const [firstCollection, firstIncident] = await Promise.all([
    requestPage(fetchImplementation, collectionTarget, view, epoch, execution.signal, envelope),
    requestPage(fetchImplementation, incidentTarget, view, epoch, execution.signal, envelope),
  ]);
  const collectionRows = pageTuples(firstCollection, execution.scope).slice();
  const incidentLinkRows = pageTuples(firstIncident, execution.scope).slice();
  const collectionPageSizes = [firstCollection.items.length];
  const incidentPageSizes = [firstIncident.items.length];
  const firstIds = new Set([...collectionRows, ...incidentLinkRows].map(([id]) => id));
  const mutationId = candidateIds.find((id) => !firstIds.has(id));
  if (mutationId === undefined)
    throw new Error(
      "incident Link pagination has no shared mutation candidate outside first pages",
    );
  const mutation = { id: mutationId, revision: mutationRevision };
  const absoluteMutationId = new URL(mutation.id, execution.scope).href;
  const baseline = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, collection, {
      selector: `$[?@.id == "${absoluteMutationId}"]`,
      limit,
    }),
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const baselineMutationTuple = pageTuples(baseline, execution.scope).find(
    ([id]) => id === mutation.id,
  );
  if (baselineMutationTuple === undefined)
    throw new Error("incident Link baseline did not contain the mutation Resource");
  let collectionNext = firstCollection.next;
  let incidentNext = firstIncident.next;
  const issuedIncidentCursor = requiredNext(firstIncident);
  const collectionContinuationObserved = collectionNext !== null;
  const incidentContinuationObserved = incidentNext !== null;
  session.mutateSource(mutation);
  const continuationReadsBefore = session.adapterReadsByProjection();
  let incidentCursorReplayableBeforeExpiry = false;
  const releaseGuard = session.forbidAdapterReads();
  try {
    const issuedIncidentPage = await requestPage(
      fetchImplementation,
      issuedIncidentCursor,
      view,
      epoch,
      execution.signal,
      envelope,
    );
    publicRequests += 1;
    incidentLinkRows.push(...pageTuples(issuedIncidentPage, execution.scope));
    incidentPageSizes.push(issuedIncidentPage.items.length);
    incidentNext = issuedIncidentPage.next;
    const replayedIncidentPage = await requestPage(
      fetchImplementation,
      issuedIncidentCursor,
      view,
      epoch,
      execution.signal,
      envelope,
    );
    publicRequests += 1;
    incidentCursorReplayableBeforeExpiry =
      JSON.stringify(pageTuples(replayedIncidentPage, execution.scope)) ===
        JSON.stringify(pageTuples(issuedIncidentPage, execution.scope)) &&
      (replayedIncidentPage.next === null) === (issuedIncidentPage.next === null);
    while (collectionNext !== null || incidentNext !== null) {
      if (collectionNext !== null) {
        const page = await requestPage(
          fetchImplementation,
          collectionNext,
          view,
          epoch,
          execution.signal,
          envelope,
        );
        publicRequests += 1;
        collectionRows.push(...pageTuples(page, execution.scope));
        collectionPageSizes.push(page.items.length);
        collectionNext = page.next;
      }
      if (incidentNext !== null) {
        const page = await requestPage(
          fetchImplementation,
          incidentNext,
          view,
          epoch,
          execution.signal,
          envelope,
        );
        publicRequests += 1;
        incidentLinkRows.push(...pageTuples(page, execution.scope));
        incidentPageSizes.push(page.items.length);
        incidentNext = page.next;
      }
    }
  } finally {
    releaseGuard();
  }
  const continuationReadsAfter = session.adapterReadsByProjection();
  const fresh = await requestPage(
    fetchImplementation,
    collectionUrl(execution.scope, collection, {
      selector: `$[?@.id == "${absoluteMutationId}"]`,
      limit,
    }),
    view,
    epoch,
    execution.signal,
    envelope,
  );
  publicRequests += 1;
  const freshMutationTuple = pageTuples(fresh, execution.scope).find(([id]) => id === mutation.id);
  const oldCollectionMutationTuple = collectionRows.find(([id]) => id === mutation.id);
  const oldIncidentMutationTuple = incidentLinkRows.find(([id]) => id === mutation.id);
  session.advanceClock(clockAdvanceMs);
  const expired = await requestProblem(
    fetchImplementation,
    issuedIncidentCursor,
    view,
    epoch,
    execution.signal,
    schemaValidator,
  );
  publicRequests += 1;
  const readsAfter = session.adapterReadsByProjection();
  const collectionIds = collectionRows.map(([id]) => id).sort();
  const incidentLinkIds = incidentLinkRows.map(([id]) => id).sort();
  return {
    outcome: "success",
    collectionIds,
    incidentLinkIds,
    collectionPageSizes,
    incidentPageSizes,
    collectionNoDuplicates: new Set(collectionIds).size === collectionIds.length,
    incidentNoDuplicates: new Set(incidentLinkIds).size === incidentLinkIds.length,
    collectionComplete: collectionNext === null,
    incidentLinksComplete: incidentNext === null,
    collectionContinuationObserved,
    incidentContinuationObserved,
    baselineRevision: baselineMutationTuple[1],
    baselineRevisionDistinct: baselineMutationTuple[1] !== mutation.revision,
    oldCollectionMutationRevisionPreserved:
      oldCollectionMutationTuple?.[1] === baselineMutationTuple[1],
    oldIncidentMutationRevisionPreserved:
      oldIncidentMutationTuple?.[1] === baselineMutationTuple[1],
    underlyingMutationObserved: freshMutationTuple?.[1] === mutation.revision,
    freshRevision: freshMutationTuple?.[1] ?? null,
    incidentCursorReplayableBeforeExpiry,
    adapterReads: {
      collection: readsAfter.collection - readsBefore.collection,
      incidentLinks: readsAfter.incidentLinks - readsBefore.incidentLinks,
    },
    adapterReadsDuringContinuation: {
      collection: continuationReadsAfter.collection - continuationReadsBefore.collection,
      incidentLinks: continuationReadsAfter.incidentLinks - continuationReadsBefore.incidentLinks,
    },
    expired,
    publicRequests,
  };
}

async function requestPage(
  fetchImplementation: typeof fetch,
  target: string | URL,
  view: string,
  epoch: string,
  signal: AbortSignal,
  envelope: PageObservationContext,
): Promise<PageObservation> {
  const response = await fetchImplementation(target, requestInit(view, epoch, signal));
  const body = await readJsonRecord(response);
  if (response.status !== 200)
    throw new Error(`controlled page request failed with ${response.status}`);
  if (!Array.isArray(body.items) || (body.next !== null && typeof body.next !== "string"))
    throw new Error("controlled page response was malformed");
  const items = body.items.map((item) => actionInput(item, "page item"));
  const next = body.next as string | null;
  if (next !== null) validateContinuation(next, response.url);
  const schemaValid =
    envelope.schemaValidator.validate(pageSchemaFor(response.url), body).length === 0;
  const mediaTypeValid = normalizedMediaType(response) === "application/json";
  const privateNoStore = hasPrivateNoStore(response.headers.get("cache-control"));
  envelope.pages += 1;
  envelope.schemaValid &&= schemaValid;
  envelope.mediaTypeValid &&= mediaTypeValid;
  envelope.privateNoStore &&= privateNoStore;
  return { items, next };
}

async function requestResource(
  fetchImplementation: typeof fetch,
  target: string,
  view: string,
  epoch: string,
  signal: AbortSignal,
): Promise<{ readonly status: number; readonly id: string | null }> {
  const response = await fetchImplementation(target, requestInit(view, epoch, signal));
  if (response.status !== 200) {
    await discardBody(response);
    return { status: response.status, id: null };
  }
  const body = await readJsonRecord(response);
  return { status: response.status, id: requiredString(body, "id") };
}

async function requestResourceStatusAndCode(
  fetchImplementation: typeof fetch,
  target: string,
  view: string,
  epoch: string,
  signal: AbortSignal,
  schemaValidator: SchemaValidator,
): Promise<{ readonly status: number; readonly code: string | null }> {
  const response = await fetchImplementation(target, requestInit(view, epoch, signal));
  const body = await readJsonRecord(response);
  if (response.status === 200) {
    if (requiredString(body, "id") !== target)
      throw new Error("restored Resource response identity did not match its request");
    return { status: 200, code: null };
  }
  if (schemaValidator.validate("#/$defs/readProblem", body).length > 0)
    throw new Error("restored Resource failure was not a valid Read Problem");
  return { status: response.status, code: requiredString(body, "code") };
}

async function requestJson(
  fetchImplementation: typeof fetch,
  target: string,
  signal: AbortSignal,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetchImplementation(target, {
    signal,
    headers: { accept: "application/json" },
  });
  if (response.status !== 200) {
    await discardBody(response);
    throw new Error(`controlled JSON request failed with ${response.status}`);
  }
  return readJsonRecord(response);
}

async function requestStatus(
  fetchImplementation: typeof fetch,
  target: string,
  view: string,
  epoch: string,
  signal: AbortSignal,
): Promise<number> {
  const response = await fetchImplementation(target, requestInit(view, epoch, signal));
  await discardBody(response);
  return response.status;
}

function pageSchemaFor(responseUrl: string): "#/$defs/beadCollection" | "#/$defs/linkCollection" {
  const url = new URL(responseUrl);
  if (url.searchParams.get("view") === "links" || url.pathname.endsWith("/links/"))
    return "#/$defs/linkCollection";
  if (url.pathname.endsWith("/beads/")) return "#/$defs/beadCollection";
  throw new Error("controlled page request used an unsupported projection");
}

async function requestProblem(
  fetchImplementation: typeof fetch,
  target: string,
  view: string,
  epoch: string,
  signal: AbortSignal,
  schemaValidator: SchemaValidator,
): Promise<{
  readonly status: number;
  readonly code: string;
  readonly family: string;
  readonly type: string;
  readonly retry: string;
  readonly authenticationChallenge: string | null;
  readonly cachePrivateNoStore: boolean;
  readonly mediaType: string | null;
  readonly schemaValid: boolean;
}> {
  return (
    await requestProblemWithBytes(fetchImplementation, target, view, epoch, signal, schemaValidator)
  ).problem;
}

async function requestProblemWithBytes(
  fetchImplementation: typeof fetch,
  target: string,
  view: string,
  epoch: string,
  signal: AbortSignal,
  schemaValidator: SchemaValidator,
) {
  const response = await fetchImplementation(target, requestInit(view, epoch, signal));
  const observedBody = await readJsonRecordWithBytes(response);
  const body = observedBody.value;
  const type = requiredString(body, "type");
  return {
    problem: {
      status: response.status,
      code: requiredString(body, "code"),
      family: type.slice(type.lastIndexOf("/") + 1),
      type,
      retry: requiredString(body, "retry"),
      authenticationChallenge: response.headers.get("www-authenticate"),
      cachePrivateNoStore: hasPrivateNoStore(response.headers.get("cache-control")),
      mediaType: normalizedMediaType(response),
      schemaValid: schemaValidator.validate("#/$defs/readProblem", body).length === 0,
    },
    bodyBytes: observedBody.bytes,
  };
}

function validateContinuation(next: string, responseUrl: string): void {
  let continuation: URL;
  let response: URL;
  try {
    continuation = new URL(next);
    response = new URL(responseUrl);
  } catch {
    throw new Error("controlled page continuation was not an absolute URL");
  }
  if (
    (continuation.protocol !== "http:" && continuation.protocol !== "https:") ||
    continuation.username !== "" ||
    continuation.password !== "" ||
    continuation.hash !== "" ||
    continuation.origin !== response.origin ||
    continuation.pathname !== response.pathname
  )
    throw new Error("controlled page continuation escaped the canonical Scope");
}

function normalizedMediaType(response: Response): string | null {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function hasPrivateNoStore(value: string | null): boolean {
  if (value === null) return false;
  const tokens = value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  return (
    tokens.length === 2 &&
    new Set(tokens).size === 2 &&
    tokens.includes("private") &&
    tokens.includes("no-store")
  );
}

function requestInit(view: string, epoch: string, signal: AbortSignal): RequestInit {
  return {
    signal,
    headers: {
      accept: "application/json",
      [controlledReadViewHeader]: view,
      [controlledReadEpochHeader]: epoch,
    },
  };
}

function collectionUrl(
  baseScope: string,
  collection: string,
  parameters: Readonly<Record<string, string | number>>,
): URL {
  const url = new URL(`${collection}/`, baseScope);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value));
  return url;
}

function pageTuples(
  page: PageObservation,
  baseScope: string,
): readonly (readonly [string, string])[] {
  return page.items.map((item) => [relativeId(item, baseScope), requiredString(item, "revision")]);
}

function pageIds(page: PageObservation, baseScope: string): readonly string[] {
  return page.items.map((item) => relativeId(item, baseScope));
}

function relativeId(item: Readonly<Record<string, unknown>>, baseScope: string): string {
  const id = requiredString(item, "id");
  const scopeUrl = new URL(baseScope);
  const idUrl = new URL(id);
  if (idUrl.origin !== scopeUrl.origin || !idUrl.pathname.startsWith(scopeUrl.pathname))
    throw new Error("controlled page item ID was outside the Scope");
  return `${idUrl.pathname.slice(scopeUrl.pathname.length)}${idUrl.search}${idUrl.hash}`;
}

function requiredNext(page: PageObservation): string {
  if (page.next === null) throw new Error("controlled cursor scenario did not produce a cursor");
  return page.next;
}

async function readJsonRecord(response: Response): Promise<Readonly<Record<string, unknown>>> {
  return (await readJsonRecordWithBytes(response)).value;
}

async function readJsonRecordWithBytes(response: Response): Promise<{
  readonly value: Readonly<Record<string, unknown>>;
  readonly bytes: Uint8Array;
}> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`HTTP ${response.status} response was not JSON`, { cause: error });
  }
  return { value: actionInput(value, "HTTP JSON response"), bytes };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function discardBody(response: Response): Promise<void> {
  await response.arrayBuffer();
}

function actionInput(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) throw new Error(`${label} input must be a JSON object`);
  return value;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Readonly<Record<string, unknown>>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`controlled Read input field '${field}' must be a non-empty string`);
  return value;
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new Error(
      `controlled Read input field '${field}' must be a non-empty string when present`,
    );
  return value;
}

function requiredStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
): readonly string[] {
  const value = record[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length
  )
    throw new Error(`controlled Read input field '${field}' must contain unique strings`);
  return value as string[];
}

function requiredPositiveInteger(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`controlled Read input field '${field}' must be a positive integer`);
  return value as number;
}
