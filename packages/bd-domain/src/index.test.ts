import { describe, expect, it } from "vitest";

import type { BeadRecord, LinkRecord } from "@bdp/protocol";
import { BdpClient, type BdpTransport, type BdpTransportResult } from "@bdp/client";

import { isReadinessProblem, readyBeadsFromClient, readyBeadsFromRecords } from "./index.js";

const SCOPE = "https://beads.example/acme/";
const BLOCKS = "https://work.example/types/blocks";

describe("bd readiness", () => {
  it("never classifies a tagged ReadyBead array as a Problem", () => {
    const tagged = Object.assign([], {
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      retry: "after-delay",
    });
    expect(isReadinessProblem(tagged)).toBe(false);

    const inherited = Object.setPrototypeOf(
      [],
      Object.assign(Object.create(Array.prototype), {
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        code: "temporarily-unavailable",
        retry: "after-delay",
      }),
    );
    expect(isReadinessProblem(inherited)).toBe(false);
  });

  it("matches the pinned bd oracle rule for own status and all blocking targets", () => {
    const open = bead("a", "open");
    const blocked = bead("b", "open", [blocks("b-a", "b", "a")]);
    const closed = bead("c", "closed");
    const resolved = bead("d", "open", [blocks("d-c", "d", "c")]);
    const deferred = bead("e", "deferred");
    const deferredBlocker = bead("f", "open", [blocks("f-e", "f", "e")]);
    const inProgress = bead("g", "in_progress");

    expect(
      readyBeadsFromRecords(
        [open, blocked, closed, resolved, deferred, deferredBlocker, inProgress],
        { blockingLinkType: BLOCKS },
      ).map(({ bead: ready }) => ready.id),
    ).toEqual([open.id, resolved.id]);
  });

  it("orders ready beads by priority and then descending creation time", () => {
    const older = {
      ...bead("older", "open"),
      properties: {
        status: "open",
        priority: 2,
        created_at: "2026-08-08T23:33:31Z",
      },
    };
    const higherPriority = {
      ...bead("higher-priority", "open"),
      properties: {
        status: "open",
        priority: 1,
        created_at: "2026-08-08T23:33:30Z",
      },
    };
    const newer = {
      ...bead("newer", "open"),
      properties: {
        status: "open",
        priority: 2,
        created_at: "2026-08-08T23:33:35Z",
      },
    };
    const tie = {
      ...bead("tie", "open"),
      properties: {
        status: "open",
        priority: 2,
        created_at: "2026-08-08T23:33:35Z",
      },
    };

    expect(
      readyBeadsFromRecords([older, higherPriority, tie, newer], {
        blockingLinkType: BLOCKS,
      }).map(({ bead: ready }) => ready.id),
    ).toEqual([higherPriority.id, newer.id, tie.id, older.id]);
  });

  it("sorts missing or invalid ordering metadata after compatible records", () => {
    const missing = bead("a-missing", "open");
    const invalid = {
      ...bead("b-invalid", "open"),
      properties: { status: "open", priority: Number.NaN, created_at: "not-a-timestamp" },
    };
    const compatible = {
      ...bead("z-compatible", "open"),
      properties: {
        status: "open",
        priority: 4,
        created_at: "2026-08-08T23:33:35Z",
      },
    };

    expect(
      readyBeadsFromRecords([missing, invalid, compatible], {
        blockingLinkType: BLOCKS,
      }).map(({ bead: ready }) => ready.id),
    ).toEqual([compatible.id, missing.id, invalid.id]);
  });

  it("requires every blocks target to resolve and ignores non-blocking links", () => {
    const open = bead("a", "open");
    const related = bead("b", "open", [link("b-a", "related", "b", "a")]);
    const missing = bead("c", "open", [blocks("c-missing", "c", "missing")]);

    expect(
      readyBeadsFromRecords([open, related, missing], { blockingLinkType: BLOCKS }).map(
        ({ bead: ready }) => ready.id,
      ),
    ).toEqual([open.id, related.id]);
  });

  it("uses only outbound blocking Links incident on the candidate Bead", () => {
    const candidate = bead("candidate", "open", [
      blocks("inbound", "blocker", "candidate"),
      blocks("unrelated", "other", "blocker"),
    ]);
    const blocker = bead("blocker", "open");
    const other = bead("other", "open");

    const ready = readyBeadsFromRecords([candidate, blocker, other], {
      blockingLinkType: BLOCKS,
    });

    expect(ready.map(({ bead: result }) => result.id)).toContain(candidate.id);
  });

  it("returns deeply frozen readiness composites", () => {
    const open = bead("open", "open");
    const [ready] = readyBeadsFromRecords([open], { blockingLinkType: BLOCKS });

    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready?.blockers)).toBe(true);
    expect(Object.isFrozen(readyBeadsFromRecords([open], { blockingLinkType: BLOCKS }))).toBe(true);
  });

  it("follows every authoritative bead and incident-link continuation", async () => {
    const first = bead("a", "open");
    const second = bead("b", "open");
    const continuation = `${SCOPE}beads/?cursor=opaque-beads`;
    const linkContinuation = `${SCOPE}beads/${encodeURIComponent("a")}?cursor=opaque-links`;
    const requests: string[] = [];
    const client = {
      scope: SCOPE,
      createContinuationScope() {
        return {} as never;
      },
      forgetContinuations() {},
      async discover() {
        return {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        };
      },
      async perform(request: { readonly kind: string; readonly continuation?: string }) {
        requests.push(request.continuation ?? request.kind);
        if (request.kind === "collection" && request.continuation === undefined) {
          return { items: [first], next: continuation };
        }
        if (request.kind === "collection") return { items: [second], next: null };
        if (request.kind === "bead-links" && request.continuation === undefined) {
          return { items: [], next: linkContinuation };
        }
        if (request.kind === "bead-links") return { items: [], next: null };
        return second;
      },
    };

    const result = await readyBeadsFromClient(client as never, { blockingLinkType: BLOCKS });
    expect(result).toHaveLength(2);
    expect(requests).toContain(continuation);
    expect(requests).toContain(linkContinuation);
  });

  it("omits direction when a real client follows an incident-Link continuation", async () => {
    const open = bead("a", "open");
    const openCollectionItem = {
      id: open.id,
      type: open.type,
      revision: open.revision,
      properties: open.properties,
    };
    const continuation = `${open.id}?view=links&cursor=opaque-links`;
    const urls: string[] = [];
    const transport: BdpTransport = {
      discover: () =>
        Promise.resolve({
          kind: "success",
          body: { serviceDescription: `${SCOPE}bdp.json` },
        }),
      async perform<Body>(url: string): Promise<BdpTransportResult<Body>> {
        urls.push(url);
        if (url.endsWith("bdp.json"))
          return {
            kind: "success",
            body: {
              bdpVersion: "0",
              profile: "read",
              scope: SCOPE,
              beads: `${SCOPE}beads/`,
              links: `${SCOPE}links/`,
              types: `${SCOPE}types/`,
            } as Body,
          };
        if (url === `${SCOPE}beads/`)
          return { kind: "success", body: { items: [openCollectionItem], next: null } as Body };
        if (url === continuation)
          return { kind: "success", body: { items: [], next: null } as Body };
        if (url === `${open.id}?view=links&direction=outbound`)
          return { kind: "success", body: { items: [], next: continuation } as Body };
        throw new Error(`unexpected test URL ${url}`);
      },
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    const result = await readyBeadsFromClient(client, { blockingLinkType: BLOCKS });
    expect(isReadinessProblem(result)).toBe(false);
    expect(result).toEqual([{ bead: { ...open, links: { items: [], next: null } }, blockers: [] }]);
    expect(urls).toContain(continuation);
  });

  it("keeps an external blocking target opaque and conservatively unresolved", async () => {
    const blocked = bead("a", "open");
    const ready = bead("b", "open");
    const external: LinkRecord = {
      id: `${SCOPE}links/a-external`,
      type: BLOCKS,
      revision: "revision-a-external",
      source: blocked.id,
      target: "urn:external:blocked",
      properties: {},
    };
    const requests: { readonly kind: string; readonly id?: string; readonly bead?: string }[] = [];
    const client = {
      scope: SCOPE,
      createContinuationScope() {
        return {} as never;
      },
      forgetContinuations() {},
      async discover() {
        return {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        };
      },
      async perform(request: {
        readonly kind: string;
        readonly id?: string;
        readonly bead?: string;
      }) {
        requests.push(request);
        if (request.kind === "collection") return { items: [blocked, ready], next: null };
        if (request.kind === "bead-links")
          return { items: request.bead === blocked.id ? [external] : [], next: null };
        throw new Error("external endpoints must not be read as Beads");
      },
    };

    const result = await readyBeadsFromClient(client as never, { blockingLinkType: BLOCKS });
    expect(result).toEqual([
      { bead: { ...ready, links: { items: [], next: null } }, blockers: [] },
    ]);
    expect(requests.every(({ kind }) => kind !== "resource")).toBe(true);
  });

  it("reclaims abandoned continuations after a failed traversal", async () => {
    let page = 0;
    const transport: BdpTransport = {
      discover: () =>
        Promise.resolve({
          kind: "success",
          body: { serviceDescription: `${SCOPE}bdp.json` },
        }),
      perform<Body>(url: string): Promise<BdpTransportResult<Body>> {
        if (url.endsWith("bdp.json"))
          return Promise.resolve({
            kind: "success",
            body: {
              bdpVersion: "0",
              profile: "read",
              scope: SCOPE,
              beads: `${SCOPE}beads/`,
              links: `${SCOPE}links/`,
              types: `${SCOPE}types/`,
            } as Body,
          });
        if (url === `${SCOPE}beads/`) {
          page += 1;
          return Promise.resolve({
            kind: "success",
            body: { items: [], next: `${SCOPE}beads/?cursor=failed-${page}` } as Body,
          });
        }
        return Promise.resolve({
          kind: "problem",
          problem: {
            type: "https://github.com/gastownhall/bdp/problems/unavailable",
            code: "temporarily-unavailable",
            retry: "after-delay",
            status: 503,
          },
        });
      },
    };
    const client = new BdpClient({ scope: SCOPE, transport });

    try {
      for (let attempt = 0; attempt < 1_025; attempt += 1) {
        const result = await readyBeadsFromClient(client, { blockingLinkType: BLOCKS });
        expect(isReadinessProblem(result)).toBe(true);
      }
    } finally {
      await client.close();
    }
  });

  it("does not revoke an unrelated traversal's continuation after readiness fails", async () => {
    const unrelatedContinuation = `${SCOPE}beads/?cursor=unrelated`;
    const readinessContinuation = `${SCOPE}beads/?cursor=readiness`;
    let initialCollections = 0;
    const transport: BdpTransport = {
      discover: () =>
        Promise.resolve({
          kind: "success",
          body: { serviceDescription: `${SCOPE}bdp.json` },
        }),
      perform<Body>(url: string): Promise<BdpTransportResult<Body>> {
        if (url.endsWith("bdp.json"))
          return Promise.resolve({
            kind: "success",
            body: {
              bdpVersion: "0",
              profile: "read",
              scope: SCOPE,
              beads: `${SCOPE}beads/`,
              links: `${SCOPE}links/`,
              types: `${SCOPE}types/`,
            } as Body,
          });
        if (url === `${SCOPE}beads/`) {
          initialCollections += 1;
          return Promise.resolve({
            kind: "success",
            body: {
              items: [],
              next: initialCollections === 1 ? unrelatedContinuation : readinessContinuation,
            } as Body,
          });
        }
        if (url === readinessContinuation)
          return Promise.resolve({
            kind: "problem",
            problem: {
              type: "https://github.com/gastownhall/bdp/problems/unavailable",
              code: "temporarily-unavailable",
              retry: "after-delay",
              status: 503,
            },
          });
        if (url === unrelatedContinuation)
          return Promise.resolve({
            kind: "success",
            body: { items: [], next: null } as Body,
          });
        throw new Error(`unexpected test URL ${url}`);
      },
    };
    const client = new BdpClient({ scope: SCOPE, transport });
    const unrelatedScope = client.createContinuationScope();

    try {
      await client.perform(
        { kind: "collection", collection: "beads" },
        { continuationScope: unrelatedScope },
      );
      const readiness = await readyBeadsFromClient(client, { blockingLinkType: BLOCKS });
      expect(isReadinessProblem(readiness)).toBe(true);
      await expect(
        client.perform(
          {
            kind: "collection",
            collection: "beads",
            continuation: unrelatedContinuation,
          },
          { continuationScope: unrelatedScope },
        ),
      ).resolves.toEqual({ items: [], next: null });
    } finally {
      await client.close();
    }
  });

  it("fails boundedly when bead accumulation exceeds the local item ceiling", async () => {
    const client = {
      createContinuationScope() {
        return {} as never;
      },
      forgetContinuations() {},
      async discover() {
        return {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        };
      },
      async perform() {
        return { items: new Array(100_001), next: null };
      },
    };

    const result = await readyBeadsFromClient(client as never, { blockingLinkType: BLOCKS });
    expect(result).toMatchObject({
      code: "temporarily-unavailable",
      detail: "readiness traversal exceeded its local item bound",
    });
  });

  it("applies one item ceiling across Beads and incident Links", async () => {
    const first = bead("a", "open");
    const second = bead("b", "open");
    const client = {
      createContinuationScope() {
        return {} as never;
      },
      forgetContinuations() {},
      async discover() {
        return {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        };
      },
      async perform(request: { readonly kind: string }) {
        return request.kind === "collection"
          ? { items: [first, second], next: null }
          : { items: new Array(99_999), next: null };
      },
    };

    const result = await readyBeadsFromClient(client as never, { blockingLinkType: BLOCKS });
    expect(result).toMatchObject({
      code: "temporarily-unavailable",
      detail: "readiness traversal exceeded its local item bound",
    });
  });

  it("applies one request ceiling across every incident-link traversal", async () => {
    const first = bead("first", "open");
    const second = bead("second", "open");
    let incidentRequests = 0;
    const client = {
      createContinuationScope() {
        return {} as never;
      },
      forgetContinuations() {},
      async discover() {
        return {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        };
      },
      async perform(request: { readonly kind: string }) {
        if (request.kind === "collection") return { items: [first, second], next: null };
        incidentRequests += 1;
        return {
          items: [],
          next: incidentRequests % 5_000 === 0 ? null : `${SCOPE}links/?cursor=${incidentRequests}`,
        };
      },
    };

    const result = await readyBeadsFromClient(client as never, { blockingLinkType: BLOCKS });
    expect(result).toMatchObject({
      code: "temporarily-unavailable",
      detail: "readiness traversal exceeded its local request bound",
    });
    expect(incidentRequests).toBeLessThanOrEqual(9_999);
  });

  it("fails boundedly when a continuation cycles", async () => {
    const continuation = `${SCOPE}beads/?cursor=cycle`;
    const client = {
      createContinuationScope() {
        return {} as never;
      },
      async discover() {
        return {
          bdpVersion: "0",
          profile: "read",
          scope: SCOPE,
          beads: `${SCOPE}beads/`,
          links: `${SCOPE}links/`,
          types: `${SCOPE}types/`,
        };
      },
      async perform() {
        return { items: [], next: continuation };
      },
      forgetContinuations() {},
    };
    const result = await readyBeadsFromClient(client as never, { blockingLinkType: BLOCKS });
    expect(isReadinessProblem(result)).toBe(true);
    expect(result).toMatchObject({ code: "temporarily-unavailable" });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

function bead(id: string, status: string, links: readonly LinkRecord[] = []): BeadRecord {
  return {
    id: `${SCOPE}beads/${id}`,
    type: "https://work.example/types/task",
    revision: `revision-${id}`,
    properties: { status },
    links: { items: links, next: null },
  };
}

function blocks(id: string, source: string, target: string): LinkRecord {
  return link(id, "blocks", source, target);
}

function link(id: string, type: string, source: string, target: string): LinkRecord {
  return {
    id: `${SCOPE}links/${id}`,
    type: type === "blocks" ? BLOCKS : type,
    revision: `revision-${id}`,
    source: `${SCOPE}beads/${source}`,
    target: `${SCOPE}beads/${target}`,
    properties: {},
  };
}
