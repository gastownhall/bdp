/** The Callable and Issue rows, over real HTTP: the reference, and mutants of its answers. */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  provision,
  provisionWithIssuePackage,
  provisionReference,
} from "./current-provider-callables-adapter.mjs";
import { directScopeProvider, runCurrentProvider } from "./current-provider-kit.mjs";

const stateOf = (report, row) => report.optional.find((entry) => entry.row === row)?.state;
const cbRows = Array.from({ length: 14 }, (_, index) => `CB-${index + 1}`);
const itRows = Array.from({ length: 15 }, (_, index) => `IT-${index + 1}`);
const media = "application/vnd.bdp.v0.1+json";

/**
 * The reference behind a proxy that rewrites one answer, so an assertion is seen to fire. A
 * mutant may also act on the upstream first (`before`), to fake what an operation really did.
 */
function mutant(rewrite, before, base = provision) {
  return async (context) => {
    const provider = await base(context);
    const upstream = new URL(provider.connections[0].connectOrigin);
    const authorization = provider.connections[0].authorization;
    const send = (method, url, headers, body) =>
      new Promise((resolve, reject) => {
        const forward = http.request(
          {
            hostname: upstream.hostname,
            port: upstream.port,
            method,
            path: url,
            headers: { ...headers, authorization },
          },
          (reply) => {
            const chunks = [];
            reply.on("data", (chunk) => chunks.push(chunk));
            reply.on("end", () =>
              resolve({
                status: reply.statusCode,
                headers: reply.headers,
                text: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        forward.on("error", reject);
        forward.end(body);
      });
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      await before?.({
        method: request.method,
        url: request.url,
        body,
        send,
        headers: request.headers,
      });
      const reply = await send(request.method, request.url, request.headers, body);
      let json;
      try {
        json = reply.text ? JSON.parse(reply.text) : undefined;
      } catch {}
      const changed = rewrite?.({
        method: request.method,
        url: request.url,
        status: reply.status,
        json,
      });
      const text = changed === undefined ? reply.text : JSON.stringify(changed.json);
      const headers = { ...reply.headers };
      delete headers["content-length"];
      response.writeHead(changed?.status ?? reply.status, headers);
      response.end(request.method === "HEAD" ? undefined : text);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      ...provider,
      connections: [
        { ...provider.connections[0], connectOrigin: `http://127.0.0.1:${server.address().port}` },
      ],
      restart: undefined,
      conditions: undefined,
      async cleanup() {
        await new Promise((resolve) => server.close(resolve));
        server.closeAllConnections();
        await provider.cleanup();
      },
    };
  };
}

test("the reference with the mechanism passes every CB row; the Issue rows do not apply", async () => {
  const report = await runCurrentProvider(provision);
  assert.equal(report.state, "incomplete", JSON.stringify(report.optional));
  assert.equal(report.claimEligible, false);
  assert.equal(report.qualificationComplete, false);
  assert.equal(report.sliceComplete, true);
  for (const row of cbRows) assert.equal(stateOf(report, row), "pass", row);
  assert.equal(stateOf(report, "callables.mount-method-and-media"), "pass");
  assert.equal(stateOf(report, "callables.invocation-closed"), "pass");
  for (const row of [...itRows, "IC-1", "IC-2"])
    assert.equal(stateOf(report, row), "not-applicable", row);
});

test("the Issue package: IT rows pass, and IC rows fail while the 45 names are not served", async () => {
  const report = await runCurrentProvider(provisionWithIssuePackage);
  for (const row of [...cbRows, ...itRows]) assert.equal(stateOf(report, row), "pass", row);
  assert.equal(stateOf(report, "IC-1"), "fail");
  assert.equal(stateOf(report, "IC-2"), "fail");
  assert.match(report.optional.find((row) => row.row === "IC-1").reason, /45 of 45/);
  assert.equal(report.state, "fail");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("a Scope advertising no Callables has none of those rows passed", async () => {
  const { provision: plain } = await import("./current-provider-reference-adapter.mjs");
  const report = await runCurrentProvider(plain);
  for (const row of [...cbRows, "IC-1", "IC-2"]) {
    assert.equal(stateOf(report, row), "not-applicable", row);
    assert.match(report.optional.find((entry) => entry.row === row).reason, /Callables1|Issue/);
  }
});

test("a row in the exceptions ledger is excepted, whatever it observed, and never passed", async () => {
  const report = await runCurrentProvider(
    provisionReference({ issuePackage: true }, { issuePackage: true, takesNoExceptions: false }),
    {
      exceptions: { "CB-1": "a passing row stays excepted", "IC-1": "not served yet" },
    },
  );
  const passing = report.optional.find((row) => row.row === "CB-1");
  assert.equal(passing.state, "excepted");
  assert.equal(passing.observed, "pass");
  assert.equal(passing.reason, "a passing row stays excepted");
  const failing = report.optional.find((row) => row.row === "IC-1");
  assert.equal(failing.state, "excepted");
  assert.equal(failing.observed, "fail");
  assert.equal(stateOf(report, "IC-2"), "fail");
});

test("the reference takes no exceptions: a ledger is refused before anything counts", async () => {
  const report = await runCurrentProvider(provision, { exceptions: { "CB-1": "no" } });
  assert.equal(report.state, "harness-error");
  assert.match(report.harnessFailure, /takes no exceptions/);
  assert.equal(report.lifecycle.cleanup, "pass");
});

const withoutLength = ({ "content-length": _length, ...headers }) => headers;
const isDiscovery = (url) => /\/bdp$/.test(url);
const isOpenApi = (url) => /\/bdp\/call$/.test(url);
const firstPost = (json) => Object.values(json.paths)[0].post;
for (const [row, label, rewrite, before] of [
  [
    "CB-1",
    "detail that is not empty",
    ({ url, json }) => {
      if (!isDiscovery(url)) return undefined;
      const capabilities = {
        ...json.capabilities,
        "https://github.com/gastownhall/bdp/capabilities/callables": { 1: { mounts: "x" } },
      };
      return { json: { ...json, capabilities } };
    },
  ],
  [
    "CB-2",
    "a declaration carrying a body",
    ({ url, json, method }) =>
      method === "GET" && /\/witness\/echo$/.test(url)
        ? { json: { ...json, properties: { ...json.properties, body: {} } } }
        : undefined,
  ],
  [
    "CB-3",
    "a query's result that claims `changed`",
    ({ url, json, status }) =>
      /\/bdp\/call\/witness\/echo$/.test(url) && status === 200
        ? { json: { ...json, changed: false } }
        : undefined,
  ],
  [
    "CB-4",
    "an unknown argument accepted",
    ({ url, status }) =>
      /\/bdp\/call\//.test(url) && status === 422
        ? { status: 200, json: { result: {} } }
        : undefined,
  ],
  [
    "CB-6",
    "an absent name answered as a plain resource",
    ({ url, json }) =>
      /\/bdp\/call\/bdp-kit-absent/.test(url)
        ? { json: { ...json, code: "resource-not-found" } }
        : undefined,
  ],
  [
    "CB-7",
    "a replay that is not the original",
    (() => {
      let seen = 0;
      return ({ url, json, status }) =>
        /\/bdp\/call\/reserve-room$/.test(url) && status === 200 && ++seen === 2
          ? { json: { ...json, result: { ...json.result, already_held: true } } }
          : undefined;
    })(),
  ],
  [
    "CB-8",
    "a query that really mutates",
    undefined,
    async ({ url, send, headers }) => {
      if (!/\/bdp\/call\/witness\/needs-value$/.test(url)) return;
      const body = JSON.stringify({
        type: "https://current-provider.invalid/types/WitnessRecord",
        properties: {},
        metadata: {},
      });
      const path = url.replace(/\/bdp\/call\/.*$/, "/bdp/operations/createBead");
      await send(
        "POST",
        path,
        { ...withoutLength(headers), "content-type": media, "idempotency-key": `m-${Date.now()}` },
        body,
      );
    },
  ],
  [
    "CB-9",
    "no implementation answered as success",
    ({ url, status }) =>
      /\/bdp\/call\/witness\/unbuilt$/.test(url) && status === 503
        ? { status: 200, json: { result: null } }
        : undefined,
  ],
  [
    "CB-10",
    "an operation's error without its value",
    ({ json, status }) => {
      if (status !== 409 || json?.code !== "callable-error") return undefined;
      const { error: _error, ...rest } = json;
      return { json: rest };
    },
  ],
  [
    "CB-11",
    "a declaration read served as something other than a Bead record",
    ({ url, method, json }) =>
      method === "GET" && /\/witness\/echo$/.test(url)
        ? { json: { ...json, id: "http://x.invalid/" } }
        : undefined,
  ],
  [
    "CB-13",
    "an atomic Problem that left something behind",
    undefined,
    async ({ url, send, headers }) => {
      if (!/\/bdp\/call\/witness\/fails-after-effects$/.test(url)) return;
      const body = JSON.stringify({
        type: "https://current-provider.invalid/types/WitnessRecord",
        properties: {},
        metadata: {},
      });
      const path = url.replace(/\/bdp\/call\/.*$/, "/bdp/operations/createBead");
      await send(
        "POST",
        path,
        { ...withoutLength(headers), "content-type": media, "idempotency-key": `a-${Date.now()}` },
        body,
      );
    },
  ],
  [
    "CB-14",
    "an operationId outside §14's rule",
    ({ url, method, json }) => {
      if (method !== "GET" || !isOpenApi(url)) return undefined;
      firstPost(json).operationId = "somethingElse";
      return { json };
    },
  ],
])
  test(`${row} fails on ${label}`, async () => {
    const report = await runCurrentProvider(mutant(rewrite, before));
    assert.equal(
      stateOf(report, row),
      "fail",
      JSON.stringify(report.optional.find((r) => r.row === row)),
    );
    assert.equal(report.state, "fail");
    assert.equal(report.lifecycle.cleanup, "pass");
  });

for (const [row, label, rewrite] of [
  [
    "IT-1",
    "a record with issue_type",
    ({ json, url }) =>
      /\/bdp\/beads/.test(url) && Array.isArray(json?.items)
        ? {
            json: {
              ...json,
              items: json.items.map((item) =>
                item.type.endsWith("/issue/task")
                  ? { ...item, properties: { ...item.properties, issue_type: "task" } }
                  : item,
              ),
            },
          }
        : undefined,
  ],
  [
    "IT-14",
    "a record with a lease",
    ({ json, url }) =>
      /\/bdp\/beads/.test(url) && Array.isArray(json?.items)
        ? {
            json: {
              ...json,
              items: json.items.map((item) =>
                item.type.endsWith("/issue/task")
                  ? { ...item, properties: { ...item.properties, lease_expires_at: "x" } }
                  : item,
              ),
            },
          }
        : undefined,
  ],
  [
    "IT-11",
    "a labels-only update with the old revision",
    (() => {
      let last;
      return ({ url, json }) => {
        if (!/updateBead$/.test(url) && json?.resource !== undefined) last = json.resource.revision;
        return /updateBead$/.test(url) && json?.resource !== undefined
          ? { json: { ...json, resource: { ...json.resource, revision: last } } }
          : undefined;
      };
    })(),
  ],
  [
    "IT-13",
    "a family read that drops a classification",
    ({ url, json }) =>
      /conformsTo=/.test(url) ? { json: { ...json, items: json.items.slice(1) } } : undefined,
  ],
])
  test(`${row} fails on ${label}`, async () => {
    const report = await runCurrentProvider(mutant(rewrite, undefined, provisionWithIssuePackage));
    assert.equal(
      stateOf(report, row),
      "fail",
      JSON.stringify(report.optional.find((r) => r.row === row)),
    );
  });

test("without --allow-mutation a mutating row is not-run, and sends nothing that mutates", async () => {
  const seen = [];
  const report = await runCurrentProvider(
    mutant(undefined, async ({ method, url }) => {
      if (method === "POST") seen.push(url);
    }),
    { allowMutation: false },
  );
  assert.equal(stateOf(report, "CB-7"), "not-run");
  assert.equal(stateOf(report, "CB-10"), "not-run");
  assert.equal(stateOf(report, "CB-13"), "not-run");
  assert.equal(stateOf(report, "CB-3"), "pass");
  assert.equal(stateOf(report, "CB-12"), "not-run");
  assert.deepEqual(
    seen.filter((url) => /operations/.test(url) || /reserve-room|fails-after/.test(url)),
    [],
  );
});

/** A provider advertising Core and Callables, whose one query answers; records are seeded. */
async function coreIssueProvider() {
  const issue = "https://github.com/gastownhall/bdp/types/issue/task";
  let scope;
  const server = http.createServer((request, response) => {
    const send = (status, value, headers = {}) => {
      response.writeHead(status, {
        "content-type": status >= 400 ? "application/problem+json" : media,
        "cache-control": "private, no-store",
        ...headers,
      });
      response.end(JSON.stringify(value));
    };
    const description = `<${scope}bdp>; rel="service-desc"; type="${media}"`;
    const bead = {
      id: `${scope}bd-1`,
      type: issue,
      revision: "r1",
      properties: { title: "seeded", status: "open", priority: 2 },
      metadata: {},
    };
    if (request.url === "/") {
      response.writeHead(204, { link: description });
      response.end();
    } else if (request.url === "/bdp")
      send(200, { bdpVersion: "0.1", profile: "core", scope, specRevision: "0".repeat(40) });
    else if (request.url.startsWith("/bdp/beads"))
      send(
        200,
        { items: [bead], next: null },
        { "bdp-collection-kind": "bead", link: description },
      );
    else if (request.url.startsWith("/bdp/links"))
      send(200, { items: [], next: null }, { "bdp-collection-kind": "link", link: description });
    else if (request.url === "/bd-1")
      send(200, bead, { "bdp-resource-kind": "bead", etag: '"r1"', link: description });
    else
      send(404, {
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        status: 404,
        code: "resource-not-found",
        retry: "after-state-change",
      });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  scope = `http://127.0.0.1:${server.address().port}/`;
  return { scope, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("a Write-dependent Issue row on a Core Scope is not applicable by discovery, never a pass", async () => {
  const provider = await coreIssueProvider();
  try {
    const report = await runCurrentProvider(directScopeProvider(provider.scope), {
      allowMutation: true,
    });
    assert.equal(stateOf(report, "IT-1"), "pass");
    assert.equal(stateOf(report, "IT-14"), "pass");
    for (const row of [
      "IT-3",
      "IT-4",
      "IT-5",
      "IT-6",
      "IT-7",
      "IT-8",
      "IT-9",
      "IT-10",
      "IT-11",
      "IT-12",
    ]) {
      assert.equal(stateOf(report, row), "not-applicable", row);
      assert.match(report.optional.find((entry) => entry.row === row).reason, /by discovery/);
    }
    for (const row of [...cbRows, "IC-1", "IC-2"])
      assert.equal(stateOf(report, row), "not-applicable", row);
  } finally {
    await provider.close();
  }
});
