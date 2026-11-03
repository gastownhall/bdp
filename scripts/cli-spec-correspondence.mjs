import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createCanonicalCommand } from "../apps/bdp/src/canonical-command.ts";

export const commandPaths = [
  "create",
  "update",
  "delete",
  "link create",
  "link update",
  "link delete",
  "alias put",
  "alias delete",
];
const globalFlags = new Map([
  ["--version", false],
  ["--config", true],
  ["--cli-profile", true],
  ["--scope", true],
]);
const toolingFlags = new Set(["--version", "--config", "--cli-profile"]);

export function commandTree() {
  return createCanonicalCommand({
    version: "correspondence-check",
    profile: "canonical",
    onInvocation() {
      throw new Error("Correspondence check must not execute commands");
    },
    writeOut() {},
    writeErr() {},
  });
}

function section(lines, heading, level) {
  const indices = lines.flatMap((line, i) => (line.trim() === heading ? [i] : []));
  if (indices.length !== 1)
    throw new Error(`Expected exactly one ${heading}; found ${indices.length}`);
  const start = indices[0] + 1;
  let end = start;
  while (end < lines.length && !new RegExp(`^#{1,${level}} `).test(lines[end])) end++;
  return lines.slice(start, end);
}

export function documentedFlags(markdown, path) {
  const command = section(markdown.split(/\r?\n/), `#### \`bd ${path}\``, 4);
  const flags = section(command, "##### Flags", 5).filter((line) => line.trim() !== "");
  if (
    !/^\|\s*Flag\s*\|\s*Default\s*\|\s*Meaning\s*\|$/.test(flags[0] ?? "") ||
    !/^\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|$/.test(flags[1] ?? "")
  ) {
    throw new Error(`${path}: malformed Flags table header`);
  }
  const result = new Map();
  for (const row of flags.slice(2)) {
    const cell = /^\|\s*([^|]+)\|/.exec(row)?.[1].trim();
    if (!cell || !/^`[^`]+`(?:,\s*`[^`]+`)*$/.test(cell)) {
      throw new Error(`${path}: malformed flag row: ${row}`);
    }
    for (const spelling of cell.split(/,\s*/)) {
      const match = /^`(--[a-z][a-z0-9_-]*)(?: ([A-Z][A-Z0-9_=]*))?`$/.exec(spelling);
      if (!match) throw new Error(`${path}: malformed flag spelling ${spelling}`);
      if (result.has(match[1])) throw new Error(`${path}: duplicate flag ${match[1]}`);
      result.set(match[1], match[2] !== undefined);
    }
  }
  if (!result.size) throw new Error(`${path}: empty Flags table`);
  return result;
}

function compare(expected, actual, context) {
  for (const [flag, valued] of expected) {
    if (!actual.has(flag)) throw new Error(`${context}: documented ${flag} is not registered`);
    if (actual.get(flag) !== valued) throw new Error(`${context}: ${flag} argument arity differs`);
  }
  for (const flag of actual.keys()) {
    if (!expected.has(flag)) throw new Error(`${context}: registered ${flag} is undocumented`);
  }
}

export function checkCorrespondence(markdown, root = commandTree()) {
  const options = (node) => {
    const result = new Map();
    for (const option of node.options) {
      if (option.short) throw new Error(`Undocumented short spelling ${option.short}`);
      if (!option.long || result.has(option.long))
        throw new Error(`Missing or duplicate registered long flag ${option.long}`);
      result.set(option.long, option.required || option.optional);
    }
    return result;
  };
  compare(globalFlags, options(root), "root globals");
  for (const path of commandPaths) {
    let node = root;
    for (const name of path.split(" ")) {
      const matches = node.commands.filter((command) => command.name() === name);
      if (matches.length !== 1) throw new Error(`${path}: expected one registered command ${name}`);
      node = matches[0];
    }
    const actual = new Map();
    for (let current = node; current; current = current.parent) {
      for (const [flag, valued] of options(current)) {
        if (current === root && toolingFlags.has(flag)) continue;
        if (actual.has(flag)) throw new Error(`${path}: duplicate registered flag ${flag}`);
        actual.set(flag, valued);
      }
    }
    compare(documentedFlags(markdown, path), actual, path);
  }
  return commandPaths.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const markdown = await readFile(
    new URL("../docs/cli-design/bdp-cli.md", import.meta.url),
    "utf8",
  );
  console.log(
    `CLI flag correspondence: ${checkCorrespondence(markdown)} singleton mutation commands`,
  );
}
