/** Real public-boundary controls; no mock provider answers enter the verifier. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCurrentProvider, UNCOVERED_REQUIRED } from "./current-provider-kit.mjs";
import { provision } from "./current-provider-reference-adapter.mjs";

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
  assert.equal(implemented(report).length, 13);
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

async function corruptingProvider(context, cleanupFails = false, corruption = "postimage") {
  const provider = await provision(context);
  let upstream = new URL(provider.connections[0].connectOrigin);
  const proxy = http.createServer((request, response) => {
    const call = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (reply) => {
        const chunks = [];
        reply.on("data", (chunk) => chunks.push(chunk));
        reply.on("end", () => {
          let body = Buffer.concat(chunks);
          if (
            reply.headers["content-type"]?.startsWith("application/vnd.bdp.v0.1+json") &&
            body.length
          ) {
            const value = JSON.parse(body);
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
          if (corruption === "discovery-link") delete reply.headers.link;
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
      const restarted = await provider.restart();
      upstream = new URL(restarted.connections[0].connectOrigin);
      return {
        connections: [
          {
            ...restarted.connections[0],
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
