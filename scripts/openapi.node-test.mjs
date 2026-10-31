// Offline catalog/fixture controls, not OpenAPI meta-validation or provider conformance.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  generateArtifacts,
  media,
  operations,
  root,
  schemaFile,
  validateToolingBinding,
} from "./generate-openapi.mjs";

const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const catalog = load("specs/openapi/bdp-v0.1.openapi.json");
const tooling = load("specs/openapi/bdp-v0.1.tooling.openapi.json");
const canonical = load(schemaFile);
const bindings = load("fixtures/openapi/bindings.json").bindings;
const exchanges = load("fixtures/openapi/exchanges.json");
const rows = operations();
const methods = ["get", "head", "post"];
function validateExchangeCorpus(corpus) {
  for (const name of ["cases", "continuation"])
    if (!Array.isArray(corpus[name]) || corpus[name].length === 0)
      throw new Error(`Nonempty ${name} fixtures required`);
  for (const item of corpus.cases) {
    const request = item.request || {};
    const method = typeof request.method === "string" ? request.method.toLowerCase() : "";
    if (!catalog.components.pathItems[request.binding]?.[method])
      throw new Error("Unknown exchange operation binding");
  }
  for (const item of corpus.continuation)
    if (!catalog.components.pathItems[item.operation]?.get)
      throw new Error("Unknown continuation operation binding");
}
validateExchangeCorpus(exchanges);

function responseDefinition(row, request) {
  if (!row.projection) return row.response;
  return row.response[new URL(request.url).searchParams.has("fields") ? 0 : 1];
}
function visit(value, fn) {
  if (!value || typeof value !== "object") return;
  fn(value);
  for (const child of Object.values(value)) visit(child, fn);
}
function pointer(document, fragment) {
  return fragment
    .slice(2)
    .split("/")
    .reduce((node, key) => node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], document);
}

test("deterministic generation/check and mirror custody", () => {
  const first = generateArtifacts();
  assert.deepEqual(first, generateArtifacts());
  for (const [path, expected] of Object.entries(first))
    assert.equal(readFileSync(resolve(root, path), "utf8"), expected, path);
  assert.deepEqual(
    readFileSync(resolve(root, schemaFile)),
    readFileSync(resolve(root, "packages/protocol/schemas/bdp-v0.1.schema.json")),
  );
  assert.equal(canonical.$id, "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json");
});

test("catalog is reusable signatures; tooling paths are reserved fixtures only", () => {
  assert.deepEqual(catalog.paths, {});
  assert(
    !Object.hasOwn(catalog.components.pathItems.scopeLanding.get["x-bdp-request-media"], "accept"),
  );
  assert.equal(catalog.components.pathItems.discovery.get["x-bdp-request-media"].accept, media);
  assert.equal(catalog.openapi, "3.1.1");
  assert.equal(tooling.servers[0].url, "https://bdp-tooling.invalid");
  assert.equal(bindings.length, rows.length);
  assert.equal(Object.keys(tooling.paths).length, rows.length);
  for (const binding of bindings) {
    assert.match(new URL(binding.url).hostname, /\.invalid$/);
    assert.equal(tooling.paths[binding.path]["x-bdp-exact-fixture-url"], binding.url);
    assert.equal(tooling.paths[binding.path].$ref, `#/components/pathItems/${binding.pathItem}`);
  }
  assert(!catalog.components.schemas, "no copied/relocated canonical schema graph");
});

test("every schema reference resolves without rewriting or staging imports", () => {
  const selected = new Set();
  for (const document of [catalog, tooling])
    visit(document, (object) => {
      if (!object.$ref) return;
      if (object.$ref.startsWith("#/")) {
        assert(pointer(document, object.$ref));
        return;
      }
      const [file, fragment] = object.$ref.split("#");
      assert.equal(file, "../profiles/core/bdp-v0.1.schema.json");
      assert(fragment.startsWith("/$defs/"));
      const name = fragment.slice("/$defs/".length);
      assert(canonical.$defs[name], name);
      assert(
        !/^(sequence|transactional|receipt|mutationReceipt|snapshot|changefeed|eventPage$|event$|readDiscovery$|readUpdateDiscovery$)/.test(
          name,
        ),
        name,
      );
      selected.add(name);
    });
  for (const name of [
    "retainedDiscovery",
    "writeOperationDirectory",
    "batchRequest",
    "atomicBatchResult",
    "retainedEventPage",
    "resourceProjectionMask",
    "typeDefinitionReadResult",
  ])
    assert(selected.has(name));
});

test("exact closed eight Write directory, singleton requests, media and operation guards", () => {
  const names = Object.keys(canonical.$defs.writeOperationDirectory.properties).sort();
  assert.equal(canonical.$defs.writeOperationDirectory.additionalProperties, false);
  assert.deepEqual([...canonical.$defs.writeOperationDirectory.required].sort(), names);
  assert.equal(names.length, 8);
  const actual = rows
    .filter((row) => row.navigation.role === "write-directory-member")
    .map((row) => row.id)
    .sort();
  assert.deepEqual(actual, names);
  for (const name of names) {
    const op = catalog.components.pathItems[name].post;
    assert.equal(op.requestBody.content[media].schema.$ref.endsWith(`/${name}Request`), true);
    assert(
      op.parameters.some((p) => p.in === "header" && p.name === "Idempotency-Key" && p.required),
    );
    assert.deepEqual(op["x-bdp-forbidden-response-headers"], ["ETag", "Location"]);
    assert(!op["x-bdp-applicable-problem-codes"].includes("binding-unavailable"));
  }
  assert.equal(canonical.$defs.batchRequest.properties.capabilityVersion.const, "1");
  assert.equal(
    catalog.components.pathItems.atomicBatch.post.requestBody.content[media].schema.$ref.endsWith(
      "/batchRequest",
    ),
    true,
  );
});

test("bodyless HTTP branches and HEAD cannot be swallowed by default Problems", () => {
  for (const [id, item] of Object.entries(catalog.components.pathItems))
    for (const method of methods) {
      const op = item[method];
      if (!op) continue;
      for (const status of ["405", "406", "500"]) {
        assert(op.responses[status], `${id} ${method} ${status}`);
        assert(!op.responses[status].content);
      }
      if (method !== "post" && id !== "aliasResolve")
        for (const status of ["304", "412"]) {
          assert(op.responses[status]);
          assert(!op.responses[status].content);
        }
      if (method === "head")
        for (const response of Object.values(op.responses)) assert(!response.content, id);
      if (method !== "head") assert(op.responses.default.content["application/problem+json"]);
      for (const [status, response] of Object.entries(op.responses)) {
        if (status === "406" || status === "412") assert(!response.headers?.["BDP-Resource-Kind"]);
        for (const type of Object.keys(response.content || {}))
          assert([media, "application/problem+json"].includes(type));
      }
      for (const type of Object.keys(op.requestBody?.content || {})) assert.equal(type, media);
    }
  for (const op of Object.values(catalog.components.pathItems.exactDefinition))
    assert.deepEqual(op["x-bdp-forbidden-response-headers"], [
      "BDP-Resource-Kind",
      "BDP-Collection-Kind",
    ]);
});

test("coverage ties every operation to real source/CLI lines and capabilities stay explicit", () => {
  const seen = new Set();
  for (const item of Object.values(catalog.components.pathItems))
    for (const method of methods) {
      const op = item[method];
      if (!op) continue;
      assert(!seen.has(op.operationId));
      seen.add(op.operationId);
      for (const link of [...op["x-bdp-sources"], op["x-bdp-cli"]]) {
        const lines = readFileSync(resolve(root, link.file), "utf8").split("\n");
        assert(link.line > 0 && link.line < lines.length, JSON.stringify(link));
      }
      assert(
        readFileSync(resolve(root, "specs/openapi/coverage.md"), "utf8").includes(op.operationId),
      );
      assert(op["x-bdp-navigation"].draft);
    }
  assert.equal(catalog.components.pathItems.scopeEvents.get["x-bdp-continuation"], "unchanged");
  assert.equal(
    catalog.components.pathItems.beadInventory.get["x-bdp-continuation"],
    "ordinary-limit-only",
  );
  assert(
    catalog.components.pathItems.projectedBead.get.parameters.some(
      (p) => p.name === "projectionVersion" && p.required,
    ),
  );
});

test("positive fixture bodies use canonical shapes; whole References reject id keys", () => {
  // Format assertions belong to the existing full-format schema suite. This check
  // validates only the selected authored fixture body shapes, not OAS or a server.
  const ajv = new Ajv2020({ strict: true, validateFormats: false, allErrors: true });
  ajv.addSchema(canonical);
  const schemaFor = (name) => ({ $ref: `${canonical.$id}#/$defs/${name}` });
  const validate = (name, body, label) => {
    const check = ajv.compile(
      Array.isArray(name) ? { anyOf: name.map(schemaFor) } : schemaFor(name),
    );
    assert(check(body), `${label}: ${JSON.stringify(check.errors)}`);
  };
  for (const exchange of exchanges.cases.filter((item) => item.valid)) {
    const row = rows.find((item) => item.id === exchange.request.binding);
    if (Object.hasOwn(exchange.request, "body"))
      validate(row.request, exchange.request.body, `${exchange.name} request`);
    if (Object.hasOwn(exchange.response, "body"))
      validate(
        exchange.response.status >= 400 ? row.problem : responseDefinition(row, exchange.request),
        exchange.response.body,
        `${exchange.name} response`,
      );
  }
  const pin = exchanges.cases.find(
    (item) => item.name === "endpoint-only correction with whole pin",
  );
  for (const [name, body, source] of [
    ["updateLinkRequest", structuredClone(pin.request.body), (item) => item.source],
    ["mutationResult", structuredClone(pin.response.body), (item) => item.resource.source],
  ]) {
    const reference = source(body);
    reference.id = reference.uri;
    delete reference.uri;
    const check = ajv.compile(schemaFor(name));
    assert.equal(
      check(body),
      false,
      `${name} must refuse a whole Reference with id in place of uri`,
    );
  }
});

// Narrow authored exchange controls only: no general JSON Schema evaluator,
// implementation routing, authentication, transaction, provider or CLI execution.
function fixtureErrors(exchange) {
  const errors = [];
  const request = exchange.request,
    response = exchange.response;
  const binding = bindings.find((b) => b.pathItem === request.binding);
  const method = request.method.toLowerCase();
  const op = catalog.components.pathItems[request.binding]?.[method];
  if (!binding || !op) return ["unknown operation"];
  if (request.url !== binding.url) errors.push("exact URL changed");
  const reqHeaders = Object.fromEntries(
    Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const row = rows.find((row) => row.id === request.binding);
  if (reqHeaders.accept !== media) errors.push("request media");
  if (method === "post") {
    if (reqHeaders["content-type"] !== media) errors.push("body media");
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(reqHeaders["idempotency-key"] || "")) errors.push("key");
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      errors.push("body");
    if (
      request.binding !== "atomicBatch" &&
      ["operation", "name"].some((k) => Object.hasOwn(request.body || {}, k))
    )
      errors.push("singleton discriminator");
    if (
      request.binding === "atomicBatch" &&
      (request.body?.capabilityVersion !== "1" || !request.body?.operations?.length)
    )
      errors.push("batch1 selection");
    if (headers.etag || headers.location) errors.push("operation-target metadata");
    if (response.status >= 200 && response.status < 300 && response.status !== 200)
      errors.push("success status");
  }
  const bodyless =
    method === "head" || [204, 304, 307, 405, 406, 412, 500].includes(response.status);
  if (bodyless && Object.hasOwn(response, "body")) errors.push("bodyless response");
  if (response.status === 405 && !headers.allow) errors.push("Allow");
  if (response.status === 307 && !headers.location) errors.push("Location");
  if (!bodyless && response.status >= 400) {
    if (headers["content-type"] !== "application/problem+json") errors.push("Problem media");
    if (
      !response.body?.type ||
      !response.body?.retry ||
      !op["x-bdp-applicable-problem-codes"].includes(response.body?.code)
    )
      errors.push("Problem fields/code");
    if (response.body?.status && response.body.status !== response.status)
      errors.push("Problem status");
  } else if (!bodyless && response.status === 200 && row.response) {
    if (headers["content-type"] !== media) errors.push("response media");
    if (request.binding === "writeDirectory") {
      const expected = Object.keys(canonical.$defs.writeOperationDirectory.properties).sort();
      if (JSON.stringify(Object.keys(response.body || {}).sort()) !== JSON.stringify(expected))
        errors.push("closed directory");
      const urls = Object.values(response.body || {});
      if (new Set(urls).size !== urls.length || urls.some((u) => !/^https?:\/\//.test(u)))
        errors.push("distinct absolute URLs");
    }
  }
  // Successful read context survives HEAD/304 independently of any body.
  if (method !== "post" && [200, 304].includes(response.status)) {
    if (row.kind && headers["bdp-resource-kind"] !== row.kind) errors.push("point kind");
    if (row.collection && headers["bdp-collection-kind"] !== row.collection)
      errors.push("collection kind");
    if (row.kind || row.collection) {
      const discovery = bindings.find((item) => item.pathItem === "discovery").url;
      if (!headers.link?.includes(`<${discovery}>; rel="service-desc"`))
        errors.push("owning service-desc Link");
    }
    if (row.projection) {
      const masked = new URL(request.url).searchParams.has("fields");
      if (masked && !headers["bdp-projection"]) errors.push("applied mask metadata");
      if (!masked && Object.hasOwn(headers, "bdp-projection"))
        errors.push("full output has no projection metadata");
    }
  }
  if (
    row.alias &&
    response.status === 307 &&
    exchange.context?.authorizationDependent &&
    headers["cache-control"] !== "private, no-store"
  )
    errors.push("alias cache metadata");
  for (const name of op["x-bdp-forbidden-response-headers"] || [])
    if (headers[name.toLowerCase()]) errors.push("forbidden response header");
  return errors;
}
for (const exchange of exchanges.cases)
  test(`offline exchange: ${exchange.name}`, () => {
    const errors = fixtureErrors(exchange);
    assert.equal(errors.length === 0, exchange.valid, errors.join(", "));
  });

function limitOnly(issued, requested) {
  if (
    !issued.startsWith("https://bdp-tooling.invalid/") ||
    !requested.startsWith("https://bdp-tooling.invalid/")
  )
    return false;
  // Decode only names, once; keep raw member offsets for the allowed value edit.
  const limits = (url) => {
    const queryStart = url.indexOf("?");
    if (queryStart < 0) return [];
    const fragment = url.indexOf("#", queryStart);
    const queryEnd = fragment < 0 ? url.length : fragment;
    const found = [];
    let start = queryStart + 1;
    for (const member of url.slice(start, queryEnd).split("&")) {
      const equal = member.indexOf("=");
      const rawName = equal < 0 ? member : member.slice(0, equal);
      if (decodeURIComponent(rawName.replaceAll("+", " ")) === "limit") {
        if (equal < 0) throw new Error("limit has no value");
        found.push({ start: start + equal + 1, end: start + member.length });
      }
      start += member.length + 1;
    }
    return found;
  };
  let issuedLimits, requestedLimits;
  try {
    issuedLimits = limits(issued);
    requestedLimits = limits(requested);
  } catch {
    return false;
  }
  if (issuedLimits.length > 1 || requestedLimits.length > 1) return false;
  if (issuedLimits.length === 1) {
    if (requestedLimits.length !== 1) return false;
    const { start, end } = issuedLimits[0];
    const prefix = issued.slice(0, start),
      suffix = issued.slice(end);
    return (
      requested.startsWith(prefix) &&
      requested.endsWith(suffix) &&
      /^[1-9][0-9]*$/.test(requested.slice(start, requested.length - suffix.length))
    );
  }
  if (issued === requested) return true;
  const prefix = `${issued}${issued.includes("?") ? "&" : "?"}limit=`;
  return (
    requestedLimits.length === 1 &&
    requested.startsWith(prefix) &&
    /^[1-9][0-9]*$/.test(requested.slice(prefix.length))
  );
}

for (const item of exchanges.continuation)
  test(`offline continuation: ${item.name}`, () => {
    const policy = catalog.components.pathItems[item.operation].get["x-bdp-continuation"];
    const accepted =
      policy === "ordinary-limit-only"
        ? limitOnly(item.issued, item.requested)
        : item.issued === item.requested;
    assert.equal(accepted, item.valid);
  });

test("alias GET/HEAD redirect retains applicable authorization cache metadata", () => {
  for (const method of ["get", "head"]) {
    const response = catalog.components.pathItems.aliasResolve[method].responses["307"];
    assert(response.headers.Location);
    assert.match(response.headers["Cache-Control"].description, /Authorization-dependent/);
    assert(!response.content);
    assert(!response.headers["BDP-Resource-Kind"]);
  }
});

test("positive mutation fixtures preserve authored values, whole pin and owner context", () => {
  const create = exchanges.cases.find(
    (item) => item.name === "POST retains operation URL query bytes",
  );
  assert.equal(create.request.body.properties.title, "New");
  assert.equal(
    create.response.body.resource.properties.title,
    create.request.body.properties.title,
  );
  const pin = exchanges.cases.find(
    (item) => item.name === "endpoint-only correction with whole pin",
  );
  assert.equal(new URL(pin.request.body.source.uri).href, pin.request.body.source.uri);
  assert.deepEqual(pin.response.body.resource.source, pin.request.body.source);
  assert.equal(pin.context.initialSource.uri, pin.request.body.source.uri);
  assert.notEqual(pin.context.initialSource.revision, pin.request.body.source.revision);
  assert.equal(
    new URL(pin.request.body.link, pin.context.scope).href,
    pin.response.body.resource.id,
  );
  assert.deepEqual(
    pin.response.body.ownerRevisions.map((owner) => owner.id),
    pin.context.ownerIds,
  );
  assert.deepEqual(pin.context.ownerIds, [pin.request.body.source.uri]);
});

test("projection without fields selects full schema; Events gain no Resource kind", () => {
  const full = exchanges.cases.find(
    (item) => item.name === "projection without fields returns full inventory",
  );
  const row = rows.find((item) => item.id === full.request.binding);
  assert.equal(responseDefinition(row, full.request), "currentBeadCollection");
  const ajv = new Ajv2020({ strict: true, validateFormats: false });
  ajv.addSchema(canonical);
  const validate = ajv.compile({ $ref: `${canonical.$id}#/$defs/currentBeadCollection` });
  const incomplete = structuredClone(full.response.body);
  delete incomplete.items[0].metadata;
  assert.equal(validate(incomplete), false, "no-fields cannot select the permissive projected arm");
  for (const id of ["scopeEvents", "beadEvents", "linkEvents"])
    for (const method of ["get", "head"])
      for (const status of ["200", "304"]) {
        const headers = catalog.components.pathItems[id][method].responses[status].headers;
        assert(!headers["BDP-Resource-Kind"]);
        assert(!headers["BDP-Collection-Kind"]);
      }
});

test("all point/collection success signatures retain required kind and owning Link on GET/HEAD/304", () => {
  for (const row of rows.filter((item) => item.kind || item.collection))
    for (const method of ["get", "head"])
      for (const status of ["200", "304"]) {
        const headers = catalog.components.pathItems[row.id][method].responses[status].headers;
        const kindName = row.kind ? "BDP-Resource-Kind" : "BDP-Collection-Kind";
        assert.equal(headers[kindName].schema.const, row.kind || row.collection);
        assert.equal(headers[kindName]["x-bdp-required"], true);
        assert.equal(headers.Link["x-bdp-required"], true);
        assert.match(headers.Link.description, /service-desc/);
      }
});

test("synthetic bindings require exact origin, raw path and once-decoded required query members", () => {
  const property = bindings.find((item) => item.pathItem === "linkProperties");
  const row = rows.find((item) => item.id === property.pathItem);
  assert.doesNotThrow(() => validateToolingBinding(property, row));
  assert.doesNotThrow(() =>
    validateToolingBinding({ ...property, url: property.url.replace("view=", "%76iew=") }, row),
  );
  for (const [label, change] of [
    ["origin", { url: property.url.replace("bdp-tooling.invalid", "other.invalid") }],
    ["scheme", { url: property.url.replace("https:", "http:") }],
    ["path", { url: property.url.replace(property.path, "/wrong") }],
    ["missing", { url: property.url.split("?")[0] }],
    ["repeated decoded name", { url: `${property.url}&%76iew=properties` }],
    ["wrong const", { url: property.url.replace("view=properties", "view=links") }],
  ])
    assert.throws(() => validateToolingBinding({ ...property, ...change }, row), undefined, label);
  const escaped = bindings.find((item) => item.pathItem === "currentBead");
  assert.throws(() =>
    validateToolingBinding(
      { ...escaped, url: escaped.url.replace("%2B", "%2b") },
      rows.find((item) => item.id === escaped.pathItem),
    ),
  );
  const projection = bindings.find((item) => item.pathItem === "projectedBead");
  assert.throws(() =>
    validateToolingBinding(
      { ...projection, url: projection.url.replace("projectionVersion=1", "projectionVersion=2") },
      rows.find((item) => item.id === projection.pathItem),
    ),
  );
});

test("fixture corpus cannot become empty or hide unknown bindings behind negative cases", () => {
  assert.throws(() => validateExchangeCorpus({ ...exchanges, cases: [] }), /Nonempty cases/);
  assert.throws(
    () => validateExchangeCorpus({ ...exchanges, continuation: [] }),
    /Nonempty continuation/,
  );
  const unknown = structuredClone(exchanges);
  unknown.cases[0].valid = false;
  unknown.cases[0].request.binding = "not-an-operation";
  assert.throws(() => validateExchangeCorpus(unknown), /Unknown exchange/);
  const unknownContinuation = structuredClone(exchanges);
  unknownContinuation.continuation[0].valid = false;
  unknownContinuation.continuation[0].operation = "not-an-operation";
  assert.throws(() => validateExchangeCorpus(unknownContinuation), /Unknown continuation/);
});

test("cache metadata and landing request-media note retain their actual conditions", () => {
  for (const row of rows) {
    assert(!Object.hasOwn(row, "conditional"));
    for (const method of row.methods) {
      const op = catalog.components.pathItems[row.id][method];
      assert.match(
        op.responses.default.headers["Cache-Control"].description,
        /Authorization-dependent/,
      );
      for (const status of ["405", "500"]) {
        assert(!op.responses[status].content);
        assert(!op.responses[status].headers?.["Cache-Control"]);
      }
    }
  }
  for (const method of ["get", "head"]) {
    const op = catalog.components.pathItems.scopeLanding[method];
    assert.deepEqual(Object.keys(op["x-bdp-request-media"]), ["note"]);
    assert.match(op["x-bdp-request-media"].note, /Ordinary HTTP/);
    assert.match(
      op.responses["204"].headers["Cache-Control"].description,
      /Authorization-dependent/,
    );
  }
});

test("Link read and point projection CLI references select their actual correspondence", () => {
  const line = (id) => catalog.components.pathItems[id].get["x-bdp-cli"].line;
  assert.equal(line("linkProperties"), 1435);
  assert.equal(line("historicalLink"), 1434);
  for (const id of [
    "projectedBead",
    "projectedLink",
    "projectedHistoricalBead",
    "projectedHistoricalLink",
  ])
    assert.equal(line(id), 469);
});
