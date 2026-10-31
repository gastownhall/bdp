/** Actual private set serving observations; no ordinary runner/catalog/profile admission. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { isJsonSchemaUri, isJsonSchemaDateTime } from "@bdp/protocol";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw Error("installed set override requires explicit source commit");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  bead = `${scope}types/bead`,
  owner = `${scope}types/owner`,
  link = `${scope}types/link`,
  owned = `${scope}types/owned`,
  schema = `${scope}schemas/n`;
const descriptors = [
  { id: bead, name: "Bead", describes: "bead", conformsTo: [], propertiesSchema: schema },
  {
    id: owner,
    name: "Owner",
    describes: "bead",
    conformsTo: [],
    propertiesSchema: schema,
    ownsOutgoing: { [owned]: { max: 32 } },
  },
  ...[link, owned].map((id) => ({
    id,
    name: id.endsWith("owned") ? "Owned" : "Link",
    describes: "link",
    conformsTo: [],
    propertiesSchema: schema,
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  })),
];
const artifacts = {
  descriptors: descriptors.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
  schemas: [
    {
      retrievalUri: schema,
      utf8: JSON.stringify({
        $id: schema,
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(path.join(root, "specs/profiles/core/bdp-v0.schema.json"), "utf8"),
);
ajv.addSchema(bundle);
const validators = Object.fromEntries(
  ["mutationReceipt", "mutationReceiptPage", "eventPage", "changeGroup"].map((name) => [
    name,
    ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` }),
  ]),
);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("expected wire object");
  return value as Record<string, unknown>;
}
function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw Error("expected wire array");
  return value.map(object);
}
function checked(name: string, value: unknown) {
  const validate = validators[name];
  if (!validate) throw Error("validator missing");
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}
it("installed valid sets preserve atomic effects, original receipts, owned versions and complete paged Events", async () => {
  const controller = new AbortController(),
    deadline = setTimeout(
      () => controller.abort(new Error("installed set cohort deadline")),
      90000,
    );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-set-installed-")),
    token = randomBytes(32).toString("base64url");
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  const failures: unknown[] = [],
    observations: unknown[] = [];
  let report: unknown,
    key = 0;
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    const initialReady = child.ready,
      binding = installedTransactionBinding(initialReady, source, fixture);
    expect(Object.keys(initialReady.targets as object)).toHaveLength(12);
    const send = async (
      target: string,
      body?: unknown,
      suppliedKey?: string,
      expectedStatus = 200,
    ) => {
      if (!child) throw Error("closed installed session");
      const current = installedTransactionBinding(child.ready, source, fixture);
      expect(current.runtimeConfigurationIdentity).toBe(binding.runtimeConfigurationIdentity);
      const address = new URL(child.ready.listenUrl as string),
        url = new URL(target, scope).href,
        method = body === undefined ? ("GET" as const) : ("POST" as const);
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 1048576,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "writer",
            credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const requestBody = typeof body === "string" ? body : JSON.stringify(body);
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines:
            body === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: suppliedKey ?? `set_${key++}` },
                ],
          ...(body === undefined ? {} : { bodyBytes: Buffer.from(requestBody!) }),
        },
      });
      expect(response.status, response.bodyText).toBe(expectedStatus);
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      if (expectedStatus === 200)
        for (const header of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers[header]?.length).toBeGreaterThan(0);
      observations.push({
        method,
        url,
        requestBody,
        status: response.status,
        headers: response.headers,
        body: response.bodyText,
        wireResponseBase64: Buffer.from(response.wireResponseBytes!).toString("base64"),
        wireSha256: createHash("sha256").update(response.wireResponseBytes!).digest("hex"),
      });
      const parsed = object(JSON.parse(response.bodyText));
      if (method === "POST" && expectedStatus === 200) checked("mutationReceipt", parsed);
      return parsed;
    };
    const run = (operations: unknown[], suppliedKey?: string) =>
      send("operations/batch", { operations }, suppliedKey);
    const create = (id: string, type = bead) => ({
      operation: "createBead",
      id: `beads/${id}`,
      type,
      properties: { n: 0 },
      metadata: { stable: true },
    });
    await run([create("a"), create("b"), create("owner", owner)]);
    const linkIds = Array.from(
      { length: 32 },
      (_, i) => `${scope}links/l${String(i).padStart(2, "0")}`,
    );
    await run(
      linkIds.map((id) => ({
        operation: "createLink",
        id,
        type: link,
        source: "beads/a",
        target: "beads/b",
        properties: { n: 0 },
      })),
    );
    const collectEvents = async (target: string) => {
      const events: Record<string, unknown>[] = [],
        lengths: number[] = [];
      let next: string | null = target;
      for (let pages = 0; next !== null; pages++) {
        if (pages >= 12) throw Error("bounded Event fixture page count exceeded");
        const page = await send(next);
        checked("eventPage", page);
        const rows = array(page.events);
        lengths.push(rows.length);
        events.push(...rows);
        if (page.next !== null && typeof page.next !== "string") throw Error("invalid Event next");
        next = page.next;
      }
      return { events, lengths };
    };
    const seededEvents = await collectEvents("events/"),
      lastSeedId = seededEvents.events.at(-1)?.id;
    expect(typeof lastSeedId).toBe("string");
    const feedStart = await send("changes/?start=now");
    expect(feedStart.groups).toEqual([]);
    const input = {
      collection: "links",
      selector: `$[?@.type == "${link}"]`,
      cardinality: { min: 32, max: 32 },
    };
    const receipt = await send("operations/delete-where", input, "delete32");
    expect(receipt.status).toBe("completed");
    expect(array(receipt.results)).toHaveLength(32);
    expect(typeof receipt.next).toBe("string");
    const page = await send(receipt.next as string);
    checked("mutationReceiptPage", page);
    expect(array(page.results)).toHaveLength(1);
    expect(page.next).toBeNull();
    const allResults = [...array(receipt.results), ...array(page.results)];
    const assertResults = (rows: Record<string, unknown>[]) => {
      expect(rows[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 32 });
      expect(
        rows.slice(1).map((r) => ({
          operationIndex: r.operationIndex,
          outcome: r.outcome,
          id: object(object(r.deleted).resource).id,
        })),
      ).toEqual(linkIds.map((id) => ({ operationIndex: 0, outcome: "deleted", id })));
    };
    assertResults(allResults);
    expect(() => assertResults(allResults.slice(0, -1))).toThrow();
    const suffixUrl = `events/?after=${encodeURIComponent(lastSeedId as string)}`;
    const suffix = await collectEvents(suffixUrl);
    expect(suffix.lengths).toEqual([32, 32, 32]);
    const expectedFacts = linkIds.flatMap((id) => [
      { type: "deleted", subject: id },
      { type: "unlinked", subject: id },
      { type: "unlinked", subject: id },
    ]);
    const assertEvents = (events: Record<string, unknown>[]) =>
      expect(events.map((e) => ({ type: e.type, subject: e.subject }))).toEqual(expectedFacts);
    assertEvents(suffix.events);
    expect(() => assertEvents(suffix.events.slice(1))).toThrow();
    expect(() =>
      assertEvents([
        ...suffix.events.slice(3, 6),
        ...suffix.events.slice(0, 3),
        ...suffix.events.slice(6),
      ]),
    ).toThrow();
    const feed = await send(`changes/?after=${encodeURIComponent(feedStart.after as string)}`);
    expect(array(feed.groups)).toHaveLength(1);
    expect(feed.next).toBeNull();
    const group = array(feed.groups)[0]!;
    checked("changeGroup", group);
    expect(array(group.events)).toHaveLength(96);
    expect(
      array(group.changes).map((c) => ({ operation: c.operation, id: object(c.resource).id })),
    ).toEqual(linkIds.map((id) => ({ operation: "tombstone", id })));
    await send(linkIds[0]!, undefined, undefined, 404);
    // A retry never selects the later population under the same key.
    await run([
      {
        operation: "createLink",
        id: "links/later",
        type: link,
        source: "beads/a",
        target: "beads/b",
        properties: { n: 0 },
      },
    ]);
    expect(await run([{ operation: "deleteWhere", ...input }], "delete32")).toEqual(receipt);
    expect((await send("links/later")).id).toBe(`${scope}links/later`);
    const ownedCreated = await run([
      {
        operation: "createLink",
        id: "links/owned",
        type: owned,
        source: "beads/owner",
        target: "beads/b",
        properties: { n: 0 },
      },
    ]);
    const ownedInput = {
      collection: "links",
      selector: `$[?@.id == "${scope}links/owned"]`,
      change: [{ op: "replace", path: "/n", value: 1 }],
    };
    const sourceBefore = await send("beads/owner"),
      linkBefore = await send("links/owned");
    expect(linkBefore.properties).toEqual({ n: 0 });
    expect(typeof sourceBefore.revision).toBe("string");
    expect(typeof linkBefore.revision).toBe("string");
    const updated = await send("operations/update-where", ownedInput, "owned_update");
    const sourceAfter = await send("beads/owner"),
      linkAfter = await send("links/owned"),
      updatedEntry = array(updated.results)[1]!;
    const assertOwnedTransition = (
      receipt: Record<string, unknown>,
      liveSource: Record<string, unknown>,
      liveLink: Record<string, unknown>,
    ) => {
      expect(liveLink.properties, "requested owned Link properties").toEqual({ n: 1 });
      expect(liveLink.metadata).toEqual(linkBefore.metadata);
      expect(liveSource.properties).toEqual(sourceBefore.properties);
      expect(liveSource.metadata).toEqual(sourceBefore.metadata);
      expect(typeof liveLink.revision).toBe("string");
      expect(liveLink.revision, "owned Link revision advances").not.toBe(linkBefore.revision);
      expect(typeof liveSource.revision).toBe("string");
      expect(liveSource.revision, "owner revision advances").not.toBe(sourceBefore.revision);
      expect(receipt.effectPosition, "effectful owned update has a position").toEqual(
        expect.any(String),
      );
      expect(receipt.effectPosition).not.toBe(ownedCreated.requiredPosition);
      expect(receipt.requiredPosition).toBe(receipt.effectPosition);
      const entry = array(receipt.results)[1]!;
      expect(entry.sourceRevision).toBe(liveSource.revision);
      expect(object(entry.resource)).toEqual(liveLink);
      expect(object(liveSource.ownedLinks)[owned]).toEqual([liveLink]);
    };
    assertOwnedTransition(updated, sourceAfter, linkAfter);
    // The native runtime mutant changes n1 to n0 and returns mutually consistent
    // stale outputs. Reject that exact observation class at the intended literal
    // assertion, rather than relying on an unrelated exception or inequality.
    const staleReceipt = {
      ...updated,
      effectPosition: undefined,
      requiredPosition: ownedCreated.requiredPosition,
      results: [
        array(updated.results)[0],
        { ...updatedEntry, resource: linkBefore, sourceRevision: sourceBefore.revision },
      ],
    };
    expect(() => assertOwnedTransition(staleReceipt, sourceBefore, linkBefore)).toThrow(
      /requested owned Link properties/,
    );
    const assertOwned = (row: Record<string, unknown>) =>
      expect(row.sourceRevision).toBe(sourceAfter.revision);
    expect(() => assertOwned({ ...updatedEntry, sourceRevision: "wrong" })).toThrow();
    const noop = await send("operations/update-where", ownedInput);
    expect(noop.effectPosition).toBeUndefined();
    expect(array(noop.results)[1]).toEqual(updatedEntry);
    const bad = await run(
      [
        create("tentative"),
        {
          operation: "updateWhere",
          ...ownedInput,
          change: [{ op: "replace", path: "/n", value: "invalid" }],
        },
      ],
      "compiled_fail",
    );
    expect(bad).toMatchObject({
      status: "failed",
      problem: { code: "validation-failed", operationIndex: 1, pointer: "/operations/1/change" },
    });
    expect(await send("beads/owner")).toEqual(sourceAfter);
    expect(await send("links/owned")).toEqual(linkAfter);
    await send("beads/tentative", undefined, undefined, 404);
    // Live session replacement retains logical binding, original receipt and actual next URL.
    await child.close();
    child = undefined;
    child = await launchInstalledTransaction(
      entry,
      { ...configuration, create: false },
      controller.signal,
    );
    expect(await send(receipt.id as string)).toEqual(receipt);
    expect(await send(receipt.next as string)).toEqual(page);
    expect(await run([{ operation: "deleteWhere", ...input }], "delete32")).toEqual(receipt);
    expect(
      await run(
        [
          create("tentative"),
          {
            operation: "updateWhere",
            ...ownedInput,
            change: [{ op: "replace", path: "/n", value: "invalid" }],
          },
        ],
        "compiled_fail",
      ),
    ).toEqual(bad);
    report = {
      kind: "installed-valid-set-observation",
      source,
      workspaceDirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      claimEligible: false,
      initialReady,
      reopenedReady: child.ready,
      counts: {
        receiptEntries: 33,
        receiptPages: [32, 1],
        eventPages: suffix.lengths,
        events: 96,
        groups: 1,
        negativeOracles: 5,
      },
      observations,
    };
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await child?.close();
    } catch (error) {
      failures.push(error);
    }
    if (controller.signal.aborted) failures.push(controller.signal.reason);
    clearTimeout(deadline);
    rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length)
    throw new AggregateError(failures, "installed set observation or cleanup failed");
  console.log(JSON.stringify(report));
}, 120000);
