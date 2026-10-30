/** Independent raw-HTTP witnesses for a private, incomplete retained fixture. */
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonSchemaValidator } from "@bdp/conformance";
import { afterEach, describe, expect, it } from "vitest";
import {
  startPrivateRetainedFixture,
  type PrivateFixtureOptions,
} from "../../../packages/server/src/retained-v01/http.js";

const media = "application/vnd.bdp.v0.1+json";
const token = "a".repeat(32);
const otherToken = "b".repeat(32);
const thirdToken = "c".repeat(32);
const scope = "https://records.invalid/tenant/";
// Deliberately irregular navigation, authored independently from implementation routes.
const navigation = {
  scope,
  description: "https://navigation.invalid/contract?tenant=one",
  beads: "https://inventory.invalid/bead-set?tenant=one",
  links: "https://inventory.invalid/link-set?tenant=one",
  aliases: `${scope}names/`,
  events: "https://observations.invalid/stream?tenant=one",
  operations: "https://navigation.invalid/invocations?tenant=one",
  targets: {
    createBead: "https://commands.invalid/insert?tenant=one",
    updateBead: "https://commands.invalid/amend?tenant=one",
    deleteBead: "https://commands.invalid/remove?tenant=one",
    createLink: "https://commands.invalid/connect?tenant=one",
    updateLink: "https://commands.invalid/correct?tenant=one",
    deleteLink: "https://commands.invalid/disconnect?tenant=one",
    putAlias: "https://commands.invalid/name?tenant=one",
    deleteAlias: "https://commands.invalid/unname?tenant=one",
  },
};
const validator = createJsonSchemaValidator(
  JSON.parse(
    readFileSync(
      new URL("../../../specs/profiles/core/bdp-v0.1.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "private wire acceptance cleanup failed");
});
function configuration(): PrivateFixtureOptions {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-retained-wire-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    create: true,
    instance: "wire-slice01",
    navigation,
    credentials: [
      { token, principal: "p" },
      { token: otherToken, principal: "p" },
      { token: thirdToken, principal: "other" },
    ],
  };
}
function wire(
  listenUrl: string,
  target: string,
  method = "GET",
  body?: string | Buffer,
  headers: Record<string, string | string[]> = {},
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const transport = new URL(listenUrl),
      url = new URL(target);
    const req = request(
      {
        hostname: transport.hostname,
        port: transport.port,
        method,
        path: url.pathname + url.search,
        headers: {
          host: url.host,
          authorization: `Bearer ${token}`,
          accept: media,
          ...(body === undefined
            ? {}
            : { "content-type": media, "content-length": Buffer.byteLength(body) }),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            const status = response.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString("utf8");
            // Bodyless HTTP refusals have separate assertions. Every observed
            // error document must satisfy the independent canonical wire oracle.
            if (status >= 400 && text.length) {
              expect(response.headers["content-type"]).toMatch(
                /^application\/problem\+json(?:;|$)/,
              );
              const problem = JSON.parse(text);
              expect(validator.validate("#/$defs/readUpdateProblem", problem)).toEqual([]);
              expect(problem.status).toBe(status);
            }
            resolve({ status, headers: response.headers, text });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("private wire request exceeded deadline")));
    req.on("error", reject);
    req.end(body);
  });
}
async function fixture() {
  const config = configuration();
  const server = await startPrivateRetainedFixture(config);
  cleanups.push(() => server.close());
  return { ...server, config };
}
function payload(id?: string) {
  return JSON.stringify({
    ...(id === undefined ? {} : { id }),
    type: { uri: "https://definitions.invalid/Task", revision: "definition/opaque+1" },
    properties: { text: "café", nullable: null },
    metadata: {},
  });
}
async function terminate(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2000);
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error("private child not reaped"));
    }, 4000);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      child.removeListener("exit", exited);
    };
    const exited = () => {
      cleanup();
      resolve();
    };
    child.once("exit", exited);
    child.kill(signal);
  });
}
async function childFixture(
  config: PrivateFixtureOptions,
  barrier?: "resource-staged" | "alias-staged" | "committed",
) {
  const child = fork(
    fileURLToPath(
      new URL("../../../packages/server/dist/retained-v01/private-process.js", import.meta.url),
    ),
    [],
    { execPath: process.execPath, silent: true },
  );
  cleanups.push(() => terminate(child));
  let stdout = "",
    stderr = "";
  child.stdout?.on("data", (data) => {
    stdout += data.toString();
  });
  child.stderr?.on("data", (data) => {
    stderr += data.toString();
  });
  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`private child readiness timeout; stderr=${stderr}`));
    }, 5000);
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener("message", message);
      child.removeListener("exit", exited);
    };
    const message = (value: unknown) => {
      const result = value as { kind?: string; listenUrl?: string; claimEligible?: boolean };
      if (
        result.kind === "ready" &&
        typeof result.listenUrl === "string" &&
        result.claimEligible === false
      ) {
        cleanup();
        resolve(result.listenUrl);
      }
    };
    const exited = () => {
      cleanup();
      reject(new Error(`private child exited before ready; stderr=${stderr}`));
    };
    child.on("message", message);
    child.once("exit", exited);
  });
  child.send({ ...config, ...(barrier === undefined ? {} : { barrier }) });
  const listenUrl = await ready;
  return {
    child,
    listenUrl,
    async phase() {
      if (stdout.includes(`"phase":"${barrier}"`)) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("private phase barrier not observed"));
        }, 5000);
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout?.removeListener("data", observe);
          child.removeListener("exit", exited);
        };
        const observe = () => {
          if (stdout.includes(`"phase":"${barrier}"`)) {
            cleanup();
            resolve();
          }
        };
        const exited = () => {
          cleanup();
          reject(new Error("private child exited before barrier"));
        };
        child.stdout?.on("data", observe);
        child.once("exit", exited);
        observe();
      });
    },
  };
}
describe("private retained fixture: targeted wire interactions, no profile qualification", () => {
  it("follows actual discovered irregular URLs and verifies full create/read/Event correspondence", async () => {
    const server = await fixture();
    expect(server.claimEligible).toBe(false);
    expect(server.missing).not.toContain("putAlias");
    expect(server.missing).not.toContain("deleteAlias");
    expect(server.missing).not.toContain("createLink");
    expect(server.missing).not.toContain("deleteBead");
    expect(server.missing).not.toContain("updateBead");
    const landing = await wire(server.listenUrl, scope);
    expect(landing.status).toBe(204);
    expect(landing.headers.link).toContain(`<${navigation.description}>`);
    const discovery = JSON.parse((await wire(server.listenUrl, navigation.description)).text);
    expect(validator.validate("#/$defs/retainedDiscovery", discovery)).toEqual([]);
    expect(discovery).not.toHaveProperty("claimEligible");
    const directory = JSON.parse((await wire(server.listenUrl, discovery.operations)).text);
    expect(validator.validate("#/$defs/writeOperationDirectory", directory)).toEqual([]);
    const created = await wire(
      server.listenUrl,
      directory.createBead,
      "POST",
      payload("projects/a"),
      { "idempotency-key": "first" },
    );
    expect(created.status).toBe(200);
    expect(created.headers["content-type"]).toBe(media);
    expect(created.headers.etag).toBeUndefined();
    expect(created.headers.location).toBeUndefined();
    const result = JSON.parse(created.text);
    expect(validator.validate("#/$defs/mutationResult", result)).toEqual([]);
    expect(result.resource.metadata).toEqual({});
    const read = await wire(server.listenUrl, result.resource.id);
    expect(JSON.parse(read.text)).toEqual(result.resource);
    expect(read.headers["bdp-resource-kind"]).toBe("bead");
    const events = JSON.parse((await wire(server.listenUrl, discovery.events)).text);
    expect(validator.validate("#/$defs/retainedEventPage", events)).toEqual([]);
    expect(events.events).toHaveLength(1);
    expect(events.events[0].effect.resource).toEqual(result.resource);
    const subject = JSON.parse(
      (await wire(server.listenUrl, `${result.resource.id}?view=events`)).text,
    );
    expect(validator.validate("#/$defs/retainedEventPage", subject)).toEqual([]);
    expect(subject.events[0].source).toBe(`${result.resource.id}?view=events`);
    expect(
      (
        await wire(server.listenUrl, directory.putAlias, "POST", "{}", {
          "idempotency-key": "malformed-alias",
        })
      ).status,
    ).toBe(400);
  });
  it("rejects generic media and unacceptable response before binding a fresh key", async () => {
    const server = await fixture();
    const rejected = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload(),
      { "idempotency-key": "k", "content-type": "application/json" },
    );
    expect(rejected.status).toBe(415);
    const notAcceptable = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload(),
      { "idempotency-key": "k", accept: `${media};q=0, */*;q=1` },
    );
    expect(notAcceptable.status).toBe(406);
    expect(notAcceptable.text).toBe("");
    expect(
      (
        await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
          "idempotency-key": "k",
        })
      ).status,
    ).toBe(200);
    const page = JSON.parse((await wire(server.listenUrl, navigation.events)).text);
    expect(page.events).toHaveLength(1);
  });
  it.each(["a:b", "a:b/child"])(
    "creates and reads exact colon-bearing identity %s from both reference forms",
    async (local) => {
      const server = await fixture();
      const first = await wire(
        server.listenUrl,
        navigation.targets.createBead,
        "POST",
        payload(local),
        { "idempotency-key": "colon" },
      );
      expect(first.status).toBe(200);
      const result = JSON.parse(first.text);
      expect(result.resource.id).toBe(`${scope}${local}`);
      const replay = await wire(
        server.listenUrl,
        navigation.targets.createBead,
        "POST",
        payload(`${scope}${local}`),
        { "idempotency-key": "colon" },
      );
      expect(replay.status).toBe(200);
      expect(replay.text).toBe(first.text);
      const read = await wire(server.listenUrl, `${scope}${local}`);
      expect(read.status).toBe(200);
      expect(JSON.parse(read.text)).toEqual(result.resource);
      const page = JSON.parse((await wire(server.listenUrl, navigation.events)).text);
      expect(page.events).toHaveLength(1);
      expect(page.events[0].effect.id).toBe(`${scope}${local}`);
    },
  );
  it("keeps credentials mapped to one principal in one key namespace and reports changed intent", async () => {
    const server = await fixture();
    const first = await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "k",
    });
    const replay = await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "k",
      authorization: `Bearer ${otherToken}`,
    });
    expect(replay.text).toBe(first.text);
    const conflict = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload("other"),
      { "idempotency-key": "k" },
    );
    expect(JSON.parse(conflict.text).code).toBe("idempotency-conflict");
    const distinct = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload(),
      { "idempotency-key": "k", authorization: `Bearer ${thirdToken}` },
    );
    expect(JSON.parse(distinct.text).resource.id).not.toBe(JSON.parse(first.text).resource.id);
  });
  it("does not apply command-target HTTP conditions to payload-named Resources", async () => {
    const server = await fixture();
    const created = await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "command-conditions",
      "if-match": '"unrelated"',
      "bdp-minimum-scope-position": "old-coordinate",
      "bdp-scope-epoch": "old-epoch",
    });
    expect(created.status).toBe(200);
    const replay = await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "command-conditions",
    });
    expect(replay.text).toBe(created.text);
  });
  it("refuses duplicate keys, malformed JSON/UTF-8 and inadmissible numbers without rounded effects", async () => {
    const server = await fixture();
    const repeated = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload(),
      { "idempotency-key": ["k", "k"] },
    );
    expect(repeated.status).toBe(400);
    const duplicate = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      '{"type":"https://types.invalid/T","properties":{"x":1,"\\u0078":2}}',
      { "idempotency-key": "k" },
    );
    expect(duplicate.status).toBe(400);
    const malformed = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      Buffer.from([0xc0, 0xaf]),
      { "idempotency-key": "k" },
    );
    expect(malformed.status).toBe(400);
    expect(
      (
        await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
          "idempotency-key": "k",
        })
      ).status,
    ).toBe(200);
    const numeric = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      '{"type":"https://types.invalid/T","properties":{"n":9007199254740993}}',
      { "idempotency-key": "numeric" },
    );
    expect(numeric.status).toBe(422);
    expect(JSON.parse(numeric.text).code).toBe("validation-failed");
    const roundedRetry = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      '{"type":"https://types.invalid/T","properties":{"n":9007199254740992}}',
      { "idempotency-key": "numeric" },
    );
    expect(JSON.parse(roundedRetry.text).code).toBe("idempotency-conflict");
    expect(JSON.parse((await wire(server.listenUrl, navigation.events)).text).events).toHaveLength(
      1,
    );
  });
  it("admits the exact body byte bound and refuses one byte beyond it before key capture", async () => {
    const server = await fixture();
    const template = '{"type":"https://types.invalid/T","properties":{"padding":""}}';
    const body = template.replace(
      '"padding":""',
      `"padding":"${"x".repeat(65536 - Buffer.byteLength(template))}"`,
    );
    expect(Buffer.byteLength(body)).toBe(65536);
    const large = await wire(server.listenUrl, navigation.targets.createBead, "POST", `${body} `, {
      "idempotency-key": "bounded",
    });
    expect(large.status).toBe(413);
    expect(
      (
        await wire(server.listenUrl, navigation.targets.createBead, "POST", body, {
          "idempotency-key": "bounded",
        })
      ).status,
    ).toBe(200);
  });
  it("preserves fixed Event traversal context and rejects unsupported or conflicting selectors", async () => {
    const server = await fixture();
    await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "a",
    });
    await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "b",
    });
    const first = JSON.parse((await wire(server.listenUrl, `${navigation.events}&limit=1`)).text);
    expect(first.events).toHaveLength(1);
    expect(first.next).toBeTruthy();
    expect(first.next).toContain("tenant=one");
    await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
      "idempotency-key": "c",
    });
    const second = JSON.parse((await wire(server.listenUrl, first.next)).text);
    expect(second.coverage.through).toBe(first.coverage.through);
    expect(second.next).toBeNull();
    const newer = JSON.parse(
      (await wire(server.listenUrl, `${navigation.events}&after=${second.cursor}&limit=1`)).text,
    );
    expect(newer.events).toHaveLength(1);
    for (const query of [
      "representation=delta",
      "from=now&after=x",
      "limit=1&limit=2",
      "unknown=true",
    ])
      expect((await wire(server.listenUrl, `${navigation.events}&${query}`)).status).toBe(400);
    const wrong = await wire(
      server.listenUrl,
      `${navigation.events}&after=${second.cursor}&limit=1`,
      "GET",
      undefined,
      { authorization: `Bearer ${thirdToken}` },
    );
    expect(JSON.parse(wrong.text).code).toBe("foreign-view");
  });
  it("keeps HEAD/304/405/412 bodyless and requires authentication before negotiation", async () => {
    const server = await fixture();
    const created = JSON.parse(
      (
        await wire(server.listenUrl, navigation.targets.createBead, "POST", payload(), {
          "idempotency-key": "k",
        })
      ).text,
    );
    const read = await wire(server.listenUrl, created.resource.id);
    const head = await wire(server.listenUrl, created.resource.id, "HEAD");
    expect(head.text).toBe("");
    expect(head.headers.etag).toBe(read.headers.etag);
    const conditional = await wire(server.listenUrl, created.resource.id, "GET", undefined, {
      "if-none-match": read.headers.etag as string,
    });
    expect(conditional.status).toBe(304);
    expect(conditional.text).toBe("");
    expect(conditional.headers["bdp-resource-kind"]).toBe("bead");
    expect(
      (
        await wire(server.listenUrl, created.resource.id, "GET", undefined, {
          "if-match": '"wrong"',
        })
      ).status,
    ).toBe(412);
    const method = await wire(server.listenUrl, navigation.targets.createBead, "GET");
    expect(method.status).toBe(405);
    expect(method.text).toBe("");
    const unauthenticated = await wire(server.listenUrl, created.resource.id, "GET", undefined, {
      authorization: "Bearer wrong",
      accept: "application/json",
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers["www-authenticate"]).toBeTruthy();
  });
  it.each(["committed", "resource-staged"] as const)(
    "recovers after real process death at %s without duplicate facts",
    async (phase) => {
      const config = configuration();
      const first = await childFixture(config, phase);
      const pending = wire(
        first.listenUrl,
        navigation.targets.createBead,
        "POST",
        payload("projects/recover"),
        { "idempotency-key": "lost-response" },
      ).then(
        (value) => value,
        () => undefined,
      );
      await first.phase();
      await terminate(first.child, "SIGKILL");
      expect(await pending).toBeUndefined();
      const reopened = await childFixture({ ...config, create: false });
      const before = JSON.parse((await wire(reopened.listenUrl, navigation.events)).text);
      expect(before.events).toHaveLength(phase === "committed" ? 1 : 0);
      const recovered = await wire(
        reopened.listenUrl,
        navigation.targets.createBead,
        "POST",
        payload("projects/recover"),
        { "idempotency-key": "lost-response" },
      );
      expect(recovered.status).toBe(200);
      const repeated = await wire(
        reopened.listenUrl,
        navigation.targets.createBead,
        "POST",
        payload("projects/recover"),
        { "idempotency-key": "lost-response" },
      );
      expect(repeated.text).toBe(recovered.text);
      const after = JSON.parse((await wire(reopened.listenUrl, navigation.events)).text);
      expect(after.events).toHaveLength(1);
      if (phase === "committed")
        expect(JSON.parse(recovered.text).resource).toEqual(before.events[0].effect.resource);
      // These cases witness creation at the barriers. The update cases below add
      // the independent changed-current counterfactual for original postimages.
    },
  );
});

describe("private retained update wire witnesses, no profile qualification", () => {
  it("returns original create and update postimages after later updates and restart", async () => {
    const server = await fixture();
    const discovery = JSON.parse((await wire(server.listenUrl, navigation.description)).text);
    const directory = JSON.parse((await wire(server.listenUrl, discovery.operations)).text);
    const creationBody = payload("a:b/child");
    const created = await wire(server.listenUrl, directory.createBead, "POST", creationBody, {
      "idempotency-key": "original-create",
    });
    const original = JSON.parse(created.text).resource;
    const updateBody = JSON.stringify({
      bead: "a:b/child",
      expectedRevision: original.revision,
      type: { uri: "https://definitions.invalid/Task", revision: "definition/opaque+2" },
      properties: { text: "first update", nullable: null },
      metadataChange: [{ op: "add", path: "/reviewed", value: true }],
    });
    const updated = await wire(server.listenUrl, directory.updateBead, "POST", updateBody, {
      "idempotency-key": "original-update",
    });
    expect(updated.status).toBe(200);
    const second = JSON.parse(updated.text);
    expect(validator.validate("#/$defs/mutationResult", second)).toEqual([]);
    expect(second.resource.metadata).toEqual({ reviewed: true });
    expect(second.changed).toBe(true);
    expect(second.resource.revision).not.toBe(original.revision);
    const latest = await wire(
      server.listenUrl,
      directory.updateBead,
      "POST",
      JSON.stringify({
        bead: original.id,
        propertiesChange: [{ op: "replace", path: "/text", value: "later" }],
      }),
      { "idempotency-key": "later-update" },
    );
    expect(latest.status).toBe(200);
    const current = JSON.parse(latest.text).resource;
    expect(current).not.toEqual(original);
    expect(current).not.toEqual(second.resource);
    expect(JSON.parse((await wire(server.listenUrl, original.id)).text)).toEqual(current);
    expect(
      (
        await wire(server.listenUrl, directory.createBead, "POST", creationBody, {
          "idempotency-key": "original-create",
        })
      ).text,
    ).toBe(created.text);
    expect(
      (
        await wire(server.listenUrl, directory.updateBead, "POST", updateBody, {
          "idempotency-key": "original-update",
        })
      ).text,
    ).toBe(updated.text);
    await server.close();
    const reopened = await childFixture({ ...server.config, create: false });
    expect(
      (
        await wire(reopened.listenUrl, directory.createBead, "POST", creationBody, {
          "idempotency-key": "original-create",
        })
      ).text,
    ).toBe(created.text);
    expect(
      (
        await wire(reopened.listenUrl, directory.updateBead, "POST", updateBody, {
          "idempotency-key": "original-update",
        })
      ).text,
    ).toBe(updated.text);
    expect(JSON.parse((await wire(reopened.listenUrl, original.id)).text)).toEqual(current);
    const page = JSON.parse((await wire(reopened.listenUrl, discovery.events)).text);
    expect(validator.validate("#/$defs/retainedEventPage", page)).toEqual([]);
    expect(page.events).toHaveLength(3);
    expect(page.events[1]).toMatchObject({
      previousRevision: original.revision,
      revision: second.resource.revision,
      effect: { operation: "updateBead", bead: original.id, resource: second.resource },
    });
    const subject = JSON.parse((await wire(reopened.listenUrl, `${original.id}?view=events`)).text);
    expect(validator.validate("#/$defs/retainedEventPage", subject)).toEqual([]);
    expect(subject.events).toHaveLength(3);
  });
  it("versions a changed Type pin and checks no-op guards without replacing provenance", async () => {
    const server = await fixture();
    const created = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload("task"),
      { "idempotency-key": "create" },
    );
    const original = JSON.parse(created.text).resource;
    const edit = {
      bead: "task",
      type: { ...original.type, revision: "new-pin" },
      propertiesChange: [],
      metadataChange: [],
      revisionProvenance: { message: "pin version" },
    };
    const changed = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify(edit),
      { "idempotency-key": "pin", "if-match": '"unrelated-command-condition"' },
    );
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).toBeUndefined();
    expect(changed.headers.location).toBeUndefined();
    const current = JSON.parse(changed.text).resource;
    expect(current.revision).not.toBe(original.revision);
    expect(current.properties).toEqual(original.properties);
    const noop = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify({
        ...edit,
        expectedRevision: current.revision,
        revisionProvenance: { message: "ignored for no-op" },
      }),
      { "idempotency-key": "noop" },
    );
    expect(JSON.parse(noop.text)).toEqual({
      outcome: "updated",
      changed: false,
      resource: current,
    });
    const mismatch = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify({
        bead: "task",
        propertiesChange: [],
        expectedRevision: original.revision,
      }),
      { "idempotency-key": "stale" },
    );
    expect(mismatch.status).toBe(409);
    expect(JSON.parse(mismatch.text).code).toBe("revision-mismatch");
    expect(validator.validate("#/$defs/readUpdateProblem", JSON.parse(mismatch.text))).toEqual([]);
    const page = JSON.parse((await wire(server.listenUrl, navigation.events)).text);
    expect(page.events).toHaveLength(2);
    expect(validator.validate("#/$defs/retainedEventPage", page)).toEqual([]);
    const method = await wire(server.listenUrl, navigation.targets.updateBead, "GET");
    expect(method.status).toBe(405);
    expect(method.text).toBe("");
    expect(method.headers.allow).toBe("POST");
  });
  it("leaves malformed carriers unbound and retains an atomic patch failure after state changes", async () => {
    const server = await fixture();
    await wire(server.listenUrl, navigation.targets.createBead, "POST", payload("task"), {
      "idempotency-key": "c",
    });
    const malformed = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify({
        bead: "task",
        propertiesChange: [{ op: "remove", path: "bad-pointer" }],
      }),
      { "idempotency-key": "carrier" },
    );
    expect(malformed.status).toBe(400);
    const valid = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify({
        bead: "task",
        properties: { replaced: true },
      }),
      { "idempotency-key": "carrier" },
    );
    expect(valid.status).toBe(200);
    const failingBody = JSON.stringify({
      bead: "task",
      properties: {},
      metadataChange: [{ op: "remove", path: "/missing" }],
    });
    const failed = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      failingBody,
      { "idempotency-key": "failed" },
    );
    expect(failed.status).toBe(422);
    expect(validator.validate("#/$defs/readUpdateProblem", JSON.parse(failed.text))).toEqual([]);
    expect(JSON.parse(failed.text).diagnostics[0]).toMatchObject({ document: "metadata" });
    expect(JSON.parse((await wire(server.listenUrl, `${scope}task`)).text).properties).toEqual({
      replaced: true,
    });
    const repaired = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify({
        bead: "task",
        metadata: { missing: true },
      }),
      { "idempotency-key": "repair" },
    );
    expect(repaired.status).toBe(200);
    expect(
      (
        await wire(server.listenUrl, navigation.targets.updateBead, "POST", failingBody, {
          "idempotency-key": "failed",
        })
      ).text,
    ).toBe(failed.text);
    expect(JSON.parse((await wire(server.listenUrl, navigation.events)).text).events).toHaveLength(
      3,
    );
  });
  it.each(["committed", "resource-staged"] as const)(
    "recovers an update after real process death at %s and replays its older postimage",
    async (phase) => {
      const config = configuration();
      const seed = await childFixture(config);
      const creationBody = payload("task");
      const created = await wire(
        seed.listenUrl,
        navigation.targets.createBead,
        "POST",
        creationBody,
        { "idempotency-key": "create" },
      );
      const original = JSON.parse(created.text).resource;
      await terminate(seed.child);
      const first = await childFixture({ ...config, create: false }, phase);
      const body = JSON.stringify({
        bead: "task",
        expectedRevision: original.revision,
        propertiesChange: [{ op: "replace", path: "/text", value: "uncertain update" }],
      });
      const pending = wire(first.listenUrl, navigation.targets.updateBead, "POST", body, {
        "idempotency-key": "uncertain",
      }).then(
        (value) => value,
        () => undefined,
      );
      await first.phase();
      await terminate(first.child, "SIGKILL");
      expect(await pending).toBeUndefined();
      const reopened = await childFixture({ ...config, create: false });
      const before = JSON.parse((await wire(reopened.listenUrl, navigation.events)).text);
      expect(before.events).toHaveLength(phase === "committed" ? 2 : 1);
      const recovered = await wire(
        reopened.listenUrl,
        navigation.targets.updateBead,
        "POST",
        body,
        { "idempotency-key": "uncertain" },
      );
      expect(recovered.status).toBe(200);
      expect(JSON.parse(recovered.text).resource.properties.text).toBe("uncertain update");
      if (phase === "committed")
        expect(JSON.parse(recovered.text).resource).toEqual(before.events[1].effect.resource);
      const latest = await wire(
        reopened.listenUrl,
        navigation.targets.updateBead,
        "POST",
        JSON.stringify({
          bead: "task",
          properties: { final: true },
        }),
        { "idempotency-key": "later" },
      );
      expect(latest.status).toBe(200);
      expect(
        (
          await wire(reopened.listenUrl, navigation.targets.updateBead, "POST", body, {
            "idempotency-key": "uncertain",
          })
        ).text,
      ).toBe(recovered.text);
      expect(
        (
          await wire(reopened.listenUrl, navigation.targets.createBead, "POST", creationBody, {
            "idempotency-key": "create",
          })
        ).text,
      ).toBe(created.text);
      expect(
        JSON.parse((await wire(reopened.listenUrl, navigation.events)).text).events,
      ).toHaveLength(3);
    },
  );
});

describe("private wire admission and retry coverage gaps", () => {
  it("shares create/update keys across routes and credentials for the same principal", async () => {
    const server = await fixture();
    const created = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload("task"),
      { "idempotency-key": "shared" },
    );
    expect(created.status).toBe(200);
    const changedOperation = await wire(
      server.listenUrl,
      navigation.targets.updateBead,
      "POST",
      JSON.stringify({ bead: "task", properties: {} }),
      { "idempotency-key": "shared", authorization: `Bearer ${otherToken}` },
    );
    expect(changedOperation.status).toBe(409);
    expect(JSON.parse(changedOperation.text).code).toBe("idempotency-conflict");
    const body = JSON.stringify({ bead: "task", metadata: { changed: true } });
    const updated = await wire(server.listenUrl, navigation.targets.updateBead, "POST", body, {
      "idempotency-key": "update-key",
    });
    expect(updated.status).toBe(200);
    expect(
      (
        await wire(server.listenUrl, navigation.targets.updateBead, "POST", body, {
          "idempotency-key": "update-key",
          authorization: `Bearer ${otherToken}`,
        })
      ).text,
    ).toBe(updated.text);
    const changedBack = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload("other"),
      { "idempotency-key": "update-key" },
    );
    expect(JSON.parse(changedBack.text).code).toBe("idempotency-conflict");
    expect(
      (
        await wire(server.listenUrl, navigation.targets.createBead, "POST", payload("task"), {
          "idempotency-key": "shared",
        })
      ).text,
    ).toBe(created.text);
    expect(JSON.parse((await wire(server.listenUrl, navigation.events)).text).events).toHaveLength(
      2,
    );
  });
  it("returns bounded complete numeric diagnostics and replays the same refusal", async () => {
    const server = await fixture();
    const members = Array.from({ length: 9 }, (_, index) => `"p${index}":9007199254740993`).join(
      ",",
    );
    const body = `{"type":"https://types.invalid/T","metadata":{${members}}}`;
    const first = await wire(server.listenUrl, navigation.targets.createBead, "POST", body, {
      "idempotency-key": "diagnostics",
    });
    expect(first.status).toBe(422);
    const result = JSON.parse(first.text);
    expect(validator.validate("#/$defs/readUpdateProblem", result)).toEqual([]);
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics).toHaveLength(8);
    expect(result.diagnostics[0]).toMatchObject({ document: "metadata", instanceLocation: "/p0" });
    expect(
      (
        await wire(server.listenUrl, navigation.targets.createBead, "POST", body, {
          "idempotency-key": "diagnostics",
        })
      ).text,
    ).toBe(first.text);
    const long = `{"type":"https://types.invalid/T","properties":{"${"x".repeat(6000)}":9007199254740993}}`;
    const longResult = await wire(server.listenUrl, navigation.targets.createBead, "POST", long, {
      "idempotency-key": "long-diagnostic",
    });
    expect(longResult.status).toBe(422);
    expect(validator.validate("#/$defs/readUpdateProblem", JSON.parse(longResult.text))).toEqual(
      [],
    );
    expect(Buffer.byteLength(longResult.text)).toBeLessThan(4096);
    expect(JSON.parse((await wire(server.listenUrl, navigation.events)).text).events).toHaveLength(
      0,
    );
  });
  it("reports expired Event cursors at the exact boundary through the wire", async () => {
    let time = 10_000;
    const server = await startPrivateRetainedFixture({ ...configuration(), clock: () => time });
    cleanups.push(() => server.close());
    const first = JSON.parse((await wire(server.listenUrl, navigation.events)).text);
    const target = `${navigation.events}&after=${first.cursor}`;
    time += 299_999;
    expect((await wire(server.listenUrl, target)).status).toBe(200);
    time += 1;
    const expired = await wire(server.listenUrl, target);
    expect(expired.status).toBe(410);
    expect(JSON.parse(expired.text).code).toBe("cursor-expired");
    expect(validator.validate("#/$defs/readUpdateProblem", JSON.parse(expired.text))).toEqual([]);
  });
});

describe("private Bead deletion wire witnesses", () => {
  it("returns the final-live identity, preserves historical retry and keeps deleted-subject Events readable", async () => {
    const server = await fixture();
    const directory = JSON.parse((await wire(server.listenUrl, navigation.operations)).text);
    const creation = payload("task");
    const created = await wire(server.listenUrl, directory.createBead, "POST", creation, {
      "idempotency-key": "c",
    });
    const original = JSON.parse(created.text).resource;
    const updateBody = JSON.stringify({ bead: "task", properties: { final: true } });
    const updated = await wire(server.listenUrl, directory.updateBead, "POST", updateBody, {
      "idempotency-key": "u",
    });
    const before = JSON.parse(updated.text).resource;
    const body = JSON.stringify({ bead: "task", expectedRevision: before.revision });
    const deleted = await wire(server.listenUrl, directory.deleteBead, "POST", body, {
      "idempotency-key": "d",
      "if-match": '"command-url-condition"',
    });
    expect(deleted.status).toBe(200);
    expect(deleted.headers.etag).toBeUndefined();
    expect(deleted.headers.location).toBeUndefined();
    const result = JSON.parse(deleted.text);
    expect(validator.validate("#/$defs/mutationResult", result)).toEqual([]);
    expect(result).toEqual({
      outcome: "deleted",
      changed: true,
      deleted: {
        resourceKind: "bead",
        resource: { id: before.id, type: before.type, revision: before.revision },
      },
    });
    expect((await wire(server.listenUrl, before.id)).status).toBe(404);
    expect(
      (await wire(server.listenUrl, directory.deleteBead, "POST", body, { "idempotency-key": "d" }))
        .text,
    ).toBe(deleted.text);
    expect(
      (
        await wire(server.listenUrl, directory.createBead, "POST", creation, {
          "idempotency-key": "c",
        })
      ).text,
    ).toBe(created.text);
    expect(
      (
        await wire(server.listenUrl, directory.updateBead, "POST", updateBody, {
          "idempotency-key": "u",
        })
      ).text,
    ).toBe(updated.text);
    const reused = await wire(server.listenUrl, directory.createBead, "POST", creation, {
      "idempotency-key": "reuse",
    });
    expect(JSON.parse(reused.text).code).toBe("identity-taken");
    const subject = JSON.parse((await wire(server.listenUrl, `${original.id}?view=events`)).text);
    expect(validator.validate("#/$defs/retainedEventPage", subject)).toEqual([]);
    expect(subject.events).toHaveLength(3);
    expect(subject.events[2]).toMatchObject({
      revision: before.revision,
      effect: { operation: "deleteBead", bead: original.id, deleted: result.deleted },
    });
    expect(subject.events[2]).not.toHaveProperty("previousRevision");
  });
  it("admits deletion carrier syntax before capture and checks the Resource guard", async () => {
    const server = await fixture();
    const created = await wire(
      server.listenUrl,
      navigation.targets.createBead,
      "POST",
      payload("task"),
      { "idempotency-key": "c" },
    );
    const before = JSON.parse(created.text).resource;
    const malformed = await wire(
      server.listenUrl,
      navigation.targets.deleteBead,
      "POST",
      JSON.stringify({ bead: "task", revisionProvenance: {} }),
      { "idempotency-key": "d" },
    );
    expect(malformed.status).toBe(400);
    const wrong = await wire(
      server.listenUrl,
      navigation.targets.deleteBead,
      "POST",
      JSON.stringify({ bead: "task", expectedRevision: "wrong" }),
      { "idempotency-key": "guard" },
    );
    expect(wrong.status).toBe(409);
    expect(JSON.parse(wrong.text).code).toBe("revision-mismatch");
    expect((await wire(server.listenUrl, before.id)).status).toBe(200);
    expect(
      (
        await wire(
          server.listenUrl,
          navigation.targets.deleteBead,
          "POST",
          JSON.stringify({ bead: "task", expectedRevision: before.revision }),
          { "idempotency-key": "d" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await wire(
          server.listenUrl,
          navigation.targets.deleteBead,
          "POST",
          JSON.stringify({ bead: "task", expectedRevision: "wrong" }),
          { "idempotency-key": "guard" },
        )
      ).text,
    ).toBe(wrong.text);
  });
  it.each(["committed", "resource-staged"] as const)(
    "recovers deletion after real process death at %s without duplicate effects",
    async (phase) => {
      const config = configuration();
      const seed = await childFixture(config);
      const creation = payload("task");
      const created = await wire(seed.listenUrl, navigation.targets.createBead, "POST", creation, {
        "idempotency-key": "c",
      });
      const before = JSON.parse(created.text).resource;
      await terminate(seed.child);
      const first = await childFixture({ ...config, create: false }, phase);
      const body = JSON.stringify({ bead: "task", expectedRevision: before.revision });
      const pending = wire(first.listenUrl, navigation.targets.deleteBead, "POST", body, {
        "idempotency-key": "d",
      }).then(
        (value) => value,
        () => undefined,
      );
      await first.phase();
      await terminate(first.child, "SIGKILL");
      expect(await pending).toBeUndefined();
      const reopened = await childFixture({ ...config, create: false });
      expect((await wire(reopened.listenUrl, before.id)).status).toBe(
        phase === "committed" ? 404 : 200,
      );
      const previous = JSON.parse((await wire(reopened.listenUrl, navigation.events)).text);
      expect(previous.events).toHaveLength(phase === "committed" ? 2 : 1);
      const recovered = await wire(
        reopened.listenUrl,
        navigation.targets.deleteBead,
        "POST",
        body,
        { "idempotency-key": "d" },
      );
      expect(recovered.status).toBe(200);
      expect(JSON.parse(recovered.text).deleted.resource.revision).toBe(before.revision);
      expect(
        (
          await wire(reopened.listenUrl, navigation.targets.deleteBead, "POST", body, {
            "idempotency-key": "d",
          })
        ).text,
      ).toBe(recovered.text);
      expect(
        (
          await wire(reopened.listenUrl, navigation.targets.createBead, "POST", creation, {
            "idempotency-key": "c",
          })
        ).text,
      ).toBe(created.text);
      expect((await wire(reopened.listenUrl, before.id)).status).toBe(404);
      const final = JSON.parse((await wire(reopened.listenUrl, `${before.id}?view=events`)).text);
      expect(validator.validate("#/$defs/retainedEventPage", final)).toEqual([]);
      expect(final.events).toHaveLength(2);
    },
  );
});

describe("private Link process-death recovery", () => {
  for (const operation of ["createLink", "updateLink", "deleteLink"] as const) {
    it.each(["committed", "resource-staged"] as const)(
      `recovers ${operation} after real process death at %s`,
      async (phase) => {
        const config = configuration();
        const seed = await childFixture(config);
        for (const id of ["left", "right"])
          expect(
            (
              await wire(seed.listenUrl, navigation.targets.createBead, "POST", payload(id), {
                "idempotency-key": `seed-${id}`,
              })
            ).status,
          ).toBe(200);
        const creation = {
          id: "recover-edge",
          type: { uri: "https://types.invalid/Relation", revision: "definition-pin" },
          source: { uri: "left", revision: "unvalidated-endpoint-pin" },
          target: "right",
        };
        let body: Record<string, unknown> = creation;
        if (operation !== "createLink") {
          const initial = await wire(
            seed.listenUrl,
            navigation.targets.createLink,
            "POST",
            JSON.stringify(creation),
            { "idempotency-key": "initial-link" },
          );
          expect(initial.status).toBe(200);
          const resource = JSON.parse(initial.text).resource;
          body = {
            link: "recover-edge",
            expectedRevision: resource.revision,
            ...(operation === "updateLink"
              ? { source: "right", target: "left" }
              : { revisionProvenance: { message: "unowned deletion" } }),
          };
        }
        await terminate(seed.child);
        const first = await childFixture({ ...config, create: false }, phase);
        const frozen = JSON.stringify(body);
        const pending = wire(first.listenUrl, navigation.targets[operation], "POST", frozen, {
          "idempotency-key": "uncertain-link",
        }).then(
          (value) => value,
          () => undefined,
        );
        await first.phase();
        await terminate(first.child, "SIGKILL");
        expect(await pending).toBeUndefined();
        const reopened = await childFixture({ ...config, create: false });
        const previous = JSON.parse((await wire(reopened.listenUrl, navigation.events)).text);
        const linkFacts = previous.events.filter((entry: { effect: { operation: string } }) =>
          entry.effect.operation.endsWith("Link"),
        );
        const initialFacts = operation === "createLink" ? 0 : 1;
        expect(linkFacts).toHaveLength(initialFacts + (phase === "committed" ? 1 : 0));
        const recovered = await wire(
          reopened.listenUrl,
          navigation.targets[operation],
          "POST",
          frozen,
          { "idempotency-key": "uncertain-link" },
        );
        expect(recovered.status).toBe(200);
        const result = JSON.parse(recovered.text);
        expect(validator.validate("#/$defs/mutationResult", result)).toEqual([]);
        if (phase === "committed") {
          const fact = linkFacts.at(-1);
          if (operation === "deleteLink")
            expect(result.deleted.resource).toEqual(fact.effect.deleted.resource);
          else expect(result.resource).toEqual(fact.effect.resource);
        }
        expect(
          (
            await wire(reopened.listenUrl, navigation.targets[operation], "POST", frozen, {
              "idempotency-key": "uncertain-link",
            })
          ).text,
        ).toBe(recovered.text);
        const read = await wire(reopened.listenUrl, `${scope}recover-edge`);
        expect(read.status).toBe(operation === "deleteLink" ? 404 : 200);
        if (operation !== "deleteLink") expect(read.headers["bdp-resource-kind"]).toBe("link");
        const page = JSON.parse((await wire(reopened.listenUrl, `${scope}left?view=events`)).text);
        expect(validator.validate("#/$defs/retainedEventPage", page)).toEqual([]);
        expect(page.events).toHaveLength(initialFacts + 2);
        const own = JSON.parse(
          (await wire(reopened.listenUrl, `${scope}recover-edge?view=events`)).text,
        );
        expect(validator.validate("#/$defs/retainedEventPage", own)).toEqual([]);
        expect(own.events).toHaveLength(initialFacts + 1);
      },
    );
  }
});

describe("private alias process-death recovery", () => {
  for (const operation of ["putAlias", "deleteAlias"] as const) {
    it.each(["alias-staged", "committed"] as const)(
      `recovers ${operation} after real process death at %s without Resource effects`,
      async (phase) => {
        const config = configuration();
        const seed = await childFixture(config);
        for (const id of ["a", "b"]) {
          expect(
            (
              await wire(seed.listenUrl, navigation.targets.createBead, "POST", payload(id), {
                "idempotency-key": `seed-${id}`,
              })
            ).status,
          ).toBe(200);
        }
        const alias = "names/fault";
        if (operation === "deleteAlias") {
          expect(
            (
              await wire(
                seed.listenUrl,
                navigation.targets.putAlias,
                "POST",
                JSON.stringify({ alias, target: "a" }),
                {
                  "idempotency-key": "seed-alias",
                },
              )
            ).status,
          ).toBe(200);
        }
        await terminate(seed.child);
        const first = await childFixture({ ...config, create: false }, phase);
        const body = JSON.stringify(operation === "putAlias" ? { alias, target: "a" } : { alias });
        const pending = wire(first.listenUrl, navigation.targets[operation], "POST", body, {
          "idempotency-key": "uncertain-alias",
        }).then(
          (value) => value,
          () => undefined,
        );
        await first.phase();
        await terminate(first.child, "SIGKILL");
        expect(await pending).toBeUndefined();
        const reopened = await childFixture({ ...config, create: false });
        const present = operation === "putAlias" ? phase === "committed" : phase !== "committed";
        expect((await wire(reopened.listenUrl, scope + alias)).status).toBe(present ? 307 : 404);
        expect(
          JSON.parse((await wire(reopened.listenUrl, navigation.events)).text).events,
        ).toHaveLength(2);
        const recovered = await wire(
          reopened.listenUrl,
          navigation.targets[operation],
          "POST",
          body,
          {
            "idempotency-key": "uncertain-alias",
          },
        );
        expect(recovered.status).toBe(200);
        expect(JSON.parse(recovered.text)).toEqual(
          operation === "putAlias"
            ? { outcome: "created", alias: scope + alias, target: `${scope}a` }
            : { outcome: "deleted", alias: scope + alias },
        );
        expect(
          (
            await wire(
              reopened.listenUrl,
              navigation.targets.putAlias,
              "POST",
              JSON.stringify({ alias, target: "b" }),
              {
                "idempotency-key": "later-binding",
              },
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await wire(reopened.listenUrl, navigation.targets[operation], "POST", body, {
              "idempotency-key": "uncertain-alias",
            })
          ).text,
        ).toBe(recovered.text);
        expect((await wire(reopened.listenUrl, scope + alias)).headers.location).toBe(`${scope}b`);
        expect(
          JSON.parse((await wire(reopened.listenUrl, navigation.events)).text).events,
        ).toHaveLength(2);
      },
    );
  }
});
