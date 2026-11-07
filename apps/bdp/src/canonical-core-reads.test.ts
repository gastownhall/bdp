/** The generic reads against a stub shaped like a Core Scope: `conformsTo` without Types1, the
 * optional `include=links` aggregate, and failures that say what happened. */
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBdp } from "./main.js";

const media = "application/vnd.bdp.v0.1+json";
const problemMedia = "application/problem+json";
const TASK = "https://github.com/gastownhall/bdp/types/issue/task";
const FAMILY = "https://github.com/gastownhall/bdp/types/issue/issue";
const BLOCKS = "https://github.com/gastownhall/bdp/types/dependency/blocks";

interface Seen {
  readonly url: URL;
  readonly accept: string | undefined;
}
async function withCore(
  run: (scope: string, seen: Seen[]) => Promise<void>,
  override?: (url: URL) => { status: number; body?: string; type?: string } | undefined,
): Promise<void> {
  const seen: Seen[] = [];
  let scope = "";
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", scope);
    seen.push({ url, accept: request.headers.accept });
    const link = { link: `<${scope}bdp>; rel="service-desc"; type="${media}"` };
    const replaced = override?.(url);
    if (replaced !== undefined) {
      response.writeHead(replaced.status, {
        ...(replaced.type === undefined ? {} : { "content-type": replaced.type }),
        ...link,
      });
      response.end(replaced.body);
      return;
    }
    const bead = {
      id: `${scope}sw-1`,
      type: TASK,
      revision: "r1",
      properties: { title: "one" },
      metadata: {},
    };
    if (url.pathname === "/") {
      response.writeHead(204, link);
      response.end();
    } else if (url.pathname === "/bdp") {
      if (!(request.headers.accept ?? "").includes(media)) {
        response.writeHead(406);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": media });
      response.end(
        JSON.stringify({
          bdpVersion: "0.1",
          profile: "core",
          scope,
          specRevision: "0123456789abcdef0123456789abcdef01234567",
          order: "canonical-uri",
          limits: {
            page: { defaultItems: 100, maximumItems: 1000 },
            selector: { bytes: 4096, depth: 32, nodes: 256 },
          },
          capabilities: {},
        }),
      );
    } else if (url.pathname === "/bdp/beads") {
      response.writeHead(200, {
        "content-type": media,
        "bdp-collection-kind": "bead",
        ...link,
      });
      response.end(JSON.stringify({ items: [bead], next: null }));
    } else if (url.pathname === "/sw-1") {
      const aggregate = url.searchParams.get("include") === "links";
      response.writeHead(200, {
        "content-type": media,
        "bdp-resource-kind": "bead",
        etag: '"e"',
        ...link,
      });
      response.end(
        JSON.stringify({
          ...bead,
          ...(aggregate
            ? {
                links: {
                  items: [
                    {
                      id: `${scope}dep-1`,
                      type: BLOCKS,
                      revision: "l1",
                      source: `${scope}sw-1`,
                      target: `${scope}sw-2`,
                      properties: {},
                      metadata: {},
                    },
                  ],
                  next: null,
                },
              }
            : {}),
        }),
      );
    } else {
      response.writeHead(404, { "content-type": problemMedia });
      response.end(
        JSON.stringify({
          type: "https://github.com/gastownhall/bdp/problems/not-found",
          status: 404,
          code: "resource-not-found",
          retry: "after-state-change",
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  scope = `http://127.0.0.1:${address.port}/`;
  try {
    await run(scope, seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

let home: string;
let stdout = "";
let stderr = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bdp-core-"));
  vi.stubEnv("XDG_CONFIG_HOME", home);
  vi.stubEnv("XDG_STATE_HOME", home);
  vi.stubEnv("BDP_CONFIG", undefined);
  vi.stubEnv("BDP_SCOPE_URL", undefined);
  stdout = "";
  stderr = "";
  const capture = (sink: (text: string) => void) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      sink(String(chunk));
      (rest.find((entry) => typeof entry === "function") as (() => void) | undefined)?.();
      return true;
    }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, "write").mockImplementation(
    capture((text) => {
      stdout += text;
    }),
  );
  vi.spyOn(process.stderr, "write").mockImplementation(
    capture((text) => {
      stderr += text;
    }),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});
const param = (seen: Seen[], path: string, name: string) =>
  seen.find(({ url }) => url.pathname === path)?.url.searchParams.get(name);

describe("list --type", () => {
  it("sends conformsTo without Types1, leaving interpretation to the service (Issue §8)", async () => {
    await withCore(async (scope, seen) => {
      await expect(runBdp(["--scope", scope, "list", "--type", FAMILY])).resolves.toBe(0);
      expect(param(seen, "/bdp/beads", "conformsTo")).toBe(FAMILY);
      expect(param(seen, "/bdp/beads", "type")).toBeNull();
    });
  });
  it("applies no filter for any, and keeps --exact-type as type", async () => {
    await withCore(async (scope, seen) => {
      await expect(runBdp(["--scope", scope, "list", "--type", "any"])).resolves.toBe(0);
      expect(param(seen, "/bdp/beads", "conformsTo")).toBeNull();
      seen.length = 0;
      await expect(runBdp(["--scope", scope, "list", "--exact-type", TASK])).resolves.toBe(0);
      expect(param(seen, "/bdp/beads", "type")).toBe(TASK);
    });
  });
  it("shows the service's refusal, never falling back to exact matching", async () => {
    const refusal = {
      type: "https://github.com/gastownhall/bdp/problems/request",
      status: 400,
      code: "invalid-parameter",
      retry: "never",
      detail: "`conformsTo` names a Type outside this Scope's fixed catalog",
    };
    await withCore(
      async (scope) => {
        await expect(
          runBdp(["--scope", scope, "list", "--type", "https://example.test/types/none"]),
        ).resolves.toBe(1);
        expect(JSON.parse(stderr).error).toEqual({ origin: "bdp", problem: refusal });
      },
      (url) =>
        url.pathname === "/bdp/beads"
          ? { status: 400, body: JSON.stringify(refusal), type: problemMedia }
          : undefined,
    );
  });
});

describe("show --include-links", () => {
  it("requests the aggregate with direction and limit, and shows the Links", async () => {
    await withCore(async (scope, seen) => {
      await expect(
        runBdp([
          "--scope",
          scope,
          "show",
          "sw-1",
          "--include-links",
          "--direction",
          "in",
          "--links-limit",
          "1",
        ]),
      ).resolves.toBe(0);
      expect(param(seen, "/sw-1", "include")).toBe("links");
      expect(param(seen, "/sw-1", "direction")).toBe("inbound");
      expect(param(seen, "/sw-1", "limit")).toBe("1");
      expect(stdout).toContain("Links:");
      expect(stdout).toContain("dep-1");
    });
  });
  it("requests no direction or limit unless asked, and keeps links in the JSON envelope", async () => {
    await withCore(async (scope, seen) => {
      await expect(
        runBdp(["--scope", scope, "--output-mode", "json", "show", "sw-1", "--include-links"]),
      ).resolves.toBe(0);
      expect(param(seen, "/sw-1", "direction")).toBeNull();
      expect(JSON.parse(stdout).data.links.items).toHaveLength(1);
    });
  });
  it("refuses a historical read before any request", async () => {
    await withCore(async (scope, seen) => {
      await expect(runBdp(["--scope", scope, "show", "sw-1@=r1", "--include-links"])).resolves.toBe(
        2,
      );
      expect(seen).toEqual([]);
    });
  });
});

describe("the legacy read path against a Core Scope", () => {
  it("versions says the Scope advertises no History", async () => {
    await withCore(async (scope) => {
      await expect(runBdp(["--scope", scope, "versions", "sw-1"])).resolves.toBe(5);
      expect(JSON.parse(stderr).error.problem).toMatchObject({
        code: "unsupported_capability",
        message: expect.stringContaining("does not advertise History"),
      });
    });
  });
  it("bd ready sends the BDP media type, and says it cannot read that discovery", async () => {
    await withCore(async (scope, seen) => {
      await expect(runBdp(["--scope", scope, "bd", "ready", "--json"])).resolves.toBe(1);
      const discovery = seen.find(({ url }) => url.pathname === "/bdp");
      expect(discovery?.accept).toContain(media);
      expect(JSON.parse(stdout).error.problem.detail).toContain("discovery metadata");
    });
  });
});

describe("a generic read failure says what happened", () => {
  it.each([
    [
      "an HTML answer on a read",
      { status: 200, body: "<html>private</html>", type: "text/html" },
      "/sw-1",
      "HTTP 200 (text/html)",
    ],
    ["a bodyless 406", { status: 406 }, "/bdp", "with no Problem body"],
  ] as const)("%s", async (_label, answer, path, expected) => {
    await withCore(
      async (scope) => {
        await expect(runBdp(["--scope", scope, "show", "sw-1"])).resolves.toBe(1);
        const { message } = JSON.parse(stderr).error.problem;
        expect(message).toContain(expected);
        expect(message).not.toContain("private");
        expect(message).not.toBe("BDP delivery failed");
      },
      (url) => (url.pathname === path ? answer : undefined),
    );
  });
  it("a bodyless 404 at the landing of a list", async () => {
    await withCore(
      async (scope) => {
        await expect(runBdp(["--scope", scope, "list"])).resolves.toBe(1);
        expect(JSON.parse(stderr).error.problem.message).toContain("HTTP 404");
      },
      (url) => (url.pathname === "/" ? { status: 404 } : undefined),
    );
  });
  it("no service listening at all", async () => {
    await expect(runBdp(["--scope", "http://127.0.0.1:9/", "list"])).resolves.toBe(1);
    expect(JSON.parse(stderr).error.problem.message).toContain("could not connect");
  });
});
