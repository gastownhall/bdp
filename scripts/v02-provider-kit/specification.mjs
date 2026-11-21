import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hash, HarnessError } from "./transport.mjs";
const root = new URL("../../", import.meta.url);
export function harvest(text) {
  const lines = text.split("\n"),
    points = [];
  let heading = "",
    n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      heading = lines[i].slice(3);
      n = 0;
    }
    if (!lines[i].startsWith("/// normative:")) continue;
    let statement = lines[i].slice(15);
    for (let j = i + 1; j < lines.length && /^\/\/\/\s{2,}/.test(lines[j]); j++)
      statement += `\n${lines[j].replace(/^\/\/\/\s*/, "")}`;
    points.push({ anchor: `${heading}#${++n}`, line: i + 1, sha256: hash(statement), statement });
  }
  return points;
}
export async function loadCoverage() {
  const manifest = JSON.parse(await readFile(new URL("coverage.json", import.meta.url), "utf8")),
    points = [],
    inputs = { specificationCommit: manifest.commit, files: {} };
  for (const [file, pin] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(file, root)),
      sha256 = hash(bytes);
    if (sha256 !== pin.sha256)
      throw new HarnessError(
        "Spec changed: review and update the clause coverage manifest before qualification",
      );
    inputs.files[file] = sha256;
    const actual = harvest(bytes.toString());
    if (actual.length !== pin.points.length)
      throw new HarnessError("Normative clause census changed");
    for (let i = 0; i < actual.length; i++) {
      const want = pin.points[i],
        got = actual[i];
      if (
        got.anchor !== want.anchor ||
        got.sha256 !== want.sha256 ||
        !Array.isArray(want.checks) ||
        !want.checks.length
      )
        throw new HarnessError("Normative clause has no reviewed executable mapping");
      points.push({
        id: (file.includes("stdlib") ? "stdlib:" : "core:") + got.anchor,
        source: `${file}#L${got.line}`,
        statement: got.statement,
        checks: want.checks,
        ...(want.appliesWhen ? { appliesWhen: want.appliesWhen } : {}),
      });
    }
  }
  for (const item of manifest.appendixE)
    points.push({
      id: `appendix-e:${item.number}`,
      source: "specs/src/core/core.lumen#appendix-e",
      statement: item.statement,
      checks: item.checks,
      ...(item.appliesWhen ? { appliesWhen: item.appliesWhen } : {}),
    });
  inputs.toolingFiles = {};
  for (const file of [
    "runner.mjs",
    "contract.mjs",
    "evaluate.mjs",
    "transport.mjs",
    "specification.mjs",
    "../v02-provider-kit.mjs",
  ])
    inputs.toolingFiles[file] = hash(await readFile(new URL(file, import.meta.url)));
  inputs.runtime = {
    node: process.version,
    ajv: createRequire(import.meta.url)("ajv/package.json").version,
  };
  inputs.runnerSha256 = inputs.toolingFiles["runner.mjs"];
  inputs.coverageSha256 = hash(JSON.stringify(manifest));
  return { inputs, points };
}
export function qualify(report, expected = {}) {
  const census = (rows, ids) =>
    Array.isArray(ids) &&
    ids.length > 0 &&
    rows.length === ids.length &&
    new Set(rows.map((r) => r.id)).size === ids.length &&
    rows.every((r) => ids.includes(r.id));
  const all = [...report.obligations, ...(report.normative ?? [])];
  report.qualificationComplete =
    census(report.obligations, expected.executionIds) &&
    census(report.normative ?? [], expected.normativeIds) &&
    report.obligations.every((r) =>
      r.state === "not-applicable" ? r.required === false : r.required === true,
    ) &&
    all.every((r) => ["pass", "not-applicable"].includes(r.state)) &&
    report.lifecycle.provision === "pass" &&
    report.lifecycle.cleanup === "pass";
  report.claimEligible = report.qualificationComplete;
  report.state =
    report.lifecycle.cleanup === "harness-error" || all.some((r) => r.state === "harness-error")
      ? "harness-error"
      : all.some((r) => r.state === "fail")
        ? "fail"
        : report.qualificationComplete
          ? "pass"
          : "incomplete";
  report.exitCode =
    report.state === "pass"
      ? 0
      : report.state === "fail"
        ? 1
        : report.state === "harness-error"
          ? 3
          : 2;
  return report;
}
