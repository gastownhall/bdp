import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkCallCorrespondence,
  checkCorrespondence,
  commandTree,
} from "./cli-spec-correspondence.mjs";

const markdown = await readFile(new URL("../docs/cli-design/bdp-cli.md", import.meta.url), "utf8");
const outputDocs = await readFile(
  new URL("../docs/cli-design/read-output.md", import.meta.url),
  "utf8",
);
const actorRow = markdown.split("\n").find((line) => line.startsWith("| `--actor ACTOR`"));
const scopeRow = markdown.split("\n").find((line) => line.startsWith("| `--scope SCOPE`"));

test("authored singleton mutation flags match the actual parser in both directions", () => {
  assert.equal(checkCorrespondence(markdown), 8);
});
test("the call section's client flags match the actual parser in both directions", () => {
  assert.equal(checkCallCorrespondence(markdown), 1);
  const start = markdown.indexOf("#### `bd call`");
  const before = markdown.slice(0, start);
  const section = markdown.slice(start);
  const row = section.split("\n").find((line) => line.startsWith("| `--idempotency-key KEY`"));
  assert.throws(
    () => checkCallCorrespondence(before + section.replace(`${row}\n`, "")),
    /call: registered --idempotency-key is undocumented/,
  );
  assert.throws(
    () =>
      checkCallCorrespondence(
        before + section.replace(row, `${row}\n| \`--retry-file FILE\` | Off | Invented. |`),
      ),
    /call: documented --retry-file is not registered/,
  );
});
test("the call section matches Callables §10's form and keeps its mismatch row open", async () => {
  const section = markdown.slice(
    markdown.indexOf("#### `bd call`"),
    markdown.indexOf("### Deferred command surfaces"),
  );
  for (const form of [
    "bd call NAME [--arguments JSON] [CLIENT-OPTIONS]",
    "`--kebab-name`",
    "`--flag` and `--no-flag`",
    "The flag repeats",
    "parsed as JSON",
    "`--arguments JSON`",
    "never substitutes a default, on either",
    "bd [CLIENT-OPTIONS] WORD... [CALLABLE-ARGUMENTS]",
    "A built-in command wins any collision",
    "`cliMapping.fromFile`",
    "`cliMapping.memberFlags`",
    "never reads `cliMapping`",
    "`--actor ACTOR` is attribution on both forms and in any position",
    "two different values\nare refused",
    "A parameter named `actor` derives no flag",
  ])
    assert(section.includes(form), form);
  assert(!markdown.includes("cliMapping.defaults"), "cliMapping.defaults no longer exists");
  const mismatches = await readFile(
    new URL("../docs/spec-review/cli-mismatches.md", import.meta.url),
    "utf8",
  );
  assert.match(mismatches, /^\| CLI-09 \| \*\*Open /m);
});
test("the --actor paragraph registers it on tree commands", () => {
  const start = markdown.indexOf("The only imported product global is `--actor ACTOR`");
  const paragraph = markdown.slice(start, markdown.indexOf("\n\n", start));
  assert.match(paragraph, /every command the \[Callable tree\]\(#bd-call\)\s+mounts/);
  assert.doesNotMatch(paragraph, /not registered/);
});
test("global output-mode option is described in the authored CLI contract", () => {
  assert.match(markdown, /global `--output-mode human\|json`/);
  assert.match(markdown, /global `--response-context`/);
  assert.match(outputDocs, /Use `--output-mode human\|json` to select the overall presentation/);
});
test("missing authored actor is detected", () => {
  assert.throws(
    () => checkCorrespondence(markdown.replace(actorRow + "\n", "")),
    /create: registered --actor is undocumented/,
  );
});
test("invented delete actor is detected", () => {
  const changed = markdown.replace("#### `bd delete`", "#### `bd delete`\n");
  const start = changed.indexOf("#### `bd delete`");
  const before = changed.slice(0, start);
  const after = changed.slice(start).replace(scopeRow, scopeRow + "\n" + actorRow);
  assert.throws(
    () => checkCorrespondence(before + after),
    /delete: documented --actor is not registered/,
  );
});
test("compatibility spelling omission is detected", () => {
  assert.throws(
    () => checkCorrespondence(markdown.replace("`, `--from_revision REV`", "`")),
    /--from_revision is undocumented/,
  );
});
test("argument arity drift is detected", () => {
  assert.throws(
    () =>
      checkCorrespondence(
        markdown.replace(actorRow, actorRow.replace("`--actor ACTOR`", "`--actor`")),
      ),
    /--actor argument arity differs/,
  );
});
test("duplicate authored rows are refused", () => {
  assert.throws(
    () => checkCorrespondence(markdown.replace(actorRow, actorRow + "\n" + actorRow)),
    /duplicate flag --actor/,
  );
});
test("missing and duplicate command headings are refused", () => {
  assert.throws(
    () => checkCorrespondence(markdown.replace("#### `bd create`", "#### Removed")),
    /exactly one.*bd create/,
  );
  assert.throws(() => checkCorrespondence(markdown + "\n#### `bd create`\n"), /found 2/);
});
test("malformed authored flag rows are refused", () => {
  assert.throws(
    () => checkCorrespondence(markdown.replace(actorRow, "| --actor ACTOR | Off | Malformed |")),
    /malformed flag row/,
  );
});
test("new root options cannot hide behind global exemptions", () => {
  const root = commandTree().option("--surprise");
  assert.throws(
    () => checkCorrespondence(markdown, root),
    /root globals: registered --surprise is undocumented/,
  );
});
test("new actual command options require authored correspondence", () => {
  const root = commandTree();
  root.commands.find((command) => command.name() === "create").option("--surprise");
  assert.throws(
    () => checkCorrespondence(markdown, root),
    /create: registered --surprise is undocumented/,
  );
});

test("undocumented short aliases cannot hide on a documented long option", () => {
  for (const rootOption of [false, true]) {
    const root = commandTree();
    const node = rootOption ? root : root.commands.find((command) => command.name() === "create");
    const option = node.options.find(
      (option) => option.long === (rootOption ? "--scope" : "--actor"),
    );
    option.short = "-a";
    assert.throws(() => checkCorrespondence(markdown, root), /Undocumented short spelling -a/);
  }
});
test("duplicate actual option registrations fail instead of collapsing into a map", () => {
  const root = commandTree();
  root.options.push(root.options[0]);
  assert.throws(() => checkCorrespondence(markdown, root), /duplicate registered long flag/);
});
