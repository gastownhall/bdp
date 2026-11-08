/**
 * The Callables profile's and the Issue package's rows, run by current-provider-kit.mjs.
 * Black-box over the public wire: the kit learns what is reachable from `GET <scope>/bdp/call`
 * and each record from its canonical URL. An adapter or operator may name a witness (which
 * Callable, which arguments) because no outside observer can find one; it never supplies an
 * expected answer, and every expectation here is the specification's.
 */
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assertValidDeclaration } from "./generate-callable-catalog.mjs";
import { parseSchema } from "./markdown-schema.mjs";

const media = "application/vnd.bdp.v0.1+json";
const problemMedia = "application/problem+json";
const families = "https://github.com/gastownhall/bdp/problems/";
const CALLABLES = "https://github.com/gastownhall/bdp/capabilities/callables";
const IDEMPOTENCY = "https://github.com/gastownhall/bdp/capabilities/idempotency";
const TYPE_ROOT = "https://github.com/gastownhall/bdp/types/callable/";
const QUERY = `${TYPE_ROOT}callable-query`;
const BATCH = `${TYPE_ROOT}callable-batch`;
const ISSUE = "https://github.com/gastownhall/bdp/types/issue/";
const DEPENDENCY = "https://github.com/gastownhall/bdp/types/dependency/";
const ISSUE_TYPES = new Set(
  [
    "task",
    "bug",
    "feature",
    "epic",
    "chore",
    "decision",
    "message",
    "molecule",
    "gate",
    "spike",
    "story",
    "milestone",
    "event",
  ].map((name) => ISSUE + name),
);
const DEPENDENCY_TYPES = new Set(
  [
    "blocks",
    "parent-child",
    "conditional-blocks",
    "waits-for",
    "related",
    "discovered-from",
    "replies-to",
    "relates-to",
    "duplicates",
    "supersedes",
    "authored-by",
    "assigned-to",
    "approved-by",
    "attests",
    "tracks",
    "until",
    "caused-by",
    "validates",
    "delegated-from",
  ].map((name) => DEPENDENCY + name),
);
const OBSERVATIONS = ["lease_expires_at", "heartbeat_at", "lease_granted_node", "is_blocked"];
const ACTOR = { actor: { id: "provider-kit", basis: "writer-supplied" } };

class RowFailure extends Error {}
class RowNotRun extends Error {}
class RowNotApplicable extends Error {}
const fail = (message) => {
  throw new RowFailure(message);
};
const notRun = (message) => {
  throw new RowNotRun(message);
};
const notApplicable = (message) => {
  throw new RowNotApplicable(message);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
/** Only what is safe to repeat in a report: a status, or a token-shaped code. */
const said = (reply) => {
  const code = reply.json?.code;
  return `HTTP ${reply.status}${typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? ` ${code}` : ""}`;
};
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

/** Fully expand references, so two spellings of one schema compare equal. */
function expanded(schema, document, seen = []) {
  if (Array.isArray(schema)) return schema.map((entry) => expanded(entry, document, seen));
  if (schema === null || typeof schema !== "object") return schema;
  let out = {};
  for (const [name, value] of Object.entries(schema)) {
    if (name === "$defs" || name === "definitions") continue;
    if (name === "$ref") continue;
    // A member named as data must keep its meaning; default, const and enum hold values.
    out[name] = ["const", "default", "enum", "examples"].includes(name)
      ? value
      : expanded(value, document, seen);
  }
  if (typeof schema.$ref === "string") {
    if (seen.includes(schema.$ref)) return { ...out, recursive: true };
    const target = schema.$ref
      .slice(2)
      .split("/")
      .map((part) => decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce((node, part) => node?.[part], document);
    out = { ...expanded(target ?? {}, document, [...seen, schema.$ref]), ...out };
  }
  return out;
}
/** Help text out, everywhere; `properties` may name a member `description`, which stays. */
function withoutProse(schema) {
  if (Array.isArray(schema)) return schema.map(withoutProse);
  if (schema === null || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema).flatMap(([name, value]) => {
      if (name === "description" && typeof value === "string") return [];
      if (name === "properties" && value !== null && typeof value === "object")
        return [
          [
            name,
            Object.fromEntries(
              Object.entries(value).map(([member, entry]) => [member, withoutProse(entry)]),
            ),
          ],
        ];
      return [
        [
          name,
          ["const", "default", "enum", "examples"].includes(name) ? value : withoutProse(value),
        ],
      ];
    }),
  );
}
const withoutHelp = (schema) => {
  if (schema === null || typeof schema !== "object") return schema;
  const { description: _description, default: _default, ...rest } = schema;
  return rest;
};

/** One value satisfying a schema, for a witness the operator did not name. */
function sample(schema, root, unique) {
  if (schema === true || schema === undefined || schema === null) return unique();
  if (typeof schema.$ref === "string") {
    const target = schema.$ref
      .slice(2)
      .split("/")
      .reduce((node, part) => node?.[part], root);
    return sample(target, root, unique);
  }
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const group of ["oneOf", "anyOf"])
    if (Array.isArray(schema[group])) return sample(schema[group][0], root, unique);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") return schema.minimum ?? 1;
  if (type === "array")
    return Array.from({ length: schema.minItems ?? 1 }, () => sample(schema.items, root, unique));
  if (type === "object" || schema.properties)
    return Object.fromEntries(
      (schema.required ?? []).map((name) => [
        name,
        sample(schema.properties?.[name], root, unique),
      ]),
    );
  if (schema.format === "date") return "2026-11-20";
  if (schema.format === "date-time") return "2026-11-20T00:00:00Z";
  return unique();
}

/** Declared arguments for each of the 45 names, once the recipe has made what they name. */
function issueInvocations(ids, unique) {
  const [a, b, c, d, e] = ids;
  const key = `kit.${unique()}`;
  const memory = `kit-${unique()}`;
  return [
    ["issue/context", {}],
    ["issue/ready", {}],
    ["issue/ready-count", {}],
    ["issue/stats", {}],
    ["issue/blocked", {}],
    ["issue/dep/cycles", {}],
    ["issue/dep/tree", { root_id: a }],
    ["issue/list", {}],
    ["issue/query", { q: "status=open" }],
    ["issue/count", {}],
    ["issue/show", { id: a }],
    ["issue/dep/list", { id: a }],
    ["issue/get-many", { ids: [a] }],
    ["issue/dep/edges", { issue_id: [a] }],
    ["issue/dep/count", { issue_id: [a], direction: "out" }],
    ["issue/blocking-annotations", { issue_id: [a] }],
    ["config/list", {}],
    ["config/set", { key, value: "1" }],
    ["config/get", { key }],
    ["config/unset", { key }],
    ["memory/list", {}],
    ["memory/remember", { content: "kit", key: memory }],
    ["memory/recall", { key: memory }],
    ["memory/forget", { key: memory }],
    ["events/list", { since: 0 }],
    ["issue/create", { title: `kit ${unique()}` }],
    ["issue/update", { id: a, patch: { description: "kit" } }],
    ["issue/comment", { id: a, text: "kit" }],
    ["issue/claim", { id: b }],
    ["issue/heartbeat", { id: b }],
    ["issue/unclaim", { id: b }],
    ["issue/close", { id: c }],
    ["issue/reopen", { id: c }],
    ["issue/advance", { id: c }],
    ["issue/metadata/compare-and-set", { id: a, key: "kit" }],
    ["issue/purge", {}],
    ["issue/prune", { pattern: "kit-matches-nothing-*" }],
    ["issue/delete", { ids: [d] }],
    ["issue/reclaim", {}],
    [
      "issue/create-many",
      { items: [{ title: `kit ${unique()}`, priority: 2, type: `${ISSUE}task` }] },
    ],
    [
      "issue/batch",
      {
        items: [
          {
            kind: "create",
            create: { title: `kit ${unique()}`, priority: 2, type: `${ISSUE}task` },
          },
        ],
      },
    ],
    ["issue/close-many", { items: [{ id: e }] }],
    ["issue/claim-next", {}],
    ["issue/dep/add", { source: a, target: b }],
    ["issue/dep/remove", { issue_id: a, depends_on_id: b }],
  ];
}

const catalogRead = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const catalogRows = async (file) =>
  JSON.parse(await catalogRead(`packages/conformance/catalog/current/${file}`)).scenarios;
const optionalDefinitions = async () => [
  ...(await catalogRows("callables-v1.json")),
  ...(await catalogRows("issue-package-v1.json")),
];
/** The name a report gives a row, and an exceptions ledger names it by. */
const rowLabel = (id) => {
  const label = /\.(cb|it|ic)-(\d+)$/.exec(id);
  return label ? `${label[1].toUpperCase()}-${label[2]}` : id;
};
export const optionalRowNames = async () =>
  (await optionalDefinitions()).map(({ id }) => rowLabel(id));

export async function runOptionalRows({
  scope,
  discovered,
  runId,
  allowMutation,
  witnesses,
  exchange,
  exceptions,
}) {
  const read = catalogRead;
  const rows = (await optionalDefinitions()).map(({ id, title, requirements }) => ({
    id,
    row: rowLabel(id),
    title,
    source: `${requirements[0].source}${requirements[0].anchor}`,
    state: "not-run",
    reason: "Prerequisite did not complete",
  }));
  const finish = () => {
    for (const row of rows) {
      const excepted = exceptions?.[row.row];
      if (excepted !== undefined) {
        row.observed = row.state;
        if (row.reason !== undefined) row.observedReason = row.reason;
        row.state = "excepted";
        row.reason = excepted;
      }
    }
    return rows;
  };
  if (discovered === undefined) return finish();

  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
  const compiled = new Map();
  /** undefined when the value satisfies the schema, or the schema cannot be compiled. */
  const violates = (schema, value) => {
    if (schema === undefined) return false;
    const text = canonical(schema);
    let validate = compiled.get(text);
    if (validate === undefined) {
      try {
        validate = ajv.compile(schema);
      } catch {
        validate = null;
      }
      compiled.set(text, validate);
    }
    return validate === null ? false : !validate(value);
  };
  const callablePropertiesSchema = parseSchema(
    await read("specs/profiles/callables/callable-properties.md"),
  );
  const published = new Map(
    JSON.parse(
      await read("packages/bd-domain/catalog/issue-callables-preview-1.json"),
    ).declarations.map((declaration) => [declaration.name, declaration]),
  );
  let counter = 0;
  const unique = () => `${runId.slice(0, 8)}-${++counter}`;
  const http = async (target, method = "GET", body, key, options) => {
    const reply = await exchange(target, method, body, key, options);
    let parsed;
    try {
      parsed = reply.bytes.length
        ? JSON.parse(Buffer.from(reply.bytes).toString("utf8"))
        : undefined;
    } catch {
      parsed = undefined;
    }
    return { ...reply, json: parsed };
  };
  const mediaOf = (reply) => reply.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  const url = (local) => new URL(local, scope).href;
  const capabilities = discovered.capabilities ?? {};
  const callablesAdvertised = capabilities[CALLABLES]?.["1"] !== undefined;
  const idempotency = capabilities[IDEMPOTENCY]?.["1"] !== undefined;
  const writeAdvertised = discovered.profile === "write";

  const requireCallables = () => {
    if (!callablesAdvertised)
      notApplicable("Not applicable by discovery: the Scope does not advertise Callables1");
  };
  const requireMutation = () => {
    if (!allowMutation)
      notRun("Not run: this case changes the Scope, and --scope mode needs --allow-mutation");
  };

  let catalogPromise;
  const callables = () =>
    (catalogPromise ??= (async () => {
      const reply = await http(url("bdp/call"));
      if (reply.status !== 200 || reply.json?.paths === undefined)
        throw new RowFailure(`GET bdp/call answered ${said(reply)} with no OpenAPI paths`);
      const prefix = `${new URL(scope).pathname}bdp/call/`;
      const out = [];
      for (const [path, item] of Object.entries(reply.json.paths)) {
        if (!path.startsWith(prefix)) throw new RowFailure("An OpenAPI path is outside the mounts");
        const op = item?.post;
        const type = op?.["x-bdp-callable"]?.type;
        out.push({
          name: path.slice(prefix.length),
          path,
          item,
          op,
          type,
          batch: type === BATCH,
          compiled: op?.["x-bdp-callable"]?.compiled === true,
          parameters: op?.requestBody?.content?.[media]?.schema?.properties?.arguments ?? {},
        });
      }
      return { document: reply.json, reply, list: out };
    })());
  const declarations = new Map();
  /** The record at a name, when the Scope serves one. */
  async function beadOf(callable) {
    if (!declarations.has(callable.name))
      declarations.set(callable.name, await http(url(callable.name)));
    return declarations.get(callable.name);
  }
  /** Callables §14's rule backwards: the declaration a compiled Callable's operation states. */
  function rebuiltDeclaration(callable, document) {
    const { op, parameters: args } = callable;
    // §2.3: a $ref resolves inside the document that carries it, here the OpenAPI document.
    const carried = (schema) =>
      schema !== null &&
      typeof schema === "object" &&
      JSON.stringify(schema).includes("#/components/")
        ? { ...schema, components: document.components }
        : schema;
    const extension = op["x-bdp-callable"];
    const required = args.required ?? [];
    const member = (status, name) =>
      op.responses?.[status]?.content?.[media]?.schema?.properties?.[name];
    const present = (entries) =>
      Object.fromEntries(entries.filter(([, value]) => value !== undefined));
    return present([
      ["title", op.summary],
      ["description", op.description ?? ""],
      [
        "parameters",
        Object.entries(args.properties ?? {}).map(([name, projected]) => {
          const { description, default: fallback, ...schema } = projected;
          return present([
            ["name", name],
            ["schema", carried(schema)],
            ["description", description],
            ["default", fallback],
            ["required", required.includes(name) ? true : undefined],
          ]);
        }),
      ],
      ["resultSchema", carried(member("200", "result"))],
      ["errorSchema", carried(member("409", "error"))],
      ["idempotent", extension.idempotent],
      ["atomic", extension.atomic],
      ["cliMapping", extension.cliMapping],
    ]);
  }
  /** The declaration to read a callable by: its own Bead, or the package's published text. */
  async function declarationOf(callable) {
    const reply = await beadOf(callable);
    if (reply.status === 200 && reply.json?.properties)
      return { source: "bead", ...reply.json.properties, name: callable.name };
    const known = published.get(callable.name);
    return known === undefined ? undefined : { source: "published", ...known };
  }
  const requiredOf = (callable) => callable.parameters.required ?? [];
  const invoke = (callable, args, options = {}) => {
    const key = options.noKey
      ? undefined
      : (options.key ?? (callable.batch && idempotency ? `kit-${unique()}` : undefined));
    return http(
      url(`bdp/call/${callable.name}`),
      "POST",
      {
        arguments: args,
        ...(options.provenance === undefined ? {} : { revisionProvenance: options.provenance }),
      },
      key,
      options.request,
    );
  };
  const named = async (name) => (await callables()).list.find((entry) => entry.name === name);
  const zeroRequiredQueries = async () =>
    (await callables()).list.filter((c) => !c.batch && requiredOf(c).length === 0);

  async function allRecords(kind) {
    const items = [];
    let target = url(`bdp/${kind}`);
    for (let guard = 0; target !== undefined && guard < 200; guard++) {
      const reply = await http(target);
      check(reply.status === 200, `The ${kind} inventory answered ${said(reply)}`);
      items.push(...reply.json.items);
      target = reply.json.next ? new URL(reply.json.next, scope).href : undefined;
    }
    return items;
  }
  /** Every Resource's revision: Core's own measure of whether anything changed. */
  async function revisions() {
    const state = {};
    for (const kind of ["beads", "links"])
      for (const item of await allRecords(kind)) state[item.id] = item.revision;
    return state;
  }
  const changedBetween = (before, after) => {
    const moved = new Set(
      [...Object.keys(before), ...Object.keys(after)].filter((id) => before[id] !== after[id]),
    );
    return moved.size;
  };
  const problemShape = (reply, status, code, family, retry) => {
    check(reply.status === status, `Expected HTTP ${status} ${code}, answered ${said(reply)}`);
    check(mediaOf(reply) === problemMedia, `${code} is not application/problem+json`);
    check(reply.json?.code === code, `Expected code ${code}, answered ${said(reply)}`);
    check(reply.json?.type === families + family, `${code} has the wrong problem family`);
    if (retry !== undefined) check(reply.json?.retry === retry, `${code} has the wrong retry`);
  };

  /** Issues made with the tracker's own Callable, for a witness only the tracker can give. */
  async function issueIds(count) {
    const create = await named("issue/create");
    if (create === undefined) notRun("No witness: `issue/create` is not reachable");
    requireMutation();
    const ids = [];
    for (let index = 0; index < count; index++) {
      const reply = await invoke(create, { title: `kit ${unique()}` }, { provenance: ACTOR });
      check(reply.status === 200, `issue/create answered ${said(reply)}`);
      ids.push(reply.json.result?.id ?? fail("issue/create returned no id"));
    }
    return ids;
  }

  async function run(id, action) {
    const row = rows.find((entry) => entry.id === id);
    try {
      const note = await action();
      row.state = "pass";
      delete row.reason;
      if (typeof note === "string") row.note = note;
    } catch (error) {
      if (error instanceof RowFailure) {
        row.state = "fail";
        row.reason = error.message;
      } else if (error instanceof RowNotRun) {
        row.state = "not-run";
        row.reason = error.message;
      } else if (error instanceof RowNotApplicable) {
        row.state = "not-applicable";
        row.reason = error.message;
      } else {
        row.state = "harness-error";
        row.reason = "The exchange did not complete";
      }
    }
  }

  // ---- CB rows ----
  await run("callables.cb-1", () => {
    requireCallables();
    check(
      canonical(capabilities[CALLABLES]["1"]) === "{}",
      "Version 1's detail is not the closed empty object",
    );
  });
  await run("callables.cb-2", async () => {
    requireCallables();
    const { list, document } = await callables();
    check(list.length > 0, "No reachable Callable to resolve");
    const noBead = [];
    const wrongType = [];
    const invalid = [];
    const compiledWithBead = [];
    let firstInvalid;
    const validate = ajv.compile(callablePropertiesSchema);
    const satisfies = (properties, type, name) => {
      if (!validate(properties)) {
        firstInvalid ??= `${name}: ${ajv.errorsText(validate.errors)}`;
        return false;
      }
      try {
        // That check reads a catalog entry, where resultSchema is always present.
        assertValidDeclaration({ resultSchema: true, ...properties, name, type });
        return true;
      } catch (error) {
        firstInvalid ??= `${name}: ${error.message}`;
        return false;
      }
    };
    for (const callable of list) {
      const reply = await beadOf(callable);
      if (callable.compiled) {
        // A compiled declaration isn't a Bead (§2.1), so a record at its name contradicts the mark.
        if (reply.status === 200) compiledWithBead.push(callable.name);
        else if (![QUERY, BATCH].includes(callable.type)) wrongType.push(callable.name);
        else if (!satisfies(rebuiltDeclaration(callable, document), callable.type, callable.name))
          invalid.push(callable.name);
        continue;
      }
      if (reply.status !== 200) {
        noBead.push(callable.name);
        continue;
      }
      if (![QUERY, BATCH].includes(reply.json?.type)) {
        wrongType.push(callable.name);
        continue;
      }
      const valid = satisfies(reply.json.properties, reply.json.type, callable.name);
      if (!valid) invalid.push(callable.name);
    }
    check(
      noBead.length === 0,
      `${noBead.length} of ${list.length} reachable names resolve to no Bead record`,
    );
    check(
      compiledWithBead.length === 0,
      `${compiledWithBead.length} names marked compiled also have a record`,
    );
    check(wrongType.length === 0, `${wrongType.length} names resolve to the wrong Type`);
    check(invalid.length === 0, `${invalid.length} declarations fail §§2.2-2.5: ${firstInvalid}`);
  });
  await run("callables.cb-3", async () => {
    requireCallables();
    const queries = await zeroRequiredQueries();
    if (queries.length === 0) notRun("No reachable CallableQuery has no required parameter");
    const notes = [];
    for (const callable of queries) {
      const reply = await invoke(callable, {});
      if (reply.status === 503 && reply.json?.code === "callable-unavailable") continue;
      check(reply.status === 200, `${callable.name} answered ${said(reply)}`);
      check(mediaOf(reply) === media, `${callable.name}: result media is not the base media`);
      const cache = (reply.headers["cache-control"] ?? "")
        .split(",")
        .map((directive) => directive.trim().toLowerCase());
      check(cache.includes("private") && cache.includes("no-store"), "A result must be no-store");
      check(
        reply.headers.etag === undefined && reply.headers.location === undefined,
        "ETag or Location on a result",
      );
      check(
        Object.hasOwn(reply.json ?? {}, "result") && Object.keys(reply.json).length === 1,
        `${callable.name}: a query's result is not the closed callableResult`,
      );
      const declared = await declarationOf(callable);
      check(
        !violates(declared?.resultSchema, reply.json.result),
        `${callable.name}: result violates its declared resultSchema`,
      );
      notes.push(callable.name);
    }
    if (notes.length === 0) notRun("Every candidate query answered callable-unavailable");
    return `${notes.length} queries invoked`;
  });
  await run("callables.cb-4", async () => {
    requireCallables();
    const queries = await zeroRequiredQueries();
    const callable = queries[0] ?? (await callables()).list[0];
    if (callable === undefined) notRun("No reachable Callable");
    const unknown = `bdp_kit_unknown_${counter}`;
    const reply = await invoke(callable, { [unknown]: 1 });
    problemShape(reply, 422, "validation-failed", "validation", "never");
    check(JSON.stringify(reply.json).includes(unknown), "The refusal does not name the argument");
  });
  await run("callables.cb-5", async () => {
    requireCallables();
    const { list } = await callables();
    const withRequired =
      list.find((c) => !c.batch && requiredOf(c).length > 0) ??
      list.find((c) => requiredOf(c).length > 0);
    if (withRequired === undefined) notRun("No reachable Callable has a required parameter");
    const reply = await invoke(withRequired, {});
    problemShape(reply, 422, "validation-failed", "validation", "never");
    check(
      requiredOf(withRequired).some((name) => JSON.stringify(reply.json).includes(name)),
      "The refusal does not name the missing parameter",
    );
    for (const callable of list.filter((c) => !c.batch && requiredOf(c).length === 0)) {
      const declared = Object.entries(callable.parameters.properties ?? {}).find(
        ([, schema]) =>
          schema !== null && typeof schema === "object" && Object.hasOwn(schema, "default"),
      );
      if (declared === undefined) continue;
      const omitted = await invoke(callable, {});
      if (omitted.status === 503 && omitted.json?.code === "callable-unavailable") continue;
      const explicit = await invoke(callable, { [declared[0]]: declared[1].default });
      check(omitted.status === 200, `${callable.name} with the default omitted: ${said(omitted)}`);
      check(explicit.status === 200, `${callable.name} with the default given: ${said(explicit)}`);
      check(
        canonical(omitted.json) === canonical(explicit.json),
        `${callable.name}: omitting a defaulted parameter differs from supplying its default`,
      );
      return;
    }
    notRun("No reachable CallableQuery with no required parameter has a default");
  });
  await run("callables.cb-6", async () => {
    requireCallables();
    for (const name of [`bdp-kit-absent-${runId}`, `bdp-kit-absent/${runId}/deep`]) {
      const reply = await http(url(`bdp/call/${name}`), "POST", { arguments: {} }, undefined);
      problemShape(reply, 404, "callable-not-found", "not-found", "after-state-change");
    }
  });
  /** A witness batch: named by the adapter, the tracker's recipe, or sampled from its schema. */
  async function batchWitness(prefer) {
    const given = witnesses.callables?.[prefer];
    if (given !== undefined) {
      const callable = await named(given.name);
      if (callable === undefined) notRun(`The named witness ${given.name} is not reachable`);
      return { callable, args: given.arguments, provenance: given.provenance };
    }
    if (prefer === "idempotentBatch" && (await named("issue/close")) !== undefined) {
      const [id] = await issueIds(1);
      return { callable: await named("issue/close"), args: { id }, provenance: ACTOR };
    }
    if (prefer === "batch" && (await named("issue/create")) !== undefined)
      return {
        callable: await named("issue/create"),
        args: { title: `kit ${unique()}` },
        provenance: ACTOR,
      };
    const { list } = await callables();
    const candidate = list.find(
      (c) =>
        c.batch && (prefer !== "idempotentBatch" || c.op?.["x-bdp-callable"]?.idempotent === true),
    );
    if (candidate === undefined) notRun("No reachable CallableBatch of the kind this case needs");
    const schema = candidate.parameters;
    return { callable: candidate, args: sample({ ...schema, type: "object" }, schema, unique) };
  }
  await run("callables.cb-7", async () => {
    requireCallables();
    requireMutation();
    if (idempotency) {
      const { callable, args, provenance } = await batchWitness("batch");
      const options = provenance === undefined ? {} : { provenance };
      const keyless = await invoke(callable, args, { ...options, noKey: true });
      check(keyless.status === 400, `A batch without Idempotency-Key answered ${said(keyless)}`);
      check(keyless.json?.code === "malformed-request", `No-key refusal: ${said(keyless)}`);
      const key = `kit-${unique()}`;
      const first = await invoke(callable, args, { ...options, key });
      check(first.status === 200, `${callable.name} answered ${said(first)}`);
      check(typeof first.json?.changed === "boolean", "A batch's result needs `changed`");
      const state = await revisions();
      const replay = await invoke(callable, args, { ...options, key });
      check(replay.status === 200, `The replay answered ${said(replay)}`);
      check(
        canonical(replay.json) === canonical(first.json),
        "The replay is not the original result",
      );
      check(changedBetween(state, await revisions()) === 0, "The replay changed a revision");
      return "under idempotency";
    }
    const { callable, args, provenance } = await batchWitness("idempotentBatch");
    const options = provenance === undefined ? {} : { provenance };
    const first = await invoke(callable, args, options);
    check(first.status === 200, `${callable.name} answered ${said(first)}`);
    const state = await revisions();
    const repeat = await invoke(callable, args, options);
    check(repeat.status === 200, `The repeat of ${callable.name} answered ${said(repeat)}`);
    const moved = changedBetween(state, await revisions());
    check(moved === 0, `Repeating idempotent ${callable.name} changed ${moved} revision(s)`);
    return `without idempotency, by repeating ${callable.name}`;
  });
  await run("callables.cb-8", async () => {
    requireCallables();
    const { list } = await callables();
    const queries = list.filter((c) => !c.batch);
    if (queries.length === 0) notRun("No reachable CallableQuery");
    const before = await revisions();
    let invoked = 0;
    for (const callable of queries) {
      const schema = callable.parameters;
      const reply = await invoke(callable, sample({ ...schema, type: "object" }, schema, unique));
      if (reply.status < 500) invoked++;
    }
    const moved = changedBetween(before, await revisions());
    check(moved === 0, `Invoking queries changed ${moved} revision(s)`);
    return `${invoked} of ${queries.length} queries answered below 500`;
  });
  let unimplementedSeen;
  await run("callables.cb-12", async () => {
    requireCallables();
    const root = await http(url("sys/callables"));
    if (root.status !== 200)
      notApplicable("Not applicable by discovery: the Scope has no root Bead at sys/callables");
    if (!writeAdvertised)
      notApplicable("Not applicable by discovery: creating the Link needs Write, not advertised");
    requireMutation();
    const links = await http(url("sys/callables?view=links&direction=outbound&limit=1000"));
    check(links.status === 200, `The root's Links answered ${said(links)}`);
    const { list } = await callables();
    const targets = links.json.items.map((link) => link.target).sort();
    check(
      canonical(targets) === canonical(list.map((c) => url(c.name)).sort()),
      "GET bdp/call does not list exactly the root's live Link targets",
    );
    const linkType = links.json.items[0]?.type;
    if (linkType === undefined)
      notRun("§12 names no Link Type and the root has no Link to read one from");
    // Core fixes every Write operation at bdp/operations/NAME.
    const name = `kit-unexposed-${unique()}`;
    const created = await http(
      url("bdp/operations/createBead"),
      "POST",
      {
        id: name,
        type: QUERY,
        properties: { description: "Declared by the provider kit.", parameters: [] },
        metadata: {},
      },
      `kit-${unique()}`,
    );
    check(created.status === 200, `Creating a declaration answered ${said(created)}`);
    const mount = url(`bdp/call/${name}`);
    const before = await http(mount, "POST", { arguments: {} });
    problemShape(before, 404, "callable-not-found", "not-found", "after-state-change");
    const linked = await http(
      url("bdp/operations/createLink"),
      "POST",
      {
        type: linkType,
        source: url("sys/callables"),
        target: url(name),
        properties: {},
        metadata: {},
      },
      `kit-${unique()}`,
    );
    check(linked.status === 200, `Creating the Link answered ${said(linked)}`);
    const after = await http(mount, "POST", { arguments: {} });
    check(after.status !== 404, "The Link did not make the declaration reachable");
    unimplementedSeen = after;
  });
  await run("callables.cb-9", async () => {
    requireCallables();
    const named9 = witnesses.callables?.unimplemented;
    let reply = unimplementedSeen;
    if (named9 !== undefined) {
      const callable = await named(named9);
      if (callable === undefined) notRun(`The named witness ${named9} is not reachable`);
      reply = await invoke(callable, {});
    }
    if (reply === undefined)
      notRun("No witness: nothing outside the provider can find a Callable with no implementation");
    problemShape(reply, 503, "callable-unavailable", "unavailable", "after-state-change");
    check(!Object.hasOwn(reply.json, "error"), "callable-unavailable carries an `error` member");
  });
  await run("callables.cb-10", async () => {
    requireCallables();
    let reply;
    let callable;
    const given = witnesses.callables?.callableError;
    if (given !== undefined) {
      callable = await named(given.name);
      if (callable === undefined) notRun(`The named witness ${given.name} is not reachable`);
      requireMutation();
      reply = await invoke(
        callable,
        given.arguments,
        given.provenance === undefined ? {} : { provenance: given.provenance },
      );
    } else if ((await named("issue/claim")) !== undefined) {
      const [id] = await issueIds(1);
      callable = await named("issue/claim");
      const first = await invoke(callable, { id }, { provenance: ACTOR });
      check(first.status === 200, `issue/claim answered ${said(first)}`);
      reply = await invoke(
        callable,
        { id },
        { provenance: { actor: { id: "provider-kit-other", basis: "writer-supplied" } } },
      );
    } else notRun("No witness: nothing outside the provider can force an operation's own error");
    problemShape(reply, 409, "callable-error", "conflict", "after-state-change");
    check(Object.hasOwn(reply.json, "error"), "callable-error has no `error` member");
    const declared = await declarationOf(callable);
    check(!violates(declared?.errorSchema, reply.json.error), "`error` violates its errorSchema");
  });
  await run("callables.cb-11", async () => {
    requireCallables();
    const { list } = await callables();
    if (list.length === 0) notRun("No reachable Callable");
    const stored = list.filter((callable) => !callable.compiled);
    if (stored.length === 0)
      notApplicable(
        "Not applicable by discovery: every declaration is compiled, so none is a Bead",
      );
    for (const callable of stored) {
      const reply = await beadOf(callable);
      check(
        reply.status === 200,
        `GET of ${callable.name}'s canonical URL answered ${said(reply)}`,
      );
      check(reply.headers["bdp-resource-kind"] === "bead", "The record is not served as a Bead");
      check(mediaOf(reply) === media, "The record is not the base media");
      check(reply.json?.id === url(callable.name), "The record's id is not its canonical URL");
      for (const member of ["type", "revision", "properties", "metadata"])
        check(Object.hasOwn(reply.json, member), `The record has no \`${member}\``);
    }
  });
  await run("callables.cb-13", async () => {
    requireCallables();
    requireMutation();
    let callable;
    let args;
    let provenance;
    let weak = false;
    const given = witnesses.callables?.atomicProblem;
    if (given !== undefined) {
      callable = await named(given.name);
      if (callable === undefined) notRun(`The named witness ${given.name} is not reachable`);
      args = given.arguments;
      provenance = given.provenance;
    } else if ((await named("issue/create-many")) !== undefined) {
      callable = await named("issue/create-many");
      args = {
        items: [
          { title: `kit ${unique()}`, priority: 2, type: `${ISSUE}task` },
          { title: "", priority: 2, type: `${ISSUE}task` },
        ],
      };
      provenance = ACTOR;
    } else {
      callable = (await callables()).list.find(
        (c) => c.batch && c.op?.["x-bdp-callable"]?.atomic === true,
      );
      if (callable === undefined) notRun("No reachable CallableBatch is declared atomic");
      args = { bdp_kit_unknown: 1 };
      weak = true;
    }
    check(
      callable.op?.["x-bdp-callable"]?.atomic === true,
      `${callable.name} is not declared atomic`,
    );
    const before = await revisions();
    const reply = await invoke(callable, args, provenance === undefined ? {} : { provenance });
    check(reply.status >= 400, `The witness did not fail: ${said(reply)}`);
    const moved = changedBetween(before, await revisions());
    check(moved === 0, `A Problem from atomic ${callable.name} changed ${moved} revision(s)`);
    return weak
      ? "weak witness: a refusal before running, for want of one that fails after effects"
      : `${callable.name}: ${said(reply)}`;
  });
  await run("callables.cb-14", async () => {
    requireCallables();
    const { document, reply, list } = await callables();
    check(/^application\/vnd\.oai\.openapi\+json$/.test(mediaOf(reply) ?? ""), "Not OpenAPI media");
    check(/^3\./.test(String(document.openapi)), "`openapi` is not a 3.x version");
    const head = await http(url("bdp/call"), "HEAD");
    check(head.status === 200 && head.bytes.length === 0, `HEAD bdp/call answered ${said(head)}`);
    const ids = new Set();
    let matched = 0;
    let published_ = 0;
    let proseDifferences = 0;
    const problems = [];
    const note = (callable, message) => problems.push(`${callable.name}: ${message}`);
    for (const callable of list) {
      const { op, item } = callable;
      if (
        Object.keys(item)
          .filter((m) => m !== "parameters" && m !== "summary" && m !== "description")
          .join() !== "post"
      ) {
        note(callable, "the path item is not exactly one POST");
        continue;
      }
      const words = callable.name.split(/[/\-_.]/).filter(Boolean);
      const expected = words
        .map((word, index) =>
          index === 0
            ? word[0].toLowerCase() + word.slice(1)
            : word[0].toUpperCase() + word.slice(1),
        )
        .join("");
      if (op.operationId !== expected) note(callable, "operationId breaks the §14 rule");
      if (ids.has(op.operationId)) note(callable, "duplicate operationId");
      ids.add(op.operationId);
      if (![QUERY, BATCH].includes(callable.type)) note(callable, "x-bdp-callable has no Type");
      const header = (op.parameters ?? []).find(
        (parameter) => parameter.in === "header" && /^idempotency-key$/i.test(parameter.name),
      );
      if (callable.batch !== (header !== undefined))
        note(callable, "Idempotency-Key must appear exactly on a CallableBatch");
      const request = op.requestBody?.content?.[media]?.schema;
      const args = request?.properties?.arguments;
      if (request?.additionalProperties !== false || args?.additionalProperties !== false)
        note(callable, "the request body or its arguments is not closed");
      const ok = op.responses?.["200"]?.content?.[media]?.schema;
      const required = ok?.required ?? [];
      if (!required.includes("result") || callable.batch !== required.includes("changed"))
        note(callable, "the 200 response's required members are wrong");
      if (op.responses?.default === undefined) note(callable, "no default response");
      if (op.responses?.["409"] === undefined) note(callable, "no 409 response");
      const declared = await declarationOf(callable);
      if (declared === undefined) continue;
      if (declared.source === "published") published_++;
      else matched++;
      // A Bead is the Callable's own declaration, exact to the byte. The package's published text
      // is what the provider should project, generated from another revision of its contract,
      // so with no Bead to read prose differences are counted apart from structural ones.
      const proseOf = (schema) => (declared.source === "bead" ? schema : withoutProse(schema));
      const prose = (callable_, message) => {
        if (declared.source === "bead") note(callable_, message);
        else proseDifferences++;
      };
      const x = op["x-bdp-callable"] ?? {};
      if (
        x.idempotent !== declared.idempotent &&
        !(x.idempotent === undefined && !declared.idempotent)
      )
        note(callable, "x-bdp-callable.idempotent differs from the declaration");
      if (x.atomic !== declared.atomic && !(x.atomic === undefined && !declared.atomic))
        note(callable, "x-bdp-callable.atomic differs from the declaration");
      if (canonical(x.cliMapping ?? null) !== canonical(declared.cliMapping ?? null))
        note(callable, "x-bdp-callable.cliMapping differs from the declaration");
      if ((op.summary ?? undefined) !== declared.title) note(callable, "summary is not `title`");
      if (op.description !== declared.description) prose(callable, "description differs");
      const projected = args?.properties ?? {};
      const names = declared.parameters.map((parameter) => parameter.name);
      if (canonical(Object.keys(projected).sort()) !== canonical([...names].sort()))
        note(callable, "the arguments' properties are not the parameters");
      const requiredNames = declared.parameters.filter((p) => p.required).map((p) => p.name);
      if (canonical([...(args?.required ?? [])].sort()) !== canonical(requiredNames.sort()))
        note(callable, "`required` is not the required parameters");
      for (const parameter of declared.parameters) {
        const left = proseOf(withoutHelp(expanded(projected[parameter.name], document)));
        const right = proseOf(withoutHelp(expanded(parameter.schema, parameter.schema)));
        if (canonical(left) !== canonical(right))
          note(callable, `parameter ${parameter.name}'s schema differs`);
        if (
          parameter.description !== undefined &&
          projected[parameter.name]?.description !== parameter.description
        )
          prose(callable, `parameter ${parameter.name}'s description differs`);
        if (
          Object.hasOwn(parameter, "default") &&
          canonical(projected[parameter.name]?.default) !== canonical(parameter.default)
        )
          note(callable, `parameter ${parameter.name}'s default differs`);
      }
      const resultProjected = ok?.properties?.result;
      if (
        declared.resultSchema !== undefined &&
        canonical(proseOf(expanded(resultProjected, document))) !==
          canonical(proseOf(expanded(declared.resultSchema, declared.resultSchema)))
      )
        note(callable, "the 200 `result` schema differs from resultSchema");
    }
    rows.find((entry) => entry.id === "callables.cb-14").mismatches = problems;
    check(problems.length === 0, `${problems.length} §14 mismatches; first: ${problems[0]}`);
    return `${matched} matched against their Beads, ${published_} structurally against the package's published declarations${proseDifferences === 0 ? "" : `, with ${proseDifferences} prose differences`}`;
  });
  await run("callables.mount-method-and-media", async () => {
    requireCallables();
    const { list } = await callables();
    const callable = list.find((c) => !c.batch) ?? list[0];
    if (callable === undefined) notRun("No reachable Callable");
    const mount = url(`bdp/call/${callable.name}`);
    for (const method of ["GET", "PUT", "DELETE"]) {
      const reply = await http(mount, method);
      check(reply.status === 405, `${method} on a mount answered ${said(reply)}`);
      check(reply.headers.allow === "POST", `${method} on a mount: Allow is not POST`);
      check(reply.bytes.length === 0, `${method} on a mount: the 405 has a body`);
    }
    for (const contentType of ["application/json", null]) {
      const reply = await http(mount, "POST", { arguments: {} }, undefined, { contentType });
      check(reply.status === 415, `POST with ${contentType ?? "no"} media answered ${said(reply)}`);
      check(reply.json?.code === "unsupported-media-type", "The 415 is not the BDP Problem");
    }
  });
  await run("callables.invocation-closed", async () => {
    requireCallables();
    const queries = await zeroRequiredQueries();
    const callable = queries[0];
    if (callable === undefined) notRun("No reachable CallableQuery has no required parameter");
    const mount = url(`bdp/call/${callable.name}`);
    for (const [label, raw] of [
      ["an unknown member", '{"arguments":{},"name":"x"}'],
      ["a duplicate member", '{"arguments":{},"arguments":{}}'],
      ["no arguments", "{}"],
      ["arguments not an object", '{"arguments":[]}'],
    ]) {
      const reply = await http(mount, "POST", undefined, undefined, { rawBody: raw });
      check(reply.status === 400, `${label} answered ${said(reply)}`);
      check(reply.json?.code === "malformed-request", `${label} answered ${said(reply)}`);
    }
    const keyed = await http(mount, "POST", { arguments: {} }, `kit-${unique()}`);
    check(keyed.json?.code === "malformed-request", `A key on a query answered ${said(keyed)}`);
    const attributed = await http(mount, "POST", { arguments: {}, revisionProvenance: ACTOR });
    check(
      attributed.status >= 400 && attributed.status < 500,
      `Provenance on a query answered ${said(attributed)}`,
    );
  });

  // ---- Issue package ----
  // Issue §1 says a provider "MAY, but need not, advertise Types1": discovery cannot say, so
  // the package is known by what the Scope serves, or by its adapter's say-so.
  let issuePackage;
  try {
    const beads = await allRecords("beads");
    const links = await allRecords("links");
    const listed = callablesAdvertised ? (await callables()).list : [];
    issuePackage =
      witnesses.issuePackage === true ||
      listed.some((entry) => entry.name === "issue/create") ||
      beads.some((bead) => String(bead.type).startsWith(ISSUE)) ||
      links.some((link) => String(link.type).startsWith(DEPENDENCY));
  } catch {
    issuePackage = witnesses.issuePackage === true;
  }
  const requireIssue = () => {
    if (!issuePackage)
      notApplicable(
        "Not applicable: the Scope serves no Issue or Dependency record or `issue/create`, and its adapter names no package",
      );
  };
  const requireWrite = () => {
    if (!writeAdvertised)
      notApplicable("Not applicable by discovery: the Scope advertises profile core, not write");
    requireMutation();
  };
  // Core fixes every Write operation at bdp/operations/NAME; there is no directory to read.
  const write = async (operation, body) =>
    http(new URL(`bdp/operations/${operation}`, scope).href, "POST", body, `kit-${unique()}`);
  const issueBody = (extra = {}) => ({
    type: `${ISSUE}task`,
    properties: { title: `kit ${unique()}`, status: "open", priority: 2, ...extra },
    metadata: {},
  });
  const createIssue = async (extra) => {
    const reply = await write("createBead", issueBody(extra));
    check(reply.status === 200, `createBead of a task answered ${said(reply)}`);
    return reply.json.resource;
  };
  const createDependency = async (source, target, kind = "blocks", extra = {}) => {
    const reply = await write("createLink", {
      type: DEPENDENCY + kind,
      source,
      target,
      properties: {},
      metadata: {},
      ...extra,
    });
    check(reply.status === 200, `createLink of ${kind} answered ${said(reply)}`);
    return reply.json.resource;
  };
  const refused = (reply, what, code = "validation-failed") => {
    check(reply.status >= 400 && reply.status < 500, `${what} was not refused: ${said(reply)}`);
    if (code !== undefined)
      check(reply.json?.code === code, `${what}: expected ${code}, ${said(reply)}`);
  };
  async function issueRecords() {
    const beads = await allRecords("beads");
    return beads.filter(
      (bead) =>
        String(bead.type).startsWith(ISSUE) || String(bead.type).startsWith(`${scope}types/issue/`),
    );
  }
  const someIssues = async () => {
    const records = await issueRecords();
    if (records.length > 0) return records;
    if (writeAdvertised && allowMutation) await createIssue();
    else if (allowMutation && (await named("issue/create").catch(() => undefined)))
      await issueIds(1);
    else notRun("The Scope holds no Issue record, and this run may not make one");
    return issueRecords();
  };

  await run("issue.it-1", async () => {
    requireIssue();
    for (const record of await someIssues()) {
      check(
        ISSUE_TYPES.has(record.type) || record.type.startsWith(`${scope}types/issue/`),
        "An Issue record's type is not an identity of §2's Bead table",
      );
      check(
        !Object.hasOwn(record.properties ?? {}, "issue_type"),
        "An Issue record has issue_type",
      );
      check(
        record.metadata !== null &&
          typeof record.metadata === "object" &&
          !Array.isArray(record.metadata),
        "An Issue record's metadata is not an object",
      );
    }
  });
  await run("issue.it-2", async () => {
    requireIssue();
    const beads = new Set((await allRecords("beads")).map((bead) => bead.id));
    const links = (await allRecords("links")).filter(
      (link) =>
        String(link.type).startsWith(DEPENDENCY) ||
        String(link.type).startsWith(`${scope}types/dependency/`),
    );
    if (links.length === 0) {
      if (writeAdvertised && allowMutation) {
        const [a, b] = [await createIssue(), await createIssue()];
        links.push(await createDependency(a.id, b.id));
        beads.add(a.id).add(b.id);
      } else notRun("The Scope holds no Dependency record, and this run may not make one");
    }
    for (const link of links) {
      check(
        DEPENDENCY_TYPES.has(link.type) || link.type.startsWith(`${scope}types/dependency/`),
        "A Dependency's type is not an identity of §2's Link table",
      );
      check(!Object.hasOwn(link.properties ?? {}, "dep_type"), "A Dependency record has dep_type");
      check(
        typeof link.source === "string" && beads.has(link.source),
        "A source is not an in-Scope Bead URL",
      );
      check(
        typeof link.target === "string" &&
          (link.target.startsWith(scope)
            ? beads.has(link.target)
            : /^[a-z][a-z0-9+.-]*:/i.test(link.target)),
        "A target is neither an in-Scope Bead URL nor an opaque URI",
      );
    }
  });
  await run("issue.it-3", async () => {
    requireIssue();
    requireWrite();
    refused(
      await write("createBead", { ...issueBody(), type: `${ISSUE}issue` }),
      "createBead with the abstract issue/issue",
    );
    const [a, b] = [await createIssue(), await createIssue()];
    refused(
      await write("createLink", {
        type: `${DEPENDENCY}dependency`,
        source: a.id,
        target: b.id,
        properties: {},
        metadata: {},
      }),
      "createLink with the abstract dependency/dependency",
    );
  });
  await run("issue.it-4", async () => {
    requireIssue();
    requireWrite();
    for (const missing of ["title", "status", "priority"]) {
      const body = issueBody();
      delete body.properties[missing];
      refused(await write("createBead", body), `createBead lacking ${missing}`);
    }
  });
  await run("issue.it-5", async () => {
    requireIssue();
    requireWrite();
    const issue = await createIssue();
    for (const member of ["created_at", "updated_at", "closed_at", "started_at", "close_reason"])
      refused(
        await write("updateBead", {
          bead: issue.id,
          propertiesChange: [{ op: "add", path: `/${member}`, value: "2026-01-01T00:00:00Z" }],
        }),
        `A patch to ${member}`,
      );
  });
  await run("issue.it-6", async () => {
    requireIssue();
    requireWrite();
    const issue = await createIssue();
    refused(
      await write("createLink", {
        type: `${DEPENDENCY}blocks`,
        source: issue.id,
        target: issue.id,
        properties: {},
        metadata: {},
      }),
      "A self-Link",
      undefined,
    );
  });
  await run("issue.it-7", async () => {
    requireIssue();
    requireWrite();
    const [a, b] = [await createIssue(), await createIssue()];
    const occupying = await createDependency(a.id, b.id, "blocks");
    for (const kind of ["blocks", "related"]) {
      const reply = await write("createLink", {
        type: DEPENDENCY + kind,
        source: a.id,
        target: b.id,
        properties: {},
        metadata: {},
      });
      refused(reply, `createLink of ${kind} on an occupied pair`);
      check(
        JSON.stringify(reply.json).includes(occupying.id),
        "The diagnostic does not name the occupying Link",
      );
    }
    await createDependency(b.id, a.id, "related");
  });
  await run("issue.it-8", async () => {
    requireIssue();
    requireWrite();
    const [a, b] = [await createIssue(), await createIssue()];
    const link = await createDependency(a.id, b.id);
    const served = await http(link.id);
    check(
      served.json?.source === a.id && served.json?.target === b.id,
      "blocks A→B is not source A, target B",
    );
  });
  await run("issue.it-9", async () => {
    requireIssue();
    requireWrite();
    const [a, b] = [await createIssue(), await createIssue()];
    const first = await createDependency(a.id, b.id);
    const removed = await write("deleteLink", { link: first.id });
    check(removed.status === 200, `deleteLink answered ${said(removed)}`);
    const second = await createDependency(a.id, b.id, "blocks", { metadata: { kit: "new" } });
    check(second.id !== first.id, "The pair's next Link reused the first identity");
    check(second.metadata?.kit === "new", "The new metadata was not served");
    const absent = await http(first.id);
    check(
      absent.status === 404 && absent.json?.code === "resource-not-found",
      `A read of the first id: ${said(absent)}`,
    );
    await write("deleteLink", { link: second.id });
    refused(
      await write("createLink", {
        id: first.id,
        type: `${DEPENDENCY}blocks`,
        source: a.id,
        target: b.id,
        properties: {},
        metadata: {},
      }),
      "createLink supplying the first id",
      "identity-taken",
    );
  });
  await run("issue.it-10", async () => {
    requireIssue();
    requireWrite();
    const [a, b] = [await createIssue(), await createIssue()];
    const link = await createDependency(a.id, b.id);
    const reply = await write("updateLink", {
      link: link.id,
      metadataChange: [{ op: "add", path: "/kit", value: "x" }],
    });
    check(reply.status === 200, `updateLink answered ${said(reply)}`);
    check(reply.json.resource.id === link.id, "updateLink changed the Link's id");
    check(reply.json.resource.revision !== link.revision, "updateLink served the old revision");
  });
  await run("issue.it-11", async () => {
    requireIssue();
    requireWrite();
    const issue = await createIssue();
    const reply = await write("updateBead", {
      bead: issue.id,
      propertiesChange: [{ op: "add", path: "/labels", value: ["kit"] }],
    });
    check(reply.status === 200, `updateBead answered ${said(reply)}`);
    check(
      reply.json.resource.revision !== issue.revision,
      "A labels-only update served the old revision",
    );
  });
  await run("issue.it-12", async () => {
    requireIssue();
    requireWrite();
    const [a, b] = [await createIssue(), await createIssue()];
    await createDependency(a.id, b.id);
    refused(
      await write("deleteBead", { bead: b.id }),
      "deleteBead with an incident Link",
      "incident-links-exist",
    );
  });
  await run("issue.it-13", async () => {
    requireIssue();
    if (writeAdvertised && allowMutation) {
      await createIssue();
      const bug = await write("createBead", { ...issueBody(), type: `${ISSUE}bug` });
      check(bug.status === 200, `createBead of a bug answered ${said(bug)}`);
    }
    const every = (await someIssues()).map((record) => record.id).sort();
    const family = await http(
      url(`bdp/beads?conformsTo=${encodeURIComponent(`${ISSUE}issue`)}&limit=1000`),
    );
    check(family.status === 200, `conformsTo=issue/issue answered ${said(family)}`);
    check(
      canonical(family.json.items.map((item) => item.id).sort()) === canonical(every),
      "conformsTo=issue/issue is not every Issue record",
    );
    const tasks = await http(
      url(`bdp/beads?type=${encodeURIComponent(`${ISSUE}task`)}&limit=1000`),
    );
    check(tasks.status === 200, `type=issue/task answered ${said(tasks)}`);
    check(
      tasks.json.items.every((item) => item.type === `${ISSUE}task`),
      "type=issue/task returned another classification",
    );
  });
  await run("issue.it-14", async () => {
    requireIssue();
    for (const record of await someIssues())
      for (const member of OBSERVATIONS)
        check(!Object.hasOwn(record.properties ?? {}, member), `An Issue record carries ${member}`);
  });
  await run("issue.it-15", async () => {
    requireIssue();
    const external = `external:kit:${unique()}`;
    let source;
    let link;
    if (writeAdvertised && allowMutation) {
      source = (await createIssue()).id;
      link = await createDependency(source, external);
    } else {
      const add = callablesAdvertised ? await named("issue/dep/add") : undefined;
      if (add === undefined) requireWrite();
      requireMutation();
      const [id] = await issueIds(1);
      source = url(id);
      const added = await invoke(add, { source: id, target: external }, { provenance: ACTOR });
      check(added.status === 200, `issue/dep/add to an external target answered ${said(added)}`);
    }
    const outbound = await http(`${source}?view=links&direction=outbound`);
    check(outbound.status === 200, `Its outbound Links answered ${said(outbound)}`);
    const served = outbound.json.items.find((item) => item.target === external);
    check(served !== undefined, "The external target is not served as that opaque URI");
    if (link !== undefined)
      check(served.id === link.id, "The outbound view disagrees with the record");
  });
  const icState = {
    invocable: [],
    unreachable: [],
    unavailable: [],
    broken: [],
    violations: [],
    outcome: [],
  };
  let icRan = false;
  async function runIssueCallables() {
    if (icRan) return;
    icRan = true;
    const list = (await callables()).list;
    const reachable = new Map(list.map((entry) => [entry.name, entry]));
    let ids = ["kit-missing-a", "kit-missing-b", "kit-missing-c", "kit-missing-d", "kit-missing-e"];
    if (reachable.has("issue/create") && allowMutation) ids = await issueIds(5);
    const mutatesConfig = new Set([
      "config/set",
      "config/unset",
      "memory/remember",
      "memory/forget",
    ]);
    for (const [name, args] of issueInvocations(ids, unique)) {
      const declared = published.get(name);
      const callable = reachable.get(name);
      if (callable === undefined) {
        icState.unreachable.push(name);
        continue;
      }
      if (callable.batch && !allowMutation) {
        icState.outcome.push(name);
        continue;
      }
      const reply = await invoke(
        callable,
        args,
        callable.batch && !mutatesConfig.has(name) ? { provenance: ACTOR } : {},
      );
      if (reply.status === 404 && reply.json?.code === "callable-not-found")
        icState.unreachable.push(name);
      else if (reply.json?.code === "callable-unavailable") icState.unavailable.push(name);
      else if (reply.status >= 500) icState.broken.push(`${name} ${said(reply)}`);
      else {
        icState.invocable.push(`${name}:${reply.status}`);
        if (reply.status === 200 && violates(declared?.resultSchema, reply.json?.result))
          icState.violations.push(`${name} result`);
        if (
          reply.json?.code === "callable-error" &&
          violates(declared?.errorSchema, reply.json?.error)
        )
          icState.violations.push(`${name} error`);
      }
    }
  }
  await run("issue.ic-1", async () => {
    requireIssue();
    requireCallables();
    await runIssueCallables();
    const total = published.size;
    check(
      icState.unreachable.length === 0,
      `${icState.unreachable.length} of ${total} names are not reachable; first: ${icState.unreachable[0]}`,
    );
    check(
      icState.unavailable.length === 0,
      `${icState.unavailable.length} of ${total} names answer callable-unavailable; first: ${icState.unavailable[0]}`,
    );
    check(
      icState.broken.length === 0,
      `${icState.broken.length} of ${total} names answer 5xx; first: ${icState.broken[0]}`,
    );
    if (icState.outcome.length > 0)
      notRun(
        `${icState.outcome.length} batches were not invoked: --scope mode needs --allow-mutation`,
      );
    const not200 = icState.invocable.filter((entry) => !entry.endsWith(":200"));
    return not200.length === 0
      ? `all ${total} answered 200`
      : `dispatched; below 500 but not 200: ${not200.join(" ")}`;
  });
  await run("issue.ic-2", async () => {
    requireIssue();
    requireCallables();
    await runIssueCallables();
    if (icState.invocable.length === 0)
      fail("No name of §1 could be invoked, so nothing validates");
    check(
      icState.violations.length === 0,
      `${icState.violations.length} values violate a declaration; first: ${icState.violations[0]}`,
    );
    if (icState.unreachable.length + icState.unavailable.length > 0)
      notRun(`Only ${icState.invocable.length} of ${published.size} names could be invoked`);
    return `${icState.invocable.length} invocations validated by example`;
  });
  return finish();
}
