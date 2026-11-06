#!/usr/bin/env node
/** The reference client against a live `bd serve`, compared with a direct curl.
 *
 * Every Issue Callable runs through `bdp call NAME`, the induced command and `curl` of
 * `POST /bdp/call/NAME`. Status and body are compared modulo volatile fields, and a recording
 * proxy checks the client sent exactly the arguments the case states. Then the Core reads, a
 * token-mode run, `actor` behavior and the client's document limit. It reports anomalies and
 * changes nothing in either product; it exits non-zero only when the harness itself breaks.
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
  actor: A,
  id,
  title,
  issue_type: "task",
  priority: 2,
  ...fields,
});
const claimBy = (id, actor = "bob") => ["issue/claim", { id, actor }];
const closed = (id) => ["issue/close", { id, actor: A, reason: "done" }];
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
  ["issue/comment", { id: R(7), author: "alice", text: "first" }],
  ["config/set", { key: "fix.read", value: "v1" }],
  ["memory/remember", { content: "remembered thing", key: "fix-read" }],
];

const flag = (name, value) => [name, typeof value === "string" ? value : JSON.stringify(value)];

/** Reads: one state, compared literally. `wire` is what a caller sends, `cli` how the client is
 * told it, including its positions, aliases and CLI defaults. */
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
    wire: { status: ["open"], sort: "priority" },
    cli: ["--status", "open"],
  },
  { name: "issue/query", wire: { q: "status=open", limit: 2 }, cli: ["status=open", "-n", "2"] },
  { name: "issue/count", wire: { status: "open" }, cli: ["-s", "open"] },
  { name: "issue/show", wire: { id: R(1) }, cli: [R(1)] },
  { name: "issue/dep/list", wire: { id: R(2), direction: "out" }, cli: [R(2)] },
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
/** Batches: each channel gets its own fixture, named for it, so all three do the same work. */
const BATCHES = [
  {
    name: "issue/create",
    make: (c) => ({
      wire: { actor: A, id: F("cr", c), title: "Fix login", priority: 1, issue_type: "task" },
      cli: ["Fix login", "--actor", A, "--id", F("cr", c), "-p", "1", "-t", "task"],
    }),
  },
  {
    name: "issue/update",
    make: (c) => ({
      seed: [issue(F("up", c))],
      wire: { id: F("up", c), actor: A, patch: { title: "new" } },
      cli: [F("up", c), "--actor", A, ...flag("--patch", { title: "new" })],
    }),
  },
  {
    name: "issue/comment",
    make: (c) => ({
      seed: [issue(F("co", c))],
      wire: { id: F("co", c), author: "alice", text: "hi" },
      cli: [F("co", c), "hi", "-a", "alice"],
    }),
  },
  {
    name: "issue/claim",
    make: (c) => ({
      seed: [issue(F("cl", c))],
      wire: { id: F("cl", c), actor: A },
      cli: [F("cl", c), "--actor", A],
    }),
  },
  {
    name: "issue/unclaim",
    make: (c) => ({
      seed: [issue(F("un", c))],
      before: [claimBy(F("un", c))],
      wire: { id: F("un", c), actor: "bob", expected_assignee: "bob" },
      cli: [F("un", c), "--actor", "bob", "--if-assignee", "bob"],
    }),
  },
  {
    name: "issue/heartbeat",
    make: (c) => ({
      seed: [issue(F("he", c))],
      before: [claimBy(F("he", c))],
      wire: { id: F("he", c), actor: "bob" },
      cli: [F("he", c), "--actor", "bob"],
    }),
  },
  {
    name: "issue/close",
    make: (c) => ({
      seed: [issue(F("xx", c))],
      wire: { id: F("xx", c), actor: A, reason: "Closed" },
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
      wire: { id: F("m1", c), actor: A },
      cli: [F("m1", c), "--actor", A],
    }),
  },
  {
    name: "issue/reopen",
    make: (c) => ({
      seed: [issue(F("ro", c))],
      before: [closed(F("ro", c))],
      wire: { id: F("ro", c), actor: A, reason: "again" },
      cli: [F("ro", c), "--actor", A, "-r", "again"],
    }),
  },
  {
    name: "issue/metadata/compare-and-set",
    make: (c) => ({
      seed: [issue(F("ms", c), "cas", { metadata: { k: "old" } })],
      wire: { id: F("ms", c), actor: A, key: "k", expected: "old", value: "new" },
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
    name: "issue/purge",
    make: (c) => ({
      seed: [issue(F("pu", c), "purge", { ephemeral: true })],
      before: [closed(F("pu", c))],
      wire: {
        dry_run: true,
        tier: "ephemeral",
        protect_referenced: false,
        protect_live_dependents: true,
        actor: A,
        pattern: F("pu", c),
      },
      cli: ["--actor", A, "--pattern", F("pu", c)],
    }),
  },
  {
    name: "issue/prune",
    make: (c) => ({
      seed: [issue(F("pr", c))],
      before: [closed(F("pr", c))],
      wire: {
        dry_run: true,
        tier: "durable",
        protect_referenced: true,
        protect_live_dependents: false,
        actor: A,
        pattern: F("pr", c),
      },
      cli: ["--actor", A, "--pattern", F("pr", c)],
    }),
  },
  {
    name: "issue/delete",
    make: (c) => ({
      seed: [issue(F("de", c))],
      wire: { ids: [F("de", c)], dry_run: true },
      cli: ["--ids", F("de", c)],
    }),
  },
  {
    name: "issue/reclaim",
    make: (c) => ({
      seed: [issue(F("rc", c))],
      before: [claimBy(F("rc", c))],
      wire: { actor: A, older_than_seconds: 600, ids: [F("rc", c)] },
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
        wire: { actor: A, items },
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
        wire: { actor: A, items },
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
        wire: { actor: A, items },
        cli: ["--actor", A, ...items.flatMap((item) => flag("--items", item))],
      };
    },
  },
  {
    name: "issue/claim-next",
    make: (c) => ({
      seed: [issue(F("cn", c), "next", { labels: [`next-${c}`] })],
      wire: { actor: A, label: [`next-${c}`] },
      cli: ["--actor", A, "-l", `next-${c}`],
    }),
  },
  {
    name: "issue/dep/add",
    make: (c) => ({
      seed: [issue(F("da", c)), issue(F("db", c))],
      wire: { actor: A, source: F("da", c), target: F("db", c), type: "related" },
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
      wire: { actor: A, issue_id: F("dc", c), depends_on_id: F("dd", c) },
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

/** Beyond the one case per Callable: a real run past a CLI default, and each refusal kind. */
const EXTRAS = [
  {
    label: "issue/delete --no-dry-run really deletes",
    name: "issue/delete",
    make: (c) => ({
      seed: [issue(F("dr", c))],
      wire: { ids: [F("dr", c)], dry_run: false, actor: A },
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
      wire: { id: F("ac", c), actor: "carol" },
      cli: [F("ac", c), "--actor", "carol"],
    }),
    exit: 1,
  },
  {
    label: "revision-mismatch: a stale expected_version",
    name: "issue/update",
    make: (c) => ({
      seed: [issue(F("sv", c))],
      wire: { id: F("sv", c), actor: A, patch: { title: "n" }, expected_version: "1" },
      cli: [F("sv", c), "--actor", A, "--patch", '{"title":"n"}', "--expected-version", "1"],
    }),
    exit: 4,
  },
  {
    label: "identity-taken: an id already held",
    name: "issue/create",
    make: (c) => ({
      seed: [issue(F("it", c))],
      wire: { actor: A, id: F("it", c), title: "again", issue_type: "task" },
      cli: ["again", "--actor", A, "--id", F("it", c), "-t", "task"],
    }),
    exit: 1,
  },
  {
    label: "invalid-parameter: a bad cursor",
    name: "issue/list",
    make: () => ({
      wire: { cursor: "not-a-cursor", sort: "priority" },
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

const seedCall = async (scope, name, wire) => {
  const answer = await curlCall(scope, name, wire);
  if (answer.status !== 200)
    throw new Error(`seed ${name} ${JSON.stringify(wire)}: ${answer.status} ${answer.text}`);
  return answer;
};

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

function judge(curlAnswer, answers, expectedWire, posts, expectedExit) {
  const problems = [];
  const reference = masked(curlAnswer.json);
  for (const [channel, answer, post] of answers) {
    if (!answer.parsed) {
      problems.push({ channel, what: "output is not the JSON envelope", detail: answer });
      continue;
    }
    if (post === undefined) problems.push({ channel, what: "no POST reached the mount" });
    else {
      const wire = differences(masked(expectedWire), masked(post.body.arguments));
      if (wire.length > 0) problems.push({ channel, what: "sent different arguments", wire });
    }
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
    for (const seed of made.seed ?? []) await seedCall(scope, "issue/create", seed);
    for (const [name, wire] of made.before ?? []) await seedCall(scope, name, wire);
  }
  const part = (channel) => parts[channel] ?? parts[seedChannels[0]];
  const words = kase.name.split("/");
  const json = ["--scope", proxyScope, "--output-mode", "json"];
  const attempt = async (channel, args) => {
    const seen = posts.length;
    const result = await bdp([...json, ...args]);
    return [channel, clientAnswer(result), posts[seen]];
  };
  const viaCall = await attempt("call", [
    "call",
    kase.name,
    "--arguments",
    JSON.stringify(part("call").wire),
  ]);
  const viaTree = await attempt("tree", [...words, ...part("tree").cli]);
  const viaCurl = await curlCall(scope, kase.name, part("curl").wire);
  const problems = judge(viaCurl, [viaCall, viaTree], part("call").wire, posts, kase.exit);
  // The wire comparison above used the call channel's fixture; the mask folds channel names.
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
  await seedCall(scope, "issue/create", issue("sw-fix-ff"));
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
    [...scoped, "issue", "comment", "sw-fix-ff", "-f", "-", "-a", "alice"],
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

async function actorBehavior(context) {
  const form = ["issue", "create", "Fix login", "-p", "1", "-t", "task"];
  const wire = { title: "Fix login", priority: 1, issue_type: "task", actor: "sam" };
  return {
    without_actor: await human(context, form),
    with_actor_after: await human(context, [...form, "--actor", "sam"]),
    with_actor_before_refused: await human(context, ["--actor", "sam", ...form]),
    call_with_argument_and_attribution: await human(context, [
      "call",
      "issue/create",
      "--arguments",
      JSON.stringify(wire),
      "--actor",
      "sam",
    ]),
    call_with_differing_attribution: await human(context, [
      "call",
      "issue/create",
      "--arguments",
      JSON.stringify(wire),
      "--actor",
      "kim",
    ]),
    call_with_flags_refused: await human(context, ["call", "issue/create", "--title", "Fix login"]),
    comment_author_from_call_attribution: await human(context, [
      "call",
      "issue/comment",
      "--arguments",
      JSON.stringify({ id: R(7), text: "author from the actor" }),
      "--actor",
      "sam",
    ]),
    comment_author_flag: await human(context, [
      "issue",
      "comment",
      R(7),
      "author from the flag",
      "--author",
      "sam",
    ]),
    comment_with_no_author_or_actor: await human(context, ["issue", "comment", R(7), "nobody"]),
  };
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
      await row("token: issue comment", ["issue", "comment", R(7), "token", "--author", "sam"], {
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
      await seedCall(scope, "issue/create-many", { actor: A, items });
      created += items.length;
    }
    const wire = { label: ["large"], limit: 0, sort: "priority" };
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

    for (const seed of READ_SEED) await seedCall(scope, "issue/create", seed);
    for (const [name, wire] of READ_BEFORE) await seedCall(scope, name, wire);

    const cases = [];
    for (const kase of READS)
      if (selected(kase.name)) {
        const row = await runCase(context, kase, "primary", ["call"]);
        cases.push(row);
        process.stderr.write(`${row.verdict} ${row.callable}\n`);
      }
    for (const kase of BATCHES)
      if (selected(kase.name)) {
        const row = await runCase(context, kase, "primary", CHANNELS);
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
      results.token_mode = await tokenMode(context, stack);
      results.sizes = await sizes(context);
    }
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
  await writeFile(join(settings.out, "summary.txt"), `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
