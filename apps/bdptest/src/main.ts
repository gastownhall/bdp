#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

import {
  ConfigError,
  formatConfigError,
  formatStartupDiagnostic,
  loadStartupConfig,
  parseConfigArgs,
  type ServerReadLimitsConfig,
} from "@bdp/config";
import {
  isNodeHttpListenerError,
  isReadServerAdmissionError,
  serveNodeHttpServer,
  type ProtocolProfile,
} from "@bdp/server";

import { createConfiguredBdptestReadServer } from "./server-composition.js";

const executable = "bdptest";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const help = `Usage: bdptest --serve [--config <path>]
       bdptest [--config <path>]
       bdptest --help
       bdptest --version

Runs lifecycle mode by default; --serve requests a deterministic local BDP
server from the built-in reference domain and is refused until Read evidence
exists. The bdptest.fixture selector is not consumed yet.

Options:
  --serve          Request the HTTP Read server (refused until Read evidence exists).
  --config <path>  Load a JSON startup configuration file from <path>.
  --help           Show this help text.
  --version        Show the executable version.

Startup configuration names, precedence, and Scope identity rules are pinned in
docs/design/startup-configuration.md.
`;

function diagnostic(
  level: "error" | "info",
  event: string,
  message: string,
  signal?: NodeJS.Signals,
): void {
  process.stderr.write(`${JSON.stringify({ level, event, executable, message, signal })}\n`);
}

function unexpectedErrorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
}

async function runServer(config: {
  readonly scope: { readonly url: string };
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly advertisedProfile?: ProtocolProfile;
    readonly limits: ServerReadLimitsConfig;
    readonly internalFaultResource?: string;
  };
}): Promise<number> {
  const readServer = createConfiguredBdptestReadServer(config);
  const stoppedBy = await serveNodeHttpServer(readServer, {
    host: config.server.host,
    port: config.server.port,
    onRequestError: (error) =>
      diagnostic(
        "error",
        "server.request_failed",
        `bdptest request failed (${unexpectedErrorSummary(error)})`,
      ),
    onStarted: () => diagnostic("info", "server.started", "bdptest Read server started"),
  });
  if (stoppedBy.kind === "listener-failure") {
    diagnostic("error", "server.listener_failed", stoppedBy.error.message);
  }
  diagnostic("info", "server.stopped", "bdptest Read server stopped");
  return stoppedBy.kind === "listener-failure" ? 2 : 0;
}

async function main(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${executable} ${version}\n`);
    return 0;
  }

  const serve = args.includes("--serve");
  const parsed = parseConfigArgs(args.filter((arg) => arg !== "--serve"));
  if (parsed.rest.length > 0 || parsed.errors.length > 0) {
    // Never echo argv: an unsupported argument may be a mistyped credential.
    const details = [
      ...parsed.errors,
      ...(parsed.rest.length > 0 ? [`${parsed.rest.length} unsupported argument(s)`] : []),
    ];
    diagnostic("error", "cli.usage", `${details.join("; ")}; use --help for usage`);
    return 2;
  }

  try {
    const config = loadStartupConfig({
      configFile: parsed.configFile,
      env: process.env,
      role: "bdptest",
    });
    process.stderr.write(formatStartupDiagnostic(config, executable));
    if (!serve) {
      const stopped = new Promise<void>((resolve) => {
        const keepAlive = setInterval(() => undefined, 2_147_483_647);
        const stop = (): void => {
          clearInterval(keepAlive);
          resolve();
        };
        process.once("SIGTERM", stop);
        process.once("SIGINT", stop);
      });
      diagnostic("info", "lifecycle.started", "bdptest lifecycle started");
      await stopped;
      diagnostic("info", "lifecycle.stopped", "bdptest lifecycle stopped");
      await new Promise<void>((resolve) => setImmediate(resolve));
      return 0;
    }
    // Await inside this try so admission failures become structured exit 2 diagnostics.
    return await runServer(config);
  } catch (error) {
    if (isReadServerAdmissionError(error)) {
      diagnostic("error", "startup.profile_refused", error.message);
      return 2;
    }
    if (isNodeHttpListenerError(error)) {
      diagnostic("error", "startup.listen_failed", error.message);
      return 2;
    }
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(formatConfigError(error, executable));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
