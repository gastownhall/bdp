/** The emitted `bdp call`, in its own process, against a local stub that serves Callables.
 * The reference service does not serve them yet, so nothing here touches a real endpoint. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const binary = fileURLToPath(new URL("../apps/bdp/dist/main.js", import.meta.url));
const media = "application/vnd.bdp.v0.1+json";
const family = "https://github.com/gastownhall/bdp/problems";
const answers = {
  "issue/ready": { status: 200, body: { result: { items: [], has_more: false } } },
  "issue/close": { status: 200, body: { result: { ok: true }, changed: true } },
  "issue/create": { status: 200, body: { result: { id: "bd-1" }, changed: true } },
  "issue/claim": {
    status: 409,
    body: {
      type: `${family}/conflict`,
      status: 409,
      code: "callable-error",
      retry: "after-state-change",
      error: { reason: "already-claimed", assignee: "kim" },
    },
  },
  "issue/stats": {
    status: 503,
    body: {
      type: `${family}/unavailable`,
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    },
  },
};
const posts = [];
let scope;
let server;
let home;

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), "bdp-call-built-"));
  server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url, scope).href;
      if (request.method === "POST") {
        const name = url.slice(`${scope}bdp/call/`.length);
        posts.push({
          name,
          key: request.headers["idempotency-key"],
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        const { status, body } = answers[name];
        response.writeHead(status, {
          "content-type": status === 200 ? media : "application/problem+json",
        });
        response.end(JSON.stringify(body));
      } else if (url === scope) {
        response.writeHead(204, {
          link: `<${scope}bdp/discovery>; rel="service-desc"; type="${media}"`,
        });
        response.end();
      } else {
        response.writeHead(200, { "content-type": media });
        response.end(
          JSON.stringify({
            bdpVersion: "0.1",
            profile: "core",
            scope,
            specRevision: "0123456789abcdef0123456789abcdef01234567",
            capabilities: {
              "https://github.com/gastownhall/bdp/capabilities/callables": { 1: {} },
            },
          }),
        );
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  scope = `http://127.0.0.1:${server.address().port}/local-test/`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(home, { recursive: true, force: true });
});

function bdp(args, stdin) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("BDP_")),
  );
  Object.assign(env, { XDG_CONFIG_HOME: home, XDG_STATE_HOME: home });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binary, ...args], { env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(stdin);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("the emitted executable finds its packaged catalog and lists all 45 names", async () => {
  const { status, stdout } = await bdp(["call"]);
  assert.equal(status, 0);
  assert.equal(stdout.trim().split("\n").length, 45);
  assert.match(stdout, /^issue\/claim +batch$/m);
});
test("help after NAME needs no Scope and invokes nothing", async () => {
  const before = posts.length;
  const { status, stdout } = await bdp(["call", "issue/claim", "--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /id: text/);
  assert.match(stdout, /code: already_claimed, not_claimable/);
  assert.equal(posts.length, before);
});
test("a query omits what is omitted and sends a defaulted flag when given", async () => {
  const { status, stdout, stderr } = await bdp([
    "--scope",
    scope,
    "call",
    "issue/ready",
    "--arguments",
    '{"brief":true,"label":["a","b"]}',
  ]);
  assert.equal(stderr, "");
  assert.equal(status, 0);
  assert.equal(stdout, "items: (none)\nhas_more: false\n");
  assert.deepEqual(posts.at(-1), {
    name: "issue/ready",
    key: undefined,
    body: { arguments: { brief: true, label: ["a", "b"] } },
  });
});
test("a batch sends --arguments as given and carries the actor", async () => {
  const { status } = await bdp([
    "--scope",
    scope,
    "--actor",
    "sam",
    "call",
    "issue/close",
    "--arguments",
    '{"id":"bd-1","reason":"new"}',
  ]);
  assert.equal(status, 0);
  assert.deepEqual(posts.at(-1), {
    name: "issue/close",
    key: undefined,
    body: {
      arguments: { id: "bd-1", reason: "new" },
      revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
    },
  });
});
test("a callable-error shows its error value on stderr and exits 1", async () => {
  const { status, stdout, stderr } = await bdp([
    "--scope",
    scope,
    "call",
    "issue/claim",
    "--arguments",
    '{"id":"bd-1"}',
  ]);
  assert.equal(status, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^error: callable-error/);
  assert.match(stderr, /^ {2}assignee: kim$/m);
  const structured = await bdp([
    "--scope",
    scope,
    "--output-mode",
    "json",
    "call",
    "issue/claim",
    "--arguments",
    '{"id":"bd-1"}',
  ]);
  assert.equal(structured.status, 1);
  assert.deepEqual(JSON.parse(structured.stdout).error.problem.error, {
    reason: "already-claimed",
    assignee: "kim",
  });
});
test("a 5xx carries no error member and is a different diagnosis at the same status", async () => {
  const { status, stderr } = await bdp(["--scope", scope, "call", "issue/stats"]);
  assert.equal(status, 1);
  assert.match(stderr, /^error: temporarily-unavailable/);
  const structured = await bdp(["--scope", scope, "--output-mode", "json", "call", "issue/stats"]);
  const { problem } = JSON.parse(structured.stdout).error;
  assert.equal(problem.code, "temporarily-unavailable");
  assert.equal(Object.hasOwn(problem, "error"), false);
});
test("a name outside the catalog is a usage error with no request", async () => {
  const before = posts.length;
  const { status } = await bdp(["--scope", scope, "call", "not-a-callable"]);
  assert.equal(status, 2);
  assert.equal(posts.length, before);
});
test("the induced tree mounts each name, with help at every level and no Scope", async () => {
  const root = await bdp(["--help"]);
  assert.equal(root.status, 0);
  assert.match(root.stdout, /^ {2}issue +The issue\/ Callables \(\d+\)\.$/m);
  const group = await bdp(["issue", "dep", "--help"]);
  assert.equal(group.status, 0);
  assert.match(group.stdout, /^ {2}add +.*\(batch\)$/m);
  const leaf = await bdp(["issue", "create", "--help"]);
  assert.equal(leaf.status, 0);
  assert.match(leaf.stdout, /bdp \[client options\] issue create TITLE \[callable arguments\]/);
  assert.match(leaf.stdout, /--body-file PATH/);
});
test("a tree command is the same invocation as call, and reads stdin for a fromFile flag", async () => {
  const { status, stderr, stdout } = await bdp(
    [
      "--scope",
      scope,
      "issue",
      "create",
      "Fix login",
      "-p",
      "1",
      "--body-file",
      "-",
      "--actor",
      "s",
    ],
    "from stdin\n",
  );
  assert.equal(stderr, "");
  assert.equal(status, 0);
  assert.equal(stdout, "changed: true\nid: bd-1\n");
  assert.deepEqual(posts.at(-1).body, {
    arguments: { title: "Fix login", priority: 1, description: "from stdin\n" },
    revisionProvenance: { actor: { id: "s", basis: "writer-supplied" } },
  });
});
test("--actor before a tree command is the same attribution, and two values are refused", async () => {
  const form = ["issue", "create", "Fix login"];
  const before = await bdp(["--scope", scope, "--actor", "sam", ...form]);
  assert.equal(before.stderr, "");
  assert.equal(before.status, 0);
  assert.deepEqual(posts.at(-1).body, {
    arguments: { title: "Fix login" },
    revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
  });
  const sent = posts.length;
  const two = await bdp(["--scope", scope, "--actor", "sam", ...form, "--actor", "kim"]);
  assert.equal(two.status, 2);
  assert.match(two.stderr, /--actor was given with two different values/);
  assert.equal(posts.length, sent);
});
test("a query refuses --actor before and after a tree command, and on call", async () => {
  const sent = posts.length;
  for (const form of [
    ["--actor", "sam", "issue", "ready"],
    ["issue", "ready", "--actor", "sam"],
    ["call", "issue/ready", "--actor", "sam"],
  ]) {
    const { status } = await bdp(["--scope", scope, ...form]);
    assert.equal(status, 2, form.join(" "));
  }
  assert.equal(posts.length, sent);
});
test("no default is filled in: call sends {} and the tree sends only what it was told", async () => {
  await bdp(["--scope", scope, "call", "issue/ready"]);
  assert.deepEqual(posts.at(-1).body, { arguments: {} });
  await bdp(["--scope", scope, "issue", "close", "bd-1", "--actor", "sam"]);
  assert.deepEqual(posts.at(-1).body, {
    arguments: { id: "bd-1" },
    revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
  });
});
test("a failure with no Problem says what happened, in its own process", async () => {
  const { status, stderr } = await bdp(["--scope", "http://127.0.0.1:9/", "issue", "stats"]);
  assert.equal(status, 1);
  assert.match(stderr, /^error: delivery_failed: .*could not connect/);
});
