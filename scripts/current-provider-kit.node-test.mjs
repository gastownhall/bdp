/** Real public-boundary controls; no mock provider answers enter the verifier. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  directScopeProvider,
  parseKitArguments,
  runCurrentProvider,
  UNCOVERED_REQUIRED,
  hasCompleteRequiredCoverage,
} from "./current-provider-kit.mjs";
import { provisionReference } from "./current-provider-callables-adapter.mjs";
import { provision } from "./current-provider-reference-adapter.mjs";
import * as kit from "./current-provider-kit.mjs";

const implemented = (report) =>
  report.obligations.filter(
    (row) => !UNCOVERED_REQUIRED.some((uncovered) => uncovered.id === row.id),
  );

test("current reference passes the executable slice while missing required coverage prevents qualification", async () => {
  const report = await runCurrentProvider(provision);
  assert.equal(report.state, "incomplete");
  assert.equal(report.sliceComplete, true, JSON.stringify(report));
  assert.equal(report.qualificationComplete, false);
  for (const [field, relative] of [
    ["caseSourceSha256", "./current-provider-kit.mjs"],
    ["coreProseSha256", "../specs/profiles/core/core.md"],
    ["writeProseSha256", "../specs/profiles/write/write.md"],
    ["schemaSha256", "../specs/profiles/core/bdp-v0.1.schema.json"],
  ]) {
    const bytes = await readFile(new URL(relative, import.meta.url));
    assert.equal(report.inputs[field], createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(report.inputs.actualNode, process.versions.node);
  assert.equal(report.inputs.providerIdentity, "UNVERIFIED");
  assert.equal(report.inputs.inputClosure, "INCOMPLETE");
  assert.equal(report.inputs.resultReuseAttestation, false);
  assert.equal(report.inputs.schemaSha256, report.schemaSha256);
  assert.equal(implemented(report).length, 20);
  assert(implemented(report).every((row) => row.required && row.state === "pass"));
  assert.equal(report.lifecycle.cleanup, "pass");
  for (const obligation of UNCOVERED_REQUIRED)
    assert.equal(report.obligations.find((row) => row.id === obligation.id).state, "not-run");
});

test("absent lifecycle hook is not-run and cannot qualify durable Write", async () => {
  const report = await runCurrentProvider(async (context) => {
    const { restart: _restart, ...provider } = await provision(context);
    return provider;
  });
  assert.equal(report.state, "incomplete");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.qualificationComplete, false);
  assert.equal(report.obligations.find((row) => row.id === "write.restart").state, "not-run");
  assert.equal(
    report.obligations.find((row) => row.id === "write.durable-original-success").state,
    "not-run",
  );
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("unconfigured retained-detail window is not treated as a public retention promise", async () => {
  const report = await runCurrentProvider(async (context) => {
    const { conditions: _conditions, ...provider } = await provision(context);
    return provider;
  });
  assert.equal(report.state, "incomplete");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.obligations.find((row) => row.id === "write.restart").state, "not-run");
  assert.equal(report.lifecycle.cleanup, "pass");
});

const graphIds = [
  "write.link-create",
  "write.link-update",
  "write.alias-put",
  "write.alias-delete",
  "write.link-delete",
];
function basePasses(report) {
  const base = implemented(report).filter((row) => !graphIds.includes(row.id));
  assert.equal(base.length, 15);
  assert(
    base.every((row) => row.state === "pass"),
    JSON.stringify(base),
  );
}

async function corruptingProvider(context, cleanupFails = false, corruption = "postimage") {
  const provider = await provision(context);
  let upstream = new URL(provider.connections[0].connectOrigin);
  const deletedResources = new Set();
  let originalAlias;
  const deletedAliases = new Set();
  let restarted = false;
  const refreshed = (value) => {
    const url = new URL(value);
    url.pathname = `/refreshed${url.pathname}`;
    return url.href;
  };
  const proxy = http.createServer((request, response) => {
    if (
      corruption === "no-graph-navigation" &&
      restarted &&
      request.url === new URL(provider.scope).pathname
    ) {
      request.resume();
      response.writeHead(503);
      response.end();
      return;
    }
    if (
      corruption === "alias-not-admitted" &&
      request.headers["idempotency-key"]?.startsWith("alias-first-")
    ) {
      request.resume();
      response.writeHead(404, { "content-type": "application/problem+json" });
      response.end(
        JSON.stringify({
          type: "https://github.com/gastownhall/bdp/problems/not-found",
          status: 404,
          code: "resource-not-found",
          retry: "after-state-change",
        }),
      );
      return;
    }
    const aliasReplay =
      corruption === "alias-reexecution" &&
      originalAlias !== undefined &&
      originalAlias.key === request.headers["idempotency-key"];
    const call = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path:
          corruption === "restart-navigation" && request.url.startsWith("/refreshed")
            ? request.url.slice("/refreshed".length)
            : request.url,
        headers: aliasReplay
          ? { ...request.headers, "idempotency-key": `mutant-${originalAlias.key}` }
          : corruption === "media-consumed" &&
              request.headers["content-type"] === "application/json"
            ? { ...request.headers, "content-type": "application/vnd.bdp.v0.1+json" }
            : request.headers,
      },
      (reply) => {
        const chunks = [];
        reply.on("data", (chunk) => chunks.push(chunk));
        reply.on("end", async () => {
          let body = Buffer.concat(chunks);
          if (
            reply.headers["content-type"]?.startsWith("application/vnd.bdp.v0.1+json") &&
            body.length
          ) {
            const value = JSON.parse(body);
            if (corruption === "restart-navigation" && restarted) {
              // Core fixes every operation route; only the alias base can move on restart.
              if (value.profile === "write")
                value.aliases = `${value.aliases.replace(/\/?$/, "/")}fresh`;
              body = Buffer.from(JSON.stringify(value));
            }
            if (corruption === "alias-base" && value.profile === "write") {
              value.aliases = new URL("/unavailable-alias-namespace/", provider.scope).href;
              body = Buffer.from(JSON.stringify(value));
            }
            if (value.alias && value.outcome === "deleted") deletedAliases.add(value.alias);
            else if (value.alias) deletedAliases.delete(value.alias);
            if (
              corruption === "noop-state" &&
              request.headers["idempotency-key"]?.startsWith("link-noop-")
            ) {
              const effect = JSON.stringify({
                link: value.resource.id,
                properties: { label: "mutant stored noop" },
                expectedRevision: value.resource.revision,
              });
              await new Promise((resolve, reject) => {
                const mutation = http.request(
                  {
                    hostname: upstream.hostname,
                    port: upstream.port,
                    method: "POST",
                    path: request.url,
                    headers: {
                      ...request.headers,
                      "idempotency-key": `mutant-${request.headers["idempotency-key"]}`,
                      "content-length": Buffer.byteLength(effect),
                    },
                  },
                  (changed) => {
                    const chunks = [];
                    changed.on("data", (chunk) => chunks.push(chunk));
                    changed.on("error", reject);
                    changed.on("end", () => {
                      assert.equal(changed.statusCode, 200);
                      const result = JSON.parse(Buffer.concat(chunks));
                      assert.equal(result.changed, true);
                      assert.notEqual(result.resource.revision, value.resource.revision);
                      resolve();
                    });
                  },
                );
                mutation.on("error", reject);
                mutation.end(effect);
              });
            }
            if (value.outcome === "deleted" && value.deleted)
              deletedResources.add(value.deleted.resource.id);
            if (
              corruption === "link-pin" &&
              value.outcome === "created" &&
              value.resource?.source
            ) {
              value.resource.source = value.resource.source.uri;
              body = Buffer.from(JSON.stringify(value));
            }
            if (
              corruption === "alias-reexecution" &&
              value.alias &&
              value.outcome === "created" &&
              !originalAlias
            )
              originalAlias = { key: request.headers["idempotency-key"], body: Buffer.from(body) };
            if (
              ["postimage", "credential-echo"].includes(corruption) &&
              value.outcome === "created"
            ) {
              // A schema-valid but wrong public result. The adapter supplies no
              // expected answers; independent literal fixture assertions must fail.
              value.resource.properties.title =
                corruption === "credential-echo"
                  ? request.headers.authorization
                  : "wrong public postimage";
              body = Buffer.from(JSON.stringify(value));
            }
          }
          if (
            ["resource-pruned", "resource-erased"].includes(corruption) &&
            deletedResources.has(new URL(request.url, provider.scope).href) &&
            reply.statusCode === 404
          ) {
            const value = JSON.parse(body);
            if (value.code === "resource-not-found") {
              value.code = corruption;
              value.type = "https://github.com/gastownhall/bdp/problems/gone";
              value.status = 410;
              value.retry = "never";
              body = Buffer.from(JSON.stringify(value));
              reply.statusCode = 410;
            }
          }
          if (
            corruption === "media-consumed" &&
            request.headers["content-type"] === "application/json"
          ) {
            // Actually execute the rejected request against the real provider,
            // consuming its key and creating state, then falsely report 415.
            // The runner must observe the effect using public GET, not an oracle.
            assert.equal(reply.statusCode, 200);
            body = Buffer.from(
              JSON.stringify({
                type: "https://github.com/gastownhall/bdp/problems/request",
                code: "unsupported-media-type",
                status: 415,
                retry: "never",
              }),
            );
            reply.statusCode = 415;
            reply.headers["content-type"] = "application/problem+json";
          }
          if (aliasReplay) {
            // Upstream really reexecutes under a fresh key. Hide the updated
            // response with the original bytes; only the public state read can
            // detect that the alias was wrongly rebound by the replay.
            assert.equal(reply.statusCode, 200);
            assert.equal(JSON.parse(body).outcome, "updated");
            assert.equal(JSON.parse(body).target, JSON.parse(originalAlias.body).target);
            body = originalAlias.body;
          }
          if (request.url === new URL(provider.scope).pathname) {
            if (corruption === "mixed-case-link") {
              reply.headers.link =
                reply.headers.link
                  .replace(/rel="service-desc"/gi, 'rel="Service-Desc"')
                  .replace(/type="[^"]*"/gi, 'type="APPLICATION/VND.BDP.V0.1+JSON"') +
                ', <https://current-provider.invalid/unselected>; rel="Service-Desc"; type="text/html"';
            }
            if (corruption === "human-landing") {
              reply.statusCode = request.headers.accept === "*/*" ? 200 : 406;
              reply.headers["content-type"] = "text/html";
              body = Buffer.from("<html>Provider landing</html>");
            }
            if (corruption === "byte-bound") {
              reply.statusCode = 200;
              body = Buffer.alloc(1048577, 120);
            }
          }
          if (corruption === "alias-redirect-kind" && reply.statusCode === 307)
            reply.headers["bdp-resource-kind"] = "bead";
          if (
            corruption === "alias-problem-kind" &&
            reply.statusCode === 404 &&
            deletedAliases.has(new URL(request.url, provider.scope).href)
          )
            reply.headers["bdp-resource-kind"] = "bead";
          if (
            corruption === "occupied-link" &&
            request.method === "GET" &&
            request.url.endsWith("/relation") &&
            reply.statusCode === 404
          ) {
            reply.statusCode = 307;
            reply.headers.location = provider.scope;
            body = Buffer.alloc(0);
          }
          if (corruption === "discovery-link") delete reply.headers.link;
          if (corruption === "restart-navigation" && restarted && reply.headers.link)
            reply.headers.link = reply.headers.link.replace(
              /<([^>]+)>/g,
              (_, url) => `<${refreshed(url)}>`,
            );
          delete reply.headers["transfer-encoding"];
          response.writeHead(reply.statusCode, {
            ...reply.headers,
            "content-length": String(body.length),
          });
          response.end(body);
        });
        reply.on("error", () => response.destroy());
      },
    );
    call.on("error", () => response.destroy());
    request.pipe(call);
  });
  try {
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await provider.cleanup();
    throw error;
  }
  return {
    ...provider,
    connections: [
      { ...provider.connections[0], connectOrigin: `http://127.0.0.1:${proxy.address().port}` },
    ],
    async restart() {
      const resumed = await provider.restart();
      restarted = true;
      upstream = new URL(resumed.connections[0].connectOrigin);
      return {
        connections: [
          {
            ...resumed.connections[0],
            connectOrigin: `http://127.0.0.1:${proxy.address().port}`,
          },
        ],
      };
    },
    async cleanup() {
      try {
        await new Promise((resolve, reject) =>
          proxy.close((error) => (error ? reject(error) : resolve())),
        );
      } finally {
        await provider.cleanup();
      }
      if (cleanupFails) throw new Error("deliberate adapter cleanup failure after actual cleanup");
    },
  };
}

test("schema-valid wrong actual HTTP postimage fails independent expected assertions", async () => {
  const report = await runCurrentProvider(corruptingProvider);
  assert.equal(report.state, "fail");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.qualificationComplete, false);
  assert.equal(report.obligations.find((row) => row.id === "write.create").state, "fail");
  assert.equal(report.obligations.find((row) => row.id === "core.point-read").state, "not-run");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("missing mandatory Scope discovery Link is a provider failure, not unsupported harness selection", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "discovery-link"),
  );
  assert.equal(report.state, "fail");
  assert.equal(report.obligations.find((row) => row.id === "core.scope-discovery").state, "fail");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("primary public failure and adapter cleanup failure remain separately visible", async () => {
  const report = await runCurrentProvider((context) => corruptingProvider(context, true));
  assert.equal(report.state, "harness-error");
  assert.equal(report.obligations.find((row) => row.id === "write.create").state, "fail");
  assert.equal(report.lifecycle.cleanup, "harness-error");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.qualificationComplete, false);
});

test("adapter oracle fields are refused while its acquired resources still clean up", async () => {
  let cleaned = false;
  const report = await runCurrentProvider(async (context) => {
    const provider = await provision(context);
    return {
      ...provider,
      expected: { outcome: "success" },
      async cleanup() {
        await provider.cleanup();
        cleaned = true;
      },
    };
  });
  assert.equal(report.state, "harness-error");
  assert.equal(report.lifecycle.provision, "harness-error");
  assert.equal(report.sliceComplete, false);
  assert.equal(cleaned, true);
});

test("explicit external module entry emits incomplete status, never a complete qualification exit", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./current-provider-kit.mjs", import.meta.url)),
        "--provider",
        fileURLToPath(new URL("./current-provider-reference-adapter.mjs", import.meta.url)),
      ],
      {
        cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
  assert.equal(result.signal, null);
  assert.equal(result.code, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sliceComplete, true);
  assert.equal(report.qualificationComplete, false);
  assert.equal(report.state, "incomplete");
});

test("authorized Core 410 absence variants pass without resurrecting the deleted resource", async () => {
  for (const code of ["resource-pruned", "resource-erased"]) {
    const report = await runCurrentProvider((context) => corruptingProvider(context, false, code));
    assert.equal(report.sliceComplete, true, JSON.stringify(report));
    assert.equal(report.state, "incomplete");
    assert.equal(report.qualificationComplete, false);
    assert.equal(report.obligations.find((row) => row.id === "core.deleted-absence").state, "pass");
  }
});

test("schema-valid response echo of Authorization never enters the serialized report", async () => {
  let credential;
  const report = await runCurrentProvider(async (context) => {
    const provider = await corruptingProvider(context, false, "credential-echo");
    credential = provider.connections[0].authorization;
    return provider;
  });
  assert.equal(report.state, "fail");
  assert.equal(report.obligations.find((row) => row.id === "write.create").state, "fail");
  assert.equal(report.lifecycle.cleanup, "pass");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(credential), false);
  assert.equal(serialized.includes(credential.slice("Bearer ".length)), false);
  assert.equal(report.qualificationComplete, false);
});

test("415 that secretly executes the same-key create fails public absence observation", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "media-consumed"),
  );
  assert.equal(report.state, "fail");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.qualificationComplete, false);
  assert.equal(
    report.obligations.find((row) => row.id === "write.media-before-admission").state,
    "fail",
  );
  assert.equal(report.obligations.find((row) => row.id === "write.create").state, "not-run");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("registered relation and media case fold selects the actual typed discovery among candidates", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "mixed-case-link"),
  );
  assert.equal(report.sliceComplete, true, JSON.stringify(report));
  assert.equal(report.qualificationComplete, false);
});

test("Scope landing permits a negotiating human HTML representation", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "human-landing"),
  );
  assert.equal(report.sliceComplete, true, JSON.stringify(report));
});

test("short positive detail conditions preserve non-durable observations without pretending durable coverage", async () => {
  const report = await runCurrentProvider(async (context) => ({
    ...(await provision(context)),
    conditions: { retainedDetailWindowMs: 30000 },
  }));
  assert.equal(report.state, "incomplete");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.qualificationComplete, false);
  assert.equal(report.lifecycle.provision, "pass");
  assert.equal(report.lifecycle.cleanup, "pass");
  assert.equal(report.obligations.find((row) => row.id === "write.delete").state, "pass");
  const restart = report.obligations.find((row) => row.id === "write.restart");
  assert.equal(restart.state, "not-run");
  assert.match(restart.reason, /shorter/);
});

test("malformed negative and fractional detail conditions remain harness errors", async () => {
  for (const retainedDetailWindowMs of [-1, 1.5]) {
    const report = await runCurrentProvider(async (context) => ({
      ...(await provision(context)),
      conditions: { retainedDetailWindowMs },
    }));
    assert.equal(report.state, "harness-error");
    assert.equal(report.lifecycle.cleanup, "pass");
    assert.equal(report.qualificationComplete, false);
  }
});

test("kit-owned response-byte bound survives request error reporting", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "byte-bound"),
  );
  assert.equal(report.state, "harness-error");
  assert.equal(
    report.obligations.find((row) => row.id === "core.scope-discovery").reason,
    "Kit response-byte limit exceeded",
  );
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("pre-provision initialization errors do not blame adapter execution", async () => {
  const report = await runCurrentProvider(undefined);
  assert.equal(report.lifecycle.provision, "not-run");
  assert.equal(report.lifecycle.cleanup, "not-run");
  assert.equal(report.state, "harness-error");
  assert.equal(report.qualificationComplete, false);
});

test("CLI misuse has a distinct bounded usage exit without reflecting arguments", async () => {
  for (const args of [
    [],
    ["--provider", "relative-secret-path.mjs"],
    ["--unknown", "/secret.mjs"],
  ]) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./current-provider-kit.mjs", import.meta.url)), ...args],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "",
        stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout, stderr });
      });
    });
    assert.equal(result.signal, null);
    assert.equal(result.code, 64);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Usage: current-provider-kit.mjs --provider /absolute/adapter.mjs\n" +
        "       current-provider-kit.mjs --scope SCOPE_URL [--token-env NAME] [--allow-mutation] [--recipe /absolute/recipe.json]\n" +
        "Either form also takes --exceptions /absolute/ledger.json\n",
    );
  }
});

test("qualification accounting rejects missing, duplicate, unrequired or failed obligations", async () => {
  const report = await runCurrentProvider(provision);
  const rows = report.obligations.map((row) => ({ ...row, state: "pass" }));
  const lifecycle = { provision: "pass", cleanup: "pass" };
  assert.equal(hasCompleteRequiredCoverage(rows, lifecycle), true);
  for (const row of rows) {
    assert.equal(
      hasCompleteRequiredCoverage(
        rows.filter((entry) => entry.id !== row.id),
        lifecycle,
      ),
      false,
    );
    assert.equal(
      hasCompleteRequiredCoverage(
        rows.map((entry) => (entry.id === row.id ? { ...entry, required: false } : entry)),
        lifecycle,
      ),
      false,
    );
    assert.equal(
      hasCompleteRequiredCoverage(
        rows.map((entry) => (entry.id === row.id ? { ...entry, state: "not-run" } : entry)),
        lifecycle,
      ),
      false,
    );
  }
  assert.equal(hasCompleteRequiredCoverage([...rows.slice(1), rows[1]], lifecycle), false);
  assert.equal(hasCompleteRequiredCoverage([], lifecycle), false);
  assert.equal(
    hasCompleteRequiredCoverage(rows, { ...lifecycle, cleanup: "harness-error" }),
    false,
  );
  assert.equal(report.qualificationComplete, false);
  assert.equal(
    report.obligations.find((row) => row.id === "coverage.complete-obligation-audit").state,
    "not-run",
  );
});

test("schema-valid Link response missing its authored source pin fails independent expectations", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "link-pin"),
  );
  assert.equal(report.state, "fail");
  assert.equal(report.obligations.find((row) => row.id === "write.link-create").state, "fail");
  basePasses(report);
  assert.equal(report.obligations.find((row) => row.id === "write.link-update").state, "not-run");
  assert.equal(report.lifecycle.cleanup, "pass");
  assert.equal(report.qualificationComplete, false);
});

test("correct-looking original alias response cannot conceal real replay reexecution", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "alias-reexecution"),
  );
  assert.equal(report.state, "fail");
  assert.equal(report.obligations.find((row) => row.id === "write.alias-put").state, "fail");
  basePasses(report);
  assert.equal(report.obligations.find((row) => row.id === "write.link-delete").state, "pass");
  assert.equal(report.obligations.find((row) => row.id === "write.alias-delete").state, "not-run");
  assert.equal(report.lifecycle.cleanup, "pass");
  assert.equal(report.qualificationComplete, false);
});

test("undeclared graph and alias fixture conditions stay not-run while the original Bead journey completes", async () => {
  for (const missing of ["linkFixture", "hierarchicalAliasFixture"]) {
    const report = await runCurrentProvider(async (context) => {
      const provider = await provision(context);
      return { ...provider, conditions: { ...provider.conditions, [missing]: false } };
    });
    assert.equal(report.state, "incomplete");
    assert.equal(report.sliceComplete, false);
    assert.equal(report.qualificationComplete, false);
    for (const id of ["write.alias-put", "write.alias-delete"])
      assert.equal(
        report.obligations.find((row) => row.id === id).state,
        missing === "hierarchicalAliasFixture" ? "not-run" : "pass",
      );
    basePasses(report);
    for (const id of ["write.link-create", "write.link-update", "write.link-delete"])
      assert.equal(
        report.obligations.find((row) => row.id === id).state,
        missing === "linkFixture" ? "not-run" : "pass",
      );
    assert.equal(report.obligations.find((row) => row.id === "write.delete").state, "pass");
    assert.equal(report.lifecycle.cleanup, "pass");
  }
});

test("a short declared graph detail window cannot dispatch the alias replay mutant or qualify its rows", async () => {
  const report = await runCurrentProvider(async (context) => {
    const provider = await corruptingProvider(context, false, "alias-reexecution");
    return {
      ...provider,
      conditions: { ...provider.conditions, graphRetainedDetailWindowMs: 30000 },
    };
  });
  assert.equal(report.state, "incomplete");
  assert.equal(report.qualificationComplete, false);
  assert.equal(report.sliceComplete, false);
  for (const id of ["write.alias-put", "write.alias-delete"])
    assert.equal(report.obligations.find((row) => row.id === id).state, "not-run");
  for (const id of ["write.link-create", "write.link-update", "write.link-delete", "write.delete"])
    assert.equal(report.obligations.find((row) => row.id === id).state, "pass");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("graph state verification catches a concealed real Link no-op effect without losing base observations", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "noop-state"),
  );
  basePasses(report);
  assert.equal(report.obligations.find((row) => row.id === "write.link-update").state, "fail");
  assert.equal(report.obligations.find((row) => row.id === "write.alias-put").state, "pass");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("invalid alias namespace and first-put refusal are fixture limitations, never retroactive provisioning failure", async () => {
  for (const mode of ["alias-base", "alias-not-admitted"]) {
    const report = await runCurrentProvider((context) => corruptingProvider(context, false, mode));
    basePasses(report);
    assert.equal(report.state, "incomplete");
    assert.equal(report.lifecycle.provision, "pass");
    assert.equal(report.lifecycle.cleanup, "pass");
    for (const id of ["write.alias-put", "write.alias-delete"])
      assert.equal(report.obligations.find((row) => row.id === id).state, "not-run");
    assert.equal(report.obligations.find((row) => row.id === "write.link-delete").state, "pass");
  }
});

test("unavailable unused Link precondition remains not-run while independent aliases and base still execute", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "occupied-link"),
  );
  basePasses(report);
  assert.equal(report.state, "incomplete");
  assert.equal(report.obligations.find((row) => row.id === "write.link-create").state, "not-run");
  assert.equal(report.obligations.find((row) => row.id === "write.alias-put").state, "pass");
  assert.equal(report.obligations.find((row) => row.id === "write.alias-delete").state, "pass");
});

test("alias redirects and admitted absence must omit Resource kind metadata", async () => {
  for (const [mode, id] of [
    ["alias-redirect-kind", "write.alias-put"],
    ["alias-problem-kind", "write.alias-delete"],
  ]) {
    const report = await runCurrentProvider((context) => corruptingProvider(context, false, mode));
    basePasses(report);
    assert.equal(report.obligations.find((row) => row.id === id).state, "fail");
    assert.equal(report.obligations.find((row) => row.id === "write.link-delete").state, "pass");
    assert.equal(report.lifecycle.provision, "pass");
  }
});

test("a missing base restart still allows the fresh independent graph fixture", async () => {
  const report = await runCurrentProvider(async (context) => {
    const { restart: _restart, ...provider } = await provision(context);
    return provider;
  });
  for (const id of graphIds)
    assert.equal(report.obligations.find((row) => row.id === id).state, "pass");
  assert.equal(report.obligations.find((row) => row.id === "write.restart").state, "not-run");
  assert.equal(report.obligations.find((row) => row.id === "write.delete").state, "pass");
  assert.equal(report.lifecycle.cleanup, "pass");
});

test("graph timing boundaries require the full budget and reject already elapsed windows", () => {
  assert.equal(kit.hasGraphDetailWindow(360000, 360000, 100, 359999), true);
  assert.equal(kit.hasGraphDetailWindow(360000, 360000, 100, 360100), false);
  assert.equal(kit.hasGraphDetailWindow(30000, 360000, 100, 101), false);
  assert.equal(kit.hasGraphDetailWindow(undefined, 360000, 100, 101), false);
});

test("fresh alias work rediscovers the alias base after restart while original retries retain their original targets", async () => {
  const report = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "restart-navigation"),
  );
  basePasses(report);
  assert.equal(report.sliceComplete, true, JSON.stringify(report));
  assert.equal(report.qualificationComplete, false);
});

test("missing or malformed graph detail conditions cannot erase completed base evidence", async () => {
  for (const graphWindow of [undefined, -1]) {
    const report = await runCurrentProvider(async (context) => {
      const provider = await provision(context);
      const conditions = { ...provider.conditions };
      delete conditions.graphRetainedDetailWindowMs;
      if (graphWindow !== undefined) conditions.graphRetainedDetailWindowMs = graphWindow;
      return { ...provider, conditions };
    });
    basePasses(report);
    assert.equal(report.lifecycle.provision, "pass");
    assert.equal(report.lifecycle.cleanup, "pass");
    assert.equal(report.state, graphWindow === undefined ? "incomplete" : "harness-error");
    for (const id of ["write.alias-put", "write.alias-delete"])
      assert.equal(report.obligations.find((row) => row.id === id).state, "not-run");
    assert.equal(report.qualificationComplete, false);
  }
});

test("unavailable graph declarations do not add a post-base discovery dependency", async () => {
  const report = await runCurrentProvider(async (context) => {
    const provider = await corruptingProvider(context, false, "no-graph-navigation");
    return {
      ...provider,
      conditions: {
        ...provider.conditions,
        linkFixture: false,
        hierarchicalAliasFixture: false,
      },
    };
  });
  basePasses(report);
  assert.equal(report.state, "incomplete");
  assert.equal(report.lifecycle.provision, "pass");
  assert.equal(report.lifecycle.cleanup, "pass");
  for (const id of graphIds)
    assert.equal(report.obligations.find((row) => row.id === id).state, "not-run");
});

/**
 * A real read-only provider over real HTTP: Core discovery, the two inventories, point reads
 * and no mutation at all. `seed` is what the provider holds by its own means; `mutant` makes
 * one answer wrong so the kit's independent assertions are seen to fire.
 */
async function readOnlyProvider({ seed = true, mutant, profile = "core", extra = {} } = {}) {
  const media = "application/vnd.bdp.v0.1+json";
  const posts = [];
  let scope;
  const server = http.createServer((request, response) => {
    const send = (status, value, headers = {}) => {
      const text = JSON.stringify(value);
      response.writeHead(status, {
        "content-type": status >= 400 ? "application/problem+json" : media,
        "cache-control": "private, no-store",
        ...headers,
      });
      response.end(text);
    };
    const notFound = () =>
      send(404, {
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        status: 404,
        code: "resource-not-found",
        retry: "after-state-change",
      });
    const bead = {
      id: `${scope}seeded`,
      type: "https://conformance.invalid/types/Seeded",
      revision: "r1",
      properties: { title: "seeded" },
      metadata: {},
    };
    const link = {
      id: `${scope}seeded-link`,
      type: "https://conformance.invalid/types/SeededLink",
      revision: "r1",
      source: bead.id,
      target: "external:elsewhere:thing",
      properties: {},
      metadata: {},
    };
    if (request.method !== "GET") {
      posts.push(request.url);
      response.writeHead(405, { allow: "GET, HEAD", "content-length": "0" });
      response.end();
      return;
    }
    const description = `<${scope}bdp>; rel="service-desc"; type="${media}"`;
    if (request.url === "/") {
      response.writeHead(204, { link: description, "cache-control": "private, no-store" });
      response.end();
    } else if (request.url === "/bdp")
      send(200, {
        bdpVersion: "0.1",
        profile,
        scope,
        specRevision: "0".repeat(40),
        ...extra,
      });
    else if (request.url === "/bdp/beads")
      send(
        200,
        { items: seed ? [bead] : [], next: null },
        {
          "bdp-collection-kind": "bead",
          link: description,
        },
      );
    else if (request.url === "/bdp/links")
      send(
        200,
        { items: seed ? [link] : [], next: null },
        {
          "bdp-collection-kind": "link",
          link: description,
        },
      );
    else if (request.url === "/seeded" && seed)
      send(200, mutant === "point-read" ? { ...bead, revision: "r2" } : bead, {
        "bdp-resource-kind": "bead",
        etag: '"r1"',
        link: description,
      });
    else if (request.url === "/seeded-link" && seed)
      send(200, link, { "bdp-resource-kind": "link", etag: '"r1"', link: description });
    else notFound();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  scope = `http://127.0.0.1:${server.address().port}/`;
  return {
    scope,
    posts,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
const rowsOf = (report, predicate) => report.obligations.filter(({ id }) => predicate(id));

test("a read-only provider runs every Core case and Write is not applicable by discovery", async () => {
  const provider = await readOnlyProvider();
  try {
    const report = await runCurrentProvider(async () => ({
      scope: provider.scope,
      connections: [
        {
          origin: new URL(provider.scope).origin,
          connectOrigin: new URL(provider.scope).origin,
        },
      ],
      // Deleted by the provider's own means; the kit only reads what the wire says of it.
      witnesses: { deletedResourceId: "seeded-and-deleted" },
      async cleanup() {},
    }));
    assert.equal(report.state, "incomplete", JSON.stringify(report));
    assert.equal(report.discovered.profile, "core");
    assert.equal(report.claimEligible, false);
    for (const id of [
      "core.scope-discovery",
      "core.point-read",
      "core.inventory-fixed-routes",
      "core.deleted-absence",
    ])
      assert.equal(report.obligations.find((row) => row.id === id).state, "pass", id);
    const write = rowsOf(report, (id) => id.startsWith("write."));
    assert(write.length >= 19);
    for (const row of write) {
      assert.equal(row.state, "not-applicable", row.id);
      assert.match(row.reason, /discovery/);
    }
    assert.equal(report.sliceComplete, true);
    assert.equal(report.qualificationComplete, false);
    assert.deepEqual(provider.posts, []);
  } finally {
    await provider.close();
  }
});

test("a read-only Scope with nothing to read is not-run, never a pass", async () => {
  const provider = await readOnlyProvider({ seed: false });
  try {
    const report = await runCurrentProvider(directScopeProvider(provider.scope));
    assert.equal(report.state, "incomplete");
    const row = report.obligations.find(({ id }) => id === "core.point-read");
    assert.equal(row.state, "not-run");
    assert.match(row.reason, /seeds one by its own means/);
    assert.equal(report.sliceComplete, false);
  } finally {
    await provider.close();
  }
});

test("a read-only provider's wrong point read still fails against its own inventory", async () => {
  const provider = await readOnlyProvider({ mutant: "point-read" });
  try {
    const report = await runCurrentProvider(directScopeProvider(provider.scope));
    assert.equal(report.state, "fail");
    assert.equal(report.obligations.find(({ id }) => id === "core.point-read").state, "fail");
    assert.equal(report.sliceComplete, false);
  } finally {
    await provider.close();
  }
});

test("a profile that is neither base literal is the provider's failure, not not-applicable Write", async () => {
  const provider = await readOnlyProvider({ profile: "read-only" });
  try {
    const report = await runCurrentProvider(directScopeProvider(provider.scope));
    assert.equal(report.state, "fail");
    assert.equal(report.obligations.find(({ id }) => id === "core.scope-discovery").state, "fail");
    assert.equal(
      rowsOf(report, (id) => id.startsWith("write.")).some((row) => row.state === "not-applicable"),
      false,
    );
  } finally {
    await provider.close();
  }
});

test("a Core document may not smuggle Write navigation past its closed schema", async () => {
  const provider = await readOnlyProvider({ extra: { operations: "http://x.invalid/ops" } });
  try {
    const report = await runCurrentProvider(directScopeProvider(provider.scope));
    assert.equal(report.state, "fail");
    assert.equal(report.obligations.find(({ id }) => id === "core.scope-discovery").state, "fail");
  } finally {
    await provider.close();
  }
});

test("--scope against a Write Scope changes nothing without --allow-mutation", async () => {
  const reference = await provision({
    fixture: { runId: "scope-mode", minimumDetailWindowMs: 1, minimumGraphDetailWindowMs: 1 },
  });
  const upstream = new URL(reference.connections[0].connectOrigin);
  const mutating = [];
  const proxy = http.createServer((request, response) => {
    if (request.method !== "GET") mutating.push(request.url);
    const forward = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, authorization: reference.connections[0].authorization },
      },
      (reply) => {
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
      },
    );
    request.pipe(forward);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const report = await runCurrentProvider(
      async () => ({
        scope: reference.scope,
        connections: [
          {
            origin: new URL(reference.scope).origin,
            connectOrigin: `http://127.0.0.1:${proxy.address().port}`,
          },
        ],
        async cleanup() {},
      }),
      { allowMutation: false },
    );
    assert.deepEqual(mutating, []);
    assert.equal(report.discovered.profile, "write");
    assert.equal(
      report.obligations.find(({ id }) => id === "write.discovery-fixed-routes").state,
      "pass",
    );
    const create = report.obligations.find(({ id }) => id === "write.create");
    assert.equal(create.state, "not-run");
    assert.match(create.reason, /--allow-mutation/);
    for (const row of rowsOf(report, (id) => id.startsWith("write.")))
      assert.notEqual(row.state, "not-applicable", row.id);
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await reference.cleanup();
  }
});

/**
 * The real reference behind a real proxy that reshapes only what a Write provider says and
 * serves about aliases. `shape(discoveryRead)` names, for that read and the requests after it:
 * `advertised` (discovery's `aliases`), `members` (which alias operations its fixed routes
 * serve; an unserved one answers as the absent path it then is), `extra` (members added to
 * discovery) and `directory` (the retired operation directory, served anyway).
 */
async function aliasShapedProvider(context, shape) {
  const provider = await provision(context);
  let upstream = new URL(provider.connections[0].connectOrigin);
  const scopePath = new URL(provider.scope).pathname;
  let discoveryReads = 0;
  const aliasPosts = [];
  const aliasTarget = (url) =>
    ALIAS_PAIR.find((name) => url === `${scopePath}bdp/operations/${name}`);
  const proxy = http.createServer((request, response) => {
    const current = shape(Math.max(discoveryReads - 1, 0));
    const name = aliasTarget(request.url);
    if (current.directory && request.url === `${scopePath}bdp/operations`) {
      request.resume();
      response.writeHead(200, { "content-type": "application/vnd.bdp.v0.1+json" });
      response.end(
        JSON.stringify(
          Object.fromEntries(
            ["createBead", "updateBead", "deleteBead", "createLink", "updateLink", "deleteLink"]
              .concat(ALIAS_PAIR)
              .map((op) => [op, new URL(`bdp/operations/${op}`, provider.scope).href]),
          ),
        ),
      );
      return;
    }
    // An alias operation the shape does not serve gets the upstream's own absent-path answer.
    const served = name === undefined || current.members.includes(name);
    const forward = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: served ? request.url : `${scopePath}bdp/absent-${name}`,
        headers: request.headers,
      },
      (reply) => {
        const chunks = [];
        reply.on("data", (chunk) => chunks.push(chunk));
        reply.on("end", () => {
          let body = Buffer.concat(chunks);
          const headers = { ...reply.headers };
          if (
            request.method === "GET" &&
            headers["content-type"]?.startsWith("application/vnd.bdp.v0.1+json")
          ) {
            const value = JSON.parse(body);
            if (value.profile === "write") {
              const { advertised, extra } = shape(discoveryReads++);
              if (!advertised) delete value.aliases;
              Object.assign(value, extra ?? {});
              body = Buffer.from(JSON.stringify(value));
            }
            delete headers["content-length"];
          }
          if (request.method === "POST" && name !== undefined && served)
            aliasPosts.push(request.url);
          response.writeHead(reply.statusCode, headers);
          response.end(body);
        });
      },
    );
    request.pipe(forward);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const connectOrigin = `http://127.0.0.1:${proxy.address().port}`;
  const rerouted = (connections) =>
    connections.map((connection) => {
      upstream = new URL(connection.connectOrigin);
      return { ...connection, connectOrigin };
    });
  return {
    aliasPosts,
    adapter: {
      scope: provider.scope,
      connections: rerouted(provider.connections),
      conditions: provider.conditions,
      async restart() {
        return { connections: rerouted((await provider.restart()).connections) };
      },
      async cleanup() {
        await new Promise((resolve) => proxy.close(resolve));
        await provider.cleanup();
      },
    },
  };
}
const ALIAS_PAIR = ["putAlias", "deleteAlias"];
const withoutAliases = () => ({ advertised: false, members: [] });

test("a Write provider without aliases runs every other Write row; alias rows are not applicable by discovery", async () => {
  let shaped;
  const report = await runCurrentProvider(async (context) => {
    shaped = await aliasShapedProvider(context, withoutAliases);
    return shaped.adapter;
  });
  assert.equal(report.state, "incomplete", JSON.stringify(report));
  assert.equal(report.discovered.profile, "write");
  for (const row of implemented(report))
    if (row.id === "write.alias-put" || row.id === "write.alias-delete") {
      assert.equal(row.state, "not-applicable", row.id);
      assert.equal(row.required, false, row.id);
      assert.match(row.reason, /by discovery/);
    } else assert.equal(row.state, "pass", `${row.id}: ${row.reason}`);
  assert.equal(report.sliceComplete, true);
  assert.equal(report.qualificationComplete, false);
  assert.deepEqual(shaped.aliasPosts, []);
});

test("alias rows stay not applicable, not unauthorized, when mutation is not allowed", async () => {
  let shaped;
  const report = await runCurrentProvider(
    async (context) => {
      shaped = await aliasShapedProvider(context, withoutAliases);
      return shaped.adapter;
    },
    { allowMutation: false },
  );
  assert.equal(
    report.obligations.find(({ id }) => id === "write.discovery-fixed-routes").state,
    "pass",
  );
  for (const id of ["write.alias-put", "write.alias-delete"]) {
    const row = report.obligations.find((entry) => entry.id === id);
    assert.equal(row.state, "not-applicable");
    assert.match(row.reason, /by discovery/);
  }
  const create = report.obligations.find(({ id }) => id === "write.create");
  assert.equal(create.state, "not-run");
  assert.match(create.reason, /--allow-mutation/);
});

test("fixed routes that disagree with discovery, or retired navigation, fail, and nothing is not applicable", async () => {
  const scope = (path) => ({ extra: path });
  for (const [name, shape] of [
    ["members unadvertised", () => ({ advertised: false, members: ALIAS_PAIR })],
    ["advertised, members omitted", () => ({ advertised: true, members: [] })],
    ["advertised, one member", () => ({ advertised: true, members: ["putAlias"] })],
    ["advertised, other member", () => ({ advertised: true, members: ["deleteAlias"] })],
    ["unadvertised, one member", () => ({ advertised: false, members: ["putAlias"] })],
    ["unadvertised, other member", () => ({ advertised: false, members: ["deleteAlias"] })],
    [
      "retired operations member",
      () => ({
        advertised: true,
        members: ALIAS_PAIR,
        ...scope({ operations: "https://current-provider.invalid/ops" }),
      }),
    ],
    [
      "retired events member",
      () => ({
        advertised: true,
        members: ALIAS_PAIR,
        ...scope({ events: "https://current-provider.invalid/events" }),
      }),
    ],
    [
      "retired directory still served",
      () => ({ advertised: true, members: ALIAS_PAIR, directory: true }),
    ],
  ]) {
    const report = await runCurrentProvider(
      async (context) => (await aliasShapedProvider(context, shape)).adapter,
    );
    assert.equal(report.state, "fail", name);
    assert.equal(
      report.obligations.find(({ id }) => id === "write.discovery-fixed-routes").state,
      "fail",
      name,
    );
    for (const row of rowsOf(report, (id) => id.startsWith("write.")))
      assert.notEqual(row.state, "not-applicable", `${name}: ${row.id}`);
    assert.equal(report.obligations.find(({ id }) => id === "write.create").state, "not-run", name);
    assert.equal(report.sliceComplete, false, name);
  }
});

test("a provider cannot make its alias rows not applicable by withdrawing aliases mid-run", async () => {
  for (const [name, shape] of [
    [
      "withdrawn",
      (read) =>
        read < 2 ? { advertised: true, members: ALIAS_PAIR } : { advertised: false, members: [] },
    ],
    [
      "added",
      (read) =>
        read < 2 ? { advertised: false, members: [] } : { advertised: true, members: ALIAS_PAIR },
    ],
  ]) {
    const report = await runCurrentProvider(
      async (context) => (await aliasShapedProvider(context, shape)).adapter,
    );
    assert.equal(report.state, "harness-error", name);
    assert.match(report.harnessFailure, /changed its aliases advertisement/, name);
    assert.equal(report.sliceComplete, false, name);
    const expected = name === "withdrawn" ? "not-run" : "not-applicable";
    for (const id of ["write.alias-put", "write.alias-delete"])
      assert.equal(report.obligations.find((row) => row.id === id).state, expected, name);
  }
});

test("a provider that advertises aliases is still held to its alias rows", async () => {
  // The same proxy, leaving the reference's answers alone, must measure the rows as before.
  const report = await runCurrentProvider(
    async (context) =>
      (await aliasShapedProvider(context, () => ({ advertised: true, members: ALIAS_PAIR })))
        .adapter,
  );
  assert.equal(report.state, "incomplete", JSON.stringify(report));
  for (const row of implemented(report)) assert.equal(row.state, "pass", row.id);
  assert.equal(report.sliceComplete, true);
  // And a concealed real alias effect still fails with aliases advertised.
  const mutant = await runCurrentProvider((context) =>
    corruptingProvider(context, false, "alias-reexecution"),
  );
  assert.equal(mutant.state, "fail");
  assert.equal(mutant.obligations.find((row) => row.id === "write.alias-put").state, "fail");
});

test("--scope takes a canonical Scope and reads its token only from a named variable", () => {
  assert.deepEqual(parseKitArguments(["--scope", "http://127.0.0.1:1/"]), {
    scope: "http://127.0.0.1:1/",
    allowMutation: false,
  });
  assert.deepEqual(
    parseKitArguments(["--scope", "https://a.example/x/", "--token-env", "T", "--allow-mutation"], {
      T: "secret",
    }),
    { scope: "https://a.example/x/", allowMutation: true, authorization: "Bearer secret" },
  );
  assert.deepEqual(parseKitArguments(["--provider", "/a.mjs", "--exceptions", "/l.json"]), {
    provider: "/a.mjs",
    ledger: "/l.json",
  });
  assert.equal(parseKitArguments(["--provider", "/a.mjs", "--exceptions", "l.json"]), null);
  assert.equal(parseKitArguments(["--provider", "/a.mjs", "--exceptions"]), null);
  for (const argv of [
    ["--scope"],
    ["--scope", "http://127.0.0.1:1"],
    ["--scope", "https://a.example/x"],
    ["--scope", "https://u:p@a.example/"],
    ["--scope", "https://a.example/?q=1"],
    ["--scope", "https://a.example/", "--token-env", "UNSET"],
    ["--scope", "https://a.example/", "--token", "secret"],
  ])
    assert.equal(parseKitArguments(argv), null, argv.join(" "));
});

// ---- A provider's recipe, optional replay, and excepted Write rows ----

const IDEMPOTENCY_CAPABILITY = "https://github.com/gastownhall/bdp/capabilities/idempotency";
const rowOf = (report, id) => report.obligations.find((row) => row.id === id);
const portableRecipe = (overrides = {}) => ({
  bead: {
    type: "https://conformance.invalid/types/PortableRecord",
    id: "recipe/{unique}",
    create: { properties: { title: "written" }, metadata: { source: "recipe" } },
    update: { properties: { title: "edited" } },
  },
  link: {
    type: "https://conformance.invalid/types/PortableRelation",
    id: "recipe/relation-{unique}",
    properties: { label: "linked" },
    metadata: { source: "recipe" },
  },
  ...overrides,
});

/**
 * The real reference behind a real proxy. `rewrite` sees each answer, and may replace it;
 * `before` sees each request first, and may act on the upstream; `answer` keeps a request from
 * the upstream altogether, as a refusal does. `seen` is every request.
 */
async function reshaped(context, { rewrite, before, answer, base = provision } = {}) {
  const provider = await base(context);
  let upstream = new URL(provider.connections[0].connectOrigin);
  const authorization = provider.connections[0].authorization;
  const seen = [];
  const send = (method, url, headers, body) =>
    new Promise((resolve, reject) => {
      const forward = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          method,
          path: url,
          headers: { ...headers, ...(authorization ? { authorization } : {}) },
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
  const proxy = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const entry = {
      method: request.method,
      url: request.url,
      key: request.headers["idempotency-key"],
      contentType: request.headers["content-type"],
      body: body === "" ? undefined : JSON.parse(body),
    };
    seen.push(entry);
    const answered = answer?.(entry);
    if (answered !== undefined) {
      response.writeHead(answered.status, { "content-type": answered.contentType });
      response.end(JSON.stringify(answered.json));
      return;
    }
    await before?.({ ...entry, headers: request.headers, text: body, send });
    const reply = await send(request.method, request.url, request.headers, body);
    let json;
    try {
      json = reply.text ? JSON.parse(reply.text) : undefined;
    } catch {}
    const changed = rewrite?.({ ...entry, status: reply.status, json, seen });
    const headers = { ...reply.headers };
    delete headers["content-length"];
    if (changed?.contentType) headers["content-type"] = changed.contentType;
    response.writeHead(changed?.status ?? reply.status, headers);
    response.end(changed === undefined ? reply.text : JSON.stringify(changed.json));
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const connectOrigin = `http://127.0.0.1:${proxy.address().port}`;
  const rerouted = (connections) =>
    connections.map((connection) => {
      upstream = new URL(connection.connectOrigin);
      return { ...connection, connectOrigin };
    });
  return {
    seen,
    adapter: {
      ...provider,
      connections: rerouted(provider.connections),
      ...(provider.restart
        ? {
            async restart() {
              return { connections: rerouted((await provider.restart()).connections) };
            },
          }
        : {}),
      async cleanup() {
        proxy.closeAllConnections();
        await new Promise((resolve) => proxy.close(resolve));
        await provider.cleanup();
      },
    },
  };
}
async function runReshaped(options, runOptions) {
  let shaped;
  const report = await runCurrentProvider(async (context) => {
    shaped = await reshaped(context, options);
    return shaped.adapter;
  }, runOptions);
  return { report, seen: shaped?.seen ?? [] };
}
const withRestartDropped = async (context) => {
  const { restart: _restart, conditions: _conditions, ...rest } = await provision(context);
  return rest;
};
const withoutIdempotencyInDiscovery = ({ json, method }) => {
  if (method !== "GET" || json?.profile !== "write") return undefined;
  const { [IDEMPOTENCY_CAPABILITY]: _removed, ...capabilities } = json.capabilities ?? {};
  return { json: { ...json, capabilities } };
};
const REPLAY_ROWS = [
  "write.durable-original-success",
  "write.durable-original-failure",
  "write.durable-original-delete",
];
/** The discovery's advertisement is real; adds a member to every Bead the provider serves. */
const addedMember = ({ json }) => {
  const withExtra = (record) =>
    record?.type?.endsWith("PortableRecord")
      ? { ...record, properties: { ...record.properties, added_by_provider: 1 } }
      : record;
  if (json?.resource) return { json: { ...json, resource: withExtra(json.resource) } };
  if (Array.isArray(json?.items)) return { json: { ...json, items: json.items.map(withExtra) } };
  if (json?.properties) return { json: withExtra(json) };
  return undefined;
};

test("--recipe sits beside --scope, takes an absolute file, and nowhere else", () => {
  assert.deepEqual(
    parseKitArguments([
      "--scope",
      "http://127.0.0.1:1/",
      "--allow-mutation",
      "--recipe",
      "/r.json",
    ]),
    { scope: "http://127.0.0.1:1/", allowMutation: true, recipe: "/r.json" },
  );
  for (const argv of [
    ["--scope", "http://127.0.0.1:1/", "--recipe", "r.json"],
    ["--scope", "http://127.0.0.1:1/", "--recipe"],
    ["--scope", "http://127.0.0.1:1/", "--recipe", "/a.json", "--recipe", "/b.json"],
    ["--provider", "/a.mjs", "--recipe", "/r.json"],
  ])
    assert.equal(parseKitArguments(argv), null, argv.join(" "));
});

for (const [label, recipe, message] of [
  ["not an object", [], /the recipe must be a JSON object/],
  ["no bead", {}, /needs `bead`/],
  ["an unread member", portableRecipe({ typo: 1 }), /a member the kit does not read/],
  [
    "a relative Type",
    portableRecipe({ bead: { ...portableRecipe().bead, type: "task" } }),
    /bead\.type must be an absolute/,
  ],
  [
    "a spelling that cannot repeat",
    portableRecipe({ bead: { ...portableRecipe().bead, id: "fixed" } }),
    /bead\.id must be/,
  ],
  [
    "a spelling that leaves the Scope",
    portableRecipe({ bead: { ...portableRecipe().bead, id: "../{unique}" } }),
    /bead\.id must be/,
  ],
  [
    "properties that are not an object",
    portableRecipe({ bead: { ...portableRecipe().bead, create: { properties: [] } } }),
    /bead\.create\.properties must be a JSON object/,
  ],
  [
    "both update forms",
    portableRecipe({
      bead: {
        ...portableRecipe().bead,
        update: { properties: {}, propertiesChange: [] },
      },
    }),
    /exactly one of/,
  ],
  [
    "a patch of a member the create did not write",
    portableRecipe({
      bead: {
        ...portableRecipe().bead,
        update: { propertiesChange: [{ op: "replace", path: "/other", value: 1 }] },
      },
    }),
    /must name a member bead\.create writes/,
  ],
  [
    "an update that changes nothing",
    portableRecipe({
      bead: { ...portableRecipe().bead, update: { properties: { title: "written" } } },
    }),
    /changes nothing/,
  ],
  [
    "a Link with no Type",
    portableRecipe({ link: { id: "service-allocated" } }),
    /link needs `type`/,
  ],
  [
    "an excepted row with no reason",
    portableRecipe({ excepted: { "write.link-update": "" } }),
    /needs a reason/,
  ],
  [
    "an excepted Core row",
    portableRecipe({ excepted: { "core.point-read": "no" } }),
    /no Write row or optional row/,
  ],
  [
    "an excepted row no case runs",
    portableRecipe({ excepted: { "write.remaining-five-operations": "no" } }),
    /no Write row or optional row/,
  ],
  ["an unknown excepted row", portableRecipe({ excepted: { "IT-99": "no" } }), /`IT-99`/],
])
  test(`a recipe with ${label} is a harness error before anything is provisioned`, async () => {
    let provisioned = false;
    const report = await runCurrentProvider(
      async () => {
        provisioned = true;
        throw new Error("not reached");
      },
      { recipe },
    );
    assert.equal(provisioned, false);
    assert.equal(report.state, "harness-error");
    assert.match(report.harnessFailure, /^The recipe is refused: /);
    assert.match(report.harnessFailure, message);
    assert.equal(report.lifecycle.provision, "not-run");
    assert.equal(report.recipe, undefined);
  });

test("the CLI refuses an unreadable or non-JSON recipe as a harness error, sending nothing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-kit-recipe-"));
  const notJson = path.join(directory, "recipe.json");
  await writeFile(notJson, "{ not json");
  const server = http.createServer((_request, response) => response.end());
  let requests = 0;
  server.on("request", () => requests++);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const scope = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const [file, message] of [
      [path.join(directory, "absent.json"), /its file could not be read/],
      [notJson, /its file is not JSON/],
    ]) {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("./current-provider-kit.mjs", import.meta.url)),
            "--scope",
            scope,
            "--recipe",
            file,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout }));
      });
      assert.equal(result.code, 3);
      const report = JSON.parse(result.stdout);
      assert.equal(report.state, "harness-error");
      assert.match(report.harnessFailure, message);
    }
    assert.equal(requests, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("a recipe run says it is one; a run without a recipe says nothing of it", async () => {
  const strict = await runCurrentProvider(provision);
  assert.equal(strict.recipe, undefined);
  const { report, seen } = await runReshaped({}, { recipe: portableRecipe() });
  assert.equal(report.recipe.used, true);
  assert.equal(report.recipe.comparison, "authored-members");
  assert.match(report.recipe.statement, /Not the strict portable fixture/);
  assert.match(report.recipe.sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.state, "incomplete", JSON.stringify(report));
  assert.equal(report.sliceComplete, true, JSON.stringify(report));
  // The provider's bodies went on the wire, and its Link's endpoints are plain References.
  const creates = seen.filter(
    ({ method, url, contentType }) =>
      method === "POST" && url.endsWith("/createBead") && contentType !== "application/json",
  );
  assert(creates.every(({ body }) => body.properties.title === "written"));
  assert(creates.every(({ body }) => /\/recipe\/|^recipe\//.test(body.id)));
  assert.equal(
    new Set(creates.filter(({ key }) => !key.startsWith("create-")).map((c) => c.body.id)).size,
    3,
  );
  const link = seen.find(({ method, url }) => method === "POST" && url.endsWith("/createLink"));
  assert.equal(typeof link.body.source, "string");
  assert.equal(typeof link.body.target, "string");
  assert.deepEqual(link.body.properties, { label: "linked" });
});

test("a recipe's patch update runs, with its no-op sending the created values back", async () => {
  const { report, seen } = await runReshaped(
    {},
    {
      recipe: portableRecipe({
        bead: {
          ...portableRecipe().bead,
          create: { properties: { title: "written", extra: "kept" } },
          update: { propertiesChange: [{ op: "replace", path: "/title", value: "edited" }] },
        },
      }),
    },
  );
  assert.equal(rowOf(report, "write.no-op").state, "pass", JSON.stringify(report));
  assert.equal(rowOf(report, "write.effectful-update").state, "pass", JSON.stringify(report));
  const updates = seen.filter(
    ({ method, url }) => method === "POST" && url.endsWith("/updateBead"),
  );
  assert.deepEqual(updates[0].body.propertiesChange, [
    { op: "replace", path: "/title", value: "written" },
  ]);
  assert.deepEqual(updates.at(-1).body.propertiesChange, [
    { op: "replace", path: "/title", value: "edited" },
  ]);
});

test("a recipe lets the service allocate identities, and still catches a refused create that wrote", async () => {
  const allocated = portableRecipe({
    bead: { ...portableRecipe().bead, id: "service-allocated" },
    link: { ...portableRecipe().link, id: "service-allocated" },
  });
  const { report, seen } = await runReshaped({}, { recipe: allocated });
  assert.equal(report.state, "incomplete", JSON.stringify(report));
  assert.equal(report.sliceComplete, true, JSON.stringify(report));
  for (const { url, body } of seen.filter((entry) => entry.method === "POST"))
    if (url.endsWith("/createBead") || url.endsWith("/createLink"))
      assert.equal(Object.hasOwn(body, "id"), false, url);

  // Forwarded as valid media and then answered 415: the only witness left is the inventory.
  const secret = await runReshaped(
    {
      before: async ({ url, contentType, headers, text, send }) => {
        if (url.endsWith("/createBead") && contentType === "application/json")
          await send(
            "POST",
            url,
            { ...headers, "content-type": "application/vnd.bdp.v0.1+json" },
            text,
          );
      },
    },
    { recipe: allocated },
  );
  assert.equal(rowOf(secret.report, "write.media-before-admission").state, "fail");
  assert.match(rowOf(secret.report, "write.media-before-admission").reason, /left a record behind/);
});

test("under a recipe a provider may add members; the strict fixture still refuses them", async () => {
  const strict = await runReshaped({ rewrite: addedMember });
  assert.equal(rowOf(strict.report, "write.create").state, "fail");
  assert.equal(strict.report.state, "fail");

  const { report } = await runReshaped({ rewrite: addedMember }, { recipe: portableRecipe() });
  assert.equal(rowOf(report, "write.create").state, "pass", JSON.stringify(report));
  assert.equal(rowOf(report, "write.effectful-update").state, "pass");
  assert.equal(rowOf(report, "write.link-create").state, "pass", JSON.stringify(report));
  assert.equal(report.sliceComplete, true);
});

for (const [row, label, rewrite, reason] of [
  [
    "write.create",
    "a written value that came back different",
    ({ url, json }) =>
      url.endsWith("/createBead") && json?.resource
        ? {
            json: {
              ...json,
              resource: {
                ...json.resource,
                properties: { ...json.resource.properties, title: "other" },
              },
            },
          }
        : undefined,
    /properties\.title did not come back as the kit wrote it/,
  ],
  [
    "write.create",
    "a written metadata member that did not come back",
    ({ url, json }) =>
      url.endsWith("/createBead") && json?.resource
        ? { json: { ...json, resource: { ...json.resource, metadata: {} } } }
        : undefined,
    /metadata\.source did not come back as the kit wrote it/,
  ],
  [
    "write.effectful-update",
    "an update that lost what it wrote",
    ({ url, json }) =>
      url.endsWith("/updateBead") && json?.changed
        ? {
            json: {
              ...json,
              resource: {
                ...json.resource,
                properties: { ...json.resource.properties, title: "written" },
              },
            },
          }
        : undefined,
    /properties\.title did not come back as the kit wrote it/,
  ],
  [
    "write.link-create",
    "a Link that lost a written property",
    ({ url, json }) =>
      url.endsWith("/createLink") && json?.resource
        ? { json: { ...json, resource: { ...json.resource, properties: {} } } }
        : undefined,
    /properties\.label did not come back as the kit wrote it/,
  ],
])
  test(`under a recipe ${row} still fails on ${label}`, async () => {
    const { report } = await runReshaped({ rewrite }, { recipe: portableRecipe() });
    assert.equal(rowOf(report, row).state, "fail", JSON.stringify(rowOf(report, row)));
    assert.match(rowOf(report, row).reason, reason);
    assert.equal(report.state, "fail");
  });

test("everything else stays strict under a recipe: a point read must equal the whole result", async () => {
  // Only the point read carries the extra member, so authored members alone would not see it.
  const { report } = await runReshaped(
    {
      rewrite: ({ method, url, json }) =>
        method === "GET" && /\/recipe\/[^/]+$/.test(url) && json?.properties
          ? { json: { ...json, properties: { ...json.properties, added_by_provider: 1 } } }
          : undefined,
    },
    { recipe: portableRecipe() },
  );
  assert.equal(rowOf(report, "core.point-read").state, "fail");
});

test("without idempotency the replay rows are not applicable and nothing replays", async () => {
  const { report, seen } = await runReshaped({ rewrite: withoutIdempotencyInDiscovery });
  assert.equal(report.state, "incomplete", JSON.stringify(report));
  for (const id of REPLAY_ROWS) {
    assert.equal(rowOf(report, id).state, "not-applicable", id);
    assert.equal(rowOf(report, id).required, false, id);
    assert.match(rowOf(report, id).reason, /by discovery.*idempotency/);
  }
  assert.equal(rowOf(report, "write.create").state, "pass");
  assert.equal(rowOf(report, "write.restart").state, "pass");
  assert.equal(rowOf(report, "core.deleted-absence").state, "pass");
  for (const id of ["write.alias-put", "write.alias-delete", "write.link-delete"])
    assert.equal(rowOf(report, id).state, "pass", JSON.stringify(rowOf(report, id)));
  assert.equal(report.sliceComplete, true);
  assert.equal(report.qualificationComplete, false);
  const replayed = seen.filter(
    ({ method, url, contentType, key }) =>
      method === "POST" && !/\/bdp\/call/.test(url) && contentType !== "application/json" && key,
  );
  const keys = replayed.map(({ key }) => key);
  assert.deepEqual(
    keys,
    [...new Set(keys)],
    "a key was sent twice to a Scope that replays nothing",
  );
});

test("without idempotency a repeat the Scope really refuses cannot fail write.create; with it, it still does", async () => {
  // The first answer is the real one; the same key's second is what Write says without the capability.
  const refuseSecond = ({ method, url, seen }) => {
    if (method !== "POST" || !url.endsWith("/createBead")) return undefined;
    const sent = seen.filter(
      (entry) =>
        entry.method === "POST" && entry.url === url && entry.contentType !== "application/json",
    );
    return sent.length > 1 && sent.at(-1).key === sent[0].key
      ? {
          status: 409,
          contentType: "application/problem+json",
          json: {
            type: "https://github.com/gastownhall/bdp/problems/conflict",
            status: 409,
            code: "identity-taken",
            retry: "never",
          },
        }
      : undefined;
  };
  const unadvertised = await runReshaped({
    rewrite: (exchange) => withoutIdempotencyInDiscovery(exchange) ?? refuseSecond(exchange),
  });
  assert.equal(rowOf(unadvertised.report, "write.create").state, "pass");
  const advertised = await runReshaped({ rewrite: refuseSecond });
  assert.equal(rowOf(advertised.report, "write.create").state, "fail");
  assert.equal(advertised.report.state, "fail");
});

test("without idempotency and a restart hook, restart is not run and the deleted read still is", async () => {
  const { report } = await runReshaped({
    rewrite: withoutIdempotencyInDiscovery,
    base: withRestartDropped,
  });
  assert.equal(rowOf(report, "write.restart").state, "not-run");
  assert.match(rowOf(report, "write.restart").reason, /No explicit adapter restart hook/);
  for (const id of REPLAY_ROWS) assert.equal(rowOf(report, id).state, "not-applicable", id);
  assert.equal(rowOf(report, "core.deleted-absence").state, "pass");
});

test("replay rows stay not applicable, not unauthorized, when mutation is not allowed", async () => {
  const { report } = await runReshaped(
    { rewrite: withoutIdempotencyInDiscovery, base: withRestartDropped },
    { allowMutation: false },
  );
  for (const id of REPLAY_ROWS) assert.equal(rowOf(report, id).state, "not-applicable", id);
  assert.equal(rowOf(report, "write.create").state, "not-run");
});

test("a provider cannot make its replay rows not applicable by withdrawing idempotency mid-run", async () => {
  let reads = 0;
  const { report } = await runReshaped({
    rewrite: (exchange) => {
      if (exchange.method !== "GET" || exchange.json?.profile !== "write") return undefined;
      return ++reads > 2 ? withoutIdempotencyInDiscovery(exchange) : undefined;
    },
  });
  assert.equal(report.state, "harness-error");
  assert.match(report.harnessFailure, /changed its idempotency advertisement/);
  assert.equal(report.sliceComplete, false);
});

test("a provider that advertises idempotency is still held to its replays", async () => {
  const report = await runCurrentProvider(provision);
  for (const id of REPLAY_ROWS) assert.equal(rowOf(report, id).state, "pass", id);
  // A fresh answer dressed as the original still fails the durable row it reaches.
  const seen = new Set();
  const { report: wrong } = await runReshaped({
    rewrite: ({ url, key, json, status }) => {
      if (!url.endsWith("/deleteBead") || status !== 200) return undefined;
      if (!seen.has(key)) {
        seen.add(key);
        return undefined;
      }
      return { json: { ...json, changed: false } };
    },
  });
  assert.equal(rowOf(wrong, "write.durable-original-delete").state, "fail");
});

const refuseUpdateLink = ({ method, url }) =>
  method === "POST" && url.endsWith("/updateLink")
    ? {
        status: 422,
        contentType: "application/problem+json",
        json: {
          type: "https://github.com/gastownhall/bdp/problems/validation",
          status: 422,
          code: "operation-not-supported",
          retry: "never",
        },
      }
    : undefined;

test("a recipe's excepted Write row reads excepted, keeps what it observed, and never counts", async () => {
  const why = "updateLink waits for a durable Link identity";
  const { report } = await runReshaped(
    { answer: refuseUpdateLink },
    { recipe: portableRecipe({ excepted: { "write.link-update": why } }) },
  );
  const row = rowOf(report, "write.link-update");
  assert.equal(row.state, "excepted");
  assert.equal(row.reason, why);
  assert.equal(row.observed, "fail");
  assert.match(row.observedReason, /Public assertion failed/);
  assert.equal(row.observedAnswer, "HTTP 422 operation-not-supported");
  assert.equal(row.required, true);
  assert.deepEqual(report.recipe.exceptedRows, ["write.link-update"]);
  // The Link created before it is still deleted, so the row behind it is measured.
  assert.equal(rowOf(report, "write.link-delete").state, "pass", JSON.stringify(report));
  assert.equal(report.state, "incomplete");
  assert.equal(report.sliceComplete, false);
  assert.equal(report.qualificationComplete, false);
});

test("the same refusal with no exception fails the row and leaves the delete behind it not-run", async () => {
  const { report } = await runReshaped({ answer: refuseUpdateLink }, { recipe: portableRecipe() });
  assert.equal(rowOf(report, "write.link-update").state, "fail");
  assert.equal(rowOf(report, "write.link-delete").state, "not-run");
  assert.equal(report.state, "fail");
});

test("an excepted Write row that passes still reads excepted, through the recipe or the ledger", async () => {
  for (const options of [
    { recipe: portableRecipe({ excepted: { "write.link-update": "why" } }) },
    { exceptions: { "write.link-update": "why" } },
  ]) {
    const { report } = await runReshaped({}, options);
    const row = rowOf(report, "write.link-update");
    assert.equal(row.state, "excepted");
    assert.equal(row.observed, "pass");
    assert.equal(row.observedReason, undefined);
    assert.equal(report.state, "incomplete");
    assert.equal(report.sliceComplete, false);
    assert.equal(report.qualificationComplete, false);
    assert.equal(rowOf(report, "write.link-delete").state, "pass");
  }
});

test("an excepted row's failure does not stop the rows after it, unless they need what it made", async () => {
  const brokenGuard = ({ url, json }) =>
    url.endsWith("/updateBead") && json?.code === "revision-mismatch"
      ? { json: { ...json, code: "other" } }
      : undefined;
  const { report } = await runReshaped(
    { rewrite: brokenGuard },
    { exceptions: { "write.guard-failure": "known" } },
  );
  assert.equal(rowOf(report, "write.guard-failure").state, "excepted");
  assert.equal(rowOf(report, "write.guard-failure").observed, "fail");
  assert.equal(rowOf(report, "write.effectful-update").state, "pass");
  assert.equal(rowOf(report, "write.link-create").state, "pass");

  const refuseCreate = ({ url, contentType }) =>
    url.endsWith("/createBead") && contentType !== "application/json"
      ? { status: 200, json: { outcome: "wrong" } }
      : undefined;
  const stopped = await runReshaped(
    { rewrite: refuseCreate },
    { exceptions: { "write.create": "known" } },
  );
  assert.equal(rowOf(stopped.report, "write.create").state, "excepted");
  assert.equal(rowOf(stopped.report, "write.no-op").state, "not-run");
});

test("the ledger refuses a Write row no case runs, and an excepted row can never qualify", async () => {
  const report = await runCurrentProvider(provision, {
    exceptions: { "write.remaining-five-operations": "no" },
  });
  assert.equal(report.state, "harness-error");
  assert.match(
    report.harnessFailure,
    /names `write\.remaining-five-operations`, which no case runs/,
  );

  const passing = await runCurrentProvider(provision);
  const rows = passing.obligations.map((row) => ({ ...row, state: "pass", required: true }));
  const lifecycle = { provision: "pass", cleanup: "pass" };
  assert.equal(hasCompleteRequiredCoverage(rows, lifecycle), true);
  rows.find((row) => row.id === "write.link-update").state = "excepted";
  assert.equal(hasCompleteRequiredCoverage(rows, lifecycle), false);
});

test("a provider that takes no exceptions refuses a recipe's excepted rows, not the recipe", async () => {
  const base = provisionReference();
  const taken = await runCurrentProvider(base, { recipe: portableRecipe() });
  assert.equal(taken.harnessFailure, undefined);
  assert.equal(taken.recipe.used, true);
  assert.equal(rowOf(taken, "write.create").state, "pass");
  const refused = await runCurrentProvider(base, {
    recipe: portableRecipe({ excepted: { "write.link-update": "no" } }),
  });
  assert.equal(refused.state, "harness-error");
  assert.match(refused.harnessFailure, /takes no exceptions/);
  assert.equal(refused.lifecycle.cleanup, "pass");
});

test("an optional row named in a recipe is excepted through the same route", async () => {
  const report = await runCurrentProvider(provisionReference({}, { takesNoExceptions: false }), {
    recipe: portableRecipe({ excepted: { "CB-1": "known" } }),
  });
  const row = report.optional.find((entry) => entry.row === "CB-1");
  assert.equal(row.state, "excepted");
  assert.equal(row.observed, "pass");
});
