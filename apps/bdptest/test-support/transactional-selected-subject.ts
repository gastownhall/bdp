/** Test-carrier selection only; no runtime identity formula or public authority. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type SelectedTransactionSubject = Readonly<{
  actualCompiledSource: string;
  payloadIdentity: string;
  moduleBindings: readonly Readonly<{ name: string; bytes: number; sha256: string }>[];
}>;
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
export function selectedTransactionSubject(value: unknown): SelectedTransactionSubject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("explicit selected Transactional subject required");
  const input = value as Record<string, unknown>;
  if (
    typeof input.actualCompiledSource !== "string" ||
    !/^[a-f0-9]{40}$/.test(input.actualCompiledSource)
  )
    throw Error("full selected compiled source required");
  if (typeof input.payloadIdentity !== "string" || !/^[a-f0-9]{64}$/.test(input.payloadIdentity))
    throw Error("explicit selected payload identity required");
  if (!Array.isArray(input.moduleBindings) || input.moduleBindings.length === 0)
    throw Error("complete selected module bindings required");
  const names = new Set<string>();
  const moduleBindings = input.moduleBindings.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw Error("module binding required");
    const m = row as Record<string, unknown>;
    if (
      Object.keys(m).sort().join() !== "bytes,name,sha256" ||
      typeof m.name !== "string" ||
      !(m.name === "bdp-v0.schema.json" || /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.js$/.test(m.name)) ||
      names.has(m.name) ||
      typeof m.bytes !== "number" ||
      !Number.isSafeInteger(m.bytes) ||
      m.bytes < 0 ||
      typeof m.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(m.sha256)
    )
      throw Error("invalid or duplicate selected module binding");
    names.add(m.name);
    return Object.freeze({ name: m.name, bytes: m.bytes, sha256: m.sha256 });
  });
  for (const name of [
    "transaction-installed-process.js",
    "installed-payload.js",
    "bdp-v0.schema.json",
  ])
    if (!names.has(name)) throw Error("selected entry payload algorithm and schema required");
  return Object.freeze({
    actualCompiledSource: input.actualCompiledSource,
    payloadIdentity: input.payloadIdentity,
    moduleBindings: Object.freeze(moduleBindings),
  });
}
export function assertSelectedTransactionPayload(
  subject: SelectedTransactionSubject,
  observed: unknown,
) {
  if (observed !== subject.payloadIdentity)
    throw Error("installed payload differs from explicit selected subject");
}
export async function verifySelectedTransactionModules(
  installed: string,
  subject: SelectedTransactionSubject,
) {
  const actual = (await readdir(installed)).filter((name) => name.endsWith(".js")).sort();
  const expected = subject.moduleBindings
    .filter((m) => m.name.endsWith(".js"))
    .map((m) => m.name)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error("installed module population differs from selected subject");
  for (const m of subject.moduleBindings) {
    const raw = await readFile(
      m.name.endsWith(".js")
        ? path.join(installed, m.name)
        : path.join(installed, "../../protocol/schemas/bdp-v0.schema.json"),
    );
    if (raw.length !== m.bytes || sha(raw) !== m.sha256)
      throw Error(`installed selected body mismatch: ${m.name}`);
  }
}
export async function loadSelectedTransactionSubject(bindingPath: string, installed: string) {
  const subject = selectedTransactionSubject(JSON.parse(await readFile(bindingPath, "utf8")));
  await verifySelectedTransactionModules(installed, subject);
  // Invoke only the verified installed dependency-closure algorithm. This also
  // catches non-server package changes before any native owner is launched.
  const payload = (await import(
    pathToFileURL(path.join(installed, "installed-payload.js")).href
  )) as {
    installedPayloadIdentity(): Promise<string>;
  };
  assertSelectedTransactionPayload(subject, await payload.installedPayloadIdentity());
  return subject;
}
