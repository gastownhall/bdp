#!/usr/bin/env node

// Controlled HTTP responses exercise the actual SDK; this is not a History server.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BdpClient,
  createFetchTransport,
  isBdpClientProblem,
} from "../packages/client/dist/index.js";

// These script-local helpers are exported for deterministic lifecycle controls.
export async function listenFixture(server, signal) {
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const detach = () => {
      signal.removeEventListener("abort", onAbort);
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
    };
    const onAbort = () => {
      detach();
      reject(signal.reason);
    };
    const onError = (error) => {
      detach();
      reject(error);
    };
    const onListening = () => {
      detach();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      signal.throwIfAborted();
      server.listen({ host: "127.0.0.1", port: 0, signal });
    } catch (error) {
      detach();
      reject(error);
    }
  });
}

export async function publishHistoryResult(output, result, transcript) {
  const ending = result.successful
    ? [
        "PASS: five SDK observations, seven actual HTTP requests; client and owned listener closed.",
        "This controlled History HTTP fixture using the actual BDP SDK does not establish Beads retention, graph authority, or full History conformance.",
      ]
    : [`FAIL: ${result.failure ?? result.cleanup.join("; ")}`];
  await writeFile(path.join(output, "http.json"), `${JSON.stringify(result.http, null, 2)}\n`);
  await writeFile(
    path.join(output, "transcript.txt"),
    `${[...transcript, ...ending].join("\n")}\n`,
  );
  // Publish the final result last. Never announce success before all evidence writes.
  await writeFile(path.join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  for (const line of ending) process.stdout.write(`${line}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0] || !path.isAbsolute(args[0])) {
    throw new Error("Usage: node scripts/demo-history.mjs ABSOLUTE_NEW_OUTPUT_DIRECTORY");
  }
  const output = args[0];
  await mkdir(output, { mode: 0o700 });
  const provenance = "controlled History HTTP fixture using the actual BDP SDK";
  const http = [];
  const observations = [];
  const transcript = [];
  const cleanup = [];
  const sockets = new Set();
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("demo exceeded 20 seconds")),
    20_000,
  );
  const interrupt = () => controller.abort(new Error("demo interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let server;
  let client;
  let scope;
  let failure;
  let completed = false;

  function say(text) {
    transcript.push(text);
    process.stdout.write(`${text}\n`);
  }
  function errorText(error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  async function history(request, continuationScope) {
    controller.signal.throwIfAborted();
    const value = await client.performHistory(request, {
      signal: controller.signal,
      ...(continuationScope === undefined ? {} : { continuationScope }),
    });
    observations.push({ request, problem: isBdpClientProblem(value), value });
    controller.signal.throwIfAborted();
    return value;
  }
  try {
    const routes = new Map();
    server = createServer((request, response) => {
      const route = request.method === "GET" ? routes.get(request.url) : undefined;
      const status = route?.status ?? 404;
      const headers = route?.headers ?? { "content-type": "application/json" };
      const body = route?.body ?? null;
      const payload = body === null ? null : JSON.stringify(body);
      response.writeHead(status, headers);
      http.push({
        method: request.method,
        target: request.url,
        status: response.statusCode,
        headers: { ...headers },
        payload,
        body: payload === null ? null : JSON.parse(payload),
      });
      response.end(payload ?? undefined);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    server.on("error", (error) => controller.abort(error));
    await listenFixture(server, controller.signal);
    scope = `http://127.0.0.1:${server.address().port}/history-demo/`;
    const subject = `${scope}beads/decision`;
    const linkId = `${scope}links/citation`;
    const oldRevision = "r +/%?&雪";
    const target = (url) => {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    };
    const add = (url, body, status = 200) => {
      routes.set(target(url), {
        status,
        headers: {
          "content-type": status === 409 ? "application/problem+json" : "application/json",
        },
        body,
      });
    };
    routes.set(target(scope), {
      status: 204,
      headers: { link: `<${scope}bdp.json>; rel="service-desc"` },
      body: null,
    });
    // Deliberate demo data, based on the protocol's illustrative wire shapes.
    // Kept here so future edits to shared fixtures cannot change this walkthrough.
    const changeContext = {
      committedAt: { state: "present", value: "2026-09-09T14:00:00Z" },
      agent: { state: "present", value: "assistant-a" },
      message: { state: "absent" },
    };
    const attribution = { principal: "donna", status: "claimed" };
    add(`${scope}bdp.json`, {
      bdpVersion: "0",
      profile: "read",
      historicalResolution: { version: 1 },
      scope,
      beads: `${scope}beads/`,
      links: `${scope}links/`,
      types: `${scope}types/`,
      aliases: `${scope}alias/`,
    });
    const first = {
      subject,
      population: "all-retained",
      participation: "tracked",
      window: { newest: "r4", oldest: oldRevision, complete: true },
      items: [
        { revision: "r4", lineage: "current", body: "complete", changeContext },
        { revision: "r3", lineage: "replaced", body: "complete" },
      ],
      next: `${subject}?view=versions&cursor=page-2&limit=2`,
    };
    const second = {
      ...first,
      items: [
        { revision: "r2", lineage: "replaced", body: "incomplete" },
        { revision: oldRevision, lineage: "current", body: "complete" },
      ],
      next: null,
    };
    add(`${subject}?view=versions&limit=2`, first);
    add(first.next, second);
    const bead = {
      id: subject,
      type: "https://work.example/types/decision",
      revision: oldRevision,
      properties: { title: "Original plan: launch on Monday" },
      attribution,
      changeContext,
    };
    const oldLink = {
      id: linkId,
      type: "https://work.example/types/cites",
      revision: "link-old",
      source: subject,
      target: { uri: `${scope}beads/target`, revision: "target%2Fold" },
      properties: { opaque: { $ref: "not-a-protocol-reference" } },
      attribution,
      changeContext,
    };
    const revisionUrl = (id, revision) => `${id}?${new URLSearchParams({ revision })}`;
    add(revisionUrl(subject, oldRevision), bead);
    add(revisionUrl(linkId, "link-old"), oldLink);
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "revision-unretained",
      status: 409,
      retry: "after-state-change",
      missing: {
        complete: false,
        items: [
          { kind: "property", pointer: "/properties/title" },
          { kind: "owned-links", type: "https://work.example/types/cites" },
        ],
      },
    };
    add(revisionUrl(subject, "r2"), problem, 409);

    client = new BdpClient({
      scope,
      transport: createFetchTransport(fetch, { responseTimeoutMs: 3000 }),
    });
    say(`This is a ${provenance}. The Beads engine does not serve this History route yet.`);
    const owner = client.createContinuationScope();
    const versions = { kind: "versions", resource: "bead", id: subject };
    const page1 = await history({ ...versions, limit: 2 }, owner);
    assert.deepEqual(page1, first);
    say(
      `1. First page: ${page1.items.map((item) => `${item.revision} (${item.lineage})`).join(", ")}.`,
    );
    const page2 = await history({ ...versions, continuation: page1.next }, owner);
    assert.deepEqual(page2, second);
    say(
      `2. We explicitly follow the returned next link: ${page2.items.map((item) => `${item.revision} (${item.lineage}, ${item.body})`).join(", ")}.`,
    );
    say("   These are returned lineage labels and display order, not an inferred ancestry chain.");
    const old = await history({
      kind: "revision",
      resource: "bead",
      id: subject,
      revision: oldRevision,
    });
    assert.deepEqual(old, bead);
    say(`3. The selected old record says: ${JSON.stringify(old.properties.title)}.`);
    say(
      `   Its revision is ${JSON.stringify(old.revision)}; recorded agent is ${JSON.stringify(old.changeContext.agent.value)}.`,
    );
    const link = await history({
      kind: "revision",
      resource: "link",
      id: linkId,
      revision: "link-old",
    });
    assert.deepEqual(link, oldLink);
    say(
      `4. We separately request an old Link. Its target pin is still ${JSON.stringify(link.target.revision)}. No target is fetched.`,
    );
    const missing = await history({
      kind: "revision",
      resource: "bead",
      id: subject,
      revision: "r2",
    });
    assert(isBdpClientProblem(missing));
    assert.deepEqual(missing, problem);
    say(
      `5. Reading r2 returns ${missing.status} ${missing.code}: ${missing.missing.items.length} missing-content entries, inventory complete=${missing.missing.complete}.`,
    );
    say("   The SDK returns that explanation; it does not substitute today's record.");
    const expectedUrls = [
      scope,
      `${scope}bdp.json`,
      `${subject}?view=versions&limit=2`,
      first.next,
      revisionUrl(subject, oldRevision),
      revisionUrl(linkId, "link-old"),
      revisionUrl(subject, "r2"),
    ];
    assert.deepEqual(
      http.map((entry) => [entry.method, entry.target]),
      expectedUrls.map((url) => ["GET", target(url)]),
    );
    const actualQuery = new URL(http[4].target, scope).searchParams;
    assert.deepEqual(actualQuery.getAll("revision"), [oldRevision]);
    assert.deepEqual(
      observations.map((entry) => entry.value),
      http.slice(2).map((entry) => entry.body),
    );
    controller.signal.throwIfAborted();
    completed = true;
  } catch (error) {
    failure = errorText(controller.signal.aborted ? controller.signal.reason : error);
  } finally {
    // Stop admission and close only our sockets before waiting for SDK/server disposal.
    const closing = server?.listening
      ? new Promise((resolve) =>
          server.close((error) => {
            if (error) cleanup.push(errorText(error));
            resolve();
          }),
        )
      : Promise.resolve();
    for (const socket of sockets) socket.destroy();
    let cleanupTimer;
    try {
      // Timeout is a recorded cleanup failure, never proof of settlement.
      const results = await Promise.race([
        Promise.allSettled([client?.close(), closing]),
        new Promise((_, reject) => {
          cleanupTimer = setTimeout(
            () => reject(new Error("demo cleanup exceeded 5 seconds; settlement unconfirmed")),
            5000,
          );
        }),
      ]);
      for (const result of results)
        if (result.status === "rejected") cleanup.push(errorText(result.reason));
    } catch (error) {
      cleanup.push(errorText(error));
    } finally {
      clearTimeout(cleanupTimer);
    }
    if (server?.listening) cleanup.push("HTTP listener is still open");
    if (controller.signal.aborted && failure === undefined)
      failure = errorText(controller.signal.reason);
    clearTimeout(deadline);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  const successful = completed && failure === undefined && cleanup.length === 0;
  const result = {
    provenance,
    fixture: true,
    scope,
    successful,
    failure,
    cleanup,
    http,
    observations,
  };
  await publishHistoryResult(output, result, transcript);
  if (!successful) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
