import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { AbsoluteHttpUrl, ReadRequest } from "@bdp/protocol";
import { BdpClient, createFetchTransport, isBdpClientProblem } from "../src/index.js";
import type { BdpClientScenarioActionExecution } from "./testing.js";

const limits = {
  maximumResponseBodyBytes: 262_144,
  maximumJsonDepth: 64,
  maximumJsonNodes: 4_096,
  maximumJsonContainerEntries: 1_024,
  responseTimeoutMs: 10_000,
};
const record = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("expected record");
  return v as Record<string, unknown>;
};
const localId = (v: unknown, scope: string): string => {
  if (typeof v !== "string" || !/^(beads|links)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(v))
    throw new Error("expected a fixture-local Resource identity");
  return new URL(v, scope).href;
};

/** Independent lexical JSON writer; no production adapter or revision helper is imported. */
export function independentlyExpectedProjectedToken(body: unknown): string {
  const { revision: _revision, ...preimage } = record(body);
  // Write tokens directly: JSON.stringify of a sorted object would silently
  // reorder integer-like keys. This independent writer preserves lexical order.
  const encode = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
    if (value !== null && typeof value === "object")
      return (
        "{" +
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => `${JSON.stringify(key)}:${encode(v)}`)
          .join(",") +
        "}"
      );
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-JSON number");
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("non-JSON value");
    return encoded;
  };
  const serialized = encode(preimage);
  return `sha256_${createHash("sha256").update(serialized, "utf8").digest("base64url")}`;
}

/** Controlled client observations; no production capabilities or evidence constants are created. */
export async function observeSuccessorRead(
  execution: BdpClientScenarioActionExecution,
  scopeFetch: typeof fetch | undefined,
  publisherFetch: typeof fetch | undefined,
): Promise<unknown> {
  if (scopeFetch === undefined) throw new Error("successor Read observation requires public Fetch");
  const input = record(execution.input);
  const ids = input.ids;
  const descriptorProbe = execution.operation === "wildcard-descriptors";
  const inventoryProbe = execution.operation === "ownership-inventory";
  if (
    descriptorProbe &&
    (publisherFetch === undefined ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 12 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) =>
          typeof id !== "string" ||
          !/^https:\/\/work\.example\/types\/wildcard-probe-[a-z-]+$/.test(id),
      ))
  )
    throw new Error(
      "wildcard probes require bounded controlled descriptor identities and an isolated publisher",
    );
  if (
    inventoryProbe &&
    (publisherFetch === undefined ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 32 ||
      ids.some(
        (id) => typeof id !== "string" || !/^https:\/\/work\.example\/types\/[a-z-]+$/.test(id),
      ))
  )
    throw new Error("inventory witness requires controlled descriptor bindings");
  const client = new BdpClient({
    scope: execution.scope as AbsoluteHttpUrl,
    transport: createFetchTransport(scopeFetch, limits),
    ...((descriptorProbe || inventoryProbe) && publisherFetch !== undefined
      ? {
          externalTypeDescriptors: {
            typeIds: ids as string[],
            fetchImplementation: publisherFetch,
            fetchOptions: limits,
          },
        }
      : {}),
  });
  const read = async (request: ReadRequest): Promise<Record<string, unknown>> => {
    const result = await client.perform(request, { signal: execution.signal });
    if (isBdpClientProblem(result)) throw new Error(`public observation failed: ${result.code}`);
    return record(result);
  };
  const bead = (id: unknown) =>
    read({ kind: "resource", resource: "bead", id: localId(id, execution.scope) });
  try {
    if (descriptorProbe) {
      const rows = [];
      for (const id of ids as string[]) {
        const result = await client.perform(
          { kind: "resource", resource: "type", id },
          { signal: execution.signal },
        );
        rows.push(
          isBdpClientProblem(result)
            ? { id, outcome: "problem", code: result.code }
            : { id, outcome: "success", descriptor: result },
        );
      }
      return { rows };
    }
    if (execution.operation === "wildcard-present") {
      const owner = await bead(input.owner);
      const empty = await bead(input.empty);
      const nonowner = await bead(input.nonowner);
      const groups = record(input.groups);
      const plane = record(owner.ownedLinks);
      let firstClassEqual = true;
      let exactGroups =
        JSON.stringify(Object.keys(plane).sort()) === JSON.stringify(Object.keys(groups).sort());
      for (const [type, localIds] of Object.entries(groups)) {
        if (!Array.isArray(localIds) || localIds.length > 8)
          throw new Error("invalid group fixture");
        const inline = plane[type];
        if (!Array.isArray(inline)) {
          exactGroups = false;
          continue;
        }
        exactGroups &&=
          JSON.stringify(inline.map((v) => record(v).id)) ===
          JSON.stringify(localIds.map((v) => localId(v, execution.scope)));
        for (const [index, id] of localIds.entries()) {
          const actual = await read({
            kind: "resource",
            resource: "link",
            id: localId(id, execution.scope),
          });
          // Structural comparison preserves array order and every opaque field, including pins/attribution.
          firstClassEqual &&= isDeepStrictEqual(inline[index], actual);
        }
      }
      return {
        outcome: "success",
        exactGroups,
        firstClassEqual,
        empty: empty.ownedLinks,
        nonownerAbsent: !Object.hasOwn(nonowner, "ownedLinks"),
      };
    }
    if (execution.operation === "ownership-inventory") {
      const inventory = await read({ kind: "collection", collection: "types" });
      const beads = await read({ kind: "collection", collection: "beads" });
      if (!Array.isArray(inventory.items) || !Array.isArray(beads.items))
        throw new Error("invalid collection");
      // This fixture is deliberately single-page; do not infer absence from an incomplete page.
      if (inventory.next !== null || beads.next !== null)
        throw new Error("ownership witness requires complete inventory");
      let beadsWithOwnership = 0;
      const ownedTypes = new Set<string>();
      for (const item of inventory.items) {
        const summary = record(item);
        if (typeof summary.id !== "string") throw new Error("invalid Type identity");
        const descriptor = await read({ kind: "resource", resource: "type", id: summary.id });
        if (Object.hasOwn(descriptor, "ownsOutgoing")) ownedTypes.add(summary.id);
      }
      for (const item of beads.items) {
        const b = record(item);
        if (typeof b.id !== "string") throw new Error("invalid Bead identity");
        const full = await read({ kind: "resource", resource: "bead", id: b.id });
        if (Object.hasOwn(full, "ownedLinks")) {
          beadsWithOwnership++;
          if (!ownedTypes.has(String(full.type)))
            throw new Error("record ownership has no inventoried descriptor");
        }
      }
      return { outcome: "success", ownedTypes: ownedTypes.size, beadsWithOwnership };
    }
    if (execution.operation === "numeric-token-model") {
      if (
        input.numberModel !== "IEEE-754-binary64-ECMAScript-JSON" ||
        !Array.isArray(ids) ||
        ids.length < 2 ||
        ids.length > 8 ||
        new Set(ids).size !== ids.length
      )
        throw new Error(
          "numeric observer requires the bound declared model and bounded Resource IDs",
        );
      let tokensMatch = true,
        numbers = 0;
      const kinds = new Set<string>();
      const rows = [];
      for (const id of ids) {
        const canonical = localId(id, execution.scope);
        const resource = String(id).startsWith("beads/") ? "bead" : "link";
        kinds.add(resource);
        const body = await read({ kind: "resource", resource, id: canonical });
        JSON.stringify(body, (_key, value: unknown) => {
          if (typeof value === "number") numbers++;
          return value;
        });
        const expected = independentlyExpectedProjectedToken(body);
        tokensMatch &&= body.revision === expected;
        rows.push({ id, expected, observed: body.revision });
      }
      return {
        outcome: "success",
        tokensMatch,
        hasNumbers: numbers > 0,
        bothKinds: kinds.size === 2,
        numberModel: input.numberModel,
        rows,
      };
    }
    throw new Error("unsupported successor Read observation");
  } finally {
    await client.close();
  }
}
