/** Iterative semantic equality for admitted dense JSON/plain records with finite
 * native numbers. Not a validator for cycles, accessors or arbitrary JS values. */
export function jsonValueEqual(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  while (pending.length) {
    const pair = pending.pop();
    if (!pair) break;
    const [a, b] = pair;
    if (a === b) continue;
    if (
      !a ||
      !b ||
      typeof a !== "object" ||
      typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)
    )
      return false;
    const aa = a as Record<string, unknown>;
    const bb = b as Record<string, unknown>;
    const keys = Object.keys(aa);
    if (keys.length !== Object.keys(bb).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(bb, key)) return false;
      pending.push([aa[key], bb[key]]);
    }
  }
  return true;
}
