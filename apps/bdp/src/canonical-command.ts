import { Command, Option } from "commander";

export interface CanonicalInvocation {
  readonly command: readonly string[];
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, unknown>>;
  /** Commander attribute names explicitly supplied on the command line. */
  readonly explicitOptions: readonly string[];
}

export interface CanonicalCommandOptions {
  readonly version: string;
  readonly profile: "canonical" | "compat";
  readonly onInvocation: (invocation: CanonicalInvocation) => void | Promise<void>;
  readonly writeOut?: (text: string) => void;
  readonly writeErr?: (text: string) => void;
  /** Words the Callable tree mounts, listed in root help (Callables §10). */
  readonly callableGroups?: readonly { readonly name: string; readonly description: string }[];
}

type Flag = readonly [syntax: string, description: string, choices?: readonly string[]];
const scope: Flag = ["--scope <scope>", "Select the command Scope."];
const long: Flag = ["--long", "Show full references and administrative detail."];
const pointFormats = ["default", "detail", "json", "jsonl"] as const;
const objectFlags: readonly Flag[] = [
  ["--properties <json>", "Initialize or shallow-merge properties."],
  ["--metadata <json>", "Initialize or shallow-merge metadata."],
];
const editFlags: readonly Flag[] = [
  ...objectFlags,
  ["--replace-properties <json>", "Replace the writable property object."],
  ["--patch-properties <json>", "Apply an ordered strict property patch."],
  ["--set-property <key=value>", "Set a literal property key; repeatable."],
  ["--unset-property <key>", "Remove a literal property key; repeatable."],
  ["--replace-metadata <json>", "Replace metadata."],
  ["--patch-metadata <json>", "Apply an ordered strict metadata patch."],
  ["--set-metadata <key=value>", "Set a literal metadata key; repeatable."],
  ["--unset-metadata <key>", "Remove a literal metadata key; repeatable."],
];
const repeated = new Set([
  "setProperty",
  "unsetProperty",
  "setMetadata",
  "unsetMetadata",
  "include",
  "omit",
]);

/** The code of the Commander error for two different `--actor` values, so its message survives. */
export const ACTOR_CONFLICT = "bdp.actorConflict";

/** A word no command at that level takes, or a group given without one (row 2). */
export class UnknownCommandError extends Error {
  /** The group's words, without `bdp`. */
  readonly path: readonly string[];
  /** The word, when it is shaped like a command word and safe to repeat. */
  readonly word: string | undefined;
  /** The nearest command at that level, if one is near enough to suggest. */
  readonly suggestion: string | undefined;
  /** The commands at that level. */
  readonly commands: readonly string[];
  constructor(
    path: readonly string[],
    word: string | undefined,
    suggestion: string | undefined,
    commands: readonly string[],
    hint?: string,
  ) {
    const where = ["bdp", ...path].join(" ");
    super(
      `unknown command ${word === undefined ? "(not shown, since it may be a value)" : `'${word}'`} for '${where}'; ${
        suggestion === undefined
          ? `its commands are ${commands.join(", ")}`
          : `did you mean '${where} ${suggestion}'?`
      }; run '${where} --help' for usage${hint === undefined ? "" : `. ${hint}`}`,
    );
    this.path = path;
    this.word = word;
    this.suggestion = suggestion;
    this.commands = commands;
  }
}

/** A word typed where a command goes is repeated only when it looks like one, since what was
 * typed may be a mistyped value. */
export function commandWord(word: string): string | undefined {
  return /^[a-z][a-z0-9_-]{0,31}$/.test(word) ? word : undefined;
}
/** Optimal string alignment distance. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const row = d[i] as number[];
      const above = d[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((above[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (above[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j] ?? 0, ((d[i - 2] as number[])[j - 2] ?? 0) + 1);
    }
  return (d[a.length] as number[])[b.length] ?? 0;
}
/** The nearest of `commands` to `word`: a prefix of one, or within three edits of one and more
 * alike than not. */
export function nearestCommand(word: string, commands: readonly string[]): string | undefined {
  let best: { name: string; score: number } | undefined;
  for (const name of commands) {
    const edits = distance(word, name);
    const prefix = word.length >= 2 && name.startsWith(word);
    const near = edits <= 3 && (Math.max(word.length, name.length) - edits) / name.length > 0.4;
    if (!prefix && !near) continue;
    const score = prefix ? 0 : edits;
    if (best === undefined || score < best.score) best = { name, score };
  }
  return best?.name;
}

/** `bdp [client options] WORD ...`: the options before the first word and the words from it on,
 * or undefined when there is no word. Used to mount the Callable tree (§10), where everything
 * after the command is the Callable's own. */
export function splitLeadingWords(
  args: readonly string[],
  arities: ReadonlyMap<string, boolean>,
): { readonly client: readonly string[]; readonly words: readonly string[] } | undefined {
  const client: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    if (argument === "--") return undefined;
    if (argument.length > 1 && argument.startsWith("-")) {
      client.push(argument);
      if (!argument.includes("=") && arities.get(argument) === true && index + 1 < args.length)
        client.push(args[++index] ?? "");
      continue;
    }
    return { client, words: args.slice(index) };
  }
  return undefined;
}

/** No storage, input-file reading, credentials, or network access occurs here. */
export function createCanonicalCommand(settings: CanonicalCommandOptions): Command {
  const groups = new Map<Command, string>();
  const paths = new Map<Command, readonly string[]>();
  const registered: { owner: Command; name: string }[] = [];
  const output = settings.writeOut ?? ((text: string) => process.stdout.write(text));
  const error = settings.writeErr ?? ((text: string) => process.stderr.write(text));
  const root = new Command("bdp");

  function configure(command: Command): Command {
    return command
      .exitOverride((failure) => {
        throw Object.assign(failure, { commandPath: paths.get(command) ?? [] });
      })
      .allowExcessArguments(false)
      .showSuggestionAfterError(false)
      .configureOutput({ writeOut: output, writeErr: error })
      .configureHelp({
        formatHelp(cmd, helper) {
          const lines = [`Usage: ${helper.commandUsage(cmd)}`, "", cmd.description(), ""];
          const children = helper.visibleCommands(cmd);
          for (const group of new Set(
            children.map((child) => groups.get(child) ?? "Available Commands"),
          )) {
            lines.push(`${group}:`);
            for (const child of children.filter(
              (entry) => (groups.get(entry) ?? "Available Commands") === group,
            )) {
              lines.push(
                `  ${helper.subcommandTerm(child).padEnd(27)} ${helper.subcommandDescription(child)}`,
              );
            }
            lines.push("");
          }
          const flags = helper.visibleOptions(cmd);
          if (flags.length > 0) {
            lines.push("Flags:");
            for (const option of flags)
              lines.push(
                `  ${helper.optionTerm(option).padEnd(35)} ${helper.optionDescription(option)}`,
              );
            lines.push("");
          }
          const inherited = [];
          for (let parent = cmd.parent; parent; parent = parent.parent)
            inherited.push(...helper.visibleOptions(parent));
          if (inherited.length > 0) {
            lines.push("Global Flags:");
            for (const option of inherited)
              lines.push(
                `  ${helper.optionTerm(option).padEnd(35)} ${helper.optionDescription(option)}`,
              );
            lines.push("");
          }
          if (children.length > 0)
            lines.push(
              `Use "${cmd.name()} [command] --help" for more information about a command.`,
              "",
            );
          return lines.join("\n");
        },
      });
  }

  function flag(
    command: Command,
    [syntax, description, choices]: Flag,
    /** The same value may repeat, and two different values are refused rather than one winning. */
    agreeing = false,
  ): void {
    const option = new Option(syntax, description);
    if (choices) option.choices([...choices]);
    const name = option.attributeName();
    const repeatable = repeated.has(name);
    if (repeatable)
      option.argParser((value: string, previous: string[] = []) => [...previous, value]);
    command.addOption(option);
    registered.push({ owner: command, name });
    let count = 0;
    let held: unknown;
    command.on(`option:${option.name()}`, (value: unknown) => {
      if (agreeing) {
        if (count++ > 0 && value !== held)
          command.error(`${option.long} was given with different values`, {
            code: ACTOR_CONFLICT,
          });
        held = value;
      } else if (++count > 1 && !repeatable)
        command.error(`option '${option.long}' may only be specified once`);
    });
  }

  function add(
    parent: Command,
    name: string,
    description: string,
    group: string,
    args: readonly string[] = [],
  ): Command {
    const command = configure(new Command(name).description(description));
    groups.set(command, group);
    paths.set(command, [...(paths.get(parent) ?? []), name]);
    for (const arg of args) command.argument(arg);
    parent.addCommand(command);
    return command;
  }

  function outputFlags(command: Command, collection = false, masks = false, detail = true): void {
    flag(command, [
      "--output-format <format>",
      "Choose the output representation.",
      collection ? ["default", "detail", "table", "json", "jsonl"] : pointFormats,
    ]);
    if (detail) flag(command, long);
    if (masks) {
      flag(command, ["--include <pointer>", "Include an original-value JSON Pointer; repeatable."]);
      flag(command, ["--omit <pointer>", "Omit an optional field; repeatable."]);
    }
  }

  function writes(command: Command, emission: boolean, provenance: boolean): void {
    flag(command, ["--idempotency-key <key>", "Use this exact mutation key."]);
    flag(command, [
      "--retry-file <file>",
      "Recover the frozen invocation without changing its meaning.",
    ]);
    if (emission)
      flag(command, [
        "--dry-run-mode <mode>",
        "Emit a member or preview a request without applying it.",
        ["bdp", "batch"],
      ]);
    if (provenance) {
      flag(command, [
        "--revision-provenance <json>",
        "Supply admitted per-version provenance input.",
      ]);
      flag(command, [
        "--actor <actor>",
        "Supply caller actor input; never authentication or authority.",
      ]);
    }
    outputFlags(command);
  }

  function execute(
    command: Command,
    validate?: (options: Record<string, unknown>, args: string[], explicit: Set<string>) => void,
    operands: (command: Command) => string[] = (selected) => selected.processedArgs as string[],
  ): void {
    command.action(async () => {
      const options: Record<string, unknown> = command.optsWithGlobals();
      const ancestors = new Set<Command>();
      for (let current: Command | null = command; current; current = current.parent)
        ancestors.add(current);
      if (options.from_revision !== undefined) {
        if (options.fromRevision !== undefined)
          command.error("historical source may only be specified once");
        options.fromRevision = options.from_revision;
        delete options.from_revision;
      }
      const explicit = new Set(
        registered
          .filter(
            ({ owner, name }) => ancestors.has(owner) && owner.getOptionValueSource(name) === "cli",
          )
          .map(({ name }) => (name === "from_revision" ? "fromRevision" : name)),
      );
      const args = operands(command);
      if (options.cliProfile !== undefined && options.cliProfile !== settings.profile)
        command.error("select the CLI profile before constructing its command tree");
      if (options.retryFile !== undefined) {
        const permitted = new Set([
          "retryFile",
          "outputFormat",
          "outputMode",
          "responseContext",
          "long",
          "config",
          "cliProfile",
        ]);
        if (
          args.some((arg) => arg !== undefined) ||
          [...explicit].some((name) => !permitted.has(name))
        )
          command.error("--retry-file accepts only saved input and display controls");
      } else validate?.(options, args, explicit);
      const frozenOptions = Object.fromEntries(
        Object.entries(options).map(([name, value]) => [
          name,
          Array.isArray(value) ? Object.freeze([...value]) : value,
        ]),
      );
      await settings.onInvocation(
        Object.freeze({
          command: Object.freeze([...(paths.get(command) ?? [])]),
          positionals: Object.freeze(args.filter((arg) => arg !== undefined)),
          options: Object.freeze(frozenOptions),
          explicitOptions: Object.freeze([...explicit]),
        }),
      );
    });
  }

  /** A group given alone prints its help; given a word it does not know, it names the word and
   * the nearest command (row 2). */
  function group(command: Command, hint?: string): Command {
    // Tolerate unknown options so a stray flag (e.g. `bdp link a b --type x`) does not preempt the
    // more helpful unknown-command error below with a bare "unsupported argument".
    return command
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .action(() => {
        const word = command.args[0];
        if (word === undefined) {
          command.outputHelp();
          return;
        }
        const names = command.commands.map((child) => child.name());
        const shown = commandWord(word);
        throw new UnknownCommandError(
          paths.get(command) ?? [],
          shown,
          shown === undefined ? undefined : nearestCommand(shown, names),
          names,
          hint,
        );
      });
  }
  const fail = (command: Command, condition: boolean, message: string) => {
    if (condition) command.error(message);
  };
  configure(root)
    .description("BDP — read and change Beads and Links.")
    .version(settings.version, "--version");
  flag(root, ["--config <path>", "Load the selected startup configuration."]);
  flag(root, [
    "--cli-profile <profile>",
    "Select the CLI grammar for this invocation.",
    ["canonical", "compat"],
  ]);
  group(root);

  // Domain membership is independent of the selected CLI profile. This is the
  // existing command-specific legacy JSON spelling, never a global flag.
  const bd = group(add(root, "bd", "Bead-domain commands.", "Domain Commands"));
  const ready = add(
    bd,
    "ready",
    "Compute readiness from generic Read resources.",
    "Available Commands",
  );
  flag(ready, ["--json", "Use the existing readiness JSON representation."]);
  execute(ready);
  if (settings.profile === "compat") return root;
  flag(root, [
    "--output-mode <mode>",
    "Choose human-friendly output or JSON data.",
    ["human", "json"],
  ]);
  flag(root, [
    "--response-context",
    "Wrap JSON output in the result envelope, with the Scope's bdpVersion and specRevision.",
  ]);
  flag(root, scope);

  const connect = add(
    root,
    "connect",
    "Store the default Scope, or show the Scope in use and where it came from.",
    "Setup Commands",
    ["[url]"],
  );
  connect.summary("Store the default Scope, or show the Scope in use and where it came from.");
  connect.description(
    [
      "Store the default Scope, or show the Scope in use and where it came from.",
      "",
      "With a URL, bdp reads the Scope's BDP discovery first and stores the URL in the",
      "client configuration only when that succeeds. Alone, it prints the Scope a command",
      "would use and its source: --scope, then BDP_SCOPE_URL, then the stored Scope.",
      "--clear forgets the stored Scope.",
    ].join("\n"),
  );
  flag(connect, ["--clear", "Forget the stored Scope."]);
  outputFlags(connect, false, false, false);
  execute(connect, (options, args) => {
    fail(connect, !!options.clear && !!args[0], "connect --clear takes no URL");
  });

  const scopeGroup = group(
    add(
      root,
      "scope",
      "Discover the selected Scope; bdp connect shows which Scope is in use.",
      "Read Commands",
    ),
  );
  const setScope = add(
    scopeGroup,
    "set",
    "Set the default Scope for future commands.",
    "Read Commands",
    ["<scope>"],
  );
  outputFlags(setScope, false, false, false);
  execute(setScope);
  const inspect = add(
    scopeGroup,
    "inspect",
    "Read the advertised Scope description.",
    "Available Commands",
    ["[scope]"],
  );
  outputFlags(inspect, false, false, false);
  execute(inspect, (options, args) =>
    fail(
      inspect,
      !!args[0] && options.scope !== undefined,
      "positional Scope conflicts with --scope",
    ),
  );
  const link = group(
    add(root, "link", "Read and change Links.", "Resource Commands"),
    "To create a Link, use `bdp link create SOURCE TARGET --type TYPE`; to add a dependency, use `bdp issue dep add SOURCE TARGET --type TYPE`.",
  );
  const alias = group(add(root, "alias", "Resolve and change Scope aliases.", "Resource Commands"));

  for (const parent of [root, link]) {
    const isLink = parent === link;
    const show = add(parent, "show", "Show one current or exact Resource.", "Read Commands", [
      "<ref>",
    ]);
    flag(show, ["--properties-only", "Read the native properties view."]);
    if (!isLink) {
      flag(show, ["--include-links", "Include one bounded incident Link page."]);
      flag(show, ["--links-limit <n>", "Limit the included Link page."]);
      flag(show, [
        "--direction <direction>",
        "Choose included-Link direction.",
        ["in", "out", "both"],
      ]);
    }
    outputFlags(show, false, true);
    execute(show, (options) => {
      fail(
        show,
        !!options.propertiesOnly && !!options.includeLinks,
        "--properties-only conflicts with --include-links",
      );
      fail(
        show,
        (options.linksLimit !== undefined || options.direction !== undefined) &&
          !options.includeLinks,
        "included-Link options require --include-links",
      );
    });

    const versions = add(
      parent,
      "versions",
      `List retained History versions for one ${isLink ? "Link" : "Bead"}.`,
      "Read Commands",
      [isLink ? "<link-id>" : "<bead-id>"],
    );
    flag(versions, ["--page-size <n>", "Set the native History page size."]);
    flag(versions, ["--all", "Follow History pages to the bounded CLI traversal limit."]);
    outputFlags(versions, true, false);
    execute(versions);

    const list = add(
      parent,
      "list",
      "List one selected Resource population.",
      "Read Commands",
      isLink ? ["[source]", "[target]"] : ["[scope]"],
    );
    for (const entry of [
      ["--type <type>", "Filter by Type family."],
      ["--exact-type <type>", "Filter by nominal Type identity."],
      ["--selector <selector>", "Apply the bounded native Selector."],
      ["--paged", "Deliver one native page."],
      ["--unpaged", "Follow native pages to the delivery limit."],
      ["--page-size <n>", "Set a positive native fetch size."],
      ["--limit <n>", "Set the total delivery cap; zero removes the cap."],
      ["--continue <url>", "Resume the exact issued native next URL."],
    ] as readonly Flag[])
      flag(list, entry);
    if (isLink)
      for (const entry of [
        ["--from <ref>", "Filter the source URI."],
        ["--to <ref>", "Filter the target URI."],
        ["--endpoint <ref>", "Filter either endpoint URI."],
        ["--incident-to <bead>", "Read one Bead's incident Link population."],
        ["--direction <direction>", "Choose incidence orientation.", ["in", "out", "both"]],
        ["--all-revisions", "Ignore positional revision applicability, retaining live Links."],
      ] as readonly Flag[])
        flag(list, entry);
    outputFlags(list, true, true);
    execute(list, (options, args, explicit) => {
      fail(list, !!options.paged && !!options.unpaged, "--paged conflicts with --unpaged");
      fail(
        list,
        !isLink && !!args[0] && options.scope !== undefined,
        "positional Scope conflicts with --scope",
      );
      fail(
        list,
        isLink && !!args[0] && options.incidentTo !== undefined,
        "positional incidence conflicts with --incident-to",
      );
      fail(
        list,
        isLink && options.direction !== undefined && !args[0] && options.incidentTo === undefined,
        "--direction requires an incident or positional population",
      );
      fail(
        list,
        isLink && !!options.allRevisions && !args[0],
        "--all-revisions requires positional incidence",
      );
      if (options.continue !== undefined)
        fail(
          list,
          args.some(Boolean) ||
            [...explicit].some((name) =>
              [
                "type",
                "exactType",
                "selector",
                "from",
                "to",
                "endpoint",
                "incidentTo",
                "direction",
                "allRevisions",
              ].includes(name),
            ),
          "--continue conflicts with initial selection options",
        );
    });

    for (const operation of ["create", "update", "delete"] as const) {
      const args =
        operation === "create"
          ? isLink
            ? ["[source]", "[target]"]
            : ["[scope]"]
          : [isLink ? "[link-id]" : "[bead-id]"];
      const command = add(
        parent,
        operation,
        `${operation.charAt(0).toUpperCase()}${operation.slice(1)} one ${isLink ? "Link" : "Bead"}.`,
        "Write Commands",
        args,
      );
      if (operation !== "create")
        command.usage(`${isLink ? "<link-id>" : "<bead-id>"} | --retry-file <file>`);
      if (operation === "create") command.summary(command.description());
      if (operation === "create")
        command.description(
          [
            command.description(),
            "",
            "--type takes a short Type name, such as issue/task (a Type BDP publishes) or",
            "issue/research (the Scope's own, under its types/), or a full Type URL. The",
            "Scope and the Type decide which properties are required and what a",
            "supplied --id must look like; this client knows neither. Supply properties with",
            "--properties, and omit --id to let the Scope allocate one. A refusal lists what",
            "the Scope says is missing or wrong.",
          ].join("\n"),
        );
      if (operation !== "delete") {
        flag(command, ["--type <type>", "Set the whole Type Reference."]);
        for (const entry of operation === "create" ? objectFlags : editFlags) flag(command, entry);
      }
      if (operation === "create") {
        flag(command, ["--id <id>", "Supply the complete literal local identity."]);
        flag(command, ["--id-root <root>", "Request supported service-side rooted allocation."]);
        flag(command, ["--batch-bind <name>", "Name this creation in batch-member emission."]);
      } else
        flag(command, ["--if-revision <token>", "Guard with this exact opaque token, unchanged."]);
      if (!isLink && operation === "update") {
        flag(command, ["--from-revision <revision>", "Source editable content from N or =TOKEN."]);
        flag(command, ["--from_revision <revision>", "Alias for --from-revision."]);
      }
      if (isLink && operation !== "delete") {
        flag(command, ["--from <ref>", "Set the complete source Reference."]);
        flag(command, ["--to <ref>", "Set the complete target Reference."]);
      }
      if (operation === "delete")
        flag(command, ["--force", "Apply deletion; otherwise preview the Resource."]);
      writes(command, true, operation !== "delete" || isLink);
      execute(command, (options, positionals, explicit) => {
        if (operation === "create") {
          fail(command, options.type === undefined, "--type is required for creation");
          fail(
            command,
            options.id !== undefined && options.idRoot !== undefined,
            "--id conflicts with --id-root",
          );
          fail(
            command,
            !isLink && !!positionals[0] && options.scope !== undefined,
            "positional Scope conflicts with --scope",
          );
          if (isLink) {
            const positional = positionals.filter((arg) => arg !== undefined).length;
            const valid =
              (positional === 2 && options.from === undefined && options.to === undefined) ||
              (positional === 1 && options.from === undefined && options.to !== undefined) ||
              (positional === 0 && options.from !== undefined && options.to !== undefined);
            fail(
              command,
              !valid,
              "bind Link endpoints once: SOURCE TARGET, SOURCE --to TARGET, or --from SOURCE --to TARGET",
            );
          }
        } else fail(command, !positionals[0], "a Resource reference is required");
        if (operation === "update")
          fail(
            command,
            ![
              "type",
              "from",
              "to",
              ...(!isLink ? ["fromRevision"] : []),
              ...editFlags.map(([syntax]) => new Option(syntax).attributeName()),
            ].some((name) => explicit.has(name)),
            "update requires a mutation input",
          );
        if (options.batchBind !== undefined)
          fail(
            command,
            options.dryRunMode !== "batch",
            "--batch-bind requires --dry-run-mode batch",
          );
        if (options.dryRunMode !== undefined)
          fail(
            command,
            ["outputFormat", "outputMode", "responseContext", "long", "idempotencyKey"].some(
              (name) => explicit.has(name),
            ),
            "emission conflicts with display controls and execution keys",
          );
        if (operation === "delete" && !options.force)
          fail(
            command,
            ["ifRevision", "revisionProvenance", "actor", "idempotencyKey", "dryRunMode"].some(
              (name) => explicit.has(name),
            ),
            "mutation inputs require --force on deletion",
          );
      });
    }
  }

  for (const operation of ["resolve", "put", "delete"] as const) {
    const command = add(alias, operation, `${operation} one Scope alias.`, "Available Commands", [
      operation === "resolve" ? "<name>" : "[name]",
    ]);
    if (operation === "resolve") outputFlags(command, false, false, false);
    else {
      if (operation === "put")
        flag(command, ["--target <ref>", "Set the canonical in-Scope unpinned Bead target."]);
      else flag(command, ["--force", "Apply alias deletion; no Resource preview exists."]);
      writes(command, false, false);
    }
    execute(command, (options, args) => {
      fail(command, !args[0], "an alias name is required");
      if (operation === "put") fail(command, options.target === undefined, "--target is required");
      if (operation === "delete") fail(command, !options.force, "alias deletion requires --force");
    });
  }

  const batch = add(
    root,
    "batch",
    "Apply or emit one selected six-CRUD atomic batch.",
    "Write Commands",
    ["[scope]"],
  );
  flag(batch, ["--file <file>", "Read one complete member file; '-' means stdin."]);
  flag(batch, [
    "--input-format <format>",
    "Select JSONL members or native JSON.",
    ["json", "jsonl"],
  ]);
  flag(batch, ["--batch-version <version>", "Select the supported JSONL encoder.", ["1"]]);
  writes(batch, true, false);
  execute(batch, (options, args, explicit) => {
    fail(batch, options.file === undefined, "--file is required");
    fail(
      batch,
      !!args[0] && options.scope !== undefined,
      "positional Scope conflicts with --scope",
    );
    fail(
      batch,
      options.inputFormat === "json" && explicit.has("batchVersion"),
      "native JSON carries its own version; --batch-version conflicts",
    );
    fail(
      batch,
      options.dryRunMode !== undefined &&
        ["outputFormat", "outputMode", "responseContext", "long", "idempotencyKey"].some((name) =>
          explicit.has(name),
        ),
      "emission conflicts with display controls and execution keys",
    );
  });

  const call = add(root, "call", "Invoke a named Callable.", "Callable Commands", ["[name]"])
    .usage("[NAME] [--arguments JSON] [client options]")
    .allowExcessArguments(true)
    .allowUnknownOption(true);
  flag(call, ["--arguments <json>", "The Callable's arguments, as one JSON object."]);
  flag(call, ["--idempotency-key <key>", "Use this exact key on a CallableBatch."]);
  flag(call, ["--revision-provenance <json>", "Supply admitted per-version provenance input."]);
  flag(
    call,
    ["--actor <actor>", "Supply caller actor input; never authentication or authority."],
    true,
  );
  outputFlags(call, false, false, false);
  execute(call, undefined, (selected) => selected.args);
  for (const { name, description } of settings.callableGroups ?? [])
    group(add(root, name, description, "Callable Commands"));
  return root;
}
