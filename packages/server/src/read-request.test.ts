import {
  type BeadRecord,
  type LinkRecord,
  type ReadRequest,
  isReadProblem,
  ProtocolArtifactValidationError,
  readProblem,
} from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import {
  classifyAliasPath,
  continuationDetails,
  continuationUrlFor,
  inCanonicalUriOrder,
  isPageOperation,
  readControlProblem,
  requestFromUrl,
  resolveReadRequestVariant,
  ScopeServerClosedError,
  ScopeServerLocalError,
  ScopeServerOperationAbortedError,
  validateServerBead,
  validateServerLink,
  withoutPageControls,
} from "./read-request.js";
import {
  ScopeServerClosedError as PublicClosedError,
  ScopeServerLocalError as PublicLocalError,
  ScopeServerOperationAbortedError as PublicAbortedError,
} from "./index.js";
import { ReadPaginationError } from "./read-pagination.js";
import { ReadSelectorError } from "./read-selector.js";

const scope = "https://scope.example/acme/";
const context = { scope, controlsEnabled: true };
const bead: BeadRecord = {
  id: `${scope}beads/a`,
  type: `${scope}types/task`,
  revision: "r1",
  properties: { title: "A" },
};
const link: LinkRecord = {
  id: `${scope}links/l`,
  type: `${scope}types/edge`,
  revision: "r2",
  source: bead.id,
  target: "urn:example:outside",
  properties: {},
};

// Independent complete inventory of the existing wire operations, not derived
// from the production registry. Source exhaustive typing guards future additions.
const requests: readonly ReadRequest[] = [
  { kind: "scope-discovery", scope },
  { kind: "collection", collection: "beads" },
  { kind: "collection", collection: "links" },
  { kind: "collection", collection: "types" },
  { kind: "resource", resource: "bead", id: bead.id },
  { kind: "resource", resource: "link", id: link.id },
  { kind: "resource", resource: "type", id: bead.type },
  { kind: "properties", resource: "bead", id: bead.id },
  { kind: "properties", resource: "link", id: link.id },
  { kind: "bead-links", bead: bead.id },
];

describe("shared Read request kernel", () => {
  it.each(requests)(
    "registers and validates $kind without transport or snapshotting",
    (request) => {
      const variant = resolveReadRequestVariant(request);
      expect(variant).toBeDefined();
      expect(variant?.validate(request, context)).toBeUndefined();
      expect(Object.isFrozen(variant)).toBe(true);
      expect(variant).not.toHaveProperty("execute");
      expect(resolveReadRequestVariant({ ...request, unrelated: true })).toBeUndefined();
    },
  );

  it("validates all successful scope bodies through the registered variant", () => {
    const bodies = [
      { items: [bead], next: null },
      { items: [link], next: null },
      { items: [{ id: bead.type, name: "Task", describes: "bead" }], next: null },
      bead,
      link,
      { id: bead.type, name: "Task", describes: "bead", conformsTo: [] },
      bead.properties,
      link.properties,
      { items: [link], next: null },
    ];
    for (const [index, request] of requests.slice(1).entries()) {
      const variant = resolveReadRequestVariant(request);
      if (variant?.kind !== "scope" || request.kind === "scope-discovery")
        throw new Error("missing scope variant");
      const body = variant.validateBody(request, bodies[index], scope);
      expect(body).toEqual(bodies[index]);
      expect(Object.isFrozen(body)).toBe(true);
      expect(() => variant.validateBody(request, null, scope)).toThrow();
    }
  });

  it("retains the static inherited/accessor validation contract for its caller", () => {
    let reads = 0;
    const request = Object.create({
      kind: "resource",
      resource: "bead",
      get id() {
        reads++;
        return bead.id;
      },
    });
    const variant = resolveReadRequestVariant(request);
    expect(reads).toBe(0);
    expect(variant?.validate(request, context)).toBeUndefined();
    expect(reads).toBe(1);
    expect(Object.hasOwn(request, "id")).toBe(false);
    expect(
      resolveReadRequestVariant(
        Object.create({ kind: "resource", resource: "bead", id: bead.id, selector: "$" }),
      ),
    ).toBeUndefined();
  });

  it.each([
    { kind: "collection", collection: "beads", continuation: `${scope}beads/?cursor=x`, limit: 1 },
    { kind: "collection", collection: "links", source: `${scope}alias/latest` },
    { kind: "collection", collection: "beads", type: "relative" },
    { kind: "resource", resource: "bead", id: `${scope}links/wrong` },
    { kind: "bead-links", bead: bead.id, direction: "sideways" },
    { kind: "scope-discovery", scope: "https://other.example/" },
  ])("keeps existing request validation for %j", (request) => {
    expect(resolveReadRequestVariant(request)?.validate(request, context)).toEqual(
      readProblem("invalid-parameter"),
    );
  });

  it("leaves bounded page validation to the controls phase after identity", () => {
    const request = { kind: "collection", collection: "beads", limit: 0 } as const;
    const variant = resolveReadRequestVariant(request);
    expect(variant?.validate(request, context)).toBeUndefined();
    expect(variant?.validate(request, { ...context, controlsEnabled: false })).toEqual(
      readProblem("invalid-parameter"),
    );
  });

  it("normalizes only structural local endpoints while preserving opaque and Selector bytes", () => {
    const url = new URL(`${scope}links/`);
    url.searchParams.set("source", "beads/a");
    url.searchParams.set("target", "urn:example:OUTSIDE");
    url.searchParams.set("selector", '$[?@.source == "beads/a"]');
    expect(requestFromUrl(url, scope)).toEqual({
      kind: "collection",
      collection: "links",
      source: bead.id,
      target: "urn:example:OUTSIDE",
      selector: '$[?@.source == "beads/a"]',
    });
  });

  it.each([
    "beads/?limit=1&limit=2",
    "links/?unknown=x",
    "types/?type=https://example.test/T",
    "beads/a?view=links&direction=sideways",
    "beads/a?include=links",
  ])("preserves URL rejection for %s", (suffix) => {
    expect(requestFromUrl(new URL(suffix, scope), scope)).toEqual(readProblem("invalid-parameter"));
  });

  it.each([
    { kind: "collection", collection: "beads", type: bead.type, selector: "$", limit: 2 },
    {
      kind: "collection",
      collection: "links",
      endpoint: "urn:example:x",
      conformsTo: link.type,
      limit: 2,
    },
    { kind: "collection", collection: "types", limit: 2 },
    { kind: "bead-links", bead: bead.id, direction: "inbound", limit: 2 },
  ] as const)("round trips authoritative navigation for $kind", (request) => {
    const projection = continuationUrlFor(request, scope);
    const url = new URL(projection);
    url.searchParams.set("cursor", "token_1");
    const continuation = requestFromUrl(url, scope);
    if (isReadProblem(continuation) || !isPageOperation(continuation))
      throw new Error("expected continuation");
    expect(continuationDetails(continuation, scope)).toEqual({ token: "token_1", projection });
    expect(
      continuationDetails({ ...continuation, continuation: `${scope}types/?cursor=x` }, scope),
    ).toEqual(
      request.collection === "types"
        ? { token: "x", projection: `${scope}types/` }
        : readProblem("invalid-parameter"),
    );
    const structural = withoutPageControls(request);
    expect(structural).not.toHaveProperty("selector");
    expect(structural).not.toHaveProperty("limit");
    expect(structural).not.toHaveProperty("continuation");
  });

  it("checks response identity, inline Links, incidence and port-owned navigation", () => {
    expect(() =>
      validateServerBead({ ...bead, ownedLinks: { [link.type]: [link] } }, scope),
    ).not.toThrow();
    expect(() => validateServerLink({ ...link, source: `${scope}alias/a` }, scope)).toThrow(
      ProtocolArtifactValidationError,
    );
    expect(() => validateServerLink({ ...link, source: "urn:outside:a" }, scope)).toThrow(
      ProtocolArtifactValidationError,
    );
    const request = { kind: "bead-links", bead: bead.id, direction: "inbound" } as const;
    const variant = resolveReadRequestVariant(request);
    if (variant?.kind !== "scope") throw new Error("missing incident variant");
    expect(() => variant.validateBody(request, { items: [link], next: null }, scope)).toThrow(
      /direction/,
    );
    expect(() =>
      variant.validateBody(request, { items: [], next: `${scope}links/?cursor=x` }, scope),
    ).toThrow(/pagination/);
  });

  it("sorts an explicitly permuted list without mutating it", () => {
    const input = [{ id: `${scope}beads/z` }, { id: `${scope}beads/a` }];
    const result = inCanonicalUriOrder(input);
    expect(result.map((x) => x.id)).toEqual([`${scope}beads/a`, `${scope}beads/z`]);
    expect(input[0]?.id).toBe(`${scope}beads/z`);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps the static alias classifier table-free with unchanged parsed-URL boundaries", () => {
    expect(classifyAliasPath(new URL(`${scope}alias/alias/latest`), scope)).toBe("alias/latest");
    expect(classifyAliasPath(new URL(`${scope}alias/latest?q=1`), scope)).toEqual(
      readProblem("resource-not-found"),
    );
    expect(classifyAliasPath(new URL(`${scope}beads/a`), scope)).toBeUndefined();
    expect(classifyAliasPath(new URL("https://other.example/alias/a"), scope)).toBeUndefined();
    // Raw direct-string hardening is for the future plane, not this extraction.
    expect(classifyAliasPath(new URL(`${scope}alias/latest?`), scope)).toBe("latest");
  });

  it("preserves public runtime error identity and causes through relocation", () => {
    expect(PublicClosedError).toBe(ScopeServerClosedError);
    expect(PublicAbortedError).toBe(ScopeServerOperationAbortedError);
    expect(PublicLocalError).toBe(ScopeServerLocalError);
    const cause = new Error("cancelled");
    expect(new PublicClosedError()).toBeInstanceOf(ScopeServerLocalError);
    expect(new PublicAbortedError({ cause })).toMatchObject({ code: "operation-aborted", cause });
  });

  it.each([
    ["foreign-view", "foreign-view"],
    ["cursor-expired", "cursor-expired"],
    ["foreign-projection", "invalid-parameter"],
    ["invalid-input", "invalid-parameter"],
    ["invalid-limit", "limit-exceeded"],
    ["capacity-exceeded", "temporarily-unavailable"],
    ["invalid-snapshot", "temporarily-unavailable"],
    ["configuration-error", "temporarily-unavailable"],
    ["token-generation-failed", "temporarily-unavailable"],
  ] as const)("preserves default pagination mapping %s", (code, problem) => {
    expect(readControlProblem(new ReadPaginationError(code, "private"))).toEqual(
      readProblem(problem),
    );
  });
  it.each([
    ["syntax", "invalid-parameter"],
    ["unsupported-feature", "invalid-parameter"],
    ["source-bytes-limit-exceeded", "limit-exceeded"],
    ["ast-depth-limit-exceeded", "limit-exceeded"],
    ["ast-nodes-limit-exceeded", "limit-exceeded"],
  ] as const)("preserves default Selector mapping %s", (code, problem) => {
    expect(readControlProblem(new ReadSelectorError(code, "private"))).toEqual(
      readProblem(problem),
    );
  });
});

// Independent expected mandatory-string inventory: optional filters/page
// controls stay outside these arrays, and static callers keep their old reads.
describe("council required registry metadata", () => {
  it.each([
    [requests[0], ["kind", "scope"]],
    [requests[1], ["kind", "collection"]],
    [requests[2], ["kind", "collection"]],
    [requests[3], ["kind", "collection"]],
    [requests[4], ["kind", "resource", "id"]],
    [requests[5], ["kind", "resource", "id"]],
    [requests[6], ["kind", "resource", "id"]],
    [requests[7], ["kind", "resource", "id"]],
    [requests[8], ["kind", "resource", "id"]],
    [requests[9], ["kind", "bead"]],
  ])("exposes immutable required fields for %j", (request, expected) => {
    const variant = resolveReadRequestVariant(request);
    if (!variant) throw Error("missing registered descriptor");
    expect(variant.required).toEqual(expected);
    expect(Object.isFrozen(variant.required)).toBe(true);
    expect(Reflect.set(variant.required, "0", "forged")).toBe(false);
    expect(variant.required).toEqual(expected);
  });
});
