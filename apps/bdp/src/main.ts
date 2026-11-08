#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BLOCKING_LINK_TYPE_ID,
  isReadinessProblem,
  issueCallableCatalog,
  ReadyOutputCompatibilityError,
  readyBeadsFromClient,
  renderReadyJson,
  renderReadyText,
} from "@bdp/bd-domain";
import {
  BdpClient,
  BdpClientLocalError,
  bdpClientFailureReason,
  type CallableCatalog,
  createFetchTransport,
} from "@bdp/client";
import {
  ConfigError,
  formatConfigError,
  formatStartupDiagnostic,
  loadCanonicalCliConfig,
  loadCliProfile,
  loadStartupConfig,
  describeUnsupportedArguments,
  parseConfigArgs,
} from "@bdp/config";
import { parseCanonicalScope, RETAINED_V01_SPECIFICATION, type ReadProblem } from "@bdp/protocol";
import { type Command, CommanderError } from "commander";
import {
  callableCommandTree,
  callableGroupSummaries,
  liftActorFlags,
  renderCallableGroupHelp,
  resolveCallableCommand,
} from "./canonical-call.js";
import {
  ACTOR_CONFLICT,
  type CanonicalInvocation,
  commandWord,
  createCanonicalCommand,
  nearestCommand,
  splitLeadingWords,
  UnknownCommandError,
} from "./canonical-command.js";
import {
  clearDefaultScope,
  defaultCliConfigPath,
  readBoundedFile,
  saveDefaultScope,
  writeCanonicalOutput,
} from "./canonical-io.js";
import { type CanonicalOutput, renderCanonicalOutput } from "./canonical-output.js";
import { runCanonicalInvocation, verifyConnectScope } from "./canonical-runtime.js";

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

const HELP = new Set(["--help", "-h"]);
const noInvocation = () => undefined;

/** The root commands a Callable's first word may not take (Callables §10). */
function builtInWords(): ReadonlySet<string> {
  const inventory = createCanonicalCommand({
    version,
    profile: "canonical",
    onInvocation: noInvocation,
  });
  return new Set(inventory.commands.map((command) => command.name()));
}

/** Bootstrap registration policy using the declared option arities. No
 * command-specific parsing or network activity occurs until the profile is known. */
export async function runBdp(
  args: readonly string[],
  overrides: { readonly callableCatalog?: CallableCatalog } = {},
): Promise<number> {
  const callableCatalog = overrides.callableCatalog ?? issueCallableCatalog();
  if (args.length === 0) return runNoArgumentHelp(callableCatalog);
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
    const builtIns = new Set(inventory.commands.map((command) => command.name()));
    const leading = splitLeadingWords(args, arities);
    const treeCandidate = builtIns.has(leading?.words[0] ?? "") ? undefined : leading;
    // Nothing after a tree command is ours to read, including a --config it may declare.
    const clientArguments = treeCandidate?.client ?? args;
    for (let index = 0; index < clientArguments.length; index++) {
      const argument = clientArguments[index] ?? "";
      if (argument === "--") break;
      const at = argument.indexOf("=");
      const name = at < 0 ? argument : argument.slice(0, at);
      if (!arities.has(name)) continue;
      const value =
        at >= 0 ? argument.slice(at + 1) : arities.get(name) ? clientArguments[++index] : undefined;
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
    // `bdp issue create ...` is `bdp call issue/create ...`, spelled as its name's segments.
    let callableCommand: readonly string[] | undefined;
    let callableInvocation: readonly string[] | undefined;
    if (selectedProfile === "canonical" && treeCandidate !== undefined) {
      // --actor is attribution in any position, even between a command's words (§10).
      const lifted = liftActorFlags(treeCandidate.words);
      const mounted = resolveCallableCommand(
        callableCommandTree(await callableCatalog.list(), builtIns),
        lifted?.words ?? treeCandidate.words,
      );
      if (mounted !== undefined) {
        if (lifted === undefined) throw new CliOperationError("--actor requires a value");
        const client = treeCandidate.client.filter((argument) => !HELP.has(argument));
        const asked = client.length !== treeCandidate.client.length;
        const rest = asked ? ["--help", ...mounted.rest] : mounted.rest;
        const { declaration, path } = mounted.node;
        if (declaration === undefined) {
          if (rest.length > 0 && !HELP.has(rest[0] ?? "")) {
            const names = [...mounted.node.children.keys()];
            const word = commandWord(rest[0] ?? "");
            throw new UnknownCommandError(
              path,
              word,
              word === undefined ? undefined : nearestCommand(word, names),
              names,
            );
          }
          process.stdout.write(renderCallableGroupHelp(mounted.node));
          return 0;
        }
        callableCommand = path;
        callableInvocation = ["call", ...client, ...lifted.client, "--", declaration.name, ...rest];
      }
    }
    const tree = createCanonicalCommand({
      version: `${executable} ${version}`,
      profile: selectedProfile,
      // The Callable groups are listed in root help, and named when a mistyped word is near one.
      ...(selectedProfile === "canonical"
        ? {
            callableGroups: callableGroupSummaries(
              callableCommandTree(await callableCatalog.list(), builtIns),
            ),
          }
        : {}),
      writeOut: (text) => {
        process.stdout.write(text);
      },
      // Commander can echo unknown operands; diagnostics never echo argv.
      writeErr: () => undefined,
      onInvocation: async (invocation) => {
        if (invocation.command.join(" ") === "connect") {
          status = await runConnect(invocation, {
            explicitConfig: configFile !== undefined,
            target: process.env.BDP_CONFIG ?? defaultPath,
            selectedConfigFile,
            readFile: configText === undefined ? undefined : readFile,
          });
          return;
        }
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
                {
                  outputFormat: outputFormat === "jsonl" ? "jsonl" : "json",
                  responseContext: invocation.options.responseContext,
                },
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
          status = await runCanonicalInvocation(
            invocation,
            config,
            {
              signal: interruption.signal,
              stdout: (text, signal) => writeCanonicalOutput(process.stdout, text, signal),
              stderr: (text, signal) => writeCanonicalOutput(process.stderr, text, signal),
            },
            callableCatalog,
            callableCommand,
          );
        } finally {
          process.removeListener("SIGINT", interrupt);
        }
      },
    });
    // Under `--`, Commander leaves a tree command's flags to its declaration, and `call NAME
    // --help` to the declaration's help rather than the verb's.
    const callHelp =
      selectedProfile === "canonical" &&
      leading?.words[0] === "call" &&
      leading.words[1] !== undefined &&
      !leading.words[1].startsWith("-") &&
      leading.words.slice(2).some((word) => HELP.has(word));
    await tree.parseAsync(
      callableInvocation !== undefined
        ? [...callableInvocation]
        : callHelp
          ? ["call", ...(leading?.client ?? []), "--", leading?.words[1] ?? "", "--help"]
          : selectedProfile === "canonical" && leading?.words[0] === "call"
            ? ["call", ...leading.client, ...leading.words.slice(1)]
            : [...args],
      { from: "user" },
    );
    return status;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    // A typo may contain a credential. No option value, file contents or library
    // exception text is copied to the diagnostic channel; a rejected flag's own
    // spelling is named when it is shaped like one. Commander stops at the first
    // rejected option: that is the one refusal, not every remaining token. The
    // shared --config errors are fixed strings.
    const message =
      error instanceof BootstrapConfigUsageError
        ? `${error.message}; use --help for usage`
        : error instanceof CliOperationError || error instanceof UnknownCommandError
          ? error.message
          : error instanceof CommanderError && error.code === ACTOR_CONFLICT
            ? "--actor was given with two different values"
            : error instanceof CommanderError
              ? commanderMessage(error)
              : "invalid command or configuration; use --help for usage";
    diagnostic("error", "cli.usage", message);
    return 2;
  }
}

/** What Commander refused, said without repeating any value that was typed (row 2). */
function commanderMessage(error: CommanderError): string {
  const path = (error as CommanderError & { commandPath?: readonly string[] }).commandPath ?? [];
  const where = ["bdp", ...path].join(" ");
  const usage = `run '${where} --help' for usage`;
  const quoted = (pattern: RegExp): string | undefined => pattern.exec(error.message)?.[1];
  switch (error.code) {
    case "commander.unknownOption": {
      const name = quoted(/unknown option '([^']*)'/) ?? "";
      // The flag that once dropped the envelope; JSON is now the data alone by default.
      const retired =
        name.split("=", 1)[0] === "--omit"
          ? "; --omit envelope is retired: --output-mode json prints the data alone, and --response-context adds the envelope"
          : "";
      return `${describeUnsupportedArguments([name])}${retired}; use --help for usage`;
    }
    case "commander.missingArgument":
      return `'${where}' needs <${quoted(/missing required argument '([^']*)'/) ?? "argument"}>; ${usage}`;
    case "commander.excessArguments":
      return `too many arguments for '${where}'; ${usage}`;
    case "commander.optionMissingArgument": {
      const option = quoted(/option '([^' ]*)/);
      return `${option === undefined ? "an option" : option} needs a value; ${usage}`;
    }
    case "commander.invalidArgument": {
      const option = quoted(/option '([^' ]*)/);
      const choices = /Allowed choices are (.*)\.$/.exec(error.message)?.[1];
      return choices === undefined
        ? `invalid value for ${option ?? "an argument"}; ${usage}`
        : `${option ?? "this option"} takes one of: ${choices}; ${usage}`;
    }
    case "commander.error":
      // The command tree's own refusals: fixed text, with no value in it.
      return `${error.message.replace(/^error: /, "")}; ${usage}`;
    default:
      return `invalid command or configuration; ${usage}`;
  }
}

/** `bdp connect`: store the default Scope after reading its discovery, show the Scope in use and
 * its source, or forget the stored one (row 1). */
async function runConnect(
  invocation: CanonicalInvocation,
  context: {
    readonly explicitConfig: boolean;
    readonly target: string;
    readonly selectedConfigFile: string | undefined;
    readonly readFile: ((path: string) => string) | undefined;
  },
): Promise<number> {
  const options = invocation.options;
  const outputMode = options.outputMode;
  const outputFormat = options.outputFormat;
  if (
    (outputMode === "human" && (outputFormat === "json" || outputFormat === "jsonl")) ||
    (outputMode === "json" &&
      outputFormat !== undefined &&
      outputFormat !== "json" &&
      outputFormat !== "jsonl")
  )
    throw new CliOperationError("output mode conflicts with output format");
  const json = outputMode === "json" || outputFormat === "json" || outputFormat === "jsonl";
  const emit = (data: Record<string, unknown>, human: readonly string[]): void => {
    if (!json) {
      process.stdout.write(`${human.join("\n")}\n`);
      return;
    }
    const result: CanonicalOutput = {
      schema_version: 2,
      bdp_spec: null,
      result_kind: "scope",
      outcome: "success",
      data,
    };
    process.stdout.write(
      renderCanonicalOutput(result, {
        outputFormat: outputFormat === "jsonl" ? "jsonl" : "json",
        responseContext: options.responseContext,
      }),
    );
  };
  const environment = process.env.BDP_SCOPE_URL;
  const overridden =
    environment === undefined
      ? []
      : [`Note: BDP_SCOPE_URL (${environment}) is set, and wins over the stored Scope.`];
  const supplied = invocation.positionals[0];
  if (options.clear === true || supplied !== undefined) {
    if (context.explicitConfig)
      throw new CliOperationError(
        "connect cannot modify an explicitly selected --config file; remove --config and try again",
      );
  }
  if (options.clear === true) {
    let cleared: boolean;
    try {
      cleared = await clearDefaultScope(context.target);
    } catch {
      throw new CliOperationError(
        "could not update the BDP config; check the config file and directory permissions",
      );
    }
    emit({ scope: null, cleared, file: context.target }, [
      cleared
        ? `Forgot the stored Scope in ${context.target}.`
        : `No Scope was stored in ${context.target}.`,
      ...overridden,
    ]);
    return 0;
  }
  const config = loadCanonicalCliConfig({
    configFile: context.selectedConfigFile,
    env: process.env,
    ...(context.readFile === undefined ? {} : { readFile: context.readFile }),
  });
  if (supplied !== undefined) {
    let scope: string;
    try {
      const candidate =
        /^https?:\/\//.test(supplied) && !supplied.endsWith("/") ? `${supplied}/` : supplied;
      scope = parseCanonicalScope(candidate);
    } catch {
      throw new CliOperationError("connect needs an admissible canonical Scope URL");
    }
    const verified = await verifyConnectScope(scope, config);
    if (!verified.ok) {
      diagnostic("error", "cli.connect.failed", `${verified.message}; nothing was stored`);
      return verified.status;
    }
    try {
      await saveDefaultScope(context.target, scope);
    } catch {
      throw new CliOperationError(
        "could not save the BDP config; check the config file and directory permissions",
      );
    }
    emit(
      {
        scope,
        source: `config file ${context.target}`,
        bdpVersion: verified.bdpVersion,
        profile: verified.profile,
      },
      [
        `Connected to ${scope} (BDP ${verified.bdpVersion}, ${verified.profile} profile).`,
        `Stored in ${context.target}.`,
        ...(environment !== undefined && environment !== scope ? overridden : []),
      ],
    );
    return 0;
  }
  // Alone: the Scope a command would use, and where it came from.
  const flag = typeof options.scope === "string" ? options.scope : undefined;
  const stored = (() => {
    if (context.selectedConfigFile === undefined || context.readFile === undefined)
      return undefined;
    try {
      return loadCanonicalCliConfig({
        configFile: context.selectedConfigFile,
        env: {},
        readFile: context.readFile,
      }).scope;
    } catch {
      return undefined;
    }
  })();
  const used =
    flag !== undefined
      ? { url: flag, source: "--scope" }
      : config.scope === undefined
        ? undefined
        : { url: config.scope.url, source: config.scope.source ?? "configuration" };
  const shadowed = stored !== undefined && used?.source !== stored.source ? stored : undefined;
  emit(
    {
      scope: used?.url ?? null,
      source: used?.source ?? null,
      ...(shadowed === undefined
        ? {}
        : { stored: { scope: shadowed.url, source: shadowed.source } }),
    },
    used === undefined
      ? ["No Scope is set; connect one with bdp connect URL."]
      : [
          `Scope: ${used.url} (from ${used.source})`,
          ...(shadowed === undefined
            ? []
            : [`Stored: ${shadowed.url} (from ${shadowed.source}), not used`]),
        ],
  );
  return 0;
}

async function runNoArgumentHelp(callableCatalog: CallableCatalog): Promise<number> {
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
      onInvocation: noInvocation,
      ...(profile === "canonical"
        ? {
            callableGroups: callableGroupSummaries(
              callableCommandTree(await callableCatalog.list(), builtInWords()),
            ),
          }
        : {}),
    });
    const scope =
      config.scope === undefined
        ? "not configured; set one with bdp connect <url>"
        : `${config.scope.url}${config.scope.source === undefined ? "" : ` (from ${config.scope.source})`}`;
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
    // A flag is named and nothing else is: an unsupported argument may be a mistyped credential.
    const details = [
      ...parsed.errors,
      ...(parsed.rest.length > 0 ? [describeUnsupportedArguments(parsed.rest)] : []),
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
      const reason = bdpClientFailureReason(error);
      if (json)
        process.stdout.write(
          renderReadyErrorJson({
            kind: "local",
            code: error.code,
            ...(reason === undefined ? {} : { message: reason }),
          }),
        );
      else
        diagnostic(
          "error",
          "bd.ready.failed",
          reason === undefined ? error.code : `${error.code}: ${reason}`,
        );
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
    | { readonly kind: "local"; readonly code: string; readonly message?: string },
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
