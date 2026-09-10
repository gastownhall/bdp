import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openRecoveryStore, type StoredResource } from "./recovery-store.js";
import {
  admitReadUpdateOperationNumbers,
  parseReadUpdateRequest,
  parseReadUpdateMutationResult,
  parseReadUpdateProblem,
  parseTypeDescriptor,
  stringifyJsonValue,
  type TypeDescriptor,
  type PropertyValidator,
  type PropertyDiagnosticEmitter,
  type PropertyValidationDiagnostic,
} from "@bdp/protocol";
import {
  evaluateResourceMutation,
  type EvaluatorStoredResource,
  type InstalledResourceContract,
  type ResourceEvaluationOptions,
  type ResourceMutation,
  type ResourceOperation,
  type ResourceRecord,
  type ResourceTransaction,
} from "./resource-evaluator.js";

const scope = "https://example.test/s/";
const beadType = "https://types.test/bead";
const linkType = "https://types.test/link";
const parentType = "https://types.test/parent";
const childType = "https://types.test/child";
const instant = "2026-09-10T10:00:00Z";
const beadDescriptor = (extra = {}): TypeDescriptor =>
  parseTypeDescriptor({ id: beadType, name: "Bead", describes: "bead", conformsTo: [], ...extra });
const linkDescriptor = (extra = {}): TypeDescriptor =>
  parseTypeDescriptor({
    id: linkType,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [beadType], external: "none" },
    target: { conformsTo: [beadType], external: "opaque" },
    ...extra,
  });

/** This is a transaction test double, not a second production graph authority.
 * Its rollback reproduces the evaluator's explicit S6 callback obligation.
 */
function fixture(descriptors: readonly TypeDescriptor[] = [beadDescriptor(), linkDescriptor()]) {
  const records = new Map<string, EvaluatorStoredResource>();
  const identities = new Set<string>();
  const aliases = new Map<string, string>();
  const contracts = new Map<string, InstalledResourceContract>(
    descriptors.map((descriptor) => [descriptor.id, { descriptor }]),
  );
  const installed = new Map(
    descriptors.map((descriptor) => [descriptor.id, JSON.stringify(descriptor)]),
  );
  const hidden = new Set<string>();
  let nextId = 0;
  let nextRevision = 0;
  let writes = 0;
  const authorized: string[] = [];
  const tx: ResourceTransaction = {
    resource: (id) => records.get(id),
    incidentLinks: (id) =>
      [...records.values()].filter(
        (record) => record.kind === "link" && (record.source === id || record.target === id),
      ),
    outgoingLinks: (id) =>
      [...records.values()].filter((record) => record.kind === "link" && record.source === id),
    identityWasCommitted: (id) => identities.has(id),
    alias: (id) => aliases.get(id),
    installedType: (id) => installed.get(id),
    allocateResourceId: (kind) => `${kind === "bead" ? "beads" : "links"}/generated-${++nextId}`,
    allocateRevision: () => `revision-${++nextRevision}`,
    putResource(record) {
      records.set(record.id, record);
      identities.add(record.id);
      writes++;
    },
    deleteResource(id) {
      records.delete(id);
      writes++;
    },
  };
  const options: ResourceEvaluationOptions = {
    scope,
    contracts: {
      get: (id, bytes) => (installed.get(id) === bytes ? contracts.get(id) : undefined),
    },
    policy: {
      canRead: (resource) => !hidden.has(resource.id),
      canCreate: (resource) => {
        authorized.push(resource.id);
        return true;
      },
      canWrite: (resource) => {
        authorized.push(resource.id);
        return true;
      },
    },
    maximumEndpointMultiplicity: [],
    committedAt: instant,
    recordChangeContext: false,
    limits: { diagnosticCount: 10, diagnosticBytes: 65536 },
  };
  function execute(
    operation: ResourceOperation,
    input: unknown,
    overrides: Partial<ResourceEvaluationOptions> = {},
  ) {
    const parsed = parseReadUpdateRequest(operation, stringifyJsonValue(input));
    const admission = admitReadUpdateOperationNumbers(parsed, {
      diagnostic: ({ pointer }) => ({ message: "inadmissible number", instanceLocation: pointer }),
    });
    if (!admission.ok) throw new Error("test input numbers must be admitted");
    const saved = {
      records: new Map(records),
      identities: new Set(identities),
      nextId,
      nextRevision,
      writes,
    };
    const rollback = () => {
      records.clear();
      for (const [id, record] of saved.records) records.set(id, record);
      identities.clear();
      for (const id of saved.identities) identities.add(id);
      nextId = saved.nextId;
      nextRevision = saved.nextRevision;
      writes = saved.writes;
    };
    try {
      const result = evaluateResourceMutation(
        tx,
        { operation, input: admission.input } as ResourceMutation,
        { ...options, ...overrides },
      );
      if (result.effect === "failure") {
        parseReadUpdateProblem(result.outcome);
        rollback();
      } else parseReadUpdateMutationResult(result.outcome);
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }
  const body = (id: string): ResourceRecord =>
    JSON.parse(records.get(id)?.bodyJson ?? "null") as ResourceRecord;
  const createBead = (id: string, properties = {}, extra = {}) =>
    execute("createBead", { id: `beads/${id}`, type: beadType, properties, ...extra });
  const createLink = (id: string, source = "beads/a", target: unknown = "beads/b", extra = {}) =>
    execute("createLink", { id: `links/${id}`, type: linkType, source, target, ...extra });
  return {
    tx,
    options,
    execute,
    body,
    createBead,
    createLink,
    records,
    identities,
    aliases,
    contracts,
    installed,
    hidden,
    authorized,
    allocations: () => ({ nextId, nextRevision }),
    writes: () => writes,
  };
}
function failure(result: ReturnType<ReturnType<typeof fixture>["execute"]>, code: string) {
  expect(result.effect).toBe("failure");
  if (result.effect !== "failure") throw new Error("expected failure");
  expect(result.outcome.code).toBe(code);
  expect(result.changed).toEqual([]);
  expect(result.deleted).toEqual([]);
  expect(result.resolutions).toEqual([]);
  return result.outcome;
}

describe("pure member Resource evaluation", () => {
  it("creates, patches and deletes both kinds, returning schema-valid final identities", () => {
    const f = fixture();
    f.createBead("a", { title: "a" });
    f.createBead("b");
    f.createLink("edge", "beads/a", { uri: "beads/b", revision: "provenance-not-a-CAS" });
    const link = f.body("links/edge");
    expect(link).toMatchObject({
      source: `${scope}beads/a`,
      target: { uri: `${scope}beads/b`, revision: "provenance-not-a-CAS" },
    });
    f.execute("updateBeadProperties", {
      bead: "beads/a",
      change: [{ op: "replace", path: "/title", value: "new" }],
    });
    f.execute("updateLinkProperties", {
      link: "links/edge",
      change: [{ op: "add", path: "/n", value: 1 }],
    });
    const last = f.body("links/edge");
    expect(last.revision).not.toBe(link.revision);
    const deletedLink = f.execute("deleteLink", {
      link: "links/edge",
      expectedRevision: last.revision,
    });
    expect(deletedLink.outcome).toEqual({
      outcome: "deleted",
      deleted: {
        resourceKind: "link",
        resource: { id: last.id, type: last.type, revision: last.revision },
      },
    });
    const lastBead = f.body("beads/a");
    const deleted = f.execute("deleteBead", { bead: "beads/a" });
    expect(deleted.outcome).toMatchObject({
      deleted: { resource: { revision: lastBead.revision } },
    });
    expect(f.records.has("beads/a")).toBe(false);
    failure(f.createBead("a"), "identity-taken");
    failure(f.createLink("edge"), "identity-taken");
  });
  it("normalizes accepted numeric spellings and preserves revisions and metadata on semantic no-ops", () => {
    const f = fixture();
    f.createBead(
      "a",
      { n: 1, zero: 0, nested: { a: 1, b: [2] } },
      { changeContext: { message: "original" } },
    );
    const before = f.body("beads/a");
    const allocated = f.allocations();
    const writes = f.writes();
    const raw =
      '{"bead":"beads/a","change":[{"op":"replace","path":"/n","value":1e0},{"op":"replace","path":"/zero","value":-0.0},{"op":"replace","path":"/nested","value":{"b":[2.0],"a":1}}],"changeContext":{"message":"ignored no-op"}}';
    const admitted = admitReadUpdateOperationNumbers(
      parseReadUpdateRequest("updateBeadProperties", raw),
      {
        diagnostic: ({ pointer }) => ({
          message: "inadmissible number",
          instanceLocation: pointer,
        }),
      },
    );
    if (!admitted.ok) throw new Error("admissible test numbers");
    const result = evaluateResourceMutation(
      f.tx,
      { operation: "updateBeadProperties", input: admitted.input },
      f.options,
    );
    expect(result.outcome).toMatchObject({ outcome: "updated", resource: before });
    expect(f.body("beads/a")).toEqual(before);
    expect(f.allocations()).toEqual(allocated);
    expect(f.writes()).toBe(writes);
    expect(Object.isFrozen(result.outcome)).toBe(true);
  });
  it("checks authorization before CAS and keeps failed validation from staging any Resource writes", () => {
    const f = fixture();
    f.createBead("a", { n: 1 });
    const before = f.body("beads/a");
    const writes = f.writes();
    failure(
      f.execute(
        "updateBeadProperties",
        {
          bead: "beads/a",
          expectedRevision: "stale",
          change: [{ op: "replace", path: "/n", value: 2 }],
        },
        { policy: { ...f.options.policy, canWrite: () => false } },
      ),
      "forbidden",
    );
    failure(
      f.execute("updateBeadProperties", {
        bead: "beads/a",
        expectedRevision: "stale",
        change: [{ op: "replace", path: "/n", value: 2 }],
      }),
      "revision-mismatch",
    );
    failure(
      f.execute("updateBeadProperties", {
        bead: "beads/a",
        change: [{ op: "replace", path: "/missing", value: 2 }],
      }),
      "validation-failed",
    );
    expect(f.body("beads/a")).toEqual(before);
    expect(f.writes()).toBe(writes);
  });
  it("does not reveal hidden subjects or endpoints through write permission or diagnostics", () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.hidden.add(`${scope}beads/b`);
    f.authorized.length = 0;
    const hidden = failure(
      f.execute("updateBeadProperties", {
        bead: "beads/b",
        change: [{ op: "remove", path: "/missing" }],
      }),
      "resource-not-found",
    );
    expect(hidden).toEqual(
      failure(
        f.execute("updateBeadProperties", {
          bead: "beads/unknown",
          change: [{ op: "remove", path: "/missing" }],
        }),
        "resource-not-found",
      ),
    );
    failure(f.createLink("edge"), "resource-not-found");
    expect(f.authorized).toEqual([]);
    expect(f.records.has("links/edge")).toBe(false);
  });
  it("withholds incident Link identity while refusing deletion, and respects earlier member effects", () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.createLink("secret");
    f.hidden.add(`${scope}links/secret`);
    const problem = failure(f.execute("deleteBead", { bead: "beads/a" }), "incident-links-exist");
    expect(JSON.stringify(problem)).not.toContain("secret");
    f.hidden.clear();
    f.execute("deleteLink", { link: "links/secret" });
    expect(f.execute("deleteBead", { bead: "beads/a" }).effect).toBe("success");
  });
  it("keeps supplied identity/alias collision precedence and treats aliases as current locators", () => {
    const f = fixture();
    f.createBead("a");
    f.aliases.set("taken", "beads/a");
    failure(f.createBead("a", {}, { type: "https://missing.test/type" }), "identity-taken");
    failure(f.createBead("taken", {}, { type: "https://missing.test/type" }), "alias-path-taken");
    const result = f.execute("updateBeadProperties", {
      bead: "alias/taken",
      change: [{ op: "replace", path: "", value: {} }],
    });
    expect(result.outcome).toMatchObject({ resource: { id: `${scope}beads/a` } });
    f.aliases.delete("taken");
    failure(f.execute("deleteBead", { bead: "alias/taken" }), "resource-not-found");
  });
  it("distinguishes wrong-kind subjects, wrong-category endpoints and unavailable contract closure", () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    failure(f.execute("deleteBead", { bead: "links/a" }), "resource-not-found");
    failure(f.createLink("wrong", "beads/a", "links/other"), "validation-failed");
    failure(
      f.createBead("missing", {}, { type: "https://types.test/missing" }),
      "type-not-installed",
    );
    f.installed.delete(beadType);
    failure(f.createLink("unknown"), "type-not-installed");
  });
  it("enforces every installed properties contract once and refuses missing precompiled schema validators", () => {
    const schema = { $id: "https://schemas.test/base", type: "object" };
    const parent = beadDescriptor({ id: parentType, propertiesSchema: schema.$id });
    const child = beadDescriptor({
      conformsTo: [parentType],
      propertiesSchema: "https://schemas.test/child",
    });
    const f = fixture([parent, child]);
    failure(f.createBead("a"), "type-not-installed");
    const calls: string[] = [];
    for (const [id, entry] of f.contracts)
      f.contracts.set(id, {
        ...entry,
        validateProperties: (_properties, diagnostics) => {
          calls.push(id);
          const complete = diagnostics.emit({
            schemaLocation: `${id === parentType ? schema.$id : "https://schemas.test/child"}#/type`,
            instanceLocation: "",
            message: "rejected by installed fixture contract",
          });
          return { valid: false, diagnosticsComplete: complete };
        },
      });
    const problem = failure(f.createBead("a"), "validation-failed");
    expect(new Set(calls)).toEqual(new Set([beadType, parentType]));
    expect(calls).toHaveLength(2);
    expect(problem.diagnostics?.map((entry) => entry.type)).toEqual([beadType, parentType]);
    expect(f.records.size).toBe(0);
    const bounded = failure(
      f.execute(
        "createBead",
        { id: "beads/a", type: beadType },
        { limits: { diagnosticCount: 1, diagnosticBytes: 65536 } },
      ),
      "validation-failed",
    );
    expect(bounded.diagnostics).toHaveLength(1);
    expect(bounded.diagnosticsTruncated).toBe(true);
  });
  describe("confirmed property-diagnostic receiving contract", () => {
    const diagnostic = {
      schemaLocation: "https://schemas.test/%C3%A9#/properties/x/type",
      instanceLocation: '/é~1key/"',
      message: 'expected a string, including "quotes"',
    };
    function withValidators(child: PropertyValidator, parent?: PropertyValidator) {
      const descriptors = [
        beadDescriptor({
          propertiesSchema: "https://schemas.test/child",
          conformsTo: parent ? [parentType] : [],
        }),
      ];
      if (parent)
        descriptors.push(
          beadDescriptor({
            id: parentType,
            propertiesSchema: "https://schemas.test/parent",
          }),
        );
      const f = fixture(descriptors);
      f.contracts.set(beadType, {
        descriptor: descriptors[0] as TypeDescriptor,
        validateProperties: child,
      });
      if (parent)
        f.contracts.set(parentType, {
          descriptor: descriptors[1] as TypeDescriptor,
          validateProperties: parent,
        });
      return f;
    }
    const reject: PropertyValidator = (_properties, emitter) => ({
      valid: false,
      diagnosticsComplete: emitter.emit(diagnostic),
    });
    const input = { id: "beads/a", type: beadType };

    it("accounts actual wire bytes including Type across schemas, without false exact-bound truncation", () => {
      const expected = [beadType, parentType].map((type) => ({ ...diagnostic, type }));
      const bytes = Buffer.byteLength(JSON.stringify(expected));
      const f = withValidators(reject, reject);
      const exact = failure(
        f.execute("createBead", input, {
          limits: { diagnosticCount: 2, diagnosticBytes: bytes },
        }),
        "validation-failed",
      );
      expect(exact.diagnostics).toEqual(expected);
      expect(exact).not.toHaveProperty("diagnosticsTruncated");
      expect(Buffer.byteLength(JSON.stringify(exact.diagnostics))).toBe(bytes);
      for (const limits of [{ diagnosticCount: 1 }, { diagnosticBytes: bytes - 1 }]) {
        const bounded = failure(f.execute("createBead", input, { limits }), "validation-failed");
        expect(bounded.diagnostics).toEqual(expected.slice(0, 1));
        expect(bounded.diagnosticsTruncated).toBe(true);
      }
      const complete = failure(f.execute("createBead", input, { limits: {} }), "validation-failed");
      expect(complete.diagnostics).toEqual(expected);
      expect(complete).not.toHaveProperty("diagnosticsTruncated");
      expect(f.writes()).toBe(0);
      expect(f.authorized).toEqual([]);
    });

    it("does not call a valid later schema an omission when the exact budget is full", () => {
      let validCalls = 0;
      const f = withValidators(reject, () => {
        validCalls++;
        return { valid: true };
      });
      const bytes = Buffer.byteLength(JSON.stringify([{ ...diagnostic, type: beadType }]));
      const result = failure(
        f.execute("createBead", input, {
          limits: { diagnosticCount: 1, diagnosticBytes: bytes },
        }),
        "validation-failed",
      );
      expect(validCalls).toBe(1);
      expect(result.diagnostics).toHaveLength(1);
      expect(result).not.toHaveProperty("diagnosticsTruncated");
    });

    it("stops a producing validator only on confirmed omission and does not visit later Types", () => {
      let produced = 0;
      let parentCalls = 0;
      const f = withValidators(
        (_properties, emitter) => {
          // A streaming test producer, not an Ajv/compiler implementation claim.
          for (let i = 0; i < 10000; i++) {
            produced++;
            if (!emitter.emit({ ...diagnostic, instanceLocation: `/items/${i}` }))
              return { valid: false, diagnosticsComplete: false };
          }
          return { valid: false, diagnosticsComplete: true };
        },
        () => {
          parentCalls++;
          return { valid: true };
        },
      );
      const result = failure(
        f.execute("createBead", input, {
          limits: { diagnosticCount: 2 },
        }),
        "validation-failed",
      );
      expect(produced).toBe(3);
      expect(parentCalls).toBe(0);
      expect(result.diagnostics?.map((d) => d.instanceLocation)).toEqual(["/items/0", "/items/1"]);
      expect(result.diagnosticsTruncated).toBe(true);
      expect(f.writes()).toBe(0);
    });

    it("admits a valid result without speculative diagnostics escaping", () => {
      const f = withValidators((properties) => {
        // Stand-in branch evaluation: only the final Boolean reaches S2.
        const branchResults = [false, properties.choice === "valid"];
        if (!branchResults.some(Boolean)) throw new Error("positive control must match");
        return { valid: true };
      });
      expect(f.createBead("a", { choice: "valid" }).effect).toBe("success");
      expect(f.writes()).toBe(1);
    });

    it("snapshots caller limits before lookup and snapshots emitted wire fields", () => {
      const limits = { diagnosticCount: 1, diagnosticBytes: 65536 };
      const mutable = { ...diagnostic };
      const f = withValidators((_properties, emitter) => {
        expect(emitter.emit(mutable)).toBe(true);
        mutable.message = "changed after emission";
        limits.diagnosticCount = 10000;
        return { valid: false, diagnosticsComplete: emitter.emit(diagnostic) };
      });
      const original = f.options.contracts.get;
      const result = failure(
        f.execute("createBead", input, {
          limits,
          contracts: {
            get(type, bytes) {
              limits.diagnosticCount = 20000;
              return original(type, bytes);
            },
          },
        }),
        "validation-failed",
      );
      expect(result.diagnostics).toEqual([{ ...diagnostic, type: beadType }]);
      expect(result.diagnosticsTruncated).toBe(true);
      expect(Object.isFrozen(result.diagnostics?.[0])).toBe(true);
    });

    it("includes Type bytes in first-entry feasibility and does not let the validator swallow its error", () => {
      const bytesWithoutType = Buffer.byteLength(JSON.stringify([diagnostic]));
      const f = withValidators((_properties, emitter) => {
        try {
          emitter.emit(diagnostic);
        } catch {
          /* deliberately broken compiler */
        }
        return { valid: true };
      });
      expect(() =>
        f.execute("createBead", input, { limits: { diagnosticBytes: bytesWithoutType } }),
      ).toThrow("diagnostic configuration cannot retain one complete diagnostic");
      expect(f.writes()).toBe(0);
      expect(f.allocations()).toEqual({ nextId: 0, nextRevision: 0 });
      expect(f.authorized).toEqual([]);
    });

    it.each<[string, PropertyValidator]>([
      [
        "success after confirmed failure",
        (_p, e) => {
          e.emit(diagnostic);
          return { valid: true };
        },
      ],
      ["failure without a diagnostic", () => ({ valid: false, diagnosticsComplete: true })],
      [
        "unproved truncation",
        (_p, e) => {
          e.emit(diagnostic);
          return { valid: false, diagnosticsComplete: false };
        },
      ],
      [
        "omission reported complete",
        (_p, e) => {
          e.emit(diagnostic);
          e.emit(diagnostic);
          return { valid: false, diagnosticsComplete: true };
        },
      ],
      [
        "emission after stop",
        (_p, e) => {
          e.emit(diagnostic);
          e.emit(diagnostic);
          e.emit(diagnostic);
          return { valid: false, diagnosticsComplete: false };
        },
      ],
      [
        "swallowed emission-after-stop",
        (_p, e) => {
          e.emit(diagnostic);
          e.emit(diagnostic);
          try {
            e.emit(diagnostic);
          } catch {
            /* deliberately broken compiler */
          }
          return { valid: false, diagnosticsComplete: false };
        },
      ],
    ])("rejects a broken validator contract: %s", (_name, validator) => {
      const f = withValidators(validator);
      expect(() => f.execute("createBead", input, { limits: { diagnosticCount: 1 } })).toThrow(
        TypeError,
      );
      expect(f.writes()).toBe(0);
      expect(f.records.size).toBe(0);
      expect(f.authorized).toEqual([]);
    });

    it.each([true, false])(
      "keeps swallowed closed-emitter faults sticky through result getters (valid=%s)",
      (valid) => {
        const f = withValidators((_properties, emitter) => {
          if (!valid) emitter.emit(diagnostic);
          const misuse = () => {
            try {
              emitter.emit(diagnostic);
            } catch {
              /* broken producer */
            }
          };
          return valid
            ? {
                get valid() {
                  misuse();
                  return true as const;
                },
              }
            : {
                valid: false,
                get diagnosticsComplete() {
                  misuse();
                  return true;
                },
              };
        });
        expect(() => f.createBead("a")).toThrow("outside its active diagnostic traversal");
        expect(f.writes()).toBe(0);
        expect(f.records.size).toBe(0);
        expect(f.authorized).toEqual([]);
      },
    );

    it.each([true, false])(
      "keeps a prior Type's emitter fault sticky through a later Type (valid=%s)",
      (valid) => {
        let prior: PropertyDiagnosticEmitter | undefined;
        const f = withValidators(
          (_properties, emitter) => {
            prior = emitter;
            return { valid: true };
          },
          (_properties, emitter) => {
            try {
              prior?.emit(diagnostic);
            } catch {
              /* broken producer */
            }
            return valid
              ? { valid: true }
              : { valid: false, diagnosticsComplete: emitter.emit(diagnostic) };
          },
        );
        expect(() => f.createBead("a")).toThrow("outside its active diagnostic traversal");
        expect(f.writes()).toBe(0);
        expect(f.records.size).toBe(0);
      },
    );

    it.each([true, false])(
      "keeps emitter faults sticky through later policy success/refusal (%s)",
      (allowed) => {
        let prior: PropertyDiagnosticEmitter | undefined;
        const f = withValidators((_properties, emitter) => {
          prior = emitter;
          return { valid: true };
        });
        expect(() =>
          f.execute("createBead", input, {
            policy: {
              ...f.options.policy,
              canCreate() {
                try {
                  prior?.emit(diagnostic);
                } catch {
                  /* broken authority callback */
                }
                return allowed;
              },
            },
          }),
        ).toThrow("outside its active diagnostic traversal");
        expect(f.writes()).toBe(0);
        expect(f.records.size).toBe(0);
      },
    );

    it("checks the sticky fault before returning after a storage callback and rolls back staged effects", () => {
      let prior: PropertyDiagnosticEmitter | undefined;
      const f = withValidators((_properties, emitter) => {
        prior = emitter;
        return { valid: true };
      });
      const put = f.tx.putResource;
      let staged = 0;
      f.tx.putResource = (record) => {
        put(record);
        staged++;
        try {
          prior?.emit(diagnostic);
        } catch {
          /* broken storage callback */
        }
      };
      expect(() => f.createBead("a")).toThrow("outside its active diagnostic traversal");
      expect(staged).toBe(1);
      expect(f.writes()).toBe(0);
      expect(f.records.size).toBe(0);
      expect(f.identities.size).toBe(0);
    });

    it("captures each diagnostic getter exactly once, including instanceLocation", () => {
      const reads = { message: 0, schemaLocation: 0, instanceLocation: 0 };
      const f = withValidators((_properties, emitter) => ({
        valid: false,
        diagnosticsComplete: emitter.emit({
          get message() {
            reads.message++;
            return diagnostic.message;
          },
          get schemaLocation() {
            reads.schemaLocation++;
            return diagnostic.schemaLocation;
          },
          get instanceLocation() {
            return ++reads.instanceLocation === 1 ? "/first" : "/second";
          },
        }),
      }));
      const problem = failure(f.createBead("a"), "validation-failed");
      expect(reads).toEqual({ message: 1, schemaLocation: 1, instanceLocation: 1 });
      expect(problem.diagnostics?.[0]?.instanceLocation).toBe("/first");
      expect(f.writes()).toBe(0);
    });

    it("rejects an omitted properties location internally, while retaining the empty root pointer", () => {
      const missing = { schemaLocation: diagnostic.schemaLocation, message: diagnostic.message };
      const f = withValidators((_properties, emitter) => ({
        valid: false,
        diagnosticsComplete: emitter.emit(missing as PropertyValidationDiagnostic),
      }));
      expect(() => f.createBead("a")).toThrow(TypeError);
      expect(f.writes()).toBe(0);
      expect(f.authorized).toEqual([]);
      const root = withValidators((_properties, emitter) => ({
        valid: false,
        diagnosticsComplete: emitter.emit({ ...diagnostic, instanceLocation: "" }),
      }));
      const result = failure(root.createBead("a"), "validation-failed");
      expect(result.diagnostics?.[0]?.instanceLocation).toBe("");
      expect(result).not.toHaveProperty("diagnosticsTruncated");
    });

    it.each([null, 42])("rejects nonstring properties locations internally: %s", (location) => {
      const f = withValidators((_properties, emitter) => ({
        valid: false,
        diagnosticsComplete: emitter.emit({
          ...diagnostic,
          instanceLocation: location,
        } as unknown as PropertyValidationDiagnostic),
      }));
      expect(() => f.createBead("a")).toThrow(TypeError);
      expect(f.writes()).toBe(0);
    });

    it("preserves the first swallowed emitter error when a result getter causes another", () => {
      const first = new Error("diagnostic getter fault");
      const f = withValidators((_properties, emitter) => {
        try {
          emitter.emit({
            ...diagnostic,
            get message(): string {
              throw first;
            },
          });
        } catch {
          /* broken producer */
        }
        return {
          get valid() {
            try {
              emitter.emit(diagnostic);
            } catch {
              /* second, closed-emitter fault */
            }
            return true as const;
          },
        };
      });
      let caught: unknown;
      try {
        f.createBead("a");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(first);
      expect(f.writes()).toBe(0);
      expect(f.records.size).toBe(0);
    });

    it("closes each emitter when its synchronous invocation returns", () => {
      let escaped: PropertyDiagnosticEmitter | undefined;
      const f = withValidators((_properties, emitter) => {
        escaped = emitter;
        return { valid: true };
      });
      expect(f.createBead("a").effect).toBe("success");
      expect(() => escaped?.emit(diagnostic)).toThrow("outside its active diagnostic traversal");
      expect(f.writes()).toBe(1);
    });
  });
  it("requires effective endpoint conformance and preserves opaque external URIs", () => {
    const f = fixture([
      beadDescriptor(),
      beadDescriptor({ id: parentType }),
      linkDescriptor({ target: { conformsTo: [parentType], external: "opaque" } }),
    ]);
    f.createBead("a");
    f.createBead("b");
    const problem = failure(f.createLink("wrong"), "validation-failed");
    expect(problem.diagnostics?.[0]).toMatchObject({
      type: linkType,
      schemaLocation: `${linkType}#/target/conformsTo`,
    });
    const opaque = "urn:Outside:%2f+Literal";
    expect(f.createLink("external", "beads/a", opaque).effect).toBe("success");
    expect(f.body("links/external")).toMatchObject({ target: opaque });
  });
  it("applies inherited external constraints as an intersection and never dereferences an external pin", () => {
    const parent = linkDescriptor({ id: parentType, target: { conformsTo: [], external: "bead" } });
    const f = fixture([beadDescriptor(), parent, linkDescriptor({ conformsTo: [parentType] })]);
    f.createBead("a");
    failure(f.createLink("bad", "beads/a", "urn:opaque"), "validation-failed");
    failure(
      f.createLink("bad-segment", "beads/a", "https://external.test/s/beads/a%2Fb"),
      "validation-failed",
    );
    expect(
      f.createLink("good", "beads/a", {
        uri: "https://external.test/s/beads/elsewhere",
        revision: "unverified-provenance",
      }).effect,
    ).toBe("success");
  });
  it("refuses broken installed ancestry instead of silently treating it as a no-schema contract", () => {
    const f = fixture([beadDescriptor({ conformsTo: [parentType] })]);
    failure(f.createBead("a"), "type-not-installed");
    f.contracts.set(parentType, {
      descriptor: beadDescriptor({ id: parentType, conformsTo: [beadType] }),
    });
    f.installed.set(parentType, "installed-cycle");
    failure(f.createBead("a"), "type-not-installed");
  });
  it("supports all three patch operations, escaped names and arrays without prototype mutation", () => {
    const f = fixture();
    f.createBead("a", { list: [1, 3], "a/b": { "~x": 1 } });
    const result = f.execute("updateBeadProperties", {
      bead: "beads/a",
      change: [
        { op: "add", path: "/list/1", value: 2 },
        { op: "remove", path: "/list/0" },
        { op: "replace", path: "/a~1b/~0x", value: 7 },
        { op: "add", path: "/__proto__", value: { polluted: true } },
      ],
    });
    expect(result.effect).toBe("success");
    expect(f.body("beads/a").properties).toEqual(
      JSON.parse('{"list":[2,3],"a/b":{"~x":7},"__proto__":{"polluted":true}}'),
    );
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    failure(
      f.execute("updateBeadProperties", { bead: "beads/a", change: [{ op: "remove", path: "" }] }),
      "validation-failed",
    );
  });
  it("checks service limits at their member position and emits inherited 413", () => {
    const f = fixture();
    f.createBead("a", { n: 1 });
    const limits = { ...f.options.limits, patchOperations: 0 };
    const input = { bead: "beads/a", change: [{ op: "replace", path: "/n", value: 2 }] };
    failure(
      f.execute("updateBeadProperties", { ...input, expectedRevision: "wrong" }, { limits }),
      "revision-mismatch",
    );
    const problem = failure(f.execute("updateBeadProperties", input, { limits }), "limit-exceeded");
    expect(problem.status).toBe(413);
    expect(f.body("beads/a").properties).toEqual({ n: 1 });
  });
  it("keeps reference visibility ahead of unavailable Type diagnostics", () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.hidden.add(`${scope}beads/b`);
    failure(
      f.createLink("hidden", "beads/a", "beads/b", { type: "https://missing.test/type" }),
      "resource-not-found",
    );
    failure(
      f.createLink("missing", "beads/a", "beads/missing", { type: "https://missing.test/type" }),
      "resource-not-found",
    );
  });
  it("returns exact same-turn reference resolutions for S4 without putting them on the wire", () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.aliases.set("current", "beads/a");
    const external = { uri: "urn:Exact:%2f+Bytes", revision: "opaque-pin" };
    const result = f.createLink("edge", "alias/current", external);
    expect(result.resolutions).toEqual([
      { inputPointer: "/id", original: "links/edge", resolved: `${scope}links/edge` },
      { inputPointer: "/source", original: "alias/current", resolved: `${scope}beads/a` },
      { inputPointer: "/target", original: external, resolved: external },
    ]);
    expect(Object.hasOwn(result.outcome, "resolutions")).toBe(false);
    expect(Object.isFrozen(result.resolutions)).toBe(true);
    f.aliases.set("current", "beads/b");
    const update = f.execute("updateBeadProperties", {
      bead: "alias/current",
      change: [{ op: "replace", path: "", value: {} }],
    });
    expect(update.resolutions).toEqual([
      { inputPointer: "/bead", original: "alias/current", resolved: `${scope}beads/b` },
    ]);
    expect(result.resolutions[1]?.resolved).toBe(`${scope}beads/a`);
    f.hidden.add(`${scope}beads/b`);
    failure(f.execute("deleteBead", { bead: "alias/current" }), "resource-not-found");
  });
  it("permits omitted external policy as opaque and refuses explicit none", () => {
    const f = fixture([beadDescriptor(), linkDescriptor({ target: { conformsTo: [] } })]);
    f.createBead("a");
    expect(f.createLink("opaque", "beads/a", "mailto:Name@Example.test").effect).toBe("success");
    const g = fixture([
      beadDescriptor(),
      linkDescriptor({ target: { conformsTo: [], external: "none" } }),
    ]);
    g.createBead("a");
    const problem = failure(g.createLink("none", "beads/a", "urn:outside"), "validation-failed");
    expect(problem.diagnostics?.[0]).toMatchObject({
      type: linkType,
      schemaLocation: `${linkType}#/target/external`,
    });
  });
  it("gives one current-revision winner and observes deletion versus Link creation in member order", () => {
    const f = fixture();
    f.createBead("a", { n: 0 });
    f.createBead("b");
    const expectedRevision = f.body("beads/a").revision;
    expect(
      f.execute("updateBeadProperties", {
        bead: "beads/a",
        expectedRevision,
        change: [{ op: "replace", path: "/n", value: 1 }],
      }).effect,
    ).toBe("success");
    failure(
      f.execute("updateBeadProperties", {
        bead: "beads/a",
        expectedRevision,
        change: [{ op: "replace", path: "/n", value: 2 }],
      }),
      "revision-mismatch",
    );
    expect(f.body("beads/a").properties).toEqual({ n: 1 });
    f.execute("deleteBead", { bead: "beads/b" });
    failure(f.createLink("late"), "resource-not-found");
    // Serialization/competing connection behavior belongs to S6; this proves
    // the evaluator reads the supplied member-turn state instead of a cache.
  });
  it("preserves attribution on no-ops and removes it on a new unattributed version", () => {
    const f = fixture();
    const attribution = { principal: "urn:claimed-author", status: "claimed" };
    f.createBead("a", { n: 1 }, { attribution });
    const before = f.body("beads/a");
    f.execute("updateBeadProperties", {
      bead: "beads/a",
      change: [{ op: "replace", path: "/n", value: 1 }],
      attribution: { principal: "urn:different", status: "unknown" },
    });
    expect(f.body("beads/a")).toEqual(before);
    f.execute("updateBeadProperties", {
      bead: "beads/a",
      change: [{ op: "replace", path: "/n", value: 2 }],
    });
    expect(f.body("beads/a").attribution).toBeUndefined();
  });
  it("records native context defaults only on actual minted versions", () => {
    const f = fixture();
    expect(
      f.execute("createBead", { id: "beads/a", type: beadType }, { recordChangeContext: true })
        .effect,
    ).toBe("success");
    expect(f.body("beads/a").changeContext).toEqual({
      committedAt: { state: "present", value: instant },
      agent: { state: "undetermined" },
      message: { state: "undetermined" },
    });
    const before = f.body("beads/a");
    f.execute(
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "replace", path: "", value: {} }] },
      { recordChangeContext: true, committedAt: "2026-09-11T00:00:00Z" },
    );
    expect(f.body("beads/a")).toEqual(before);
  });
  it("distinguishes positive unsafe allocation from unknown storage faults and rolls counters back on failure", () => {
    const f = fixture();
    const saved = f.allocations();
    failure(
      f.execute(
        "createBead",
        { type: beadType },
        { policy: { ...f.options.policy, canCreate: () => false } },
      ),
      "forbidden",
    );
    expect(f.allocations()).toEqual(saved);
    f.tx.allocateRevision = () => ({ kind: "allocation-unsafe" });
    failure(f.createBead("a"), "revision-allocation-unsafe");
    f.tx.allocateRevision = () => {
      throw new Error("storage fault");
    };
    expect(() => f.createBead("a")).toThrow("storage fault");
    expect(f.records.size).toBe(0);
  });
});

describe("owned Link and Scope aggregate effects", () => {
  it("updates only the source revision, fans out context, preserves no-ops and versions owned deletion", () => {
    const f = fixture([
      beadDescriptor({ ownsOutgoing: { [linkType]: { max: 3 } } }),
      linkDescriptor(),
    ]);
    f.createBead("a");
    f.createBead("b");
    const target = f.body("beads/b");
    const created = f.createLink("edge", "beads/a", "beads/b", {
      changeContext: { agent: null, message: "create" },
    });
    expect(created.outcome).toMatchObject({
      source: `${scope}beads/a`,
      sourceRevision: f.body("beads/a").revision,
    });
    const edge = f.body("links/edge");
    const source = f.body("beads/a");
    expect(source).toMatchObject({
      ownedLinks: { [linkType]: [edge] },
      changeContext: edge.changeContext,
    });
    expect(source.changeContext).toMatchObject({
      committedAt: { state: "present", value: instant },
      agent: { state: "absent" },
      message: { state: "present", value: "create" },
    });
    const counters = f.allocations();
    f.execute("updateLinkProperties", {
      link: "links/edge",
      change: [{ op: "replace", path: "", value: {} }],
      changeContext: { message: "not a version" },
    });
    expect(f.body("beads/a")).toEqual(source);
    expect(f.allocations()).toEqual(counters);
    f.execute("updateLinkProperties", {
      link: "links/edge",
      change: [{ op: "add", path: "/n", value: 1 }],
    });
    expect(f.body("beads/a").revision).not.toBe(source.revision);
    expect(f.body("links/edge").changeContext).toBeUndefined();
    const lastLink = f.body("links/edge");
    const beforeDelete = f.allocations();
    const deleted = f.execute("deleteLink", {
      link: "links/edge",
      changeContext: { message: "delete" },
    });
    expect(deleted.outcome).toMatchObject({
      deleted: { resource: { revision: lastLink.revision } },
      sourceRevision: f.body("beads/a").revision,
    });
    expect(f.allocations().nextRevision).toBe(beforeDelete.nextRevision + 1);
    expect(f.body("beads/a")).toMatchObject({
      ownedLinks: { [linkType]: [] },
      changeContext: { message: { state: "present", value: "delete" } },
    });
    expect(f.body("beads/b")).toEqual(target);
  });
  it("uses wildcard whole-set bounds including explicit keys and leaves no staged Link on overflow", () => {
    const other = "https://types.test/other-link";
    const f = fixture([
      beadDescriptor({ ownsOutgoing: { [linkType]: { max: 2 }, "*": { max: 2 } } }),
      linkDescriptor(),
      linkDescriptor({ id: other }),
    ]);
    f.createBead("a");
    f.createBead("b");
    f.createLink("z");
    f.createLink("a", "beads/a", "beads/b", { type: other });
    const source = f.body("beads/a");
    const writes = f.writes();
    const problem = failure(f.createLink("overflow"), "validation-failed");
    expect(problem.diagnostics?.[0]).toMatchObject({
      type: beadType,
      schemaLocation: `${beadType}#/ownsOutgoing/*`,
    });
    expect(f.writes()).toBe(writes);
    expect(f.body("beads/a")).toEqual(source);
    expect(f.records.has("links/overflow")).toBe(false);
    expect(Object.keys((source as { ownedLinks: object }).ownedLinks)).not.toContain("*");
  });
  it("sorts same-type owned Links by canonical ID and handles a self-Link once", () => {
    const f = fixture([
      beadDescriptor({ ownsOutgoing: { [linkType]: { max: 3 } } }),
      linkDescriptor(),
    ]);
    f.createBead("a");
    f.createLink("z", "beads/a", "beads/a");
    f.createLink("a", "beads/a", "beads/a");
    expect(f.body("beads/a")).toMatchObject({
      ownedLinks: { [linkType]: [{ id: `${scope}links/a` }, { id: `${scope}links/z` }] },
    });
    expect(
      f.execute("updateBeadProperties", {
        bead: "beads/a",
        change: [{ op: "add", path: "/ok", value: true }],
      }).effect,
    ).toBe("success");
  });
  it("withholds a source whose owned closure contains a hidden target before any write-policy diagnostics", () => {
    const f = fixture([
      beadDescriptor({ ownsOutgoing: { [linkType]: { max: 3 } } }),
      linkDescriptor(),
    ]);
    f.createBead("a");
    f.createBead("b");
    f.createLink("edge");
    f.hidden.add(`${scope}beads/b`);
    f.authorized.length = 0;
    failure(
      f.execute("updateBeadProperties", {
        bead: "beads/a",
        change: [{ op: "remove", path: "/missing" }],
      }),
      "resource-not-found",
    );
    expect(f.authorized).toEqual([]);
  });
  it("requires write authority for the owned source and rolls back both Resource effects", () => {
    const f = fixture([
      beadDescriptor({ ownsOutgoing: { [linkType]: { max: 3 } } }),
      linkDescriptor(),
    ]);
    f.createBead("a");
    f.createBead("b");
    const before = f.body("beads/a");
    const writes = f.writes();
    failure(
      f.execute(
        "createLink",
        { id: "links/edge", type: linkType, source: "beads/a", target: "beads/b" },
        { policy: { ...f.options.policy, canWrite: () => false } },
      ),
      "forbidden",
    );
    expect(f.body("beads/a")).toEqual(before);
    expect(f.records.has("links/edge")).toBe(false);
    expect(f.writes()).toBe(writes);
  });
  it("counts subtype Links and all current member state for endpoint maxima without revealing Link identity", () => {
    const f = fixture([
      beadDescriptor(),
      linkDescriptor(),
      linkDescriptor({ id: childType, conformsTo: [linkType] }),
    ]);
    f.createBead("a");
    f.createBead("b");
    f.createLink("child", "beads/a", "beads/b", { type: childType });
    f.hidden.add(`${scope}links/child`);
    const maximumEndpointMultiplicity = [
      { linkConformsTo: linkType, endpoint: "target" as const, max: 1 },
    ];
    const problem = failure(
      f.execute(
        "createLink",
        { id: "links/overflow", type: linkType, source: "beads/a", target: "beads/b" },
        { maximumEndpointMultiplicity },
      ),
      "aggregate-constraint-violation",
    );
    expect(JSON.stringify(problem)).not.toContain("child");
    f.hidden.clear();
    expect(
      f.execute(
        "updateLinkProperties",
        { link: "links/child", change: [{ op: "replace", path: "", value: {} }] },
        { maximumEndpointMultiplicity },
      ).effect,
    ).toBe("success");
    f.execute("deleteLink", { link: "links/child" });
    expect(
      f.execute(
        "createLink",
        { id: "links/new", type: linkType, source: "beads/a", target: "beads/b" },
        { maximumEndpointMultiplicity },
      ).effect,
    ).toBe("success");
  });
});

describe("deep admitted Resource round trips", () => {
  it.each([256, 12_000])("creates, reads, preserves no-ops and patches at depth %i", (depth) => {
    const f = fixture();
    const nestedText = `${"[1,".repeat(depth)}{"n":7}${"]".repeat(depth)}`;
    const nested: unknown = JSON.parse(nestedText);
    if (depth > 1_000) expect(() => JSON.stringify(nested)).toThrow(RangeError);
    const created = f.createBead("deep", { nested });
    expect(created.effect).toBe("success");
    const before = f.records.get("beads/deep");
    expect(before?.bodyJson).toContain(`"properties":{"nested":${nestedText}}`);
    const revision = f.body("beads/deep").revision;
    const noop = f.execute("updateBeadProperties", {
      bead: "beads/deep",
      change: [{ op: "replace", path: "", value: { nested } }],
    });
    expect(noop.effect).toBe("success");
    expect(noop.changed).toEqual([]);
    expect(f.body("beads/deep").revision).toBe(revision);
    const path = `/nested${"/1".repeat(depth)}/n`;
    const updated = f.execute("updateBeadProperties", {
      bead: "beads/deep",
      expectedRevision: revision,
      change: [{ op: "replace", path, value: 8 }],
    });
    expect(updated.effect).toBe("success");
    expect(f.body("beads/deep").revision).not.toBe(revision);
    expect(f.records.get("beads/deep")?.bodyJson).toContain(
      `"properties":{"nested":${nestedText.replace('{"n":7}', '{"n":8}')}}`,
    );
    let cursor = f.body("beads/deep").properties.nested;
    for (let i = 0; i < depth; i++) {
      if (!Array.isArray(cursor)) throw new Error(`missing depth ${i}`);
      expect(cursor[0]).toBe(1);
      cursor = cursor[1];
    }
    expect(cursor).toEqual({ n: 8 });
    const retained = f.records.get("beads/deep")?.bodyJson;
    failure(
      f.execute(
        "updateBeadProperties",
        { bead: "beads/deep", change: [{ op: "add", path: "/small", value: true }] },
        { limits: { ...f.options.limits, propertiesBytes: 100 } },
      ),
      "limit-exceeded",
    );
    expect(f.records.get("beads/deep")?.bodyJson).toBe(retained);
  });
  it("keeps deep first-class and inline owned Link bodies equal across read/update/delete", () => {
    const f = fixture([
      beadDescriptor({ ownsOutgoing: { [linkType]: { max: 2 } } }),
      linkDescriptor(),
    ]);
    f.createBead("a");
    f.createBead("b");
    const depth = 12_000;
    const nested: unknown = JSON.parse(`${"[1,".repeat(depth)}0${"]".repeat(depth)}`);
    expect(f.createLink("deep", "beads/a", "beads/b", { properties: { nested } }).effect).toBe(
      "success",
    );
    const source = f.body("beads/a");
    if (!("ownedLinks" in source)) throw new Error("expected owned Link source");
    expect(stringifyJsonValue(source.ownedLinks?.[linkType]?.[0])).toBe(
      f.records.get("links/deep")?.bodyJson,
    );
    const oldRevision = f.body("links/deep").revision;
    expect(
      f.execute("updateLinkProperties", {
        link: "links/deep",
        change: [{ op: "replace", path: "", value: { nested } }],
      }).changed,
    ).toEqual([]);
    expect(f.body("links/deep").revision).toBe(oldRevision);
    expect(
      f.execute("updateLinkProperties", {
        link: "links/deep",
        change: [{ op: "add", path: "/changed", value: true }],
      }).effect,
    ).toBe("success");
    const updatedSource = f.body("beads/a");
    if (!("ownedLinks" in updatedSource)) throw new Error("expected source");
    expect(stringifyJsonValue(updatedSource.ownedLinks?.[linkType]?.[0])).toBe(
      f.records.get("links/deep")?.bodyJson,
    );
    expect(f.execute("deleteLink", { link: "links/deep" }).effect).toBe("success");
    expect(f.body("beads/a")).toMatchObject({ ownedLinks: { [linkType]: [] } });
  });
});

describe("native S2 council corrections", () => {
  it("requires at least one local endpoint with either direction allowed", () => {
    const type = linkDescriptor({
      source: { conformsTo: [], external: "opaque" },
      target: { conformsTo: [], external: "opaque" },
    });
    const f = fixture([beadDescriptor(), type]);
    f.createBead("a");
    failure(f.createLink("external-only", "urn:source", "urn:target"), "validation-failed");
    expect(f.records.has("links/external-only")).toBe(false);
    expect(f.createLink("local-source", "beads/a", "urn:target").effect).toBe("success");
    expect(f.createLink("local-target", "urn:source", "beads/a").effect).toBe("success");
  });
  it.each([
    [[{ op: "replace", path: "", value: { n: 2 } }], true],
    [
      [
        { op: "remove", path: "" },
        { op: "add", path: "", value: { n: 2 } },
      ],
      true,
    ],
    [
      [
        { op: "remove", path: "" },
        { op: "replace", path: "", value: { n: 2 } },
      ],
      false,
    ],
    [
      [
        { op: "remove", path: "" },
        { op: "remove", path: "" },
        { op: "add", path: "", value: { n: 2 } },
      ],
      false,
    ],
    [
      [
        { op: "replace", path: "", value: null },
        { op: "replace", path: "", value: { n: 2 } },
      ],
      true,
    ],
    [
      [
        { op: "replace", path: "", value: null },
        { op: "remove", path: "" },
        { op: "add", path: "", value: { n: 2 } },
      ],
      true,
    ],
  ])("tracks root existence independently of JSON null %#", (change, valid) => {
    const f = fixture();
    f.createBead("a", { n: 1 });
    const before = f.records.get("beads/a")?.bodyJson;
    const result = f.execute("updateBeadProperties", { bead: "beads/a", change });
    if (valid) {
      expect(result.effect).toBe("success");
      expect(f.body("beads/a").properties).toEqual({ n: 2 });
    } else {
      failure(result, "validation-failed");
      expect(f.records.get("beads/a")?.bodyJson).toBe(before);
    }
  });
});

describe("allocator faults inside the durable owned-member boundary", () => {
  it.each([
    "committed-id",
    "alias-id",
    "empty-id",
    "hierarchical-id",
    "unsafe-id-tag",
    "nonstring-id",
    "empty-revision",
    "null-revision",
    "unknown-revision-tag",
    "nonstring-revision",
    "established-revision-conflict",
  ])("rolls back effects and allocations for %s and preserves the correct disposition", (fault) => {
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-s2-allocator-"));
    const configuration = {
      directory,
      scope,
      installationId: "s2-allocator-test",
      lineageId: "s2-allocator-lineage",
    };
    const seed: StoredResource = {
      id: "beads/existing",
      kind: "bead",
      bodyJson: JSON.stringify({
        id: `${scope}beads/existing`,
        type: beadType,
        revision: "initial",
        properties: {},
      }),
    };
    let store = openRecoveryStore({
      ...configuration,
      create: { resources: [seed], types: { [beadType]: JSON.stringify(beadDescriptor()) } },
    });
    const options = fixture().options;
    // Fixture identities are only storage controls, not the S4 normalizer.
    const retained = (effect: "success" | "failure", outcomeJson: string) => ({
      kind: "retain" as const,
      semanticIdentityJson: '{"fixture":"allocator"}',
      resolutionsJson: "{}",
      effect,
      outcomeJson,
      completedAt: 0,
      retainUntil: 86_400_000,
    });
    try {
      expect(store.runtime.node).toBe("v24.16.0");
      const setup = store.admit("alice", ["setup"]);
      store.executeMember(setup, "setup", (tx) => {
        tx.putAlias("reserved", seed.id);
        return retained("success", "{}");
      });
      const admission = store.admit("alice", ["fault"]);
      let allocatedId: string | undefined;
      let allocatedRevision: string | undefined;
      let evaluation: ReturnType<typeof evaluateResourceMutation> | undefined;
      const attempt = () =>
        store.executeMember(admission, "fault", (tx) => {
          // Real writes/counters occur before the injected facade fault, so the
          // rollback assertion is not vacuous merely because S2 writes last.
          tx.putPolicy("rollback-marker", "true");
          tx.putResource({
            ...seed,
            id: "beads/rollback-marker",
            bodyJson: JSON.stringify({
              id: `${scope}beads/rollback-marker`,
              type: beadType,
              revision: "marker",
              properties: {},
            }),
          });
          allocatedId = tx.allocateResourceId("bead");
          allocatedRevision = tx.allocateRevision();
          const facade: ResourceTransaction = {
            ...tx,
            allocateResourceId: () => allocatedId as string,
            allocateRevision: () => allocatedRevision as string,
          };
          // Deliberately invalid runtime facades verify the guard, not its TS type.
          switch (fault) {
            case "committed-id":
              facade.allocateResourceId = () => seed.id;
              break;
            case "alias-id":
              facade.allocateResourceId = () => "beads/reserved";
              break;
            case "hierarchical-id":
              facade.allocateResourceId = () => "beads/a/b";
              break;
            case "empty-id":
              facade.allocateResourceId = () => "";
              break;
            case "unsafe-id-tag":
              facade.allocateResourceId = () => ({ kind: "allocation-unsafe" }) as never;
              break;
            case "nonstring-id":
              facade.allocateResourceId = () => 4 as never;
              break;
            case "empty-revision":
              facade.allocateRevision = () => "";
              break;
            case "null-revision":
              facade.allocateRevision = () => null as never;
              break;
            case "unknown-revision-tag":
              facade.allocateRevision = () => ({ kind: "unknown" }) as never;
              break;
            case "nonstring-revision":
              facade.allocateRevision = () => 4 as never;
              break;
            case "established-revision-conflict":
              facade.allocateRevision = () => ({ kind: "allocation-unsafe" });
              break;
          }
          evaluation = evaluateResourceMutation(
            facade,
            {
              operation: "createBead",
              input: { type: beadType, properties: {} },
            },
            options,
          );
          return retained(evaluation.effect, JSON.stringify(evaluation.outcome));
        });
      if (fault === "established-revision-conflict") {
        expect(attempt().kind).toBe("completed");
        if (!evaluation) throw new Error("missing established failure");
        failure(evaluation, "revision-allocation-unsafe");
        expect(store.read((reader) => reader.key("alice", "fault"))).toMatchObject({
          kind: "retained",
          effect: "failure",
          outcomeJson: JSON.stringify(evaluation.outcome),
        });
      } else {
        expect(attempt).toThrow(/allocator/);
        expect(evaluation).toBeUndefined();
        expect(store.read((reader) => reader.key("alice", "fault"))).toMatchObject({
          kind: "claimed",
          attemptId: admission.attemptId,
        });
        expect(store.abandonAttempt(admission)).toBe(1);
      }
      expect(store.read((reader) => reader.resources())).toEqual([seed]);
      expect(store.read((reader) => reader.policy("rollback-marker"))).toBeUndefined();
      expect(store.read((reader) => reader.identityWasCommitted("beads/rollback-marker"))).toBe(
        false,
      );
      expect(store.read((reader) => reader.alias("reserved"))).toBe(seed.id);
      store.close();
      store = openRecoveryStore(configuration);
      expect(store.read((reader) => reader.key("alice", "fault"))).toMatchObject({
        kind: fault === "established-revision-conflict" ? "retained" : "unknown",
      });
      const retry = store.admit("alice", ["retry"]);
      let result: ReturnType<typeof evaluateResourceMutation> | undefined;
      store.executeMember(retry, "retry", (tx) => {
        // A successful real allocator now reuses only the rolled-back counters.
        result = evaluateResourceMutation(
          tx,
          {
            operation: "createBead",
            input: { type: beadType, properties: {} },
          },
          options,
        );
        return retained(result.effect, JSON.stringify(result.outcome));
      });
      expect(result).toMatchObject({
        effect: "success",
        outcome: {
          outcome: "created",
          resource: { id: `${scope}${allocatedId}`, revision: allocatedRevision },
        },
      });
      if (result?.effect !== "success") throw new Error("missing positive allocation");
      parseReadUpdateMutationResult(result.outcome);
      expect(store.read((reader) => reader.resources())).toHaveLength(2);
      expect(store.read((reader) => reader.key("alice", "retry"))).toMatchObject({
        kind: "retained",
        effect: "success",
        outcomeJson: JSON.stringify(result.outcome),
      });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["createBead", "createLink"] as const)(
    "refuses allocated hierarchy but preserves supplied hierarchy for %s",
    (operation) => {
      const f = fixture();
      f.createBead("a");
      f.createBead("b");
      const id = `${operation === "createBead" ? "beads" : "links"}/a/b`;
      const input =
        operation === "createBead"
          ? { type: beadType }
          : { type: linkType, source: "beads/a", target: "beads/b" };
      f.tx.allocateResourceId = () => id;
      const writes = f.writes();
      expect(() => f.execute(operation, input)).toThrow("one opaque Resource identity segment");
      expect(f.writes()).toBe(writes);
      expect(f.records.has(id)).toBe(false);
      f.tx.allocateResourceId = () => {
        throw new Error("supplied ID must not allocate");
      };
      const result = f.execute(operation, { ...input, id });
      expect(result).toMatchObject({
        effect: "success",
        outcome: {
          outcome: "created",
          resource: { id: `${scope}${id}` },
        },
      });
      expect(f.records.has(id)).toBe(true);
    },
  );

  it("keeps supplied-ID conflict meanings without invoking allocation", () => {
    const f = fixture();
    f.createBead("existing");
    f.aliases.set("reserved", "beads/existing");
    f.tx.allocateResourceId = () => {
      throw new Error("unexpected ID allocation");
    };
    f.tx.allocateRevision = () => {
      throw new Error("unexpected revision allocation");
    };
    failure(f.createBead("existing"), "identity-taken");
    failure(f.createBead("reserved"), "alias-path-taken");
    expect(f.records.size).toBe(1);
  });
});
