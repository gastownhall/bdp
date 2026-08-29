import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  type AbsoluteHttpUrl,
  referenceUri,
  type BeadCollectionRequest as BeadCollectionOperation,
  type BeadLinksRequest as BeadLinksOperation,
  type BeadPropertiesRequest as BeadPropertiesOperation,
  type BeadRecord,
  type BeadResourceRequest as BeadResourceOperation,
  createTypeConformanceIndex,
  isJsonSchemaUri,
  type LinkCollectionRequest as LinkCollectionOperation,
  type LinkPropertiesRequest as LinkPropertiesOperation,
  type LinkRecord,
  type LinkResourceRequest as LinkResourceOperation,
  parseCanonicalTypeId,
  REFERENCE_BEAD_TYPES,
  REFERENCE_BLOCKING_LINK_TYPE_ID,
  REFERENCE_TYPE_DESCRIPTORS,
  REFERENCE_TYPE_SUMMARIES,
  type ReadProblem,
  readProblem,
  resolveCanonicalLocalResourceId,
  type ScopeReadOperation,
  type TypeDescriptor,
  type TypeInventoryRequest as TypeInventoryOperation,
  type TypeResourceRequest as TypeResourceOperation,
} from "@bdp/protocol";
import {
  type ScopePort,
  type ScopePortResultFor,
  scopePortProblem,
  scopePortSuccess,
} from "@bdp/server";

/** Identifies the bd adapter package without invoking bd during Gate 0. */
export const packageName = "@bdp/adapter-bd";

export interface BdWorkspaceScope {
  readonly scope: AbsoluteHttpUrl;
  readonly port: ScopePort;
}

/** Records the real adapter's future construction boundary against the port. */
export function createBdWorkspaceScope(scope: AbsoluteHttpUrl, port: ScopePort): BdWorkspaceScope {
  return { scope, port };
}

export interface BdProcessOptions {
  readonly executable: string;
  readonly workspace: string;
  /** Exact child environment, snapshotted when the Scope port is created. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Maximum age of a completed bd snapshot before the next operation refreshes it. */
  readonly snapshotTtlMs?: number;
}

class BdProcessFailure extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "BdProcessFailure";
  }
}

class BdProjectionFailure extends Error {
  constructor(options: ErrorOptions = {}) {
    super("bd snapshot could not be projected", options);
    this.name = "BdProjectionFailure";
  }
}

interface BdDependencyEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

interface InFlightLoad {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  waiters: number;
  settled: boolean;
}

// Keep the largest fallback argv well below the smallest common command-line
// ceiling. Oversized individual IDs fail closed instead of reaching spawn, and
// larger source sets are split into independently attributable batches.
const DEPENDENCY_FALLBACK_ARG_BYTES = 16 * 1024;

/** Read-only generic projection over supported bd JSON commands. */
export function createBdProcessScopePort(
  scope: AbsoluteHttpUrl,
  options: BdProcessOptions,
): ScopePort {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxOutputBytes = options.maxOutputBytes ?? 4_000_000;
  const snapshotTtlMs = options.snapshotTtlMs ?? 1_000;
  if (!Number.isSafeInteger(snapshotTtlMs) || snapshotTtlMs < 0)
    throw new RangeError("snapshotTtlMs must be a non-negative safe integer");
  const environment = {
    ...(options.environment ?? { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }),
  };
  const typeIds = new Map<string, string>(
    REFERENCE_BEAD_TYPES.map(([id, name]) => [name.toLowerCase(), id]),
  );
  if (!typeIds.has("task")) throw new Error("reference domain does not define task");
  let beads: BeadRecord[] | undefined;
  let links: LinkRecord[] | undefined;
  // The bd realization declares no reference ownership: bd cannot version a
  // bead by its outgoing links, so serving the shared domain's ownsOutgoing
  // would advertise a plane this realization never populates. Honest absence:
  // strip the declaration; records carry no references member.
  const BD_TYPE_DESCRIPTORS = REFERENCE_TYPE_DESCRIPTORS.map((descriptor) =>
    descriptor.describes === "bead" && descriptor.ownsOutgoing !== undefined
      ? (({ ownsOutgoing: _ownsOutgoing, ...rest }) => rest)(descriptor)
      : descriptor,
  );
  const referenceDescriptorsById = new Map(
    BD_TYPE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
  );
  let observedTypes = REFERENCE_TYPE_SUMMARIES;
  let observedDescriptors = BD_TYPE_DESCRIPTORS;
  let typeConformance = createTypeConformanceIndex(observedDescriptors);
  let loading: InFlightLoad | undefined;
  let loadedAt = 0;
  let projectionFailure:
    | { readonly error: BdProjectionFailure; readonly failedAt: number }
    | undefined;
  const opaqueComponent = (value: string): string =>
    `b64_${Buffer.from(value, "utf8").toString("base64url")}`;
  const localComponent = (value: string): string =>
    /^[A-Za-z0-9._~-]+$/.test(value) && value !== "." && value !== ".." && !value.startsWith("b64_")
      ? value
      : opaqueComponent(value);
  const beadId = (id: string): AbsoluteHttpUrl =>
    resolveCanonicalLocalResourceId(scope, "bead", `beads/${localComponent(id)}`);
  const mintedTypeId = (type: string): AbsoluteHttpUrl =>
    parseCanonicalTypeId(new URL(`types/${localComponent(type)}`, scope).href, "minted bd Type");
  const linkId = (source: string, target: string, type: string): AbsoluteHttpUrl =>
    resolveCanonicalLocalResourceId(
      scope,
      "link",
      `links/${opaqueComponent(source)}/${opaqueComponent(target)}/${opaqueComponent(type)}`,
    );
  const run = (args: readonly string[], signal: AbortSignal): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const child = spawn(options.executable, args, {
        cwd: options.workspace,
        detached: process.platform !== "win32",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let stdout = "";
      let stderr = "";
      let size = 0;
      let terminationReason: "abort" | "deadline" | "output-bound" | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const killProcessTree = (signal: NodeJS.Signals): void => {
        if (process.platform !== "win32" && child.pid !== undefined) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            // The group may already have exited or failed to form; retain the
            // direct-child fallback so settlement remains bounded.
          }
        }
        child.kill(signal);
      };
      const terminate = (reason?: typeof terminationReason): void => {
        terminationReason ??= reason;
        killProcessTree("SIGTERM");
        if (killTimer !== undefined) return;
        killTimer = setTimeout(() => {
          killProcessTree("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
        }, 250);
        killTimer.unref();
      };
      const timer = setTimeout(() => terminate("deadline"), timeoutMs);
      timer.unref();
      const abort = () => terminate("abort");
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= maxOutputBytes) stdout += stdoutDecoder.write(chunk);
        else terminate("output-bound");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxOutputBytes) terminate("output-bound");
        if (stderr.length < 4096)
          stderr += stderrDecoder.write(chunk).slice(0, 4096 - stderr.length);
      });
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        signal.removeEventListener("abort", abort);
        callback();
      };
      child.on("error", (error) =>
        finish(() => reject(new BdProcessFailure("bd command could not start", { cause: error }))),
      );
      child.on("close", (code) =>
        finish(() => {
          stdout += stdoutDecoder.end();
          if (stderr.length < 4096) stderr += stderrDecoder.end().slice(0, 4096 - stderr.length);
          if (terminationReason === "deadline")
            reject(new BdProcessFailure("bd command exceeded its deadline"));
          else if (terminationReason === "output-bound")
            reject(new BdProcessFailure("bd command exceeded its output bound"));
          else if (terminationReason === "abort" || signal.aborted) reject(signal.reason);
          else if (code !== 0)
            reject(new BdProcessFailure(`bd command failed (${code}): ${stderr.slice(0, 256)}`));
          else {
            try {
              resolve(JSON.parse(stdout));
            } catch (cause) {
              reject(new BdProcessFailure("bd returned invalid JSON", { cause }));
            }
          }
        }),
      );
    });
  const projectSnapshot = async (signal: AbortSignal): Promise<void> => {
    try {
      const value = await run(
        ["list", "--all", "--limit", "0", "--sort", "id", "--flat", "--json"],
        signal,
      );
      if (!Array.isArray(value)) throw new Error("bd list output must be an array");
      const rows = value.map((entry, index) => readBdRecord(entry, `bd list[${index}]`));
      const extraTypes = new Map(REFERENCE_TYPE_SUMMARIES.map((type) => [type.id, type]));
      const rowIds = new Map<Record<string, unknown>, string>();
      const nextBeads = rows.map((row, index) => {
        const nativeId = readBdString(row.id, `bd list[${index}].id`);
        rowIds.set(row, nativeId);
        const issueType = readOptionalBdString(
          row.issue_type,
          `bd list[${index}].issue_type`,
          "task",
        ).toLowerCase();
        const beadType = typeIds.get(issueType) ?? mintedTypeId(issueType);
        const existingType = extraTypes.get(beadType);
        if (existingType !== undefined && existingType.describes !== "bead")
          throw new Error("bd projected one Type identity into both Resource categories");
        if (existingType === undefined)
          extraTypes.set(beadType, { id: beadType, name: issueType, describes: "bead" });
        const bead = {
          id: beadId(nativeId),
          type: beadType,
          properties: projectBdReadyProperties(row),
        } as const;
        return { ...bead, revision: projectedResourceRevision(bead) } satisfies BeadRecord;
      });
      requireUniqueProjection(
        nextBeads.map(({ id }) => id),
        "Bead IDs",
      );
      nextBeads.sort(compareResourceIds);
      const nextLinks: LinkRecord[] = [];
      const beadById = new Map(nextBeads.map((bead) => [bead.id, bead]));
      const projectedDependencies = new Set<string>();
      const projectDependency = ({
        source: sourceLocalId,
        target: targetId,
        type,
      }: BdDependencyEdge): void => {
        const identity = JSON.stringify([sourceLocalId, targetId, type]);
        if (projectedDependencies.has(identity)) return;
        const source = beadById.get(beadId(sourceLocalId));
        if (source === undefined)
          throw new Error("bd projected a Link source that does not name a live Bead");
        // A live local Bead wins even when its opaque native ID resembles an
        // external URI. Classification happens only after the local lookup.
        const target = beadById.get(beadId(targetId));
        if (target === undefined && !isBdExternalDependencyId(targetId))
          throw new Error("bd projected a Link endpoint that does not name a live Bead");
        const linkType = type === "blocks" ? REFERENCE_BLOCKING_LINK_TYPE_ID : mintedTypeId(type);
        const existingType = extraTypes.get(linkType);
        if (existingType !== undefined && existingType.describes !== "link")
          throw new Error("bd projected one Type identity into both Resource categories");
        if (existingType === undefined)
          extraTypes.set(linkType, { id: linkType, name: type, describes: "link" });
        projectedDependencies.add(identity);
        const link = {
          id: linkId(sourceLocalId, targetId, type),
          type: linkType,
          source: beadId(sourceLocalId),
          target: target === undefined ? targetId : beadId(targetId),
          properties: {},
        } as const;
        nextLinks.push({ ...link, revision: projectedResourceRevision(link) });
      };
      const fallbackSources: string[] = [];
      for (const [index, row] of rows.entries()) {
        const id = rowIds.get(row);
        if (id === undefined) throw new Error("bd row identity was not projected");
        if (row.dependencies === undefined) {
          fallbackSources.push(id);
          continue;
        }
        if (!Array.isArray(row.dependencies))
          throw new Error(`bd list[${index}].dependencies must be an array`);
        for (const [dependencyIndex, dependency] of row.dependencies.entries())
          projectDependency(
            normalizeBdDependency(
              dependency,
              `bd list[${index}].dependencies[${dependencyIndex}]`,
              id,
            ),
          );
      }
      if (fallbackSources.length > 0) {
        const batches = partitionDependencyFallbackSources(fallbackSources);
        const projectFallbackBatch = async (sources: readonly string[]): Promise<void> => {
          const fallbackValue = await run(["dep", "list", "--json", "--", ...sources], signal);
          if (!Array.isArray(fallbackValue)) throw new Error("bd dep list output must be an array");
          if (fallbackValue.length === 0) return;
          if (sources.length > 1) {
            const middle = Math.floor(sources.length / 2);
            await projectFallbackBatch(sources.slice(0, middle));
            await projectFallbackBatch(sources.slice(middle));
            return;
          }
          const source = sources[0];
          if (source === undefined) throw new Error("bd dependency fallback lost its source");
          for (const [index, dependency] of fallbackValue.entries())
            projectDependency(normalizeBdDependency(dependency, `bd dep list[${index}]`, source));
        };
        for (const batch of batches) await projectFallbackBatch(batch);
      }
      requireUniqueProjection(
        nextLinks.map(({ id }) => id),
        "Link IDs",
      );
      nextLinks.sort(compareResourceIds);
      const nextObservedTypes = [...extraTypes.values()];
      nextObservedTypes.sort(compareResourceIds);
      const nextObservedDescriptors = nextObservedTypes.map(
        (summary): TypeDescriptor =>
          referenceDescriptorsById.get(summary.id) ??
          (summary.describes === "link"
            ? {
                id: summary.id,
                name: summary.name,
                describes: "link",
                conformsTo: [],
                source: { conformsTo: [] },
                target: { conformsTo: [] },
              }
            : { id: summary.id, name: summary.name, describes: "bead", conformsTo: [] }),
      );
      const nextTypeConformance = createTypeConformanceIndex(nextObservedDescriptors);
      beads = nextBeads;
      links = nextLinks;
      observedTypes = nextObservedTypes;
      observedDescriptors = nextObservedDescriptors;
      typeConformance = nextTypeConformance;
      loadedAt = performance.now();
      projectionFailure = undefined;
    } catch (error) {
      if (signal.aborted || error instanceof BdProcessFailure) throw error;
      throw new BdProjectionFailure({ cause: error });
    }
  };
  const beginLoad = (): InFlightLoad => {
    const controller = new AbortController();
    let state: InFlightLoad;
    const promise = projectSnapshot(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof BdProjectionFailure)
          projectionFailure = { error, failedAt: performance.now() };
        throw error;
      })
      .finally(() => {
        state.settled = true;
        if (loading === state) loading = undefined;
      });
    void promise.catch(() => undefined);
    state = { controller, promise, waiters: 0, settled: false };
    loading = state;
    return state;
  };
  const waitForLoad = (promise: Promise<void>, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const abort = (): void => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  };
  const load = async (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) throw signal.reason;
    const now = performance.now();
    const fresh = beads !== undefined && links !== undefined && now - loadedAt < snapshotTtlMs;
    if (fresh) return;
    if (projectionFailure !== undefined && now - projectionFailure.failedAt < snapshotTtlMs)
      throw projectionFailure.error;
    const state = loading ?? beginLoad();
    state.waiters += 1;
    try {
      await waitForLoad(state.promise, signal);
    } finally {
      state.waiters -= 1;
      if (state.waiters === 0 && !state.settled) {
        if (loading === state) loading = undefined;
        state.controller.abort(new Error("bd load has no remaining readers"));
      }
    }
  };
  const page = <Item>(
    items: readonly Item[],
  ): { readonly items: readonly Item[]; readonly next: null } => ({ items, next: null });
  function visitOperation<Operation extends ScopeReadOperation>(
    operation: Operation,
    allBeads: readonly BeadRecord[],
    allLinks: readonly LinkRecord[],
  ): ScopePortResultFor<Operation>;
  function visitOperation(
    operation: ScopeReadOperation,
    allBeads: readonly BeadRecord[],
    allLinks: readonly LinkRecord[],
  ): ScopePortResultFor<ScopeReadOperation> {
    switch (operation.kind) {
      case "collection": {
        if (operation.collection === "beads") {
          const filtered = allBeads.filter(
            (bead) =>
              (operation.type === undefined || bead.type === operation.type) &&
              (operation.conformsTo === undefined ||
                typeConformance.includes(bead.type, operation.conformsTo)),
          );
          return scopePortSuccess<BeadCollectionOperation>(page(filtered));
        }
        if (operation.collection === "links") {
          const filtered = allLinks.filter(
            (link) =>
              (operation.type === undefined || link.type === operation.type) &&
              (operation.conformsTo === undefined ||
                typeConformance.includes(link.type, operation.conformsTo)) &&
              (operation.source === undefined || referenceUri(link.source) === operation.source) &&
              (operation.target === undefined || referenceUri(link.target) === operation.target) &&
              (operation.endpoint === undefined ||
                referenceUri(link.source) === operation.endpoint ||
                referenceUri(link.target) === operation.endpoint),
          );
          return scopePortSuccess<LinkCollectionOperation>(page(filtered));
        }
        return scopePortSuccess<TypeInventoryOperation>(page(observedTypes));
      }
      case "resource": {
        if (operation.resource === "bead") {
          const item = allBeads.find((candidate) => candidate.id === operation.id);
          return item === undefined
            ? scopePortProblem<BeadResourceOperation>(adapterNotFound())
            : scopePortSuccess<BeadResourceOperation>(item);
        }
        if (operation.resource === "link") {
          const item = allLinks.find((candidate) => candidate.id === operation.id);
          return item === undefined
            ? scopePortProblem<LinkResourceOperation>(adapterNotFound())
            : scopePortSuccess<LinkResourceOperation>(item);
        }
        try {
          new URL(operation.id);
        } catch {
          return scopePortProblem<TypeResourceOperation>(adapterNotFound());
        }
        if (
          new URL(operation.id).origin !== new URL(scope).origin &&
          !operation.id.startsWith("https://work.example/types/")
        )
          return scopePortProblem<TypeResourceOperation>(adapterNotFound());
        const descriptor = observedDescriptors.find((item) => item.id === operation.id);
        return descriptor === undefined
          ? scopePortProblem<TypeResourceOperation>(adapterNotFound())
          : scopePortSuccess<TypeResourceOperation>(descriptor);
      }
      case "properties": {
        if (operation.resource === "bead") {
          const item = allBeads.find((candidate) => candidate.id === operation.id);
          return item === undefined
            ? scopePortProblem<BeadPropertiesOperation>(adapterNotFound())
            : scopePortSuccess<BeadPropertiesOperation>(item.properties);
        }
        const item = allLinks.find((candidate) => candidate.id === operation.id);
        return item === undefined
          ? scopePortProblem<LinkPropertiesOperation>(adapterNotFound())
          : scopePortSuccess<LinkPropertiesOperation>(item.properties);
      }
      case "bead-links": {
        if (!allBeads.some((bead) => bead.id === operation.bead))
          return scopePortProblem<BeadLinksOperation>(adapterNotFound());
        const filtered = allLinks.filter((link) =>
          operation.direction === "inbound"
            ? referenceUri(link.target) === operation.bead
            : operation.direction === "outbound"
              ? referenceUri(link.source) === operation.bead
              : referenceUri(link.source) === operation.bead ||
                referenceUri(link.target) === operation.bead,
        );
        return scopePortSuccess<BeadLinksOperation>(page(filtered));
      }
    }
  }
  const perform = async <Operation extends ScopeReadOperation>(
    operation: Operation,
    { signal }: { readonly signal: AbortSignal },
  ): Promise<ScopePortResultFor<Operation>> => {
    try {
      await load(signal);
      // This adapter materializes one complete, stable page. The Read server
      // rejects selection and pagination controls it cannot honor before dispatch.
      return visitOperation(operation, beads ?? [], links ?? []);
    } catch (error) {
      if (
        signal.aborted ||
        (!(error instanceof BdProcessFailure) && !(error instanceof BdProjectionFailure))
      )
        throw error;
      return scopePortProblem<Operation>(adapterProblem());
    }
  };
  return { perform };
}

const BD_READY_PROPERTY_KEYS = [
  "id",
  "title",
  "status",
  "priority",
  "issue_type",
  "owner",
  "created_at",
  "created_by",
  "updated_at",
  "dependencies",
  "dependency_count",
  "dependent_count",
  "comment_count",
] as const;

function readBdRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function readBdString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path} must be a non-empty string`);
  return value;
}

function readOptionalBdString(value: unknown, path: string, fallback: string): string {
  return value === undefined ? fallback : readBdString(value, path);
}

function readConsistentAlias(
  record: Readonly<Record<string, unknown>>,
  names: readonly string[],
  path: string,
): string | undefined {
  let observed: string | undefined;
  for (const name of names) {
    if (record[name] === undefined) continue;
    const value = readBdString(record[name], `${path}.${name}`);
    if (observed !== undefined && value !== observed)
      throw new Error(`${path} has conflicting ${names.join("/")} aliases`);
    observed = value;
  }
  return observed;
}

function normalizeBdDependency(
  value: unknown,
  path: string,
  expectedSource: string,
): BdDependencyEdge {
  const dependency = readBdRecord(value, path);
  const observedSource = readConsistentAlias(dependency, ["issue_id"], path);
  if (
    observedSource !== undefined &&
    expectedSource !== undefined &&
    observedSource !== expectedSource
  )
    throw new Error(`${path}.issue_id does not match its containing Bead`);
  const target = readConsistentAlias(dependency, ["depends_on_id", "id"], path);
  if (target === undefined) throw new Error(`${path} has no dependency target`);
  const type = readConsistentAlias(dependency, ["type", "dependency_type"], path) ?? "blocks";
  return { source: expectedSource, target, type };
}

function partitionDependencyFallbackSources(sources: readonly string[]): readonly string[][] {
  const fixedBytes = ["dep", "list", "--json", "--"].reduce(
    (total, argument) => total + Buffer.byteLength(argument, "utf8") + 1,
    0,
  );
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = fixedBytes;
  for (const source of sources) {
    const sourceBytes = Buffer.byteLength(source, "utf8") + 1;
    if (fixedBytes + sourceBytes > DEPENDENCY_FALLBACK_ARG_BYTES)
      throw new Error("bd projected an ID too large for a dependency fallback command");
    if (batch.length > 0 && batchBytes + sourceBytes > DEPENDENCY_FALLBACK_ARG_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = fixedBytes;
    }
    batch.push(source);
    batchBytes += sourceBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function isBdExternalDependencyId(value: string): boolean {
  if (!value.startsWith("external:") || !isJsonSchemaUri(value)) return false;
  const [, project, capability] = value.split(":");
  return (
    project !== undefined && project.length > 0 && capability !== undefined && capability.length > 0
  );
}

function requireUniqueProjection(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`bd projected duplicate ${label}`);
}

function compareResourceIds(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function projectBdReadyProperties(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of BD_READY_PROPERTY_KEYS) {
    const value = row[key];
    if (value !== undefined) properties[key] = structuredClone(value);
  }
  return properties;
}

/**
 * Binds the opaque revision to every byte of the canonical projected Resource
 * representation. Native bd timestamps do not cover derived fields such as an
 * incoming dependency count, and bd dependency rows have no independent
 * revision, so neither is a safe HTTP entity validator.
 */
function projectedResourceRevision(value: unknown): string {
  return `sha256_${createHash("sha256").update(canonicalJson(value)).digest("base64url")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("projected Resource contains a non-JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("projected Resource contains a non-JSON value");
}

function adapterProblem(): ReadProblem {
  return readProblem("temporarily-unavailable");
}

function adapterNotFound(): ReadProblem {
  return readProblem("resource-not-found");
}

export type { AbsoluteHttpUrl, ScopePort };
