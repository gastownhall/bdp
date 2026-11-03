/** Bounded reference-only observations, not a performance gate or conformance kit. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { startReferenceService } from "../../packages/server/dist/reference.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scales = { small: { beads: 20, pageSize: 7 }, medium: { beads: 100, pageSize: 17 } };
let scale = "small",
  output;
const seen = new Set();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i],
    value = process.argv[i + 1];
  assert(
    ["--scale", "--output"].includes(name) && value && !seen.has(name),
    "Usage: reference-trends.mjs [--scale small|medium] [--output FILE]",
  );
  seen.add(name);
  if (name === "--scale") scale = value;
  else output = path.resolve(value);
}
assert(Object.hasOwn(scales, scale), "scale must be small or medium");
const workload = {
  ...scales[scale],
  concurrency: 1,
  payloadBytes: 128,
  requestTimeoutMs: 5000,
  runTimeoutMs: 120000,
  warmup: "none; cold first observation retained",
  repetitions: 1,
};
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const untracked = [];
for (const file of git("ls-files", "--others", "--exclude-standard", "-z")
  .split("\0")
  .filter(Boolean))
  untracked.push({ file, sha256: hash(await readFile(path.join(root, file))) });
const pnpmVersion = process.env.npm_execpath
  ? execFileSync(process.execPath, [process.env.npm_execpath, "--version"], {
      encoding: "utf8",
    }).trim()
  : execFileSync("pnpm", ["--version"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(process.version, "v24.22.1", "use the pinned Node version");
assert.equal(pnpmVersion, "11.20.0", "use the pinned pnpm version");
const report = {
  format: "bdp-reference-trends-1",
  status: "running",
  startedAt: new Date().toISOString(),
  source: {
    head: git("rev-parse", "HEAD").trim(),
    statusPorcelain: git("status", "--porcelain=v1"),
    trackedDiffSha256: hash(git("diff", "--binary", "HEAD")),
    untracked,
    builtReferenceSha256: hash(
      await readFile(new URL("../../packages/server/dist/reference.js", import.meta.url)),
    ),
    lockSha256: hash(await readFile(path.join(root, "pnpm-lock.yaml"))),
  },
  toolchain: {
    node: process.version,
    nodeExecutable: process.execPath,
    pnpm: pnpmVersion,
    versions: process.versions,
  },
  host: {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    availableMemoryBytesAtStart: os.freemem(),
    ci: process.env.CI === "true",
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  },
  workload: {
    scale,
    ...workload,
    composition: "Core + ordinary Write, no optional capabilities",
    transport: "real loopback HTTP, canonical Host, same-process service and driver, no SDK",
    operations:
      "sequential createBead/createLink, updateBead, point GET, complete bead/link page traversal, graceful close/reopen, original create-key replay",
  },
  observations: [],
  checkpoints: [],
};
const controller = new AbortController();
const timer = setTimeout(
  () => controller.abort(new Error("performance run exceeded120s")),
  workload.runTimeoutMs,
);
const interrupted = (signal) => {
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  controller.abort(new Error(`performance run interrupted by ${signal}`));
};
const onInt = () => interrupted("SIGINT"),
  onTerm = () => interrupted("SIGTERM");
process.on("SIGINT", onInt);
process.on("SIGTERM", onTerm);
let directory, server;
const started = performance.now();
async function timed(operation, action, detail = {}) {
  controller.signal.throwIfAborted();
  const begin = performance.now();
  const value = await action();
  report.observations.push({ operation, ...detail, milliseconds: performance.now() - begin });
  return value;
}
async function checkpoint(phase) {
  const files = [];
  for (const name of await readdir(directory)) {
    const info = await stat(path.join(directory, name));
    assert(info.isFile(), "unexpected nested store entry");
    files.push({ name, bytes: info.size });
  }
  console.error(JSON.stringify({ event: "reference-perf.checkpoint", phase }));
  report.checkpoints.push({
    phase,
    elapsedMilliseconds: performance.now() - started,
    memoryBytes: process.memoryUsage(),
    storeFiles: files.sort((a, b) => a.name.localeCompare(b.name)),
    storeBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  });
}
const scope = "https://perf.invalid/reference/",
  media = "application/vnd.bdp.v0.1+json";
const token = randomBytes(32).toString("base64url");
async function wire(target, body, key) {
  const logical = new URL(target),
    listen = new URL(server.listenUrl);
  assert.equal(logical.origin, new URL(scope).origin);
  assert(logical.pathname.startsWith(new URL(scope).pathname));
  const bytes = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: listen.hostname,
        port: listen.port,
        path: logical.pathname + logical.search,
        method: bytes === undefined ? "GET" : "POST",
        signal: controller.signal,
        headers: {
          host: logical.host,
          authorization: `Bearer ${token}`,
          accept: media,
          ...(bytes === undefined
            ? {}
            : {
                "content-type": media,
                "content-length": Buffer.byteLength(bytes),
                "idempotency-key": key,
              }),
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1048576) req.destroy(new Error("response exceeds1MiB"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`unexpected HTTP${res.statusCode}`));
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ text, value: JSON.parse(text) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(workload.requestTimeoutMs, () => req.destroy(new Error("request exceeded5s")));
    req.end(bytes);
  });
}
let failure;
try {
  directory = await mkdtemp(path.join(os.tmpdir(), "bdp-reference-perf-"));
  const options = {
    directory,
    create: true,
    instance: "reference-perf",
    scope,
    credentials: [{ token, principal: "perf-owner" }],
  };
  server = await timed("provision", () => startReferenceService(options));
  const discovery = (await wire(server.navigation.description)).value;
  assert.equal(discovery.capabilities, undefined);
  await checkpoint("empty");
  const creates = [],
    current = new Map();
  for (let i = 0; i < workload.beads; i++) {
    const body = {
      id: `bead-${String(i).padStart(4, "0")}`,
      type: "https://types.invalid/perf",
      properties: { index: i, payload: "x".repeat(workload.payloadBytes) },
    };
    const key = `create-${i}`;
    const reply = await timed(
      "createBead",
      () => wire(server.navigation.targets.createBead, body, key),
      { index: i },
    );
    assert.equal(reply.value.outcome, "created");
    assert.equal(reply.value.changed, true);
    assert.equal(reply.value.resource.id, scope + body.id);
    assert.deepEqual(reply.value.resource.properties, body.properties);
    creates.push({ body, key, text: reply.text });
    current.set(reply.value.resource.id, reply.value.resource);
  }
  const links = new Map(),
    ids = [...current.keys()];
  for (let i = 1; i < ids.length; i++) {
    const reply = await timed(
      "createLink",
      () =>
        wire(
          server.navigation.targets.createLink,
          {
            id: `edge-${i}`,
            type: "https://types.invalid/edge",
            source: ids[i - 1],
            target: ids[i],
          },
          `edge-${i}`,
        ),
      { index: i },
    );
    assert.equal(reply.value.outcome, "created");
    assert.equal(reply.value.resource.source, ids[i - 1]);
    assert.equal(reply.value.resource.target, ids[i]);
    links.set(reply.value.resource.id, reply.value.resource);
  }
  await checkpoint("created");
  for (const [index, id] of ids.entries()) {
    const reply = await timed(
      "updateBead",
      () =>
        wire(
          server.navigation.targets.updateBead,
          { bead: id, metadata: { updated: true }, expectedRevision: current.get(id).revision },
          `update-${index}`,
        ),
      { index },
    );
    assert.equal(reply.value.outcome, "updated");
    assert.equal(reply.value.changed, true);
    assert.notEqual(reply.value.resource.revision, current.get(id).revision);
    assert.deepEqual(reply.value.resource.properties, current.get(id).properties);
    assert.deepEqual(reply.value.resource.metadata, { updated: true });
    current.set(id, reply.value.resource);
  }
  async function readAndPage(label) {
    for (const [id, expected] of [...current, ...links]) {
      const reply = await timed(`pointRead.${label}`, () => wire(id));
      assert.deepEqual(reply.value, expected);
    }
    for (const [kind, expected] of [
      ["beads", current],
      ["links", links],
    ]) {
      let next = `${server.navigation[kind]}?limit=${workload.pageSize}`,
        pages = 0;
      const observed = new Map();
      while (next !== null) {
        assert(++pages <= expected.size + 1, "page traversal did not terminate");
        const reply = await timed(`page.${kind}.${label}`, () => wire(next), { page: pages });
        assert(reply.value.items.length > 0 && reply.value.items.length <= workload.pageSize);
        for (const item of reply.value.items) {
          assert(!observed.has(item.id), "duplicate item in page traversal");
          assert.deepEqual(item, expected.get(item.id));
          observed.set(item.id, item);
        }
        next = reply.value.next;
        assert(next === null || typeof next === "string");
      }
      assert.deepEqual([...observed.keys()].sort(), [...expected.keys()].sort());
    }
  }
  await readAndPage("beforeReopen");
  await checkpoint("updatedAndRead");
  await timed("close", () => server.close());
  server = undefined;
  server = await timed("reopen", () => startReferenceService({ ...options, create: false }));
  await checkpoint("reopened");
  await readAndPage("afterReopen");
  for (const [index, saved] of creates.entries()) {
    const reply = await timed(
      "originalKeyReplay",
      () => wire(server.navigation.targets.createBead, saved.body, saved.key),
      { index },
    );
    assert.equal(reply.text, saved.text, "replay substituted current postimage");
  }
  // Replays must preserve the independently updated live postimages.
  for (const [id, expected] of current) assert.deepEqual((await wire(id)).value, expected);
  await checkpoint("replayed");
  await timed("finalClose", () => server.close());
  server = undefined;
  await checkpoint("closed");
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.error = { name: error.name, message: error.message };
} finally {
  const cleanupErrors = [];
  try {
    await server?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (directory) await rm(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  clearTimeout(timer);
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
  report.cleanup = {
    ownedTemporaryDirectory: directory ?? null,
    removedOwnedDirectory: directory !== undefined && cleanupErrors.length === 0,
    errors: cleanupErrors.map((error) => error.message),
  };
  if (cleanupErrors.length) {
    report.status = "failed";
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      "performance workload/cleanup failed",
    );
  }
}
report.finishedAt = new Date().toISOString();
report.elapsedMilliseconds = performance.now() - started;
report.processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
report.notes = [
  "Raw end-to-end operation timings include HTTP/body decoding; assertions run outside each timed interval.",
  "Memory is the combined driver+service Node process, sampled at checkpoints; maxRSS is process lifetime peak.",
  "Store bytes are logical file sizes, not physical allocated blocks or attributable write amplification.",
  "No warmup exclusion, percentile gate, SLA, cold disk-cache promise, power-loss test, or external-provider qualification.",
];
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, json);
} else process.stdout.write(json);
if (failure) {
  console.error(failure);
  process.exitCode ||= 1;
}
