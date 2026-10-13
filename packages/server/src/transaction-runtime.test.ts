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
it.each([false, true])(
  "reopens actual emitted HTTP service after abrupt process loss (durable pages=%s)",
  async (pages) => {
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-http-process-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    async function start(create: boolean, port: number) {
      const runtime = new URL("../dist/transaction-runtime.js", import.meta.url).href;
      const options = {
        directory,
        ...(pages ? { scope: "https://example.test/stable/pages/" } : {}),
        create,
        port,
        types: [{ id: type, name: "Process Bead", describes: "bead", conformsTo: [] }],
        credentials: [{ token, principal: "operator", canMutate: true }],
      };
      const script = `import {startTransactionRuntime} from ${JSON.stringify(runtime)};const runtime=await startTransactionRuntime(${JSON.stringify(options)},${JSON.stringify({ receiptMaximumItems: 2 })});process.stdout.write(JSON.stringify({scope:runtime.scope,targets:runtime.targets,listenUrl:runtime.listenUrl})+'\\n');process.stdin.once('data',async()=>{await runtime.close();process.exit(0)});`;
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
      const ready = JSON.parse(line) as {
        scope: string;
        targets: { batch: string };
        listenUrl: string;
      };
      return { child, exited, ready };
    }
    const first = await start(true, 0);
    const text = JSON.stringify({
      operations: Array.from({ length: pages ? 5 : 1 }, (_, n) => ({
        operation: "createBead",
        id: `beads/b${n}`,
        type,
      })),
    });
    const wire = (url: string, ready: { listenUrl: string }) =>
      new URL(new URL(url).pathname, ready.listenUrl).href;
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
    const original = await submit(wire(first.ready.targets.batch, first.ready));
    expect(original.status).toBe(200);
    const receipt = (await original.json()) as { id: string; next: string | null };
    if (pages) expect(receipt.next).toBeTruthy();
    let page: unknown;
    if (receipt.next) {
      const response = await fetch(wire(receipt.next, first.ready), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      page = await response.json();
      expect(page).toMatchObject({
        receipt: receipt.id,
        results: [
          { operationIndex: 2, outcome: "created" },
          { operationIndex: 3, outcome: "created" },
        ],
      });
    }
    first.child.kill("SIGKILL");
    const exit = await first.exited;
    expect(exit[1]).toBe("SIGKILL");
    const second = await start(false, pages ? 0 : Number(new URL(first.ready.scope).port));
    if (pages) expect(second.ready.listenUrl).not.toBe(first.ready.listenUrl);
    const retry = await submit(wire(second.ready.targets.batch, second.ready));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(receipt);
    expect(retry.headers.get("bdp-scope-position")).toBe("pos-1");
    const read = await fetch(wire(receipt.id, second.ready), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await read.json()).toEqual(receipt);
    if (receipt.next) {
      const response = await fetch(wire(receipt.next, second.ready), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(page);
    }
    second.child.stdin.write("close\n");
    expect((await second.exited)[0]).toBe(0);
  },
  15000,
);
