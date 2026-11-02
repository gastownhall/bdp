/** Startup consistency within the owner's exclusive transaction. No repair or writes. */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  canonicalCreatedId,
  deletedIdentity,
  eventDeleted,
  referenceUri,
  serialized,
  navigationAddresses,
  ORDINARY_OPERATIONS,
  type PrivateNavigation,
  type ResourceKind,
  type ResourceState,
  type RetainedBead,
  type RetainedLink,
} from "./contract.js";
import { incidentBeads } from "./events.js";
import { captureAliasNamespace } from "./alias-contract.js";
import type { AliasWitness } from "./alias-witness.js";
import { SEMANTIC_VALUE_FORMAT } from "../semantic-identity.js";

export function readAliasWitnesses(
  value: unknown,
  navigation: PrivateNavigation,
): readonly AliasWitness[] {
  if (typeof value !== "string") throw new Error("missing retained alias witnesses");
  const witnesses: unknown = JSON.parse(value);
  if (!Array.isArray(witnesses)) throw new Error("invalid retained alias witnesses");
  const namespace = captureAliasNamespace(navigation.scope, navigation.aliases);
  const reserved = navigationAddresses(navigation);
  let previous: string | undefined;
  return Object.freeze(
    witnesses.map((witness): AliasWitness => {
      if (
        !witness ||
        typeof witness !== "object" ||
        Array.isArray(witness) ||
        Object.keys(witness).sort().join(",") !== "locator,target" ||
        typeof witness.locator !== "string" ||
        !namespace.contains(witness.locator) ||
        reserved.includes(witness.locator) ||
        (previous !== undefined && previous >= witness.locator)
      )
        throw new Error("invalid retained alias locator witness");
      let canonical = witness.target === null;
      if (typeof witness.target === "string") {
        try {
          canonical = canonicalCreatedId(navigation.scope, witness.target) === witness.target;
        } catch {
          canonical = false;
        }
      }
      if (!canonical) throw new Error("invalid retained alias target witness");
      previous = witness.locator;
      return Object.freeze({ locator: witness.locator, target: witness.target as string | null });
    }),
  );
}
function identityOperation(identity: unknown): string {
  if (typeof identity !== "string") throw new Error("missing retained semantic identity");
  const encoded = JSON.parse(identity);
  if (
    !Array.isArray(encoded) ||
    encoded.length !== 2 ||
    encoded[0] !== SEMANTIC_VALUE_FORMAT ||
    !Array.isArray(encoded[1]) ||
    encoded[1][0] !== "object" ||
    !Array.isArray(encoded[1][1])
  )
    throw new Error("invalid retained semantic context");
  const entries = encoded[1][1].filter(
    (entry: unknown) => Array.isArray(entry) && entry[0] === "operation",
  );
  const value = entries[0]?.[1];
  if (
    entries.length !== 1 ||
    !Array.isArray(value) ||
    value.length !== 2 ||
    value[0] !== "string" ||
    typeof value[1] !== "string" ||
    !ORDINARY_OPERATIONS.includes(value[1] as (typeof ORDINARY_OPERATIONS)[number])
  )
    throw new Error("invalid retained operation context");
  return value[1];
}
export function verifyResourceRecovery(db: DatabaseSync, navigation: PrivateNavigation): void {
  const scope = navigation.scope;
  const source = navigation.events;
  const aliasNamespace = captureAliasNamespace(scope, navigation.aliases);
  const reserved = navigationAddresses(navigation);
  const get = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args);
  const latest = new Map<string, ResourceState>();
  const kinds = new Map<string, ResourceKind>();
  const versions = new Map<string, Set<string>>();
  const revisions = new Map<string, Set<string>>();
  const tombstones = new Map<string, ReturnType<typeof deletedIdentity>>();
  let position = 0;
  let incidenceCount = 0;
  for (const row of db
    .prepare("SELECT position,subject,body FROM events ORDER BY position")
    .iterate()) {
    const fact = JSON.parse(String(row.body));
    const operation = fact.effect?.operation;
    if (typeof operation !== "string" || !/^(?:create|update|delete)(?:Bead|Link)$/.test(operation))
      throw new Error("unknown retained lifecycle operation");
    const kind: ResourceKind = operation.endsWith("Bead") ? "bead" : "link";
    const deleting = operation.startsWith("delete");
    const resource = deleting ? fact.effect.deleted?.resource : fact.effect.resource;
    const id = resource?.id;
    if (
      row.position !== ++position ||
      typeof id !== "string" ||
      canonicalCreatedId(scope, id) !== id ||
      row.subject !== id ||
      fact.source !== source ||
      fact.representation !== "postimage" ||
      tombstones.has(id) ||
      !get("SELECT token FROM boundaries WHERE position=?", position)
    )
      throw new Error("inconsistent retained Event chain");
    const before = latest.get(id);
    let after: ResourceState | undefined;
    let expectedResult: unknown;
    if (deleting) {
      if (
        !before ||
        before.kind !== kind ||
        fact.revision !== before.resource.revision ||
        fact.previousRevision !== undefined ||
        serialized(fact.effect) !==
          serialized({
            operation,
            [kind]: id,
            deleted: eventDeleted(before),
          })
      )
        throw new Error("inconsistent final-live deletion context");
      if (
        kind === "bead" &&
        [...latest.values()].some(
          (state) =>
            state.kind === "link" &&
            [state.resource.source, state.resource.target].some(
              (reference) => referenceUri(reference) === id,
            ),
        )
      )
        throw new Error("retained deletion bypassed incident-Link guard");
      const deleted = deletedIdentity(before);
      expectedResult = { outcome: "deleted", changed: true, deleted };
      tombstones.set(id, deleted);
      latest.delete(id);
    } else {
      if (
        operation !== `${before ? "update" : "create"}${kind === "bead" ? "Bead" : "Link"}` ||
        (before && before.kind !== kind) ||
        (before ? fact.effect[kind] : fact.effect.id) !== id ||
        typeof resource.revision !== "string" ||
        !resource.revision ||
        fact.revision !== resource.revision ||
        fact.previousRevision !== before?.resource.revision ||
        before?.resource.revision === resource.revision
      )
        throw new Error("inconsistent retained postimage chain");
      after =
        kind === "bead"
          ? { kind, resource: resource as RetainedBead }
          : { kind, resource: resource as RetainedLink };
      if (after.kind === "link") {
        const local = incidentBeads(scope, after);
        if (!local.length || local.some((uri) => latest.get(uri)?.kind !== "bead"))
          throw new Error("retained Link has no admissible live local endpoint");
      }
      const states = versions.get(id) ?? new Set<string>();
      const tokens = revisions.get(id) ?? new Set<string>();
      if (tokens.has(resource.revision)) throw new Error("reused retained Resource revision");
      tokens.add(resource.revision);
      states.add(serialized(resource));
      revisions.set(id, tokens);
      versions.set(id, states);
      kinds.set(id, kind);
      latest.set(id, after);
      expectedResult = { outcome: before ? "updated" : "created", changed: true, resource };
    }
    const incidence = incidentBeads(scope, before, after);
    const actual = db
      .prepare("SELECT bead FROM incidence WHERE position=? ORDER BY bead")
      .all(position)
      .map((entry) => entry.bead);
    if (serialized([...incidence].sort()) !== serialized(actual))
      throw new Error("inconsistent retained fact incidence");
    incidenceCount += incidence.length;
    const outcome = get(
      "SELECT operation,status,body FROM outcomes WHERE event_position=?",
      position,
    );
    if (
      outcome?.operation !== operation ||
      outcome.status !== 200 ||
      outcome.body !== serialized(expectedResult)
    )
      throw new Error("missing or inconsistent retained transition outcome");
  }
  if (
    get("SELECT count(*) AS n FROM resources")?.n !== latest.size ||
    get("SELECT count(*) AS n FROM identities")?.n !== kinds.size ||
    get("SELECT count(*) AS n FROM incidence")?.n !== incidenceCount ||
    get("SELECT count(*) AS n FROM boundaries")?.n !== position + 1
  )
    throw new Error("incomplete retained recovery state");
  for (const [id, state] of latest) {
    if (get("SELECT body FROM resources WHERE id=?", id)?.body !== serialized(state.resource))
      throw new Error("current Resource differs from final retained fact");
  }
  for (const [id, kind] of kinds) {
    if (get("SELECT kind FROM identities WHERE id=?", id)?.kind !== kind)
      throw new Error("missing permanent retained identity");
  }
  const live = new Map<string, ResourceState>();
  const committed = new Map<string, ResourceKind>();
  const aliases = new Map<string, string>();
  let decision = 0;
  let transition = 0;
  for (const row of db
    .prepare(
      "SELECT decision,operation,identity,witnesses,status,body,event_position FROM outcomes ORDER BY decision",
    )
    .iterate()) {
    if (row.decision !== ++decision || row.operation !== identityOperation(row.identity))
      throw new Error("inconsistent retained decision context");
    const witnesses = readAliasWitnesses(row.witnesses, navigation);
    const witnessLimit = ["createBead", "deleteLink", "putAlias", "deleteAlias"].includes(
      String(row.operation),
    )
      ? 0
      : ["updateBead", "deleteBead"].includes(String(row.operation))
        ? 1
        : 2;
    if (witnesses.length > witnessLimit)
      throw new Error("impossible retained Reference witness set");
    for (const witness of witnesses) {
      if (
        committed.has(witness.locator) ||
        (witness.target === null
          ? aliases.has(witness.locator)
          : aliases.get(witness.locator) !== witness.target ||
            committed.get(witness.target) !== "bead")
      )
        throw new Error("inconsistent original alias comparison witness");
    }
    const result = JSON.parse(String(row.body));
    if (row.status === 200) {
      if (row.operation === "putAlias" || row.operation === "deleteAlias") {
        if (
          witnesses.length ||
          row.event_position !== null ||
          typeof result.alias !== "string" ||
          !aliasNamespace.contains(result.alias) ||
          reserved.includes(result.alias)
        )
          throw new Error("invalid retained alias result context");
        if (row.operation === "putAlias") {
          const previous = aliases.has(result.alias);
          if (
            committed.has(result.alias) ||
            live.get(result.target)?.kind !== "bead" ||
            aliases.has(result.target) ||
            serialized(result) !==
              serialized({
                outcome: previous ? "updated" : "created",
                alias: result.alias,
                target: result.target,
              })
          )
            throw new Error("inconsistent retained alias put");
          aliases.set(result.alias, result.target);
        } else {
          if (
            !aliases.has(result.alias) ||
            serialized(result) !== serialized({ outcome: "deleted", alias: result.alias })
          )
            throw new Error("inconsistent retained alias deletion");
          aliases.delete(result.alias);
        }
        continue;
      }
      if (result.changed === true && row.event_position !== ++transition)
        throw new Error("retained decision and Event orders differ");
      if (result.outcome === "deleted") {
        const deleted = tombstones.get(result.deleted?.resource?.id);
        if (
          !deleted ||
          result.changed !== true ||
          row.event_position === null ||
          serialized(result.deleted) !== serialized(deleted)
        )
          throw new Error("inconsistent retained deletion outcome");
        const before = live.get(result.deleted.resource.id);
        if (
          !before ||
          `${row.operation}` !== `delete${before.kind === "bead" ? "Bead" : "Link"}` ||
          serialized(deletedIdentity(before)) !== serialized(result.deleted)
        )
          throw new Error("invalid retained deletion order");
        live.delete(result.deleted.resource.id);
      } else if (
        !versions.get(result.resource?.id)?.has(serialized(result.resource)) ||
        !["created", "updated"].includes(result.outcome) ||
        typeof result.changed !== "boolean" ||
        (result.changed
          ? row.event_position === null
          : row.event_position !== null || result.outcome !== "updated")
      ) {
        throw new Error("inconsistent retained successful outcome");
      } else {
        const id = result.resource.id;
        const kind = `${row.operation}`.endsWith("Bead") ? "bead" : "link";
        const before = live.get(id);
        if (result.outcome === "created") {
          if (
            before ||
            committed.has(id) ||
            aliases.has(id) ||
            row.operation !== `create${kind === "bead" ? "Bead" : "Link"}`
          )
            throw new Error("retained creation reused a locator or identity");
          committed.set(id, kind);
        } else if (
          !before ||
          before.kind !== kind ||
          row.operation !== `update${kind === "bead" ? "Bead" : "Link"}` ||
          (!result.changed && serialized(before.resource) !== serialized(result.resource))
        )
          throw new Error("invalid retained update order");
        live.set(
          id,
          kind === "bead"
            ? { kind, resource: result.resource as RetainedBead }
            : { kind, resource: result.resource as RetainedLink },
        );
      }
    } else if (
      typeof row.status !== "number" ||
      row.status < 400 ||
      row.status > 599 ||
      result.status !== row.status ||
      row.event_position !== null
    ) {
      throw new Error("inconsistent retained refusal");
    }
  }
  const actualAliases = db.prepare("SELECT locator,target FROM aliases ORDER BY locator").all();
  if (actualAliases.length !== aliases.size) throw new Error("missing retained alias state");
  for (const row of actualAliases) {
    if (
      typeof row.locator !== "string" ||
      aliases.get(row.locator) !== row.target ||
      committed.has(row.locator)
    )
      throw new Error("current alias differs from retained decision chain");
  }
  if (
    transition !== position ||
    live.size !== latest.size ||
    [...live].some(([id, state]) => serialized(state) !== serialized(latest.get(id)))
  )
    throw new Error("decision order differs from retained Resource chain");
  const decisions = get("SELECT value FROM metadata WHERE name='decisions'")?.value;
  if (
    typeof decisions !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(decisions) ||
    !Number.isSafeInteger(Number(decisions)) ||
    Number(decisions) !== get("SELECT count(*) AS n FROM outcomes")?.n ||
    get("SELECT count(*) AS n FROM metadata")?.n !== 2
  )
    throw new Error("incomplete retained outcome census");
}
