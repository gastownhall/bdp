import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { startReferenceService } from "./reference.js";

const scope = "http://127.0.0.1:18080/review/";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function probe(
  service: Awaited<ReturnType<typeof startReferenceService>>,
  authorization?: string,
): Promise<number> {
  const listener = new URL(service.listenUrl);
  return await new Promise((resolve, reject) => {
    const probeRequest = request(
      {
        hostname: listener.hostname,
        port: listener.port,
        path: "/review/",
        headers: {
          host: new URL(scope).host,
          ...(authorization === undefined ? {} : { authorization }),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    probeRequest.once("error", reject);
    probeRequest.end();
  });
}

it("can explicitly disable authentication for a local conformance fixture", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-reference-anonymous-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const service = await startReferenceService({
    directory,
    create: true,
    instance: "anonymous-test",
    scope,
    authentication: "disabled",
    credentials: [],
  });
  cleanup.push(service.close);
  expect(await probe(service)).toBe(204);
});

it("keeps authentication required by default", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-reference-private-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const token = "t".repeat(32);
  const service = await startReferenceService({
    directory,
    create: true,
    instance: "private-test",
    scope,
    credentials: [{ token, principal: "reviewer" }],
  });
  cleanup.push(service.close);
  expect(await probe(service)).toBe(401);
  expect(await probe(service, `Bearer ${token}`)).toBe(204);
});
