import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import {
  startTransactionRuntime,
  transactionRuntimeAdministration,
} from "./transaction-runtime.js";

it("expires ordinary cached collection continuations only at erasure, never re-serving erased rows under current headers", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-erasure-pages-"));
  const scope = "https://erasure-pages.test/s/",
    type = `${scope}types/task`;
  const token = randomBytes(32).toString("base64url");
  const runtime = await startTransactionRuntime({
    directory,
    scope,
    port: 0,
    create: true,
    types: [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })],
    credentials: [{ token, principal: "p", canMutate: true }],
  });
  async function request(target: string, body?: unknown, key?: string) {
    const url = new URL(target, scope);
    const response = await fetch(new URL(url.pathname + url.search, runtime.listenUrl), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": key ?? "unused" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    console.log(
      "ERASURE_PAGE_RESPONSE " +
        JSON.stringify({
          target: url.href,
          status: response.status,
          headers: Object.fromEntries(response.headers),
          bodyBase64: Buffer.from(text).toString("base64"),
          credentialsRedacted: true,
        }),
    );
    return { status: response.status, value: JSON.parse(text), text };
  }
  try {
    const created = await request(
      "operations/batch",
      {
        operations: [
          { operation: "createBead", id: "beads/a", type, properties: { safe: true } },
          {
            operation: "createBead",
            id: "beads/b",
            type,
            properties: { secret: "erased-cached-secret" },
          },
        ],
      },
      "create",
    );
    expect(created.status).toBe(200);
    const original = created.value.results[1].resource;
    const first = await request("beads/?limit=1");
    expect(first.status).toBe(200);
    expect(first.value.items[0].id).toBe(`${scope}beads/a`);
    const next = first.value.next;
    expect(typeof next).toBe("string");
    expect(
      (
        await request(
          "operations/batch",
          {
            operations: [
              {
                operation: "updateBead",
                bead: "beads/b",
                propertiesChange: [{ op: "replace", path: "/secret", value: "healthy" }],
              },
            ],
          },
          "update",
        )
      ).status,
    ).toBe(200);
    // Ordinary writes keep the exact immutable collection snapshot usable.
    const ordinary = await request(next);
    expect(ordinary.status).toBe(200);
    expect(ordinary.value.items[0].revision).toBe(original.revision);
    expect(ordinary.text).toContain("erased-cached-secret");
    transactionRuntimeAdministration(runtime).eraseHistoricalVersions([
      { subject: original.id, revision: original.revision },
    ]);
    const erased = await request(next);
    expect(erased.status).toBe(410);
    expect(erased.value.code).toBe("cursor-expired");
    expect(erased.text).not.toContain("erased-cached-secret");
    const fresh = await request("beads/?limit=2");
    expect(fresh.status).toBe(200);
    expect(fresh.text).not.toContain("erased-cached-secret");
    expect(fresh.value.items[1].properties).toEqual({ secret: "healthy" });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

it("keeps local administration owner-bound without expanding the legacy facade", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-erasure-admin-"));
  const scope = "https://erasure-admin.test/s/";
  const runtime = await startTransactionRuntime({
    directory,
    scope,
    port: 0,
    create: true,
    types: [
      parseTypeDescriptor({
        id: `${scope}types/task`,
        name: "Task",
        describes: "bead",
        conformsTo: [],
      }),
    ],
    credentials: [
      { token: randomBytes(32).toString("base64url"), principal: "p", canMutate: true },
    ],
  });
  try {
    expect(Object.keys(runtime).sort()).toEqual([
      "close",
      "configurationMetadata",
      "listenUrl",
      "replaceAuthorizationPolicy",
      "scope",
      "targets",
    ]);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(runtime).not.toHaveProperty("eraseHistoricalVersions");
    expect(() => transactionRuntimeAdministration({ ...runtime })).toThrow(
      "authentic transaction runtime required",
    );
    expect(() => transactionRuntimeAdministration({})).toThrow(
      "authentic transaction runtime required",
    );
    const administration = transactionRuntimeAdministration(runtime);
    expect(Object.isFrozen(administration)).toBe(true);
    expect(transactionRuntimeAdministration(runtime)).toBe(administration);
    await runtime.close();
    expect(() => administration.eraseHistoricalVersions([])).toThrow(
      "transaction runtime is closing",
    );
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
