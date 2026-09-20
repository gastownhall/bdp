import { readFileSync } from "node:fs";
import type { BeadRecord, HistoryVersionsPage, LinkRecord, ReadDiscovery } from "@bdp/protocol";
import { readProblem } from "@bdp/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ReadSessionLocalError } from "./continuations.js";
import {
  BdpClient,
  BdpClientClosedError,
  BdpClientOperationAbortedError,
  BdpClientRequestError,
  BdpClientTransportError,
  type BdpTransport,
  type BdpTransportResult,
  createFetchTransport,
  type HistoryRequest,
  isBdpClientProblem,
} from "./index.js";

const examples = JSON.parse(
  readFileSync(new URL("../../../fixtures/history/wire.json", import.meta.url), "utf8"),
) as { examples: Array<{ id: string; body: unknown }> };
function fixture<T>(id: string): T {
  return structuredClone(examples.examples.find((e) => e.id === id)?.body) as T;
}
const scope = "https://work.example/scope/";
const id = `${scope}beads/decision`;
const versions = { kind: "versions", resource: "bead", id } as const;
const exact = { kind: "revision", resource: "bead", id, revision: "old" } as const;
function discovery(): ReadDiscovery {
  return {
    ...fixture<ReadDiscovery>("discovery-read"),
    scope,
    beads: `${scope}beads/`,
    links: `${scope}links/`,
    types: `${scope}types/`,
    aliases: `${scope}alias/`,
  };
}
function page(): HistoryVersionsPage {
  return fixture("versions-first-page");
}
const clients: BdpClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
function clientWith(
  handler: (url: string, signal: AbortSignal) => unknown | Promise<unknown>,
  metadata: unknown = discovery(),
) {
  const calls: string[] = [];
  const transport: BdpTransport = {
    async discover() {
      return { kind: "success", body: { serviceDescription: `${scope}bdp.json` } };
    },
    async perform<Body>(
      url: string,
      options: { scope: string; signal: AbortSignal },
    ): Promise<BdpTransportResult<Body>> {
      calls.push(url);
      return {
        kind: "success",
        body: (url === `${scope}bdp.json` ? metadata : await handler(url, options.signal)) as Body,
      };
    },
  };
  const client = new BdpClient({ scope, transport, transportSettlementTimeoutMs: 10 });
  clients.push(client);
  return { client, calls, transport };
}
function terminal(): HistoryVersionsPage {
  return {
    ...page(),
    items: fixture<HistoryVersionsPage>("versions-replacement").items.slice(2),
    next: null,
  };
}

describe("explicit body-only History client", () => {
  it.each(["exact-bead", "exact-link", "legacy-link"])(
    "reads %s with pins and context unchanged, without current preflight",
    async (name) => {
      const body = fixture<BeadRecord | LinkRecord>(name);
      const { client, calls } = clientWith(() => body);
      const result = await client.performHistory({
        kind: "revision",
        resource: name === "exact-bead" ? "bead" : "link",
        id: body.id,
        revision: body.revision,
      });
      expect(result).toEqual(body);
      expect(calls).toEqual([
        `${scope}bdp.json`,
        `${body.id}?${new URLSearchParams({ revision: body.revision })}`,
      ]);
    },
  );

  it.each(["r +/%?&雪", "\0"])(
    "preserves opaque revision %j through actual Fetch once-decoding",
    async (revision) => {
      const urls: string[] = [];
      const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        urls.push(url);
        const response =
          url === scope
            ? new Response(null, {
                status: 204,
                headers: { link: `<${scope}bdp.json>; rel="service-desc"` },
              })
            : new Response(
                JSON.stringify(
                  url === `${scope}bdp.json`
                    ? discovery()
                    : { id, type: "https://work.example/types/memory", revision, properties: {} },
                ),
                { headers: { "content-type": "application/json" } },
              );
        Object.defineProperty(response, "url", { value: url });
        return response;
      };
      const client = new BdpClient({ scope, transport: createFetchTransport(fetcher) });
      clients.push(client);
      expect(await client.performHistory({ ...exact, revision })).toMatchObject({ revision });
      const target = new URL(urls.at(-1) as string);
      expect(target.searchParams.getAll("revision")).toEqual([revision]);
      if (revision === "\0") expect(target.search).toBe("?revision=%00");
    },
  );

  it.each(["\ud800", ""])("refuses lossy/empty revision before discovery", async (revision) => {
    const { client, calls } = clientWith(() => undefined);
    await expect(client.performHistory({ ...exact, revision })).rejects.toBeInstanceOf(
      BdpClientRequestError,
    );
    expect(calls).toEqual([]);
  });

  it("snapshots request data and rejects accessors/unknown members", async () => {
    const { client } = clientWith((url) => ({
      id,
      type: "https://work.example/types/memory",
      revision: new URL(url).searchParams.get("revision"),
      properties: {},
    }));
    const request = { ...exact, revision: "captured" };
    const pending = client.performHistory(request);
    request.revision = "mutated";
    expect(await pending).toMatchObject({ revision: "captured" });
    await expect(
      client.performHistory(
        Object.defineProperty({ ...exact }, "revision", {
          get() {
            throw new Error("must not run");
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    await expect(
      client.performHistory({ ...exact, includeLinks: true } as HistoryRequest),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
  });

  it("requires explicit capability and preserves existing unsupported discovery diagnosis", async () => {
    const absent = { ...discovery() };
    delete absent.historicalResolution;
    const first = clientWith(() => {
      throw new Error("no History GET");
    }, absent);
    expect(await first.client.performHistory(versions)).toMatchObject({
      code: "invalid-parameter",
    });
    expect(first.calls).toHaveLength(1);
    for (const metadata of [
      { ...discovery(), historicalResolution: { version: 2 } },
      { ...discovery(), historicalResolution: { version: 1, extra: true } },
      JSON.parse(
        JSON.stringify(fixture("discovery-read-update")).replaceAll(
          "https://beads.example/acme/",
          scope,
        ),
      ),
      JSON.parse(
        JSON.stringify(fixture("discovery-transactional")).replaceAll(
          "https://beads.example/acme/",
          scope,
        ),
      ),
    ]) {
      const { client, calls } = clientWith(
        () => {
          throw new Error("no History GET");
        },
        { ...(metadata as object), scope },
      );
      expect(await client.performHistory(versions)).toMatchObject({
        code: "temporarily-unavailable",
        detail: "the Scope returned invalid or unsupported discovery metadata",
      });
      expect(calls).toHaveLength(1);
    }
  });

  it("follows exact issued URL explicitly, preserving server order and no hidden body reads", async () => {
    const first = page();
    const second = terminal();
    const { client, calls } = clientWith((url) => (url === first.next ? second : first));
    const owner = client.createContinuationScope();
    expect(await client.performHistory(versions, { continuationScope: owner })).toEqual(first);
    expect(calls.at(-1)).toBe(`${id}?view=versions`);
    expect(
      await client.performHistory(
        { ...versions, continuation: first.next as string },
        { continuationScope: owner },
      ),
    ).toEqual(second);
    expect(calls.at(-1)).toBe(first.next);
    expect(calls).toHaveLength(3);
  });

  it.each([{}, { defaultItems: 1 }, { maximumItems: 1 }])(
    "forwards explicit limit despite partial advertised page limits %j",
    async (limits) => {
      const { client, calls } = clientWith(() => ({ ...page(), next: null }), {
        ...discovery(),
        limits: { page: limits },
      });
      expect(isBdpClientProblem(await client.performHistory({ ...versions, limit: 3 }))).toBe(
        false,
      );
      expect(calls.at(-1)).toBe(`${id}?view=versions&limit=3`);
    },
  );

  it.each([undefined, "3"])(
    "refuses dropped/changed explicitly requested next limit %j",
    async (limit) => {
      const next = `${id}?view=versions&cursor=two${limit ? `&limit=${limit}` : ""}`;
      const { client } = clientWith(() => ({ ...page(), next }));
      expect(await client.performHistory({ ...versions, limit: 2 })).toMatchObject({
        code: "temporarily-unavailable",
      });
      await expect(
        client.performHistory({ ...versions, continuation: next }),
      ).rejects.toBeInstanceOf(BdpClientRequestError);
    },
  );

  it("enforces explicit page count, but adds no guessed default, cross-page dedupe or window equality law", async () => {
    const first = page();
    const changed = {
      ...first,
      window: { newest: "r3", oldest: "r3", complete: false },
      next: null,
    };
    const { client } = clientWith((url) => (url === first.next ? changed : first));
    expect(await client.performHistory({ ...versions, limit: 1 })).toMatchObject({
      code: "temporarily-unavailable",
    });
    expect(await client.performHistory(versions)).toEqual(first);
    expect(
      await client.performHistory({ ...versions, continuation: first.next as string }),
    ).toEqual(changed);
  });

  it.each(["versions-empty-visible-page", "versions-undetermined", "versions-not-tracked"])(
    "preserves %s without invented history",
    async (name) => {
      const body = fixture<HistoryVersionsPage>(name);
      const { client } = clientWith(() => body);
      expect(await client.performHistory(versions)).toEqual(body);
      if (body.next === null)
        await expect(
          client.performHistory({ ...versions, continuation: page().next as string }),
        ).rejects.toBeInstanceOf(BdpClientRequestError);
    },
  );

  it("accepts tracked empty terminal window", async () => {
    const body = {
      ...page(),
      items: [],
      window: { newest: null, oldest: null, complete: true },
      next: null,
    };
    const { client } = clientWith(() => body);
    expect(await client.performHistory(versions)).toEqual(body);
  });

  it.each(["wrong-id", "wrong-revision", "current-links", "owned-external"])(
    "refuses malformed historical Bead %s",
    async (mode) => {
      const body = fixture<BeadRecord>("exact-bead");
      const invalid =
        mode === "wrong-id"
          ? { ...body, id: `${scope}beads/other` }
          : mode === "wrong-revision"
            ? { ...body, revision: "other" }
            : mode === "current-links"
              ? { ...body, links: [] }
              : {
                  ...body,
                  ownedLinks: {
                    "https://work.example/types/cites": [
                      {
                        ...fixture<LinkRecord>("exact-link"),
                        source: "https://external.example/a",
                        target: "https://external.example/b",
                      },
                    ],
                  },
                };
      const { client } = clientWith(() => invalid);
      expect(await client.performHistory({ ...exact, revision: body.revision })).toMatchObject({
        code: "temporarily-unavailable",
      });
    },
  );

  it("refuses both-external historical Link and local alias identities", async () => {
    const link = fixture<LinkRecord>("exact-link");
    const { client, calls } = clientWith(() => ({
      ...link,
      source: "https://external.example/a",
      target: "https://external.example/b",
    }));
    expect(
      await client.performHistory({
        kind: "revision",
        resource: "link",
        id: link.id,
        revision: link.revision,
      }),
    ).toMatchObject({ code: "temporarily-unavailable" });
    const count = calls.length;
    for (const [bad, code] of [
      [`${scope}alias/decision`, "invalid-parameter"],
      [`${scope}types/memory`, "invalid-parameter"],
      ["https://other.example/beads/x", "forbidden"],
    ] as const)
      expect(await client.performHistory({ ...exact, id: bad })).toMatchObject({ code });
    expect(calls).toHaveLength(count);
  });

  it.each([
    "revision-unknown",
    "revision-unretained",
    "revision-reorganized",
    "revision-not-tracked",
    "revision-unrepresentable",
    "resource-pruned",
    "resource-erased",
  ])("preserves remote %s without fallback", async (name) => {
    const problem = fixture<Record<string, unknown>>(name);
    const { client, calls, transport } = clientWith(() => undefined);
    const perform = transport.perform.bind(transport);
    transport.perform = async <Body>(
      url: string,
      options: { scope: string; signal: AbortSignal },
    ): Promise<BdpTransportResult<Body>> =>
      url === `${scope}bdp.json`
        ? perform(url, options)
        : { kind: "problem", problem, httpStatus: problem.status as number };
    expect(await client.performHistory(exact)).toEqual(problem);
    expect(calls).toHaveLength(1);
  });

  it("rejects missing inventory/write-only Problems; preserves ordinary erased extensions but refuses known pointer", async () => {
    const { client, transport } = clientWith(() => undefined);
    const perform = transport.perform.bind(transport);
    let problem: Record<string, unknown> = fixture("revision-unretained");
    delete problem.missing;
    transport.perform = async <Body>(
      url: string,
      options: { scope: string; signal: AbortSignal },
    ): Promise<BdpTransportResult<Body>> =>
      url === `${scope}bdp.json` ? perform(url, options) : { kind: "problem", problem };
    await expect(client.performHistory(exact)).rejects.toBeInstanceOf(BdpClientTransportError);
    problem = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "revision-allocation-unsafe",
      status: 409,
      retry: "after-state-change",
    };
    await expect(client.performHistory(exact)).rejects.toBeInstanceOf(BdpClientTransportError);
    problem = {
      ...fixture<Record<string, unknown>>("resource-erased"),
      hint: "ordinary extension",
    };
    expect(await client.performHistory(exact)).toEqual(problem);
    for (const field of ["pointer", "archivedAt"]) {
      problem = {
        ...fixture<Record<string, unknown>>("resource-erased"),
        [field]: "https://example.com/copy",
      };
      await expect(client.performHistory(exact)).rejects.toBeInstanceOf(BdpClientTransportError);
    }
  });

  it("does not restart expired cursors and preserves an available lease after remote refusal", async () => {
    const { client, transport, calls } = clientWith(() => page());
    await client.performHistory(versions);
    const perform = transport.perform.bind(transport);
    let attempts = 0;
    transport.perform = async <Body>(
      url: string,
      options: { scope: string; signal: AbortSignal },
    ): Promise<BdpTransportResult<Body>> => {
      if (url === page().next) {
        attempts++;
        return { kind: "problem", problem: readProblem("cursor-expired") };
      }
      return perform(url, options);
    };
    const continuation = { ...versions, continuation: page().next as string };
    expect(await client.performHistory(continuation)).toMatchObject({ code: "cursor-expired" });
    expect(await client.performHistory(continuation)).toMatchObject({ code: "cursor-expired" });
    expect(attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("rejects ambiguous independent traversals locally while keeping the first lease and distinct owners usable", async () => {
    const { client } = clientWith((url) => (url === page().next ? terminal() : page()));
    await client.performHistory(versions);
    await expect(client.performHistory(versions)).rejects.toThrow("distinct continuation scopes");
    const owner = client.createContinuationScope();
    expect(await client.performHistory(versions, { continuationScope: owner })).toEqual(page());
    expect(
      await client.performHistory({ ...versions, continuation: page().next as string }),
    ).toEqual(terminal());
    expect(
      await client.performHistory(
        { ...versions, continuation: page().next as string },
        { continuationScope: owner },
      ),
    ).toEqual(terminal());
  });

  it("forgets owned History cursors and invalidates History operations on close", async () => {
    const { client } = clientWith(() => page());
    const owner = client.createContinuationScope();
    await client.performHistory(versions, { continuationScope: owner });
    client.forgetContinuations(owner);
    await expect(
      client.performHistory(
        { ...versions, continuation: page().next as string },
        { continuationScope: owner },
      ),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    await client.close();
    await expect(client.performHistory(versions)).rejects.toBeInstanceOf(BdpClientClosedError);
  });

  it("abort after response inspection restores cursor and publishes no successor", async () => {
    const abort = new AbortController();
    const successor = `${id}?view=versions&cursor=three&limit=2`;
    let second = false;
    const { client } = clientWith((url) => {
      if (url !== page().next) return page();
      if (second) return terminal();
      second = true;
      return new Proxy(
        { ...terminal(), next: successor },
        {
          ownKeys(target) {
            abort.abort("during inspection");
            return Reflect.ownKeys(target);
          },
        },
      );
    });
    await client.performHistory(versions);
    await expect(
      client.performHistory(
        { ...versions, continuation: page().next as string },
        { signal: abort.signal },
      ),
    ).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    await expect(client.performHistory({ ...versions, continuation: successor })).rejects.toThrow(
      "not issued",
    );
    expect(
      await client.performHistory({ ...versions, continuation: page().next as string }),
    ).toEqual(terminal());
  });

  it("close joins a nonsettling custom History transport under the existing bound", async () => {
    let entered!: () => void;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { client } = clientWith(() => {
      entered();
      return new Promise(() => {});
    });
    const pending = client.performHistory(exact);
    const refused = expect(pending).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    await active;
    await client.close();
    await refused;
  });
  it.each(["bytes", "depth", "timeout"])(
    "bounds History Fetch %s failures without retention guesses",
    async (mode) => {
      const calls: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (mode === "timeout" && url.includes("revision="))
          return new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            }),
          );
        let deep: unknown = {};
        for (let i = 0; i < 30; i++) deep = { child: deep };
        const response =
          url === scope
            ? new Response(null, {
                status: 204,
                headers: { link: `<${scope}bdp.json>; rel="service-desc"` },
              })
            : new Response(
                JSON.stringify(
                  url === `${scope}bdp.json`
                    ? discovery()
                    : {
                        id,
                        type: "https://work.example/types/memory",
                        revision: "old",
                        properties: mode === "bytes" ? { text: "x".repeat(5000) } : deep,
                      },
                ),
                { headers: { "content-type": "application/json" } },
              );
        Object.defineProperty(response, "url", { value: url });
        return response;
      };
      const client = new BdpClient({
        scope,
        transport: createFetchTransport(fetcher, {
          maximumResponseBodyBytes: mode === "bytes" ? 1024 : 10000,
          maximumJsonDepth: 8,
          responseTimeoutMs: 20,
        }),
      });
      clients.push(client);
      expect(await client.performHistory(exact)).toMatchObject({ code: "temporarily-unavailable" });
      expect(calls).toHaveLength(3);
    },
  );

  it("snapshots returned records and does not retain caller-mutable bodies", async () => {
    const body = fixture<BeadRecord>("exact-bead");
    const { client } = clientWith(() => body);
    const result = await client.performHistory({ ...exact, revision: body.revision });
    const saved = structuredClone(result);
    (body.properties as Record<string, unknown>).later = "mutation";
    expect(result).toEqual(saved);
  });

  it("rejects a foreign client's owner before transport and abort before admission", async () => {
    const first = clientWith(() => page());
    const second = clientWith(() => page());
    await expect(
      first.client.performHistory(versions, {
        continuationScope: second.client.createContinuationScope(),
      }),
    ).rejects.toBeInstanceOf(BdpClientRequestError);
    await expect(
      first.client.performHistory(versions, { signal: AbortSignal.abort("before") }),
    ).rejects.toBeInstanceOf(BdpClientOperationAbortedError);
    expect(first.calls).toHaveLength(0);
  });
  it.each([0, -1, 1.5, NaN, 2 ** 53, "2", null])(
    "refuses invalid initial limit %j before transport",
    async (limit) => {
      const { client, calls } = clientWith(() => undefined);
      await expect(
        client.performHistory({ ...versions, limit } as HistoryRequest),
      ).rejects.toBeInstanceOf(BdpClientRequestError);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([2, undefined])(
    "refuses limit plus continuation before transport even for limit=%j",
    async (limit) => {
      const { client, calls } = clientWith(() => undefined);
      await expect(
        client.performHistory({
          ...versions,
          limit,
          continuation: page().next as string,
        } as unknown as HistoryRequest),
      ).rejects.toBeInstanceOf(BdpClientRequestError);
      expect(calls).toHaveLength(0);
    },
  );

  it("applies bound initial limit on each continuation and restores it after invalid pages", async () => {
    let response = page();
    const { client } = clientWith(() => response);
    await client.performHistory({ ...versions, limit: 2 });
    const nextRequest = { ...versions, continuation: page().next as string };
    const tooMany = {
      ...terminal(),
      items: [...terminal().items, { revision: "extra", lineage: "current", body: "complete" }],
    };
    for (const invalid of [
      tooMany,
      { ...terminal(), next: `${id}?view=versions&cursor=three` },
      { ...terminal(), next: `${id}?view=versions&cursor=three&limit=3` },
    ]) {
      response = invalid as HistoryVersionsPage;
      expect(await client.performHistory(nextRequest)).toMatchObject({
        code: "temporarily-unavailable",
      });
    }
    response = terminal();
    expect(await client.performHistory(nextRequest)).toEqual(response);
  });

  it.each([undefined, "3", "900719925474099312345678901234567890"])(
    "uses a server-added limit for this page without binding successor limit %j",
    async (laterLimit) => {
      let response = page();
      const { client } = clientWith(() => response);
      await client.performHistory(versions); // No caller-supplied limit; issued URL has2.
      const nextRequest = { ...versions, continuation: page().next as string };
      response = {
        ...terminal(),
        items: [...terminal().items, { revision: "extra", lineage: "current", body: "complete" }],
      };
      expect(await client.performHistory(nextRequest)).toMatchObject({
        code: "temporarily-unavailable",
      });
      const successor = `${id}?view=versions&cursor=three${laterLimit ? `&limit=${laterLimit}` : ""}`;
      response = { ...terminal(), next: successor };
      expect(await client.performHistory(nextRequest)).toEqual(response);
      response = terminal();
      expect(await client.performHistory({ ...versions, continuation: successor })).toEqual(
        response,
      );
    },
  );

  it.each(["versions-not-tracked", "versions-undetermined"])(
    "accepts schema-valid terminal continuation participation %s without inferring fence state",
    async (name) => {
      const final = fixture<HistoryVersionsPage>(name);
      const { client } = clientWith((url) => (url === page().next ? final : page()));
      await client.performHistory(versions);
      expect(
        await client.performHistory({ ...versions, continuation: page().next as string }),
      ).toEqual(final);
    },
  );

  it.each(["Read", "History"] as const)(
    "brands hostile public/internal getter errors for %s and restores cursor",
    async (mode) => {
      for (const spoof of [
        new BdpClientClosedError(),
        new ReadSessionLocalError("closed", "forged internal lifecycle"),
      ]) {
        let bad = true;
        const { client } = clientWith((url) => {
          if (url !== page().next)
            return mode === "Read" ? { items: [], next: page().next } : page();
          if (!bad) return mode === "Read" ? { items: [], next: null } : terminal();
          return Object.defineProperty(
            mode === "Read" ? { items: [], next: null } : terminal(),
            mode === "Read" ? "items" : "subject",
            {
              enumerable: true,
              get() {
                throw spoof;
              },
            },
          );
        });
        if (mode === "Read") await client.perform({ kind: "bead-links", bead: id });
        else await client.performHistory(versions);
        const invoke = () =>
          mode === "Read"
            ? client.perform({ kind: "bead-links", bead: id, continuation: page().next as string })
            : client.performHistory({ ...versions, continuation: page().next as string });
        const failed = invoke();
        await expect(failed).rejects.toBeInstanceOf(BdpClientTransportError);
        await expect(failed).rejects.toMatchObject({ cause: { cause: spoof } });
        bad = false;
        expect(await invoke()).toEqual(mode === "Read" ? { items: [], next: null } : terminal());
      }
    },
  );
});
