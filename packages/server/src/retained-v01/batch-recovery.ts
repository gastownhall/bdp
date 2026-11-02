/** Grouped decision recovery: no writes, repair, or per-fact intermediate graph. */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { jsonValueEqual } from "../json-value-equality.js";
import { captureAliasNamespace } from "./alias-contract.js";
import type { AliasWitness } from "./alias-witness.js";
import { BATCH_OPERATIONS } from "./batch-contract.js";
import { type BatchFinalRow, covered } from "./batch-evaluate.js";
import {
  canonicalCreatedId,
  deletedIdentity,
  navigationAddresses,
  type PrivateNavigation,
  type ResourceKind,
  type ResourceState,
  referenceUri,
  serialized,
  typeReference,
} from "./contract.js";
import { incidentBeads, lifecycleFact } from "./events.js";

export function verifyGroupedRecovery(
  db: DatabaseSync,
  navigation: PrivateNavigation,
  readWitnesses: (value: unknown, navigation: PrivateNavigation) => readonly AliasWitness[],
  identityOperation: (value: unknown) => string,
): void {
  const get = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args);
  function fail(): never {
    throw new Error("inconsistent grouped retained decision");
  }
  const live = new Map<string, ResourceState>();
  const committed = new Map<string, ResourceKind>();
  const aliases = new Map<string, string>();
  const revisions = new Map<string, Set<string>>();
  const factIds = new Set<string>();
  const transactions = new Set<string>();
  const namespace = captureAliasNamespace(navigation.scope, navigation.aliases);
  const reserved = navigationAddresses(navigation);
  let decision = 0,
    position = 0,
    incidenceCount = 0;
  const nonempty = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;
  const keys = (value: object, expected: readonly string[]) =>
    Object.keys(value).every((key) => expected.includes(key));
  const canonical = (id: unknown): id is string =>
    typeof id === "string" && canonicalCreatedId(navigation.scope, id) === id;
  const stateFor = (row: BatchFinalRow): ResourceState => {
    if (
      !row.resource ||
      row.resource.id !== row.id ||
      !nonempty(row.resource.revision) ||
      !row.resource.properties ||
      typeof row.resource.properties !== "object" ||
      Array.isArray(row.resource.properties) ||
      !row.resource.metadata ||
      typeof row.resource.metadata !== "object" ||
      Array.isArray(row.resource.metadata) ||
      !keys(row.resource, [
        "id",
        "type",
        "revision",
        "properties",
        "metadata",
        "revisionProvenance",
        ...(row.resourceKind === "link" ? ["source", "target"] : []),
      ])
    )
      fail();
    typeReference(row.resource.type);
    return { kind: row.resourceKind, resource: row.resource } as ResourceState;
  };
  for (const stored of db.prepare("SELECT * FROM outcomes ORDER BY decision").iterate()) {
    if (stored.decision !== ++decision || stored.operation !== identityOperation(stored.identity))
      fail();
    const witnesses = readWitnesses(stored.witnesses, navigation);
    const witnessLimit =
      stored.operation === "batch"
        ? 96
        : ["createBead", "deleteLink", "putAlias", "deleteAlias"].includes(String(stored.operation))
          ? 0
          : ["updateBead", "deleteBead"].includes(String(stored.operation))
            ? 1
            : 2;
    if (witnesses.length > witnessLimit) fail();
    for (const witness of witnesses) {
      if (
        committed.has(witness.locator) ||
        (witness.target === null
          ? aliases.has(witness.locator)
          : aliases.get(witness.locator) !== witness.target ||
            committed.get(witness.target) !== "bead")
      )
        fail();
    }
    const memberships = db
      .prepare("SELECT position FROM decision_facts WHERE decision=? ORDER BY position")
      .all(decision)
      .map((entry) => entry.position);
    const result = JSON.parse(String(stored.body));
    if (stored.status !== 200) {
      if (
        typeof stored.status !== "number" ||
        stored.status < 400 ||
        stored.status > 599 ||
        result.status !== stored.status ||
        !nonempty(result.code) ||
        !nonempty(result.type) ||
        !["never", "after-state-change", "after-delay"].includes(result.retry) ||
        stored.event_position !== null ||
        memberships.length
      )
        fail();
      continue;
    }
    if (stored.operation === "putAlias" || stored.operation === "deleteAlias") {
      if (
        witnesses.length ||
        stored.event_position !== null ||
        memberships.length ||
        !nonempty(result.alias) ||
        !namespace.contains(result.alias) ||
        reserved.includes(result.alias)
      )
        fail();
      if (stored.operation === "putAlias") {
        if (
          committed.has(result.alias) ||
          aliases.has(result.target) ||
          live.get(result.target)?.kind !== "bead" ||
          serialized(result) !==
            serialized({
              outcome: aliases.has(result.alias) ? "updated" : "created",
              alias: result.alias,
              target: result.target,
            })
        )
          fail();
        aliases.set(result.alias, result.target);
      } else {
        if (
          !aliases.has(result.alias) ||
          serialized(result) !== serialized({ outcome: "deleted", alias: result.alias })
        )
          fail();
        aliases.delete(result.alias);
      }
      continue;
    }
    const batching = stored.operation === "batch";
    let rows: BatchFinalRow[];
    if (batching) {
      if (
        !keys(result, ["capabilityVersion", "changed", "transaction", "results", "resources"]) ||
        result.capabilityVersion !== "1" ||
        typeof result.changed !== "boolean" ||
        !Array.isArray(result.resources) ||
        !result.resources.length ||
        !Array.isArray(result.results) ||
        !result.results.length ||
        (result.changed ? !nonempty(result.transaction) : Object.hasOwn(result, "transaction"))
      )
        fail();
      const identity = JSON.parse(String(stored.identity));
      const inputEntries = identity[1][1].filter(
        (entry: unknown) => Array.isArray(entry) && entry[0] === "input",
      );
      const encodedInput = inputEntries[0]?.[1];
      if (
        inputEntries.length !== 1 ||
        !Array.isArray(encodedInput) ||
        encodedInput[0] !== "array" ||
        !Array.isArray(encodedInput[1])
      )
        fail();
      // Read only persisted tagged identity nodes: no admission, alias lookup,
      // current body read or operation reexecution is permitted during recovery.
      const objectNode = (node: unknown): Map<string, unknown> => {
        if (
          !Array.isArray(node) ||
          node.length !== 2 ||
          node[0] !== "object" ||
          !Array.isArray(node[1])
        )
          fail();
        const fields = new Map<string, unknown>();
        for (const entry of node[1]) {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== "string" ||
            fields.has(entry[0])
          )
            fail();
          fields.set(entry[0], entry[1]);
        }
        return fields;
      };
      const stringNode = (node: unknown): string => {
        if (
          !Array.isArray(node) ||
          node.length !== 2 ||
          node[0] !== "string" ||
          typeof node[1] !== "string"
        )
          fail();
        return node[1];
      };
      const operations = encodedInput[1].map((member: unknown) => {
        const fields = objectNode(member);
        const operation = stringNode(fields.get("operation"));
        const memberIdentity = JSON.parse(stringNode(fields.get("identity")));
        if (
          !Array.isArray(memberIdentity) ||
          memberIdentity.length !== 2 ||
          memberIdentity[0] !== "ru-semantic-value-1"
        )
          fail();
        const normalized = objectNode(memberIdentity[1]);
        if (stringNode(normalized.get("operation")) !== operation) fail();
        return {
          operation,
          input: objectNode(normalized.get("input")),
          handles: objectNode(fields.get("handles")),
        };
      });
      if (result.results.length !== operations.length) fail();
      rows = result.resources;
      const rowIds = new Map(rows.map((row) => [row.id, row]));
      if (rowIds.size !== rows.length) fail();
      const names = new Set<string>();
      const referenced = new Set<string>();
      const workingAlive = new Set(live.keys());
      const allocatedHere = new Set<string>();
      result.results.forEach((mapping: Record<string, unknown>, index: number) => {
        if (
          !keys(mapping, ["operationIndex", "operation", "id", "operationName"]) ||
          mapping.operationIndex !== index ||
          mapping.operation !== operations[index]!.operation ||
          typeof mapping.operation !== "string" ||
          !BATCH_OPERATIONS.includes(mapping.operation as (typeof BATCH_OPERATIONS)[number]) ||
          !canonical(mapping.id)
        )
          fail();
        const member = operations[index]!;
        const creating = mapping.operation.startsWith("create");
        const subject = mapping.operation.endsWith("Bead") ? "bead" : "link";
        const allowedHandles = creating
          ? subject === "link"
            ? ["source", "target"]
            : []
          : subject === "bead"
            ? ["bead"]
            : mapping.operation === "updateLink"
              ? ["link", "source", "target"]
              : ["link"];
        for (const [field, encodedCreator] of member.handles) {
          const creatorText = stringNode(encodedCreator);
          if (!allowedHandles.includes(field) || !/^(0|[1-9][0-9]*)$/.test(creatorText)) fail();
          const creatorIndex = Number(creatorText);
          if (!Number.isSafeInteger(creatorIndex) || creatorIndex >= index) fail();
          const creator = result.results[creatorIndex];
          if (
            !creator ||
            !creator.operation.startsWith("create") ||
            creator.operation.endsWith("Bead") !== (field !== "link")
          )
            fail();
          const reference = member.input.get(field);
          const placeholder =
            Array.isArray(reference) && reference[0] === "object"
              ? stringNode(objectNode(reference).get("uri"))
              : stringNode(reference);
          if (placeholder !== `${navigation.scope}batch-binding-${creatorIndex}`) fail();
        }
        if (creating) {
          if (member.input.has("id") && mapping.id !== stringNode(member.input.get("id"))) fail();
        } else {
          const creator = member.handles.get(subject);
          const expected =
            creator === undefined
              ? stringNode(member.input.get(subject))
              : result.results[Number(stringNode(creator))].id;
          // Compared subjects already contain the original alias target. The
          // retained witnesses above validate that original decision baseline.
          if (mapping.id !== expected) fail();
        }
        const row = rowIds.get(mapping.id);
        if (!row || row.resourceKind !== (mapping.operation.endsWith("Bead") ? "bead" : "link"))
          fail();
        if (mapping.operationName !== undefined) {
          if (
            !mapping.operation.startsWith("create") ||
            typeof mapping.operationName !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_-]*$/.test(mapping.operationName) ||
            names.has(mapping.operationName)
          )
            fail();
          names.add(mapping.operationName);
        }
        if (mapping.operation.startsWith("create")) {
          if (committed.has(mapping.id) || allocatedHere.has(mapping.id) || aliases.has(mapping.id))
            fail();
          allocatedHere.add(mapping.id);
          workingAlive.add(mapping.id);
        } else {
          if (!workingAlive.has(mapping.id)) fail();
          if (mapping.operation.startsWith("delete")) workingAlive.delete(mapping.id);
        }
        referenced.add(mapping.id);
      });
      // This provider advertises no ownership rules: every final row is explicit.
      if (
        referenced.size !== rows.length ||
        result.changed !== rows.some((row) => row.changed) ||
        rows.some(
          (row) =>
            workingAlive.has(row.id) !== (row.resource !== undefined) ||
            allocatedHere.has(row.id) !== ["created", "allocated"].includes(row.outcome),
        )
      )
        fail();
    } else {
      const deleting = String(stored.operation).startsWith("delete");
      const id = deleting ? result.deleted?.resource?.id : result.resource?.id;
      const kind = String(stored.operation).endsWith("Bead") ? "bead" : "link";
      if (
        !keys(
          result,
          deleting ? ["outcome", "changed", "deleted"] : ["outcome", "changed", "resource"],
        ) ||
        typeof result.changed !== "boolean" ||
        !canonical(id) ||
        (deleting
          ? result.outcome !== "deleted" || !result.changed
          : result.outcome !==
            (String(stored.operation).startsWith("create") ? "created" : "updated"))
      )
        fail();
      rows = [
        {
          id,
          resourceKind: kind,
          changed: result.changed,
          outcome: deleting ? "deleted" : result.changed ? result.outcome : "unchanged",
          ...(deleting ? { deleted: result.deleted } : { resource: result.resource }),
        },
      ];
    }
    const beforeGroup = new Map(live);
    const effects: { before?: ResourceState; after?: ResourceState }[] = [];
    let previousId: string | undefined;
    for (const row of rows) {
      if (
        !row ||
        !canonical(row.id) ||
        !["bead", "link"].includes(row.resourceKind) ||
        !keys(row, ["id", "resourceKind", "outcome", "changed", "resource", "deleted"]) ||
        typeof row.changed !== "boolean" ||
        (batching && previousId !== undefined && previousId >= row.id)
      )
        fail();
      previousId = row.id;
      const before = beforeGroup.get(row.id);
      if (row.outcome === "allocated") {
        if (
          !batching ||
          !row.changed ||
          before ||
          committed.has(row.id) ||
          aliases.has(row.id) ||
          row.resource !== undefined ||
          row.deleted !== undefined ||
          !result.results.some(
            (entry: { id: string; operation: string }) =>
              entry.id === row.id && entry.operation.startsWith("create"),
          ) ||
          !result.results.some(
            (entry: { id: string; operation: string }) =>
              entry.id === row.id && entry.operation.startsWith("delete"),
          )
        )
          fail();
        committed.set(row.id, row.resourceKind);
        continue;
      }
      if (row.outcome === "deleted") {
        if (
          !before ||
          before.kind !== row.resourceKind ||
          !row.changed ||
          row.resource !== undefined ||
          serialized(row.deleted) !== serialized(deletedIdentity(before))
        )
          fail();
        live.delete(row.id);
        effects.push({ before });
        continue;
      }
      if (row.deleted !== undefined) fail();
      const after = stateFor(row);
      if (row.outcome === "unchanged") {
        if (
          row.changed ||
          !before ||
          before.kind !== row.resourceKind ||
          serialized(after) !== serialized(before)
        )
          fail();
      } else if (row.outcome === "created") {
        if (!row.changed || before || committed.has(row.id) || aliases.has(row.id)) fail();
        committed.set(row.id, row.resourceKind);
        effects.push({ after });
      } else if (row.outcome === "updated") {
        if (
          !row.changed ||
          !before ||
          before.kind !== row.resourceKind ||
          before.resource.revision === after.resource.revision ||
          jsonValueEqual(covered(before), covered(after))
        )
          fail();
        effects.push({ before, after });
      } else fail();
      if (row.changed) {
        const tokens = revisions.get(row.id) ?? new Set<string>();
        if (tokens.has(after.resource.revision)) fail();
        tokens.add(after.resource.revision);
        revisions.set(row.id, tokens);
      }
      live.set(row.id, after);
    }
    // Validate the whole published graph only after the atomic row set is applied.
    for (const state of live.values())
      if (state.kind === "link") {
        const endpoints = [state.resource.source, state.resource.target];
        const local = endpoints.map(referenceUri).filter((uri) => uri.startsWith(navigation.scope));
        if (!local.length || local.some((uri) => live.get(uri)?.kind !== "bead")) fail();
      }
    if (memberships.length !== effects.length || stored.event_position !== (memberships[0] ?? null))
      fail();
    const groupTransaction = batching
      ? result.changed
        ? result.transaction
        : undefined
      : effects.length
        ? JSON.parse(
            String(
              get("SELECT body FROM events WHERE position=?", memberships[0] as SQLInputValue)
                ?.body,
            ),
          ).transaction
        : undefined;
    if (groupTransaction !== undefined) {
      if (!nonempty(groupTransaction) || transactions.has(groupTransaction)) fail();
      transactions.add(groupTransaction);
    }
    for (const [index, effect] of effects.entries()) {
      const currentPosition = ++position;
      if (memberships[index] !== currentPosition) fail();
      const event = get("SELECT subject,body FROM events WHERE position=?", currentPosition);
      if (!event) fail();
      const fact = JSON.parse(String(event.body));
      const state = effect.after ?? effect.before!;
      const verb = effect.after ? (effect.before ? "update" : "create") : "delete";
      if (
        !nonempty(fact.id) ||
        factIds.has(fact.id) ||
        !nonempty(fact.transaction) ||
        (batching && fact.transaction !== result.transaction) ||
        !nonempty(fact.time) ||
        !Number.isFinite(Date.parse(fact.time)) ||
        event.subject !== state.resource.id ||
        serialized(fact) !==
          serialized(
            lifecycleFact(
              verb,
              state,
              navigation.events,
              fact.id,
              fact.transaction,
              fact.time,
              effect.before?.resource.revision,
            ),
          ) ||
        !get("SELECT token FROM boundaries WHERE position=?", currentPosition)
      )
        fail();
      factIds.add(fact.id);
      const incidence = [...incidentBeads(navigation.scope, effect.before, effect.after)].sort();
      const actual = db
        .prepare("SELECT bead FROM incidence WHERE position=? ORDER BY bead")
        .all(currentPosition)
        .map((row) => row.bead);
      if (serialized(incidence) !== serialized(actual)) fail();
      incidenceCount += incidence.length;
    }
  }
  if (
    get("SELECT count(*) AS n FROM events")?.n !== position ||
    get("SELECT count(*) AS n FROM decision_facts")?.n !== position ||
    get("SELECT count(*) AS n FROM boundaries")?.n !== position + 1 ||
    !get("SELECT token FROM boundaries WHERE position=0") ||
    get("SELECT count(*) AS n FROM incidence")?.n !== incidenceCount ||
    get("SELECT count(*) AS n FROM resources")?.n !== live.size ||
    get("SELECT count(*) AS n FROM identities")?.n !== committed.size ||
    get("SELECT count(*) AS n FROM aliases")?.n !== aliases.size ||
    get("SELECT value FROM metadata WHERE name='decisions'")?.value !== String(decision) ||
    get("SELECT count(*) AS n FROM metadata")?.n !== 2
  )
    fail();
  for (const [id, state] of live)
    if (get("SELECT body FROM resources WHERE id=?", id)?.body !== serialized(state.resource))
      fail();
  for (const [id, kind] of committed)
    if (get("SELECT kind FROM identities WHERE id=?", id)?.kind !== kind) fail();
  for (const [locator, target] of aliases)
    if (get("SELECT target FROM aliases WHERE locator=?", locator)?.target !== target) fail();
}
