/** Private installed current minimum observations; no profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { request as httpRequest } from "node:http";
import type { ClientRequest } from "node:http";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal?: AbortSignal,
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const scope = "https://event-sse.invalid/acme/";
const artifacts: {
  descriptors: { retrievalUri: string; utf8: string }[];
  schemas: { retrievalUri: string; utf8: string }[];
} = {
  descriptors: [
    {
      retrievalUri: "https://event-sse.invalid/acme/types/bead",
      utf8: '{"id":"https://event-sse.invalid/acme/types/bead","name":"Bead","describes":"bead","conformsTo":[]}',
    },
    {
      retrievalUri: "https://event-sse.invalid/acme/types/link",
      utf8: '{"id":"https://event-sse.invalid/acme/types/link","name":"Link","describes":"link","conformsTo":[],"source":{"conformsTo":["https://event-sse.invalid/acme/types/bead"],"external":"opaque"},"target":{"conformsTo":["https://event-sse.invalid/acme/types/bead"],"external":"opaque"}}',
    },
  ],
  schemas: [],
};
const entry =
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
  path.join(root, "packages/server/dist/transaction-installed.js");
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed minimum entry override requires declared source commit");
const resolvedEntry = realpathSync(entry);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function responseHeaderDigest(rawHeaders: readonly string[]): string {
  const pairs: [string, string][] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i]!.toLowerCase();
    if (name !== "date") pairs.push([name, rawHeaders[i + 1]!]);
  }
  pairs.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    return left[1] === right[1] ? 0 : left[1] < right[1] ? -1 : 1;
  });
  return digest(JSON.stringify(pairs));
}
const entrySha256 = digest(readFileSync(resolvedEntry));
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const sourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("invalid declared source commit");
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const validSequence = ajv.compile({ $ref: `${bundle.$id}#/$defs/transactionalSequenceResponse` });
const validResource = ajv.compile({ $ref: `${bundle.$id}#/$defs/currentBeadRecord` });
const validLink = ajv.compile({ $ref: `${bundle.$id}#/$defs/currentLinkRecord` });
const validProblem = ajv.compile({ $ref: `${bundle.$id}#/$defs/transactionalProblem` });
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
const retainedHeaders = [
  ...contextNames,
  "content-type",
  "content-length",
  "cache-control",
  "retry-after",
  "www-authenticate",
  "x-bdp-development",
  "x-bdp-development-limit",
  "etag",
  "last-modified",
  "allow",
  "location",
  "link",
];

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected response record");
  return value as Record<string, unknown>;
}
function sequenceResults(value: Record<string, unknown>) {
  if (!Array.isArray(value.results)) throw new Error("expected sequence results");
  return value.results.map(record);
}
const seedBody =
  '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://event-sse.invalid/acme/types/bead","properties":{"title":"a"},"idempotencyKey":"minimum-current-a"},{"operation":"createBead","id":"beads/b","type":"https://event-sse.invalid/acme/types/bead","properties":{"title":"b"},"idempotencyKey":"minimum-current-b"},{"operation":"createLink","id":"links/self","type":"https://event-sse.invalid/acme/types/link","source":"beads/a","target":"beads/a","idempotencyKey":"minimum-current-link"},{"operation":"putAlias","alias":"alias/work","target":"beads/a","idempotencyKey":"minimum-current-alias"}]}';
const rows = [
  {
    index: 2,
    method: "GET",
    target: "beads/missing",
    status: 404,
    minimum: "ahead",
  },
  {
    index: 3,
    method: "HEAD",
    target: "beads/missing",
    status: 404,
    minimum: "foreign-epoch",
  },
  {
    index: 4,
    method: "GET",
    target: "links/missing",
    status: 404,
    minimum: "foreign-view",
  },
  {
    index: 5,
    method: "HEAD",
    target: "links/missing",
    status: 404,
    minimum: "ahead",
  },
  {
    index: 6,
    method: "GET",
    target: "alias/missing",
    status: 404,
    minimum: "foreign-epoch",
  },
  {
    index: 7,
    method: "HEAD",
    target: "alias/missing",
    status: 404,
    minimum: "foreign-view",
  },
  {
    index: 8,
    method: "GET",
    target: "beads/missing",
    status: 404,
    minimum: "unknown-current-context",
  },
  {
    index: 9,
    method: "GET",
    target: "links/missing",
    status: 404,
    minimum: "unknown-current-context",
  },
  {
    index: 10,
    method: "GET",
    target: "alias/missing",
    status: 404,
    minimum: "unknown-current-context",
  },
  {
    index: 11,
    method: "GET",
    target: "beads/a",
    status: 503,
    minimum: "unknown-current-context",
  },
  {
    index: 12,
    method: "HEAD",
    target: "beads/a",
    status: 503,
    minimum: "unknown-current-context",
  },
  {
    index: 13,
    method: "GET",
    target: "links/self",
    status: 503,
    minimum: "unknown-current-context",
  },
  {
    index: 14,
    method: "GET",
    target: "beads/a",
    status: 200,
    minimum: "compatible",
  },
  {
    index: 15,
    method: "GET",
    target: "beads/missing?view=properties",
    status: 404,
    minimum: "ahead",
  },
  {
    index: 16,
    method: "GET",
    target: "beads/a?view=properties",
    status: 503,
    minimum: "unknown-current-context",
  },
  {
    index: 17,
    method: "GET",
    target: "beads/missing?view=links",
    status: 404,
    minimum: "foreign-view",
  },
  {
    index: 18,
    method: "GET",
    target: "beads/a",
    status: 404,
    minimum: "ahead",
  },
  {
    index: 19,
    method: "HEAD",
    target: "beads/a",
    status: 404,
    minimum: "foreign-epoch",
  },
  {
    index: 20,
    method: "GET",
    target: "links/self",
    status: 404,
    minimum: "foreign-view",
  },
  {
    index: 21,
    method: "HEAD",
    target: "links/self",
    status: 404,
    minimum: "ahead",
  },
  {
    index: 22,
    method: "GET",
    target: "alias/work",
    status: 404,
    minimum: "foreign-epoch",
  },
  {
    index: 23,
    method: "HEAD",
    target: "alias/work",
    status: 404,
    minimum: "foreign-view",
  },
  {
    index: 24,
    method: "GET",
    target: "beads/a",
    status: 404,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 25,
    method: "GET",
    target: "links/self",
    status: 404,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 26,
    method: "GET",
    target: "alias/work",
    status: 404,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 27,
    method: "GET",
    target: "beads/a?view=properties",
    status: 404,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 28,
    method: "GET",
    target: "beads/a?view=links",
    status: 404,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 29,
    method: "GET",
    target: "beads/missing",
    status: 404,
    minimum: "same-as-first-hidden-ahead",
  },
  {
    index: 30,
    method: "GET",
    target: "beads/a",
    status: 401,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 31,
    method: "PUT",
    target: "beads/a",
    status: 405,
    minimum: "unknown-post-publication-context",
  },
  {
    index: 32,
    method: "GET",
    target: "beads/a",
    status: 400,
    minimum: "incomplete-or-duplicate",
  },
] as const;
const mode = process.env.BDP_TRANSACTIONAL_MINIMUM_CURRENT_MODE ?? "positive";
if (!["positive", "restore-missing-gap", "restore-unknown-gap"].includes(mode))
  throw new Error("invalid minimum current mode");
const bootstrap =
  "/** External private validation IPC adapter; not part of the installed payload. */\nimport process from 'node:process';\nimport {readFileSync,realpathSync} from 'node:fs';\nimport {createHash} from 'node:crypto';\nimport {pathToFileURL} from 'node:url';\nconst hash=b=>createHash('sha256').update(b).digest('hex');\nconst keys=(v,expected)=>v && typeof v==='object' && !Array.isArray(v) &&\n Object.keys(v).sort().join(',')===[...expected].sort().join(',');\nasync function main(){\n if(!process.send || process.argv.length!==2) throw Error('inherited IPC required');\n const entry=__ENTRY__;\n if(realpathSync(entry)!==entry || hash(readFileSync(entry))!==__SHA__) throw Error(\"entry binding\");\n const input=await new Promise((resolve,reject)=>{\n  const timer=setTimeout(()=>reject(Error('configuration deadline')),10000);\n  process.once('message',v=>{clearTimeout(timer);resolve(v)});\n  process.once('disconnect',()=>{clearTimeout(timer);reject(Error('configuration disconnected'))});\n });\n if(!keys(input,['configuration']))throw Error('configuration envelope');\n let stop;let stopping=false,published=false,chain=Promise.resolve();\n const stopped=new Promise(resolve=>{stop=()=>{stopping=true;resolve()}});\n for(const name of ['SIGTERM','SIGINT','disconnect'])process.once(name,stop);\n let runtime;\n const send=value=>new Promise((resolve,reject)=>{\n  if(!process.connected)return reject(Error('IPC disconnected'));\n  process.send(value,error=>error?reject(error):resolve());\n });\n process.on('message',message=>{\n  if(keys(message,['command'])&&message.command==='close'){stop();return}\n  chain=chain.then(async()=>{\n   if(!keys(message,['command','requestId'])||message.command!=='publish-empty-policy'||\n      message.requestId!==1||published||stopping||!runtime)throw Error('unsupported administration');\n   published=true;\n   const policy=await runtime.replaceAuthorizationPolicy({timeoutMs:1000});\n   await send({event:'authorization.published',requestId:1,policy:{\n    revision:policy.revision,bindingKind:policy.bindingKind,generation:policy.generation,\n    authorizationView:policy.authorizationView,readPolicy:policy.readPolicy,canMutate:policy.canMutate}});\n  }).catch(()=>{process.exitCode=2;stop()});\n });\n try{\n  runtime=await (await import(pathToFileURL(entry).href)).startInstalledTransactionCandidate(input.configuration);\n  if(!process.connected)stop();\n  if(!stopping)await send({event:'qualification.ready',...runtime.configurationMetadata,\n   listenUrl:runtime.listenUrl,targets:runtime.targets,payloadIdentity:runtime.payloadIdentity});\n  await stopped;await chain;\n }finally{if(runtime)await runtime.close();if(process.connected)process.disconnect()}\n}\nvoid main().catch(()=>{\n process.stderr.write('private installed authorization adapter failed\\n');\n process.exitCode=2;if(process.connected)process.disconnect();\n});\n"
    .replace("__ENTRY__", JSON.stringify(resolvedEntry))
    .replace("__SHA__", JSON.stringify(entrySha256));
const wrapperSha256 = digest(bootstrap);

it("serves missing-first current Resources and bounds unproved minimum eligibility", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("installed minimum receiving deadline");
  let deadlineExceeded = false,
    cleanupExceeded = false,
    launchAttempted = false,
    closed = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 30000);
  const failures: unknown[] = [];
  const categories: string[] = [];
  const fail = (error: unknown, category: string) => {
    if (!failures.includes(error)) {
      failures.push(error);
      categories.push(category);
    }
  };
  let phase = "setup";
  let directory: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let attempted = 0;
  let controlPrerequisites = false;
  let wrapper: string | undefined;
  let publishedView: string | undefined;
  const active = new Set<ClientRequest>();
  const pending = new Set<Promise<unknown>>();
  const responses: {
    ordinal: number;
    label: string;
    method: string;
    url: string;
    credential: string;
    requestBodyBytes: number;
    requestBodySha256: string | null;
    minimumFieldOccurrences: number[];
    status: number;
    bodyOctets: number;
    bodySha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const writer = randomBytes(32).toString("base64url");
  try {
    expect(Buffer.byteLength(seedBody)).toBe(610);
    directory = mkdtempSync(path.join(tmpdir(), "bdp-minimum-current-installed-"));
    wrapper = path.join(directory, "private-bootstrap.mjs");
    writeFileSync(wrapper, bootstrap, { mode: 0o600, flag: "wx" });
    controller.signal.throwIfAborted();
    launchAttempted = true;
    child = await launchInstalledTransaction(
      wrapper,
      {
        scope,
        directory: path.join(directory, "store"),
        create: true,
        artifacts,
        credentials: [{ token: writer, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
    expect(child.ready.scope).toBe(scope);
    expect(binding.operationTargets.sequence).toBe(scope + "operations/sequence");
    const address = new URL(child.ready.listenUrl as string);
    const granted = new Set([
      scope + "operations/sequence",
      ...rows.map((row) => scope + row.target),
    ]);
    const exchange = async (
      label: string,
      method: "GET" | "HEAD" | "POST" | "PUT",
      url: string,
      fields: string[] = [],
      credential: "writer" | "anonymous" = "writer",
      requestBody?: string,
    ) => {
      phase = label;
      controller.signal.throwIfAborted();
      expect(++attempted, "installed minimum dispatch bound").toBeLessThanOrEqual(32);
      expect(granted.has(url), "fixed or actually issued URL grant").toBe(true);
      const target = new URL(url);
      expect(target.origin).toBe(new URL(scope).origin);
      expect([target.hash, target.username, target.password]).toStrictEqual(["", "", ""]);
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(8192);
      const headers = [
        "Host",
        new URL(scope).host,
        "Connection",
        "close",
        "Accept",
        "application/json",
        ...(credential === "anonymous" ? [] : ["Authorization", `Bearer ${writer}`]),
        ...(requestBody === undefined
          ? []
          : [
              "Content-Type",
              "application/json",
              "Content-Length",
              String(Buffer.byteLength(requestBody)),
            ]),
        ...fields,
      ];
      const operation = new Promise<{
        status: number;
        headers: Headers;
        text: string;
        bytes: number;
        headerDigest: string;
      }>((resolve, reject) => {
        const request = httpRequest(
          {
            hostname: address.hostname,
            port: Number(address.port),
            path: target.pathname + target.search,
            method,
            agent: false,
            headers,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32768) {
                const error = new Error("installed minimum response overflow");
                response.destroy(error);
                request.destroy(error);
                return;
              }
              chunks.push(chunk);
            });
            response.once("aborted", () => reject(new Error("installed minimum response aborted")));
            response.once("error", reject);
            response.once("end", () => {
              const received = new Headers();
              for (let i = 0; i < response.rawHeaders.length; i += 2)
                received.append(response.rawHeaders[i]!, response.rawHeaders[i + 1]!);
              resolve({
                status: response.statusCode ?? 0,
                headers: received,
                text: Buffer.concat(chunks).toString("utf8"),
                bytes,
                headerDigest: responseHeaderDigest(response.rawHeaders),
              });
            });
          },
        );
        active.add(request);
        request.once("close", () => active.delete(request));
        request.once("error", reject);
        request.end(requestBody);
      });
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      const response = await operation;
      const minimumNames = [
        "bdp-minimum-scope-position",
        "bdp-scope-epoch",
        "bdp-authorization-view",
      ];
      responses.push({
        ordinal: attempted,
        label,
        method,
        url,
        credential,
        requestBodyBytes: requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
        requestBodySha256: requestBody === undefined ? null : digest(requestBody),
        minimumFieldOccurrences: minimumNames.map(
          (name) => fields.filter((field, i) => i % 2 === 0 && field.toLowerCase() === name).length,
        ),
        status: response.status,
        bodyOctets: response.bytes,
        bodySha256: digest(response.text),
        headers: Object.fromEntries(
          retainedHeaders.map((name) => [name, response.headers.get(name)]),
        ),
      });
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      return response;
    };
    type Response = Awaited<ReturnType<typeof exchange>>;
    const context = (response: Response) => contextNames.map((name) => response.headers.get(name));

    const parse = (response: Response) => record(JSON.parse(response.text));
    phase = "seed";
    const seeded = await exchange(
      "seed",
      "POST",
      binding.operationTargets.sequence!,
      [],
      "writer",
      seedBody,
    );
    expect(seeded.status).toBe(200);
    const sequence = parse(seeded);
    expect(validSequence(sequence), JSON.stringify(validSequence.errors)).toBe(true);
    const results = sequenceResults(sequence);
    expect(results).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(results[i]?.operationIndex).toBe(i);
      expect(results[i]?.outcome).toBe("created");
      expect(results[i]).not.toHaveProperty("problem");
    }
    const a = record(results[0]?.resource),
      b = record(results[1]?.resource),
      link = record(results[2]?.resource);
    for (const [value, id, title] of [
      [a, "a", "a"],
      [b, "b", "b"],
    ] as const) {
      expect(validResource(value), JSON.stringify(validResource.errors)).toBe(true);
      expect(value).toEqual({
        id: scope + "beads/" + id,
        type: "https://event-sse.invalid/acme/types/bead",
        revision: expect.any(String),
        properties: { title },
        metadata: {},
      });
    }
    expect(validLink(link), JSON.stringify(validLink.errors)).toBe(true);
    expect(link).toEqual({
      id: scope + "links/self",
      type: "https://event-sse.invalid/acme/types/link",
      revision: expect.any(String),
      source: scope + "beads/a",
      target: scope + "beads/a",
      properties: {},
      metadata: {},
    });
    expect(results[3]).toEqual({
      operationIndex: 3,
      outcome: "created",
      alias: scope + "alias/work",
      target: scope + "beads/a",
    });
    const seedContext = context(seeded);
    expect(seedContext[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seedContext[1]).toBe("development-all-visible");
    expect(seedContext[2]).toBe("pos-3");
    let current = [...seedContext],
      firstHidden: Response | undefined,
      firstHiddenFields: string[] | undefined;
    const publish = async () => {
      const owned = child!;
      const policy = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = (error?: unknown, value?: Record<string, unknown>) => {
          clearTimeout(timer);
          owned.child.off("message", receive);
          owned.child.off("exit", exit);
          controller.signal.removeEventListener("abort", abort);
          if (error !== undefined) reject(error);
          else resolve(value!);
        };
        const receive = (message: unknown) => {
          try {
            const m = record(message);
            expect(Object.keys(m).sort()).toEqual(["event", "policy", "requestId"]);
            expect(m.event).toBe("authorization.published");
            expect(m.requestId).toBe(1);
            finish(undefined, record(m.policy));
          } catch (error) {
            finish(error);
          }
        };
        const exit = () => finish(new Error("publication child exited"));
        const abort = () => finish(controller.signal.reason);
        timer = setTimeout(() => finish(new Error("publication response deadline")), 5000);
        owned.child.once("message", receive);
        owned.child.once("exit", exit);
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) {
          abort();
          return;
        }
        owned.child.send({ command: "publish-empty-policy", requestId: 1 }, (error) => {
          if (error) finish(error);
        });
      });
      expect(policy).toEqual({
        revision: 1,
        bindingKind: "scope",
        generation: 1,
        authorizationView: expect.any(String),
        readPolicy: "empty",
        canMutate: false,
      });
      expect(policy.authorizationView).toMatch(/^[0-9a-f-]{36}$/);
      expect(policy.authorizationView).not.toBe(seedContext[1]);
      publishedView = String(policy.authorizationView);
      current = [seedContext[0]!, publishedView, seedContext[2]!];
    };
    const selected =
      mode === "positive"
        ? rows
        : rows.filter((row) => row.index === (mode === "restore-missing-gap" ? 2 : 11));
    for (const row of selected) {
      if (row.index === 18) {
        phase = "publication";
        await publish();
      }
      const tuple = [...current];
      let position = tuple[2]!;
      if (row.minimum === "ahead" || row.minimum === "same-as-first-hidden-ahead")
        position = "pos-4";
      else if (row.minimum?.startsWith("unknown")) position = "opaque";
      if (row.minimum === "foreign-epoch") tuple[0] = "foreign-epoch";
      if (row.minimum === "foreign-view") tuple[1] = "foreign-view";
      let fields = [
        "bdp-scope-epoch",
        tuple[0]!,
        "bdp-authorization-view",
        tuple[1]!,
        "bdp-minimum-scope-position",
        position,
      ];
      if (row.index === 18) firstHiddenFields = [...fields];
      if (row.index === 29) {
        expect(firstHiddenFields).toBeDefined();
        fields = [...firstHiddenFields!];
      }
      if (row.index === 32) fields = ["bdp-minimum-scope-position", "pos-3"];
      const label =
        row.index === 2
          ? "minimum-current:missing-before-minimum"
          : row.index === 11
            ? "minimum-current:unknown-catch-up-timeout"
            : "minimum-current:" + row.index;
      const response = await exchange(
        label,
        row.method,
        scope + row.target,
        fields,
        row.index === 30 ? "anonymous" : "writer",
      );
      if (mode !== "positive") {
        expect(response.status, "counterfactual actual refusal").toBe(500);
        expect(response.headers.get("x-bdp-development-limit")).toBe(
          mode === "restore-missing-gap" ? "minimum-position-visibility" : "minimum-position",
        );
        expect(response.bytes).toBe(0);
        expect(context(response)).toEqual([null, null, null]);
        expect(attempted).toBe(2);
        expect(responses).toHaveLength(2);
        controlPrerequisites = true;
      }
      expect(response.status, label).toBe(row.status);
      if (row.status === 404 || row.status === 503) {
        expect(context(response)).toEqual(current);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        for (const name of ["etag", "last-modified", "location", "x-bdp-development-limit"])
          expect(response.headers.has(name)).toBe(false);
        const expected =
          row.status === 404
            ? {
                type: "https://github.com/gastownhall/bdp/problems/not-found",
                code: "resource-not-found",
                status: 404,
                retry: "after-state-change",
              }
            : {
                type: "https://github.com/gastownhall/bdp/problems/unavailable",
                code: "catch-up-timeout",
                status: 503,
                retry: "after-delay",
              };
        if (row.status === 503) expect(response.headers.get("retry-after")).toBe("1");
        if (row.method === "HEAD") {
          expect(response.bytes).toBe(0);
          expect(Number(response.headers.get("content-length"))).toBe(
            Buffer.byteLength(JSON.stringify(expected)),
          );
        } else {
          const value = parse(response);
          expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
          expect(value).toEqual(expected);
          expect(Number(response.headers.get("content-length"))).toBe(response.bytes);
        }
        if (row.index === 18) {
          firstHidden = response;
          current = context(response);
          expect(current).toEqual([seedContext[0], publishedView, "pos-3"]);
        }
        if (row.index === 29) {
          expect(response.text).toBe(firstHidden!.text);
          expect(response.headerDigest).toBe(firstHidden!.headerDigest);
          for (const name of retainedHeaders)
            expect(response.headers.get(name)).toBe(firstHidden!.headers.get(name));
        }
      } else if (row.status === 200) {
        expect(parse(response)).toEqual(a);
        expect(context(response)).toEqual(seedContext);
      } else {
        expect(context(response)).toEqual([null, null, null]);
        if (row.status === 405) {
          expect(response.bytes).toBe(0);
          expect(response.headers.get("allow")).toBe("GET, HEAD");
        } else {
          if (row.status === 401)
            expect(response.headers.get("www-authenticate")).toBe(
              'Bearer realm="bdp-transaction-development"',
            );
          const value = parse(response);
          expect(validProblem(value), JSON.stringify(validProblem.errors)).toBe(true);
          expect(value).toMatchObject({
            status: row.status,
            code: row.status === 401 ? "unauthenticated" : "malformed-request",
          });
        }
      }
    }
    expect(mode).toBe("positive");
    expect(attempted).toBe(32);
    expect(responses).toHaveLength(32);
    controller.signal.throwIfAborted();
  } catch (error) {
    fail(error, phase);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    for (const request of active) request.destroy();
    const cleanupReason = new Error("installed minimum cleanup deadline");
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleaning = (async () => {
      for (const result of await Promise.allSettled([...pending]))
        if (result.status === "rejected") fail(result.reason, "transport-drain");
      if (child) {
        await child.close();
        closed = true;
      }
    })();
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupExceeded = true;
            child?.child.kill("SIGKILL");
            reject(cleanupReason);
          }, 10000);
        }),
      ]);
    } catch (error) {
      fail(error, "cleanup");
    } finally {
      clearTimeout(cleanupTimer);
    }
    const stopped =
      !launchAttempted ||
      (child !== undefined && (child.child.exitCode !== null || child.child.signalCode !== null));
    if (!stopped) fail(new Error("installed minimum child stop unknown"), "unknown-stop");
    try {
      if (directory && stopped) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      fail(error, "directory-cleanup");
    }
    const directoryAbsent = directory === undefined || !existsSync(directory);
    if (!directoryAbsent)
      fail(new Error("installed minimum directory preserved"), "directory-retained");
    if (deadlineExceeded) fail(deadlineReason, "deadline");
    try {
      const report = JSON.stringify({
        observation: "private-installed-minimum-current-resource",
        mode,
        controlPrerequisites,
        publishedView: publishedView ?? null,
        wrapper: wrapper ?? null,
        wrapperSha256,
        outcome: failures.length ? "failed" : "passed",
        declaredSourceCommit: sourceCommit,
        workspaceDirty,
        entry: resolvedEntry,
        entrySha256,
        binding: binding ?? null,
        artifactBytes:
          artifacts.descriptors.reduce((n, d) => n + Buffer.byteLength(d.utf8), 0) +
          artifacts.schemas.reduce((n, s) => n + Buffer.byteLength(s.utf8), 0),
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        deadlineExceeded,
        cleanupExceeded,
        launchAttempted,
        startupCompleted: child !== undefined,
        closed,
        childPid: child?.child.pid ?? null,
        childExitCode: child?.child.exitCode ?? null,
        childSignalCode: child?.child.signalCode ?? null,
        directory: directory ?? null,
        directoryAbsent,
        failureCount: failures.length,
        failureCategories: categories,
        claimEligible: false,
        retention:
          "safe response headers and body fingerprints; actual bodies asserted in memory; no credentials or raw configuration retained",
        startupLimitation:
          "attempted launch without returned child leaves stop unknown and preserves owned directory for supervisor evidence",
      });
      if (Buffer.byteLength(report) > 65536)
        fail(new Error("minimum current report ceiling"), "report");
      else console.log(report);
    } catch (error) {
      fail(error, "report");
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "installed minimum receiving and cleanup failed");
}, 45000);
