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
      .exitOverride()
      .allowExcessArguments(false)
      .showSuggestionAfterError(false)
      .configureOutput({ writeOut: output, writeErr: error })
      .configureHelp({
        formatHelp(cmd, helper) {
          const lines = [cmd.description(), "", "Usage:", `  ${helper.commandUsage(cmd)}`, ""];
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

  function flag(command: Command, [syntax, description, choices]: Flag): void {
    const option = new Option(syntax, description);
    if (choices) option.choices([...choices]);
    const name = option.attributeName();
    const repeatable = repeated.has(name);
    if (repeatable)
      option.argParser((value: string, previous: string[] = []) => [...previous, value]);
    command.addOption(option);
    registered.push({ owner: command, name });
    let count = 0;
    command.on(`option:${option.name()}`, () => {
      if (++count > 1 && !repeatable)
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
      flag(command, ["--omit <pointer>", "Omit an optional field, or envelope; repeatable."]);
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
  ): void {
    command.action(async () => {
      const options: Record<string, unknown> = command.optsWithGlobals();
      const ancestors = new Set<Command>();
      for (let current: Command | null = command; current; current = current.parent)
        ancestors.add(current);
      const explicit = new Set(
        registered
          .filter(
            ({ owner, name }) => ancestors.has(owner) && owner.getOptionValueSource(name) === "cli",
          )
          .map(({ name }) => name),
      );
      const args = command.processedArgs as string[];
      if (options.cliProfile !== undefined && options.cliProfile !== settings.profile)
        command.error("select the CLI profile before constructing its command tree");
      if (options.retryFile !== undefined) {
        const permitted = new Set(["retryFile", "outputFormat", "long", "config", "cliProfile"]);
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
  root.action(() => root.outputHelp());

  // Domain membership is independent of the selected CLI profile. This is the
  // existing command-specific legacy JSON spelling, never a global flag.
  const bd = add(root, "bd", "Bead-domain commands.", "Domain Commands");
  const ready = add(
    bd,
    "ready",
    "Compute readiness from generic Read resources.",
    "Available Commands",
  );
  flag(ready, ["--json", "Use the existing readiness JSON representation."]);
  execute(ready);
  if (settings.profile === "compat") return root;
  flag(root, scope);

  const scopeGroup = add(root, "scope", "Discover the selected Scope.", "Read Commands");
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
  const link = add(root, "link", "Read and change Links.", "Resource Commands");
  const alias = add(root, "alias", "Resolve and change Scope aliases.", "Resource Commands");

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
        operation === "create" ? (isLink ? ["[source]", "[target]"] : ["[scope]"]) : ["[ref]"];
      const command = add(
        parent,
        operation,
        `${operation.charAt(0).toUpperCase()}${operation.slice(1)} one ${isLink ? "Link" : "Bead"}.`,
        "Write Commands",
        args,
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
            ["outputFormat", "long", "idempotencyKey"].some((name) => explicit.has(name)),
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
        ["outputFormat", "long", "idempotencyKey"].some((name) => explicit.has(name)),
      "emission conflicts with display controls and execution keys",
    );
  });
  return root;
}
