/** Disposable installed review workstation. No product CLI or protocol additions. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer as httpServer, request } from "node:http";
import { createRequire } from "node:module";
import { connect, createServer as unixServer } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { withPackedChild, withPackedWorkspace } from "./packed-workspace.mjs";

const self = fileURLToPath(import.meta.url);
const workspace = path.resolve(path.dirname(self), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const event = (name, fields = {}) =>
  console.log(JSON.stringify({ event: `review-lab.${name}`, ...fields }));
const MAX_SESSION = 2 * 60 * 60 * 1000;
const IDLE = 15 * 60 * 1000;
const MAX_RELAY = 4 * 1024 * 1024;
const MAX_INPUT = 65536;

/** Workstation restriction, not new CLI semantics: no remote targets/config escapes. */
export function admitInvocation(args, scope, state) {
  if (
    !Array.isArray(args) ||
    args.length > 128 ||
    !args.every((arg) => typeof arg === "string" && !arg.includes("\0")) ||
    Buffer.byteLength(JSON.stringify(args)) > MAX_INPUT
  )
    throw new Error("Invalid argv");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i],
      name = arg.split("=", 1)[0];
    if (["--config", "--cli-profile"].includes(name)) throw new Error("Lab configuration is fixed");
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const value = equals < 0 ? arg : arg.slice(equals + 1);
    const flag = equals < 0 ? args[i - 1] : name;
    if (flag === "--retry-file" && !path.resolve(value).startsWith(state + path.sep))
      throw new Error("Use an owned lab recovery file");
    const url = value.startsWith("[") ? value.slice(1).split("]", 1)[0] : value;
    if (
      /^https?:/i.test(url) &&
      !["--type", "--exact-type"].includes(flag) &&
      !url.startsWith(scope)
    )
      throw new Error("Only this loopback Scope may be contacted");
  }
}

/** Combined producer bound, enforced before retaining any child bytes. */
export function boundedCapture(onOverflow) {
  const chunks = { stdout: [], stderr: [] };
  let used = 0,
    overflow = false;
  return {
    append(stream, bytes) {
      if (overflow) return;
      if (used + bytes.length > 1024 * 1024) {
        overflow = true;
        onOverflow();
        return;
      }
      used += bytes.length;
      chunks[stream].push(bytes);
    },
    get retainedBytes() {
      return used;
    },
    finish() {
      if (overflow) throw new Error("Lab output bound exceeded");
      return {
        stdout: Buffer.concat(chunks.stdout).toString("base64"),
        stderr: Buffer.concat(chunks.stderr).toString("base64"),
      };
    },
  };
}

/** Keep the primary failure even if cleanup fails; no public fault injection. */
export async function finishOwned(operation, cleanup) {
  let result,
    primary,
    failed = false;
  try {
    result = await operation();
  } catch (error) {
    primary = error;
    failed = true;
  }
  try {
    await cleanup();
  } catch (error) {
    throw failed ? new AggregateError([primary, error], "Lab operation and cleanup failed") : error;
  }
  if (failed) throw primary;
  return result;
}
const listen = (server, target) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(target, () => {
      server.off("error", reject);
      resolve();
    });
  });
const close = (server) =>
  new Promise((resolve, reject) => {
    if (!server?.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
async function sourceIdentity(installed) {
  const git = async (args) =>
    (
      await promisify(execFile)("git", args, {
        cwd: workspace,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  const packs = path.join(installed.temporaryRoot, "packs");
  const tarballs = {};
  for (const name of (await readdir(packs)).sort())
    tarballs[name] = hash(await readFile(path.join(packs, name)));
  const consumer = createRequire(path.join(installed.installRoot, "review-consumer.cjs"));
  return {
    source: await git(["rev-parse", "HEAD"]),
    tree: await git(["rev-parse", "HEAD^{tree}"]),
    sourceDirty: (await git(["status", "--porcelain"])) !== "",
    lockSha256: hash(await readFile(path.join(workspace, "pnpm-lock.yaml"))),
    node: process.version,
    pnpm: (
      await promisify(execFile)(process.execPath, [process.env.npm_execpath, "--version"], {
        timeout: 5000,
      })
    ).stdout.trim(),
    tarballs,
    installedCliSha256: hash(await readFile(installed.entry("bdp"))),
    installedServerEntrySha256: hash(await readFile(consumer.resolve("@bdp/server/reference"))),
    installedSdkEntrySha256: hash(await readFile(consumer.resolve("@bdp/client"))),
    limits:
      "Entry/tarball custody only; no complete transitive-build attestation or provider qualification.",
  };
}

/** A local launcher sends only argv. Credentials and CLI children stay with the owner. */
async function invoke(socketPath, args) {
  const socket = connect(socketPath);
  const result = await new Promise((resolve, reject) => {
    let bytes = 0,
      text = "",
      complete = false;
    socket.setTimeout(70_000, () => socket.destroy(new Error("Lab invocation timed out")));
    socket.on("error", reject);
    socket.on("close", () => {
      if (!complete) {
        process.stdin.destroy();
        reject(new Error("Lab owner closed"));
      }
    });
    socket.on("connect", async () => {
      try {
        const chunks = [];
        let length = 0;
        if (
          !process.stdin.isTTY ||
          args.includes("@-") ||
          args.some(
            (arg) =>
              /^--(?:properties|metadata|replace-properties|patch-properties|replace-metadata|patch-metadata|revision-provenance)=@-$/.test(
                arg,
              ) || arg === "--file=-",
          ) ||
          args.some((arg, i) => arg === "--file" && args[i + 1] === "-")
        ) {
          for await (const chunk of process.stdin) {
            length += chunk.length;
            if (length > MAX_INPUT) throw new Error("Lab stdin bound exceeded");
            chunks.push(chunk);
          }
        }
        socket.end(JSON.stringify({ args, stdin: Buffer.concat(chunks).toString("base64") }));
      } catch {
        socket.destroy(new Error("Lab input failed"));
      }
    });
    socket.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_RELAY) socket.destroy(new Error("Lab output bound exceeded"));
      else text += chunk;
    });
    socket.on("end", () => {
      try {
        const reply = JSON.parse(text);
        complete = true;
        resolve(reply);
      } catch {
        reject(new Error("Invalid lab reply"));
      }
    });
  });
  process.stdout.write(Buffer.from(result.stdout, "base64"));
  process.stderr.write(Buffer.from(result.stderr, "base64"));
  return result.code;
}

/** Parent owns the worker's process group and installation through all outcomes. */
export async function runInstalledLab(
  installed,
  {
    check = false,
    input = process.stdin,
    signal = new AbortController().signal,
    onOutput = (text) => process.stdout.write(text),
  } = {},
) {
  const root = path.join(installed.temporaryRoot, "review");
  return withPackedChild(
    signal,
    process.execPath,
    [self, "--worker", installed.installRoot, root, check ? "check" : "interactive"],
    {
      cwd: installed.temporaryRoot,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith("BDP_") && name !== "XDG_STATE_HOME",
        ),
      ),
      stdio: ["pipe", "pipe", "pipe"],
      timeoutMs: MAX_SESSION + 15_000,
      onStdout: onOutput,
    },
    async (record) => {
      if (input) input.pipe(record.child.stdin);
      try {
        const result = await record.result;
        if (result.code !== 0 || result.signal !== null)
          throw new Error("Review lab failed; cleanup remains owned");
        return result;
      } finally {
        if (input) input.unpipe(record.child.stdin);
      }
    },
  );
}

async function worker(installRoot, root, check) {
  // mkdir is deliberately exclusive. Refuse preexisting paths without deleting them.
  await mkdir(root, { mode: 0o700 });
  const controller = new AbortController(),
    active = new Set(),
    peers = new Set();
  const consumer = createRequire(path.join(installRoot, "review-consumer.cjs"));
  let reference,
    proxy,
    broker,
    idle,
    maximum,
    lines,
    pendingControl = Promise.resolve();
  const token = randomBytes(32).toString("base64url");
  const socketPath = path.join(path.dirname(root), "r.sock");
  let failure;
  let scope,
    config,
    busy = false,
    closing = false;
  const abort = () => controller.abort(new Error("Lab stopped"));
  const touch = () => {
    clearTimeout(idle);
    if (!closing) idle = setTimeout(abort, IDLE);
  };
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  await finishOwned(
    async () => {
      const { startReferenceService } = await import(
        pathToFileURL(consumer.resolve("@bdp/server/reference")).href
      );
      const { RetainedClient, createRetainedFetchTransport, createHistoricalUpdateFetchTransport } =
        await import(pathToFileURL(consumer.resolve("@bdp/client")).href);
      proxy = httpServer((incoming, outgoing) => {
        if (closing || !reference) {
          outgoing.writeHead(503).end();
          return;
        }
        event("request", { activeCli: busy });
        const destination = new URL(reference.listenUrl);
        const forward = request(
          {
            hostname: destination.hostname,
            port: destination.port,
            path: incoming.url,
            method: incoming.method,
            headers: incoming.headers,
            signal: controller.signal,
          },
          (response) => {
            outgoing.writeHead(response.statusCode, response.headers);
            response.pipe(outgoing);
          },
        );
        let bytes = 0;
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 65536) forward.destroy();
        });
        forward.on("error", () => {
          if (!outgoing.headersSent) outgoing.writeHead(502);
          outgoing.end();
        });
        incoming.on("aborted", () => forward.destroy());
        incoming.pipe(forward);
      });
      await listen(proxy, { host: "127.0.0.1", port: 0 });
      scope = `http://127.0.0.1:${proxy.address().port}/work/`;
      config = {
        directory: path.join(root, "store"),
        create: true,
        instance: "spec-review",
        scope,
        historicalUpdate: true,
        credentials: [{ token, principal: "reviewer" }],
      };
      reference = await startReferenceService(config);
      const configPath = path.join(root, "config.json"),
        state = path.join(root, "state");
      await writeFile(
        configPath,
        JSON.stringify({ scope: { url: scope }, auth: { token }, cli: { profile: "canonical" } }),
        { flag: "wx", mode: 0o600 },
      );
      await mkdir(state, { mode: 0o700 });
      const ownedState = await realpath(state);
      const binary = path.join(installRoot, "node_modules", ".bin", "bdp");
      const environment = {
        ...process.env,
        BDP_SCOPE_URL: scope,
        BDP_AUTH_TOKEN: token,
        XDG_STATE_HOME: state,
        TMPDIR: root,
        TEMP: root,
        TMP: root,
      };
      const execute = async (args, stdin = Buffer.alloc(0)) => {
        admitInvocation(args, scope, state);
        const retryAt = args.findIndex(
          (arg) => arg === "--retry-file" || arg.startsWith("--retry-file="),
        );
        if (retryAt >= 0) {
          const argument = args[retryAt],
            filename = argument.includes("=")
              ? argument.slice(argument.indexOf("=") + 1)
              : args[retryAt + 1];
          const resolved = await realpath(filename);
          if (
            !resolved.startsWith(ownedState + path.sep) ||
            (await stat(resolved)).size > 1024 * 1024
          )
            throw new Error("Invalid owned journal");
          const saved = JSON.parse(await readFile(resolved, "utf8"));
          if (
            saved.credentialScope !== scope ||
            saved.prepared?.scope !== scope ||
            !saved.prepared?.url?.startsWith(scope)
          )
            throw new Error("Journal must retain the local Scope");
        }
        if (closing || busy)
          return {
            code: 2,
            stdout: "",
            stderr: Buffer.from("Lab busy or stopped\n").toString("base64"),
          };
        busy = true;
        touch();
        const work = withPackedChild(
          controller.signal,
          process.execPath,
          [binary, "--config", configPath, ...args],
          { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"], timeoutMs: 65_000 },
          async (record) => {
            event("cli-started", { pid: record.child.pid });
            const capture = boundedCapture(() => {
              failure = new Error("Lab output bound exceeded");
              controller.abort(failure);
            });
            record.child.stdout.on("data", (bytes) => capture.append("stdout", bytes));
            record.child.stderr.on("data", (bytes) => capture.append("stderr", bytes));
            record.child.stdin?.end(stdin);
            const result = await record.result;
            return {
              code: result.code ?? 1,
              ...capture.finish(),
            };
          },
        );
        active.add(work);
        try {
          return await work;
        } finally {
          busy = false;
          active.delete(work);
          touch();
        }
      };
      const transportOptions = {
        allowTarget: (target) => target.startsWith(scope),
        credentialForTarget: () => token,
        limits: {
          requestBodyBytes: 65536,
          responseBodyBytes: 262144,
          responseTimeoutMs: 3000,
          cleanupTimeoutMs: 1000,
        },
      };
      const sdk = new RetainedClient({
        transport: createRetainedFetchTransport(transportOptions),
        historicalUpdateTransport: createHistoricalUpdateFetchTransport(transportOptions),
        maximumDocumentBytes: 262144,
        maximumRequestBodyBytes: 65536,
        operationTimeoutMs: 10_000,
      });
      const terminal = async (id) => {
        if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Use a literal lab Bead ID");
        const reply = await sdk.readHistoricalUpdate(scope + id, {
          terminal: true,
          scope,
          signal: controller.signal,
        });
        assert.equal(reply.kind, "success");
        return reply.value.terminal;
      };
      const restart = async () => {
        if (busy) throw new Error("Finish the active CLI command before restart");
        await reference.close();
        reference = undefined;
        reference = await startReferenceService({ ...config, create: false });
        event("restarted");
      };
      broker = unixServer({ allowHalfOpen: true }, (socket) => {
        if (peers.size >= 4) {
          socket.destroy();
          return;
        }
        peers.add(socket);
        socket.on("close", () => peers.delete(socket));
        socket.on("error", () => undefined);
        let chunks = [],
          bytes = 0;
        socket.setTimeout(70_000, () => socket.destroy());
        socket.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * MAX_INPUT) socket.destroy();
          else chunks.push(chunk);
        });
        socket.on("end", async () => {
          try {
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (
              Object.keys(input).sort().join(",") !== "args,stdin" ||
              typeof input.stdin !== "string" ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.stdin)
            )
              throw new Error("Invalid relay input");
            const stdin = Buffer.from(input.stdin, "base64");
            if (stdin.length > MAX_INPUT) throw new Error("Lab stdin bound exceeded");
            const reply = await execute(input.args, stdin);
            socket.end(JSON.stringify(reply));
          } catch {
            socket.end(
              JSON.stringify({
                code: 1,
                stdout: "",
                stderr: Buffer.from("Lab invocation refused or failed\n").toString("base64"),
              }),
            );
          }
        });
      });
      await listen(broker, socketPath);
      await chmod(socketPath, 0o600);
      // Fixed absolute paths; no shell expansion, credential, arbitrary executable or URL.
      const launcher = path.join(root, "bdp.mjs");
      await writeFile(
        launcher,
        `import { spawnSync } from 'node:child_process';\nconst r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(self)}, '--invoke', ${JSON.stringify(socketPath)}, ...process.argv.slice(2)], {stdio:'inherit'});\nprocess.exitCode = r.status ?? 1;\n`,
        { flag: "wx", mode: 0o600 },
      );
      touch();
      maximum = setTimeout(abort, MAX_SESSION);
      event("ready", {
        root,
        scope,
        launcher,
        node: process.execPath,
        pid: process.pid,
        mode: check ? "check" : "interactive",
        inactivityMilliseconds: IDLE,
        maximumMilliseconds: MAX_SESSION,
      });
      if (check) {
        await finiteCheck(execute, terminal, restart, root, state, scope);
        return;
      }
      lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      event("controls", {
        commands: ["restart", "terminal ID", "stop"],
        note: "Lab controls only; use the printed installed launcher from another terminal.",
      });
      lines.on("line", (line) => {
        touch();
        pendingControl = pendingControl
          .then(async () => {
            if (line === "stop") return abort();
            if (line === "restart") return restart();
            if (line.startsWith("terminal "))
              return event("terminal", { terminal: await terminal(line.slice(9)) });
            event("control-refused");
          })
          .catch(() => {
            event("control-failed");
            failure = new Error("Lab control failed");
            abort();
          });
      });
      lines.once("close", abort);
      await new Promise((resolve) => {
        if (controller.signal.aborted) resolve();
        else controller.signal.addEventListener("abort", resolve, { once: true });
      });
      if (failure) throw failure;
    },
    async () => {
      closing = true;
      abort();
      lines?.close();
      clearTimeout(idle);
      clearTimeout(maximum);
      for (const peer of peers) peer.destroy();
      const settled = await Promise.allSettled([...active]);
      // Only the exact expected abort is benign; cleanup failures still fail.
      const failures = settled
        .filter(
          (result) => result.status === "rejected" && result.reason !== controller.signal.reason,
        )
        .map((result) => result.reason);
      await finishOwned(
        async () => {
          await pendingControl;
          if (failures.length) throw new AggregateError(failures, "Owned CLI cleanup failed");
        },
        () =>
          finishOwned(
            () =>
              finishOwned(
                () => close(broker),
                () =>
                  finishOwned(
                    () => close(proxy),
                    () => reference?.close(),
                  ),
              ),
            async () => {
              process.off("SIGINT", abort);
              process.off("SIGTERM", abort);
              await rm(root, { recursive: true });
            },
          ),
      );
      event("closed", { root, scope });
    },
  );
}

async function finiteCheck(execute, terminal, restart, root, state, scope) {
  let step = 0;
  const run = async (args, expected = 0) => {
    event("check-step", { number: ++step });
    const reply = await execute([...args, "--output-format", "json"]);
    assert.equal(reply.code, expected, "Unexpected installed CLI exit");
    return reply.stdout
      ? JSON.parse(Buffer.from(reply.stdout, "base64").toString("utf8"))
      : undefined;
  };
  const mutation = async (args) => (await run(args)).data;
  const first = (
    await mutation([
      "create",
      "--id",
      "a",
      "--type",
      "https://types.invalid/Note",
      "--properties",
      '{"title":"First","decimal":0.5,"nested":[{"a":1},{"a":2}]}',
    ])
  ).resource;
  assert.equal((await run(["scope", "inspect"])).data.beads, `${scope}bdp/beads`);
  assert.deepEqual((await run(["show", "a"])).data, first);
  assert.deepEqual(
    (await run(["show", "a", "--properties-only", "--include", "/nested/1/a"])).data,
    { nested: [{ a: 2 }] },
  );
  await mutation(["create", "--id", "b", "--type", "https://types.invalid/Note"]);
  const page = await run(["list", "--paged", "--page-size", "1"]);
  assert.equal(page.data.items.length, 1);
  assert.equal(typeof page.data.next, "string");
  assert.equal((await run(["list", "--continue", page.data.next])).data.items.length, 1);
  const updated = await mutation([
    "update",
    "a",
    "--if-revision",
    first.revision,
    "--type",
    "https://types.invalid/Current",
    "--set-property",
    "title=Edited",
  ]);
  assert.equal(
    (
      await run(
        ["update", "a", "--if-revision", first.revision, "--set-property", "title=Wrong"],
        4,
      )
    ).error.problem.code,
    "revision-mismatch",
  );
  const noop = await mutation(["update", "a", "--set-property", "title=Edited"]);
  assert.equal(noop.changed, false);
  assert.deepEqual(noop.resource, updated.resource);
  const edge = await mutation([
    "link",
    "create",
    `a@=${updated.resource.revision}`,
    "b",
    "--id",
    "edge",
    "--type",
    "https://types.invalid/Related",
  ]);
  assert.equal(
    (await run(["link", "show", "edge"])).data.source.revision,
    updated.resource.revision,
  );
  await mutation([
    "link",
    "update",
    "edge",
    "--if-revision",
    edge.resource.revision,
    "--set-property",
    "note=Reviewed",
  ]);
  assert.equal((await run(["link", "list", "--incident-to", "a"])).data.items.length, 1);
  await mutation(["alias", "put", "aliases/current", "--target", "a"]);
  assert.equal((await run(["alias", "resolve", "aliases/current"])).data, `${scope}a`);
  await mutation(["alias", "delete", "aliases/current", "--force"]);
  assert.equal((await run(["link", "delete", "edge"])).context.preview, "delete");
  await mutation(["link", "delete", "edge", "--force"]);
  await mutation(["delete", "a", "--force", "--if-revision", updated.resource.revision]);
  await run(["show", "a"], 3);
  const deletion = await terminal("a");
  assert.notEqual(deletion.revision, updated.resource.revision);
  const recovered = await mutation([
    "update",
    "a",
    "--from-revision",
    `=${first.revision}`,
    "--if-revision",
    deletion.revision,
    "--idempotency-key",
    "lab-recover",
  ]);
  assert.deepEqual(recovered.result.resource.properties, first.properties);
  assert.equal(recovered.result.resource.type, updated.resource.type);
  await run(["link", "show", "edge"], 3);
  assert.deepEqual(recovered.historicalUpdate, {
    fromRevision: first.revision,
    previousRevision: deletion.revision,
  });
  const journals = path.join(state, "bdp", "retry");
  const records = await Promise.all(
    (await readdir(journals)).map(async (name) => ({
      name,
      data: JSON.parse(await readFile(path.join(journals, name), "utf8")),
    })),
  );
  const saved = records.filter(
    ({ data }) => data.prepared.headers["idempotency-key"] === "lab-recover",
  );
  assert.equal(saved.length, 1);
  await restart();
  const replay = await mutation(["update", "--retry-file", path.join(journals, saved[0].name)]);
  assert.deepEqual(replay, recovered);
  assert.deepEqual((await run(["show", "a"])).data, recovered.result.resource);
  assert.equal(
    (await run(["show", `a@=${first.revision}`], 1)).error.problem.code,
    "invalid-parameter",
  );
  await run(["show", "a", "--include-links"], 5);
  // Batch is registered but execution is not implemented; use a valid input file.
  const batch = path.join(root, "members.jsonl");
  await writeFile(batch, '{"operation":"deleteBead","bead":"b"}\n', { flag: "wx", mode: 0o600 });
  await run(["batch", "--file", batch], 5);
  event("checked", {
    installed: true,
    ordinaryWrite: true,
    historicalUpdate: true,
    originalReplay: true,
    reopened: true,
    fullConformance: false,
    unsupported: [
      "exact saved GET",
      "CLI batch execution",
      "Types interpretation",
      "Events",
      "full History",
      "Transfer",
      "batch2",
      "Resource projection",
    ],
  });
}

export async function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    return withPackedWorkspace(async (installed, signal) => {
      await chmod(installed.temporaryRoot, 0o700);
      const identity = await sourceIdentity(installed);
      assert.equal(identity.node, "v24.22.1");
      assert.equal(identity.pnpm, "11.20.0");
      event("identity", identity);
      await runInstalledLab(installed, { check: args[0] === "--check", signal });
    });
  }
  throw new Error("Usage: pnpm review:lab [--check]");
}
if (process.argv[1] === self) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--worker" && args.length === 4)
      await worker(args[1], args[2], args[3] === "check");
    else if (args[0] === "--invoke" && args.length >= 2)
      process.exitCode = await invoke(args[1], args.slice(2));
    else await main(args);
  } catch {
    console.error("Review lab failed; inspect owned lifecycle events. No credentials are printed.");
    process.exitCode = process.exitCode || 1;
  }
}
