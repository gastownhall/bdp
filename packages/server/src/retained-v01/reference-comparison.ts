/** Captured singleton comparison only. The owner supplies lookup inside its
 * transaction, before fresh liveness/guard/bounds checks. No body reads or writes.
 */
import { type SemanticValue, UNBOUND_SEMANTIC_REFERENCE } from "../semantic-identity.js";
import {
  type AliasWitness,
  type ResolvedAliasReference,
  resolveAliasReferences,
} from "./alias-witness.js";
import type { EndpointReference } from "./contract.js";

export type ReferenceSlot = "bead" | "source" | "target";
type Slots<T> = Readonly<Partial<Record<ReferenceSlot, T>>>;
export type SemanticReferenceSlots = Slots<SemanticValue>;
interface InvocationIdentity {
  readonly identity: string;
}
interface CapturedComparison {
  readonly names: readonly ReferenceSlot[];
  readonly references: readonly EndpointReference[];
  readonly identityFor: (references: Slots<SemanticValue>) => string;
}
export interface ReferenceComparison {
  readonly identity: string;
  readonly references: Slots<ResolvedAliasReference>;
  readonly originalWitnesses: readonly AliasWitness[];
}
const capturedComparisons = new WeakMap<InvocationIdentity, CapturedComparison>();
const slotOrder: readonly ReferenceSlot[] = ["bead", "source", "target"];

function snapshot(reference: EndpointReference): EndpointReference {
  if (typeof reference === "string") return reference;
  return Object.freeze({ uri: reference.uri, revision: reference.revision });
}
function semantic(reference: ResolvedAliasReference): SemanticValue {
  if (reference.kind === "value") return reference.reference;
  // A private unbound node cannot be manufactured by a JSON Reference. Preserve
  // the distinct missing locator and whole pin, rather than collapsing misses.
  const value: SemanticValue[] = [
    UNBOUND_SEMANTIC_REFERENCE,
    reference.locator,
    ...(reference.revision === undefined ? [] : [reference.revision]),
  ];
  return Object.freeze(value);
}
function semanticSlots(
  names: readonly ReferenceSlot[],
  references: readonly ResolvedAliasReference[],
): Slots<SemanticValue> {
  const slots: Partial<Record<ReferenceSlot, SemanticValue>> = {};
  names.forEach((name, index) => {
    const reference = references[index];
    if (!reference) throw new TypeError("missing captured Reference slot");
    slots[name] = semantic(reference);
  });
  return Object.freeze(slots);
}

/** Admission factories register their immutable branded result and an encoder
 * over their own lossless normalized input. The store never decodes identity.
 * Only these selected fields can resolve; Type, Link subject and data cannot.
 */
export function captureReferenceComparison(
  invocation: InvocationIdentity,
  slots: Slots<EndpointReference>,
  identityFor: (references: Slots<SemanticValue>) => string,
): void {
  if (!Object.isFrozen(invocation) || !invocation.identity || capturedComparisons.has(invocation))
    throw new TypeError("immutable newly captured invocation required");
  if (Object.keys(slots).some((name) => !slotOrder.includes(name as ReferenceSlot)))
    throw new TypeError("unsupported alias Reference slot");
  const names = Object.freeze(slotOrder.filter((name) => Object.hasOwn(slots, name)));
  const references = Object.freeze(
    names.map((name) => {
      const reference = slots[name];
      if (reference === undefined) throw new TypeError("undefined captured Reference slot");
      return snapshot(reference);
    }),
  );
  const direct = resolveAliasReferences(references, () => undefined);
  if (identityFor(semanticSlots(names, direct.references)) !== invocation.identity)
    throw new TypeError("captured comparison changed original semantic identity");
  capturedComparisons.set(invocation, Object.freeze({ names, references, identityFor }));
}

export function compareCapturedReferences(
  invocation: InvocationIdentity,
  lookup: (locator: string) => string | null | undefined,
  prior?: readonly AliasWitness[],
  fixedSlots: readonly ReferenceSlot[] = [],
): ReferenceComparison {
  const captured = capturedComparisons.get(invocation);
  if (!captured) throw new TypeError("uncaptured invocation comparison");
  // Batch creation handles are fixed lexical slots, never alias lookups. Resolve
  // only ordinary Reference slots; a literal equal-looking URL is still ordinary.
  const indexes = captured.names
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !fixedSlots.includes(name));
  const resolution = resolveAliasReferences(
    indexes.map(({ index }) => captured.references[index]!),
    lookup,
    prior,
  );
  const resolved: ResolvedAliasReference[] = captured.references.map((reference) => ({
    kind: "value" as const,
    reference,
  }));
  indexes.forEach(({ index }, offset) => {
    resolved[index] = resolution.references[offset]!;
  });
  const references: Partial<Record<ReferenceSlot, ResolvedAliasReference>> = {};
  captured.names.forEach((name, index) => {
    const reference = resolved[index];
    if (!reference) throw new TypeError("missing resolved Reference slot");
    references[name] = reference;
  });
  return Object.freeze({
    identity: captured.identityFor(semanticSlots(captured.names, resolved)),
    references: Object.freeze(references),
    originalWitnesses: resolution.originalWitnesses,
  });
}
