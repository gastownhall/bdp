import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueCallableCatalog } from "@bdp/bd-domain";
import {
  CALLABLE_BATCH_TYPE,
  CALLABLE_QUERY_TYPE,
  type CallableCatalog,
  type CallableDeclaration,
  createStaticCallableCatalog,
} from "@bdp/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CallableUsageError,
  callableFlagCollisions,
  parameterFlag,
  parseCallableArguments,
  renderCallableHelp,
} from "./canonical-call.js";
import { createCanonicalCommand, splitCallArguments } from "./canonical-command.js";
import { runBdp } from "./main.js";

const media = "application/vnd.bdp.v0.1+json";
const problemMedia = "application/problem+json";
const CALLABLES = "https://github.com/gastownhall/bdp/capabilities/callables";
const IDEMPOTENCY = "https://github.com/gastownhall/bdp/capabilities/idempotency";
const problems = "https://github.com/gastownhall/bdp/problems";

/** The worked example of Callables §2.5, which carries a cliMapping. */
const reserveRoom: CallableDeclaration = {
  name: "reserve-room",
  type: CALLABLE_BATCH_TYPE,
  title: "Reserve a room",
  description: "Reserve a room for one day.",
  idempotent: true,
  atomic: true,
  parameters: [
    {
      name: "room",
      schema: { type: "string", minLength: 1 },
      required: true,
      description: "The room to reserve.",
    },
    { name: "day", schema: { type: "string", format: "date" }, required: true },
  ],
  errorSchema: {
    oneOf: [
      {
        type: "object",
        description: "Someone else holds it.",
        properties: { reason: { const: "room-taken" }, holder: { type: "string" } },
        required: ["reason", "holder"],
      },
      { $ref: "#/$defs/closed" },
    ],
    $defs: { closed: { type: "object", properties: { reason: { const: "room-closed" } } } },
  },
  cliMapping: {
    positionals: [{ position: 0, parameter: "room" }],
    flags: [{ names: ["-d", "--date"], parameter: "day" }],
  },
};
const shapes: CallableDeclaration = {
  name: "shapes",
  type: CALLABLE_QUERY_TYPE,
  description: "Every value shape §10 names.",
  parameters: [
    { name: "plainText", schema: { type: "string" } },
    { name: "count_limit", schema: { type: "integer" }, default: 3, description: "How many." },
    { name: "dry-run", schema: { type: "boolean" }, default: false },
    { name: "label", schema: { type: "array", items: { type: "string" } } },
    { name: "edge", schema: { type: "array", items: { type: "object" } } },
    { name: "locator", schema: { $ref: "#/$defs/l", $defs: { l: { type: "string" } } } },
    { name: "picked", schema: { enum: ["a", "b"] } },
    { name: "anything", schema: {} },
  ],
};
const testCatalog = createStaticCallableCatalog(() => [reserveRoom, shapes]);

interface Exchange {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}
interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly contentType?: string;
}
const success = (body: unknown): Answer => ({ status: 200, body });

async function withScope(
  options: { idempotency?: boolean; callables?: boolean; answer: Answer },
  run: (scope: string, posts: Exchange[]) => Promise<void>,
): Promise<void> {
  const posts: Exchange[] = [];
  let scope = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", scope).href;
      if (request.method === "POST") {
        posts.push({
          method: "POST",
          url,
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        const { status, body, contentType } = options.answer;
        response.writeHead(status, {
          "content-type": contentType ?? (status === 200 ? media : problemMedia),
          "cache-control": "private, no-store",
        });
        response.end(typeof body === "string" ? body : JSON.stringify(body));
      } else if (url === scope) {
        response.writeHead(204, {
          link: `<${scope}bdp/discovery>; rel="service-desc"; type="${media}"`,
        });
        response.end();
      } else if (url === `${scope}bdp/discovery`) {
        response.writeHead(200, { "content-type": media });
        response.end(
          JSON.stringify({
            bdpVersion: "0.1",
            profile: "write",
            scope,
            specRevision: "0123456789abcdef0123456789abcdef01234567",
            operations: `${scope}bdp/write`,
            capabilities: {
              ...(options.callables === false ? {} : { [CALLABLES]: { "1": {} } }),
              ...(options.idempotency ? { [IDEMPOTENCY]: { "1": {} } } : {}),
            },
          }),
        );
      } else {
        response.writeHead(404);
        response.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  scope = `http://127.0.0.1:${address.port}/local-test/`;
  try {
    await run(scope, posts);
  } finally {
    await close(server);
  }
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

let home: string;
let stdout = "";
let stderr = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bdp-call-"));
  vi.stubEnv("XDG_CONFIG_HOME", home);
  vi.stubEnv("XDG_STATE_HOME", home);
  vi.stubEnv("BDP_CONFIG", undefined);
  vi.stubEnv("BDP_SCOPE_URL", undefined);
  stdout = "";
  stderr = "";
  const capture = (sink: (text: string) => void) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      sink(String(chunk));
      const callback = rest.find((entry) => typeof entry === "function") as
        | (() => void)
        | undefined;
      callback?.();
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
const bdp = (args: string[], callableCatalog: CallableCatalog = issueCallableCatalog()) =>
  runBdp(args, { callableCatalog });
const usage = (declaration: CallableDeclaration, tokens: string[], message: RegExp) => {
  expect(() => parseCallableArguments(declaration, tokens)).toThrow(CallableUsageError);
  expect(() => parseCallableArguments(declaration, tokens)).toThrow(message);
};
const argumentsOf = (declaration: CallableDeclaration, tokens: string[]) => {
  const parsed = parseCallableArguments(declaration, tokens);
  if (parsed.help) throw new Error("expected arguments");
  return parsed.arguments;
};

describe("the §10 flag derivation", () => {
  it.each([
    ["room", "--room"],
    ["max_depth", "--max-depth"],
    ["maxDepth", "--max-depth"],
    ["max-depth", "--max-depth"],
    ["has_metadata_key", "--has-metadata-key"],
    ["olderThanSeconds", "--older-than-seconds"],
  ])("spells %s as %s", (name, flag) => {
    expect(parameterFlag(name)).toBe(flag);
  });

  it("reads each value shape as its schema says", () => {
    expect(
      argumentsOf(shapes, [
        "--plain-text",
        "12",
        "--count-limit",
        "12",
        "--dry-run",
        "--label",
        "a",
        "--label",
        "1",
        "--edge",
        '{"to":"x"}',
        "--edge={}",
        "--locator",
        "bd-1",
        "--picked=a",
        "--anything",
        "null",
      ]),
    ).toEqual({
      plainText: "12",
      count_limit: 12,
      "dry-run": true,
      label: ["a", "1"],
      edge: [{ to: "x" }, {}],
      locator: "bd-1",
      picked: "a",
      anything: null,
    });
    expect(argumentsOf(shapes, ["--no-dry-run"])).toEqual({ "dry-run": false });
    expect(argumentsOf(shapes, [])).toEqual({});
  });

  it("lets explicit flags override --arguments members, keeping the rest and null", () => {
    expect(
      argumentsOf(shapes, [
        "--arguments",
        '{"plainText":"old","anything":null,"label":["x"],"undeclared":1}',
        "--plain-text",
        "new",
        "--label",
        "y",
      ]),
    ).toEqual({ plainText: "new", anything: null, label: ["y"], undeclared: 1 });
  });

  it("adds cliMapping spellings and positionals without taking the derived flag away", () => {
    expect(argumentsOf(reserveRoom, ["cedar", "--day", "2026-11-20"])).toEqual({
      room: "cedar",
      day: "2026-11-20",
    });
    expect(argumentsOf(reserveRoom, ["--room", "cedar", "-d", "2026-11-20"])).toEqual({
      room: "cedar",
      day: "2026-11-20",
    });
    expect(argumentsOf(reserveRoom, ["--date=2026-11-20", "--", "-odd-room"])).toEqual({
      room: "-odd-room",
      day: "2026-11-20",
    });
  });

  it.each<[string, CallableDeclaration, string[], RegExp]>([
    ["an unknown flag", shapes, ["--nope"], /not a parameter of this Callable/],
    ["a repeated flag", shapes, ["--picked", "a", "--picked", "b"], /only once/],
    ["both boolean forms", shapes, ["--dry-run", "--no-dry-run"], /only once/],
    ["a value on a boolean", shapes, ["--dry-run=true"], /takes no value/],
    ["a missing value", shapes, ["--picked"], /requires a value/],
    ["a flag for a value", shapes, ["--picked", "--dry-run"], /requires a value/],
    ["bad JSON", shapes, ["--count-limit", "many"], /--count-limit requires a JSON value/],
    ["--arguments twice", shapes, ["--arguments", "{}", "--arguments", "{}"], /only once/],
    ["non-object --arguments", shapes, ["--arguments", "[]"], /JSON object/],
    ["an operand with no position", shapes, ["stray"], /1 unmapped operand/],
    ["a position and its flag", reserveRoom, ["cedar", "--room", "elm"], /only once/],
  ])("refuses %s", (_label, declaration, tokens, message) => {
    usage(declaration, tokens, message);
  });

  it("never echoes a refused value, which may be a mistyped credential", () => {
    expect(() => parseCallableArguments(shapes, ["--sekret=hunter2"])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2") }),
    );
  });

  it("points client options after NAME back before it", () => {
    usage(reserveRoom, ["cedar", "--actor", "sam"], /client option; put --actor before NAME/);
    usage(reserveRoom, ["--scope", "x"], /client option; put --scope before NAME/);
  });

  it("names every client flag a call accepts, so the hint cannot drift from the tree", () => {
    const root = createCanonicalCommand({
      version: "test",
      profile: "canonical",
      onInvocation: () => undefined,
    });
    const call = root.commands.find((command) => command.name() === "call");
    const longFlags = [...root.options, ...(call?.options ?? [])].flatMap(({ long }) =>
      long === undefined || long === "--version" ? [] : [long],
    );
    expect(longFlags).toContain("--actor");
    for (const flag of longFlags) usage(reserveRoom, [flag], /client option/);
  });

  it("reports what a declaration's flags collide with", () => {
    expect(callableFlagCollisions(reserveRoom)).toEqual([]);
    const clash: CallableDeclaration = {
      ...shapes,
      parameters: [
        { name: "pinned", schema: { type: "boolean" } },
        { name: "no_pinned", schema: { type: "boolean" } },
        { name: "arguments", schema: { type: "string" } },
        { name: "help", schema: { type: "boolean" } },
        { name: "a_b", schema: { type: "string" } },
        { name: "aB", schema: { type: "string" } },
      ],
    };
    expect([...callableFlagCollisions(clash)].sort()).toEqual([
      "--a-b",
      "--arguments",
      "--help",
      "--no-pinned",
    ]);
    // A parameter's own positive spelling beats another's negation; a tie is unusable.
    expect(argumentsOf(clash, ["--no-pinned"])).toEqual({ no_pinned: true });
    usage(clash, ["--a-b", "x"], /more than one parameter/);
  });

  it("pins the one collision the Issue document's declarations contain", async () => {
    const collisions = (await issueCallableCatalog().list()).flatMap((declaration) =>
      callableFlagCollisions(declaration).map((flag) => `${declaration.name} ${flag}`),
    );
    expect(collisions).toEqual(["issue/list --no-pinned"]);
  });

  it("derives a usable form for every parameter of every Issue declaration", async () => {
    for (const declaration of await issueCallableCatalog().list())
      expect(renderCallableHelp(declaration)).toContain(declaration.description);
  });
});

describe("splitting the command line at NAME", () => {
  const arities = new Map([
    ["--scope", true],
    ["--actor", true],
    ["--output-mode", true],
    ["--long", false],
  ]);
  it.each<[string[], string[] | undefined, string[]]>([
    [["call", "n", "--x"], [], ["n", "--x"]],
    [["--scope", "s", "call", "n"], ["--scope", "s"], ["n"]],
    [
      ["--scope=s", "--long", "call", "--actor", "a", "n", "--scope", "t"],
      ["--scope=s", "--long", "--actor", "a"],
      ["n", "--scope", "t"],
    ],
    [["call"], [], []],
    [["call", "--help"], ["--help"], []],
  ])("%j", (args, client, operands) => {
    expect(splitCallArguments(args, arities)).toEqual({ client, operands });
  });
  it.each([[["show", "call"]], [["--scope", "call", "show"]], [["--"]], [[]]])(
    "leaves %j alone",
    (args) => {
      expect(splitCallArguments(args, arities)).toBeUndefined();
    },
  );
});

describe("bdp call against a stub server", () => {
  it("omits what is omitted and sends a defaulted flag only when given (query)", async () => {
    await withScope(
      { answer: success({ result: { items: [], has_more: false } }) },
      async (scope, posts) => {
        await expect(bdp(["--scope", scope, "call", "issue/ready"])).resolves.toBe(0);
        await expect(
          bdp(["--scope", scope, "call", "issue/ready", "--no-brief", "--limit", "5"]),
        ).resolves.toBe(0);
        expect(posts.map(({ url }) => url)).toEqual([
          `${scope}bdp/call/issue/ready`,
          `${scope}bdp/call/issue/ready`,
        ]);
        expect(posts.map(({ body }) => body)).toEqual([
          { arguments: {} },
          { arguments: { brief: false, limit: 5 } },
        ]);
        expect(posts[0]?.headers["content-type"]).toBe(media);
        expect(posts[0]?.headers).not.toHaveProperty("idempotency-key");
        expect(JSON.parse(stdout.slice(0, stdout.indexOf("\n}\n") + 2))).toEqual({
          result: { items: [], has_more: false },
        });
        expect(stderr).toBe("");
      },
    );
  });

  it("merges --arguments with an overriding flag and attributes the batch", async () => {
    await withScope(
      { answer: success({ result: { closed: true }, changed: true }), idempotency: true },
      async (scope, posts) => {
        const status = await bdp([
          "--scope",
          scope,
          "--output-mode",
          "json",
          "--actor",
          "sam",
          "call",
          "issue/close",
          "--arguments",
          '{"id":"bd-1","reason":"old","expected_revision":null}',
          "--reason",
          "new",
        ]);
        expect(stderr).toBe("");
        expect(status).toBe(0);
        expect(posts).toHaveLength(1);
        expect(posts[0]?.url).toBe(`${scope}bdp/call/issue/close`);
        expect(posts[0]?.body).toEqual({
          arguments: { id: "bd-1", reason: "new", expected_revision: null },
          revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
        });
        expect(posts[0]?.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        expect(JSON.parse(stdout)).toMatchObject({
          schema_version: 2,
          result_kind: "callable_result",
          outcome: "success",
          data: { result: { closed: true }, changed: true },
        });
      },
    );
  });

  it("sends no key to a Scope without idempotency, and refuses a supplied one", async () => {
    await withScope({ answer: success({ result: 1, changed: false }) }, async (scope, posts) => {
      await expect(bdp(["--scope", scope, "call", "issue/reopen", "--id", "a"])).resolves.toBe(0);
      expect(posts[0]?.headers).not.toHaveProperty("idempotency-key");
      await expect(
        bdp(["--scope", scope, "call", "--idempotency-key", "k1", "issue/reopen", "--id", "a"]),
      ).resolves.toBe(5);
      expect(posts).toHaveLength(1);
    });
  });

  it("uses a positional from a cliMapping (the §10 example)", async () => {
    await withScope(
      { answer: success({ result: { reservation: "res-81" }, changed: true }) },
      async (scope, posts) => {
        await expect(
          bdp(
            ["--scope", scope, "call", "reserve-room", "cedar", "--day", "2026-11-20"],
            testCatalog,
          ),
        ).resolves.toBe(0);
        expect(posts[0]?.body).toEqual({ arguments: { room: "cedar", day: "2026-11-20" } });
      },
    );
  });

  it("shows a callable-error's error value on the error path and fails", async () => {
    const problem = {
      type: `${problems}/conflict`,
      status: 409,
      code: "callable-error",
      retry: "after-state-change",
      error: { reason: "already-claimed", assignee: "kim", issue_status: "in_progress" },
    };
    await withScope({ answer: { status: 409, body: problem } }, async (scope, posts) => {
      await expect(
        bdp(["--scope", scope, "--actor", "sam", "call", "issue/claim", "--id", "bd-1"]),
      ).resolves.toBe(1);
      expect(posts).toHaveLength(1);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr)).toEqual({ error: { origin: "bdp", problem } });

      stdout = "";
      stderr = "";
      await expect(
        bdp(["--scope", scope, "--output-mode", "json", "call", "issue/claim", "--id", "bd-1"]),
      ).resolves.toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        outcome: "failure",
        result_kind: "callable_result",
        error: { origin: "bdp", problem },
        context: { effects: "not-established" },
      });
    });
  });

  it("reports a 5xx with no error member as a system failure, not the operation's answer", async () => {
    const problem = {
      type: `${problems}/unavailable`,
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    };
    await withScope({ answer: { status: 503, body: problem } }, async (scope) => {
      const json = ["--scope", scope, "--output-mode", "json", "call"];
      await expect(bdp([...json, "issue/ready"])).resolves.toBe(1);
      const query = JSON.parse(stdout);
      expect(query).toMatchObject({ outcome: "failure", error: { origin: "bdp", problem } });
      expect(Object.hasOwn(query.error.problem, "error")).toBe(false);

      // A batch without `atomic`: a Problem does not establish that nothing committed (§5).
      stdout = "";
      await expect(bdp([...json, "issue/unclaim", "--id", "a"])).resolves.toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({ outcome: "unknown" });

      // A batch declared `atomic`: a Problem means nothing committed.
      stdout = "";
      await expect(bdp([...json, "issue/comment", "--id", "a"])).resolves.toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        outcome: "failure",
        context: { effects: "none" },
      });
    });
  });

  it("reports a non-Problem 5xx without reading its body as the operation's error", async () => {
    await withScope(
      { answer: { status: 502, body: "<html>private</html>", contentType: "text/html" } },
      async (scope) => {
        const json = ["--scope", scope, "--output-mode", "json", "call"];
        await expect(bdp([...json, "issue/ready"])).resolves.toBe(1);
        expect(stdout).not.toContain("private");
        expect(JSON.parse(stdout)).toMatchObject({ outcome: "failure", error: { origin: "cli" } });
        stdout = "";
        await expect(bdp([...json, "issue/unclaim", "--id", "a"])).resolves.toBe(1);
        expect(JSON.parse(stdout)).toMatchObject({
          outcome: "unknown",
          error: { origin: "cli", problem: { code: "write_outcome_unknown" } },
        });
      },
    );
  });

  it("maps a missing Callable to status 3 and an unadvertised capability to status 5", async () => {
    await withScope(
      {
        answer: {
          status: 404,
          body: {
            type: `${problems}/not-found`,
            code: "callable-not-found",
            retry: "after-state-change",
          },
        },
      },
      async (scope) => {
        await expect(bdp(["--scope", scope, "call", "issue/stats"])).resolves.toBe(3);
      },
    );
    await withScope({ callables: false, answer: success({ result: 1 }) }, async (scope, posts) => {
      await expect(bdp(["--scope", scope, "call", "issue/stats"])).resolves.toBe(5);
      expect(posts).toEqual([]);
    });
  });

  it("refuses attribution on a query and client options after NAME, before any request", async () => {
    await withScope({ answer: success({ result: 1 }) }, async (scope, posts) => {
      const scoped = ["--scope", scope];
      await expect(bdp([...scoped, "--actor", "sam", "call", "issue/stats"])).resolves.toBe(2);
      await expect(bdp([...scoped, "call", "--idempotency-key", "k", "issue/stats"])).resolves.toBe(
        2,
      );
      await expect(bdp([...scoped, "call", "issue/stats", "--output-mode", "json"])).resolves.toBe(
        2,
      );
      await expect(
        bdp([...scoped, "call", "issue/stats", "--config", "/nonexistent"]),
      ).resolves.toBe(2);
      await expect(bdp([...scoped, "call", "not-a-callable"])).resolves.toBe(2);
      expect(posts).toEqual([]);
    });
  });

  it("lowers attribution as Write commands do, refusing a conflict before any request", async () => {
    await withScope({ answer: success({ result: 1, changed: true }) }, async (scope, posts) => {
      const provenance = (flags: string[]) =>
        bdp(["--scope", scope, ...flags, "call", "issue/reopen", "--id", "a"]);
      const sam = '{"actor":{"id":"sam","basis":"writer-supplied"},"message":"why"}';
      await expect(provenance(["--revision-provenance", "nope"])).resolves.toBe(2);
      await expect(provenance(["--revision-provenance", "[]"])).resolves.toBe(2);
      await expect(provenance(["--revision-provenance", sam, "--actor", "kim"])).resolves.toBe(2);
      expect(posts).toEqual([]);
      await expect(provenance(["--revision-provenance", sam, "--actor", "sam"])).resolves.toBe(0);
      expect(posts[0]?.body).toEqual({
        arguments: { id: "a" },
        revisionProvenance: {
          actor: { id: "sam", basis: "writer-supplied" },
          message: "why",
        },
      });
    });
  });

  it("requires a Scope only to invoke", async () => {
    await expect(bdp(["call", "issue/stats"])).resolves.toBe(2);
    expect(stderr).toContain("missing_target_scope");
  });

  it("prints help after NAME without a Scope or a request", async () => {
    await expect(bdp(["call", "reserve-room", "--help"], testCatalog)).resolves.toBe(0);
    expect(stdout).toContain("Reserve a room");
    expect(stdout).toContain("Reserve a room for one day.");
    expect(stdout).toContain("--room TEXT");
    expect(stdout).toContain("position 0");
    expect(stdout).toContain("-d, --date");
    expect(stdout).toContain("room-taken");
    expect(stdout).toContain("Someone else holds it.");
    expect(stdout).toContain("room-closed");
    stdout = "";
    await expect(bdp(["call", "shapes", "--help"], testCatalog)).resolves.toBe(0);
    expect(stdout).toContain("--dry-run, --no-dry-run");
    expect(stdout).toContain("--label TEXT");
    expect(stdout).toContain("repeatable");
    expect(stdout).toContain("--count-limit JSON");
    expect(stdout).toContain("default 3");
    expect(stdout).toContain("How many.");
    expect(stdout).not.toContain("Errors:");
  });

  it("lists names with no NAME, and as JSON on request", async () => {
    await expect(bdp(["call"], testCatalog)).resolves.toBe(0);
    expect(stdout.trim().split("\n")).toEqual(["reserve-room  batch", "shapes        query"]);
    stdout = "";
    await expect(bdp(["--output-mode", "json", "call"], testCatalog)).resolves.toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      result_kind: "callable_catalog",
      outcome: "success",
      data: { items: [{ name: "reserve-room" }, { name: "shapes" }] },
    });
    stdout = "";
    await expect(bdp(["call"])).resolves.toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(45);
  });

  it("does not exist under the compat profile", async () => {
    await expect(bdp(["--cli-profile", "compat", "call", "issue/stats"])).resolves.toBe(2);
  });
});
