import type { AbsoluteHttpUrl, ReadDiscovery } from "@bdp/protocol";
import { endpointRevision, endpointUri, parseCanonicalTypeId } from "@bdp/protocol";

import {
  BdpClient,
  type BdpTransport,
  type BdpTransportResult,
  createFetchTransport,
  isBdpClientProblem,
} from "../src/index.js";

/** Structural counterpart of the conformance action input, kept out of the runtime graph. */
export interface BdpClientScenarioActionExecution {
  readonly family: string;
  readonly operation: string;
  readonly scope: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

export type BdpClientScenarioActionExecutor = (
  execution: BdpClientScenarioActionExecution,
) => Promise<unknown>;

export interface BdpClientScenarioActionExecutorOptions {
  /** Public Fetch implementation used by target-facing diagnostic actions. */
  readonly fetchImplementation?: typeof fetch;
  /** Isolated Fetch implementation for the controlled external Type publisher. */
  readonly externalTypeDescriptorFetchImplementation?: typeof fetch;
}

const TARGET_DIAGNOSTIC_TRANSPORT_LIMITS = Object.freeze({
  maximumResponseBodyBytes: 262_144,
  maximumJsonDepth: 64,
  maximumJsonNodes: 4_096,
  maximumJsonContainerEntries: 1_024,
  responseTimeoutMs: 10_000,
});

/**
 * Test-only programmable-action adapter for public-client conformance scenarios.
 * It returns only bounded symbolic facts; the conformance runner owns every assertion.
 */
export function createBdpClientScenarioActionExecutor(
  options: BdpClientScenarioActionExecutorOptions = {},
): BdpClientScenarioActionExecutor {
  const fetchImplementation = options.fetchImplementation;
  const externalTypeDescriptorFetchImplementation =
    options.externalTypeDescriptorFetchImplementation;
  if (fetchImplementation !== undefined && typeof fetchImplementation !== "function")
    throw new TypeError("fetchImplementation must be a function when present");
  if (
    externalTypeDescriptorFetchImplementation !== undefined &&
    typeof externalTypeDescriptorFetchImplementation !== "function"
  )
    throw new TypeError(
      "externalTypeDescriptorFetchImplementation must be a function when present",
    );
  if (
    fetchImplementation !== undefined &&
    externalTypeDescriptorFetchImplementation === fetchImplementation
  )
    throw new TypeError("external Type Descriptor Fetch must be isolated from the Scope Fetch");
  return async (execution) => {
    if (execution.family !== "client") throw new Error("unsupported client scenario family");
    switch (execution.operation) {
      case "unsupported-discovery":
        return observeUnsupportedDiscovery(execution);
      case "resource-without-type-resolution":
        requireEmptyInput(execution.input);
        return observeResourceWithoutTypeResolution(execution);
      case "malformed-success-response":
        requireEmptyInput(execution.input);
        return observeMalformedSuccessResponse(execution);
      case "disconnect-recovery":
        requireEmptyInput(execution.input);
        return observeDisconnectRecovery(execution, fetchImplementation);
      case "public-logical-projection":
        return observePublicLogicalProjection(execution, fetchImplementation);
      case "external-type-descriptors":
        return observeExternalTypeDescriptors(
          execution,
          fetchImplementation,
          externalTypeDescriptorFetchImplementation,
        );
      case "external-link-endpoints":
        return observeExternalLinkEndpoints(execution, fetchImplementation);
      default:
        throw new Error("unsupported client scenario operation");
    }
  };
}

async function observeExternalLinkEndpoints(
  execution: BdpClientScenarioActionExecution,
  fetchImplementation: typeof fetch | undefined,
) {
  if (fetchImplementation === undefined)
    throw new Error("external-link-endpoints requires a routed public Fetch implementation");
  if (
    !isPlainRecord(execution.input) ||
    !Array.isArray(execution.input.linkIds) ||
    execution.input.linkIds.length === 0 ||
    execution.input.linkIds.length > 8 ||
    execution.input.linkIds.some((value) => typeof value !== "string")
  )
    throw new Error("external-link-endpoints input must contain bounded Link IDs");
  const scope = execution.scope as AbsoluteHttpUrl;
  const ids = execution.input.linkIds.map((value) => {
    const id = new URL(value, scope).href;
    if (!id.startsWith(scope)) throw new Error("external-link-endpoints Link escaped the Scope");
    return id;
  });
  if (new Set(ids).size !== ids.length)
    throw new Error("external-link-endpoints Link IDs must be unique");
  const client = new BdpClient({
    scope,
    transport: createFetchTransport(fetchImplementation, TARGET_DIAGNOSTIC_TRANSPORT_LIMITS),
  });
  const normalizeType = (id: string): string =>
    id.startsWith(scope) ? id.slice(scope.length) : id;
  // An external endpoint carrying the optional revision citation projects a
  // third element, so the oracle rows prove byte-identical echo where the
  // realization stores one and exact omission where it does not.
  type EndpointRow = readonly [uri: string] | readonly [uri: string, revision: string];
  type LinkRow = readonly [id: string, type: string, source: EndpointRow, target: EndpointRow];
  try {
    const rows: LinkRow[] = [];
    let externalEndpoints = 0;
    let localSource = 0;
    let localTarget = 0;
    for (const id of ids) {
      const result = await client.perform(
        { kind: "resource", resource: "link", id },
        { signal: execution.signal },
      );
      if (isBdpClientProblem(result)) return { outcome: "problem", code: result.code };
      const normalize = (
        endpoint: Parameters<typeof endpointUri>[0],
        role: "source" | "target",
      ): EndpointRow => {
        const uri = endpointUri(endpoint);
        if (uri.startsWith(scope)) {
          if (uri.startsWith(`${scope}beads/`)) {
            if (role === "source") localSource += 1;
            else localTarget += 1;
          }
          return [uri.slice(scope.length)];
        }
        externalEndpoints += 1;
        const revision = endpointRevision(endpoint);
        return revision === undefined ? [uri] : [uri, revision];
      };
      rows.push([
        id.slice(scope.length),
        normalizeType(result.type),
        normalize(result.source, "source"),
        normalize(result.target, "target"),
      ]);
    }
    return {
      outcome: "success",
      rows,
      externalEndpoints,
      localSource,
      localTarget,
      allHaveLocalEndpoint: rows.every((row) => {
        const source = row[2];
        const target = row[3];
        return source[0]?.startsWith("beads/") === true || target[0]?.startsWith("beads/") === true;
      }),
    };
  } finally {
    await client.close();
  }
}

async function observeExternalTypeDescriptors(
  execution: BdpClientScenarioActionExecution,
  scopeFetchImplementation: typeof fetch | undefined,
  externalFetchImplementation: typeof fetch | undefined,
) {
  if (scopeFetchImplementation === undefined || externalFetchImplementation === undefined)
    throw new Error(
      "external-type-descriptors requires isolated Scope and external publisher Fetch implementations",
    );
  if (!isPlainRecord(execution.input) || !Array.isArray(execution.input.ids))
    throw new Error("external-type-descriptors input must contain Type IDs");
  const ids = execution.input.ids.map((value) => parseCanonicalTypeId(value));
  if (ids.length === 0 || ids.length > 32 || new Set(ids).size !== ids.length)
    throw new Error("external-type-descriptors Type IDs must be a bounded unique set");
  const controlledIds = new Set([
    "https://work.example/types/task",
    "https://work.example/types/blocks",
  ]);
  if (ids.some((id) => !controlledIds.has(id)))
    throw new Error("external-type-descriptors accepts only the controlled work.example Type IDs");
  const client = new BdpClient({
    scope: execution.scope as AbsoluteHttpUrl,
    transport: createFetchTransport(scopeFetchImplementation, TARGET_DIAGNOSTIC_TRANSPORT_LIMITS),
    externalTypeDescriptors: {
      typeIds: ids,
      fetchImplementation: externalFetchImplementation,
      fetchOptions: TARGET_DIAGNOSTIC_TRANSPORT_LIMITS,
    },
  });
  try {
    const rows = [];
    for (const id of ids) {
      const result = await client.perform(
        { kind: "resource", resource: "type", id },
        { signal: execution.signal },
      );
      if (isBdpClientProblem(result)) return { outcome: "problem", code: result.code };
      rows.push(result);
    }
    return { outcome: "success", rows };
  } finally {
    await client.close();
  }
}

async function observeDisconnectRecovery(
  execution: BdpClientScenarioActionExecution,
  fetchImplementation: typeof fetch | undefined,
) {
  if (fetchImplementation === undefined)
    throw new Error("disconnect-recovery requires a public target Fetch implementation");
  const scope = execution.scope as AbsoluteHttpUrl;
  const beads = new URL("beads/", scope).href;
  let readRequests = 0;
  let disconnectInjected = false;
  const disconnectingFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await fetchImplementation(input, init);
    if (url === beads && !disconnectInjected) {
      disconnectInjected = true;
      readRequests += 1;
      await response.body?.cancel();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("diagnostic response disconnect"));
        },
      });
      const disconnected = new Response(body, {
        status: response.status,
        headers: response.headers,
      });
      Object.defineProperty(disconnected, "url", { value: response.url || url });
      return disconnected;
    }
    if (url === beads) readRequests += 1;
    return response;
  };
  const client = new BdpClient({
    scope,
    transport: createFetchTransport(disconnectingFetch, TARGET_DIAGNOSTIC_TRANSPORT_LIMITS),
  });
  try {
    const first = await client.perform(
      { kind: "collection", collection: "beads" },
      {
        signal: execution.signal,
      },
    );
    const second = await client.perform(
      { kind: "collection", collection: "beads" },
      {
        signal: execution.signal,
      },
    );
    return {
      disconnectInjected,
      firstOutcome: isBdpClientProblem(first) ? "problem" : "success",
      firstCode: isBdpClientProblem(first) ? first.code : null,
      secondOutcome: isBdpClientProblem(second) ? "problem" : "success",
      secondCode: isBdpClientProblem(second) ? second.code : null,
      readRequests,
    };
  } finally {
    await client.close();
  }
}

async function observePublicLogicalProjection(
  execution: BdpClientScenarioActionExecution,
  fetchImplementation: typeof fetch | undefined,
) {
  if (fetchImplementation === undefined)
    throw new Error("public-logical-projection requires a public target Fetch implementation");
  const scope = execution.scope as AbsoluteHttpUrl;
  const relationshipRoles = parseRelationshipRoles(execution.input, scope);
  const client = new BdpClient({
    scope,
    transport: createFetchTransport(fetchImplementation, TARGET_DIAGNOSTIC_TRANSPORT_LIMITS),
  });
  try {
    const beads = await client.perform(
      { kind: "collection", collection: "beads" },
      {
        signal: execution.signal,
      },
    );
    const links = await client.perform(
      { kind: "collection", collection: "links" },
      {
        signal: execution.signal,
      },
    );
    if (isBdpClientProblem(beads)) return { outcome: "problem", code: beads.code };
    if (isBdpClientProblem(links)) return { outcome: "problem", code: links.code };
    const titleById = new Map<string, string>();
    const beadProjection = beads.items.map((bead) => {
      const title = boundedString(bead.properties.title, "bead title");
      titleById.set(bead.id, title);
      return [
        title,
        boundedString(bead.properties.status, "bead status"),
        boundedNumber(bead.properties.priority, "bead priority"),
      ] as const;
    });
    const relationships = links.items.flatMap((link) => {
      const source = titleById.get(endpointUri(link.source));
      const target = titleById.get(endpointUri(link.target));
      const role = relationshipRoles.get(link.type);
      if (role === undefined)
        throw new Error("public-logical-projection Link Type had no fixture-owned logical role");
      if (source === undefined || target === undefined) {
        if (
          (source === undefined && endpointUri(link.source).startsWith(scope)) ||
          (target === undefined && endpointUri(link.target).startsWith(scope))
        )
          throw new Error("public-logical-projection local Link endpoint was not in the bead page");
        return [];
      }
      return [[source, target, role] as const];
    });
    beadProjection.sort(compareJsonRows);
    relationships.sort(compareJsonRows);
    return {
      outcome: "success",
      code: null,
      complete: beads.next === null && links.next === null,
      projection: { beadStatuses: beadProjection, relationships },
    };
  } finally {
    await client.close();
  }
}

function parseRelationshipRoles(
  input: unknown,
  scope: AbsoluteHttpUrl,
): ReadonlyMap<string, string> {
  if (
    !isPlainRecord(input) ||
    Reflect.ownKeys(input).length !== 1 ||
    !Array.isArray(input.relationshipRoles) ||
    input.relationshipRoles.length === 0 ||
    input.relationshipRoles.length > 64
  )
    throw new Error("public-logical-projection action input was invalid");
  const roles = new Map<string, string>();
  for (const candidate of input.relationshipRoles) {
    if (
      !isPlainRecord(candidate) ||
      Reflect.ownKeys(candidate).length !== 2 ||
      typeof candidate.type !== "string" ||
      candidate.type.length === 0 ||
      candidate.type.length > 2_048 ||
      typeof candidate.role !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.role)
    )
      throw new Error("public-logical-projection relationship role was invalid");
    let type: string;
    try {
      type = parseCanonicalTypeId(new URL(candidate.type, scope).href);
    } catch {
      throw new Error("public-logical-projection relationship Type was invalid");
    }
    if (roles.has(type))
      throw new Error("public-logical-projection relationship Type was duplicated");
    roles.set(type, candidate.role);
  }
  return roles;
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 256)
    throw new Error(`${label} was not a bounded string`);
  return value;
}

function boundedNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} was not a finite number`);
  return value;
}

function compareJsonRows(left: readonly unknown[], right: readonly unknown[]): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

async function observeUnsupportedDiscovery(execution: BdpClientScenarioActionExecution) {
  const variant = unsupportedDiscoveryVariant(execution.input);
  const scope = execution.scope as AbsoluteHttpUrl;
  const serviceDescription = new URL("bdp.json", scope).href as AbsoluteHttpUrl;
  let discoveryProbes = 0;
  let discoveryDocumentRequests = 0;
  let readRequests = 0;
  const transport: BdpTransport = {
    discover() {
      discoveryProbes += 1;
      return Promise.resolve(success({ serviceDescription }));
    },
    perform<Body>(url: AbsoluteHttpUrl) {
      if (url === serviceDescription) {
        discoveryDocumentRequests += 1;
        return Promise.resolve(success(unsupportedDiscovery(scope, variant) as Body));
      }
      readRequests += 1;
      return Promise.resolve(success({ items: [], next: null } as Body));
    },
  };
  const client = new BdpClient({ scope, transport });
  try {
    const result = await client.perform(
      { kind: "collection", collection: "beads" },
      { signal: execution.signal },
    );
    return {
      outcome: isBdpClientProblem(result) ? "problem" : "success",
      code: isBdpClientProblem(result) ? result.code : null,
      discoveryProbes,
      discoveryDocumentRequests,
      readRequests,
    };
  } finally {
    await client.close();
  }
}

async function observeResourceWithoutTypeResolution(execution: BdpClientScenarioActionExecution) {
  const scope = execution.scope as AbsoluteHttpUrl;
  const serviceDescription = new URL("bdp.json", scope).href as AbsoluteHttpUrl;
  const resource = new URL("beads/client-probe", scope).href as AbsoluteHttpUrl;
  const descriptor = "https://types.invalid/client-probe" as AbsoluteHttpUrl;
  let discoveryProbes = 0;
  let discoveryDocumentRequests = 0;
  let resourceRequests = 0;
  let descriptorRequests = 0;
  let otherRequests = 0;
  const transport: BdpTransport = {
    discover() {
      discoveryProbes += 1;
      return Promise.resolve(success({ serviceDescription }));
    },
    perform<Body>(url: AbsoluteHttpUrl) {
      if (url === serviceDescription) {
        discoveryDocumentRequests += 1;
        return Promise.resolve(success(discovery(scope) as Body));
      }
      if (url === resource) {
        resourceRequests += 1;
        return Promise.resolve(
          success({ id: resource, type: descriptor, revision: "1", properties: {} } as Body),
        );
      }
      if (url === descriptor) {
        descriptorRequests += 1;
        return Promise.resolve(
          success({
            id: descriptor,
            name: "Client probe",
            describes: "bead",
            conformsTo: [],
          } as Body),
        );
      }
      otherRequests += 1;
      return Promise.resolve(success({ items: [], next: null } as Body));
    },
  };
  const client = new BdpClient({ scope, transport });
  try {
    const result = await client.perform(
      { kind: "resource", resource: "bead", id: resource },
      { signal: execution.signal },
    );
    return {
      outcome: isBdpClientProblem(result) ? "problem" : "success",
      code: isBdpClientProblem(result) ? result.code : null,
      discoveryProbes,
      discoveryDocumentRequests,
      resourceRequests,
      descriptorRequests,
      otherRequests,
    };
  } finally {
    await client.close();
  }
}

async function observeMalformedSuccessResponse(execution: BdpClientScenarioActionExecution) {
  const scope = execution.scope as AbsoluteHttpUrl;
  const serviceDescription = new URL("bdp.json", scope).href;
  const beads = new URL("beads/", scope).href;
  let scopeRequests = 0;
  let discoveryDocumentRequests = 0;
  let readRequests = 0;
  let otherRequests = 0;
  const transport = createFetchTransport(async (input) => {
    const url = String(input);
    if (url === scope) {
      scopeRequests += 1;
      return responseAt(url, null, {
        status: 204,
        headers: { link: `<bdp.json>; rel="service-desc"` },
      });
    }
    if (url === serviceDescription) {
      discoveryDocumentRequests += 1;
      return responseAt(url, JSON.stringify(discovery(scope)), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url === beads) {
      readRequests += 1;
      return responseAt(url, "{not-json", {
        headers: { "content-type": "application/json" },
      });
    }
    otherRequests += 1;
    return responseAt(url, null, { status: 404 });
  });
  const client = new BdpClient({ scope, transport });
  try {
    const result = await client.perform(
      { kind: "collection", collection: "beads" },
      { signal: execution.signal },
    );
    return {
      outcome: isBdpClientProblem(result) ? "problem" : "success",
      code: isBdpClientProblem(result) ? result.code : null,
      scopeRequests,
      discoveryDocumentRequests,
      readRequests,
      otherRequests,
    };
  } finally {
    await client.close();
  }
}

function unsupportedDiscovery(
  scope: AbsoluteHttpUrl,
  variant: "version" | "profile",
): Record<string, unknown> {
  return {
    ...discovery(scope),
    ...(variant === "version" ? { bdpVersion: "1" } : { profile: "future" }),
  };
}

function discovery(scope: AbsoluteHttpUrl): ReadDiscovery {
  return {
    bdpVersion: "0",
    profile: "read",
    scope,
    beads: new URL("beads/", scope).href as AbsoluteHttpUrl,
    links: new URL("links/", scope).href as AbsoluteHttpUrl,
    types: new URL("types/", scope).href as AbsoluteHttpUrl,
  };
}

function unsupportedDiscoveryVariant(input: unknown): "version" | "profile" {
  if (
    !isPlainRecord(input) ||
    Reflect.ownKeys(input).length !== 1 ||
    (input.variant !== "version" && input.variant !== "profile")
  )
    throw new Error("unsupported-discovery action input was invalid");
  return input.variant;
}

function requireEmptyInput(input: unknown): void {
  if (!isPlainRecord(input) || Reflect.ownKeys(input).length !== 0)
    throw new Error("client scenario action input was invalid");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function success<Body>(body: Body): BdpTransportResult<Body> {
  return { kind: "success", body };
}

function responseAt(
  url: string,
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit,
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}
