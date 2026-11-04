#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Manual reference service: ${message}\n`);
  process.exitCode = 1;
}
process.on("uncaughtException", reportError);
process.on("unhandledRejection", reportError);

const root = fileURLToPath(new URL("..", import.meta.url));
const stateRoot = path.join(root, ".review-playground");
const store = path.join(stateRoot, "store");
const configPath = path.join(stateRoot, "reference.json");
const clientConfigPath = path.join(stateRoot, "client.config.json");
const anonymousConfigPath = path.join(stateRoot, "anonymous.config.json");
const usage = `Usage: node scripts/manual-reference-service.mjs [SCOPE] [--auth required|disabled]
       node scripts/manual-reference-service.mjs --scope SCOPE [--auth required|disabled]

Start the manual BDP reference service at a local Scope URL.

Arguments:
  SCOPE                  Local HTTP Scope URL, for example http://127.0.0.1:18080/review/

Options:
  --scope SCOPE          Set the Scope URL (alternative to the positional argument)
  --auth MODE            Require Bearer authentication or disable it (required|disabled)
  --help                 Show this help
`;
function parseArguments(argv) {
  let scope;
  let authentication;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--scope" || arg === "--auth") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--scope") {
        if (scope !== undefined) throw new Error("Scope may be specified only once");
        scope = value;
      } else {
        if (authentication !== undefined) throw new Error("--auth may be specified only once");
        if (value !== "required" && value !== "disabled")
          throw new Error("--auth must be required or disabled");
        authentication = value;
      }
    } else if (arg.startsWith("--scope=")) {
      if (scope !== undefined) throw new Error("Scope may be specified only once");
      scope = arg.slice("--scope=".length);
    } else if (arg.startsWith("--auth=")) {
      if (authentication !== undefined) throw new Error("--auth may be specified only once");
      authentication = arg.slice("--auth=".length);
      if (authentication !== "required" && authentication !== "disabled")
        throw new Error("--auth must be required or disabled");
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (scope === undefined) scope = arg;
    else throw new Error("supply the Scope once, either positionally or with --scope");
  }
  return { scope, authentication, help: false };
}
const args = parseArguments(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage);
  process.exit(0);
}
const requiredNode = "24.22.1";
if (process.versions.node !== requiredNode) {
  process.stderr.write(
    `The manual reference service requires Node ${requiredNode}; this process is using ${process.versions.node}. Run \`nvm install ${requiredNode} && nvm use ${requiredNode}\`, then start it again.\n`,
  );
  process.exit(1);
}
const { startReferenceService } = await import("../packages/server/dist/reference.js");
const requestedScope = args.scope ?? "http://127.0.0.1:18080/review/";
const parsedScope = new URL(requestedScope);
if (
  parsedScope.protocol !== "http:" ||
  parsedScope.hostname !== "127.0.0.1" ||
  parsedScope.username ||
  parsedScope.password ||
  parsedScope.search ||
  parsedScope.hash ||
  parsedScope.pathname.includes("//")
)
  throw new Error("Scope must be an HTTP URL on 127.0.0.1 without credentials, query or fragment");
if (!parsedScope.pathname.endsWith("/")) parsedScope.pathname += "/";
const port = Number(parsedScope.port || "80");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Scope URL must include a port from 1024 through 65535");

await mkdir(stateRoot, { recursive: true, mode: 0o700 });
const scope = parsedScope.href;
let saved;
if (existsSync(configPath)) {
  saved = JSON.parse(await readFile(configPath, "utf8"));
  if (saved.scope !== scope || typeof saved.token !== "string")
    throw new Error(
      `Existing ${configPath} belongs to another Scope; preserve it and use a fresh playground directory.`,
    );
} else {
  if (existsSync(store))
    throw new Error("Reference store exists without its config; refusing to guess or reset it.");
  saved = { scope, token: randomBytes(32).toString("base64url") };
  await writeFile(configPath, `${JSON.stringify(saved, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
const authentication = args.authentication ?? saved.authentication ?? "required";
if (authentication !== "required" && authentication !== "disabled")
  throw new Error(`Existing ${configPath} has an unsupported authentication mode`);
saved.authentication = authentication;
await writeFile(configPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });

const clientConfig = {
  scope: { url: scope },
  ...(authentication === "required" ? { auth: { token: saved.token } } : {}),
};
await writeFile(clientConfigPath, `${JSON.stringify(clientConfig, null, 2)}\n`, { mode: 0o600 });
await writeFile(anonymousConfigPath, `${JSON.stringify({ scope: { url: scope } }, null, 2)}\n`, {
  mode: 0o600,
});

const proxy = createServer((incoming, outgoing) => {
  if (!reference) {
    outgoing.writeHead(503).end("reference service is starting");
    return;
  }
  const destination = new URL(reference.listenUrl);
  const forward = request(
    {
      hostname: destination.hostname,
      port: destination.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: new URL(scope).host },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  forward.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.on("aborted", () => forward.destroy());
  incoming.pipe(forward);
});

let reference;
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await new Promise((resolve) => proxy.close(() => resolve()));
  await reference?.close();
}
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));

await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(port, "127.0.0.1", resolve);
});
const database = path.join(store, "retained-reference.sqlite");
if (!existsSync(store)) await mkdir(store, { mode: 0o700 });
reference = await startReferenceService({
  directory: store,
  create: !existsSync(database),
  instance: "manual-review-playground",
  scope,
  authentication,
  credentials: authentication === "required" ? [{ token: saved.token, principal: "reviewer" }] : [],
});

process.stdout.write(`Reference BDP service: ${scope}\n`);
process.stdout.write(`Client config: ${clientConfigPath}\n`);
process.stdout.write(`Unauthenticated client config: ${anonymousConfigPath}\n`);
process.stdout.write("Press Ctrl-C to stop the service.\n");
await new Promise((resolve) => proxy.once("close", resolve));
