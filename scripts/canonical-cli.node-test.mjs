/** Current-contract black-box acceptance: real emitted CLI -> HTTP proxy ->
 * reference service -> private SQLite. No global Vitest admission mock. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startReferenceService } from "../packages/server/dist/reference.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const binary = path.join(root, "apps/bdp/dist/main.js");
const specification = "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json";
const json = ["--output-format", "json"];
const token = "canonical-cli-test-secret-00000000000000000000";
async function cli(args, directory, scope, extras = {}, controls = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("BDP_") && key !== "XDG_STATE_HOME",
    ),
  );
  Object.assign(env, {
    XDG_STATE_HOME: directory,
    ...(scope === undefined ? {} : { BDP_SCOPE_URL: scope, BDP_AUTH_TOKEN: token }),
    ...extras,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binary, ...args], {
      cwd: directory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI exceeded 15 second test budget"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      controls.onStdout?.(stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    controls.onSpawn?.(child);
    child.stdin.end();
  });
}
function success(result, kind) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  const value = JSON.parse(result.stdout);
  assert.equal(value.schema_version, 2);
  assert.equal(value.bdp_spec, specification);
  assert.equal(value.outcome, "success");
  assert.equal(value.result_kind, kind);
  return value;
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}
async function close(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("canonical is default; help and excluded product globals use the actual process", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cli-help-"));
  try {
    const rootHelp = await cli(["--help"], directory);
    assert.equal(rootHelp.code, 0);
    assert.match(rootHelp.stdout, /^Usage: bdp/);
    assert.equal(rootHelp.stderr, "");
    for (const [args, message] of [
      [["--secret-token"], "1 unsupported argument(s); use --help for usage"],
      [["--secret-token", "--another-secret"], "1 unsupported argument(s); use --help for usage"],
      [["--config="], "--config requires a non-empty path; use --help for usage"],
      [["--config", ""], "--config requires a non-empty path; use --help for usage"],
      [["--config"], "--config requires a path; use --help for usage"],
      [["--config", "--help"], "--config requires a path; use --help for usage"],
      [
        ["--config", "private-first", "--config=private-second"],
        "--config may be given only once; use --help for usage",
      ],
    ]) {
      const refused = await cli(args, directory);
      assert.equal(refused.code, 2);
      assert.equal(refused.stdout, "");
      assert.deepEqual(JSON.parse(refused.stderr), {
        level: "error",
        event: "cli.usage",
        executable: "bdp",
        message,
      });
      assert.doesNotMatch(refused.stderr, /secret-token/);
    }
    assert.match(rootHelp.stdout, /Read Commands:/);
    assert.match(rootHelp.stdout, /Write Commands:/);
    const createHelp = await cli(["create", "--help"], directory);
    assert.match(createHelp.stdout, /--actor/);
    assert.match(createHelp.stdout, /Global Flags:/);
    const showHelp = await cli(["show", "--help"], directory);
    assert.doesNotMatch(showHelp.stdout, /--actor/);
    for (const flag of [
      "--json",
      "--db",
      "--workspace",
      "--verbose",
      "--quiet",
      "--readonly",
      "--no-daemon",
    ]) {
      assert.equal((await cli([flag, "show", "a"], directory)).code, 2, flag);
      assert.equal((await cli(["show", "a", flag], directory)).code, 2, flag);
    }
    assert.equal(
      (await cli(["alias", "put", "aliases/name", "--target", "a", "--actor", "writer"], directory))
        .code,
      2,
    );
    assert.equal((await cli(["delete", "a", "--force", "--actor", "writer"], directory)).code, 2);
    for (const command of [["serve"], ["type", "list"], ["query"], ["graph"], ["count"]])
      assert.equal((await cli(command, directory)).code, 2, command.join(" "));
    const config = path.join(directory, "config.json");
    await writeFile(config, JSON.stringify({ cli: { profile: "compat" } }));
    const compat = await cli(["--config", config, "--help"], directory);
    assert.match(compat.stdout, /^Usage: bdp/);
    assert.doesNotMatch(compat.stdout, /Write Commands:/);
    const override = await cli(
      ["--config", config, "--cli-profile", "canonical", "--help"],
      directory,
    );
    assert.match(override.stdout, /Write Commands:/);
    assert.equal((await cli(["--version"], directory)).stdout.trim(), "bdp 0.0.0");
    const unbound = await cli(["list", ...json], directory);
    assert.equal(unbound.code, 2);
    assert.equal(JSON.parse(unbound.stdout).error.problem.code, "missing_target_scope");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("canonical CRUD, native pages, exact wire inputs, previews and same-key recovery survive reopen", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cli-reference-"));
  const requests = [];
  let reference,
    dropNextWrite = false;
  const proxy = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
        body,
      });
      const listener = new URL(reference.listenUrl);
      const forward = request(
        {
          hostname: listener.hostname,
          port: listener.port,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          const bytes = [];
          response.on("data", (chunk) => bytes.push(chunk));
          response.on("end", () => {
            if (incoming.method === "POST" && dropNextWrite) {
              dropNextWrite = false;
              outgoing.destroy();
              return;
            }
            outgoing.writeHead(response.statusCode, response.headers);
            outgoing.end(Buffer.concat(bytes));
          });
        },
      );
      forward.on("error", () => {
        outgoing.statusCode = 502;
        outgoing.end();
      });
      forward.end(body);
    });
  });
  const port = await listen(proxy),
    scope = `http://127.0.0.1:${port}/work/`;
  const store = path.join(directory, "store");
  const serviceOptions = {
    directory: store,
    create: true,
    instance: "canonical-cli",
    scope,
    credentials: [{ token, principal: "operator" }],
  };
  try {
    reference = await startReferenceService(serviceOptions);
    const description = success(
      await cli(["scope", "inspect", ...json], directory, scope),
      "scope",
    );
    assert.equal(description.data.beads, scope + "bdp/beads");
    assert.equal(description.data.events, undefined);
    const create = success(
      await cli(
        [
          "--scope",
          scope,
          "create",
          "--id",
          "a",
          "--type",
          "https://types.invalid/Note",
          "--properties",
          '{"title":"First","body":"Exact body","nested":[{"a":1},{"a":2}]}',
          "--actor",
          "agent:test",
          ...json,
        ],
        directory,
        scope,
      ),
      "mutation",
    );
    const original = create.data.resource;
    assert.equal(original.id, scope + "a");
    const wireCreate = requests.find((r) => r.method === "POST");
    assert.equal(wireCreate.path, "/work/bdp/operations/createBead");
    assert.equal(wireCreate.headers.authorization, `Bearer ${token}`);
    assert.equal(wireCreate.headers["content-type"], "application/vnd.bdp.v0.1+json");
    assert.deepEqual(JSON.parse(wireCreate.body).revisionProvenance, {
      actor: { id: "agent:test", basis: "writer-supplied" },
    });
    assert.equal(wireCreate.headers.actor, undefined);
    assert.equal(original.revisionProvenance.actor.id, "agent:test");
    for (const id of ["b", "c"])
      success(
        await cli(
          ["create", "--id", id, "--type", "https://types.invalid/Note", ...json],
          directory,
          scope,
        ),
        "mutation",
      );
    const shown = success(await cli(["show", "a", ...json], directory, scope), "resource");
    assert.deepEqual(shown.data, original);
    const human = await cli(["show", "a"], directory, scope);
    assert.equal(human.code, 0);
    assert.match(human.stdout, /First/);
    assert.match(human.stdout, /Exact body/);
    const projected = success(
      await cli(
        ["show", "a", "--properties-only", "--include", "/nested/1/a", ...json],
        directory,
        scope,
      ),
      "properties",
    );
    assert.deepEqual(projected.data, { nested: [{ a: 2 }] });
    const page = success(
      await cli(["list", "--page-size", "1", ...json], directory, scope),
      "resource_collection",
    );
    assert.equal(page.data.items.length, 1);
    assert.equal(page.completion.stop_reason, "page");
    assert.equal(typeof page.data.next, "string");
    const next = success(
      await cli(
        ["list", "--continue", page.data.next, "--page-size", "1", ...json],
        directory,
        scope,
      ),
      "resource_collection",
    );
    assert.notEqual(next.data.items[0].id, page.data.items[0].id);
    const stream = await cli(
      ["list", "--page-size", "1", "--output-format", "jsonl"],
      directory,
      scope,
    );
    assert.equal(stream.code, 0, stream.stderr);
    const lines = stream.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(lines[0].record_type, "header");
    assert.equal(lines[0].outcome, undefined);
    assert.equal(lines.filter((line) => line.record_type === "item").length, 3);
    assert.deepEqual(lines.at(-1).completion, {
      returned: 3,
      exhausted: true,
      stop_reason: "exhausted",
    });
    assert.equal(lines.at(-1).continuation, null);
    const updated = success(
      await cli(
        [
          "update",
          "a",
          "--if-revision",
          original.revision,
          "--set-property",
          "title=Edited",
          ...json,
        ],
        directory,
        scope,
      ),
      "mutation",
    );
    assert.equal(updated.data.resource.properties.title, "Edited");
    const guardWire = requests.filter((r) => r.path.endsWith("/updateBead")).at(-1);
    assert.equal(JSON.parse(guardWire.body).expectedRevision, original.revision);
    const stale = await cli(
      ["update", "a", "--if-revision", original.revision, "--set-property", "title=Wrong", ...json],
      directory,
      scope,
    );
    assert.equal(stale.code, 4, stale.stdout);
    assert.equal(JSON.parse(stale.stdout).error.problem.code, "revision-mismatch");
    const beforePreview = requests.filter((r) => r.method === "POST").length;
    const preview = success(await cli(["delete", "b", ...json], directory, scope), "resource");
    assert.equal(preview.context.preview, "delete");
    assert.equal(requests.filter((r) => r.method === "POST").length, beforePreview);
    const offline = await cli(
      [
        "create",
        "--scope",
        scope,
        "--id",
        "offline",
        "--type",
        "https://types.invalid/Note",
        "--dry-run-mode",
        "batch",
        "--batch-bind",
        "note",
      ],
      directory,
      scope,
    );
    assert.equal(offline.code, 0, offline.stderr);
    assert.equal(JSON.parse(offline.stdout).operation, "createBead");
    assert.equal(JSON.parse(offline.stdout).name, "note");
    assert.equal(requests.filter((r) => r.method === "POST").length, beforePreview);
    const dry = await cli(
      ["update", "a", "--set-property", "title=Not applied", "--dry-run-mode", "bdp"],
      directory,
      scope,
    );
    assert.equal(dry.code, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).headers["idempotency-key"], undefined);
    assert.equal(requests.filter((r) => r.method === "POST").length, beforePreview);
    success(
      await cli(
        [
          "link",
          "create",
          "a",
          "b",
          "--type",
          "https://types.invalid/Related",
          "--id",
          "edge",
          ...json,
        ],
        directory,
        scope,
      ),
      "mutation",
    );
    const links = success(
      await cli(["link", "list", "a", "b", ...json], directory, scope),
      "resource_collection",
    );
    assert.equal(links.data.items[0].id, scope + "edge");
    const incident = success(
      await cli(["link", "list", "--incident-to", "a", ...json], directory, scope),
      "resource_collection",
    );
    assert.equal(incident.data.items[0].id, scope + "edge");
    assert.equal(incident.context.resource_kind, "link");
    assert.ok(requests.some((r) => r.path.startsWith("/work/a?view=links")));
    const rawMissing = await cli(
      ["show", "missing", "--omit", "envelope", ...json],
      directory,
      scope,
    );
    assert.equal(rawMissing.code, 3);
    assert.equal(rawMissing.stdout, "");
    assert.match(rawMissing.stderr, /resource-not-found/);
    success(
      await cli(["alias", "put", "aliases/current", "--target", "a", ...json], directory, scope),
      "mutation",
    );
    assert.equal(
      success(
        await cli(["alias", "resolve", "aliases/current", ...json], directory, scope),
        "reference",
      ).data,
      scope + "a",
    );
    const aliasRead = success(
      await cli(["show", "aliases/current", ...json], directory, scope),
      "resource",
    );
    assert.equal(aliasRead.data.id, scope + "a");
    assert.equal(aliasRead.context.subject, scope + "a");
    dropNextWrite = true;
    const uncertain = await cli(
      ["create", "--id", "uncertain", "--type", "https://types.invalid/Note", ...json],
      directory,
      scope,
    );
    assert.equal(uncertain.code, 1);
    const unknown = JSON.parse(uncertain.stdout);
    assert.equal(unknown.outcome, "unknown");
    const recovery = unknown.context.recovery.file;
    const saved = await readFile(recovery, "utf8");
    assert.equal(saved.includes(token), false);
    const beforeRetry = requests.length;
    const changedPrincipal = await cli(
      ["create", "--retry-file", recovery, ...json],
      directory,
      scope,
      { BDP_AUTH_TOKEN: "different-principal" },
    );
    assert.equal(changedPrincipal.code, 2);
    assert.equal(requests.length, beforeRetry);
    const originalKey = requests.filter((r) => r.path.endsWith("/createBead")).at(-1).headers[
      "idempotency-key"
    ];
    await reference.close();
    reference = await startReferenceService({ ...serviceOptions, create: false });
    const replay = success(
      await cli(["create", "--retry-file", recovery, ...json], directory, scope),
      "mutation",
    );
    assert.equal(replay.data.resource.id, scope + "uncertain");
    const replayWire = requests.at(-1);
    assert.equal(replayWire.headers["idempotency-key"], originalKey);
    assert.equal(replayWire.method, "POST");
    assert.equal(requests.length, beforeRetry + 1, "retry must not rediscover/re-read inputs");
    success(
      await cli(
        ["update", "uncertain", "--set-property", "title=Later", ...json],
        directory,
        scope,
      ),
      "mutation",
    );
    const oldReplay = success(
      await cli(["create", "--retry-file", recovery, ...json], directory, scope),
      "mutation",
    );
    assert.deepEqual(
      oldReplay.data,
      replay.data,
      "replay returns the entire original envelope after later mutations",
    );
    assert.ok((await readdir(path.join(directory, "bdp", "retry"))).length > 0);
  } finally {
    await reference?.close();
    await close(proxy);
    await rm(directory, { recursive: true, force: true });
  }
});

test("delivery streams pages and settles interruption and closed stdout", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cli-delivery-"));
  let reference, intercept;
  const proxy = createServer((incoming, outgoing) => {
    const listener = new URL(reference.listenUrl);
    const forward = request(
      {
        hostname: listener.hostname,
        port: listener.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const release = () => {
            outgoing.writeHead(response.statusCode, response.headers);
            outgoing.end(Buffer.concat(chunks));
          };
          if (!intercept?.(incoming, release)) release();
        });
      },
    );
    forward.on("error", () => outgoing.destroy());
    incoming.pipe(forward);
  });
  const port = await listen(proxy),
    scope = `http://127.0.0.1:${port}/work/`;
  try {
    reference = await startReferenceService({
      directory: path.join(directory, "store"),
      create: true,
      instance: "cli-delivery",
      scope,
      credentials: [{ token, principal: "operator" }],
    });
    for (const id of ["a", "b"])
      success(
        await cli(
          ["create", "--id", id, "--type", "https://types.invalid/Note", ...json],
          directory,
          scope,
        ),
        "mutation",
      );
    await t.test("JSONL delivers a full first page while the next response is held", async () => {
      let releaseNext, resolveHeld, resolveItem;
      const held = new Promise((resolve) => {
        resolveHeld = resolve;
      });
      const item = new Promise((resolve) => {
        resolveItem = resolve;
      });
      intercept = (incoming, release) => {
        if (incoming.url.includes("cursor=")) {
          releaseNext = release;
          resolveHeld();
          return true;
        }
        return false;
      };
      const running = cli(
        ["list", "--page-size", "1", "--output-format", "jsonl"],
        directory,
        scope,
        {},
        {
          onStdout: (stdout) => {
            if (stdout.includes('"record_type":"item"')) resolveItem();
          },
        },
      );
      let timer, observationError;
      try {
        await held;
        await Promise.race([
          item,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("first JSONL page was buffered behind next response")),
              1000,
            );
          }),
        ]);
      } catch (error) {
        observationError = error;
      } finally {
        clearTimeout(timer);
        intercept = undefined;
        releaseNext?.();
      }
      const result = await running;
      if (observationError) throw observationError;
      assert.equal(result.code, 0, result.stderr);
    });
    await t.test(
      "SIGINT on the next fetch preserves the last delivered native boundary",
      async () => {
        let child, releaseNext;
        intercept = (incoming, release) => {
          if (incoming.url.includes("cursor=")) {
            releaseNext = release;
            child.kill("SIGINT");
            return true;
          }
          return false;
        };
        let result;
        try {
          result = await cli(
            ["list", "--page-size", "1", "--output-format", "jsonl"],
            directory,
            scope,
            {},
            {
              onSpawn: (process) => {
                child = process;
              },
            },
          );
        } finally {
          intercept = undefined;
          releaseNext?.();
        }
        assert.equal(result.code, 130, result.stderr);
        assert.equal(result.signal, null);
        const records = result.stdout.trim().split("\n").map(JSON.parse);
        assert.equal(records[0].record_type, "header");
        assert.equal(records.filter((record) => record.record_type === "item").length, 1);
        const terminal = records.at(-1);
        assert.equal(terminal.outcome, "failure");
        assert.equal(terminal.error.problem.code, "interrupted");
        assert.deepEqual(terminal.completion, {
          returned: 1,
          exhausted: false,
          stop_reason: "error",
        });
        assert.equal(typeof terminal.continuation, "string");
        const resumed = success(
          await cli(
            ["list", "--continue", terminal.continuation, "--page-size", "1", ...json],
            directory,
            scope,
          ),
          "resource_collection",
        );
        assert.notEqual(resumed.data.items[0].id, records[1].data.id);
      },
    );
    await t.test("SIGINT after committed POST yields130 and same-key recovery", async () => {
      let child, releaseWrite;
      intercept = (incoming, release) => {
        if (incoming.method === "POST") {
          releaseWrite = release;
          child.kill("SIGINT");
          return true;
        }
        return false;
      };
      let result;
      try {
        result = await cli(
          ["create", "--id", "interrupted", "--type", "https://types.invalid/Note", ...json],
          directory,
          scope,
          {},
          {
            onSpawn: (process) => {
              child = process;
            },
          },
        );
      } finally {
        intercept = undefined;
        releaseWrite?.();
      }
      assert.equal(result.signal, null);
      assert.equal(result.code, 130, result.stderr);
      const failure = JSON.parse(result.stdout);
      assert.equal(failure.outcome, "unknown");
      const retry = success(
        await cli(
          ["create", "--retry-file", failure.context.recovery.file, ...json],
          directory,
          scope,
        ),
        "mutation",
      );
      assert.equal(retry.data.resource.id, `${scope}interrupted`);
    });
    await t.test("SIGINT can stop a backpressured output writer", async () => {
      const input = path.join(directory, "large.json");
      await writeFile(input, JSON.stringify({ body: "x".repeat(50_000) }));
      for (let index = 0; index < 10; index++) {
        success(
          await cli(
            [
              "create",
              "--id",
              `large${index}`,
              "--type",
              "https://types.invalid/Note",
              "--properties",
              `@${input}`,
              ...json,
            ],
            directory,
            scope,
          ),
          "mutation",
        );
      }
      const result = await cli(
        ["list", "--unpaged", ...json],
        directory,
        scope,
        {},
        {
          onSpawn: (child) => {
            child.stdout.pause();
            child.stdout.once("readable", () => child.kill("SIGINT"));
            child.once("exit", () => child.stdout.resume());
          },
        },
      );
      assert.equal(result.signal, null);
      assert.equal(result.code, 130, result.stderr);
      assert.doesNotMatch(result.stderr, /Unhandled|unhandled|node:events/);
    });
    await t.test(
      "closed stdout reports known committed outcome without an uncaught EPIPE",
      async () => {
        const result = await cli(
          ["create", "--id", "closed-output", "--type", "https://types.invalid/Note", ...json],
          directory,
          scope,
          {},
          { onSpawn: (child) => child.stdout.destroy() },
        );
        assert.equal(result.code, 1);
        assert.equal(result.signal, null);
        assert.doesNotMatch(result.stderr, /Unhandled|unhandled|node:events|stack/);
        const diagnostic = JSON.parse(result.stderr);
        assert.equal(diagnostic.error.problem.code, "output_failed");
        assert.equal(diagnostic.context.operation_outcome, "success");
        assert.equal(
          success(await cli(["show", "closed-output", ...json], directory, scope), "resource").data
            .id,
          `${scope}closed-output`,
        );
      },
    );
  } finally {
    intercept = undefined;
    await reference?.close();
    proxy.closeAllConnections();
    await close(proxy);
    await rm(directory, { recursive: true, force: true });
  }
});
