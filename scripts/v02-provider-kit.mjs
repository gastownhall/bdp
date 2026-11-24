#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { runV02Provider } from "./v02-provider-kit/runner.mjs";
export { runV02Provider };
export const usage =
  "Usage: current-provider-kit.mjs --spec v0.2 --profile read-only --scope SCOPE_URL [--token-env NAME] [--allow-refusal-probes] [--timeout-ms N] [--max-bytes N] [--max-pages N]\n";
export function parseV02Arguments(argv, env = {}) {
  const args = {},
    seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) return null;
    seen.add(flag);
    if (flag === "--allow-refusal-probes") {
      args.allowRefusalProbes = true;
      continue;
    }
    if (
      ![
        "--spec",
        "--profile",
        "--scope",
        "--provider",
        "--token-env",
        "--timeout-ms",
        "--max-bytes",
        "--max-pages",
      ].includes(flag)
    )
      return null;
    const value = argv[++i];
    if (!value || value.startsWith("--")) return null;
    if (["--timeout-ms", "--max-bytes", "--max-pages"].includes(flag)) {
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
      args[
        { "--timeout-ms": "timeoutMs", "--max-bytes": "maxBytes", "--max-pages": "maxPages" }[flag]
      ] = Number(value);
    } else args[flag.slice(2)] = value;
  }
  if (
    args.spec !== "v0.2" ||
    args.profile !== "read-only" ||
    (!args.scope && !args.provider) ||
    (args.scope && args.provider)
  )
    return null;
  if (args.provider && !path.isAbsolute(args.provider)) return null;
  if (args.scope) {
    try {
      const u = new URL(args.scope);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        !u.pathname.endsWith("/") ||
        u.search ||
        u.hash ||
        u.username ||
        u.password ||
        u.href !== args.scope
      )
        return null;
    } catch {
      return null;
    }
  }
  if (args["token-env"]) {
    if (args.provider) return null;
    const token = env[args["token-env"]];
    if (typeof token !== "string" || !token) return null;
    args.authorization = `Bearer ${token}`;
    delete args["token-env"];
  }
  return args;
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseV02Arguments(argv, env);
  if (!args) {
    process.stderr.write(usage);
    return 64;
  }
  let target;
  try {
    if (args.provider) {
      const adapter = await import(pathToFileURL(args.provider).href);
      target = await adapter.provision();
      if (
        !target ||
        typeof target.scope !== "string" ||
        Object.keys(target).some(
          (k) => !["scope", "authorization", "restart", "cleanup"].includes(k),
        )
      )
        throw Error();
    } else target = { scope: args.scope, authorization: args.authorization };
    if (
      !parseV02Arguments(["--spec", "v0.2", "--profile", "read-only", "--scope", target.scope]) ||
      (target.authorization !== undefined && typeof target.authorization !== "string") ||
      (target.restart !== undefined && typeof target.restart !== "function") ||
      (target.cleanup !== undefined && typeof target.cleanup !== "function")
    )
      throw Error();
    const report = await runV02Provider(target, {
      ...args,
      progress: (event) => process.stderr.write(`${JSON.stringify({ progress: event })}\n`),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  } catch {
    try {
      if (typeof target?.cleanup === "function") await target.cleanup();
    } catch {}
    process.stdout.write(
      `${JSON.stringify({
        kit: "bdp-v0.2-read-only",
        profile: "read-only",
        state: "harness-error",
        qualificationComplete: false,
        claimEligible: false,
        harnessFailure: "Provider or checker initialization failed",
      })}\n`,
    );
    return 3;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
