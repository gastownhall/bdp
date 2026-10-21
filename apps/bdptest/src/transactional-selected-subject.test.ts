/** NEW carrier-only binding tests; synthetic files are not installed qualification. */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  selectedTransactionSubject,
  assertSelectedTransactionPayload,
  verifySelectedTransactionModules,
  loadSelectedTransactionSubject,
} from "../test-support/transactional-selected-subject.js";
const source = "a".repeat(40),
  payload = "c".repeat(64);
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function withTree(
  run: (tree: {
    root: string;
    installed: string;
    bindingPath: string;
    input: any;
    marker: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "bdp-tx-selection-unit-")),
    errors: unknown[] = [];
  try {
    const installed = path.join(root, "server/dist"),
      marker = path.join(root, "payload-imported");
    await mkdir(installed, { recursive: true });
    await mkdir(path.join(root, "protocol/schemas"), { recursive: true });
    await writeFile(path.join(root, "server/package.json"), '{"type":"module"}');
    const bodies = {
      "transaction-installed-process.js":
        'throw Error("native entry must never execute in binding unit");\n',
      "installed-payload.js": `import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'synthetic payload import'); export async function installedPayloadIdentity(){return '${payload}';}\n`,
      "bdp-v0.schema.json": '{"unit":true}\n',
    };
    const moduleBindings = [];
    for (const [name, text] of Object.entries(bodies)) {
      const b = Buffer.from(text);
      await writeFile(
        name.endsWith(".js")
          ? path.join(installed, name)
          : path.join(root, "protocol/schemas", name),
        b,
      );
      moduleBindings.push({ name, bytes: b.length, sha256: digest(b) });
    }
    const input = { actualCompiledSource: source, payloadIdentity: payload, moduleBindings },
      bindingPath = path.join(root, "subject.json");
    await writeFile(bindingPath, JSON.stringify(input));
    await run({ root, installed, input, bindingPath, marker });
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await rm(root, { recursive: true, force: true });
      await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "selected-subject unit/finalization failed");
}
it("NEW selected TX subject requires complete explicit source payload and unique safe module declarations", async () => {
  await withTree(async ({ input }) => {
    const selected = selectedTransactionSubject(input);
    expect(selected.actualCompiledSource).toBe(source);
    expect(selected.payloadIdentity).toBe(payload);
    expect(Object.isFrozen(selected.moduleBindings)).toBe(true);
    assertSelectedTransactionPayload(selected, payload);
    expect(() => assertSelectedTransactionPayload(selected, "d".repeat(64))).toThrow("differs");
    for (const value of [undefined, "HEAD", "a".repeat(39), "A".repeat(40)])
      expect(() => selectedTransactionSubject({ ...input, actualCompiledSource: value })).toThrow(
        "compiled source",
      );
    for (const value of [undefined, "c".repeat(63), "C".repeat(64)])
      expect(() => selectedTransactionSubject({ ...input, payloadIdentity: value })).toThrow(
        "payload identity",
      );
    for (const moduleBindings of [
      [],
      input.moduleBindings.slice(1),
      [...input.moduleBindings, input.moduleBindings[0]],
      [{ ...input.moduleBindings[0], name: "../escape.js" }, ...input.moduleBindings.slice(1)],
      [{ ...input.moduleBindings[0], bytes: -1 }, ...input.moduleBindings.slice(1)],
      [{ ...input.moduleBindings[0], sha256: "bad" }, ...input.moduleBindings.slice(1)],
    ])
      expect(() => selectedTransactionSubject({ ...input, moduleBindings })).toThrow();
  });
});
it("NEW selected TX module checks reject missing extra changed and schema bodies before payload import", async () => {
  await withTree(async ({ root, installed, input, marker }) => {
    const selected = selectedTransactionSubject(input);
    await verifySelectedTransactionModules(installed, selected);
    const entry = path.join(installed, "transaction-installed-process.js"),
      original = await readFile(entry);
    await writeFile(entry, Buffer.from(original.toString().replace("native", "NATIVE")));
    await expect(verifySelectedTransactionModules(installed, selected)).rejects.toThrow(
      "body mismatch",
    );
    await writeFile(entry, original);
    await writeFile(path.join(installed, "extra.js"), "");
    await expect(verifySelectedTransactionModules(installed, selected)).rejects.toThrow(
      "population differs",
    );
    await rm(path.join(installed, "extra.js"));
    await rm(entry);
    await expect(verifySelectedTransactionModules(installed, selected)).rejects.toThrow(
      "population differs",
    );
    await writeFile(entry, original);
    await writeFile(path.join(root, "protocol/schemas/bdp-v0.schema.json"), "{}");
    await expect(verifySelectedTransactionModules(installed, selected)).rejects.toThrow(
      "body mismatch",
    );
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
it("NEW selected TX loader refuses bad selection before import and verifies payload before returning launch inputs", async () => {
  await withTree(async ({ input, installed, bindingPath, marker }) => {
    await writeFile(bindingPath, JSON.stringify({ ...input, actualCompiledSource: "HEAD" }));
    await expect(loadSelectedTransactionSubject(bindingPath, installed)).rejects.toThrow(
      "compiled source",
    );
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(bindingPath, JSON.stringify(input));
    const selected = await loadSelectedTransactionSubject(bindingPath, installed);
    expect(selected.actualCompiledSource).toBe(source);
    expect(await readFile(marker, "utf8")).toBe("synthetic payload import");
    await writeFile(bindingPath, JSON.stringify({ ...input, payloadIdentity: "d".repeat(64) }));
    await expect(loadSelectedTransactionSubject(bindingPath, installed)).rejects.toThrow(
      "payload differs",
    );
  });
});
