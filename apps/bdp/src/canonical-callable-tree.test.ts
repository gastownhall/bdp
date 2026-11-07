/** The Callable tree and every cliMapping annotation against a stub faithful to Callables and the
 * Issue document: Core discovery advertising Callables1, routed names, v0 Problem bodies. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueCallableCatalog } from "@bdp/bd-domain";
import {
  CALLABLE_BATCH_TYPE,
  CALLABLE_QUERY_TYPE,
  type CallableCatalog,
  type CallableDeclaration,
  type CallableParameter,
  createStaticCallableCatalog,
} from "@bdp/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CallableUsageError,
  callableCommandTree,
  callableFlagCollisions,
  completeCallableArguments,
  parameterFlag,
  parseCallArguments,
  parseCallableArguments,
  renderCallableHelp,
  resolveCallableCommand,
} from "./canonical-call.js";
import { createCanonicalCommand } from "./canonical-command.js";
import { renderCallableFailure } from "./canonical-output.js";
import { runBdp } from "./main.js";

const media = "application/vnd.bdp.v0.1+json";
const problemMedia = "application/problem+json";
const CALLABLES = "https://github.com/gastownhall/bdp/capabilities/callables";
const family = "https://github.com/gastownhall/bdp/problems";

interface Post {
  readonly name: string;
  readonly body: { arguments: Record<string, unknown>; revisionProvenance?: unknown };
  readonly key: unknown;
}
type Answer = { status: number; body?: unknown; contentType?: string };
const ok = (declaration?: CallableDeclaration): Answer => ({
  status: 200,
  body:
    declaration?.type === CALLABLE_QUERY_TYPE
      ? { result: { ok: 1 } }
      : { result: {}, changed: true },
});

/** `bd serve` as the brief decides it: `GET /` links `/bdp`, and `/bdp` is Core plus Callables1. */
async function withServe(
  answer: (name: string) => Answer,
  run: (scope: string, posts: Post[]) => Promise<void>,
  options: { landing?: Answer; callables?: boolean; discovery?: unknown } = {},
): Promise<void> {
  const posts: Post[] = [];
  let scope = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const send = ({ status, body, contentType }: Answer, headers = {}) => {
        response.writeHead(status, {
          ...(body === undefined
            ? {}
            : { "content-type": contentType ?? (status === 200 ? media : problemMedia) }),
          "cache-control": "private, no-store",
          ...headers,
        });
        response.end(
          body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        );
      };
      const path = (request.url ?? "/").split("?")[0] ?? "/";
      if (request.method === "POST" && path.startsWith("/bdp/call/")) {
        const name = path.slice("/bdp/call/".length);
        posts.push({
          name,
          key: request.headers["idempotency-key"],
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        send(answer(name));
      } else if (path === "/" && options.landing !== undefined) send(options.landing);
      else if (path === "/")
        send(
          { status: 200, body: {} },
          { link: `<${scope}bdp>; rel="service-desc"; type="${media}"` },
        );
      else if (path === "/bdp")
        send({
          status: 200,
          body: options.discovery ?? {
            bdpVersion: "0.1",
            profile: "core",
            scope,
            specRevision: "0123456789abcdef0123456789abcdef01234567",
            capabilities: options.callables === false ? {} : { [CALLABLES]: { "1": {} } },
          },
        });
      else send({ status: 404 });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  scope = `http://127.0.0.1:${address.port}/`;
  try {
    await run(scope, posts);
  } finally {
    await close(server);
  }
}
const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );

let home: string;
let stdout = "";
let stderr = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bdp-tree-"));
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
const bdp = (args: string[], callableCatalog: CallableCatalog = issueCallableCatalog()) =>
  runBdp(args, { callableCatalog });

const annotated: CallableDeclaration = {
  name: "pack/thing/make",
  type: CALLABLE_BATCH_TYPE,
  title: "Make a thing",
  description: "Make one thing.",
  parameters: [
    { name: "title", schema: { type: "string" }, required: true, description: "Its title." },
    { name: "second", schema: { type: "string" } },
    { name: "body", schema: { type: "string" } },
    { name: "weight", schema: { type: "integer" }, default: 3 },
    { name: "tag", schema: { type: "array", items: { type: "string" } } },
    { name: "edge", schema: { type: "array", items: { type: "object" } } },
    { name: "shape", schema: { type: "object" } },
    { name: "dry_run", schema: { type: "boolean" } },
    { name: "mode", schema: { enum: ["a", "b"] } },
  ],
  cliMapping: {
    positionals: [
      { position: 0, parameter: "title" },
      { position: 1, parameter: "second" },
    ],
    flags: [
      { names: ["-w", "--heft"], parameter: "weight" },
      { names: ["-t"], parameter: "tag" },
      { names: ["-n"], parameter: "dry_run" },
    ],
    fromFile: [
      { names: ["-f", "--body-file"], parameter: "body" },
      { names: ["--shape-file"], parameter: "shape" },
      { names: ["--tag-file"], parameter: "tag" },
    ],
  },
};
const parsed = (declaration: CallableDeclaration, tokens: string[]) => {
  const result = parseCallableArguments(declaration, tokens);
  if (result.help) throw new Error("expected arguments");
  return result;
};
const complete = (
  declaration: CallableDeclaration,
  tokens: string[],
  files: Record<string, string> = {},
) =>
  completeCallableArguments(parsed(declaration, tokens), async (path) => {
    if (!Object.hasOwn(files, path))
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    return new TextEncoder().encode(files[path]);
  });

const patching: CallableDeclaration = {
  name: "pack/thing/edit",
  type: CALLABLE_BATCH_TYPE,
  title: "Edit a thing",
  description: "Edit one thing.",
  parameters: [
    { name: "id", schema: { type: "string" }, required: true },
    {
      name: "patch",
      required: true,
      schema: {
        $ref: "#/$defs/Patch",
        $defs: {
          Status: { type: "string" },
          Patch: {
            type: "object",
            properties: {
              status: { $ref: "#/$defs/Status" },
              priority: { type: "integer" },
              labels: { type: "array", items: { type: "string" } },
              pinned: { type: "boolean" },
              extra: { type: "object" },
              title: { type: "string" },
            },
          },
        },
      },
    },
  ],
  cliMapping: {
    positionals: [{ position: 0, parameter: "id" }],
    memberFlags: [
      { member: "status", names: ["-s"], parameter: "patch" },
      { member: "priority", parameter: "patch" },
      { member: "labels", names: ["--set-labels"], parameter: "patch" },
      { member: "pinned", parameter: "patch" },
      { member: "extra", parameter: "patch" },
    ],
  },
};

describe("a tree command's --help", () => {
  const help = () =>
    issueCallableCatalog()
      .get("issue/update")
      .then((update) => {
        if (update === undefined) throw new Error("catalog");
        return { update, text: renderCallableHelp(update, ["issue", "update"]) };
      });
  it("opens with the usage, then the title, and leaves out the description", async () => {
    const { update, text } = await help();
    expect(text.split("\n").slice(0, 3)).toEqual([
      "Usage: bdp [client options] issue update ID [callable arguments]",
      "",
      update.title,
    ]);
    expect(text).not.toContain(update.description);
    expect(text).not.toContain("#####");
    expect(text).not.toContain("Errors:");
  });
  it("lists every parameter, every member flag, and one line of text for each", async () => {
    const { update, text } = await help();
    for (const parameter of update.parameters)
      expect(text).toContain(parameterFlag(parameter.name));
    expect(text).toMatch(/--status, -s TEXT/);
    expect(text).toMatch(/--priority, -p JSON/);
    expect(text).toMatch(/--labels, --set-labels TEXT {2}\(repeatable\)/);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(120);
  });
  it("says where the full text is", async () => {
    const { text } = await help();
    expect(text).toContain("bdp call issue/update --help");
  });
  it("bdp call NAME --help keeps printing the whole declaration, with no flags", async () => {
    const update = await issueCallableCatalog().get("issue/update");
    if (update === undefined) throw new Error("catalog");
    const text = renderCallableHelp(update);
    expect(text).toContain(update.description);
    expect(text).toContain("Errors:");
    expect(text).toContain("Usage: bdp call issue/update");
    expect(text).not.toContain("--status");
  });
});

describe("cliMapping.memberFlags", () => {
  it("a member flag sets that member of the parameter, and no other", async () => {
    await expect(complete(patching, ["a", "--status", "open"])).resolves.toEqual({
      id: "a",
      patch: { status: "open" },
    });
    await expect(complete(patching, ["a", "-s=open"])).resolves.toEqual({
      id: "a",
      patch: { status: "open" },
    });
  });
  it("takes its value's form from the member's schema, $ref included", async () => {
    await expect(
      complete(patching, [
        "--priority",
        "2",
        "--labels",
        "x",
        "--set-labels",
        "y,z",
        "--pinned",
        "--extra",
        '{"a":1}',
      ]),
    ).resolves.toEqual({
      patch: { priority: 2, labels: ["x", "y,z"], pinned: true, extra: { a: 1 } },
    });
    await expect(complete(patching, ["--no-pinned"])).resolves.toEqual({
      patch: { pinned: false },
    });
    expect(() => parsed(patching, ["--priority", "high"])).toThrow(
      /--priority requires a JSON value/,
    );
    expect(() => parsed(patching, ["--pinned=yes"])).toThrow(/takes no value/);
  });
  it("overrides that member of --patch and of --arguments, and keeps the others", async () => {
    await expect(
      complete(patching, ["--patch", '{"status":"old","title":"kept"}', "--status", "new"]),
    ).resolves.toEqual({ patch: { status: "new", title: "kept" } });
    await expect(
      complete(patching, [
        "--arguments",
        '{"id":"a","patch":{"status":"old","title":"kept"}}',
        "-s",
        "new",
      ]),
    ).resolves.toEqual({ id: "a", patch: { status: "new", title: "kept" } });
    await expect(
      complete(patching, [
        "--arguments",
        '{"patch":{"title":"gone"}}',
        "--patch",
        '{"status":"held"}',
        "--priority",
        "1",
      ]),
    ).resolves.toEqual({ patch: { status: "held", priority: 1 } });
    await expect(
      complete(patching, ["--patch", '{"labels":["a"]}', "--labels", "b"]),
    ).resolves.toEqual({ patch: { labels: ["b"] } });
  });
  it("--patch alone still works, and nothing is filled in", async () => {
    await expect(complete(patching, ["a", "--patch", '{"status":"x"}'])).resolves.toEqual({
      id: "a",
      patch: { status: "x" },
    });
    await expect(complete(patching, ["a"])).resolves.toEqual({ id: "a" });
  });
  it("refuses a second value, and writing into what is not an object", () => {
    expect(() => parsed(patching, ["-s", "a", "--status", "b"])).toThrow(
      /-?-status may be given only once/,
    );
    for (const value of ["[1]", "null", "5"])
      expect(() => parsed(patching, ["--patch", value, "--status", "x"])).toThrow(
        /requires --patch to be a JSON object/,
      );
    expect(() => parsed(patching, ["--arguments", '{"patch":"nope"}', "--status", "x"])).toThrow(
      /requires --patch to be a JSON object/,
    );
  });
  it("a declaration cannot project a member to who is acting", () => {
    const withMembers = (
      memberFlags: NonNullable<NonNullable<CallableDeclaration["cliMapping"]>["memberFlags"]>,
    ) => ({
      ...patching,
      cliMapping: { memberFlags },
    });
    expect(
      callableFlagCollisions(
        withMembers([{ member: "status", names: ["--actor"], parameter: "patch" }]),
      ),
    ).toContain("--actor");
    expect(
      callableFlagCollisions(
        withMembers([{ member: "status", names: ["--author"], parameter: "patch" }]),
      ),
    ).toContain("--author");
    const actorMember = {
      ...withMembers([{ member: "actor", parameter: "patch" }]),
      parameters: [
        {
          name: "patch",
          schema: { type: "object", properties: { actor: { type: "string" } } },
        },
      ],
    } as CallableDeclaration;
    expect(callableFlagCollisions(actorMember)).toContain("--actor");
    expect(() => parsed(actorMember, ["--actor", "sam"])).toThrow(/not a parameter/);
  });
  it("a member colliding with a parameter's flag is reported, and no use of it is honest", () => {
    const clash = {
      ...patching,
      cliMapping: { memberFlags: [{ member: "status", names: ["--id"], parameter: "patch" }] },
    };
    expect(callableFlagCollisions(clash)).toEqual(["--id"]);
    expect(() => parsed(clash, ["--id", "a"])).toThrow(/more than one parameter/);
  });
  it("is the tree's alone: bdp call takes one JSON object", () => {
    expect(() => parseCallArguments(["--status", "x"], undefined)).toThrow(/--arguments JSON/);
  });
  it("the catalog's issue/update and issue/create carry it, with native's spellings", async () => {
    const update = await issueCallableCatalog().get("issue/update");
    const create = await issueCallableCatalog().get("issue/create");
    if (update === undefined || create === undefined) throw new Error("catalog");
    expect(callableFlagCollisions(update)).toEqual([]);
    expect(callableFlagCollisions(create)).toEqual([]);
    expect(
      parseCallableArguments(update, [
        "a",
        "-s",
        "open",
        "--title",
        "T",
        "-p",
        "1",
        "-l",
        "x",
        "--add-label",
        "y",
        "--acceptance",
        "AC",
        "--estimate",
        "30",
      ]),
    ).toMatchObject({
      arguments: {
        id: "a",
        patch: {
          status: "open",
          title: "T",
          priority: 1,
          add_labels: ["x", "y"],
          acceptance_criteria: "AC",
          estimated_minutes: 30,
        },
      },
    });
    expect(
      parseCallableArguments(create, [
        "t",
        "--spawner-id",
        "s-1",
        "--waits-for-gate",
        "any-children",
      ]),
    ).toMatchObject({
      arguments: { title: "t", waits_for: { spawner_id: "s-1", gate: "any-children" } },
    });
    expect(
      (update.cliMapping?.memberFlags ?? []).filter(({ member }) =>
        ["metadata", "waiters", "persistence"].includes(member),
      ),
    ).toEqual([]);
  });
});

describe("every cliMapping annotation", () => {
  it("positionals stand for their flags, in place", async () => {
    await expect(complete(annotated, ["t", "u"])).resolves.toEqual({
      title: "t",
      second: "u",
    });
    expect(() => parsed(annotated, ["t", "--title", "again"])).toThrow(CallableUsageError);
    expect(() => parsed(annotated, ["a", "b", "c"])).toThrow(/unmapped operand/);
  });
  it("flags adds aliases and the derived flag remains", async () => {
    for (const tokens of [["--weight", "1"], ["-w", "1"], ["--heft", "1"], ["-w=1"]])
      await expect(complete(annotated, tokens)).resolves.toEqual({ weight: 1 });
    await expect(complete(annotated, ["-t", "a", "--tag", "b"])).resolves.toMatchObject({
      tag: ["a", "b"],
    });
  });
  it("fromFile reads the path, exactly, and - means stdin", async () => {
    await expect(complete(annotated, ["-f", "p"], { p: "text\n" })).resolves.toMatchObject({
      body: "text\n",
    });
    await expect(
      complete(annotated, ["--body-file", "-"], { "-": "piped" }),
    ).resolves.toMatchObject({ body: "piped" });
    await expect(complete(annotated, ["-f=p"], { p: "x" })).resolves.toMatchObject({ body: "x" });
  });
  it("fromFile content is that parameter's flag value: JSON for non-strings, an item for arrays", async () => {
    await expect(
      complete(annotated, ["--shape-file", "s"], { s: '{"a":1}' }),
    ).resolves.toMatchObject({ shape: { a: 1 } });
    await expect(complete(annotated, ["--shape-file", "s"], { s: "not json" })).rejects.toThrow(
      /--shape-file requires a JSON value/,
    );
    await expect(
      complete(annotated, ["-t", "a", "--tag-file", "t"], { t: "b" }),
    ).resolves.toMatchObject({ tag: ["a", "b"] });
  });
  it("fromFile conflicts with the parameter's flag, and only one flag reads stdin", () => {
    expect(() => parsed(annotated, ["--body", "x", "-f", "p"])).toThrow(/may be given only once/);
    expect(() => parsed(annotated, ["-f", "p", "--body", "x"])).toThrow(/may be given only once/);
    expect(() => parsed(annotated, ["-f", "p", "--body-file", "q"])).toThrow(/only once/);
    expect(() => parsed(annotated, ["--tag-file", "-", "--shape-file", "-"])).toThrow(/stdin/);
    expect(() => parsed(annotated, ["-f"])).toThrow(/requires a value/);
    expect(() => parsed(annotated, ["-f="])).toThrow(/requires a path/);
  });
  it("fromFile says what failed, and never echoes the path", async () => {
    await expect(complete(annotated, ["-f", "secret-path"])).rejects.toThrow(
      /-f could not read its input \(ENOENT\)/,
    );
    await expect(complete(annotated, ["-f", "secret-path"])).rejects.not.toThrow(/secret-path/);
    const invalid = completeCallableArguments(parsed(annotated, ["-f", "p"]), async () =>
      Uint8Array.of(0xff),
    );
    await expect(invalid).rejects.toThrow(/-f requires UTF-8 text/);
  });
  it("no default is substituted, and a stale cliMapping.defaults is not read", async () => {
    await expect(complete(annotated, [])).resolves.toEqual({});
    const stale = {
      ...annotated,
      cliMapping: { ...annotated.cliMapping, defaults: { mode: "a" } },
    } as CallableDeclaration;
    await expect(complete(stale, [])).resolves.toEqual({});
    expect(renderCallableHelp(stale, ["pack", "thing", "make"])).not.toMatch(
      /client sends .* when not given/,
    );
    expect(renderCallableHelp(annotated, ["pack", "thing", "make"])).toContain("default 3");
  });
  it("a flag, --arguments and a supplied null all reach the wire as given", async () => {
    await expect(complete(annotated, ["--no-dry-run"])).resolves.toEqual({ dry_run: false });
    await expect(complete(annotated, ["-n", "--mode", "b"])).resolves.toEqual({
      dry_run: true,
      mode: "b",
    });
    await expect(
      complete(annotated, ["--arguments", '{"mode":"b","dry_run":null}']),
    ).resolves.toEqual({ mode: "b", dry_run: null });
  });
  it("derives the §10 forms: --flag/--no-flag, repeats, JSON, enum as text", async () => {
    await expect(
      complete(annotated, [
        "--edge",
        '{"a":1}',
        "--edge",
        '{"a":2}',
        "--shape",
        '{"b":[1]}',
        "--mode",
        "b",
        "--no-dry-run",
      ]),
    ).resolves.toEqual({
      edge: [{ a: 1 }, { a: 2 }],
      shape: { b: [1] },
      mode: "b",
      dry_run: false,
    });
    expect(() => parsed(annotated, ["-w", "heavy"])).toThrow(/-w requires a JSON value/);
    expect(() => parsed(annotated, ["--dry-run=yes"])).toThrow(/takes no value/);
  });
  it("after a bare --, everything is an operand", async () => {
    await expect(complete(annotated, ["--", "-odd", "--title"])).resolves.toEqual({
      title: "-odd",
      second: "--title",
    });
  });
  it("§10: --no-pinned is no_pinned's, and pinned has no derived negation", async () => {
    const list = await issueCallableCatalog().get("issue/list");
    if (list === undefined) throw new Error("issue/list is missing");
    expect(parsed(list, ["--no-pinned"]).arguments).toEqual({ no_pinned: true });
    expect(parsed(list, ["--pinned"]).arguments).toEqual({ pinned: true });
    expect(parsed(list, ["--arguments", '{"pinned":false}']).arguments).toEqual({ pinned: false });
  });
});

/** One value of a parameter's CLI form, and the value it must become on the wire. */
function sample(parameter: CallableParameter): { tokens: string[]; value: unknown } {
  const flag = parameterFlag(parameter.name);
  const schema = parameter.schema as Record<string, unknown>;
  if (schema.type === "boolean") return { tokens: [flag], value: true };
  if (schema.type === "array") {
    const items = schema.items as Record<string, unknown>;
    return items.type === "string"
      ? { tokens: [flag, "one", flag, "two"], value: ["one", "two"] }
      : { tokens: [flag, "{}"], value: [{}] };
  }
  if (schema.type === "string") return { tokens: [flag, "text"], value: "text" };
  if (schema.type === "integer" || schema.type === "number")
    return { tokens: [flag, "7"], value: 7 };
  return { tokens: [flag, '{"a":1}'], value: { a: 1 } };
}

describe("the 45 Issue declarations", () => {
  it("mount in the tree with no collision, and every word path is a leaf", async () => {
    const all = await issueCallableCatalog().list();
    expect(all).toHaveLength(45);
    const builtIns = new Set(
      createCanonicalCommand({
        version: "x",
        profile: "canonical",
        onInvocation: () => undefined,
      }).commands.map((command) => command.name()),
    );
    const tree = callableCommandTree(all, builtIns);
    expect(tree.shadowed).toEqual([]);
    expect([...tree.roots.keys()].sort()).toEqual(["config", "events", "issue", "memory"]);
    for (const declaration of all) {
      const words = declaration.name.split("/");
      const mounted = resolveCallableCommand(tree, words);
      expect(mounted?.node.declaration, declaration.name).toBe(declaration);
      expect(mounted?.rest).toEqual([]);
    }
  });

  it("each yields a well-formed command: flags, aliases, positions and files", async () => {
    for (const declaration of await issueCallableCatalog().list()) {
      const label = declaration.name;
      const mapping = declaration.cliMapping ?? {};
      const tokens: string[] = [];
      const expected: Record<string, unknown> = {};
      for (const parameter of declaration.parameters) {
        const { tokens: form, value } = sample(parameter);
        tokens.push(...form);
        expected[parameter.name] = value;
      }
      await expect(complete(declaration, tokens), label).resolves.toEqual(expected);

      for (const { names, parameter } of mapping.flags ?? []) {
        const held = declaration.parameters.find(({ name }) => name === parameter);
        if (held === undefined) throw new Error(`${label}: ${parameter} is undeclared`);
        const { tokens: form, value } = sample({ ...held });
        for (const name of names) {
          const spelled = form.map((token) => (token === form[0] ? name : token));
          await expect(complete(declaration, spelled), `${label} ${name}`).resolves.toEqual({
            [parameter]: value,
          });
        }
      }
      for (const { names, parameter } of mapping.fromFile ?? [])
        for (const name of names)
          await expect(
            complete(declaration, [name, "path"], { path: "from file" }),
            `${label} ${name}`,
          ).resolves.toEqual({ [parameter]: "from file" });

      const positions = [...(mapping.positionals ?? [])].sort((a, b) => a.position - b.position);
      if (positions.length > 0)
        await expect(
          complete(
            declaration,
            positions.map(({ parameter }) => `value-of-${parameter}`),
          ),
          `${label} positions`,
        ).resolves.toEqual(
          Object.fromEntries(
            positions.map(({ parameter }) => [parameter, `value-of-${parameter}`]),
          ),
        );
    }
  });

  it("each reaches its mount the same way through call and the tree", async () => {
    const all = await issueCallableCatalog().list();
    const byName = new Map(all.map((declaration) => [declaration.name, declaration]));
    await withServe(
      (name) => ok(byName.get(name)),
      async (scope, posts) => {
        for (const declaration of all) {
          const tokens = declaration.parameters.flatMap((parameter) => sample(parameter).tokens);
          posts.length = 0;
          const viaTree = await bdp(["--scope", scope, ...declaration.name.split("/"), ...tokens]);
          const sent = JSON.stringify(
            (posts[0]?.body as { arguments: unknown } | undefined)?.arguments,
          );
          const viaCall = await bdp([
            "--scope",
            scope,
            "call",
            declaration.name,
            "--arguments",
            sent,
          ]);
          expect(stderr, declaration.name).toBe("");
          expect([viaCall, viaTree], declaration.name).toEqual([0, 0]);
          expect(posts.map(({ name }) => name)).toEqual([declaration.name, declaration.name]);
          expect(posts[0]?.body).toEqual(posts[1]?.body);
        }
      },
    );
  });

  it("each has help at its own level, from its declaration, with no Scope", async () => {
    for (const declaration of await issueCallableCatalog().list()) {
      stdout = "";
      await expect(bdp([...declaration.name.split("/"), "--help"])).resolves.toBe(0);
      expect(stdout).toContain(`bdp [client options] ${declaration.name.replaceAll("/", " ")} `);
      expect(stdout).toContain(`call ${declaration.name}`);
      expect(stdout).toContain(declaration.title as string);
      expect(stdout).not.toMatch(/client sends .* when not given/);
      for (const parameter of declaration.parameters) {
        expect(stdout, `${declaration.name} ${parameter.name}`).toContain(
          parameterFlag(parameter.name),
        );
        if (Object.hasOwn(parameter, "default"))
          expect(stdout, `${declaration.name} ${parameter.name}`).toContain(
            `default ${JSON.stringify(parameter.default)}`,
          );
      }
      expect(stdout.includes("--actor ACTOR")).toBe(declaration.type === CALLABLE_BATCH_TYPE);
      for (const mapping of [
        ...(declaration.cliMapping?.flags ?? []),
        ...(declaration.cliMapping?.fromFile ?? []),
      ])
        for (const name of mapping.names) expect(stdout).toContain(name);
    }
  });
});

describe("the induced tree", () => {
  it("runs the examples the design names", async () => {
    await withServe(
      () => ({ status: 200, body: { result: { id: "bd-1" }, changed: true } }),
      async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "issue", "create", "Fix login", "-p", "1", "--actor", "sam"]),
        ).resolves.toBe(0);
        await expect(
          bdp([
            "--scope",
            scope,
            "issue",
            "dep",
            "add",
            "a",
            "b",
            "-t",
            "tracks",
            "--actor",
            "sam",
          ]),
        ).resolves.toBe(0);
        const revisionProvenance = { actor: { id: "sam", basis: "writer-supplied" } };
        expect(posts.map(({ name, body }) => [name, body])).toEqual([
          ["issue/create", { arguments: { title: "Fix login", priority: 1 }, revisionProvenance }],
          [
            "issue/dep/add",
            { arguments: { source: "a", target: "b", type: "tracks" }, revisionProvenance },
          ],
        ]);
      },
    );
    await withServe(
      () => ({ status: 200, body: { result: { items: [], has_more: false } } }),
      async (scope, posts) => {
        await expect(bdp(["--scope", scope, "issue", "list", "--status", "open"])).resolves.toBe(0);
        await expect(
          bdp(["--scope", scope, "call", "issue/list", "--arguments", '{"status":["open"]}']),
        ).resolves.toBe(0);
        expect(posts.map(({ body }) => body)).toEqual([
          { arguments: { status: ["open"] } },
          { arguments: { status: ["open"] } },
        ]);
      },
    );
  });

  it("sends none of Issue §4's service defaults, and an explicit flag as given", async () => {
    await withServe(
      () => ({ status: 200, body: { result: {}, changed: false } }),
      async (scope, posts) => {
        await expect(bdp(["--scope", scope, "issue", "purge"])).resolves.toBe(0);
        await expect(bdp(["--scope", scope, "issue", "prune", "--no-dry-run"])).resolves.toBe(0);
        await expect(bdp(["--scope", scope, "issue", "delete", "--ids", "a"])).resolves.toBe(0);
        expect(posts.map(({ body }) => body.arguments)).toEqual([
          {},
          { dry_run: false },
          { ids: ["a"] },
        ]);
      },
    );
  });

  it("reads a fromFile path through the real reader", async () => {
    const path = join(home, "body.md");
    await writeFile(path, "# From a file\n");
    await withServe(
      () => ({ status: 200, body: { result: {}, changed: true } }),
      async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "issue", "create", "T", "--body-file", path, "--actor", "sam"]),
        ).resolves.toBe(0);
        expect(posts[0]?.body).toEqual({
          arguments: { title: "T", description: "# From a file\n" },
          revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
        });
        await expect(
          bdp(["--scope", scope, "issue", "create", "T", "--body-file", join(home, "nope")]),
        ).resolves.toBe(2);
        expect(posts).toHaveLength(1);
        expect(stderr).toContain("--body-file could not read its input");
      },
    );
  });

  it("carries client options before the command, and refuses them and the display flags after", async () => {
    await withServe(
      () => ({ status: 200, body: { result: {}, changed: true } }),
      async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "--output-mode", "json", "issue", "claim", "a", "--actor", "sam"]),
        ).resolves.toBe(0);
        expect(posts[0]?.body).toEqual({
          arguments: { id: "a" },
          revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
        });
        expect(JSON.parse(stdout)).toMatchObject({
          result_kind: "callable_result",
          data: { result: {}, changed: true },
        });
        posts.length = 0;
        for (const after of ["--output-mode", "--scope", "--config", "--revision-provenance"])
          await expect(
            bdp(["--scope", scope, "issue", "list", after, "x"]),
            `${after} after the command`,
          ).resolves.toBe(2);
        for (const unsupported of ["--pretty", "--long", "--silent"]) {
          await expect(bdp(["--scope", scope, "issue", "list", unsupported])).resolves.toBe(2);
          await expect(bdp(["--scope", scope, unsupported, "issue", "list"])).resolves.toBe(2);
        }
        expect(posts).toEqual([]);
      },
    );
  });

  describe("--actor", () => {
    const sam = { actor: { id: "sam", basis: "writer-supplied" } };
    const answered = () => ({ status: 200, body: { result: {}, changed: true } });

    it("is attribution in any position: before, between and after the words", async () => {
      await withServe(answered, async (scope, posts) => {
        const forms = [
          ["--actor", "sam", "issue", "create", "Fix login"],
          ["issue", "--actor", "sam", "create", "Fix login"],
          ["issue", "create", "--actor", "sam", "Fix login"],
          ["issue", "create", "Fix login", "--actor", "sam"],
          ["issue", "create", "Fix login", "--actor=sam"],
          ["--actor=sam", "issue", "create", "Fix login", "--actor", "sam"],
        ];
        for (const form of forms)
          await expect(bdp(["--scope", scope, ...form]), form.join(" ")).resolves.toBe(0);
        expect(posts).toHaveLength(forms.length);
        for (const { name, body } of posts) {
          expect(name).toBe("issue/create");
          expect(body).toEqual({ arguments: { title: "Fix login" }, revisionProvenance: sam });
        }
      });
    });

    it("signs a comment, with no --author and no -a on the tree", async () => {
      await withServe(answered, async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "issue", "comment", "bd-1", "text", "--actor", "sam"]),
        ).resolves.toBe(0);
        expect(posts[0]?.body).toEqual({
          arguments: { id: "bd-1", text: "text" },
          revisionProvenance: sam,
        });
        posts.length = 0;
        for (const flag of ["--author", "-a"])
          await expect(
            bdp(["--scope", scope, "issue", "comment", "bd-1", "text", flag, "sam"]),
            flag,
          ).resolves.toBe(2);
        expect(posts).toEqual([]);
      });
    });

    it("refuses two different values, however they are spelled, with a true message", async () => {
      await withServe(answered, async (scope, posts) => {
        for (const form of [
          ["--actor", "sam", "issue", "claim", "a", "--actor", "kim"],
          ["--actor=sam", "--actor=kim", "issue", "claim", "a"],
          ["issue", "claim", "a", "--actor", "sam", "--actor=kim"],
          ["issue", "--actor", "sam", "claim", "a", "--actor", "kim"],
        ]) {
          stderr = "";
          await expect(bdp(["--scope", scope, ...form]), form.join(" ")).resolves.toBe(2);
          expect(stderr).toContain("--actor was given with two different values");
          expect(stderr).not.toContain("kim");
        }
        expect(posts).toEqual([]);
      });
    });

    it("requires a value, and a bare -- makes it an operand", async () => {
      await withServe(answered, async (scope, posts) => {
        for (const form of [
          ["issue", "claim", "a", "--actor"],
          ["issue", "claim", "a", "--actor", "--no-such"],
          ["issue", "claim", "a", "--actor="],
        ]) {
          stderr = "";
          await expect(bdp(["--scope", scope, ...form]), form.join(" ")).resolves.toBe(2);
          expect(stderr).toContain("--actor requires a value");
        }
        expect(posts).toEqual([]);
        await expect(bdp(["--scope", scope, "issue", "create", "--", "--actor"])).resolves.toBe(0);
        expect(posts[0]?.body).toEqual({ arguments: { title: "--actor" } });
      });
    });

    it("is refused on a CallableQuery, in every position", async () => {
      await withServe(answered, async (scope, posts) => {
        for (const form of [
          ["--actor", "sam", "issue", "stats"],
          ["issue", "--actor", "sam", "stats"],
          ["issue", "stats", "--actor", "sam"],
          ["--revision-provenance", "{}", "issue", "stats"],
        ]) {
          stderr = "";
          await expect(bdp(["--scope", scope, ...form]), form.join(" ")).resolves.toBe(2);
          expect(stderr).toContain("only to a CallableBatch");
        }
        expect(posts).toEqual([]);
      });
    });

    it("--revision-provenance is a client option before the command, and conflicts as Write's does", async () => {
      await withServe(answered, async (scope, posts) => {
        const supplied = JSON.stringify({ ...sam, message: "why" });
        const form = ["issue", "claim", "a"];
        const flag = "--revision-provenance";
        await expect(bdp(["--scope", scope, flag, supplied, ...form])).resolves.toBe(0);
        await expect(
          bdp(["--scope", scope, flag, supplied, ...form, "--actor", "sam"]),
        ).resolves.toBe(0);
        expect(posts.map(({ body }) => body)).toEqual([
          { arguments: { id: "a" }, revisionProvenance: { ...sam, message: "why" } },
          { arguments: { id: "a" }, revisionProvenance: { ...sam, message: "why" } },
        ]);
        posts.length = 0;
        stderr = "";
        await expect(
          bdp(["--scope", scope, flag, supplied, ...form, "--actor", "kim"]),
        ).resolves.toBe(2);
        expect(stderr).toContain("--actor conflicts with explicit provenance actor");
        stderr = "";
        await expect(bdp(["--scope", scope, ...form, flag, supplied])).resolves.toBe(2);
        expect(stderr).toContain("put --revision-provenance before");
        expect(posts).toEqual([]);
      });
    });

    it("refuses --arguments before the command rather than dropping it", async () => {
      await withServe(answered, async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "--arguments", '{"id":"a"}', "issue", "claim"]),
        ).resolves.toBe(2);
        expect(stderr).toContain("put it after the command");
        expect(posts).toEqual([]);
      });
    });
  });

  it("has help at each level, from the declarations, and refuses an unknown word", async () => {
    await expect(bdp(["--help"])).resolves.toBe(0);
    for (const word of ["issue", "config", "memory", "events"])
      expect(stdout).toMatch(new RegExp(`^  ${word} +The ${word}/ Callables \\(\\d+\\)\\.`, "m"));
    stdout = "";
    await expect(bdp(["issue", "--help"])).resolves.toBe(0);
    expect(stdout).toContain("bdp [client options] issue COMMAND");
    expect(stdout).toMatch(/^ {2}create +.*\(batch\)$/m);
    expect(stdout).toMatch(/^ {2}dep +\d+ commands$/m);
    const groupHelp = stdout;
    stdout = "";
    await expect(bdp(["issue"])).resolves.toBe(0);
    expect(stdout).toBe(groupHelp);
    stdout = "";
    await expect(bdp(["issue", "dep", "-h"])).resolves.toBe(0);
    expect(stdout).toMatch(/^ {2}add +.*\(batch\)$/m);
    expect(stdout).toMatch(/^ {2}tree +.*\(query\)$/m);
    stdout = "";
    await expect(bdp(["--help", "issue", "dep"])).resolves.toBe(0);
    expect(stdout).toMatch(/^ {2}add /m);
    stdout = "";
    stderr = "";
    await expect(bdp(["issue", "secret-typo"])).resolves.toBe(2);
    expect(stderr).toContain("no such command under issue");
    expect(stderr).not.toContain("secret-typo");
    stderr = "";
    await expect(bdp(["no-such-package", "x"])).resolves.toBe(2);
    expect(stderr).not.toContain("no-such-package");
  });

  it("gives a built-in command any collision, and call still reaches the Callable", async () => {
    const shadowing = createStaticCallableCatalog(() => [
      { ...annotated, name: "show", description: "A Callable named as a built-in." },
      { ...annotated, name: "link/show", description: "Under a built-in word." },
      { ...annotated, name: "pack/make", description: "Free." },
    ]);
    const builtIns = new Set(["show", "link"]);
    expect(callableCommandTree(await shadowing.list(), builtIns).shadowed).toEqual([
      "show",
      "link/show",
    ]);
    await withServe(
      () => ({ status: 200, body: { result: 1, changed: true } }),
      async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "call", "link/show", "--arguments", '{"id":"t"}'], shadowing),
        ).resolves.toBe(0);
        await expect(bdp(["--scope", scope, "pack", "make", "t"], shadowing)).resolves.toBe(0);
        expect(posts.map(({ name }) => name)).toEqual(["link/show", "pack/make"]);
        posts.length = 0;
        // The built-in `link show` reads a Resource; it never invokes the Callable.
        await bdp(["--scope", scope, "link", "show", "t"], shadowing);
        await bdp(["--scope", scope, "show", "t"], shadowing);
        expect(posts).toEqual([]);
      },
    );
  });

  it("does not exist under the compat profile", async () => {
    await expect(bdp(["--cli-profile", "compat", "issue", "list"])).resolves.toBe(2);
  });
});

/** Issue §5 and Callables §9, with what `bd serve` adds: title, detail and the v0 body. */
const v0 = (code: string, status: number) => ({
  status,
  title: "v0 title",
  code,
  request_id: "r1",
});
const problem = (
  code: string,
  suffix: string,
  status: number,
  retry: string,
  extra: object = {},
) => ({
  type: `${family}/${suffix}`,
  status,
  title: "HTTP title",
  code,
  retry,
  detail: `what ${code} says`,
  ...extra,
});
const PROBLEMS: readonly (readonly [string, ReturnType<typeof problem>, number])[] = [
  [
    "identity-taken from already_exists",
    problem("identity-taken", "conflict", 409, "after-state-change", {
      v0: v0("already_exists", 409),
    }),
    1,
  ],
  [
    "identity-taken from idempotency_expired",
    problem("identity-taken", "conflict", 409, "after-state-change", {
      v0: v0("idempotency_expired", 410),
    }),
    1,
  ],
  [
    "invalid-parameter from invalid_cursor",
    problem("invalid-parameter", "request", 400, "never", { v0: v0("invalid_cursor", 400) }),
    1,
  ],
  [
    "resource-not-found from not_found",
    problem("resource-not-found", "not-found", 404, "after-state-change", {
      v0: v0("not_found", 404),
    }),
    3,
  ],
  [
    "revision-mismatch from a stale expected_version",
    problem("revision-mismatch", "conflict", 409, "after-state-change", {
      v0: v0("precondition_failed", 412),
    }),
    4,
  ],
  ...(["internal", "busy", "db_unavailable"] as const).map(
    (code) =>
      [
        `temporarily-unavailable from ${code}`,
        problem("temporarily-unavailable", "unavailable", 503, "after-delay", {
          v0: v0(code, 503),
        }),
        1,
      ] as const,
  ),
  [
    "unauthenticated",
    problem("unauthenticated", "authentication", 401, "after-state-change", {
      v0: v0("unauthenticated", 401),
    }),
    1,
  ],
  [
    "validation-failed naming the parameter",
    problem("validation-failed", "validation", 422, "never", {
      diagnostics: [{ message: "`id`: required", instanceLocation: "/arguments/id" }],
    }),
    1,
  ],
  [
    "callable-error whose v0 status differs",
    problem("callable-error", "conflict", 409, "after-state-change", {
      error: { ...v0("already_claimed", 409), assignee: "sam", issue_status: "in_progress" },
    }),
    1,
  ],
  [
    "callable-error with a v0 412",
    problem("callable-error", "conflict", 409, "after-state-change", {
      error: v0("precondition_failed", 412),
    }),
    1,
  ],
  ["callable-not-found", problem("callable-not-found", "not-found", 404, "after-state-change"), 3],
  [
    "callable-unavailable",
    problem("callable-unavailable", "unavailable", 503, "after-state-change"),
    1,
  ],
  ["malformed-request", problem("malformed-request", "request", 400, "never"), 1],
  ["unsupported-media-type", problem("unsupported-media-type", "request", 415, "never"), 1],
  [
    "operation-not-supported",
    problem("operation-not-supported", "request", 422, "after-state-change", {
      operation: "createLink",
    }),
    5,
  ],
];

describe("a failed Callable in human mode", () => {
  const refused = (body: object, args: readonly string[]) =>
    withServe(
      () => ({ status: (body as { status: number }).status, body }),
      async (scope) => {
        await bdp(["--scope", scope, ...args]);
      },
    );
  it("reads as text on stderr, says the detail and where, and prints nothing on stdout", async () => {
    await refused(
      {
        ...problem("validation-failed", "validation", 422, "never"),
        detail: "`title` is required",
        diagnostics: [
          { message: "`title`: `title` is required", instanceLocation: "/arguments/title" },
        ],
      },
      ["issue", "show", "a"],
    );
    expect(stdout).toBe("");
    expect(stderr).toBe("error: validation-failed: `title` is required\n  /arguments/title\n");
  });
  it("points at --actor when who is acting is what is missing", async () => {
    const message = "`revisionProvenance.actor` is required: issue/create has to say who is acting";
    await refused(
      {
        ...problem("validation-failed", "validation", 422, "never"),
        detail: message,
        diagnostics: [{ message, instanceLocation: "/revisionProvenance/actor" }],
      },
      ["issue", "create", "x"],
    );
    expect(stderr).toBe(
      `error: validation-failed: ${message}\n  /revisionProvenance/actor\n  Say who is acting with --actor NAME.\n`,
    );
  });
  it("shows a callable-error's own code, detail and members", async () => {
    await refused(
      {
        ...problem("callable-error", "conflict", 409, "after-state-change"),
        detail: undefined,
        error: {
          status: 409,
          title: "Conflict",
          code: "already_claimed",
          detail: "held by sam",
          assignee: "sam",
        },
      },
      ["issue", "claim", "a", "--actor", "kim"],
    );
    expect(stderr.split("\n").slice(0, 2)).toEqual([
      "error: callable-error: already_claimed: held by sam",
      "  assignee: sam",
    ]);
  });
  it("takes the title when a Problem has no detail, and control characters do not reach the terminal", async () => {
    await refused({ ...problem("malformed-request", "request", 400, "never"), detail: undefined }, [
      "issue",
      "show",
      "a",
    ]);
    expect(stderr).toBe("error: malformed-request: HTTP title\n");
    stderr = "";
    await refused(
      { ...problem("malformed-request", "request", 400, "never"), detail: "bad\u001b[31mred" },
      ["issue", "show", "a"],
    );
    expect(stderr).toBe("error: malformed-request: bad [31mred\n");
  });
  it("says when the outcome is unknown", async () => {
    await withServe(
      () => ({
        status: 503,
        body: problem("temporarily-unavailable", "unavailable", 503, "after-delay"),
      }),
      async (scope) => {
        await expect(bdp(["--scope", scope, "issue", "claim", "a", "--actor", "s"])).resolves.toBe(
          1,
        );
      },
    );
    expect(stderr).toContain("error: temporarily-unavailable: what temporarily-unavailable says");
    expect(stderr).toContain("The outcome is unknown");
  });
  it("says nothing changed after an atomic refusal", async () => {
    await refused(problem("malformed-request", "request", 400, "never"), [
      "issue",
      "comment",
      "a",
      "b",
      "--actor",
      "s",
    ]);
    expect(stderr).toContain("Nothing was changed.");
  });
  it("names the key to recover with", () => {
    expect(
      renderCallableFailure({
        schema_version: 2,
        bdp_spec: null,
        result_kind: "callable_result",
        outcome: "unknown",
        context: { idempotency_key: "k-1" },
        error: { origin: "cli", problem: { code: "write_outcome_unknown", message: "lost" } },
      }),
    ).toBe("error: write_outcome_unknown: lost\n  To recover, repeat with --idempotency-key k-1\n");
  });
  it("a Callable usage refusal is text too, and JSON mode is unchanged", async () => {
    await expect(bdp(["--scope", "http://127.0.0.1:1/", "issue", "show", "--nope"])).resolves.toBe(
      2,
    );
    expect(stderr).toMatch(/^error: invalid_arguments: /);
    expect(stdout).toBe("");
    stderr = "";
    await expect(
      bdp(["--scope", "http://127.0.0.1:1/", "--output-mode", "json", "issue", "show", "--nope"]),
    ).resolves.toBe(2);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      outcome: "failure",
      error: { origin: "cli", problem: { code: "invalid_arguments" } },
    });
  });
});

describe("every Problem shape", () => {
  it.each(PROBLEMS)("%s stays whole on the error path", async (_label, body, exit) => {
    await withServe(
      () => ({ status: body.status, body }),
      async (scope) => {
        await expect(bdp(["--scope", scope, "issue", "show", "a"])).resolves.toBe(exit);
        expect(stdout).toBe("");
        expect(stderr).toMatch(new RegExp(`^error: ${body.code}.*: what ${body.code} says\n`));
        stderr = "";
        await expect(
          bdp([
            "--scope",
            scope,
            "--output-mode",
            "json",
            "call",
            "issue/show",
            "--arguments",
            '{"id":"a"}',
          ]),
        ).resolves.toBe(exit);
        expect(JSON.parse(stdout)).toMatchObject({
          outcome: "failure",
          error: { origin: "bdp", problem: body },
        });
      },
    );
  });

  it("reports effects from the declaration, batch by batch", async () => {
    const internal = PROBLEMS[5]?.[1];
    if (internal === undefined) throw new Error("no 5xx Problem");
    await withServe(
      () => ({ status: internal.status, body: internal }),
      async (scope) => {
        const json = ["--scope", scope, "--output-mode", "json"];
        await expect(bdp([...json, "issue", "comment", "a", "b"])).resolves.toBe(1);
        expect(JSON.parse(stdout)).toMatchObject({
          outcome: "failure",
          context: { effects: "none" },
        });
        stdout = "";
        await expect(bdp([...json, "issue", "claim", "a"])).resolves.toBe(1);
        expect(JSON.parse(stdout)).toMatchObject({ outcome: "unknown" });
        stdout = "";
        await expect(bdp([...json, "issue", "show", "a"])).resolves.toBe(1);
        expect(JSON.parse(stdout)).toMatchObject({ outcome: "failure" });
      },
    );
  });
});

describe("a failure says what happened", () => {
  const message = () => {
    expect(stderr).toMatch(/^error: /);
    expect(stderr).not.toMatch(/command failed$|BDP delivery failed/);
    return stderr;
  };

  it("a service with no BDP discovery: the v0 404 at GET /", async () => {
    await withServe(
      () => ok(),
      async (scope, posts) => {
        await expect(bdp(["--scope", scope, "issue", "stats"])).resolves.toBe(1);
        expect(message()).toContain(`BDP discovery of ${scope} failed`);
        expect(message()).toContain("answered HTTP 404");
        expect(message()).toContain("application/problem+json");
        expect(posts).toEqual([]);
      },
      {
        landing: {
          status: 404,
          body: { status: 404, title: "Not Found", code: "not_found", request_id: "r" },
        },
      },
    );
  });

  it("a bodyless 404 at GET /", async () => {
    await withServe(
      () => ok(),
      async (scope) => {
        await expect(bdp(["--scope", scope, "issue", "stats"])).resolves.toBe(1);
        expect(message()).toContain("answered HTTP 404");
      },
      { landing: { status: 404 } },
    );
  });

  it("a landing with no service-desc Link", async () => {
    await withServe(
      () => ok(),
      async (scope) => {
        await expect(bdp(["--scope", scope, "issue", "stats"])).resolves.toBe(1);
        expect(message()).toContain("service-desc");
      },
      { landing: { status: 200, body: {} } },
    );
  });

  it("a discovery document that is not valid", async () => {
    await withServe(
      () => ok(),
      async (scope) => {
        await expect(bdp(["--scope", scope, "issue", "stats"])).resolves.toBe(1);
        expect(message()).toContain(`${scope}bdp answered HTTP 200`);
      },
      { discovery: { bdpVersion: "0.1" } },
    );
  });

  it("a Scope that does not advertise Callables1", async () => {
    await withServe(
      () => ok(),
      async (scope, posts) => {
        await expect(bdp(["--scope", scope, "issue", "stats"])).resolves.toBe(5);
        expect(stderr).toBe(
          "error: unsupported_capability: the Scope does not advertise Callables1\n",
        );
        expect(posts).toEqual([]);
      },
      { callables: false },
    );
  });

  it("a key against a Scope with no idempotency", async () => {
    await withServe(
      () => ok(),
      async (scope, posts) => {
        await expect(
          bdp(["--scope", scope, "--idempotency-key", "k", "issue", "claim", "a"]),
        ).resolves.toBe(5);
        expect(stderr).toContain("does not advertise idempotency");
        expect(posts).toEqual([]);
      },
    );
  });

  it("a Core Scope admits a batch: only the capability is asked for", async () => {
    await withServe(
      () => ({ status: 200, body: { result: {}, changed: true } }),
      async (scope, posts) => {
        await expect(bdp(["--scope", scope, "issue", "claim", "a"])).resolves.toBe(0);
        expect(posts).toHaveLength(1);
        expect(posts[0]?.key).toBeUndefined();
      },
    );
  });

  it("no service listening at all", async () => {
    await expect(bdp(["--scope", "http://127.0.0.1:9/", "issue", "stats"])).resolves.toBe(1);
    expect(message()).toContain("could not connect");
    expect(message()).toContain("BDP discovery of http://127.0.0.1:9/ failed");
  });

  it.each([
    ["a bodyless 500", { status: 500 }, "answered HTTP 500", "with no Problem body"],
    [
      "an HTML 502",
      { status: 502, body: "<html>private</html>", contentType: "text/html" },
      "answered HTTP 502 (text/html)",
      "not a BDP response",
    ],
    [
      "a Problem body that is not one",
      { status: 409, body: { code: "already_claimed" } },
      "answered HTTP 409",
      "not a BDP Problem",
    ],
    [
      "a 200 that is not a callableResult",
      { status: 200, body: { items: [] } },
      "answered HTTP 200",
      "invalid callableResult",
    ],
  ] as const)("%s from the mount", async (_label, answer, first, second) => {
    await withServe(
      () => answer,
      async (scope) => {
        await expect(bdp(["--scope", scope, "issue", "stats"])).resolves.toBe(1);
        expect(message()).toContain(first);
        expect(message()).toContain(second);
        expect(message()).not.toContain("private");
        // A batch adds that its outcome is unknown, after what happened.
        stderr = "";
        await expect(bdp(["--scope", scope, "issue", "claim", "a"])).resolves.toBe(1);
        expect(message()).toContain(first);
        expect(message()).toContain("outcome is unknown");
      },
    );
  });
});
