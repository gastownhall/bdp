import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkCorrespondence, commandTree } from "./cli-spec-correspondence.mjs";

const markdown = await readFile(new URL("../docs/cli-design/bdp-cli.md", import.meta.url), "utf8");
const actorRow = markdown.split("\n").find((line) => line.startsWith("| `--actor ACTOR`"));
const scopeRow = markdown.split("\n").find((line) => line.startsWith("| `--scope SCOPE`"));

test("authored singleton mutation flags match the actual parser in both directions", () => {
  assert.equal(checkCorrespondence(markdown), 8);
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
