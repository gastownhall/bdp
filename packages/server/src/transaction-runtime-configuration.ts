/** Private captured runtime inputs. No installed launcher or profile admission. */
import { TRANSACTION_EVENT_STREAM } from "./transaction-events.js";
import { TRANSACTION_SSE_DEFAULTS, validateTransactionStreamTimers } from "./transaction-sse.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import { parseCanonicalScope, parseTypeDescriptor, stringifyJsonValue } from "@bdp/protocol";
import {
  administrativeArray,
  administrativeData,
  compileDevelopmentContracts,
} from "./development-contracts.js";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  type ContractArtifactLimits,
} from "./installed-contract-artifact.js";
import { TRANSACTION_RUNTIME_LIMITS } from "./transaction-batch.js";
import {
  TRANSACTION_HTTP_TARGET_BYTES,
  type TransactionHttpAuthorization,
} from "./transaction-http.js";
import {
  transactionReceiptMaximum,
  TRANSACTION_RECEIPT_DETAIL_MS,
  type openTransactionStore,
} from "./transaction-store.js";
import type {
  TransactionRuntimeOptions,
  TransactionRuntimeTestSeams,
} from "./transaction-runtime.js";
import type { TransactionReadOptions } from "./transaction-read.js";
import {
  TRANSACTION_SNAPSHOT_LIMITS,
  TRANSACTION_SNAPSHOT_TOKEN_POLICY,
} from "./transaction-snapshot.js";

function fields(value: unknown, allowed: readonly string[], required: readonly string[] = []) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("plain runtime configuration required");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some(
      (k) =>
        typeof k !== "string" ||
        !allowed.includes(k) ||
        !Object.hasOwn(descriptors[k] ?? {}, "value"),
    ) ||
    required.some((k) => !Object.hasOwn(descriptors, k))
  )
    throw new TypeError("closed own-data runtime configuration required");
  return Object.fromEntries(Object.entries(descriptors).map(([k, d]) => [k, d.value as unknown]));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function detached(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new TypeError("runtime administrative depth bound");
  if (Array.isArray(value))
    return administrativeArray(value, 4096).map((v) => detached(v, depth + 1));
  if (value && typeof value === "object") {
    if (isProxy(value)) throw new TypeError("runtime proxy refused");
    const own = fields(value, Object.getOwnPropertyNames(value));
    return Object.fromEntries(Object.entries(own).map(([k, v]) => [k, detached(v, depth + 1)]));
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
    throw new TypeError("plain runtime data required");
  return value;
}
function boundedString(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    !value.isWellFormed() ||
    Buffer.byteLength(value) > maximum
  )
    throw new TypeError("bounded runtime string required");
  return value;
}
export const TRANSACTION_RUNTIME_DEFAULTS = freeze({
  mutation: TRANSACTION_RUNTIME_LIMITS,
  scopeSnapshot: {
    limits: TRANSACTION_SNAPSHOT_LIMITS,
    tokenPolicy: TRANSACTION_SNAPSHOT_TOKEN_POLICY,
  },
  receiptMaximumItems: transactionReceiptMaximum(),
  readDefaultItems: 2,
  selector: { bytes: 4096, depth: 32, nodes: 256 },
  pagination: {
    cursorTtlMs: 1000,
    retainedStateCapacity: 100,
    maxRetainedCursorPositionsPerSnapshot: 20,
    retainedSnapshotByteCapacity: 1048576,
    retainedSnapshotNodeCapacity: 100000,
    maxOpaqueTokenLength: 64,
    tokenGenerationAttempts: 3,
    idleCleanup: "on-demand" as const,
  },
  token: { bytes: 24, encoding: "base64url" as const },
  maintenanceIntervalMs: 1000,
  receiptDetailMs: TRANSACTION_RECEIPT_DETAIL_MS,
  comparisonBudgetMs: 1000,
  minimumReadBudgetMs: 1000,
  changefeedStream: TRANSACTION_SSE_DEFAULTS,
  // Owner scan/packet bounds only. Event and changefeed delivery share the
  // cadence and live-slot capacity captured in changefeedStream above.
  eventStream: TRANSACTION_EVENT_STREAM,
  transport: {
    host: "127.0.0.1",
    targetBytes: TRANSACTION_HTTP_TARGET_BYTES,
    maxHeaderSize: 16384,
    requestTimeout: 10000,
    headersTimeout: 10000,
    timeout: 10000,
    keepAliveTimeout: 1000,
    cors: "disabled",
  },
  lifecycle: {
    owner: "service",
    scheduler: "node",
    wallClock: "Date.now",
    monotonicClock: "performance.now",
  },
});
/** Fixed-key inputs are constructed by capture; this is not RFC canonicalization. */
export function transactionRuntimeDigest(value: unknown): string {
  return createHash("sha256").update(stringifyJsonValue(value)).digest("hex");
}
function captureSeams(value: unknown) {
  const own = fields(value, [
    "scheduler",
    "clock",
    "maximumOperations",
    "comparison",
    "minimumReads",
    "receiptMaximumItems",
    "maintenanceIntervalMs",
    "transport",
  ]);
  const result: Record<string, unknown> = { ...own };
  for (const key of ["maximumOperations", "receiptMaximumItems", "maintenanceIntervalMs"]) {
    const value = own[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) ||
        (value as number) < 1 ||
        (key === "maintenanceIntervalMs" && (value as number) > 2147483647))
    )
      throw new TypeError("invalid runtime numeric seam");
  }
  for (const name of ["comparison", "minimumReads"] as const) {
    if (own[name] !== undefined) {
      const nested = fields(own[name], ["budgetMs", "now", "wait"]);
      if (
        nested.budgetMs !== undefined &&
        (!Number.isSafeInteger(nested.budgetMs) ||
          (nested.budgetMs as number) < 1 ||
          (nested.budgetMs as number) > 2147483647)
      )
        throw new TypeError("invalid runtime wait budget");
      for (const key of ["now", "wait"])
        if (nested[key] !== undefined && typeof nested[key] !== "function")
          throw new TypeError("invalid runtime wait callback");
      result[name] = Object.freeze(nested);
    }
  }
  if (own.transport !== undefined) {
    const transport = fields(own.transport, [
      "requestTimeout",
      "headersTimeout",
      "timeout",
      "keepAliveTimeout",
    ]);
    for (const value of Object.values(transport))
      if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2147483647)
        throw new TypeError("invalid runtime transport seam");
    result.transport = Object.freeze(transport);
  }
  if (own.scheduler !== undefined) {
    const scheduler = fields(own.scheduler, ["turn"], ["turn"]);
    if (typeof scheduler.turn !== "function") throw new TypeError("invalid runtime scheduler");
    result.scheduler = Object.freeze(scheduler);
  }
  if (own.clock !== undefined && typeof own.clock !== "function")
    throw new TypeError("invalid runtime clock");
  return {
    supplied: Object.keys(own).length > 0,
    value: Object.freeze(result) as TransactionRuntimeTestSeams,
  };
}

export function captureTransactionRuntimeConfiguration(
  input: TransactionRuntimeOptions,
  rawSeams: TransactionRuntimeTestSeams = {},
) {
  const own = fields(
    input,
    ["scope", "directory", "create", "port", "types", "artifacts", "credentials", "authorityMode"],
    ["directory", "create", "port", "credentials"],
  );
  const seamCapture = captureSeams(rawSeams),
    seams = seamCapture.value;
  const directory = boundedString(own.directory, 16384);
  if (!path.isAbsolute(directory) || typeof own.create !== "boolean")
    throw new TypeError("explicit absolute store directory/provisioning required");
  if (!Number.isSafeInteger(own.port) || (own.port as number) < 0 || (own.port as number) > 65535)
    throw new TypeError("invalid private transaction port");
  const configuredScope =
    own.scope === undefined
      ? undefined
      : parseCanonicalScope(boundedString(own.scope, TRANSACTION_RUNTIME_LIMITS.scopeSourceBytes));
  const authorityMode = own.authorityMode === undefined ? "listener" : own.authorityMode;
  if (authorityMode !== "listener" && authorityMode !== "canonical")
    throw new TypeError("invalid runtime authority mode");
  if (authorityMode === "canonical" && configuredScope === undefined)
    throw new TypeError("canonical authority requires explicit Scope");
  const credentials = administrativeArray(own.credentials, 32).map((value) => {
    const entry = administrativeData(value, ["token", "principal", "canMutate"]);
    const token = boundedString(entry.token, 256),
      principal = boundedString(entry.principal, 16384);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token) || typeof entry.canMutate !== "boolean")
      throw new TypeError("invalid private transaction credential");
    return { token, principal, canMutate: entry.canMutate };
  });
  if (!credentials.length || new Set(credentials.map((c) => c.token)).size !== credentials.length)
    throw new TypeError("unique private transaction credentials required");
  const secrets = credentials.map(({ token, ...rest }) => ({
    ...rest,
    credential: Buffer.from(`Bearer ${token}`),
  }));
  const associations = freeze(
    credentials
      .map(({ token, ...rest }) => ({
        // Domain separation binds this credential use; it does not prevent
        // guessing low-entropy tokens. Metadata digests are not secrecy guarantees.
        tokenDigest: transactionRuntimeDigest({ revision: "transaction-credential-1", token }),
        ...rest,
      }))
      .sort((a, b) => (a.tokenDigest < b.tokenDigest ? -1 : a.tokenDigest > b.tokenDigest ? 1 : 0)),
  );
  const authenticationIdentity = transactionRuntimeDigest({
    revision: "transaction-authentication-1",
    scheme: "bearer",
    associations,
  });
  if (own.artifacts !== undefined && !configuredScope)
    throw new TypeError("compiled transaction artifacts require explicit stable Scope");
  const compile = () => {
    const source = administrativeData(own.artifacts, ["descriptors", "schemas", "limits"]);
    let totalBytes = 0;
    const artifacts = (value: unknown) =>
      administrativeArray(value, CONTRACT_ARTIFACT_CEILINGS.submittedArtifacts).map((item) => {
        const entry = administrativeData(item, ["retrievalUri", "utf8"]);
        if (
          typeof entry.utf8 !== "string" ||
          !entry.utf8.isWellFormed() ||
          typeof entry.retrievalUri !== "string"
        )
          throw new TypeError("plain UTF8 transaction artifact required");
        const bytes = Buffer.byteLength(entry.utf8);
        totalBytes += bytes;
        if (
          bytes > CONTRACT_ARTIFACT_CEILINGS.artifactBytes ||
          totalBytes > CONTRACT_ARTIFACT_CEILINGS.totalBytes
        )
          throw new TypeError("transaction artifact byte bound");
        return { retrievalUri: entry.retrievalUri, utf8Bytes: Buffer.from(entry.utf8) };
      });
    return compileDevelopmentContracts({
      descriptors: artifacts(source.descriptors),
      schemas: artifacts(source.schemas),
      limits: source.limits as ContractArtifactLimits,
    });
  };
  const contracts = own.artifacts === undefined ? undefined : compile();
  const types =
    own.types === undefined
      ? contracts?.descriptors
      : administrativeArray(own.types, 4096).map((d) => parseTypeDescriptor(detached(d)));
  if (!types) throw new TypeError("transaction Type inventory required");
  freeze(types);
  const settings = freeze({
    ...TRANSACTION_RUNTIME_DEFAULTS,
    transport: { ...TRANSACTION_RUNTIME_DEFAULTS.transport, ...seams.transport },
    receiptMaximumItems: transactionReceiptMaximum(seams.receiptMaximumItems),
    maintenanceIntervalMs:
      seams.maintenanceIntervalMs ?? TRANSACTION_RUNTIME_DEFAULTS.maintenanceIntervalMs,
  });
  if (settings.transport.headersTimeout > settings.transport.requestTimeout)
    throw new TypeError("headers timeout exceeds request timeout");
  // Installed defaults must support live idle delivery. Short transport test
  // seams preserve finite deadline tests but never acquire a live stream slot.
  validateTransactionStreamTimers(
    TRANSACTION_RUNTIME_DEFAULTS.changefeedStream,
    TRANSACTION_RUNTIME_DEFAULTS.transport.timeout,
  );
  validateTransactionStreamTimers(settings.changefeedStream);
  const liveStreamsAvailable =
    settings.changefeedStream.heartbeatMilliseconds < settings.transport.timeout;
  const clock = seams.clock ?? Date.now;
  return Object.freeze({
    directory,
    create: own.create,
    port: own.port as number,
    configuredScope,
    authorityMode,
    contracts,
    types,
    seams,
    settings,
    liveStreamsAvailable,
    authenticate(supplied: Buffer): TransactionHttpAuthorization {
      const credential = secrets.find(
        (c) => c.credential.length === supplied.length && timingSafeEqual(c.credential, supplied),
      );
      return credential
        ? {
            kind: "authenticated",
            principal: credential.principal,
            canMutate: credential.canMutate,
          }
        : { kind: "unauthenticated" };
    },
    readOptions(scope: string): TransactionReadOptions {
      const defaultItems = Math.min(settings.readDefaultItems, settings.receiptMaximumItems);
      return {
        selectorLimits: settings.selector,
        advertisedLimits: {
          page: { defaultItems, maximumItems: settings.receiptMaximumItems },
          selector: settings.selector,
          cursorTtlMilliseconds: settings.pagination.cursorTtlMs,
        },
        pagination: {
          ...settings.pagination,
          scope,
          defaultPageItems: defaultItems,
          maxPageItems: settings.receiptMaximumItems,
          clock,
          generateOpaqueToken: () =>
            randomBytes(settings.token.bytes).toString(settings.token.encoding),
        },
      };
    },
    metadata(
      actual: ReturnType<ReturnType<typeof openTransactionStore>["readConfiguration"]>,
      scope: string,
    ) {
      if (configuredScope !== undefined && scope !== configuredScope)
        throw new Error("live transaction Scope mismatch");
      if (!isDeepStrictEqual(actual.scopeSnapshot, settings.scopeSnapshot))
        throw new Error("live transaction Snapshot configuration mismatch");
      if (
        actual.authorizationView !== actual.authorization.authorizationView ||
        actual.scopeConfiguration.policyIdentity !== actual.authorizationView ||
        actual.scopeConfiguration.maximumEndpointMultiplicity.length !== 0
      )
        throw new Error("unexpected live transaction policy");
      const sorted = (values: readonly unknown[]) =>
        values.map((v) => stringifyJsonValue(v)).sort();
      if (JSON.stringify(sorted(actual.installedTypes)) !== JSON.stringify(sorted(types)))
        throw new Error("live transaction descriptor closure mismatch");
      if (seamCapture.supplied || configuredScope === undefined || contracts === undefined)
        return undefined;
      const policyIdentity = transactionRuntimeDigest({
        revision: "transaction-policy-1",
        view: actual.authorizationView,
        read: actual.authorization.readPolicy,
        aggregate: actual.scopeConfiguration.maximumEndpointMultiplicity,
        associations,
      });
      const runtimeConfigurationIdentity = transactionRuntimeDigest({
        revision: "transaction-runtime-1",
        scope,
        artifactIdentity: contracts.identity,
        settings,
        authorityMode,
        policyIdentity,
        authenticationIdentity,
        profile: "transactional",
        history: false,
      });
      return Object.freeze({
        authorityMode,
        runtimeConfigurationIdentity,
        artifactIdentity: contracts.identity,
        policyIdentity,
        authenticationIdentity,
        scope,
        profile: "transactional" as const,
        history: false as const,
        claimEligible: false as const,
      });
    },
  });
}
