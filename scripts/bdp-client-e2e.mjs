#!/usr/bin/env node
/** The reference client against a live `bd serve`, compared with a direct curl.
 *
 * Every Issue Callable runs through `bdp call NAME`, the induced command and `curl` of
 * `POST /bdp/call/NAME`. Status and body are compared modulo volatile fields, and a recording
 * proxy checks the client sent exactly the arguments and the attribution the case states. No
 * recorded POST may carry `actor` or `author` in `arguments`: who is acting is
 * `revisionProvenance.actor`, on every channel. Then the Core reads, a token-mode run, `--actor`
 * behavior and the client's document limit. It reports anomalies and changes nothing in either
 * product; it exits non-zero only when the harness itself breaks.
 *
 *   node scripts/bdp-client-e2e.mjs --bd PATH --dolt PATH --out DIR [--keep] [--only REGEX]
 *
 * Build first (`pnpm build`). Workspaces live under $TMPDIR, and cleanup kills only processes
 * whose command line or working directory is under this run's own root. */
import { execFile, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binary = join(repository, "apps/bdp/dist/main.js");
const catalogFile = join(repository, "packages/bd-domain/catalog/issue-callables-preview-1.json");
const MEDIA = "application/vnd.bdp.v0.1+json";
const CHANNELS = ["call", "tree", "curl"];
const A = "e2e";
const TELEMETRY = {
  BD_DISABLE_METRICS: "1",
  DO_NOT_TRACK: "1",
  BD_DISABLE_EVENT_FLUSH: "1",
  DOLT_DISABLE_EVENT_FLUSH: "1",
};
const DROPPED = [
  "BEADS_DIR",
  "BEADS_DB",
  "BD_ACTOR",
  "BEADS_ACTOR",
  "BEADS_DOLT_SERVER_PORT",
  "BEADS_DOLT_PASSWORD",
  "BEADS_HTTP_TOKEN",
  "BEADS_HTTP_TOKEN_COMMAND",
];

function options(argv) {
  const parsed = { keep: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--keep") parsed.keep = true;
    else if (["--bd", "--dolt", "--out", "--only"].includes(flag))
      parsed[flag.slice(2)] = argv[++index];
    else throw new Error(`unknown argument ${flag}`);
  }
  for (const name of ["bd", "dolt", "out"])
    if (parsed[name] === undefined) throw new Error(`--${name} is required`);
  return parsed;
}

const freePort = () =>
  new Promise((done, fail) => {
    const probe = createNetServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class Stack {
  constructor(settings) {
    this.settings = settings;
    this.processes = [];
    this.root = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bdp-client-e2e.")));
    this.home = join(this.root, "home");
    this.data = join(this.root, "dolt");
    this.work = join(this.root, "work");
    for (const path of [this.home, this.data, this.work]) mkdirSync(path);
    const env = { ...process.env };
    for (const name of DROPPED) delete env[name];
    this.env = {
      ...env,
      ...TELEMETRY,
      HOME: this.home,
      PATH: `${resolve(settings.dolt, "..")}:${process.env.PATH}`,
      BEADS_DOLT_AUTO_START: "0",
      BD_NON_INTERACTIVE: "1",
      BD_ACTOR: A,
      NO_COLOR: "1",
      TZ: "UTC",
      GIT_AUTHOR_NAME: "e2e",
      GIT_AUTHOR_EMAIL: "e2e@example.test",
      GIT_COMMITTER_NAME: "e2e",
      GIT_COMMITTER_EMAIL: "e2e@example.test",
    };
  }
  async start() {
    for (const [name, value] of [
      ["metrics.disabled", "true"],
      ["user.name", "e2e"],
      ["user.email", "e2e@example.test"],
    ])
      await run(this.settings.dolt, ["config", "--global", "--add", name, value], {
        env: this.env,
      });
    this.doltPort = await freePort();
    this.spawn(this.settings.dolt, ["sql-server", "--host", "127.0.0.1", "--port", this.doltPort], {
      cwd: this.data,
    });
    await this.waitPort(this.doltPort);
    await run("git", ["init", "-q"], { cwd: this.work, env: this.env });
    await this.bd(
      "init",
      "--server",
      "--external",
      "--server-host",
      "127.0.0.1",
      "--server-port",
      String(this.doltPort),
      "--server-user",
      "root",
      "--prefix",
      "sw",
      "--quiet",
      "--non-interactive",
    );
    await this.bd("config", "set", "events-journal", "true");
    this.port = await this.serve();
  }
  spawn(command, args, spawnOptions) {
    const child = spawn(command, args.map(String), {
      env: this.env,
      stdio: "ignore",
      detached: true,
      ...spawnOptions,
    });
    child.on("error", () => undefined);
    this.processes.push(child);
    return child;
  }
  bd(...args) {
    return run(this.settings.bd, args, { cwd: this.work, env: this.env, timeout: 120_000 });
  }
  async serve(extra = []) {
    const port = await freePort();
    this.spawn(this.settings.bd, ["serve", "--addr", `127.0.0.1:${port}`, ...extra], {
      cwd: this.work,
    });
    await this.waitPort(port);
    return port;
  }
  async waitPort(port) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const open = await new Promise((done) => {
        const socket = createNetServer();
        socket.close();
        fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) }).then(
          () => done(true),
          (error) => done(!/ECONNREFUSED/.test(String(error.cause?.code ?? error.cause))),
        );
      });
      if (open) return;
      await sleep(200);
    }
    throw new Error(`nothing listened on ${port}`);
  }
  async reap() {
    for (const child of this.processes) if (child.exitCode === null) child.kill("SIGTERM");
    await sleep(1000);
    for (let pass = 0; pass < 3; pass++) {
      const { stdout } = await run("ps", ["-axo", "pid=,args="], { maxBuffer: 1 << 26 });
      const owned = stdout.split("\n").flatMap((line) => {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        return match && Number(match[1]) !== process.pid && match[2].includes(this.root)
          ? [Number(match[1])]
          : [];
      });
      for (const child of this.processes)
        if (child.exitCode === null && child.pid !== undefined) owned.push(child.pid);
      if (owned.length === 0) break;
      for (const pid of owned) {
        try {
          process.kill(pid, pass === 2 ? "SIGKILL" : "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      await sleep(1000);
    }
    await this.reapByWorkingDirectory();
    if (!this.settings.keep) {
      const writable = (path) => {
        chmodSync(path, 0o700);
        for (const entry of readdirSync(path, { withFileTypes: true }))
          if (entry.isDirectory()) writable(join(path, entry.name));
      };
      try {
        writable(this.root);
      } catch {
        // rmSync reports what remains.
      }
      rmSync(this.root, { recursive: true, force: true });
    }
  }
  /** `bd db-proxy-child` may not name the root on its command line. */
  async reapByWorkingDirectory() {
    const { stdout } = await run("ps", ["-axo", "pid=,args="], { maxBuffer: 1 << 26 });
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(.*(?:db-proxy-child|dolt sql-server| serve ).*)$/.exec(line);
      if (!match) continue;
      const cwd = await run("lsof", ["-a", "-d", "cwd", "-p", match[1], "-Fn"]).then(
        ({ stdout: text }) => text,
        () => "",
      );
      if (cwd.includes(this.root)) {
        try {
          process.kill(Number(match[1]), "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  }
}

/** bdp → this proxy → bd serve, keeping the Host so the Scope the client selected holds. */
function recordingProxy(targetPort) {
  const posts = [];
  const server = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.concat(chunks);
      if (incoming.method === "POST" && incoming.url.startsWith("/bdp/call/"))
        posts.push({
          name: incoming.url.slice("/bdp/call/".length),
          headers: incoming.headers,
          body: JSON.parse(body.toString("utf8")),
        });
      const forward = httpRequest(
        {
          host: "127.0.0.1",
          port: targetPort,
          method: incoming.method,
          path: incoming.url,
          headers: incoming.headers,
        },
        (answer) => {
          outgoing.writeHead(answer.statusCode, answer.headers);
          answer.pipe(outgoing);
        },
      );
      forward.on("error", () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      forward.end(body);
    });
  });
  return { server, posts };
}

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const REVISION = /-?\b\d{15,}\b/g;
const HASH = /\b[0-9a-v]{32}\b/g;
const MINTED = /\bsw-(?!fix-)[a-z0-9]+(?:-[a-z0-9]+)*(?:\.\d+)*\b/g;
const CHANNEL = /(?<=[-.])(?:call|tree|curl|human)\b/g;
const DROPPED_KEYS = new Set(["request_id"]);
const VARYING_KEYS = new Set(["duration_ms", "elapsed_ms", "uptime_seconds", "pid"]);

/** What two answers may differ in, and nothing else. */
function masked(value) {
  const minted = new Map();
  const text = (input) =>
    input
      .replace(TIMESTAMP, "<ts>")
      .replace(UUID, "<uuid>")
      .replace(REVISION, "<rev>")
      .replace(HASH, "<hash>")
      .replace(CHANNEL, "<channel>")
      .replace(MINTED, (token) => {
        if (!minted.has(token)) minted.set(token, `<id${minted.size + 1}>`);
        return minted.get(token);
      });
  const walk = (node) => {
    if (typeof node === "string") return text(node);
    if (typeof node === "number" && Math.abs(node) >= 1e15) return "<rev>";
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node).flatMap(([key, member]) =>
        DROPPED_KEYS.has(key) ? [] : [[key, VARYING_KEYS.has(key) ? "<varies>" : walk(member)]],
      ),
    );
  };
  return walk(value);
}

/** The first differences, as JSON Pointers with both values. */
function differences(left, right, path = "", found = []) {
  if (found.length >= 6) return found;
  if (JSON.stringify(left) === JSON.stringify(right)) return found;
  const bothObjects =
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    Array.isArray(left) === Array.isArray(right);
  if (!bothObjects) {
    found.push({
      at: path || "/",
      left: JSON.stringify(left)?.slice(0, 200),
      right: JSON.stringify(right)?.slice(0, 200),
    });
    return found;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
    differences(left[key], right[key], `${path}/${key}`, found);
  return found;
}

const issue = (id, title = id, fields = {}) => ({
  id,
  title,
  issue_type: "task",
  priority: 2,
  ...fields,
});
/** What the client's --actor lowers to, and what curl sends in its place. */
const provenance = (actor) =>
  actor === undefined
    ? {}
    : { revisionProvenance: { actor: { id: actor, basis: "writer-supplied" } } };
/** A seeding step is [Callable, arguments, actor]; the actor is never an argument. */
const claimBy = (id, actor = "bob") => ["issue/claim", { id }, actor];
const closed = (id) => ["issue/close", { id, reason: "done" }, A];
const R = (suffix) => `sw-fix-r${suffix}`;

/** The state every read sees. Writes never touch it: they make their own issues. */
const READ_SEED = [
  issue(R(1), "alpha one", {
    priority: 1,
    assignee: "alice",
    labels: ["red"],
    metadata: { k: "v" },
    description: "needle in description",
  }),
  issue(R(2), "alpha two", {
    labels: ["blue"],
    dependencies: [{ target_id: R(1), type: "blocks" }],
  }),
  issue(R(3), "beta closed", { priority: 3 }),
  issue(R(4), "the epic", { issue_type: "epic", labels: ["red", "blue"] }),
  issue(R(5), "child of epic", { parent_id: R(4) }),
  issue(R(6), "claimed by bob", { issue_type: "bug", priority: 0 }),
  issue(R(7), "commented"),
  issue(R("a"), "related out", { dependencies: [{ target_id: R(7), type: "related" }] }),
];
const READ_BEFORE = [
  closed(R(3)),
  claimBy(R(6)),
  ["issue/comment", { id: R(7), text: "first" }, "alice"],
  ["config/set", { key: "fix.read", value: "v1" }],
  ["memory/remember", { content: "remembered thing", key: "fix-read" }],
];

const flag = (name, value) => [name, typeof value === "string" ? value : JSON.stringify(value)];

/** Reads: one state, compared literally. `wire` is the `arguments` a caller sends, `cli` how the
 * client is told it, by its positions and aliases. Neither states a default: the service has it. */
const READS = [
  { name: "issue/context", wire: {}, cli: [] },
  { name: "issue/ready", wire: { limit: 5 }, cli: ["-n", "5"] },
  { name: "issue/ready-count", wire: { unassigned: true }, cli: ["--unassigned"] },
  { name: "issue/stats", wire: {}, cli: [] },
  { name: "issue/blocked", wire: {}, cli: [] },
  { name: "issue/dep/cycles", wire: {}, cli: [] },
  { name: "issue/dep/tree", wire: { root_id: R(2), max_depth: 1 }, cli: [R(2), "-d", "1"] },
  {
    name: "issue/list",
    wire: { status: ["open"] },
    cli: ["--status", "open"],
  },
  { name: "issue/query", wire: { q: "status=open", limit: 2 }, cli: ["status=open", "-n", "2"] },
  { name: "issue/count", wire: { status: "open" }, cli: ["-s", "open"] },
  { name: "issue/show", wire: { id: R(1) }, cli: [R(1)] },
  { name: "issue/dep/list", wire: { id: R(2) }, cli: [R(2)] },
  { name: "issue/get-many", wire: { ids: [R(1), R(2)] }, cli: ["--ids", R(1), "--ids", R(2)] },
  { name: "issue/dep/edges", wire: { issue_id: [R(2)] }, cli: ["--issue-id", R(2)] },
  {
    name: "issue/dep/count",
    wire: { issue_id: [R(2)], direction: "out" },
    cli: ["--issue-id", R(2), "--direction", "out"],
  },
  { name: "issue/blocking-annotations", wire: { issue_id: [R(2)] }, cli: ["--issue-id", R(2)] },
  { name: "config/list", wire: {}, cli: [] },
  { name: "config/get", wire: { key: "fix.read" }, cli: ["fix.read"] },
  { name: "memory/list", wire: { search: "remembered" }, cli: ["remembered"] },
  { name: "memory/recall", wire: { key: "fix-read" }, cli: ["fix-read"] },
  { name: "events/list", wire: { since: 0, limit: 2 }, cli: ["--since", "0", "--limit", "2"] },
];

const F = (stem, channel) => `sw-fix-${stem}-${channel}`;
/** Batches: each channel gets its own fixture, named for it, so all three do the same work.
 * `wire` is `arguments` exactly, `actor` its attribution, and `cli` the tree's form of both. */
const BATCHES = [
  {
    name: "issue/create",
    make: (c) => ({
      actor: A,
      wire: { id: F("cr", c), title: "Fix login", priority: 1 },
      cli: ["Fix login", "--actor", A, "--id", F("cr", c), "-p", "1"],
    }),
  },
  {
    name: "issue/update",
    make: (c) => ({
      seed: [issue(F("up", c))],
      actor: A,
      wire: { id: F("up", c), patch: { title: "new" } },
      cli: [F("up", c), "--actor", A, ...flag("--patch", { title: "new" })],
    }),
  },
  {
    name: "issue/comment",
    make: (c) => ({
      seed: [issue(F("co", c))],
      actor: "alice",
      wire: { id: F("co", c), text: "hi" },
      cli: [F("co", c), "hi", "--actor", "alice"],
    }),
  },
  {
    name: "issue/claim",
    make: (c) => ({
      seed: [issue(F("cl", c))],
      actor: A,
      wire: { id: F("cl", c) },
      cli: [F("cl", c), "--actor", A],
    }),
  },
  {
    name: "issue/unclaim",
    make: (c) => ({
      seed: [issue(F("un", c))],
      before: [claimBy(F("un", c))],
      actor: "bob",
      wire: { id: F("un", c), expected_assignee: "bob" },
      cli: [F("un", c), "--actor", "bob", "--if-assignee", "bob"],
    }),
  },
  {
    name: "issue/heartbeat",
    make: (c) => ({
      seed: [issue(F("he", c))],
      before: [claimBy(F("he", c))],
      actor: "bob",
      wire: { id: F("he", c) },
      cli: [F("he", c), "--actor", "bob"],
    }),
  },
  {
    name: "issue/close",
    make: (c) => ({
      seed: [issue(F("xx", c))],
      actor: A,
      wire: { id: F("xx", c) },
      cli: [F("xx", c), "--actor", A],
    }),
  },
  {
    name: "issue/advance",
    make: (c) => ({
      seed: [
        issue(F("m0", c), "mol", { issue_type: "molecule" }),
        issue(F("m1", c), "one", { parent_id: F("m0", c) }),
        issue(F("m2", c), "two", { parent_id: F("m0", c) }),
      ],
      actor: A,
      wire: { id: F("m1", c) },
      cli: [F("m1", c), "--actor", A],
    }),
  },
  {
    name: "issue/reopen",
    make: (c) => ({
      seed: [issue(F("ro", c))],
      before: [closed(F("ro", c))],
      actor: A,
      wire: { id: F("ro", c), reason: "again" },
      cli: [F("ro", c), "--actor", A, "-r", "again"],
    }),
  },
  {
    name: "issue/metadata/compare-and-set",
    make: (c) => ({
      seed: [issue(F("ms", c), "cas", { metadata: { k: "old" } })],
      actor: A,
      wire: { id: F("ms", c), key: "k", expected: "old", value: "new" },
      cli: [
        F("ms", c),
        "--actor",
        A,
        "--key",
        "k",
        ...flag("--expected", '"old"'),
        ...flag("--value", '"new"'),
      ],
    }),
  },
  {
    label: "preview: no dry_run on any channel",
    name: "issue/purge",
    make: (c) => ({
      seed: [issue(F("pu", c), "purge", { ephemeral: true })],
      before: [closed(F("pu", c))],
      survives: F("pu", c),
      wire: { pattern: F("pu", c) },
      cli: ["--pattern", F("pu", c)],
    }),
  },
  {
    label: "preview: no dry_run on any channel",
    name: "issue/prune",
    make: (c) => ({
      seed: [issue(F("pr", c))],
      before: [closed(F("pr", c))],
      survives: F("pr", c),
      wire: { pattern: F("pr", c) },
      cli: ["--pattern", F("pr", c)],
    }),
  },
  {
    label: "preview: no dry_run on any channel",
    name: "issue/delete",
    make: (c) => ({
      seed: [issue(F("de", c))],
      survives: F("de", c),
      wire: { ids: [F("de", c)] },
      cli: ["--ids", F("de", c)],
    }),
  },
  {
    name: "issue/reclaim",
    make: (c) => ({
      seed: [issue(F("rc", c))],
      before: [claimBy(F("rc", c))],
      actor: A,
      wire: { ids: [F("rc", c)] },
      cli: ["--actor", A, "--ids", F("rc", c)],
    }),
  },
  {
    name: "issue/create-many",
    make: () => {
      const items = [
        { title: "many one", issue_type: "task", priority: 2, labels: ["m"] },
        { title: "many two", issue_type: "task" },
      ];
      return {
        actor: A,
        wire: { items },
        cli: ["--actor", A, ...items.flatMap((item) => flag("--items", item))],
      };
    },
  },
  {
    name: "issue/batch",
    make: (c) => {
      const items = [
        { kind: "create", create: { title: "b", issue_type: "task", id: F("ba", c) } },
      ];
      return {
        actor: A,
        wire: { items },
        cli: ["--actor", A, ...items.flatMap((item) => flag("--items", item))],
      };
    },
  },
  {
    name: "issue/close-many",
    make: (c) => {
      const items = [{ id: F("cm", c), reason: "r" }];
      return {
        seed: [issue(F("cm", c))],
        actor: A,
        wire: { items },
        cli: ["--actor", A, ...items.flatMap((item) => flag("--items", item))],
      };
    },
  },
  {
    name: "issue/claim-next",
    make: (c) => ({
      seed: [issue(F("cn", c), "next", { labels: [`next-${c}`] })],
      actor: A,
      wire: { label: [`next-${c}`] },
      cli: ["--actor", A, "-l", `next-${c}`],
    }),
  },
  {
    name: "issue/dep/add",
    make: (c) => ({
      seed: [issue(F("da", c)), issue(F("db", c))],
      actor: A,
      wire: { source: F("da", c), target: F("db", c), type: "related" },
      cli: [F("da", c), F("db", c), "--actor", A, "-t", "related"],
    }),
  },
  {
    name: "issue/dep/remove",
    make: (c) => ({
      seed: [
        issue(F("dd", c)),
        issue(F("dc", c), "dep", { dependencies: [{ target_id: F("dd", c), type: "blocks" }] }),
      ],
      actor: A,
      wire: { issue_id: F("dc", c), depends_on_id: F("dd", c) },
      cli: [F("dc", c), F("dd", c), "--actor", A],
    }),
  },
  {
    name: "config/set",
    make: (c) => ({
      wire: { key: `fix.w.${c}`, value: "v" },
      cli: [`fix.w.${c}`, "v"],
    }),
  },
  {
    name: "config/unset",
    make: (c) => ({
      before: [["config/set", { key: `fix.u.${c}`, value: "v" }]],
      wire: { key: `fix.u.${c}` },
      cli: [`fix.u.${c}`],
    }),
  },
  {
    name: "memory/remember",
    make: (c) => ({
      wire: { content: "keyed", key: `fix-w-${c}` },
      cli: ["keyed", "--key", `fix-w-${c}`],
    }),
  },
  {
    name: "memory/forget",
    make: (c) => ({
      before: [["memory/remember", { content: "gone", key: `fix-f-${c}` }]],
      wire: { key: `fix-f-${c}` },
      cli: [`fix-f-${c}`],
    }),
  },
];

/** Beyond the one case per Callable: a real run past a service default, and each refusal kind. */
const EXTRAS = [
  {
    label: "issue/delete --no-dry-run really deletes",
    name: "issue/delete",
    make: (c) => ({
      seed: [issue(F("dr", c))],
      gone: F("dr", c),
      actor: A,
      wire: { ids: [F("dr", c)], dry_run: false },
      cli: ["--ids", F("dr", c), "--no-dry-run", "--actor", A],
    }),
  },
  {
    label: "validation-failed: required id missing",
    name: "issue/show",
    make: () => ({ wire: {}, cli: [] }),
    exit: 1,
  },
  {
    label: "validation-failed: an unknown member",
    name: "issue/show",
    make: () => ({
      wire: { id: R(1), nope: 1 },
      cli: ["--arguments", JSON.stringify({ id: R(1), nope: 1 })],
    }),
    exit: 1,
  },
  {
    label: "resource-not-found",
    name: "issue/show",
    make: () => ({ wire: { id: "sw-fix-none" }, cli: ["sw-fix-none"] }),
    exit: 3,
  },
  {
    label: "callable-error: already_claimed",
    name: "issue/claim",
    make: (c) => ({
      seed: [issue(F("ac", c))],
      before: [claimBy(F("ac", c))],
      actor: "carol",
      wire: { id: F("ac", c) },
      cli: [F("ac", c), "--actor", "carol"],
    }),
    exit: 1,
  },
  {
    label: "revision-mismatch: a stale expected_version",
    name: "issue/update",
    make: (c) => ({
      seed: [issue(F("sv", c))],
      actor: A,
      wire: { id: F("sv", c), patch: { title: "n" }, expected_version: "1" },
      cli: [F("sv", c), "--actor", A, "--patch", '{"title":"n"}', "--expected-version", "1"],
    }),
    exit: 4,
  },
  {
    label: "identity-taken: an id already held",
    name: "issue/create",
    make: (c) => ({
      seed: [issue(F("it", c))],
      actor: A,
      wire: { id: F("it", c), title: "again", issue_type: "task" },
      cli: ["again", "--actor", A, "--id", F("it", c), "-t", "task"],
    }),
    exit: 1,
  },
  {
    label: "invalid-parameter: a bad cursor",
    name: "issue/list",
    make: () => ({
      wire: { cursor: "not-a-cursor" },
      cli: ["--cursor", "not-a-cursor"],
    }),
    exit: 1,
  },
];

function bdpRunner(stack) {
  const clientEnv = { ...stack.env, XDG_CONFIG_HOME: stack.home, XDG_STATE_HOME: stack.home };
  delete clientEnv.BD_ACTOR;
  for (const name of Object.keys(clientEnv)) if (name.startsWith("BDP_")) delete clientEnv[name];
  clientEnv.BDP_SPEC_REVISION = "0123456789abcdef0123456789abcdef01234567";
  return (args, more = {}) =>
    new Promise((done, fail) => {
      const child = spawn(process.execPath, [binary, ...args], {
        env: { ...clientEnv, ...more.env },
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
      child.on("error", fail);
      child.on("close", (status) => {
        clearTimeout(timer);
        done({ status, stdout, stderr });
      });
      child.stdin.end(more.stdin);
    });
}

async function curlCall(scope, name, argumentsObject, extra = {}, token) {
  const body = JSON.stringify({ arguments: argumentsObject, ...extra });
  return curl(`${scope}bdp/call/${name}`, {
    method: "POST",
    body,
    headers: [`Content-Type: ${MEDIA}`, `Accept: ${MEDIA}, application/problem+json`],
    token,
  });
}

/** A real curl, so the comparison owes nothing to this process's HTTP stack. */
async function curl(url, { method = "GET", body, headers = [`Accept: ${MEDIA}`], token } = {}) {
  const args = ["-sS", "-X", method, "--max-time", "90", "-D", "-"];
  for (const header of headers) args.push("-H", header);
  if (token !== undefined) args.push("-H", `Authorization: Bearer ${token}`);
  if (body !== undefined) args.push("--data-binary", body);
  args.push(url);
  const { stdout } = await run("curl", args, { maxBuffer: 1 << 28 });
  const split = stdout.indexOf("\r\n\r\n");
  const head = stdout.slice(0, split).split("\r\n");
  const text = stdout.slice(split + 4);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: Number(head[0]?.split(" ")[1]),
    contentType: head
      .find((line) => /^content-type:/i.test(line))
      ?.split(":")[1]
      ?.trim(),
    link: head
      .find((line) => /^link:/i.test(line))
      ?.slice(5)
      .trim(),
    text,
    json,
  };
}

const seedCall = async (scope, name, wire, actor) => {
  const answer = await curlCall(scope, name, wire, provenance(actor));
  if (answer.status !== 200)
    throw new Error(`seed ${name} ${JSON.stringify(wire)}: ${answer.status} ${answer.text}`);
  return answer;
};
/** An issue is always created by the harness's own actor. */
const seedIssue = (scope, fields) => seedCall(scope, "issue/create", fields, A);

/** The JSON-mode result of one bdp run, in the shape curl gives. */
function clientAnswer(result) {
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    return { parsed: false, exit: result.status, stdout: result.stdout, stderr: result.stderr };
  }
  if (envelope.outcome === "success")
    return {
      parsed: true,
      exit: result.status,
      success: true,
      value: envelope.data,
      httpStatus: envelope.context?.httpStatus,
    };
  return {
    parsed: true,
    exit: result.status,
    success: false,
    outcome: envelope.outcome,
    origin: envelope.error?.origin,
    value: envelope.error?.problem,
  };
}

/** Exactly the stated arguments and attribution, compared unmasked: each channel has its own
 * fixture, and nothing may be added, such as a default or an actor. */
function wireProblems(channel, part, post) {
  if (post === undefined) return [{ channel, what: "no POST reached the mount" }];
  const problems = [];
  const wire = differences(part.wire, post.body.arguments);
  if (wire.length > 0) problems.push({ channel, what: "sent different arguments", wire });
  const said = differences(
    provenance(part.actor).revisionProvenance ?? null,
    post.body.revisionProvenance ?? null,
  );
  if (said.length > 0) problems.push({ channel, what: "sent different attribution", said });
  return problems;
}

function judge(curlAnswer, answers, part, expectedExit) {
  const problems = [];
  const reference = masked(curlAnswer.json);
  for (const [channel, answer, post] of answers) {
    if (!answer.parsed) {
      problems.push({ channel, what: "output is not the JSON envelope", detail: answer });
      continue;
    }
    problems.push(...wireProblems(channel, part(channel), post));
    if (curlAnswer.status === 200) {
      if (!answer.success) {
        problems.push({ channel, what: "curl got 200 and the client failed", detail: answer });
        continue;
      }
      const body = differences(reference, masked(answer.value));
      if (body.length > 0) problems.push({ channel, what: "body differs from curl", body });
      if (answer.exit !== 0) problems.push({ channel, what: `exit ${answer.exit} on success` });
    } else {
      if (answer.success) {
        problems.push({ channel, what: `curl got ${curlAnswer.status}, client succeeded` });
        continue;
      }
      if (answer.origin !== "bdp")
        problems.push({ channel, what: "Problem not shown as origin:bdp", detail: answer });
      const body = differences(reference, masked(answer.value));
      if (body.length > 0) problems.push({ channel, what: "Problem differs from curl", body });
      if (expectedExit !== undefined && answer.exit !== expectedExit)
        problems.push({ channel, what: `exit ${answer.exit}, expected ${expectedExit}` });
    }
  }
  return problems;
}

async function runCase(context, kase, label, seedChannels) {
  const { scope, bdp, posts, proxyScope } = context;
  const parts = {};
  for (const channel of seedChannels) {
    const made = kase.make ? kase.make(channel) : kase;
    parts[channel] = made;
    for (const seed of made.seed ?? []) await seedIssue(scope, seed);
    for (const [name, wire, actor] of made.before ?? []) await seedCall(scope, name, wire, actor);
  }
  const part = (channel) => parts[channel] ?? parts[seedChannels[0]];
  const words = kase.name.split("/");
  const json = ["--scope", proxyScope, "--output-mode", "json"];
  const attempt = async (channel, args) => {
    const seen = posts.length;
    const result = await bdp([...json, ...args]);
    return [channel, clientAnswer(result), posts[seen]];
  };
  const attribution = (channel) =>
    part(channel).actor === undefined ? [] : ["--actor", part(channel).actor];
  const viaCall = await attempt("call", [
    "call",
    kase.name,
    "--arguments",
    JSON.stringify(part("call").wire),
    ...attribution("call"),
  ]);
  const viaTree = await attempt("tree", [...words, ...part("tree").cli]);
  const viaCurl = await curlCall(
    scope,
    kase.name,
    part("curl").wire,
    provenance(part("curl").actor),
  );
  const problems = judge(viaCurl, [viaCall, viaTree], part, kase.exit);
  // A preview says it is one, and has found its issue: a preview of nothing would prove nothing.
  let preview;
  if (part("curl").survives !== undefined) {
    const { result } = viaCurl.json ?? {};
    preview = {
      dry_run: result?.dry_run,
      counted: result?.swept ?? result?.deleted,
      changed: viaCurl.json?.changed,
    };
    if (preview.dry_run !== true)
      problems.push({ channel: "curl", what: "no dry_run in a preview's result", preview });
    if (!(preview.counted >= 1))
      problems.push({ channel: "curl", what: "the preview found nothing", preview });
    if (preview.changed !== false)
      problems.push({ channel: "curl", what: "a preview reports a change", preview });
  }
  // A preview changes nothing and a real run does, on every channel alike.
  for (const channel of seedChannels) {
    const { survives, gone } = part(channel);
    for (const [id, expected, what] of [
      [survives, 200, "a preview removed its issue"],
      [gone, 404, "a real run left its issue"],
    ])
      if (id !== undefined) {
        const held = await curlCall(scope, "issue/show", { id });
        if (held.status !== expected) problems.push({ channel, what, status: held.status, id });
      }
  }
  return {
    callable: kase.name,
    label,
    verdict: problems.length === 0 ? "ok" : "differs",
    curl_status: viaCurl.status,
    curl_code: viaCurl.json?.code,
    curl_error_code: viaCurl.json?.error?.code,
    call_exit: viaCall[1].exit,
    tree_exit: viaTree[1].exit,
    changed: viaCurl.json?.changed,
    ...(preview === undefined ? {} : { preview }),
    problems,
  };
}

async function human(context, args, more) {
  const result = await context.bdp(["--scope", context.scope, ...args], more);
  return {
    args,
    exit: result.status,
    stdout: result.stdout.slice(0, 1500),
    stderr: result.stderr.slice(0, 1500),
  };
}

async function fileAnnotations(context, stack) {
  const { scope, bdp } = context;
  const path = join(stack.root, "body.md");
  await writeFile(path, "# from a file\n");
  await seedIssue(scope, issue("sw-fix-ff"));
  const scoped = ["--scope", scope, "--output-mode", "json"];
  const show = async (id) =>
    (await curlCall(scope, "issue/show", { id, include_comments: true })).json?.result;
  const fromFile = await bdp([
    ...scoped,
    "issue",
    "create",
    "from file",
    "--actor",
    A,
    "--id",
    "sw-fix-fb",
    "-t",
    "task",
    "--body-file",
    path,
  ]);
  const fromStdin = await bdp(
    [...scoped, "issue", "comment", "sw-fix-ff", "-f", "-", "--actor", "alice"],
    { stdin: "piped comment" },
  );
  const reasonPath = join(stack.root, "reason.txt");
  await writeFile(reasonPath, "from a file");
  const reason = await bdp([
    ...scoped,
    "issue",
    "close",
    "sw-fix-ff",
    "--actor",
    A,
    "--reason-file",
    reasonPath,
  ]);
  const newlineFile = await bdp([
    ...scoped,
    "issue",
    "close",
    R(7),
    "--actor",
    A,
    "--reason-file",
    path,
  ]);
  const created = await show("sw-fix-fb");
  const held = await show("sw-fix-ff");
  const description = created?.description;
  const comment = JSON.stringify(held?.comments ?? []);
  return {
    body_file: { exit: fromFile.status, ok: description === "# from a file\n", description },
    comment_stdin: { exit: fromStdin.status, ok: comment.includes("piped comment") },
    reason_file: {
      exit: reason.status,
      ok: held?.close_reason === "from a file",
      close_reason: held?.close_reason,
    },
    reason_file_ending_in_newline: {
      exit: newlineFile.status,
      refusal: JSON.parse(newlineFile.stdout).error?.problem?.detail,
    },
  };
}

/** Every row goes through the recording proxy, and states what must and must not reach the wire.
 * `refused` means exit 2 and no POST; `wire` and `actor` are what the POST must say. */
async function actorBehavior(context) {
  const { proxyScope, scope, posts, bdp } = context;
  const row = async (
    args,
    { wire, actor, supplied, refused = false, exit, message, more } = {},
  ) => {
    const seen = posts.length;
    const result = await bdp(["--scope", proxyScope, ...args], more);
    const post = posts[seen];
    const problems = [];
    if (refused) {
      if (result.status !== 2) problems.push(`exit ${result.status}, expected 2`);
      if (posts.length !== seen) problems.push("a refusal sent a POST");
    } else {
      if (post === undefined) problems.push("no POST");
      else {
        if (wire !== undefined && differences(wire, post.body.arguments).length > 0)
          problems.push({ sent_arguments: post.body.arguments, expected: wire });
        const said = differences(
          supplied ?? provenance(actor).revisionProvenance ?? null,
          post.body.revisionProvenance ?? null,
        );
        if (said.length > 0) problems.push({ sent_attribution: post.body.revisionProvenance });
      }
      if (exit !== undefined && result.status !== exit)
        problems.push(`exit ${result.status}, expected ${exit}`);
    }
    if (message !== undefined && !`${result.stdout}${result.stderr}`.includes(message))
      problems.push(`no "${message}" in the output`);
    return {
      args,
      verdict: problems.length === 0 ? "ok" : "differs",
      problems,
      exit: result.status,
      arguments: post?.body.arguments,
      revisionProvenance: post?.body.revisionProvenance,
      stdout: result.stdout.slice(0, 800),
      stderr: result.stderr.slice(0, 800),
    };
  };
  const title = "Fix login";
  const made = { title };
  const form = ["issue", "create", title];
  // Each create must also come back signed: the attribution reached what v0 records.
  const sam = { wire: made, actor: "sam", exit: 0, message: "created_by: sam" };
  const twoActors = "--actor was given with two different values";
  const samActor = { actor: { id: "sam", basis: "writer-supplied" } };
  const samProvenance = JSON.stringify(samActor);
  const withMessage = { ...samActor, message: "why" };
  const commentAuthor = async (id) => {
    const held = await curlCall(scope, "issue/show", { id, include_comments: true });
    return held.json?.result?.comments?.at(-1)?.author;
  };
  await seedIssue(scope, issue("sw-fix-signed"));
  const rows = {
    // The service defaults the type, so no -t is needed.
    create_no_type_actor_after: await row([...form, "--actor", "sam"], sam),
    create_no_type_actor_before: await row(["--actor", "sam", ...form], sam),
    create_no_type_actor_between_words: await row(
      ["issue", "--actor", "sam", "create", title],
      sam,
    ),
    create_no_type_actor_inline: await row([...form, "--actor=sam"], sam),
    create_actor_before_and_after_agreeing: await row(
      ["--actor", "sam", ...form, "--actor", "sam"],
      sam,
    ),
    create_two_actors_refused: await row(["--actor", "sam", ...form, "--actor", "kim"], {
      refused: true,
      message: twoActors,
    }),
    create_without_actor: await row(form, { wire: made }),
    create_actor_with_no_value_refused: await row([...form, "--actor"], {
      refused: true,
      message: "--actor requires a value",
    }),
    call_actor_after: await row(
      ["call", "issue/create", "--arguments", JSON.stringify(made), "--actor", "sam"],
      sam,
    ),
    call_actor_before: await row(
      ["--actor", "sam", "call", "issue/create", "--arguments", JSON.stringify(made)],
      sam,
    ),
    call_two_actors_refused: await row(
      ["--actor", "sam", "call", "issue/create", "--arguments", "{}", "--actor", "kim"],
      { refused: true, message: twoActors },
    ),
    call_exact_object: await row(
      ["call", "issue/close", "--arguments", JSON.stringify({ id: R(7) }), "--actor", A],
      { wire: { id: R(7) }, actor: A, exit: 0 },
    ),
    call_empty_object: await row(["call", "issue/stats"], { wire: {}, exit: 0 }),
    call_with_flags_refused: await row(["call", "issue/create", "--title", title], {
      refused: true,
      message: "--arguments",
    }),
    provenance_before_tree: await row(["--revision-provenance", samProvenance, ...form], {
      exit: 0,
      wire: made,
      supplied: samActor,
      message: "created_by: sam",
    }),
    provenance_agreeing_with_actor: await row(
      ["--revision-provenance", samProvenance, ...form, "--actor", "sam"],
      { exit: 0, wire: made, supplied: samActor, message: "created_by: sam" },
    ),
    // The client carries `message` whole. This server records none, and refuses it, not drops it.
    provenance_message_refused_not_dropped: await row(
      ["--revision-provenance", JSON.stringify(withMessage), ...form],
      { exit: 1, wire: made, supplied: withMessage, message: "`message` cannot be recorded" },
    ),
    provenance_conflicts_with_actor_refused: await row(
      ["--revision-provenance", samProvenance, ...form, "--actor", "kim"],
      { refused: true, message: "--actor conflicts with explicit provenance actor" },
    ),
    provenance_after_tree_refused: await row([...form, "--revision-provenance", samProvenance], {
      refused: true,
      message: "before the command",
    }),
    query_refuses_actor_after: await row(["issue", "stats", "--actor", "sam"], { refused: true }),
    query_refuses_actor_before: await row(["--actor", "sam", "issue", "stats"], { refused: true }),
    query_refuses_actor_on_call: await row(["call", "issue/stats", "--actor", "sam"], {
      refused: true,
    }),
    comment_signed_by_actor: await row(
      ["issue", "comment", "sw-fix-signed", "signed", "--actor", "sam"],
      { wire: { id: "sw-fix-signed", text: "signed" }, actor: "sam", exit: 0 },
    ),
    comment_author_flag_refused: await row(
      ["issue", "comment", "sw-fix-signed", "x", "--author", "sam"],
      { refused: true },
    ),
    comment_with_no_actor: await row(["issue", "comment", "sw-fix-signed", "nobody"], {
      wire: { id: "sw-fix-signed", text: "nobody" },
      exit: 1,
    }),
    config_set_refuses_an_actor: await row(["config", "set", "fix.actor", "v", "--actor", "sam"], {
      wire: { key: "fix.actor", value: "v" },
      actor: "sam",
      exit: 1,
    }),
  };
  rows.comment_signed_by_actor.author = await commentAuthor("sw-fix-signed");
  if (rows.comment_signed_by_actor.author !== "sam") {
    rows.comment_signed_by_actor.verdict = "differs";
    rows.comment_signed_by_actor.problems.push("the comment is not signed by sam");
  }
  // bdp call sends what it is given, so this one goes to the service directly and is refused
  // there: it is the one POST in this run allowed an actor in its arguments.
  const member = await bdp([
    "--scope",
    scope,
    "call",
    "issue/create",
    "--arguments",
    JSON.stringify({ title, actor: "sam" }),
  ]);
  rows.call_actor_member_reaches_the_service = {
    verdict: member.status === 1 ? "ok" : "differs",
    exit: member.status,
    stderr: member.stderr.slice(0, 800),
  };
  return rows;
}

async function coreReads(context) {
  const { scope, bdp } = context;
  const family = "https://github.com/gastownhall/bdp/types/issue/issue";
  const task = "https://github.com/gastownhall/bdp/types/issue/task";
  const seen = await curl(`${scope}bdp/beads?limit=1`);
  const beadType = seen.json?.items?.[0]?.type;
  const linksPage = await curl(`${scope}bdp/links?limit=2`);
  const link = linksPage.json?.items?.[0];
  const linkFamily = "https://github.com/gastownhall/bdp/types/dependency/dependency";
  const compare = async (label, args, url, expectation = {}) => {
    const json = await bdp(["--scope", scope, "--output-mode", "json", ...args]);
    const text = await bdp(["--scope", scope, ...args]);
    let envelope;
    try {
      envelope = JSON.parse(json.stdout);
    } catch {
      envelope = undefined;
    }
    const direct = url === undefined ? undefined : await curl(url);
    const row = {
      label,
      args,
      exit: json.status,
      human_exit: text.status,
      outcome: envelope?.outcome,
      error: envelope?.error ?? (json.stderr.slice(0, 600) || undefined),
      human_stdout: text.stdout.slice(0, 500),
      human_stderr: text.stderr.slice(0, 500),
      items: Array.isArray(envelope?.data?.items) ? envelope.data.items.length : undefined,
      curl_status: direct?.status,
      curl_items: Array.isArray(direct?.json?.items) ? direct.json.items.length : undefined,
      curl_code: direct?.json?.code,
    };
    const problems = [];
    if (direct !== undefined) {
      if (direct.status === 200 && json.status !== 0)
        problems.push("curl got 200 and the client failed");
      if (direct.status !== 200 && json.status === 0)
        problems.push(`curl got ${direct.status} and the client succeeded`);
      if (direct.status === 200 && envelope?.data !== undefined && expectation.body !== false) {
        const compareTo = envelope.data;
        const delta = differences(
          masked(expectation.items ? direct.json.items : direct.json),
          masked(expectation.items ? compareTo.items : compareTo),
        );
        if (delta.length > 0) problems.push({ body: delta });
      }
    }
    if (expectation.exit !== undefined && json.status !== expectation.exit)
      problems.push(`exit ${json.status}, expected ${expectation.exit}`);
    if (expectation.contains !== undefined && !json.stdout.includes(expectation.contains))
      problems.push(`no ${expectation.contains} in the output`);
    row.problems = problems;
    row.verdict = problems.length === 0 ? "ok" : "differs";
    return row;
  };
  const encode = encodeURIComponent;
  const bead = `${scope}${R(2)}`;
  return [
    await compare("scope inspect", ["scope", "inspect"], undefined, { exit: 0 }),
    await compare("list", ["list", "--limit", "5"], `${scope}bdp/beads?limit=5`, {
      exit: 0,
      items: true,
    }),
    await compare(
      "list --type family",
      ["list", "--type", family, "--limit", "5"],
      `${scope}bdp/beads?conformsTo=${encode(family)}&limit=5`,
      { exit: 0, items: true },
    ),
    await compare(
      "list --type concrete",
      ["list", "--type", task, "--limit", "5"],
      `${scope}bdp/beads?conformsTo=${encode(task)}&limit=5`,
      { exit: 0, items: true },
    ),
    await compare(
      "list --type unsupported",
      ["list", "--type", "https://example.test/types/none", "--limit", "5"],
      `${scope}bdp/beads?conformsTo=${encode("https://example.test/types/none")}&limit=5`,
      { exit: 1 },
    ),
    await compare("list --type any", ["list", "--type", "any", "--limit", "5"], undefined, {
      exit: 0,
    }),
    await compare(
      "list --exact-type",
      ["list", "--exact-type", beadType ?? task, "--limit", "5"],
      `${scope}bdp/beads?type=${encode(beadType ?? task)}&limit=5`,
      { exit: 0, items: true },
    ),
    await compare("show", ["show", R(2)], bead, { exit: 0 }),
    await compare("show --properties-only", ["show", R(2), "--properties-only"], undefined, {
      exit: 0,
    }),
    await compare(
      "show --include-links",
      ["show", R(2), "--include-links"],
      `${bead}?include=links`,
      { exit: 0, contains: '"links"' },
    ),
    await compare(
      "show --include-links --direction in --links-limit 1",
      ["show", R(1), "--include-links", "--direction", "in", "--links-limit", "1"],
      `${scope}${R(1)}?include=links&direction=inbound&limit=1`,
      { exit: 0, contains: '"links"' },
    ),
    await compare("link list", ["link", "list", "--limit", "5"], `${scope}bdp/links?limit=5`, {
      exit: 0,
      items: true,
    }),
    await compare(
      "link list --type family",
      ["link", "list", "--type", linkFamily, "--limit", "5"],
      `${scope}bdp/links?conformsTo=${encode(linkFamily)}&limit=5`,
      { exit: 0, items: true },
    ),
    ...(link === undefined
      ? []
      : [await compare("link show", ["link", "show", link.id], link.id, { exit: 0 })]),
    await compare("versions", ["versions", R(2)], undefined, { exit: 5 }),
    // The legacy read path cannot parse Core discovery: a refusal that says so, not a result.
    await compare("bd ready", ["bd", "ready", "--json"], undefined, { exit: 1 }),
  ];
}

/** Seven things the manual pass found, each as a person meets it: human output, the flags a
 * tree command declares, a delete preview, a refused flag, and a Core revision as a guard. */
async function manualFindings(context) {
  const { proxyScope: scope, bdp, posts } = context;
  const on = (args) => bdp(["--scope", scope, ...args]);
  const json = async (args) => {
    const result = await bdp(["--scope", scope, "--output-mode", "json", ...args]);
    try {
      return { ...result, envelope: JSON.parse(result.stdout) };
    } catch {
      return { ...result, envelope: undefined };
    }
  };
  const revision = async (id) => (await json(["show", id])).envelope?.data?.revision;
  const rows = {};
  const check = (name, result, ...failures) => {
    const problems = failures.filter((failure) => failure !== false);
    rows[name] = {
      verdict: problems.length === 0 ? "ok" : "differs",
      problems,
      exit: result.status,
      stdout: result.stdout.slice(0, 500),
      stderr: result.stderr.slice(0, 500),
    };
  };
  const lastPost = () => posts.at(-1)?.body;
  const need = (ok, what) => !ok && what;
  const seed = (id) => seedIssue(scope, issue(id));

  // 1. A Callable's Problem reads as text in human mode, at the same status.
  let result = await on(["issue", "create", "no actor"]);
  check(
    "human_problem_is_text",
    result,
    need(result.status === 1, "exit"),
    need(result.stdout === "", "stdout"),
    need(result.stderr.startsWith("error: validation-failed: "), "no error line"),
    need(result.stderr.includes("`revisionProvenance.actor` is required"), "no detail"),
    need(!result.stderr.includes('{"'), "raw JSON"),
  );
  result = await json(["issue", "create", "no actor"]);
  check(
    "json_problem_is_unchanged",
    result,
    need(result.status === 1, "exit"),
    need(result.stderr === "", "stderr"),
    need(result.envelope?.error?.problem?.code === "validation-failed", "no Problem on stdout"),
  );
  result = await on(["issue", "show", "sw-fix-no-such"]);
  check(
    "human_not_found_is_text",
    result,
    need(result.status === 3, "exit"),
    need(result.stderr.startsWith("error: resource-not-found: "), "no error line"),
  );

  // 2. `changed` once when the envelope and v0's result agree.
  await seed("sw-fix-m2");
  result = await on(["issue", "update", "sw-fix-m2", "--patch", '{"title":"t"}', "--actor", "sam"]);
  check(
    "changed_prints_once",
    result,
    need(result.status === 0, "exit"),
    need(
      result.stdout.split("\n").filter((line) => /^\s*changed/.test(line)).length === 1,
      "count",
    ),
  );
  result = await json([
    "issue",
    "update",
    "sw-fix-m2",
    "--patch",
    '{"title":"u"}',
    "--actor",
    "sam",
  ]);
  check(
    "changed_stays_in_both_places_in_json",
    result,
    need(result.envelope?.data?.changed === true, "envelope"),
    need(result.envelope?.data?.result?.changed === true, "result"),
  );

  // 3. A patch member is a flag; the wire is what --patch sends.
  await seed("sw-fix-m3");
  result = await on(["issue", "update", "sw-fix-m3", "--status", "in_progress", "--actor", "sam"]);
  check(
    "status_flag_sets_patch_status",
    result,
    need(result.status === 0, "exit"),
    need(result.stdout.includes("status: in_progress"), "not applied"),
    differences({ id: "sw-fix-m3", patch: { status: "in_progress" } }, lastPost()?.arguments)
      .length > 0 && { sent: lastPost()?.arguments },
  );
  result = await on([
    "issue",
    "update",
    "sw-fix-m3",
    "-s",
    "open",
    "-p",
    "1",
    "-l",
    "a",
    "-l",
    "b",
    "--actor",
    "sam",
  ]);
  check(
    "member_flags_take_their_forms",
    result,
    need(result.status === 0, "exit"),
    differences(
      { id: "sw-fix-m3", patch: { status: "open", priority: 1, add_labels: ["a", "b"] } },
      lastPost()?.arguments,
    ).length > 0 && { sent: lastPost()?.arguments },
  );
  result = await on([
    "issue",
    "update",
    "sw-fix-m3",
    "--patch",
    '{"title":"patch","notes":"kept"}',
    "--title",
    "flag",
    "--actor",
    "sam",
  ]);
  check(
    "a_member_flag_overrides_patch",
    result,
    need(result.status === 0, "exit"),
    differences({ id: "sw-fix-m3", patch: { title: "flag", notes: "kept" } }, lastPost()?.arguments)
      .length > 0 && { sent: lastPost()?.arguments },
  );
  const seen = posts.length;
  result = await on(["call", "issue/update", "--arguments", '{"id":"sw-fix-m3"}', "--status", "x"]);
  check(
    "call_takes_no_member_flag",
    result,
    need(result.status === 2, "exit"),
    need(posts.length === seen, "sent a POST"),
    need(result.stderr.includes("--arguments"), "does not name --arguments"),
  );
  result = await on(["issue", "update", "sw-fix-m3", "--actor", "sam"]);
  check(
    "no_member_sends_no_patch",
    result,
    need(result.status === 1, "exit"),
    need(lastPost()?.arguments?.patch === undefined, "the client filled in a patch"),
    need(result.stderr.includes("`patch` is required"), "not the service's refusal"),
  );
  await seed("sw-fix-m3b");
  result = await on([
    "issue",
    "create",
    "gated",
    "--spawner-id",
    "sw-fix-m3b",
    "--waits-for-gate",
    "any-children",
    "--actor",
    "sam",
  ]);
  check(
    "waits_for_members_are_flags",
    result,
    need(result.status === 0, "exit"),
    differences(
      { title: "gated", waits_for: { spawner_id: "sw-fix-m3b", gate: "any-children" } },
      lastPost()?.arguments,
    ).length > 0 && { sent: lastPost()?.arguments },
  );

  // 4. A tree command's help leads with usage; call's keeps the whole declaration.
  result = await bdp(["issue", "update", "--help"]);
  check(
    "tree_help_leads_with_usage",
    result,
    need(result.stdout.startsWith("Usage: bdp "), "not usage first"),
    need(result.stdout.includes("bdp call issue/update --help"), "no pointer"),
    need(!result.stdout.includes("#####"), "carried prose"),
    need(result.stdout.includes("--status, -s TEXT"), "no member flag"),
  );
  result = await bdp(["call", "issue/update", "--help"]);
  check(
    "call_help_keeps_the_declaration",
    result,
    need(result.stdout.includes("Partial update of one named issue"), "no description"),
    need(result.stdout.includes("Errors:"), "no errors"),
    need(!result.stdout.includes("--status"), "a member flag"),
  );

  // 5. A delete without --force says it is a preview.
  await seed("sw-fix-m5");
  result = await on(["delete", "sw-fix-m5"]);
  check(
    "delete_preview_says_so",
    result,
    need(result.status === 0, "exit"),
    need(result.stdout.startsWith("Preview only: nothing was deleted."), "no preview line"),
    need(result.stdout.includes("To delete it, run: bdp delete sw-fix-m5 --force"), "no how-to"),
  );
  result = await json(["delete", "sw-fix-m5"]);
  check(
    "delete_preview_in_json",
    result,
    need(result.envelope?.context?.preview === "delete", "no marker"),
    need(result.envelope?.result_kind === "resource", "not a read"),
  );
  check(
    "delete_preview_deleted_nothing",
    result,
    need((await curlCall(scope, "issue/show", { id: "sw-fix-m5" })).status === 200, "it is gone"),
  );

  const link = (await json(["link", "list", "--limit", "1"])).envelope?.data?.items?.[0]?.id;
  const local = String(link).slice(scope.length);
  result = await on(["link", "delete", local]);
  check(
    "link_delete_preview_says_so",
    result,
    need(result.status === 0, "exit"),
    need(result.stdout.startsWith("Preview only: nothing was deleted."), "no preview line"),
    need(result.stdout.includes(`bdp link delete ${local} --force`), "no how-to"),
  );

  // 6. A refused flag is named, and the generic writes refuse against bd serve.
  result = await on(["create", "--title", "x"]);
  check(
    "refused_flag_is_named",
    result,
    need(result.status === 2, "exit"),
    need(result.stderr.includes("unsupported argument --title"), "not named"),
  );
  result = await on(["create", "--title=hunter2"]);
  check("refused_value_is_not_echoed", result, need(!result.stderr.includes("hunter2"), "echoed"));
  const task = "https://github.com/gastownhall/bdp/types/issue/task";
  const writeServed = (await curl(`${scope}bdp`)).json?.profile === "write";
  for (const [name, args] of [
    ["generic_create_refused", ["create", "--type", task, "--properties", '{"title":"x"}']],
    ["generic_update_refused", ["update", "sw-fix-m5", "--set-property", "title=y"]],
    ["generic_delete_force_refused", ["delete", "sw-fix-m5", "--force"]],
  ]) {
    result = await on(args);
    // A Scope serving Write answers these itself; only a Core Scope refuses them in the client.
    if (writeServed) {
      check(name, result, need(result.status !== 5, "refused as if Write were absent"));
      continue;
    }
    check(
      name,
      result,
      need(result.status === 5, "exit"),
      need(result.stderr.includes("unsupported_capability"), "not unsupported_capability"),
    );
  }

  // 7. A Core revision never reads as a flag, and it is a guard on the Callable path only.
  await seed("sw-fix-m7");
  const held = await revision("sw-fix-m7");
  result = await on(["show", "sw-fix-m7"]);
  check(
    "core_token_leads_with_its_digest",
    result,
    need(/^[0-9a-f]{32}-/.test(held ?? ""), `token ${held}`),
    need(result.stdout.includes(`Revision: ${held}`), "not shown"),
  );
  const guarded = ["issue", "update", "sw-fix-m7", "--actor", "sam", "--expected-version"];
  result = await on([...guarded, held, "--title", "one"]);
  check("core_token_is_a_guard", result, need(result.status === 0, "exit"));
  result = await on([...guarded, held, "--title", "two"]);
  check(
    "stale_core_token_is_refused",
    result,
    need(result.status === 4, "exit"),
    need(result.stderr.startsWith("error: revision-mismatch: "), "not revision-mismatch"),
    need(
      (await curlCall(scope, "issue/show", { id: "sw-fix-m7" })).json?.result?.title === "one",
      "wrote",
    ),
  );
  const rowLock = (await curlCall(scope, "issue/show", { id: "sw-fix-m7" })).json?.result?.revision;
  result = await on([...guarded, rowLock, "--title", "three"]);
  check("bare_row_lock_is_a_guard", result, need(result.status === 0, "exit"));
  const beforeLabel = await revision("sw-fix-m7");
  await seedCall(scope, "issue/update", { id: "sw-fix-m7", patch: { add_labels: ["only"] } }, A);
  result = await on([...guarded, beforeLabel, "--title", "four"]);
  check(
    "a_label_only_write_stales_a_core_token",
    result,
    need(result.status === 4, "exit"),
    need(
      (await curlCall(scope, "issue/show", { id: "sw-fix-m7" })).json?.result?.title === "three",
      "wrote",
    ),
  );
  const current = await revision("sw-fix-m7");
  result = await on(["issue", "delete", "--ids", "sw-fix-m7", "--expected-version", current]);
  check(
    "core_token_guards_issue_delete",
    result,
    need(result.status === 0, "exit"),
    need(result.stdout.includes("dry_run: true"), "not a preview"),
  );
  await seed("sw-fix-m7b");
  const close = await revision("sw-fix-m7b");
  result = await on(["issue", "close", "sw-fix-m7b", "--if-revision", close, "--actor", "sam"]);
  check("core_token_guards_issue_close", result, need(result.status === 0, "exit"));
  const direct = await curl(`${scope}v0/beads/issues/sw-fix-m7`, {
    method: "PATCH",
    body: JSON.stringify({ actor: "sam", patch: { title: "v0" }, expected_version: current }),
    headers: ["Content-Type: application/json"],
  });
  result = { status: direct.status, stdout: direct.text, stderr: "" };
  check(
    "v0_refuses_a_core_token",
    result,
    need(direct.status === 400, "status"),
    need(direct.json?.code === "invalid_argument", "code"),
  );
  return rows;
}

async function tokenMode(context, stack) {
  const token = "e2e-test-token";
  const file = join(stack.root, "tokens");
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  const port = await stack.serve(["--auth-token-file", file]);
  await sleep(500);
  const scope = `http://127.0.0.1:${port}/`;
  const env = { BDP_AUTH_TOKEN: token };
  const row = async (label, args, more) => {
    const result = await context.bdp(["--scope", scope, "--output-mode", "json", ...args], more);
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch {
      envelope = undefined;
    }
    return {
      label,
      exit: result.status,
      outcome: envelope?.outcome,
      error: envelope?.error,
      stdout_shows_token: result.stdout.includes(token) || result.stderr.includes(token),
    };
  };
  const direct = await curlCall(scope, "issue/stats", {});
  const allowed = await curlCall(scope, "issue/stats", {}, {}, token);
  return {
    curl_without_token: direct.status,
    curl_with_token: allowed.status,
    rows: [
      await row("no token: issue stats", ["issue", "stats"]),
      await row("no token: scope inspect", ["scope", "inspect"]),
      await row("no token: list", ["list", "--limit", "2"]),
      await row("bad token: issue stats", ["issue", "stats"], {
        env: { BDP_AUTH_TOKEN: "wrong-token" },
      }),
      await row("token: scope inspect", ["scope", "inspect"], { env }),
      await row("token: issue stats", ["issue", "stats"], { env }),
      await row(
        "token: call issue/show",
        ["call", "issue/show", "--arguments", JSON.stringify({ id: R(1) })],
        { env },
      ),
      await row("token: issue comment", ["issue", "comment", R(7), "token", "--actor", "sam"], {
        env,
      }),
      await row("token: list", ["list", "--limit", "2"], { env }),
      await row("token: show", ["show", R(2)], { env }),
      await row("token: show --include-links", ["show", R(2), "--include-links"], { env }),
      await row("token: link list", ["link", "list", "--limit", "2"], { env }),
      await row("token: versions", ["versions", R(2)], { env }),
      await row("token: bd ready", ["bd", "ready", "--json"], { env }),
    ],
  };
}

/** Grow `issue/list` past the client's document limit and report where each side stands. */
async function sizes(context) {
  const { scope, bdp } = context;
  const filler = "x".repeat(16 * 1024);
  const rows = [];
  let created = 0;
  for (const target of [60, 300, 480, 560]) {
    while (created < target) {
      const items = [];
      for (let index = 0; index < 20 && created + items.length < target; index++)
        items.push({ title: "large", issue_type: "task", description: filler, labels: ["large"] });
      await seedCall(scope, "issue/create-many", { items }, A);
      created += items.length;
    }
    const wire = { label: ["large"], limit: 0 };
    const direct = await curlCall(scope, "issue/list", wire);
    const result = await bdp([
      "--scope",
      scope,
      "--output-mode",
      "json",
      "issue",
      "list",
      "-l",
      "large",
      "-n",
      "0",
    ]);
    let envelope;
    try {
      envelope = JSON.parse(result.stdout);
    } catch {
      envelope = undefined;
    }
    rows.push({
      issues: created,
      curl_status: direct.status,
      curl_bytes: Buffer.byteLength(direct.text),
      client_exit: result.status,
      client_items: envelope?.data?.result?.items?.length,
      client_error: envelope?.error,
    });
    if (result.status !== 0) break;
  }
  return rows;
}

/** Over every POST the client sent: who is acting is never an argument. */
function wireAudit(posts) {
  const offenders = posts.flatMap(({ name, body }) =>
    Object.keys(body.arguments ?? {}).flatMap((key) =>
      ["actor", "author"].includes(key) ? [{ name, member: key }] : [],
    ),
  );
  return { posts: posts.length, verdict: offenders.length === 0 ? "ok" : "differs", offenders };
}

async function main() {
  const settings = options(process.argv.slice(2));
  mkdirSync(settings.out, { recursive: true });
  const declarations = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) => readFile(catalogFile, "utf8")),
  ).declarations;
  const stack = new Stack(settings);
  const results = { started_at: new Date().toISOString(), bd: settings.bd };
  let proxy;
  try {
    await stack.start();
    const scope = `http://127.0.0.1:${stack.port}/`;
    const recording = recordingProxy(stack.port);
    proxy = recording.server;
    await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
    const proxyScope = `http://127.0.0.1:${proxy.address().port}/`;
    const context = { scope, proxyScope, bdp: bdpRunner(stack), posts: recording.posts };
    const selected = (name) => !settings.only || new RegExp(settings.only).test(name);

    const landing = await curl(scope);
    const discovery = await curl(`${scope}bdp`);
    const viaProxy = await curl(`${proxyScope}bdp`);
    results.discovery = {
      landing_status: landing.status,
      landing_link: landing.link,
      document: discovery.json,
      scope_through_proxy: viaProxy.json?.scope,
    };
    if (viaProxy.json?.scope !== proxyScope)
      results.proxy_note = "the proxy's Scope spelling is not honored; wire checks may be void";

    for (const seed of READ_SEED) await seedIssue(scope, seed);
    for (const [name, wire, actor] of READ_BEFORE) await seedCall(scope, name, wire, actor);

    const cases = [];
    for (const kase of READS)
      if (selected(kase.name)) {
        const row = await runCase(context, kase, "primary", ["call"]);
        cases.push(row);
        process.stderr.write(`${row.verdict} ${row.callable}\n`);
      }
    for (const kase of BATCHES)
      if (selected(kase.name)) {
        const row = await runCase(context, kase, kase.label ?? "primary", CHANNELS);
        cases.push(row);
        process.stderr.write(`${row.verdict} ${row.callable}\n`);
      }
    for (const kase of EXTRAS)
      if (selected(kase.name)) {
        const row = await runCase(context, kase, kase.label, CHANNELS);
        cases.push(row);
        process.stderr.write(`${row.verdict} ${row.callable} (${row.label})\n`);
      }
    results.cases = cases;
    const names = new Set(cases.map(({ callable }) => callable));
    results.declared_but_not_run = declarations
      .map(({ name }) => name)
      .filter((name) => !names.has(name));

    results.human_output = [
      await human(context, ["issue", "list", "--status", "open", "-n", "3"]),
      await human(context, ["issue", "show", R(1)]),
      await human(context, ["issue", "stats"]),
      await human(context, ["config", "get", "fix.read"]),
    ];
    if (!settings.only) {
      results.file_annotations = await fileAnnotations(context, stack);
      results.actor = await actorBehavior(context);
      results.core_reads = await coreReads(context);
      results.manual_findings = await manualFindings(context);
      results.token_mode = await tokenMode(context, stack);
      results.sizes = await sizes(context);
    }
    results.wire = wireAudit(recording.posts);
  } finally {
    results.finished_at = new Date().toISOString();
    if (proxy?.listening) await new Promise((done) => proxy.close(done));
    await writeFile(join(settings.out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    await stack.reap();
  }
  const lines = (results.cases ?? []).map(
    (row) =>
      `${row.verdict.padEnd(8)}${row.callable.padEnd(32)}curl ${row.curl_status} ${
        row.curl_error_code ?? row.curl_code ?? ""
      } call=${row.call_exit} tree=${row.tree_exit}${
        row.label === "primary" ? "" : `  [${row.label}]`
      }${
        row.problems.length === 0
          ? ""
          : `  ${row.problems.map((problem) => `${problem.channel}: ${problem.what}`).join("; ")}`
      }`,
  );
  for (const [name, row] of Object.entries(results.actor ?? {}))
    lines.push(
      `${row.verdict.padEnd(8)}actor ${name} exit=${row.exit}${
        row.problems?.length ? `  ${JSON.stringify(row.problems)}` : ""
      }`,
    );
  for (const [name, row] of Object.entries(results.manual_findings ?? {}))
    lines.push(
      `${row.verdict.padEnd(8)}manual ${name} exit=${row.exit}${
        row.problems.length ? `  ${JSON.stringify(row.problems)}` : ""
      }`,
    );
  if (results.wire !== undefined)
    lines.push(
      `${results.wire.verdict.padEnd(8)}no actor or author in arguments across ${results.wire.posts} POSTs${
        results.wire.offenders.length > 0 ? `  ${JSON.stringify(results.wire.offenders)}` : ""
      }`,
    );
  await writeFile(join(settings.out, "summary.txt"), `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
