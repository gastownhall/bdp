/** Donna's manual pass of 2026-11-07 against Build 4, row by row, against a stub Scope:
 * `bdp connect`, unknown commands, the Scope a failure involved, JSON as data with the envelope
 * on request, the server's own discovery, short Type names, the `show` head, the batch refusal,
 * the create help and an unfilled `since`. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBdp } from "./main.js";

const media = "application/vnd.bdp.v0.1+json";
const problemMedia = "application/problem+json";
const TASK = "https://github.com/gastownhall/bdp/types/issue/task";
const FAMILY = "https://github.com/gastownhall/bdp/types/issue/issue";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const CALLABLES = "https://github.com/gastownhall/bdp/capabilities/callables";
const ATOMIC_BATCH = "https://github.com/gastownhall/bdp/capabilities/atomic-batch";

interface Seen {
  readonly method: string;
  readonly url: URL;
  readonly body: string;
}
interface Stub {
  readonly capabilities?: Record<string, unknown> | ((scope: string) => Record<string, unknown>);
  readonly answer?: (url: URL) => { status: number; body?: unknown } | undefined;
  /** Members that replace the stub's own in its discovery document. */
  readonly discovery?: (scope: string) => Record<string, unknown>;
}
async function withScope(run: (scope: string, seen: Seen[]) => Promise<void>, stub: Stub = {}) {
  const seen: Seen[] = [];
  let scope = "";
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", scope);
      seen.push({ method: request.method ?? "", url, body: Buffer.concat(chunks).toString() });
      const link = { link: `<${scope}bdp>; rel="service-desc"; type="${media}"` };
      const json = (status: number, body: unknown, type = media) => {
        response.writeHead(status, { "content-type": type, ...link });
        response.end(JSON.stringify(body));
      };
      const replaced = stub.answer?.(url);
      if (replaced !== undefined) return json(replaced.status, replaced.body, problemMedia);
      if (url.pathname === "/") {
        response.writeHead(204, link);
        response.end();
      } else if (url.pathname === "/bdp")
        json(200, {
          bdpVersion: "0.1",
          profile: "core",
          scope,
          specRevision: REVISION,
          order: "canonical-uri",
          capabilities:
            typeof stub.capabilities === "function"
              ? stub.capabilities(scope)
              : (stub.capabilities ?? {}),
          ...stub.discovery?.(scope),
        });
      else if (url.pathname === "/bdp/beads") {
        response.writeHead(200, { "content-type": media, "bdp-collection-kind": "bead", ...link });
        response.end(JSON.stringify({ items: [bead(scope)], next: null }));
      } else if (url.pathname === "/sw-1") {
        response.writeHead(200, { "content-type": media, "bdp-resource-kind": "bead", ...link });
        response.end(JSON.stringify(bead(scope)));
      } else
        json(
          404,
          {
            type: "https://github.com/gastownhall/bdp/problems/not-found",
            status: 404,
            code: "resource-not-found",
            retry: "after-state-change",
          },
          problemMedia,
        );
    });
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
const bead = (scope: string) => ({
  id: `${scope}sw-1`,
  type: TASK,
  revision: "r1",
  properties: { title: "one", status: "open", priority: 2 },
  metadata: {},
});

let home: string;
let configPath: string;
let stdout = "";
let stderr = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bdp-manual-pass-"));
  configPath = join(home, "bdp", "config.json");
  vi.stubEnv("XDG_CONFIG_HOME", home);
  vi.stubEnv("XDG_STATE_HOME", home);
  vi.stubEnv("BDP_CONFIG", undefined);
  vi.stubEnv("BDP_SCOPE_URL", undefined);
  vi.stubEnv("BDP_AUTH_TOKEN", undefined);
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
const reset = () => {
  stdout = "";
  stderr = "";
};
const stored = async () => JSON.parse(await readFile(configPath, "utf8"));

describe("row 1: bdp connect", () => {
  it("reads the Scope's discovery, then stores it; alone it shows the Scope and its source", async () => {
    await withScope(async (scope, seen) => {
      await expect(runBdp(["connect", scope.slice(0, -1)])).resolves.toBe(0);
      expect(seen.some(({ url }) => url.pathname === "/bdp")).toBe(true);
      expect(stdout).toBe(
        `Connected to ${scope} (BDP 0.1, core profile).\nStored in ${configPath}.\n`,
      );
      expect(await stored()).toEqual({ scope: { url: scope } });

      reset();
      await expect(runBdp(["connect"])).resolves.toBe(0);
      expect(stdout).toBe(`Scope: ${scope} (from config file ${configPath})\n`);

      reset();
      vi.stubEnv("BDP_SCOPE_URL", "https://env.example/work/");
      await expect(runBdp(["connect"])).resolves.toBe(0);
      expect(stdout).toBe(
        `Scope: https://env.example/work/ (from BDP_SCOPE_URL)\nStored: ${scope} (from config file ${configPath}), not used\n`,
      );

      reset();
      await expect(
        runBdp(["--scope", "https://flag.example/work/", "--output-mode", "json", "connect"]),
      ).resolves.toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        scope: "https://flag.example/work/",
        source: "--scope",
        stored: { scope, source: `config file ${configPath}` },
      });
    });
  });

  it("stores nothing when discovery fails", async () => {
    await expect(runBdp(["connect", "http://127.0.0.1:9/"])).resolves.toBe(1);
    expect(JSON.parse(stderr).message).toMatch(
      /^BDP discovery of http:\/\/127\.0\.0\.1:9\/ failed: could not connect.*; nothing was stored$/,
    );
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("forgets the stored Scope with --clear, keeping the rest of the configuration", async () => {
    await withScope(async (scope) => {
      await expect(runBdp(["connect", scope])).resolves.toBe(0);
      const config = await stored();
      await writeFile(configPath, JSON.stringify({ ...config, auth: { token: "t" } }), "utf8");
      reset();
      await expect(runBdp(["connect", "--clear"])).resolves.toBe(0);
      expect(stdout).toBe(`Forgot the stored Scope in ${configPath}.\n`);
      expect(await stored()).toEqual({ auth: { token: "t" } });
      reset();
      await expect(runBdp(["connect", "--clear"])).resolves.toBe(0);
      expect(stdout).toBe(`No Scope was stored in ${configPath}.\n`);
      reset();
      await expect(runBdp(["connect"])).resolves.toBe(0);
      expect(stdout).toBe("No Scope is set; connect one with bdp connect URL.\n");
      reset();
      await expect(runBdp(["connect", "--clear", scope])).resolves.toBe(2);
      expect(stderr).toContain("connect --clear takes no URL");
    });
  });
});

describe("row 2: unknown and incomplete commands", () => {
  it("names the word, suggests the nearest command, and prints a bare group's help", async () => {
    await expect(runBdp(["scope", "status"])).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toBe(
      "unknown command 'status' for 'bdp scope'; its commands are set, inspect; run 'bdp scope --help' for usage",
    );
    reset();
    await expect(runBdp(["scope", "inspcet"])).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toContain("did you mean 'bdp scope inspect'?");
    reset();
    await expect(runBdp(["lnk", "show", "x"])).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toContain(
      "unknown command 'lnk' for 'bdp'; did you mean 'bdp link'?",
    );
    reset();
    await expect(runBdp(["scope"])).resolves.toBe(0);
    expect(stdout).toContain("Usage: bdp scope");
    expect(stdout).toMatch(/^ {2}inspect /m);
    expect(stderr).toBe("");
    reset();
    await expect(runBdp(["link"])).resolves.toBe(0);
    expect(stdout).toContain("Usage: bdp link");
  });

  it("says what an incomplete command needs, without repeating a value", async () => {
    await expect(runBdp(["show"])).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toBe(
      "'bdp show' needs <ref>; run 'bdp show --help' for usage",
    );
    reset();
    await expect(runBdp(["--scope", "https://a.example/w/", "create"])).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toBe(
      "--type is required for creation; run 'bdp create --help' for usage",
    );
    reset();
    await expect(runBdp(["show", "x", "--output-format", "secret-value"])).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toContain("--output-format takes one of:");
    expect(stderr).not.toContain("secret-value");
  });
});

describe("row 3: a failure names the Scope it involved and where it came from", () => {
  it("names a stored Scope's config file, and bdp connect when there is none", async () => {
    await expect(runBdp(["list"])).resolves.toBe(2);
    expect(stderr).toContain("no Scope is selected: connect one with bdp connect URL");
    expect(stderr).not.toContain("Scope: ");
    reset();
    await withScope(async (scope) => {
      await expect(runBdp(["connect", scope])).resolves.toBe(0);
      reset();
      await expect(runBdp(["show", "missing"])).resolves.toBe(3);
      expect(stderr).toBe(
        `error: resource-not-found\n  Scope: ${scope} (from config file ${configPath})\n`,
      );
      reset();
      await expect(runBdp(["--output-mode", "json", "show", "missing"])).resolves.toBe(3);
      expect(JSON.parse(stderr).scope).toEqual({
        url: scope,
        source: `config file ${configPath}`,
      });
    });
  });
});

describe("row 4: JSON is the data, and the envelope is opt-in with --response-context", () => {
  it("prints the Resource alone, or the envelope with the discovery triple once", async () => {
    await withScope(async (scope) => {
      await expect(
        runBdp(["--scope", scope, "--output-mode", "json", "show", "sw-1"]),
      ).resolves.toBe(0);
      expect(JSON.parse(stdout)).toEqual(bead(scope));
      reset();
      await expect(
        runBdp(["--scope", scope, "--output-mode", "json", "--response-context", "show", "sw-1"]),
      ).resolves.toBe(0);
      const envelope = JSON.parse(stdout);
      expect(Object.keys(envelope).slice(0, 4)).toEqual([
        "schema_version",
        "bdp_spec",
        "bdpVersion",
        "specRevision",
      ]);
      expect(envelope).toMatchObject({
        bdp_spec: "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json",
        bdpVersion: "0.1",
        specRevision: REVISION,
        result_kind: "resource",
        data: bead(scope),
      });
      reset();
      await expect(
        runBdp(["--scope", scope, "--output-mode", "json", "list", "--output-format", "jsonl"]),
      ).resolves.toBe(0);
      expect(stdout).toBe(`${JSON.stringify(bead(scope))}\n`);
    });
  });

  it("retires --omit envelope with a refusal that says why, wherever it is given", async () => {
    await expect(
      runBdp(["--scope", "https://a.example/w/", "show", "x", "--omit", "envelope"]),
    ).resolves.toBe(2);
    expect(stderr).toContain("--omit envelope is retired");
    reset();
    await expect(
      runBdp(["--scope", "https://a.example/w/", "scope", "inspect", "--omit", "envelope"]),
    ).resolves.toBe(2);
    expect(JSON.parse(stderr).message).toContain("--omit envelope is retired");
  });
});

describe("row 5: scope inspect prints the server's discovery as it was sent", () => {
  it("adds no beads or links member", async () => {
    await withScope(async (scope) => {
      await expect(
        runBdp(["--scope", scope, "--output-mode", "json", "scope", "inspect"]),
      ).resolves.toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        bdpVersion: "0.1",
        profile: "core",
        scope,
        specRevision: REVISION,
        order: "canonical-uri",
        capabilities: {},
      });
      reset();
      await expect(runBdp(["--scope", scope, "scope", "inspect"])).resolves.toBe(0);
      expect(stdout).not.toContain("inventory");
    });
  });
});

describe("rows 14, 15 and 18: short Type names, and the show head", () => {
  it("shows ID, Type, Title, Revision, then properties; and reads short Type names", async () => {
    await withScope(async (scope, seen) => {
      await expect(runBdp(["--scope", scope, "show", "sw-1"])).resolves.toBe(0);
      expect(stdout).toBe(
        "ID: sw-1\nType: issue/task\nTitle: one\nRevision: r1\nstatus: open\npriority: 2\n",
      );
      reset();
      await expect(runBdp(["--scope", scope, "list"])).resolves.toBe(0);
      expect(stdout).toMatch(/^sw-1 +issue\/task +one/m);
      reset();
      await expect(runBdp(["--scope", scope, "list", "--long"])).resolves.toBe(0);
      expect(stdout).toContain(TASK);
      seen.length = 0;
      await expect(
        runBdp(["--scope", scope, "list", "--type", "issue/issue", "--exact-type", "issue/task"]),
      ).resolves.toBe(0);
      const listed = seen.find(({ url }) => url.pathname === "/bdp/beads")?.url.searchParams;
      expect(listed?.get("conformsTo")).toBe(FAMILY);
      expect(listed?.get("type")).toBe(TASK);
      // A name BDP does not publish reads against the Scope's own types/.
      seen.length = 0;
      await expect(
        runBdp(["--scope", scope, "list", "--exact-type", "issue/research"]),
      ).resolves.toBe(0);
      expect(
        seen.find(({ url }) => url.pathname === "/bdp/beads")?.url.searchParams.get("type"),
      ).toBe(`${scope}types/issue/research`);
    });
  });
});

describe("row 20: create says who decides required properties, and a refusal lists them", () => {
  it("help points at the Scope and the Type; a refusal shows each of the provider's diagnostics", async () => {
    await expect(runBdp(["create", "--help"])).resolves.toBe(0);
    expect(stdout).toContain("issue/task");
    expect(stdout).toContain("decide which properties are required");
    expect(stdout).toContain("omit --id to let the Scope allocate one");
    reset();
    const refusal = {
      type: "https://github.com/gastownhall/bdp/problems/validation",
      status: 422,
      code: "validation-failed",
      retry: "never",
      detail: "`title` is required",
      diagnostics: [{ message: "`title` is required" }, { message: "`status` is required" }],
    };
    await withScope(
      async (scope) => {
        await expect(runBdp(["--scope", scope, "list"])).resolves.toBe(1);
        expect(stderr).toBe(
          `error: validation-failed: \`title\` is required\n  \`status\` is required\n  Scope: ${scope} (from --scope)\n`,
        );
      },
      {
        answer: (url) =>
          url.pathname === "/bdp/beads" ? { status: 422, body: refusal } : undefined,
      },
    );
  });
});

describe("row 25: the batch refusal says what is missing", () => {
  it.each([
    [false, "does not advertise atomic batches (atomic-batch1); nothing was sent"],
    [true, "advertises atomic batches, but this client does not send them yet; nothing was sent"],
  ] as const)("advertised=%s", async (advertised, expected) => {
    await withScope(
      async (scope) => {
        await expect(runBdp(["--scope", scope, "batch", "--file", "-"])).resolves.toBe(5);
        expect(stderr).toContain(`${scope} ${expected}`);
        expect(stderr).not.toContain("not yet received");
      },
      {
        capabilities: (scope) =>
          advertised
            ? {
                [ATOMIC_BATCH]: {
                  "1": { operation: `${scope}bdp/batch`, operations: ["createBead"] },
                },
              }
            : {},
        discovery: (scope) =>
          advertised ? { profile: "write", operations: `${scope}bdp/operations` } : {},
      },
    );
  });
});

describe("row 27: events list fills in no since", () => {
  it("sends the arguments as given, leaving a required since to the declaration's service", async () => {
    await withScope(
      async (scope, seen) => {
        await expect(runBdp(["--scope", scope, "events", "list"])).resolves.toBe(1);
        const post = seen.find(({ method }) => method === "POST");
        expect(post?.url.pathname).toBe("/bdp/call/events/list");
        expect(JSON.parse(post?.body ?? "{}").arguments).toEqual({});
        expect(stderr).toContain("use 0 to read from the beginning");
      },
      {
        capabilities: { [CALLABLES]: { "1": {} } },
        answer: (url) =>
          url.pathname === "/bdp/call/events/list"
            ? {
                status: 422,
                body: {
                  type: "https://github.com/gastownhall/bdp/problems/validation",
                  status: 422,
                  title: "Unprocessable Entity",
                  code: "validation-failed",
                  retry: "never",
                  detail: "since is required; use 0 to read from the beginning",
                  diagnostics: [
                    {
                      message: "since is required; use 0 to read from the beginning",
                      instanceLocation: "/arguments/since",
                    },
                  ],
                },
              }
            : undefined,
      },
    );
  });
});
