/** Trusted local data preparation only. No store, listener or profile admission. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import {
  admitJsonNumbers,
  decodeJsonDocument,
  JsonNumberLiteral,
  parseCanonicalScope,
  type LosslessJsonValue,
} from "@bdp/protocol";
import { administrativeData } from "./development-contracts.js";
import { DEVELOPMENT_READ_LIMITS } from "./development-authority.js";
import { captureInstalledReferenceConfiguration } from "./installed-reference-configuration.js";
import { registerReferenceDeployment } from "./reference-deployment-state.js";
import { captureInstalledTransactionConfiguration } from "./transaction-installed-configuration.js";
import {
  captureTransactionRuntimeConfiguration,
  TRANSACTION_RUNTIME_DEFAULTS,
} from "./transaction-runtime-configuration.js";

export interface ReferenceDeploymentReadLimits {
  readonly page: { readonly defaultItems: number; readonly maximumItems: number };
  readonly selector: { readonly bytes: number; readonly depth: number; readonly nodes: number };
  readonly cursorTtlMilliseconds: number;
}
export interface ReferenceDeploymentInput {
  readonly deploymentFile: string;
  readonly scope: { readonly url: string };
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly advertisedProfile?: string;
    readonly limits: ReferenceDeploymentReadLimits;
    readonly internalFaultResource?: string;
  };
  readonly bdptest?: { readonly fixture?: string; readonly deploymentFile?: string };
}
interface PreparedSummary {
  readonly format: "bdptest-reference-deployment-1";
  readonly canonicalScope: string;
  readonly listener: { readonly host: string; readonly port: number };
  /** Code/capture comparison only; persisted owner readback remains mandatory. */
  readonly preflightReadLimits: ReferenceDeploymentReadLimits;
  readonly artifactIdentity: string;
  readonly fileDigest: string;
}
export interface PreparedReadUpdateDeployment extends PreparedSummary {
  readonly profile: "read-update";
  readonly configurationIdentity: string;
  readonly policyIdentity: string;
  readonly authenticationIdentity: string;
}
export interface PreparedTransactionalDeployment extends PreparedSummary {
  readonly profile: "transactional";
}
export type PreparedReferenceDeployment =
  | PreparedReadUpdateDeployment
  | PreparedTransactionalDeployment;
export type ReferenceDeploymentErrorCode =
  | "configuration"
  | "file"
  | "bounds"
  | "syntax"
  | "contract"
  | "internal";
const messages: Readonly<Record<ReferenceDeploymentErrorCode, string>> = Object.freeze({
  configuration: "unsupported reference deployment startup configuration",
  file: "reference deployment requires a readable ordinary file",
  bounds: "reference deployment exceeds a preparation bound",
  syntax: "reference deployment requires strict UTF8 JSON with supported numbers",
  contract: "invalid reference deployment contract",
  internal: "reference deployment preparation failed",
});
export class ReferenceDeploymentError extends Error {
  readonly code: ReferenceDeploymentErrorCode;
  constructor(code: ReferenceDeploymentErrorCode) {
    super(messages[code]);
    this.name = "ReferenceDeploymentError";
    this.code = code;
  }
}
function refuse(code: ReferenceDeploymentErrorCode): never {
  throw new ReferenceDeploymentError(code);
}
/** Optional fields follow the same plain, own-data discipline as exact fields. */
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== "object" || isProxy(value)) refuse("configuration");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || ![...required, ...optional].includes(key)))
    refuse("configuration");
  const data = administrativeData(value, keys as string[]);
  if (required.some((key) => !Object.hasOwn(data, key))) refuse("configuration");
  return data;
}
function filePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    !value.isWellFormed() ||
    !path.isAbsolute(value) ||
    /\p{Cc}/u.test(value) ||
    Buffer.byteLength(value) > 16384
  )
    refuse("configuration");
  return value;
}
function limitsSnapshot(value: unknown): ReferenceDeploymentReadLimits {
  const own = administrativeData(value, ["page", "selector", "cursorTtlMilliseconds"]);
  const page = administrativeData(own.page, ["defaultItems", "maximumItems"]);
  const selector = administrativeData(own.selector, ["bytes", "depth", "nodes"]);
  const values = [
    page.defaultItems,
    page.maximumItems,
    selector.bytes,
    selector.depth,
    selector.nodes,
    own.cursorTtlMilliseconds,
  ];
  if (values.some((v) => !Number.isSafeInteger(v) || (v as number) < 1)) refuse("configuration");
  return Object.freeze({
    page: Object.freeze({
      defaultItems: page.defaultItems as number,
      maximumItems: page.maximumItems as number,
    }),
    selector: Object.freeze({
      bytes: selector.bytes as number,
      depth: selector.depth as number,
      nodes: selector.nodes as number,
    }),
    cursorTtlMilliseconds: own.cursorTtlMilliseconds as number,
  });
}
function snapshot(input: unknown) {
  const own = fields(input, ["deploymentFile", "scope", "server"], ["bdptest"]);
  const scope = administrativeData(own.scope, ["url"]);
  if (typeof scope.url !== "string") refuse("configuration");
  const canonicalScope = parseCanonicalScope(scope.url);
  const server = fields(
    own.server,
    ["host", "port", "limits"],
    ["advertisedProfile", "internalFaultResource"],
  );
  const profile = server.advertisedProfile;
  if (profile !== "read-update" && profile !== "transactional") refuse("configuration");
  if (Object.hasOwn(server, "internalFaultResource")) refuse("configuration");
  const deploymentFile = filePath(own.deploymentFile);
  if (own.bdptest !== undefined) {
    const bdptest = fields(own.bdptest, [], ["fixture", "deploymentFile"]);
    if (
      Object.hasOwn(bdptest, "fixture") ||
      (Object.hasOwn(bdptest, "deploymentFile") && bdptest.deploymentFile !== deploymentFile)
    )
      refuse("configuration");
  }
  if (
    typeof server.host !== "string" ||
    !(
      profile === "read-update"
        ? ["127.0.0.1", "::1"]
        : [TRANSACTION_RUNTIME_DEFAULTS.transport.host]
    ).includes(server.host) ||
    !Number.isSafeInteger(server.port) ||
    (server.port as number) < 1 ||
    (server.port as number) > 65535
  )
    refuse("configuration");
  const limits = limitsSnapshot(server.limits);
  const tx = TRANSACTION_RUNTIME_DEFAULTS;
  const expected =
    profile === "read-update"
      ? DEVELOPMENT_READ_LIMITS
      : {
          page: {
            defaultItems: Math.min(tx.readDefaultItems, tx.receiptMaximumItems),
            maximumItems: tx.receiptMaximumItems,
          },
          selector: tx.selector,
          cursorTtlMilliseconds: tx.pagination.cursorTtlMs,
        };
  if (!isDeepStrictEqual(limits, expected)) refuse("configuration");
  return Object.freeze({
    deploymentFile,
    canonicalScope,
    profile,
    listener: Object.freeze({ host: server.host, port: server.port as number }),
    limits,
  });
}
const MAXIMUM_FILE_BYTES = 32 * 1024 * 1024;
async function readDeployment(file: string): Promise<Buffer> {
  // Nonblocking open permits rejecting special files before any read can block.
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) refuse("file");
    if (stat.size > MAXIMUM_FILE_BYTES) refuse("bounds");
    const bytes = Buffer.alloc(MAXIMUM_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, Math.min(65536, bytes.length - length), null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAXIMUM_FILE_BYTES) refuse("bounds");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
/** Iterate decoded children without constructing a sibling value/task array. */
function* losslessChildren(
  value: readonly LosslessJsonValue[] | { readonly [key: string]: LosslessJsonValue },
): Generator<LosslessJsonValue> {
  if (Array.isArray(value)) {
    yield* value;
    return;
  }
  for (const key in value) {
    const child = (value as { readonly [key: string]: LosslessJsonValue })[key];
    if (child === undefined) refuse("internal");
    yield child;
  }
}
function boundLossless(root: LosslessJsonValue): void {
  const frames: { children: Iterator<LosslessJsonValue>; depth: number }[] = [];
  let nodes = 0;
  const discover = (value: LosslessJsonValue, depth: number): void => {
    // Charge each discovered value before scheduling any of its children.
    if (++nodes > 100000 || depth > 16) refuse("bounds");
    if (value !== null && typeof value === "object" && !(value instanceof JsonNumberLiteral))
      frames.push({ children: losslessChildren(value), depth });
  };
  discover(root, 0);
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const child = frame.children.next();
    if (child.done) frames.pop();
    else discover(child.value, frame.depth + 1);
  }
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
/** The byte ceiling is the sole predecode bound. The strict decoder allocates
 * its lossless tree before the iterative depth/node checks below. Trusted local
 * input accepts that bounded-byte allocation/work risk. */
export async function loadReferenceDeployment(
  input: ReferenceDeploymentInput,
): Promise<PreparedReferenceDeployment> {
  let phase: ReferenceDeploymentErrorCode = "configuration";
  try {
    const startup = snapshot(input);
    phase = "file";
    const bytes = await readDeployment(startup.deploymentFile);
    phase = "syntax";
    // Keep BOM visible to the existing strict JSON decoder.
    const lossless = decodeJsonDocument(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
    boundLossless(lossless);
    const admitted = admitJsonNumbers(lossless, {
      diagnostics: 1,
      diagnostic: () => ({ message: "unsupported reference deployment number" }),
    });
    if (!admitted.ok) refuse("syntax");
    phase = "contract";
    const envelope = administrativeData(admitted.value, ["format", "profile", "configuration"]);
    if (
      envelope.format !== "bdptest-reference-deployment-1" ||
      envelope.profile !== startup.profile
    )
      refuse("contract");
    const fileDigest = createHash("sha256").update(bytes).digest("hex");
    const summary = {
      format: "bdptest-reference-deployment-1" as const,
      canonicalScope: startup.canonicalScope,
      listener: startup.listener,
      preflightReadLimits: startup.limits,
      fileDigest,
    };
    if (startup.profile === "read-update") {
      const configuration = administrativeData(envelope.configuration, [
        "directory",
        "create",
        "credentials",
        "policies",
        "contracts",
        "maximumEndpointMultiplicity",
      ]);
      const projectedInput = immutable({
        scope: startup.canonicalScope,
        listener: startup.listener,
        ...configuration,
      });
      const installed = captureInstalledReferenceConfiguration(projectedInput);
      const handle: PreparedReadUpdateDeployment = Object.freeze({
        ...summary,
        profile: "read-update",
        artifactIdentity: installed.artifactIdentity,
        configurationIdentity: installed.identity,
        policyIdentity: installed.policyIdentity,
        authenticationIdentity: installed.authenticationIdentity,
      });
      phase = "internal";
      registerReferenceDeployment(handle, { profile: "read-update", projectedInput, installed });
      return handle;
    }
    const configuration = administrativeData(envelope.configuration, [
      "directory",
      "create",
      "credentials",
      "artifacts",
    ]);
    const projectedInput = immutable({ scope: startup.canonicalScope, ...configuration });
    const installed = captureInstalledTransactionConfiguration(projectedInput);
    const preflight = captureTransactionRuntimeConfiguration(installed);
    if (
      preflight.contracts === undefined ||
      preflight.authorityMode !== "canonical" ||
      preflight.configuredScope !== startup.canonicalScope ||
      Object.keys(preflight.seams).length !== 0 ||
      !preflight.liveStreamsAvailable ||
      preflight.settings.changefeedStream.heartbeatMilliseconds >=
        preflight.settings.transport.timeout ||
      !isDeepStrictEqual(
        preflight.readOptions(startup.canonicalScope).advertisedLimits,
        startup.limits,
      )
    )
      refuse("contract");
    const handle: PreparedTransactionalDeployment = Object.freeze({
      ...summary,
      profile: "transactional",
      artifactIdentity: preflight.contracts.identity,
    });
    phase = "internal";
    registerReferenceDeployment(handle, {
      profile: "transactional",
      projectedInput,
      installed,
      preflight,
    });
    return handle;
  } catch (error) {
    if (error instanceof ReferenceDeploymentError) throw error;
    // Neither causes nor parser/filesystem/compiler details cross this local boundary.
    throw new ReferenceDeploymentError(phase);
  }
}
