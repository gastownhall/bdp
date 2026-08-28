import type { AbsoluteHttpUrl, TypeDescriptor } from "./index.js";
import { ProtocolArtifactValidationError } from "./read-values.js";

export interface TypeConformanceIndex {
  /** True when the declared Type is, or transitively conforms to, the required Type. */
  includes(declaredType: AbsoluteHttpUrl, requiredType: AbsoluteHttpUrl): boolean;
}

/** Indexes and validates one installed Type closure for repeated Read selection. */
export function createTypeConformanceIndex(
  descriptors: readonly TypeDescriptor[],
): TypeConformanceIndex {
  const byId = new Map<AbsoluteHttpUrl, TypeDescriptor>();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.id))
      throw new ProtocolArtifactValidationError(`duplicate Type Descriptor '${descriptor.id}'`);
    byId.set(descriptor.id, descriptor);
  }

  for (const descriptor of descriptors) {
    for (const parentId of descriptor.conformsTo) {
      const parent = byId.get(parentId);
      if (parent === undefined)
        throw new ProtocolArtifactValidationError(
          `Type Descriptor '${descriptor.id}' has missing parent '${parentId}'`,
        );
      if (parent.describes !== descriptor.describes)
        throw new ProtocolArtifactValidationError(
          `Type Descriptor '${descriptor.id}' crosses the ${descriptor.describes}/${parent.describes} boundary`,
        );
    }
  }

  const effectiveTypes = new Map<AbsoluteHttpUrl, ReadonlySet<AbsoluteHttpUrl>>();
  const visiting = new Set<AbsoluteHttpUrl>();
  const visit = (id: AbsoluteHttpUrl): ReadonlySet<AbsoluteHttpUrl> => {
    const known = effectiveTypes.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id))
      throw new ProtocolArtifactValidationError(
        `Type conformance graph contains a cycle at '${id}'`,
      );
    visiting.add(id);
    const result = new Set<AbsoluteHttpUrl>([id]);
    for (const parent of byId.get(id)?.conformsTo ?? []) {
      for (const effective of visit(parent)) result.add(effective);
    }
    visiting.delete(id);
    effectiveTypes.set(id, result);
    return result;
  };
  for (const id of byId.keys()) visit(id);

  return Object.freeze({
    includes(declaredType: AbsoluteHttpUrl, requiredType: AbsoluteHttpUrl): boolean {
      return (
        declaredType === requiredType ||
        effectiveTypes.get(declaredType)?.has(requiredType) === true
      );
    },
  });
}
