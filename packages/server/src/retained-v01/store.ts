import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  statfsSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  decodeJsonDocument,
  parseRevisionProvenanceInput,
  type RevisionProvenanceInput,
} from "@bdp/protocol";
import { isKnownNetworkFilesystem } from "../recovery-store.js";
import { jsonValueEqual } from "../json-value-equality.js";
import {
  assertPreparedCreate,
  assertPreparedUpdate,
  assertPreparedDelete,
  captureNavigation,
  canonicalLocalReference,
  deletedIdentity,
  materializeBead,
  problem,
  RETAINED_MEDIA,
  RETAINED_SPEC,
  RetainedRequestError,
  serialized,
  type PreparedCreate,
  type PreparedUpdate,
  type PreparedDelete,
  type JsonObject,
  type PrivateNavigation,
  type RetainedBead,
  type RetainedLink,
  type ResourceKind,
  type ResourceState,
  type EndpointReference,
  type TypeReference,
  type OrdinaryOperation,
  referenceUri,
  navigationAddresses,
} from "./contract.js";
import { lifecycleFact, incidentBeads, EVENT_POLICY, type EventSelection } from "./events.js";
import {
  applyObjectChange,
  exceedsEditLimits,
  ObjectEditFailure,
  type ObjectChange,
} from "./object-edits.js";
import { assertPreparedLink, type LinkOperation, type PreparedLink } from "./link-contract.js";
import { readAliasWitnesses, verifyResourceRecovery } from "./recovery.js";
import {
  assertPreparedAlias,
  captureAliasNamespace,
  type AliasOperation,
  type PreparedAlias,
} from "./alias-contract.js";
import { compareCapturedReferences, type ReferenceComparison } from "./reference-comparison.js";

export const PRIVATE_STORE_FORMAT = "bdp-private-retained-v01-5";
export interface PrivateStoreOptions {
  readonly directory: string;
  readonly create: boolean;
  readonly instance: string;
  readonly navigation: PrivateNavigation;
  readonly clock?: () => number;
  /** Fault timing only, private to the test process. No successful outcome injection. */
  readonly onPhase?: (phase: "resource-staged" | "alias-staged" | "committed") => void;
}
export interface StoredResponse {
  readonly status: number;
  readonly text: string;
}
interface EditFields {
  readonly type?: TypeReference;
  readonly properties?: JsonObject;
  readonly metadata?: JsonObject;
  readonly propertiesChange?: ObjectChange;
  readonly metadataChange?: ObjectChange;
  readonly expectedRevision?: string;
  readonly provenance?: RevisionProvenanceInput;
  readonly source?: EndpointReference;
  readonly target?: EndpointReference;
}
interface CreateFields extends EditFields {
  readonly id?: string;
  readonly type: TypeReference;
  readonly properties: JsonObject;
  readonly metadata: JsonObject;
  readonly refusal?: JsonObject;
}
const schema = `
CREATE TABLE metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE identities(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('bead','link'))) STRICT;
CREATE TABLE resources(id TEXT PRIMARY KEY REFERENCES identities(id),body TEXT NOT NULL CHECK(retained_json(body))) STRICT;
CREATE TABLE aliases(locator TEXT PRIMARY KEY,target TEXT NOT NULL REFERENCES identities(id)) STRICT;
CREATE TABLE events(position INTEGER PRIMARY KEY,subject TEXT NOT NULL REFERENCES identities(id),body TEXT NOT NULL CHECK(retained_json(body))) STRICT;
CREATE TABLE incidence(position INTEGER NOT NULL REFERENCES events(position),bead TEXT NOT NULL REFERENCES identities(id),PRIMARY KEY(position,bead)) STRICT;
CREATE TABLE outcomes(decision INTEGER PRIMARY KEY CHECK(decision>0),principal TEXT NOT NULL,key TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('createBead','updateBead','deleteBead','createLink','updateLink','deleteLink','putAlias','deleteAlias')),identity TEXT NOT NULL,witnesses TEXT NOT NULL CHECK(retained_json(witnesses)),status INTEGER NOT NULL,body TEXT NOT NULL CHECK(retained_json(body)),event_position INTEGER UNIQUE REFERENCES events(position),UNIQUE(principal,key)) STRICT;
CREATE TABLE boundaries(position INTEGER PRIMARY KEY,token TEXT NOT NULL UNIQUE) STRICT;
CREATE TABLE cursors(token TEXT PRIMARY KEY,principal TEXT NOT NULL,source TEXT NOT NULL,subject TEXT NOT NULL,after_position INTEGER NOT NULL,through_position INTEGER NOT NULL,page_limit INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('next','resume')),expires INTEGER NOT NULL) STRICT;
`;
export function openPrivateRetainedStore(options: PrivateStoreOptions) {
  if (process.version !== "v24.22.1")
    throw new Error("private retained store requires Node v24.22.1");
  const navigation = captureNavigation(options.navigation);
  const aliasNamespace = captureAliasNamespace(navigation.scope, navigation.aliases);
  const reserved = navigationAddresses(navigation);
  const clock = options.clock ?? Date.now;
  if (
    !path.isAbsolute(options.directory) ||
    !options.instance ||
    typeof options.create !== "boolean"
  )
    throw new TypeError("explicit absolute directory, instance and provisioning choice required");
  if (options.create) {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    if (readdirSync(options.directory).length)
      throw new Error("new provisioning requires an empty directory and new logical Scope");
  }
  if (
    lstatSync(options.directory).isSymbolicLink() ||
    isKnownNetworkFilesystem(process.platform, statfsSync(options.directory).type)
  )
    throw new Error("unsupported store directory");
  const filename = path.join(options.directory, "retained-reference.sqlite");
  if (!options.create && (!existsSync(filename) || lstatSync(filename).isSymbolicLink()))
    throw new Error("missing or unsupported retained store; refusing reseed");
  const allowedFiles = new Set(["retained-reference.sqlite", "retained-reference.sqlite-journal"]);
  if (readdirSync(options.directory).some((name) => !allowedFiles.has(name)))
    throw new Error("mixed store directory");
  if (options.create) closeSync(openSync(filename, "wx", 0o600));
  const db = new DatabaseSync(filename, {
    timeout: 0,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  let closed = false;
  let fenced = false;
  let active = false;
  const run = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args);
  const get = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args);
  const now = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)
      throw new Error("invalid owner clock");
    return value;
  };
  function transaction<T>(callback: () => T): T {
    if (closed || fenced || active) throw new Error("store closed, fenced or nested");
    active = true;
    let committing = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = callback();
      committing = true;
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        if (db.isTransaction) db.exec("ROLLBACK");
      } catch {
        fenced = true;
      }
      if (
        committing ||
        db.isTransaction ||
        (error instanceof Error && "code" in error && !(error instanceof RetainedRequestError))
      )
        fenced = true;
      throw error;
    } finally {
      active = false;
    }
  }
  const capture = serialized({
    format: PRIVATE_STORE_FORMAT,
    specification: RETAINED_SPEC,
    media: RETAINED_MEDIA,
    instance: options.instance,
    navigation,
    policy: EVENT_POLICY,
  });
  try {
    db.function("retained_json", { deterministic: true }, (value) => {
      if (typeof value !== "string") return 0;
      try {
        decodeJsonDocument(value);
        return 1;
      } catch {
        return 0;
      }
    });
    if (
      get("PRAGMA journal_mode=DELETE")?.journal_mode !== "delete" ||
      get("PRAGMA locking_mode=EXCLUSIVE")?.locking_mode !== "exclusive"
    )
      throw new Error("durability modes unavailable");
    db.exec("PRAGMA synchronous=EXTRA");
    if (get("PRAGMA synchronous")?.synchronous !== 3)
      throw new Error("durability mode unavailable");
    transaction(() => {
      if (options.create) {
        db.exec(schema);
        run("INSERT INTO metadata VALUES ('capture',?)", capture);
        run("INSERT INTO metadata VALUES ('decisions','0')");
        run("INSERT INTO boundaries VALUES (0,?)", randomUUID());
      }
      const expected = [
        "aliases",
        "boundaries",
        "cursors",
        "events",
        "identities",
        "incidence",
        "metadata",
        "outcomes",
        "resources",
      ];
      const tables = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all()
        .map((row) => row.name);
      if (
        serialized(tables) !== serialized(expected) ||
        get("SELECT value FROM metadata WHERE name='capture'")?.value !== capture
      )
        throw new Error("store format, Scope, instance or captured configuration mismatch");
      if (
        get("PRAGMA quick_check")?.quick_check !== "ok" ||
        db.prepare("PRAGMA foreign_key_check").all().length ||
        !get("SELECT token FROM boundaries WHERE position=0")
      )
        throw new Error("retained store integrity failure");
      verifyResourceRecovery(db, navigation);
      run("UPDATE metadata SET value=value WHERE name='capture'");
    });
  } catch (error) {
    db.close();
    closed = true;
    throw error;
  }
  const head = () =>
    Number(get("SELECT COALESCE(MAX(position),0) AS position FROM events")?.position);
  const boundary = (position: number) => {
    const token = get("SELECT token FROM boundaries WHERE position=?", position)?.token;
    if (typeof token !== "string") throw new Error("missing coverage boundary");
    return token;
  };
  const saveCursor = (
    principal: string,
    source: string,
    subject: string,
    after: number,
    through: number,
    limit: number,
    mode: "next" | "resume",
  ) => {
    const token = randomUUID();
    run(
      "INSERT INTO cursors VALUES (?,?,?,?,?,?,?,?,?)",
      token,
      principal,
      source,
      subject,
      after,
      through,
      limit,
      mode,
      now() + EVENT_POLICY.minimumCursorLifetimeSeconds * 1000,
    );
    return token;
  };
  function aliasLookup(uri: string): string | null | undefined {
    if (get("SELECT id FROM identities WHERE id=?", uri) || reserved.includes(uri))
      return undefined;
    const alias = get("SELECT target FROM aliases WHERE locator=?", uri);
    if (alias) return String(alias.target);
    return aliasNamespace.contains(uri) ? null : undefined;
  }
  function decide(
    principal: string,
    operation: OrdinaryOperation,
    input: { readonly key: string; readonly identity: string },
    execute: (comparison: ReferenceComparison) => StoredResponse & { readonly position?: number },
  ): StoredResponse {
    if (!principal) throw new TypeError("stable authenticated principal required");
    let fresh = false;
    const result = transaction(() => {
      const previous = get(
        "SELECT operation,identity,witnesses,status,body FROM outcomes WHERE principal=? AND key=?",
        principal,
        input.key,
      );
      if (previous && previous.operation !== operation)
        return { status: 409, text: serialized(problem("idempotency-conflict", 409)) };
      const comparison = compareCapturedReferences(
        input,
        aliasLookup,
        previous ? readAliasWitnesses(previous.witnesses, navigation) : undefined,
      );
      if (previous) {
        if (previous.identity !== comparison.identity)
          return { status: 409, text: serialized(problem("idempotency-conflict", 409)) };
        if (typeof previous.body !== "string" || typeof previous.status !== "number")
          throw new Error("retained outcome missing");
        return { status: previous.status, text: previous.body };
      }
      const outcome = execute(comparison);
      const count = Number(get("SELECT value FROM metadata WHERE name='decisions'")?.value);
      if (!Number.isSafeInteger(count + 1)) throw new Error("outcome capacity unavailable");
      run(
        "INSERT INTO outcomes VALUES (?,?,?,?,?,?,?,?,?)",
        count + 1,
        principal,
        input.key,
        operation,
        comparison.identity,
        serialized(comparison.originalWitnesses),
        outcome.status,
        outcome.text,
        outcome.position ?? null,
      );
      run("UPDATE metadata SET value=? WHERE name='decisions'", String(count + 1));
      fresh = true;
      return { status: outcome.status, text: outcome.text };
    });
    if (fresh) options.onPhase?.("committed");
    return result;
  }
  const refusal = (value: JsonObject): StoredResponse => ({
    status: Number(value.status),
    text: serialized(value),
  });
  const currentRow = (id: string) =>
    get(
      "SELECT r.body,i.kind FROM resources AS r JOIN identities AS i ON i.id=r.id WHERE r.id=?",
      id,
    );
  function currentState(id: string, kind?: ResourceKind): ResourceState | undefined {
    const row = currentRow(id);
    if (!row || (kind !== undefined && row.kind !== kind)) return undefined;
    const resource = JSON.parse(String(row.body));
    if (row.kind === "bead") return { kind: "bead", resource: resource as RetainedBead };
    if (row.kind === "link") return { kind: "link", resource: resource as RetainedLink };
    throw new Error("unknown stored Resource kind");
  }
  function endpointRefusal(state: ResourceState): JsonObject | undefined {
    if (state.kind !== "link") return undefined;
    let local = false;
    for (const name of ["source", "target"] as const) {
      const uri = referenceUri(state.resource[name]);
      if (!uri.startsWith(navigation.scope)) continue;
      local = true;
      const endpoint = currentState(uri);
      if (!endpoint) return problem("resource-not-found", 404, "after-state-change");
      if (endpoint.kind !== "bead")
        return {
          ...problem("validation-failed", 422),
          diagnostics: [{ message: `${name} endpoint must identify a live in-Scope Bead` }],
        };
    }
    return local
      ? undefined
      : {
          ...problem("validation-failed", 422),
          diagnostics: [{ message: "a Link requires at least one in-Scope Bead endpoint" }],
        };
  }
  function resourceState(
    kind: ResourceKind,
    resource: RetainedBead,
    fields: EditFields,
  ): ResourceState {
    if (kind === "bead") return { kind, resource };
    if (fields.source === undefined || fields.target === undefined)
      throw new Error("prepared Link has incomplete endpoints");
    return { kind, resource: { ...resource, source: fields.source, target: fields.target } };
  }
  function complete(
    verb: "create" | "update" | "delete",
    state: ResourceState,
    before: ResourceState | undefined,
    time: string,
    text: string,
  ): StoredResponse & { readonly position?: number } {
    const position = head() + 1;
    if (!Number.isSafeInteger(position)) throw new Error("event ordering capacity unavailable");
    const fact = serialized(
      lifecycleFact(
        verb,
        state,
        navigation.events,
        randomUUID(),
        randomUUID(),
        time,
        before?.resource.revision,
      ),
    );
    if (Buffer.byteLength(text) > 262144 || Buffer.byteLength(fact) > 300000)
      return refusal(problem("limit-exceeded", 413));
    const id = state.resource.id;
    if (verb === "create") {
      run("INSERT INTO identities VALUES (?,?)", id, state.kind);
      run("INSERT INTO resources VALUES (?,?)", id, serialized(state.resource));
    } else if (verb === "update") {
      run("UPDATE resources SET body=? WHERE id=?", serialized(state.resource), id);
    } else run("DELETE FROM resources WHERE id=?", id);
    options.onPhase?.("resource-staged");
    run("INSERT INTO events VALUES (?,?,?)", position, id, fact);
    for (const bead of incidentBeads(
      navigation.scope,
      before,
      verb === "delete" ? undefined : state,
    ))
      run("INSERT INTO incidence VALUES (?,?)", position, bead);
    run("INSERT INTO boundaries VALUES (?,?)", position, randomUUID());
    return { status: 200, text, position };
  }
  function performCreate(kind: ResourceKind, input: CreateFields) {
    if (input.refusal) return refusal(input.refusal);
    let id = input.id ?? navigation.scope + randomUUID();
    if (input.id === undefined) {
      let collisions = 0;
      while (
        get("SELECT id FROM identities WHERE id=?", id) ||
        get("SELECT locator FROM aliases WHERE locator=?", id) ||
        reserved.includes(id)
      ) {
        if (++collisions > 32)
          throw new RetainedRequestError("temporarily-unavailable", 503, "after-delay");
        id = navigation.scope + randomUUID();
      }
    }
    if (get("SELECT id FROM identities WHERE id=?", id) || reserved.includes(id))
      return refusal(problem("identity-taken", 409));
    if (get("SELECT locator FROM aliases WHERE locator=?", id))
      return refusal(problem("alias-path-taken", 409, "after-state-change"));
    const time = new Date(now()).toISOString();
    const state = resourceState(kind, materializeBead(input, id, randomUUID(), time), input);
    const invalid = endpointRefusal(state);
    if (invalid) return refusal(invalid);
    return complete(
      "create",
      state,
      undefined,
      time,
      serialized({ outcome: "created", changed: true, resource: state.resource }),
    );
  }
  function performUpdate(
    kind: ResourceKind,
    id: string,
    input: EditFields & { readonly refusal?: JsonObject },
  ) {
    if (input.refusal) return refusal(input.refusal);
    const before = currentState(id, kind);
    if (!before) return refusal(problem("resource-not-found", 404, "after-state-change"));
    if (input.expectedRevision !== undefined && input.expectedRevision !== before.resource.revision)
      return refusal(problem("revision-mismatch", 409, "after-state-change"));
    if (exceedsEditLimits([input.propertiesChange ?? [], input.metadataChange ?? []]))
      return refusal(problem("limit-exceeded", 413));
    let document: "properties" | "metadata" = "properties";
    let properties: JsonObject;
    let metadata: JsonObject;
    try {
      properties =
        input.properties ??
        (input.propertiesChange === undefined
          ? before.resource.properties
          : applyObjectChange(before.resource.properties, input.propertiesChange));
      document = "metadata";
      metadata =
        input.metadata ??
        (input.metadataChange === undefined
          ? before.resource.metadata
          : applyObjectChange(before.resource.metadata, input.metadataChange));
    } catch (error) {
      if (!(error instanceof ObjectEditFailure)) throw error;
      return refusal({
        ...problem("validation-failed", 422),
        diagnostics: [
          {
            ...(document === "metadata" ? { document } : {}),
            instanceLocation: error.pointer,
            message: `${document}: ${error.message}`,
          },
        ],
      });
    }
    const type = input.type ?? before.resource.type;
    const endpoints: EditFields =
      before.kind === "link"
        ? {
            source: input.source ?? before.resource.source,
            target: input.target ?? before.resource.target,
          }
        : {};
    const candidate = resourceState(
      kind,
      { ...before.resource, type, properties, metadata },
      endpoints,
    );
    const invalid = endpointRefusal(candidate);
    if (invalid) return refusal(invalid);
    const changed =
      !jsonValueEqual(type, before.resource.type) ||
      !jsonValueEqual(properties, before.resource.properties) ||
      !jsonValueEqual(metadata, before.resource.metadata) ||
      (candidate.kind === "link" &&
        before.kind === "link" &&
        (!jsonValueEqual(candidate.resource.source, before.resource.source) ||
          !jsonValueEqual(candidate.resource.target, before.resource.target)));
    if (!changed)
      return {
        status: 200,
        text: serialized({ outcome: "updated", changed: false, resource: before.resource }),
      };
    const time = new Date(now()).toISOString();
    const state = resourceState(
      kind,
      materializeBead(
        {
          type,
          properties,
          metadata,
          ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
        },
        id,
        randomUUID(),
        time,
      ),
      endpoints,
    );
    return complete(
      "update",
      state,
      before,
      time,
      serialized({ outcome: "updated", changed: true, resource: state.resource }),
    );
  }
  function performDelete(kind: ResourceKind, id: string, input: EditFields) {
    const before = currentState(id, kind);
    if (!before) return refusal(problem("resource-not-found", 404, "after-state-change"));
    if (input.expectedRevision !== undefined && input.expectedRevision !== before.resource.revision)
      return refusal(problem("revision-mismatch", 409, "after-state-change"));
    if (kind === "bead") {
      for (const row of db
        .prepare(
          "SELECT r.body FROM resources AS r JOIN identities AS i ON i.id=r.id WHERE i.kind='link'",
        )
        .iterate()) {
        const link = JSON.parse(String(row.body)) as RetainedLink;
        if ([link.source, link.target].some((reference) => referenceUri(reference) === id))
          return refusal(problem("incident-links-exist", 409, "after-state-change"));
      }
    }
    return complete(
      "delete",
      before,
      before,
      new Date(now()).toISOString(),
      serialized({ outcome: "deleted", changed: true, deleted: deletedIdentity(before) }),
    );
  }
  function linkFields(input: PreparedLink): EditFields {
    const value = input.value;
    return {
      ...(value.type === undefined ? {} : { type: value.type as TypeReference }),
      ...(value.properties === undefined ? {} : { properties: value.properties as JsonObject }),
      ...(value.metadata === undefined ? {} : { metadata: value.metadata as JsonObject }),
      ...(value.propertiesChange === undefined
        ? {}
        : { propertiesChange: value.propertiesChange as unknown as ObjectChange }),
      ...(value.metadataChange === undefined
        ? {}
        : { metadataChange: value.metadataChange as unknown as ObjectChange }),
      ...(value.source === undefined ? {} : { source: value.source as EndpointReference }),
      ...(value.target === undefined ? {} : { target: value.target as EndpointReference }),
      ...(value.expectedRevision === undefined
        ? {}
        : { expectedRevision: value.expectedRevision as string }),
      ...(value.revisionProvenance === undefined
        ? {}
        : { provenance: parseRevisionProvenanceInput(value.revisionProvenance) }),
    };
  }
  function applyLink(principal: string, input: PreparedLink, operation: LinkOperation) {
    assertPreparedLink(navigation.scope, operation, input);
    return decide(principal, operation, input, (comparison) => {
      if (input.refusal) return refusal(input.refusal);
      let fields = linkFields(input);
      for (const name of ["source", "target"] as const) {
        const reference = comparison.references[name];
        if (reference?.kind === "missing-alias")
          return refusal(problem("resource-not-found", 404, "after-state-change"));
        if (reference?.kind === "value") fields = { ...fields, [name]: reference.reference };
      }
      if (operation === "createLink")
        return performCreate("link", {
          ...fields,
          type: input.value.type as TypeReference,
          properties: input.value.properties as JsonObject,
          metadata: input.value.metadata as JsonObject,
          ...(input.value.id === undefined ? {} : { id: input.value.id as string }),
        });
      return operation === "updateLink"
        ? performUpdate("link", input.value.link as string, fields)
        : performDelete("link", input.value.link as string, fields);
    });
  }
  function applyAlias(
    principal: string,
    input: PreparedAlias,
    operation: AliasOperation,
  ): StoredResponse {
    assertPreparedAlias(navigation.scope, operation, input);
    return decide(principal, operation, input, () => {
      if (!aliasNamespace.contains(input.alias))
        return refusal(problem("resource-not-found", 404, "after-state-change"));
      if (
        operation === "putAlias" &&
        (get("SELECT id FROM identities WHERE id=?", input.alias) || reserved.includes(input.alias))
      )
        return refusal(problem("identity-taken", 409));
      const previous = get("SELECT target FROM aliases WHERE locator=?", input.alias);
      if (operation === "deleteAlias") {
        if (!previous) return refusal(problem("resource-not-found", 404, "after-state-change"));
        const text = serialized({ outcome: "deleted", alias: input.alias });
        if (Buffer.byteLength(text) > 262144) return refusal(problem("limit-exceeded", 413));
        run("DELETE FROM aliases WHERE locator=?", input.alias);
        options.onPhase?.("alias-staged");
        return { status: 200, text };
      }
      if (input.operation !== "putAlias") throw new Error("prepared alias operation mismatch");
      const target = input.target;
      const invalid = () =>
        refusal({
          ...problem("validation-failed", 422),
          diagnostics: [{ message: "alias target must be a canonical in-Scope Bead URL" }],
        });
      if (
        !target.startsWith(navigation.scope) ||
        get("SELECT locator FROM aliases WHERE locator=?", target)
      )
        return invalid();
      const identity = get("SELECT kind FROM identities WHERE id=?", target);
      if (identity && identity.kind !== "bead") return invalid();
      if (!currentState(target, "bead"))
        return refusal(problem("resource-not-found", 404, "after-state-change"));
      const text = serialized({
        outcome: previous ? "updated" : "created",
        alias: input.alias,
        target,
      });
      if (Buffer.byteLength(text) > 262144) return refusal(problem("limit-exceeded", 413));
      run(
        "INSERT INTO aliases VALUES (?,?) ON CONFLICT(locator) DO UPDATE SET target=excluded.target",
        input.alias,
        target,
      );
      options.onPhase?.("alias-staged");
      return { status: 200, text };
    });
  }
  return {
    /** Local factory metadata only. Never serialized into discovery. */
    claimEligible: false as const,
    navigation,
    create(principal: string, input: PreparedCreate): StoredResponse {
      assertPreparedCreate(navigation.scope, input);
      return decide(principal, "createBead", input, () => performCreate("bead", input));
    },
    update(principal: string, input: PreparedUpdate): StoredResponse {
      assertPreparedUpdate(navigation.scope, input);
      return decide(principal, "updateBead", input, (comparison) => {
        if (input.refusal) return refusal(input.refusal);
        const reference = comparison.references.bead;
        if (reference?.kind === "value" && typeof reference.reference !== "string")
          throw new Error("prepared Bead subject unexpectedly pinned");
        return reference?.kind === "missing-alias"
          ? refusal(problem("resource-not-found", 404, "after-state-change"))
          : performUpdate(
              "bead",
              reference?.kind === "value" ? (reference.reference as string) : input.bead,
              input,
            );
      });
    },
    deleteBead(principal: string, input: PreparedDelete): StoredResponse {
      assertPreparedDelete(navigation.scope, input);
      return decide(principal, "deleteBead", input, (comparison) => {
        const reference = comparison.references.bead;
        if (reference?.kind === "value" && typeof reference.reference !== "string")
          throw new Error("prepared Bead subject unexpectedly pinned");
        return reference?.kind === "missing-alias"
          ? refusal(problem("resource-not-found", 404, "after-state-change"))
          : performDelete(
              "bead",
              reference?.kind === "value" ? (reference.reference as string) : input.bead,
              input,
            );
      });
    },
    createLink(principal: string, input: PreparedLink): StoredResponse {
      return applyLink(principal, input, "createLink");
    },
    updateLink(principal: string, input: PreparedLink): StoredResponse {
      return applyLink(principal, input, "updateLink");
    },
    deleteLink(principal: string, input: PreparedLink): StoredResponse {
      return applyLink(principal, input, "deleteLink");
    },
    putAlias(principal: string, input: PreparedAlias): StoredResponse {
      return applyAlias(principal, input, "putAlias");
    },
    deleteAlias(principal: string, input: PreparedAlias): StoredResponse {
      return applyAlias(principal, input, "deleteAlias");
    },
    /** Namespace classification only, never a target Resource-body/liveness read. */
    resolveAlias(id: string): string | null | undefined {
      return transaction(() => {
        let locator: string;
        try {
          locator = canonicalLocalReference(navigation.scope, id);
        } catch {
          return undefined;
        }
        return aliasLookup(locator);
      });
    },
    readRecord(id: string): { readonly kind: ResourceKind; readonly body: string } | undefined {
      return transaction(() => {
        const row = currentRow(id);
        if (!row) return undefined;
        if (row.kind !== "bead" && row.kind !== "link")
          throw new Error("unknown stored Resource kind");
        return { kind: row.kind, body: String(row.body) };
      });
    },
    read(id: string): string | undefined {
      return transaction(() => {
        const body = get("SELECT body FROM resources WHERE id=?", id)?.body;
        return typeof body === "string" ? body : undefined;
      });
    },
    events(principal: string, source: string, subject: string, selection: EventSelection) {
      return transaction(() => {
        if (subject && !get("SELECT id FROM identities WHERE id=?", subject))
          throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
        let through = head();
        let after = selection.from === "now" ? through : 0;
        if (selection.after !== undefined) {
          const cursor = get("SELECT * FROM cursors WHERE token=?", selection.after);
          if (
            !cursor ||
            cursor.principal !== principal ||
            cursor.source !== source ||
            cursor.subject !== subject ||
            cursor.page_limit !== selection.limit
          )
            throw new RetainedRequestError("foreign-view", 409, "after-state-change");
          if (Number(cursor.expires) <= now())
            throw new RetainedRequestError("cursor-expired", 410, "after-state-change");
          after = Number(cursor.after_position);
          if (cursor.mode === "next") through = Number(cursor.through_position);
        }
        const rows = db
          .prepare(
            "SELECT e.position,e.body FROM events AS e WHERE e.position>? AND e.position<=? AND (?='' OR e.subject=? OR EXISTS (SELECT 1 FROM incidence AS i WHERE i.position=e.position AND i.bead=?)) ORDER BY e.position LIMIT ?",
          )
          .all(after, through, subject, subject, subject, selection.limit + 1);
        const more = rows.length > selection.limit;
        const selected = rows.slice(0, selection.limit);
        const scanned = more ? Number(selected.at(-1)?.position) : through;
        const cursor = saveCursor(
          principal,
          source,
          subject,
          scanned,
          through,
          selection.limit,
          "resume",
        );
        const nextToken = more
          ? saveCursor(principal, source, subject, scanned, through, selection.limit, "next")
          : undefined;
        const next = nextToken === undefined ? null : new URL(source);
        if (next instanceof URL) {
          next.searchParams.set("after", nextToken as string);
          next.searchParams.set("representation", "postimage");
          next.searchParams.set("limit", String(selection.limit));
        }
        return {
          source,
          ...(subject ? { subject } : {}),
          selection: { representation: "postimage" },
          policy: EVENT_POLICY,
          coverage: { start: boundary(0), retainedFrom: boundary(0), through: boundary(through) },
          events: selected.map((row) => ({ ...JSON.parse(String(row.body)), source })),
          cursor,
          next: next instanceof URL ? next.href : null,
        };
      });
    },
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
