/**
 * Binds the Callables mechanism to this reference's store: which declarations exist, which
 * are reachable (§7) and how an invocation runs (§§3-5). No operation's meaning lives here.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  CALLABLE_ABSTRACT_TYPE,
  CALLABLE_BATCH_TYPE,
  CALLABLE_QUERY_TYPE,
  type CallableAnswer,
  type CallableDeclaration,
  type CallableEffects,
  type CallableImplementation,
  CALLABLES_ROOT,
  callableKind,
  checkArguments,
  declarationDiagnostics,
  type Diagnostic,
  type EffectOutcome,
  mountName,
  parseInvocation,
  projectOpenApi,
  RetainedRequestErrorWithBody,
  satisfiesDeclaredSchema,
} from "./callables.js";
import {
  type JsonObject,
  type PrivateNavigation,
  prepareCreate,
  prepareDelete,
  prepareUpdate,
  problem,
  RetainedRequestError,
  referenceUri,
  serialized,
} from "./contract.js";
import { type LinkOperation, prepareLink } from "./link-contract.js";
import type {
  openPrivateRetainedStore,
  ScopePolicy,
  ScopePolicyChange,
  StoredResponse,
} from "./store.js";

type Store = ReturnType<typeof openPrivateRetainedStore>;

export interface ProvidedCallable {
  /** The Callable's name: its full local Resource ID (§2.1). */
  readonly name: string;
  readonly kind: "query" | "batch";
  /** The declaration: the Bead's properties object. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Omit for a declaration with no working implementation: `callable-unavailable`. */
  readonly implementation?: CallableImplementation;
}
export interface CallablesComposition {
  readonly declarations: readonly ProvidedCallable[];
  /**
   * `root`: a root Bead at `sys/callables` whose `exposes` Links are the whole fact (§7).
   * `provider`: no root Bead; the declarations above are what is reachable.
   */
  readonly registration: "root" | "provider";
}

const SYSTEM_PRINCIPAL = "bdp-reference-callables";
/** §12 leaves the root's Type and the Link Type's final name open, so these are Scope-local. */
const rootType = (scope: string) => `${scope}sys/types/callables-root`;
const exposesType = (scope: string) => `${scope}sys/types/exposes`;

const refuse = (diagnostics: readonly Diagnostic[]): JsonObject =>
  ({ ...problem("validation-failed", 422), diagnostics }) as unknown as JsonObject;

/** §2.5 "A provider does not serve an invalid declaration"; §7's Link needs a declaration. */
export function callablesScopePolicy(scope: string): ScopePolicy {
  const root = scope + CALLABLES_ROOT;
  return {
    id: "callables-declarations-1",
    admit(change: ScopePolicyChange) {
      const { after } = change;
      const type = referenceUri(after.resource.type);
      if (after.kind === "bead") {
        if (type === CALLABLE_ABSTRACT_TYPE)
          return refuse([{ message: "`callable` is abstract: affiliate with a refinement" }]);
        if (callableKind(type) === undefined) return undefined;
        const diagnostics = declarationDiagnostics(after.resource.properties);
        return diagnostics.length === 0 ? undefined : refuse(diagnostics);
      }
      if (type !== exposesType(scope)) return undefined;
      const target = change.read(referenceUri(after.resource.target));
      if (
        referenceUri(after.resource.source) !== root ||
        target?.kind !== "bead" ||
        callableKind(target.resource.type) === undefined
      )
        return refuse([
          { message: "an `exposes` Link runs from sys/callables to a declaration Bead" },
        ]);
      return undefined;
    },
  };
}

/** Several native policies over one Scope: the first refusal stands, stamps accumulate. */
export function composePolicies(policies: readonly ScopePolicy[]): ScopePolicy | undefined {
  if (policies.length === 0) return undefined;
  return {
    id: policies.map(({ id }) => id).join("+"),
    admit: (change) => {
      for (const policy of policies) {
        const refused = policy.admit(change);
        if (refused) return refused;
      }
      return undefined;
    },
    stamp: (change, time) => {
      let stamped: JsonObject | undefined;
      for (const policy of policies) {
        const next = policy.stamp?.(
          stamped === undefined
            ? change
            : {
                ...change,
                after: {
                  ...change.after,
                  resource: { ...change.after.resource, properties: stamped },
                } as ScopePolicyChange["after"],
              },
          time,
        );
        if (next !== undefined) stamped = next;
      }
      return stamped;
    },
  };
}

function parseOutcome(stored: StoredResponse): EffectOutcome {
  return { status: stored.status, body: JSON.parse(stored.text) as Record<string, unknown> };
}

export function createCallablesService(
  composition: CallablesComposition,
  store: Store,
  navigation: PrivateNavigation,
) {
  const scope = navigation.scope;
  const rootId = scope + CALLABLES_ROOT;
  const implementations = new Map<string, CallableImplementation>();
  const names = new Set<string>();
  if (composition.registration !== "root" && composition.registration !== "provider")
    throw new TypeError("Callables registration must be root or provider");
  for (const provided of composition.declarations) {
    if (names.has(provided.name)) throw new TypeError(`duplicate Callable name ${provided.name}`);
    names.add(provided.name);
    if (provided.kind !== "query" && provided.kind !== "batch")
      throw new TypeError(`Callable ${provided.name} needs a kind`);
    const diagnostics = declarationDiagnostics(JSON.parse(serialized(provided.properties)));
    if (diagnostics.length > 0)
      throw new TypeError(
        `Callable ${provided.name} is not a valid declaration: ${diagnostics[0]?.message}`,
      );
    if (provided.implementation !== undefined)
      implementations.set(provided.name, provided.implementation);
  }

  const place = (stored: StoredResponse, what: string) => {
    if (stored.status !== 200)
      throw new Error(`Callables setup could not place ${what}: ${stored.text}`);
  };
  const stableKey = (...parts: readonly string[]) =>
    `callables-setup-${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
  store.asSystem(() => {
    if (composition.registration === "root" && store.readRecord(rootId) === undefined) {
      const body = serialized({
        id: CALLABLES_ROOT,
        type: rootType(scope),
        properties: { title: "The Callables this Scope exposes" },
        metadata: {},
      });
      place(
        store.create(SYSTEM_PRINCIPAL, prepareCreate(scope, body, stableKey("root", body))),
        "the root Bead",
      );
    }
    for (const provided of composition.declarations) {
      const id = scope + provided.name;
      const type = provided.kind === "batch" ? CALLABLE_BATCH_TYPE : CALLABLE_QUERY_TYPE;
      const current = store.readRecord(id);
      if (current === undefined) {
        const body = serialized({
          id: provided.name,
          type,
          properties: provided.properties,
          metadata: {},
        });
        place(
          store.create(SYSTEM_PRINCIPAL, prepareCreate(scope, body, stableKey("declare", body))),
          `declaration ${provided.name}`,
        );
        if (composition.registration === "root") {
          const link = serialized({
            type: exposesType(scope),
            source: rootId,
            target: id,
            properties: {},
            metadata: {},
          });
          place(
            store.createLink(
              SYSTEM_PRINCIPAL,
              prepareLink(scope, "createLink", link, stableKey("expose", link)),
            ),
            `the exposes Link of ${provided.name}`,
          );
        }
        continue;
      }
      const record = JSON.parse(current.body) as {
        type: unknown;
        properties: unknown;
        revision: string;
      };
      if (
        referenceUri(record.type as string) !== type ||
        serialized(record.properties) !== serialized(provided.properties)
      ) {
        const body = serialized({
          bead: id,
          type,
          properties: provided.properties,
          expectedRevision: record.revision,
        });
        place(
          store.update(SYSTEM_PRINCIPAL, prepareUpdate(scope, body, stableKey("redeclare", body))),
          `declaration ${provided.name}`,
        );
      }
    }
  });

  function declarationAt(id: string): CallableDeclaration | undefined {
    const record = store.readRecord(id);
    if (record?.kind !== "bead") return undefined;
    const bead = JSON.parse(record.body) as {
      type: unknown;
      revision: string;
      properties: JsonObject;
    };
    const kind = callableKind(bead.type);
    if (kind === undefined || declarationDiagnostics(bead.properties).length > 0) return undefined;
    return {
      id,
      name: id.slice(scope.length),
      kind,
      revision: bead.revision,
      properties: bead.properties,
    };
  }
  /** §7. With a root Bead its live Links are the whole fact; without one, the provider's set. */
  function reachable(): readonly CallableDeclaration[] {
    if (store.readRecord(rootId) === undefined)
      return composition.registration === "root"
        ? []
        : [...names].flatMap((name) => declarationAt(scope + name) ?? []);
    return store
      .listRecords("link")
      .filter(
        (link) =>
          referenceUri(link.type as string) === exposesType(scope) &&
          referenceUri(link.source as string) === rootId,
      )
      .flatMap((link) => declarationAt(referenceUri(link.target as string)) ?? []);
  }

  const rendered = (status: number, body: unknown): StoredResponse => ({
    status,
    text: serialized(body),
  });
  const notFound = () => rendered(404, problem("callable-not-found", 404, "after-state-change"));

  return {
    openApi: () => projectOpenApi(scope, reachable(), true),
    invoke(principal: string, pathname: string, text: string, key: string | undefined) {
      const name = mountName(scope, pathname);
      const invocation = parseInvocation(text);
      if (key !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(key))
        throw new RetainedRequestError("malformed-request", 400);
      if (name === undefined) return notFound();
      // §6: a retained key replays its result even after the declaration changed.
      const identity = invocation.identity(name);
      if (key !== undefined) {
        const replay = store.replayCallable(principal, key, identity);
        if (replay !== undefined) return replay;
      }
      const declaration = reachable().find((candidate) => candidate.name === name);
      if (declaration === undefined) return notFound();
      const batch = declaration.kind === "batch";
      if (!batch && (key !== undefined || invocation.provenance !== undefined))
        throw new RetainedRequestError("malformed-request", 400);
      if (batch && key === undefined) throw new RetainedRequestError("malformed-request", 400);
      const args = checkArguments(declaration, invocation.arguments);
      const implementation = implementations.get(name);
      if (implementation === undefined)
        return rendered(503, problem("callable-unavailable", 503, "after-state-change"));
      const context = {
        name,
        arguments: args,
        scope,
        ...(invocation.provenance === undefined ? {} : { provenance: invocation.provenance }),
        read(id: string) {
          const record = store.readRecord(id);
          return record === undefined
            ? undefined
            : (JSON.parse(record.body) as Record<string, unknown>);
        },
        list: (kind: "bead" | "link") =>
          store.listRecords(kind) as unknown as readonly Record<string, unknown>[],
      };
      const respond = (answer: CallableAnswer, changed: boolean | undefined): StoredResponse => {
        if ("result" in answer) {
          if (!satisfiesDeclaredSchema(declaration.properties.resultSchema, answer.result))
            throw new ImplementationFailure();
          return rendered(200, {
            result: answer.result,
            ...(changed === undefined ? {} : { changed }),
          });
        }
        if ("error" in answer) {
          if (!satisfiesDeclaredSchema(declaration.properties.errorSchema, answer.error))
            throw new ImplementationFailure();
          return rendered(409, {
            ...problem("callable-error", 409, "after-state-change"),
            error: answer.error,
          });
        }
        if (answer.problem.status < 400 || answer.problem.body.code === "callable-error")
          throw new ImplementationFailure();
        return rendered(answer.problem.status, answer.problem.body);
      };
      // §9: a crash or a value the declaration rules out is no answer of the operation's.
      const guarded = <T>(run: () => T): T => {
        try {
          return run();
        } catch (error) {
          if (
            error instanceof RetainedRequestError ||
            error instanceof RetainedRequestErrorWithBody
          )
            throw error;
          throw new RetainedRequestError("temporarily-unavailable", 503, "after-delay");
        }
      };
      if (!batch)
        return guarded(() =>
          store.observeCallable(() => respond(implementation(context), undefined)),
        );
      let changed = false;
      const provenance =
        invocation.provenanceInput === undefined
          ? {}
          : { revisionProvenance: invocation.provenanceInput };
      const effectKey = () => `callable-effect-${randomUUID()}`;
      const effect = (run: (body: string, key: string) => StoredResponse) => {
        return (body: Record<string, unknown>): EffectOutcome => {
          const outcome = parseOutcome(run(serialized({ ...provenance, ...body }), effectKey()));
          if (outcome.body.changed === true) changed = true;
          return outcome;
        };
      };
      const link = (operation: LinkOperation) =>
        effect((body, k) => store[operation](principal, prepareLink(scope, operation, body, k)));
      const effects: CallableEffects = {
        createBead: effect((body, k) => store.create(principal, prepareCreate(scope, body, k))),
        updateBead: effect((body, k) => store.update(principal, prepareUpdate(scope, body, k))),
        deleteBead: effect((body, k) => store.deleteBead(principal, prepareDelete(scope, body, k))),
        createLink: link("createLink"),
        updateLink: link("updateLink"),
        deleteLink: link("deleteLink"),
      };
      return guarded(() =>
        store.invokeCallable(
          principal,
          {
            name,
            ...(key === undefined ? {} : { key }),
            identity,
            atomic: declaration.properties.atomic === true,
          },
          () => {
            const answer = implementation({ ...context, effects });
            return respond(answer, changed);
          },
        ),
      );
    },
  };
}
class ImplementationFailure extends Error {}
