/** Pure singleton Reference resolution, within one captured owner turn.
 * The caller classifies canonical identities/namespace membership before lookup.
 * Undefined means direct URI, null an admitted missing alias, string its target.
 * Lookup must not read Resource bodies, filter by Authorization View, or fetch.
 */
import type { EndpointReference } from "./contract.js";

export interface AliasWitness {
  readonly locator: string;
  readonly target: string | null;
}
export type ResolvedAliasReference =
  | { readonly kind: "value"; readonly reference: EndpointReference }
  | { readonly kind: "missing-alias"; readonly locator: string; readonly revision?: string };
export interface AliasResolution {
  readonly references: readonly ResolvedAliasReference[];
  /** Initial durable metadata, unchanged by new retry-time comparison locators.
   * Persist only for an unknown key; a retry never replaces retained bytes. */
  readonly originalWitnesses: readonly AliasWitness[];
}
function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value) throw new TypeError("invalid alias-resolution fact");
}
export function resolveAliasReferences(
  references: readonly EndpointReference[],
  lookup: (locator: string) => string | null | undefined,
  prior?: readonly AliasWitness[],
): AliasResolution {
  const original = new Map<string, string | null>();
  const saved: AliasWitness[] = [];
  for (const witness of prior ?? []) {
    nonempty(witness.locator);
    if (witness.target !== null) nonempty(witness.target);
    if (original.has(witness.locator)) throw new TypeError("duplicate original alias witness");
    original.set(witness.locator, witness.target);
    saved.push(Object.freeze({ locator: witness.locator, target: witness.target }));
  }
  const current = new Map<string, string | null | undefined>();
  const initial = new Map<string, string | null>();
  const resolved = references.map((reference): ResolvedAliasReference => {
    const uri = typeof reference === "string" ? reference : reference.uri;
    nonempty(uri);
    const pin = typeof reference === "string" ? undefined : reference.revision;
    if (typeof reference !== "string") nonempty(pin);
    let target: string | null | undefined;
    if (original.has(uri)) target = original.get(uri);
    else {
      if (!current.has(uri)) current.set(uri, lookup(uri));
      target = current.get(uri);
      if (target !== null && target !== undefined) nonempty(target);
      if (prior === undefined && target !== undefined) initial.set(uri, target);
    }
    if (target === null)
      return Object.freeze({
        kind: "missing-alias",
        locator: uri,
        ...(pin === undefined ? {} : { revision: pin }),
      });
    const value = target ?? uri;
    return Object.freeze({
      kind: "value",
      reference: pin === undefined ? value : Object.freeze({ uri: value, revision: pin }),
    });
  });
  const witnesses =
    prior === undefined
      ? [...initial]
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([locator, target]) => Object.freeze({ locator, target }))
      : saved;
  return Object.freeze({
    references: Object.freeze(resolved),
    originalWitnesses: Object.freeze(witnesses),
  });
}
