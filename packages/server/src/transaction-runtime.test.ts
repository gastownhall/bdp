import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, expect, it } from "vitest";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const token = "x".repeat(32),
  type = "https://example.test/process-bead";
it("reopens actual emitted HTTP service after abrupt process loss with the exact original receipt", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-http-process-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  async function start(create: boolean, port: number) {
    const runtime = new URL("../dist/transaction-runtime.js", import.meta.url).href;
    const options = {
      directory,
      create,
      port,
      types: [{ id: type, name: "Process Bead", describes: "bead", conformsTo: [] }],
      credentials: [{ token, principal: "operator", canMutate: true }],
    };
    const script = `import {startTransactionRuntime} from ${JSON.stringify(runtime)};const runtime=await startTransactionRuntime(${JSON.stringify(options)});process.stdout.write(JSON.stringify({scope:runtime.scope,targets:runtime.targets})+'\\n');process.stdin.once('data',async()=>{await runtime.close();process.exit(0)});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exited = once(child, "exit");
    void exited.catch(() => {});
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    });
    const lines = createInterface({ input: child.stdout });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const line = await Promise.race([
      once(lines, "line").then(([line]) => String(line)),
      exited.then(() => {
        throw new Error(`child exited before ready: ${stderr}`);
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`child readiness timeout: ${stderr}`)), 5000);
      }),
    ]).finally(() => {
      clearTimeout(timeout);
      lines.close();
    });
    const ready = JSON.parse(line) as { scope: string; targets: { batch: string } };
    return { child, exited, ready };
  }
  const first = await start(true, 0);
  const text = JSON.stringify({ operations: [{ operation: "createBead", id: "beads/a", type }] });
  const submit = (target: string) =>
    fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": "once",
      },
      body: text,
    });
  const original = await submit(first.ready.targets.batch);
  expect(original.status).toBe(200);
  const receipt = (await original.json()) as { id: string };
  first.child.kill("SIGKILL");
  const exit = await first.exited;
  expect(exit[1]).toBe("SIGKILL");
  const second = await start(false, Number(new URL(first.ready.scope).port));
  const retry = await submit(second.ready.targets.batch);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(receipt);
  expect(retry.headers.get("bdp-scope-position")).toBe("pos-1");
  const read = await fetch(receipt.id, { headers: { authorization: `Bearer ${token}` } });
  expect(await read.json()).toEqual(receipt);
  second.child.stdin.write("close\n");
  expect((await second.exited)[0]).toBe(0);
}, 15000);
