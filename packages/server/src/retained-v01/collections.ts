/** Ordinary Core selection, followed by bounded immutable snapshot pagination. */
import { randomBytes } from "node:crypto";
import { parseCanonicalHttpUrl } from "@bdp/protocol";
import { createContextualReadPagination, ReadPaginationError } from "../read-pagination.js";
import { selectReadResources, ReadSelectorError } from "../read-selector.js";
import {
  type JsonObject,
  type ResourceKind,
  type PrivateNavigation,
  RetainedRequestError,
  referenceUri,
} from "./contract.js";
import { inputReferenceUri } from "./reference-input.js";

export const REFERENCE_READ_LIMITS = Object.freeze({
  page: Object.freeze({ defaultItems: 100, maximumItems: 1000 }),
  request: Object.freeze({ targetBytes: 512 * 1024, bodyBytes: 65536 }),
  selector: Object.freeze({ bytes: 8192, depth: 64, nodes: 1024 }),
  retention: Object.freeze({ maximumSnapshotLifetime: "PT5M" }),
});
const selectorLimits = REFERENCE_READ_LIMITS.selector;
const ordinary = [
  "type",
  "conformsTo",
  "source",
  "target",
  "endpoint",
  "selector",
  "limit",
  "cursor",
];
export function inventoryRoute(url: URL, navigation: PrivateNavigation): ResourceKind | undefined {
  for (const kind of ["bead", "link"] as const) {
    const base = new URL(kind === "bead" ? navigation.beads : navigation.links);
    if (
      url.host === base.host &&
      url.pathname === base.pathname &&
      [...base.searchParams].every(
        ([name, value]) =>
          url.searchParams.getAll(name).length === 1 && url.searchParams.get(name) === value,
      )
    )
      return kind;
  }
  return undefined;
}
export function createRetainedCollections(
  navigation: PrivateNavigation,
  epoch: string,
  list: (kind: ResourceKind) => readonly JsonObject[],
  /** A native fixed catalog's `conformsTo`; undefined leaves the parameter unsupported. */
  conformsTo?: (family: string, type: string) => boolean | undefined,
) {
  const paging = createContextualReadPagination<JsonObject>({
    scope: navigation.scope,
    resizable: true,
    defaultPageItems: REFERENCE_READ_LIMITS.page.defaultItems,
    maxPageItems: REFERENCE_READ_LIMITS.page.maximumItems,
    cursorTtlMs: 300000,
    retainedStateCapacity: 100000,
    maxRetainedCursorPositionsPerSnapshot: 10000,
    retainedSnapshotByteCapacity: 32 * 1024 * 1024,
    retainedSnapshotNodeCapacity: 1000000,
    maxOpaqueTokenLength: 64,
    tokenGenerationAttempts: 4,
    idleCleanup: "timer",
    clock: Date.now,
    generateOpaqueToken: () => randomBytes(24).toString("base64url"),
  });
  const unissuedFirstPages = new WeakSet<object>();
  return {
    discardUnissued(page: { readonly items: readonly JsonObject[]; readonly next: string | null }) {
      if (unissuedFirstPages.has(page)) {
        paging.releaseUnissuedPage(page);
        unissuedFirstPages.delete(page);
      }
    },
    close: () => paging.close(),
    read(url: URL, principal: string, kind: ResourceKind, subject?: string) {
      const params = new URLSearchParams(url.search);
      if (subject === undefined) {
        const base = new URL(kind === "bead" ? navigation.beads : navigation.links);
        for (const [name] of base.searchParams) params.delete(name);
      }
      const names = subject === undefined ? ordinary : [...ordinary, "view", "direction"];
      for (const name of params.keys())
        if (!names.includes(name) || params.getAll(name).length !== 1)
          throw new RetainedRequestError("invalid-parameter", 400);
      const family = params.get("conformsTo");
      if (
        (family !== null && conformsTo?.(family, family) !== true) ||
        (kind === "bead" && ["source", "target", "endpoint"].some((n) => params.has(n)))
      )
        throw new RetainedRequestError("invalid-parameter", 400);
      const direction = params.get("direction") ?? "both";
      if (
        subject !== undefined &&
        (params.get("view") !== "links" || !["both", "inbound", "outbound"].includes(direction))
      )
        throw new RetainedRequestError("invalid-parameter", 400);
      let limit: number | undefined;
      if (params.has("limit")) {
        const raw = params.get("limit")!;
        if (!/^[1-9][0-9]*$/.test(raw)) throw new RetainedRequestError("invalid-parameter", 400);
        const maximum = String(REFERENCE_READ_LIMITS.page.maximumItems);
        if (raw.length > maximum.length || (raw.length === maximum.length && raw > maximum))
          throw new RetainedRequestError("limit-exceeded", 413);
        limit = Number(raw);
      }
      const filters: Record<string, string> = {};
      for (const name of ["type", "source", "target", "endpoint"])
        if (params.has(name)) {
          const value = params.get(name)!;
          try {
            filters[name] =
              name === "type"
                ? parseCanonicalHttpUrl(value)
                : inputReferenceUri(navigation.scope, value);
          } catch {
            throw new RetainedRequestError("invalid-parameter", 400);
          }
        }
      // Always parse and bound selection before a cursor or conditional shortcut.
      const selector = params.get("selector");
      try {
        if (selector !== null) selectReadResources(selector, selectorLimits, []);
      } catch (error) {
        throw selectionError(error);
      }
      const fixed = [...params]
        .filter(([name]) => name !== "limit" && name !== "cursor")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const identity = {
        authorizationView: principal,
        scopeEpoch: epoch,
        projection: JSON.stringify([kind, subject ?? "", url.host, url.pathname, fixed]),
      };
      const cursor = params.get("cursor");
      try {
        if (cursor !== null) {
          if (!cursor) throw new RetainedRequestError("invalid-parameter", 400);
          return paging.continuePage({
            ...identity,
            token: cursor,
            ...(limit === undefined ? {} : { limit }),
          });
        }
        let items = list(kind).filter((record) => {
          const uri = (name: string) =>
            referenceUri(record[name] as Parameters<typeof referenceUri>[0]);
          if (
            subject !== undefined &&
            !(
              (direction !== "inbound" && uri("source") === subject) ||
              (direction !== "outbound" && uri("target") === subject)
            )
          )
            return false;
          if (filters.type !== undefined && uri("type") !== filters.type) return false;
          if (family !== null && conformsTo?.(family, uri("type")) !== true) return false;
          if (filters.source !== undefined && uri("source") !== filters.source) return false;
          if (filters.target !== undefined && uri("target") !== filters.target) return false;
          if (
            filters.endpoint !== undefined &&
            uri("source") !== filters.endpoint &&
            uri("target") !== filters.endpoint
          )
            return false;
          return true;
        });
        if (selector !== null) items = [...selectReadResources(selector, selectorLimits, items)];
        items.sort((a, b) =>
          String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0,
        );
        const continuationBase = new URL(url.pathname + url.search, navigation.scope);
        if (items.length > (limit ?? REFERENCE_READ_LIMITS.page.defaultItems)) {
          // Issue only a continuation that remains inside the target bound after
          // ordinary limit resizing. Form serialization can expand a raw query.
          const largestNext = new URL(continuationBase);
          largestNext.searchParams.set("cursor", "x".repeat(39));
          largestNext.searchParams.set("limit", String(REFERENCE_READ_LIMITS.page.maximumItems));
          if (
            Buffer.byteLength(largestNext.pathname + largestNext.search) >
            REFERENCE_READ_LIMITS.request.targetBytes
          )
            throw new RetainedRequestError("limit-exceeded", 413);
        }
        const page = paging.firstPage({
          ...identity,
          items,
          continuationUrl: continuationBase.href,
          ...(limit === undefined ? {} : { limit }),
        });
        unissuedFirstPages.add(page);
        return page;
      } catch (error) {
        if (error instanceof ReadPaginationError) {
          if (error.code === "foreign-view")
            throw new RetainedRequestError("foreign-view", 409, "after-state-change");
          if (error.code === "cursor-expired")
            throw new RetainedRequestError("cursor-expired", 410, "after-state-change");
          if (error.code === "snapshot-limit-exceeded")
            throw new RetainedRequestError("limit-exceeded", 413);
          if (error.code === "capacity-exceeded")
            throw new RetainedRequestError("temporarily-unavailable", 503, "after-delay");
          if (error.code === "foreign-projection" || error.code === "invalid-limit")
            throw new RetainedRequestError("invalid-parameter", 400);
        }
        throw selectionError(error);
      }
    },
  };
}
function selectionError(error: unknown): unknown {
  if (error instanceof ReadSelectorError)
    return new RetainedRequestError(
      error.code.endsWith("limit-exceeded") ? "limit-exceeded" : "invalid-parameter",
      error.code.endsWith("limit-exceeded") ? 413 : 400,
    );
  return error;
}
