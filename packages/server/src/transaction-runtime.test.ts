import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { afterEach, expect, it } from "vitest";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const token = "x".repeat(32),
  type = "https://example.test/process-bead";
it.each([
  { pages: false, compiled: false },
  { pages: true, compiled: false },
  { pages: true, compiled: true },
])(
  "reopens actual emitted HTTP service after abrupt process loss (pages=$pages compiled=$compiled)",
  async ({ pages, compiled }) => {
    const stableScope = "https://example.test/stable/pages/";
    const fixtureType = compiled ? `${stableScope}types/process` : type;
    const schema = "https://offline.invalid/process-properties";
    const types = [
      {
        id: fixtureType,
        name: "Process Bead",
        describes: "bead",
        conformsTo: [],
        ...(compiled ? { propertiesSchema: schema } : {}),
      },
    ];
    const artifacts = {
      descriptors: types.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
      schemas: [
        {
          retrievalUri: schema,
          utf8: JSON.stringify({
            $id: schema,
            type: "object",
            required: ["n"],
            properties: { n: { type: "integer", minimum: 0 } },
          }),
        },
      ],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    };
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-http-process-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    async function start(create: boolean, port: number) {
      const runtime = new URL("../dist/transaction-runtime.js", import.meta.url).href;
      const options = {
        directory,
        ...(pages ? { scope: stableScope } : {}),
        create,
        port,
        ...(compiled ? { artifacts } : { types }),
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
        type: fixtureType,
        ...(compiled ? { properties: { n } } : {}),
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
    const page = receipt.next
      ? await (
          await fetch(wire(receipt.next, first.ready), {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json()
      : undefined;
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
      expect(
        await (
          await fetch(wire(receipt.next, second.ready), {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json(),
      ).toEqual(page);
    }
    if (compiled) {
      const typeRead = await fetch(wire(fixtureType, second.ready), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(typeRead.status).toBe(200);
      expect(await typeRead.json()).toEqual(types[0]);
      const invalid = await fetch(wire(second.ready.targets.batch, second.ready), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "invalid-after-reopen",
        },
        body: JSON.stringify({
          operations: [
            {
              operation: "createBead",
              id: "beads/invalid",
              type: fixtureType,
              properties: { n: -1 },
            },
          ],
        }),
      });
      expect(await invalid.json()).toMatchObject({
        status: "failed",
        problem: { code: "validation-failed" },
      });
    }
    second.child.stdin.write("close\n");
    expect((await second.exited)[0]).toBe(0);
  },
  15000,
);
