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
  "list-ready-work": { status: 200, body: { result: { items: [], has_more: false } } },
  "close-issue": { status: 200, body: { result: { ok: true }, changed: true } },
  "claim-issue": {
    status: 409,
    body: {
      type: `${family}/conflict`,
      status: 409,
      code: "callable-error",
      retry: "after-state-change",
      error: { reason: "already-claimed", assignee: "kim" },
    },
  },
  "get-stats": {
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
            profile: "write",
            scope,
            specRevision: "0123456789abcdef0123456789abcdef01234567",
            operations: `${scope}bdp/write`,
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

function bdp(args) {
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
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("the emitted executable finds its packaged catalog and lists all 39 names", async () => {
  const { status, stdout } = await bdp(["call"]);
  assert.equal(status, 0);
  assert.equal(stdout.trim().split("\n").length, 39);
  assert.match(stdout, /^claim-issue +batch$/m);
});
test("help after NAME needs no Scope and invokes nothing", async () => {
  const before = posts.length;
  const { status, stdout } = await bdp(["call", "claim-issue", "--help"]);
  assert.equal(status, 0);
  assert.match(stdout, /--issue TEXT/);
  assert.match(stdout, /reason "already-claimed"/);
  assert.equal(posts.length, before);
});
test("a query omits what is omitted and sends a defaulted flag when given", async () => {
  const { status, stdout, stderr } = await bdp([
    "--scope",
    scope,
    "call",
    "list-ready-work",
    "--brief",
    "--label",
    "a",
    "--label",
    "b",
  ]);
  assert.equal(stderr, "");
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(stdout), { result: { items: [], has_more: false } });
  assert.deepEqual(posts.at(-1), {
    name: "list-ready-work",
    key: undefined,
    body: { arguments: { brief: true, label: ["a", "b"] } },
  });
});
test("a batch merges --arguments with an overriding flag and carries the actor", async () => {
  const { status } = await bdp([
    "--scope",
    scope,
    "--actor",
    "sam",
    "call",
    "close-issue",
    "--arguments",
    '{"issue":"bd-1","reason":"old"}',
    "--reason",
    "new",
  ]);
  assert.equal(status, 0);
  assert.deepEqual(posts.at(-1), {
    name: "close-issue",
    key: undefined,
    body: {
      arguments: { issue: "bd-1", reason: "new" },
      revisionProvenance: { actor: { id: "sam", basis: "writer-supplied" } },
    },
  });
});
test("a callable-error shows its error value on stderr and exits 1", async () => {
  const { status, stdout, stderr } = await bdp([
    "--scope",
    scope,
    "call",
    "claim-issue",
    "--issue",
    "bd-1",
  ]);
  assert.equal(status, 1);
  assert.equal(stdout, "");
  assert.deepEqual(JSON.parse(stderr).error.problem.error, {
    reason: "already-claimed",
    assignee: "kim",
  });
});
test("a 5xx carries no error member and is a different diagnosis at the same status", async () => {
  const { status, stderr } = await bdp(["--scope", scope, "call", "get-stats"]);
  assert.equal(status, 1);
  const { problem } = JSON.parse(stderr).error;
  assert.equal(problem.code, "temporarily-unavailable");
  assert.equal(Object.hasOwn(problem, "error"), false);
});
test("a name outside the catalog is a usage error with no request", async () => {
  const before = posts.length;
  const { status } = await bdp(["--scope", scope, "call", "not-a-callable"]);
  assert.equal(status, 2);
  assert.equal(posts.length, before);
});
