/** Startup consistency within the owner's exclusive transaction. No repair or writes. */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { SEMANTIC_VALUE_FORMAT } from "../semantic-identity.js";
import { captureAliasNamespace } from "./alias-contract.js";
import type { AliasWitness } from "./alias-witness.js";
import { verifyGroupedRecovery } from "./batch-recovery.js";
import {
  canonicalCreatedId,
  deletedIdentity,
  eventDeleted,
  navigationAddresses,
  ORDINARY_OPERATIONS,
  type PrivateNavigation,
  type ResourceKind,
  type ResourceState,
  type RetainedBead,
  type RetainedLink,
  referenceUri,
  serialized,
} from "./contract.js";
import { incidentBeads } from "./events.js";

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
/** Read only a typed string path from the persisted tagged semantic identity. */
function identityString(identity: string, ...path: string[]): string | undefined {
  let node = JSON.parse(identity)[1];
  for (const key of path) {
    if (!Array.isArray(node) || node[0] !== "object" || !Array.isArray(node[1]))
      throw new Error("invalid historical semantic identity");
    const fields = node[1].filter((entry: unknown) => Array.isArray(entry) && entry[0] === key);
    if (fields.length === 0) return undefined;
    if (fields.length !== 1) throw new Error("duplicate historical semantic identity field");
    node = fields[0][1];
  }
  if (!Array.isArray(node) || node[0] !== "string" || typeof node[1] !== "string")
    throw new Error("invalid historical semantic string");
  return node[1];
}
export function verifyResourceRecovery(db: DatabaseSync, navigation: PrivateNavigation): void {
  verifySingletonRecovery(db, navigation, false);
}
/** Only the separately captured format7 may contain terminal versions/recovery. */
export function verifyHistoricalUpdateRecovery(
  db: DatabaseSync,
  navigation: PrivateNavigation,
): void {
  verifySingletonRecovery(db, navigation, true);
}
function verifySingletonRecovery(
  db: DatabaseSync,
  navigation: PrivateNavigation,
  historical: boolean,
): void {
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
  const terminalTokens = new Map<string, string>();
  const historicalBodies = new Map<string, Map<string, unknown>>();
  let historicalCount = 0;
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
    const versionRow = historical
      ? get(
          "SELECT id,revision,state,body FROM historical_versions WHERE position=?",
          row.position as SQLInputValue,
        )
      : undefined;
    const version = versionRow === undefined ? undefined : JSON.parse(String(versionRow.body));
    const terminal = version?.terminal;
    const historicalContext = version?.historicalUpdate;
    const recovered = historical && kind === "bead" && tombstones.has(id) && !deleting;
    if (historical && kind === "bead") {
      historicalCount++;
      if (
        !versionRow ||
        versionRow.id !== id ||
        versionRow.state !== (deleting ? "deleted" : "live") ||
        versionRow.revision !== (deleting ? terminal?.revision : resource?.revision) ||
        (deleting
          ? serialized(version) !== serialized({ terminal })
          : serialized(version) !==
            serialized({
              resource,
              ...(historicalContext === undefined ? {} : { historicalUpdate: historicalContext }),
            }))
      )
        throw new Error("inconsistent historical version record");
      if (
        historicalContext !== undefined &&
        (operation !== "updateBead" ||
          Object.keys(historicalContext).sort().join(",") !== "fromRevision,previousRevision" ||
          !historicalBodies.get(id)?.has(historicalContext.fromRevision) ||
          historicalContext.previousRevision !==
            (recovered ? terminalTokens.get(id) : latest.get(id)?.resource.revision))
      )
        throw new Error("inconsistent historical source/predecessor context");
      if (recovered && historicalContext === undefined)
        throw new Error("recovery lacks historical source context");
    } else if (versionRow !== undefined)
      throw new Error("historical record for unsupported Resource kind");
    if (
      row.position !== ++position ||
      typeof id !== "string" ||
      canonicalCreatedId(scope, id) !== id ||
      row.subject !== id ||
      fact.source !== source ||
      fact.representation !== "postimage" ||
      (tombstones.has(id) && !recovered) ||
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
        fact.revision !==
          (historical && kind === "bead" ? terminal?.revision : before.resource.revision) ||
        fact.previousRevision !==
          (historical && kind === "bead" ? before.resource.revision : undefined) ||
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
      if (historical && kind === "bead") {
        if (
          typeof terminal?.revision !== "string" ||
          !terminal.revision ||
          revisions.get(id)?.has(terminal.revision) ||
          terminal.id !== id ||
          terminal.state !== "deleted" ||
          terminal.previousRevision !== before.resource.revision ||
          serialized(terminal) !==
            serialized({
              id,
              revision: terminal.revision,
              state: "deleted",
              previousRevision: before.resource.revision,
            })
        )
          throw new Error("invalid terminal version lineage");
        revisions.get(id)?.add(terminal.revision);
        terminalTokens.set(id, terminal.revision);
      }
      expectedResult = { outcome: "deleted", changed: true, deleted };
      tombstones.set(id, deleted);
      latest.delete(id);
    } else {
      if (
        operation !==
          `${before || recovered ? "update" : "create"}${kind === "bead" ? "Bead" : "Link"}` ||
        (before && before.kind !== kind) ||
        (before || recovered ? fact.effect[kind] : fact.effect.id) !== id ||
        typeof resource.revision !== "string" ||
        !resource.revision ||
        fact.revision !== resource.revision ||
        fact.previousRevision !==
          (recovered ? terminalTokens.get(id) : before?.resource.revision) ||
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
      if (historical && kind === "bead") {
        const bodies = historicalBodies.get(id) ?? new Map<string, unknown>();
        bodies.set(resource.revision, resource);
        historicalBodies.set(id, bodies);
        tombstones.delete(id);
      }
      expectedResult = {
        outcome: before || recovered ? "updated" : "created",
        changed: true,
        resource,
      };
      if (historicalContext !== undefined)
        expectedResult = { result: expectedResult, historicalUpdate: historicalContext };
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
    (historical && get("SELECT count(*) AS n FROM historical_versions")?.n !== historicalCount) ||
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
  const observedLiveRevisions = new Map<string, Set<string>>();
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
    const nativeResult = JSON.parse(String(row.body));
    const result =
      historical && nativeResult.result !== undefined ? nativeResult.result : nativeResult;
    if (row.status === 200) {
      if (historical && row.operation === "updateBead") {
        const fromRevision = identityString(String(row.identity), "input", "fromRevision");
        if ((fromRevision !== undefined) !== (nativeResult.result !== undefined))
          throw new Error("historical result does not match selected request identity");
        if (fromRevision !== undefined) {
          const guard = identityString(String(row.identity), "input", "expectedRevision");
          const versionRow = get(
            "SELECT body FROM historical_versions WHERE id=? AND revision=?",
            result.resource?.id,
            result.resource?.revision,
          );
          const version =
            versionRow === undefined ? undefined : JSON.parse(String(versionRow.body));
          if (
            !observedLiveRevisions.get(result.resource?.id)?.has(fromRevision) ||
            version?.resource === undefined ||
            serialized(nativeResult) !==
              serialized({
                result,
                ...(version.historicalUpdate === undefined
                  ? {}
                  : { historicalUpdate: version.historicalUpdate }),
              }) ||
            (result.changed === true &&
              (nativeResult.historicalUpdate?.fromRevision !== fromRevision ||
                (guard !== undefined &&
                  guard !== nativeResult.historicalUpdate?.previousRevision))) ||
            (result.changed === false &&
              guard !== undefined &&
              guard !== live.get(result.resource?.id)?.resource.revision)
          )
            throw new Error("historical outcome differs from committed version/request context");
        }
      }
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
        const deleted = historical ? result.deleted : tombstones.get(result.deleted?.resource?.id);
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
          (!before &&
            !(
              historical &&
              kind === "bead" &&
              result.changed === true &&
              nativeResult.historicalUpdate !== undefined &&
              committed.get(id) === "bead"
            )) ||
          (before !== undefined && before.kind !== kind) ||
          row.operation !== `update${kind === "bead" ? "Bead" : "Link"}` ||
          (!result.changed && serialized(before?.resource) !== serialized(result.resource))
        )
          throw new Error("invalid retained update order");
        live.set(
          id,
          kind === "bead"
            ? { kind, resource: result.resource as RetainedBead }
            : { kind, resource: result.resource as RetainedLink },
        );
        const observed = observedLiveRevisions.get(id) ?? new Set<string>();
        observed.add(result.resource.revision);
        observedLiveRevisions.set(id, observed);
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

/** Explicit format6 entry; the format5 recovery entry above is unchanged. */
export function verifyAtomicBatchRecovery(db: DatabaseSync, navigation: PrivateNavigation): void {
  function operation(identity: unknown): string {
    if (typeof identity !== "string") throw new Error("missing batch semantic identity");
    const encoded = JSON.parse(identity);
    if (
      !Array.isArray(encoded) ||
      encoded.length !== 2 ||
      encoded[0] !== SEMANTIC_VALUE_FORMAT ||
      !Array.isArray(encoded[1]) ||
      encoded[1][0] !== "object" ||
      !Array.isArray(encoded[1][1])
    )
      throw new Error("invalid batch semantic context");
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
      !(
        value[1] === "batch" ||
        ORDINARY_OPERATIONS.includes(value[1] as (typeof ORDINARY_OPERATIONS)[number])
      )
    )
      throw new Error("invalid batch operation context");
    return value[1];
  }
  verifyGroupedRecovery(db, navigation, readAliasWitnesses, operation);
}
