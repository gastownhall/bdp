import { Ajv2020 } from "ajv/dist/2020.js";
const schemaValidator = new Ajv2020({ strict: false, logger: false });
const beadSchema = (value) =>
  requireThat(schemaValidator.validateSchema(value), "Wire BeadSchema is not valid JSON Schema");
// Wire assertions follow specs/src/core/core.lumen. No provider code is imported.
export class Violation extends Error {}
export function requireThat(value, message) {
  if (!value) throw new Violation(message);
}
export const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function record(value, allowed, required = []) {
  requireThat(object(value), "Expected a JSON record");
  requireThat(
    Object.keys(value).every((k) => allowed.includes(k)),
    "Record contains an undefined member",
  );
  requireThat(
    required.every((k) => Object.hasOwn(value, k)),
    "Record omits a required member",
  );
}
export function string(value) {
  requireThat(typeof value === "string", "Expected a string");
}
export function boolean(value) {
  requireThat(typeof value === "boolean", "Expected a boolean");
}
export function integer(value) {
  requireThat(Number.isSafeInteger(value), "Expected an interoperable integer");
}
const uri = (value) => {
  string(value);
  try {
    new URL(value);
  } catch {
    throw new Violation("Expected an absolute URI");
  }
};
const timestamp = (value) => {
  string(value);
  requireThat(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    "Expected an RFC3339 timestamp",
  );
};
export function reference(value) {
  record(value, ["scope", "id", "rev"], ["id"]);
  string(value.id);
  if (value.scope !== undefined && value.scope !== null && value.scope !== "uri") uri(value.scope);
  if (value.scope === "uri") uri(value.id);
  if (value.rev !== undefined) string(value.rev);
}
function provenance(value) {
  record(
    value,
    ["principals", "inception", "committedAt", "previousRevision", "message", "metadata"],
    ["principals", "inception", "committedAt"],
  );
  requireThat(Array.isArray(value.principals), "Provenance principals must be an array");
  requireThat(
    ["create", "import", "unknown"].includes(value.inception),
    "Invalid provenance inception",
  );
  timestamp(value.committedAt);
  for (const p of value.principals) {
    record(p, ["id", "displayName", "roles", "basis", "authority"], ["id", "basis"]);
    uri(p.id);
    if (p.displayName !== undefined) string(p.displayName);
    if (p.roles !== undefined) {
      requireThat(Array.isArray(p.roles), "Principal roles must be an array");
      p.roles.forEach(string);
    }
    // IdentityBasis is explicitly open. Do not reject an unfamiliar authentication basis.
    requireThat(
      typeof p.basis === "string" || (object(p.basis) && typeof p.basis.kind === "string"),
      "Invalid open identity basis",
    );
    if (p.authority !== undefined) uri(p.authority);
  }
  if (value.previousRevision !== undefined) string(value.previousRevision);
  if (value.message !== undefined) string(value.message);
  if (value.metadata !== undefined)
    requireThat(object(value.metadata), "Metadata must remain an opaque record");
}
export function resource(value, { partial = false, revisionModel } = {}) {
  record(
    value,
    ["id", "authority", "type", "body", "metadata", "provenance", "createdAt", "storageClass"],
    partial ? ["id", "type"] : ["id", "type", "body"],
  );
  reference(value.id);
  string(value.type);
  if (revisionModel === "versioned") string(value.id.rev);
  if (revisionModel === "unversioned")
    requireThat(!Object.hasOwn(value.id, "rev"), "Unversioned resource carries a revision");
  if (value.authority !== undefined) {
    reference(value.authority);
    string(value.authority.rev);
  }
  if (value.metadata !== undefined)
    requireThat(object(value.metadata), "Metadata must remain an opaque record");
  if (value.provenance !== undefined) provenance(value.provenance);
  if (value.createdAt !== undefined) timestamp(value.createdAt);
  if (value.storageClass !== undefined) {
    record(value.storageClass, ["kind"], ["kind"]);
    requireThat(
      ["durable", "ephemeral", "intrinsic"].includes(value.storageClass.kind),
      "StorageClass must be an internally tagged union",
    );
  }
}
export const conditionKinds = [
  "compare",
  "matches",
  "has",
  "missing",
  "contains",
  "containsAny",
  "excludes",
  "isType",
];
export const writeCapabilities = ["create", "put", "patch", "delete", "import", "push"];
export function capabilities(value) {
  record(value, ["core", "scope", "packs"], ["core", "scope"]);
  record(
    value.core,
    [
      "get",
      "list",
      "pull",
      "create",
      "put",
      "patch",
      "delete",
      "revisions",
      "export",
      "import",
      "push",
    ],
    ["get"],
  );
  record(value.core.get, ["selector"], ["selector"]);
  boolean(value.core.get.selector);
  const specs = {
    list: [
      ["conditions", "selector", "sort", "maxLimit"],
      ["conditions", "selector", "sort"],
    ],
    pull: [
      ["sse", "jsonl", "filter", "selector"],
      ["sse", "jsonl", "filter", "selector"],
    ],
    export: [["revisions"], ["revisions"]],
    revisions: [[], []],
    create: [
      ["serverAllocatesId", "clientProposedId"],
      ["serverAllocatesId", "clientProposedId"],
    ],
    put: [[], []],
    patch: [["ifMatch"], ["ifMatch"]],
    delete: [["ifMatch"], ["ifMatch"]],
    import: [["historyRestore"], ["historyRestore"]],
    push: [["maxBatch", "window"], []],
  };
  for (const [name, [keys, required]] of Object.entries(specs))
    if (value.core[name] !== undefined) {
      const c = value.core[name];
      record(c, keys, required);
      for (const k of [
        "selector",
        "sort",
        "sse",
        "jsonl",
        "filter",
        "revisions",
        "ifMatch",
        "historyRestore",
        "serverAllocatesId",
        "clientProposedId",
      ])
        if (c[k] !== undefined) boolean(c[k]);
      for (const k of ["maxLimit", "maxBatch", "window"])
        if (c[k] !== undefined) {
          integer(c[k]);
          requireThat(c[k] > 0, "Capability bound must be positive");
        }
      if (name === "list")
        requireThat(
          Array.isArray(c.conditions) &&
            new Set(c.conditions).size === c.conditions.length &&
            c.conditions.every((k) => conditionKinds.includes(k)),
          "Invalid list condition advertisement",
        );
    }
  record(
    value.scope,
    ["storageClasses", "revisionModel", "idModel"],
    ["storageClasses", "revisionModel"],
  );
  requireThat(
    ["versioned", "unversioned"].includes(value.scope.revisionModel),
    "Invalid scope revision model",
  );
  if (value.scope.idModel !== undefined) {
    requireThat(
      ["permanent", "reusable"].includes(value.scope.idModel),
      "Invalid scope id model",
    );
    // core.lumen ScopeCapabilities#1: versioned+reusable is forbidden (versioned ⇒ permanent).
    requireThat(
      !(value.scope.revisionModel === "versioned" && value.scope.idModel === "reusable"),
      "versioned+reusable is a forbidden scope-trait combination",
    );
    requireThat(
      !(value.scope.idModel === "reusable" && value.scope.revisionModel === "versioned"),
      "reusable requires unversioned",
    );
  }
  requireThat(
    Array.isArray(value.scope.storageClasses),
    "Scope persistence classes must be an array",
  );
  const kinds = value.scope.storageClasses.map((v) => {
    record(v, ["kind"], ["kind"]);
    requireThat(
      ["durable", "ephemeral"].includes(v.kind),
      "Intrinsic is universal and must not be advertised as a persistence class",
    );
    return v.kind;
  });
  requireThat(new Set(kinds).size === kinds.length, "Duplicate persistence class");
  if (value.packs !== undefined) requireThat(object(value.packs), "Packs must be a record");
  return value;
}
export function page(value) {
  record(value, ["items", "cursor", "head"], ["items"]);
  requireThat(Array.isArray(value.items), "Page items must be an array");
  if (value.head !== undefined) boolean(value.head);
  if (value.cursor !== undefined && value.cursor !== null) string(value.cursor);
  requireThat(
    value.head === true || typeof value.cursor === "string",
    "Nonterminal Page needs a continuation cursor",
  );
}
export function problem(value, status) {
  record(
    value,
    ["type", "title", "status", "code", "retry", "detail", "instance"],
    ["type", "title", "status", "code", "retry"],
  );
  uri(value.type);
  string(value.title);
  integer(value.status);
  requireThat(value.status === status, "Problem status differs from HTTP status");
  string(value.code);
  requireThat(
    ["never", "after-state-change", "after-delay"].includes(value.retry),
    "Invalid Problem retry disposition",
  );
  if (value.detail !== undefined) string(value.detail);
  if (value.instance !== undefined) uri(value.instance);
}
export function reply(value, status = 200) {
  record(
    value,
    ["outcome", "cause", "callId", "transaction", "metadata"],
    ["outcome", "cause", "callId"],
  );
  string(value.cause);
  string(value.callId);
  requireThat(
    object(value.outcome) && typeof value.outcome.kind === "string",
    "Outcome must be internally tagged",
  );
  // Outcome arms are open records; unknown non-domain fates must remain readable.
  if (value.outcome.kind === "success")
    requireThat(status === 200 && Object.hasOwn(value.outcome, "value"), "Invalid success outcome");
  if (value.outcome.kind === "failure")
    requireThat(
      status === 409 && Object.hasOwn(value.outcome, "error"),
      "Invalid domain failure outcome",
    );
  if (value.outcome.kind === "fault") problem(value.outcome.problem, status);
  if (value.transaction !== undefined) string(value.transaction);
  if (value.metadata !== undefined)
    requireThat(object(value.metadata), "Reply metadata must be a record");
}
export function descriptor(value) {
  // A package's assets may be arbitrary resources. Validate only declared descriptor bodies.
  const kind = value.type.split("/").at(-1),
    body = value.body;
  if (kind === "package-def") {
    record(body, ["semVer", "elements"], ["semVer", "elements"]);
    string(body.semVer);
    requireThat(object(body.elements), "Package elements must be a map");
    for (const element of Object.values(body.elements)) {
      resource(element);
      descriptor(element);
    }
  }
  if (kind === "type-def") {
    record(body, ["refines", "abstract", "properties"], ["properties"]);
    if (body.refines !== undefined) {
      record(body.refines, ["authority", "path"], ["path"]);
      string(body.refines.path);
      if (body.refines.authority !== undefined) reference(body.refines.authority);
    }
    if (body.abstract !== undefined) boolean(body.abstract);
    requireThat(Array.isArray(body.properties), "Type properties must be declarations");
    for (const p of body.properties) {
      record(
        p,
        ["name", "type", "computed", "initOnly", "serviceManaged", "readOnly"],
        ["name", "type"],
      );
      string(p.name);
      beadSchema(p.type);
      const modes = ["computed", "initOnly", "serviceManaged", "readOnly"].filter(
        (k) => p[k] !== undefined,
      );
      modes.forEach((k) => {
        boolean(p[k]);
      });
      requireThat(modes.filter((k) => p[k]).length <= 1, "Contradictory property access modes");
    }
  }
  if (kind === "operation") {
    record(
      body,
      ["signature", "implementation", "pure", "safe", "idempotent", "atomic"],
      ["signature"],
    );
    for (const k of ["pure", "safe", "idempotent", "atomic"])
      if (body[k] !== undefined) boolean(body[k]);
    requireThat(!(body.pure === true && body.safe === false), "Contradictory pure/safe guarantees");
    record(body.signature, ["parameters", "success", "failure", "async", "creates"]);
    if (body.signature.async !== undefined)
      requireThat(
        ["no", "optional", "required"].includes(body.signature.async),
        "Invalid async disposition",
      );
    for (const key of ["success", "failure"])
      if (body.signature[key] !== undefined) beadSchema(body.signature[key]);
    if (body.signature.creates !== undefined) boolean(body.signature.creates);
    if (body.signature.parameters !== undefined) {
      requireThat(Array.isArray(body.signature.parameters), "Parameters must be declarations");
      for (const p of body.signature.parameters) {
        record(p, ["name", "type", "required"], ["name", "type"]);
        string(p.name);
        if (p.required !== undefined) boolean(p.required);
        beadSchema(p.type);
      }
      requireThat(
        new Set(body.signature.parameters.map((p) => p.name)).size ===
          body.signature.parameters.length,
        "Duplicate parameter declaration",
      );
    }
  }
  if (kind === "channel") {
    record(
      body,
      ["pushSchema", "pullSchema", "direction", "retention", "cardinality"],
      ["direction", "retention", "cardinality"],
    );
    requireThat(["source", "sink", "duplex"].includes(body.direction), "Invalid channel direction");
    requireThat(["single", "broadcast"].includes(body.cardinality), "Invalid channel cardinality");
    const push = body.pushSchema != null,
      pull = body.pullSchema != null;
    if (push) beadSchema(body.pushSchema);
    if (pull) beadSchema(body.pullSchema);
    requireThat(
      body.direction === "source"
        ? pull && !push
        : body.direction === "sink"
          ? push && !pull
          : push && pull,
      "Channel schemas disagree with its direction",
    );
    const retention = (r) => {
      requireThat(object(r), "Retention must be tagged");
      if (r.kind === "forever") record(r, ["kind"], ["kind"]);
      else if (r.kind === "window") {
        record(r, ["kind", "by", "amount"], ["kind", "by", "amount"]);
        requireThat(["time", "count", "size"].includes(r.by), "Invalid retention unit");
        integer(r.amount);
      } else if (r.kind === "compacted") {
        record(r, ["kind", "window"], ["kind"]);
        if (r.window !== undefined) retention(r.window);
      } else requireThat(false, "Invalid retention arm");
    };
    retention(body.retention);
  }
}
export function serviceDescriptor(value, { linkHeader } = {}) {
  // The GET / discovery signpost (core.lumen ServiceDescriptor / ServiceLinks): a thin
  // envelope naming the protocol and linking to the floor paths, never the resource set.
  record(value, ["version", "revision", "scope", "base", "links"], ["version", "links"]);
  string(value.version);
  requireThat(/^\d+\.\d+\.\d+/.test(value.version), "ServiceDescriptor version is not a SemVer");
  if (value.revision !== undefined) string(value.revision);
  if (value.base !== undefined) uri(value.base);
  requireThat(object(value.links), "ServiceDescriptor must carry a ServiceLinks set");
  record(value.links, ["serviceDesc", "serviceMeta", "serviceDoc", "changes"], []);
  for (const k of ["serviceDesc", "serviceMeta", "serviceDoc", "changes"])
    if (value.links[k] !== undefined) uri(value.links[k]);
  // When advertised, the RFC 8631 floor relations resolve to their fixed well-known paths.
  if (value.links.serviceMeta !== undefined)
    requireThat(
      new URL(value.links.serviceMeta).pathname.endsWith("/sys/capabilities"),
      "service-meta must point at /sys/capabilities",
    );
  if (value.links.serviceDesc !== undefined)
    requireThat(
      new URL(value.links.serviceDesc).pathname.endsWith("/bdp/openapi"),
      "service-desc must point at /bdp/openapi",
    );
  // The Link header (RFC 8288) is an OPTIONAL mirror of links; the body stays authoritative.
  if (linkHeader !== undefined)
    requireThat(typeof linkHeader === "string", "Link header must be a string when present");
  return value;
}
export function changeEvent(value, revisionModel) {
  requireThat(
    object(value) && typeof value.kind === "string",
    "ChangeEvent must be internally tagged",
  );
  const common = [
    "kind",
    "ordinal",
    "at",
    "transaction",
    "cause",
    "causedBy",
    "callId",
    "calledBy",
  ];
  integer(value.ordinal);
  requireThat(value.ordinal >= 0, "Negative event ordinal");
  timestamp(value.at);
  string(value.transaction);
  for (const k of ["cause", "causedBy", "callId", "calledBy"])
    if (value[k] !== undefined) string(value[k]);
  if (["created", "updated", "deleted"].includes(value.kind)) {
    record(
      value,
      [
        ...common,
        "subject",
        "subjectType",
        "subjectAuthority",
        "representation",
        "content",
        "provenance",
      ],
      [...["kind", "ordinal", "at", "transaction"], "subject"],
    );
    reference(value.subject);
    if (revisionModel === "versioned") string(value.subject.rev);
    if (value.kind === "created") resource(value.representation, { revisionModel });
    if (value.kind === "updated") {
      requireThat(object(value.content), "Missing update encoding");
      if (value.content.kind === "full") resource(value.content.representation, { revisionModel });
      else if (value.content.kind === "patch") {
        requireThat(Array.isArray(value.content.patch), "Patch encoding lacks a patch");
        provenance(value.content.provenance);
      } else requireThat(false, "Unrecognized update encoding");
    }
    if (value.kind === "deleted") provenance(value.provenance);
  } else if (value.kind === "call-enter") {
    record(value, [...common, "operation"], ["kind", "ordinal", "at", "transaction", "operation"]);
    reference(value.operation);
  } else if (value.kind === "call-leave") {
    record(value, [...common, "outcome"], ["kind", "ordinal", "at", "transaction", "outcome"]);
    requireThat(
      object(value.outcome) && typeof value.outcome.kind === "string",
      "Invalid call-leave outcome",
    );
  } else requireThat(false, "Unknown closed ChangeEvent arm");
}
