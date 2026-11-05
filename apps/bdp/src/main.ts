#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BLOCKING_LINK_TYPE_ID,
  isReadinessProblem,
  ReadyOutputCompatibilityError,
  readyBeadsFromClient,
  renderReadyJson,
  renderReadyText,
} from "@bdp/bd-domain";
import { BdpClient, BdpClientLocalError, createFetchTransport } from "@bdp/client";
import {
  ConfigError,
  formatConfigError,
  formatStartupDiagnostic,
  loadCanonicalCliConfig,
  loadCliProfile,
  loadStartupConfig,
  parseConfigArgs,
} from "@bdp/config";
import { parseCanonicalScope, RETAINED_V01_SPECIFICATION, type ReadProblem } from "@bdp/protocol";
import { type Command, CommanderError } from "commander";
import { createCanonicalCommand } from "./canonical-command.js";
import {
  defaultCliConfigPath,
  readBoundedFile,
  saveDefaultScope,
  writeCanonicalOutput,
} from "./canonical-io.js";
import { type CanonicalOutput, renderCanonicalOutput } from "./canonical-output.js";
import { runCanonicalInvocation } from "./canonical-runtime.js";

const executable = "bdp";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const help = `Usage: bdp [--config <path>]
       bdp --help
       bdp --version

Commands:
  bdp bd ready [--json]  Compute readiness from generic BDP Read resources.

Options:
  --config <path>  Load a JSON startup configuration file from <path>.
  --output-mode <mode>  Choose human or structured JSON output (canonical commands).
  --help           Show this help text.
  --version        Show the executable version.

Startup configuration names, precedence, and Scope identity rules are pinned in
docs/design/startup-configuration.md.
`;

function diagnostic(level: "error" | "info", event: string, message: string): void {
  process.stderr.write(`${JSON.stringify({ level, event, executable, message })}\n`);
}

/** Fixed shared startup-contract diagnostics; no authored value is accepted. */
class BootstrapConfigUsageError extends Error {
  constructor(reason: "missing" | "empty" | "duplicate") {
    super(
      {
        missing: "--config requires a path",
        empty: "--config requires a non-empty path",
        duplicate: "--config may be given only once",
      }[reason],
    );
  }
}

class CliOperationError extends Error {}

/** Bootstrap registration policy using the declared option arities. No
 * command-specific parsing or network activity occurs until the profile is known. */
export async function runBdp(args: readonly string[]): Promise<number> {
  if (args.length === 0) return runNoArgumentHelp();
  let status = 0;
  try {
    const inventory = createCanonicalCommand({
      version,
      profile: "canonical",
      onInvocation: () => undefined,
    });
    const arities = new Map<string, boolean>();
    const visit = (command: Command): void => {
      for (const option of command.options) {
        if (option.long) arities.set(option.long, option.required || option.optional);
        if (option.short) arities.set(option.short, option.required || option.optional);
      }
      for (const child of command.commands) visit(child);
    };
    visit(inventory);
    let configFile: string | undefined, explicitProfile: "canonical" | "compat" | undefined;
    let configSeen = false,
      profileSeen = false;
    for (let index = 0; index < args.length; index++) {
      const argument = args[index] ?? "";
      if (argument === "--") break;
      const at = argument.indexOf("=");
      const name = at < 0 ? argument : argument.slice(0, at);
      if (!arities.has(name)) continue;
      const value =
        at >= 0 ? argument.slice(at + 1) : arities.get(name) ? args[++index] : undefined;
      if (name === "--config") {
        if (value === undefined || (at < 0 && value.startsWith("--")))
          throw new BootstrapConfigUsageError("missing");
        if (value.length === 0) throw new BootstrapConfigUsageError("empty");
        if (configSeen) throw new BootstrapConfigUsageError("duplicate");
        configSeen = true;
        configFile = value;
      }
      if (name === "--cli-profile") {
        if (profileSeen || (value !== "canonical" && value !== "compat"))
          throw new Error("invalid bootstrap option");
        profileSeen = true;
        explicitProfile = value;
      }
    }
    // Read a selected configuration once; profile registration and execution see
    // the same bytes even when the on-disk file changes during this invocation.
    const configuredPath = configFile ?? process.env.BDP_CONFIG;
    const defaultPath = defaultCliConfigPath(process.env);
    let selectedConfigFile = configuredPath;
    if (selectedConfigFile === undefined) {
      try {
        await readBoundedFile(defaultPath, 1_048_576);
        selectedConfigFile = defaultPath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const configText =
      selectedConfigFile === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedFile(selectedConfigFile, 1_048_576),
          );
    const readFile = (): string => {
      if (configText === undefined) throw new Error("configuration not captured");
      return configText;
    };
    const selectedProfile =
      explicitProfile ??
      loadCliProfile({ configFile: selectedConfigFile, env: process.env, readFile });
    const tree = createCanonicalCommand({
      version: `${executable} ${version}`,
      profile: selectedProfile,
      writeOut: (text) => {
        process.stdout.write(text);
      },
      // Commander can echo unknown operands; diagnostics never echo argv.
      writeErr: () => undefined,
      onInvocation: async (invocation) => {
        if (invocation.command.join(" ") === "scope set") {
          if (configFile !== undefined)
            throw new CliOperationError(
              "scope set cannot modify an explicitly selected --config file; remove --config and try again",
            );
          let scope: string;
          try {
            const supplied = invocation.positionals[0];
            const candidate =
              typeof supplied === "string" &&
              /^https?:\/\//.test(supplied) &&
              !supplied.endsWith("/")
                ? `${supplied}/`
                : supplied;
            scope = parseCanonicalScope(candidate);
          } catch {
            throw new CliOperationError("scope must be an admissible canonical Scope URL");
          }
          const target = process.env.BDP_CONFIG ?? defaultPath;
          try {
            await saveDefaultScope(target, scope);
          } catch {
            throw new CliOperationError(
              "could not save the BDP config; check the config file and directory permissions",
            );
          }
          const result: CanonicalOutput = {
            schema_version: 2,
            bdp_spec: RETAINED_V01_SPECIFICATION,
            result_kind: "scope",
            outcome: "success",
            data: { scope },
          };
          const outputMode = invocation.options.outputMode;
          const outputFormat = invocation.options.outputFormat;
          if (
            (outputMode === "human" && (outputFormat === "json" || outputFormat === "jsonl")) ||
            (outputMode === "json" &&
              outputFormat !== undefined &&
              outputFormat !== "json" &&
              outputFormat !== "jsonl")
          )
            throw new CliOperationError("output mode conflicts with output format");
          if (outputMode === "json" || outputFormat === "json" || outputFormat === "jsonl") {
            process.stdout.write(
              renderCanonicalOutput(
                result,
                { outputFormat: outputFormat === "jsonl" ? "jsonl" : "json" },
                scope,
              ),
            );
          } else process.stdout.write(`Default Scope set to ${scope}\n`);
          return;
        }
        if (invocation.command.join(" ") === "bd ready") {
          if (invocation.options.outputMode === "human" && invocation.options.json)
            throw new CliOperationError("output mode conflicts with --json");
          const env = {
            ...process.env,
            ...(typeof invocation.options.scope === "string"
              ? { BDP_SCOPE_URL: invocation.options.scope }
              : {}),
          };
          status = await runLegacyBdp(
            [
              ...(selectedConfigFile === undefined ? [] : ["--config", selectedConfigFile]),
              "bd",
              "ready",
              ...(invocation.options.json || invocation.options.outputMode === "json"
                ? ["--json"]
                : []),
            ],
            env,
          );
          return;
        }
        const env = {
          ...process.env,
          ...(typeof invocation.options.scope === "string"
            ? { BDP_SCOPE_URL: invocation.options.scope }
            : {}),
        };
        const config = loadCanonicalCliConfig({ configFile: selectedConfigFile, env, readFile });
        const interruption = new AbortController();
        const interrupt = () => interruption.abort();
        process.on("SIGINT", interrupt);
        try {
          status = await runCanonicalInvocation(invocation, config, {
            signal: interruption.signal,
            stdout: (text, signal) => writeCanonicalOutput(process.stdout, text, signal),
            stderr: (text, signal) => writeCanonicalOutput(process.stderr, text, signal),
          });
        } finally {
          process.removeListener("SIGINT", interrupt);
        }
      },
    });
    await tree.parseAsync([...args], { from: "user" });
    return status;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    // A typo may contain a credential. No argv, option value, file contents or
    // library exception text is copied to the diagnostic channel.
    // Commander stops at the first rejected option: count that refusal, not
    // every remaining token. The shared --config errors are fixed strings.
    const message =
      error instanceof BootstrapConfigUsageError
        ? `${error.message}; use --help for usage`
        : error instanceof CliOperationError
          ? error.message
          : error instanceof CommanderError && error.code === "commander.unknownOption"
            ? "1 unsupported argument(s); use --help for usage"
            : "invalid command or configuration; use --help for usage";
    diagnostic("error", "cli.usage", message);
    return 2;
  }
}

async function runNoArgumentHelp(): Promise<number> {
  try {
    const configuredPath = process.env.BDP_CONFIG;
    const defaultPath = defaultCliConfigPath(process.env);
    let selectedConfigFile = configuredPath;
    if (selectedConfigFile === undefined) {
      try {
        await readBoundedFile(defaultPath, 1_048_576);
        selectedConfigFile = defaultPath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const configText =
      selectedConfigFile === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedFile(selectedConfigFile, 1_048_576),
          );
    const readFile = (): string => {
      if (configText === undefined) throw new Error("configuration not captured");
      return configText;
    };
    const configOptions = {
      ...(selectedConfigFile === undefined ? {} : { configFile: selectedConfigFile }),
      env: process.env,
      readFile,
    };
    const profile = loadCliProfile(configOptions);
    const config = loadCanonicalCliConfig(configOptions);
    const command = createCanonicalCommand({
      version: `${executable} ${version}`,
      profile,
      onInvocation: () => undefined,
    });
    const scope = config.scope?.url ?? "not configured; set one with bdp scope set <scope>";
    process.stdout.write(`${command.helpInformation()}\nDefault Scope: ${scope}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) process.stderr.write(formatConfigError(error, executable));
    else diagnostic("error", "cli.startup.failed", "could not read BDP configuration");
    return 2;
  }
}

async function runLegacyBdp(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${executable} ${version}\n`);
    return 0;
  }

  if (args.length === 0) {
    const config = loadStartupConfig({ env, role: "bdp" });
    process.stderr.write(formatStartupDiagnostic(config, executable));
    diagnostic("info", "lifecycle.started", "bdp lifecycle started");
    diagnostic("info", "lifecycle.stopped", "bdp lifecycle stopped");
    return 0;
  }

  const json = args.includes("--json");
  const parsed = parseConfigArgs(args.filter((arg) => arg !== "--json"));
  if (
    parsed.rest.length !== 2 ||
    parsed.rest[0] !== "bd" ||
    parsed.rest[1] !== "ready" ||
    parsed.errors.length > 0
  ) {
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
      env,
      role: "bdp",
    });
    process.stderr.write(formatStartupDiagnostic(config, executable));
    const client = new BdpClient({ scope: config.scope.url, transport: createFetchTransport() });
    let output: string | undefined;
    let failureMessage: string | undefined;
    let exitCode = 0;
    try {
      const result = await readyBeadsFromClient(client, {
        blockingLinkType: BLOCKING_LINK_TYPE_ID,
      });
      if (isReadinessProblem(result)) {
        if (json) output = renderReadyErrorJson({ kind: "protocol", problem: result });
        else failureMessage = result.code;
        exitCode = 1;
      } else {
        output = json ? renderReadyJson(result) : renderReadyText(result);
      }
    } finally {
      await client.close();
    }
    if (output !== undefined) process.stdout.write(output);
    if (failureMessage !== undefined) diagnostic("error", "bd.ready.failed", failureMessage);
    return exitCode;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(formatConfigError(error, executable));
      return 2;
    }
    if (error instanceof BdpClientLocalError) {
      if (json) process.stdout.write(renderReadyErrorJson({ kind: "local", code: error.code }));
      else diagnostic("error", "bd.ready.failed", error.code);
      return 1;
    }
    if (error instanceof ReadyOutputCompatibilityError) {
      if (json) process.stdout.write(renderReadyErrorJson({ kind: "local", code: error.code }));
      else diagnostic("error", "bd.ready.failed", error.code);
      return 1;
    }
    if (json)
      process.stdout.write(renderReadyErrorJson({ kind: "local", code: "internal-failure" }));
    else diagnostic("error", "bd.ready.failed", "internal-failure");
    return 1;
  }
}

function renderReadyErrorJson(
  error:
    | { readonly kind: "protocol"; readonly problem: ReadProblem }
    | { readonly kind: "local"; readonly code: string },
): string {
  return `${JSON.stringify({ error })}\n`;
}

if (isMainModule()) process.exitCode = await runBdp(process.argv.slice(2));

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
