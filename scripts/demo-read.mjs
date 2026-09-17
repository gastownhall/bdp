#!/usr/bin/env node

// This walkthrough uses shipping Read admission, transport, client and adapter code.
// Its corpus is deliberately the existing conformance fixture, not user data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConfiguredBdptestReadServer } from "../apps/bdptest/dist/server-composition.js";
import { createBdProcessScopePort } from "../packages/adapter-bd/dist/index.js";
import { BdpClient, createFetchTransport } from "../packages/client/dist/index.js";
import { loadStartupConfig } from "../packages/config/dist/index.js";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createPublicReadControls,
  createReadServer,
  listenNodeHttpServer,
} from "../packages/server/dist/index.js";
import {
  assertStartupDiagnostic,
  parseExactJson,
  spawnChild,
  terminateChild,
} from "./e2e-ready.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2) {
  throw new Error("Usage: node scripts/demo-read.mjs NEW_OUTPUT_DIRECTORY [PINNED_BD_EXECUTABLE]");
}
const output = path.resolve(args[0]);
const executable = args[1] === undefined ? undefined : path.resolve(args[1]);
const backend = executable === undefined ? "bdptest" : "bdpbd";
const port = Number(process.env.BDP_DEMO_PORT ?? "19280");
assert(Number.isInteger(port) && port > 1024 && port < 65536, "invalid BDP_DEMO_PORT");
const scope = `http://127.0.0.1:${port}/local-test/`;
// Refuse to mix evidence from separate attempts or touch an existing workspace.
await mkdir(output, { recursive: false, mode: 0o700 });
const transcript = [];
const http = [];
const responses = [];
const children = [];
const controller = new AbortController();
const deadline = setTimeout(
  () => controller.abort(new Error("demo exceeded 120 seconds")),
  120_000,
);
const interrupt = () => controller.abort(new Error("demo interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const fixture = JSON.parse(
  await readFile(
    new URL(
      `../packages/conformance/fixtures/read-${backend === "bdptest" ? "reference" : "bdpbd"}-v1.json`,
      import.meta.url,
    ),
    "utf8",
  ),
);
let server;
let listener;
let client;
let listenerFailure;
let activePhase = "setup";
let successful = false;
let failure;
let isolatedRoot;
const commands = [];
function say(text) {
  transcript.push(text);
  process.stdout.write(`${text}\n`);
}
async function command(commandPath, argv, cwd, environment) {
  controller.signal.throwIfAborted();
  const record = spawnChild(commandPath, argv, {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: 30_000,
  });
  children.push(record);
  const abort = () => {
    void terminateChild(record).catch(() => undefined);
  };
  controller.signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await record.result;
    commands.push({ command: commandPath, argv, cwd, ...result });
    controller.signal.throwIfAborted();
    assert.equal(result.code, 0, result.stderr);
    return result;
  } finally {
    controller.signal.removeEventListener("abort", abort);
    await terminateChild(record);
  }
}
async function read(request) {
  const value = await client.perform(request, { signal: controller.signal });
  assert.equal(value.code, undefined, JSON.stringify(value));
  responses.push({ request, value });
  return value;
}
try {
  // Match the established matrix's temporary-root isolation. A durable directory
  // beneath a user's home can discover an ancestor .beads even with a fresh HOME.
  isolatedRoot = await mkdtemp("/tmp/bdp-read-demo-");
  const home = path.join(isolatedRoot, "home");
  const workspace = path.join(isolatedRoot, "workspace");
  await mkdir(home);
  await mkdir(workspace);
  await writeFile(
    path.join(home, ".gitconfig"),
    "[user]\n name = bdp-conformance\n email = bdp-conformance@invalid\n",
  );
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: isolatedRoot,
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    BD_NON_INTERACTIVE: "1",
    CI: "true",
  };
  let oracle = fixture.expectations.readyJson;
  if (executable !== undefined) {
    const identity = JSON.parse(
      await readFile(
        new URL(
          "../docs/design/evidence/bd-baseline/observations/00-identity.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const sha256 = createHash("sha256")
      .update(await readFile(executable))
      .digest("hex");
    assert.equal(
      sha256,
      identity.host_local.sha256,
      "this local walkthrough requires the recorded bd binary; no automatic rebaseline",
    );
    const version = await command(executable, ["version", "--json"], workspace, environment);
    assert.deepEqual(JSON.parse(version.stdout), identity.portable.version_json);
    await writeFile(
      path.join(output, "bd-identity.json"),
      JSON.stringify(
        {
          executable,
          realpath: await realpath(executable),
          sha256,
          version: JSON.parse(version.stdout),
          provenance: identity.source_provenance,
          admission: "capture-host artifact only; not portable version admission",
        },
        null,
        2,
      ),
    );
    say(
      "Preparing a fresh real bd workspace using the recorded fixture (about 30 seconds end to end).",
    );
    // Same commands and 1.1-second creation spacing as the approved matrix seeder.
    // Run through the supervised command recorder so failures retain stderr.
    const bd = (args) =>
      command(executable, ["--actor", fixture.bd.actor, ...args], workspace, environment);
    await bd(["init", "--prefix", fixture.bd.prefix, "--skip-agents", "--skip-hooks"]);
    for (const [index, bead] of fixture.bd.beads.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1_100));
      await bd([
        "create",
        bead.title,
        "--id",
        bead.id,
        "--type",
        bead.type,
        "--priority",
        String(bead.priority),
        "--silent",
      ]);
    }
    for (const link of fixture.bd.links)
      await bd(["dep", "add", link.source, link.target, "--type", link.type]);
    for (const bead of fixture.bd.beads) {
      if (bead.status === "closed") await bd(["close", bead.id, "--reason", "conformance fixture"]);
      else if (bead.status === "deferred") await bd(["defer", bead.id]);
    }
    const direct = await command(
      executable,
      ["--actor", fixture.bd.actor, "ready", "--limit", "0", "--json"],
      workspace,
      environment,
    );
    oracle = JSON.parse(direct.stdout);
    const config = loadStartupConfig({
      role: "bdpbd",
      env: {
        BDP_SCOPE_URL: scope,
        BDP_SERVER_PORT: String(port),
        BDP_SERVER_ADVERTISED_PROFILE: "read",
        BDP_BD_WORKSPACE: workspace,
        BDP_BD_EXECUTABLE: executable,
      },
    });
    server = createReadServer({
      scope,
      target: "bdpbd",
      admittedProfile: admitReadServerProfile("read", "bdpbd"),
      port: createBdProcessScopePort(scope, { executable, workspace, environment }),
      advertisedLimits: config.server.limits,
      readControls: createPublicReadControls({ scope, limits: config.server.limits }),
    });
  } else {
    const config = loadStartupConfig({
      role: "bdptest",
      env: {
        BDP_SCOPE_URL: scope,
        BDP_SERVER_PORT: String(port),
        BDP_SERVER_ADVERTISED_PROFILE: "read",
      },
    });
    server = createConfiguredBdptestReadServer(config);
  }
  listener = createNodeHttpServer(server, {
    onError: (error) => {
      listenerFailure ??= error;
    },
  });
  // Observe the actual server-side requests, including those from the separate CLI.
  listener.on("request", (request, response) => {
    const entry = { phase: activePhase, method: request.method, target: request.url, status: null };
    http.push(entry);
    response.once("finish", () => {
      entry.status = response.statusCode;
    });
  });
  await listenNodeHttpServer(listener, {
    host: "127.0.0.1",
    port,
    onError: (error) => {
      listenerFailure ??= error;
    },
  });
  client = new BdpClient({ scope, transport: createFetchTransport() });
  say(
    `\nBDP Read walkthrough — ${backend === "bdptest" ? "deterministic reference server" : "real bd-backed server"}`,
  );
  say("The small A/B/C examples are test tasks. B depends on A; A depends on C, which is closed.");
  activePhase = "discovery";
  const discovery = await client.discover({ signal: controller.signal });
  assert.equal(discovery.profile, "read");
  responses.push({ request: "discovery", value: discovery });
  say(
    `1. Discover the server over HTTP: ${discovery.scope} advertises BDP ${discovery.bdpVersion}, Read.`,
  );
  activePhase = "links";
  const beadB = await read({
    kind: "resource",
    resource: "bead",
    id: new URL(fixture.bindings["bead.demo-b"], scope).href,
  });
  const incident = await read({ kind: "bead-links", bead: beadB.id, direction: "outbound" });
  assert.equal(incident.next, null, "this fixture should fit in one page");
  const link = incident.items.find((item) => item.type === "https://work.example/types/blocks");
  assert(link, "missing B -> A dependency");
  const beadA = await read({
    kind: "resource",
    resource: "bead",
    id: typeof link.target === "string" ? link.target : link.target.uri,
  });
  assert.equal(beadB.properties.title, "B");
  assert.equal(beadA.properties.title, "A");
  assert.equal(beadA.properties.status, "open");
  say(
    `2. Follow a real BDP Link: ${beadB.properties.title} -> ${beadA.properties.title}. A is ${beadA.properties.status}, so B must wait.`,
  );
  const aLinks = await read({ kind: "bead-links", bead: beadA.id, direction: "outbound" });
  assert.equal(aLinks.next, null);
  const aLink = aLinks.items.find((item) => item.type === "https://work.example/types/blocks");
  assert(aLink, "missing A -> C dependency");
  const beadC = await read({
    kind: "resource",
    resource: "bead",
    id: typeof aLink.target === "string" ? aLink.target : aLink.target.uri,
  });
  assert.equal(beadC.properties.title, "C");
  assert.equal(beadC.properties.status, "closed");
  say(
    `3. Follow the next Link: A -> ${beadC.properties.title}. C is ${beadC.properties.status}, so A's dependency is satisfied.`,
  );
  activePhase = "bdp-cli";
  const cli = await command(
    process.execPath,
    ["apps/bdp/dist/main.js", "bd", "ready", "--json"],
    root,
    { ...environment, BDP_SCOPE_URL: scope },
  );
  assertStartupDiagnostic(cli.stderr, scope);
  const ready = parseExactJson(cli.stdout, backend);
  assert.deepEqual(
    ready,
    oracle,
    "actual CLI did not match the independent fixture/direct-bd oracle",
  );
  assert.deepEqual(
    ready.map((item) => item.title),
    ["J", "D", "A"],
  );
  const cliRequests = http.filter((entry) => entry.phase === "bdp-cli");
  assert(cliRequests.some((entry) => entry.target === "/local-test/bdp.json"));
  assert(cliRequests.some((entry) => entry.target.startsWith("/local-test/beads/")));
  assert(cliRequests.some((entry) => entry.target.includes("?view=links&direction=outbound")));
  assert(cliRequests.every((entry) => entry.method === "GET" && [200, 204].includes(entry.status)));
  say(
    `4. Run the actual 'bdp bd ready --json' CLI: ${ready.map((item) => item.title).join(", ")}. B is absent, as expected.`,
  );
  say(
    `   Observed ${cliRequests.length} actual HTTP GETs from that CLI; it read discovery, beads and incident links.`,
  );
  say(
    executable === undefined
      ? "   Result matches the checked-in fixture oracle."
      : "   Result exactly matches a separate direct 'bd ready --limit 0 --json' invocation.",
  );
  assert.equal(listenerFailure, undefined);
  successful = true;
} catch (error) {
  failure = String(error?.stack ?? error);
  process.exitCode = 1;
  say(`FAILED: ${error.message}`);
} finally {
  controller.abort();
  clearTimeout(deadline);
  const cleanup = [];
  for (const action of [
    () => client?.close(),
    () => listener && closeNodeHttpServer(listener),
    () => server?.close(),
    ...children.map((child) => () => terminateChild(child)),
  ]) {
    try {
      await action();
    } catch (error) {
      cleanup.push(String(error));
    }
  }
  if (isolatedRoot !== undefined) {
    try {
      await cp(isolatedRoot, path.join(output, "isolated-state"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await rm(isolatedRoot, { recursive: true });
    } catch (error) {
      cleanup.push(String(error));
    }
  }
  if (cleanup.length > 0) {
    say(`CLEANUP FAILED: ${cleanup.join("; ")}`);
    successful = false;
    process.exitCode = 1;
  }
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  const result = {
    successful,
    backend,
    scope,
    node: process.version,
    failure,
    cleanup,
    http,
    responses,
    commands,
    limits: [
      "Read only; no BDP mutations, Transactions or History.",
      "Fixture task/dependency Links; not new graph Memory records.",
      "No PR54 dynamic-schema-specific exercise, no managed-engine integration claim.",
    ],
  };
  await writeFile(path.join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(output, "transcript.txt"), `${transcript.join("\n")}\n`);
  if (successful) say(`PASS. Parsed responses, CLI output and HTTP request log saved in ${output}`);
}
