import type { AbsoluteHttpUrl, TypeDescriptor } from "./index.js";
import { ProtocolArtifactValidationError } from "./read-values.js";

export interface TypeConformanceIndex {
  /** True when the declared Type is, or transitively conforms to, the required Type. */
  includes(declaredType: AbsoluteHttpUrl, requiredType: AbsoluteHttpUrl): boolean;
}

/** Factory result with measured, immutable administrative work counters. */
export interface MeasuredTypeConformanceIndex extends TypeConformanceIndex {
  readonly statistics: TypeConformanceStatistics;
}

/** Optional administrative bounds; ordinary Read callers add no hidden limits. */
export interface TypeConformanceLimits {
  readonly nodes: number;
  readonly edges: number;
  readonly depth: number;
  readonly memberships: number;
  readonly unionAttempts: number;
}

export interface TypeConformanceStatistics {
  readonly nodes: number;
  readonly edges: number;
  /** Longest parent path in nodes, independent of descriptor input order. */
  readonly depth: number;
  readonly memberships: number;
  /** Every attempted parent-set insertion, including repeated diamond ancestors. */
  readonly unionAttempts: number;
}

/** Indexes and validates one installed Type closure for repeated Read selection. */
export function createTypeConformanceIndex(
  descriptors: readonly TypeDescriptor[],
  inputLimits?: TypeConformanceLimits,
): MeasuredTypeConformanceIndex {
  const counts = { nodes: 0, edges: 0, depth: 0, memberships: 0, unionAttempts: 0 };
  const limits = inputLimits === undefined ? undefined : { ...inputLimits };
  if (limits !== undefined) {
    for (const key of Object.keys(counts) as (keyof TypeConformanceLimits)[]) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 0)
        throw new TypeError(`invalid Type conformance ${key} limit`);
    }
  }
  const charge = (key: keyof TypeConformanceLimits): void => {
    if (limits !== undefined && counts[key] >= limits[key])
      throw new ProtocolArtifactValidationError(`Type conformance ${key} limit exceeded`);
    counts[key]++;
  };
  const checkDepth = (depth: number): void => {
    if (limits !== undefined && depth > limits.depth)
      throw new ProtocolArtifactValidationError("Type conformance depth limit exceeded");
    counts.depth = Math.max(counts.depth, depth);
  };
  const byId = new Map<AbsoluteHttpUrl, TypeDescriptor>();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.id))
      throw new ProtocolArtifactValidationError(`duplicate Type Descriptor '${descriptor.id}'`);
    charge("nodes");
    byId.set(descriptor.id, descriptor);
  }

  for (const descriptor of descriptors) {
    for (const parentId of descriptor.conformsTo) {
      charge("edges");
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
  const depths = new Map<AbsoluteHttpUrl, number>();
  const visiting = new Set<AbsoluteHttpUrl>();
  interface Frame {
    readonly id: AbsoluteHttpUrl;
    readonly parents: readonly AbsoluteHttpUrl[];
    next: number;
  }
  const frames: Frame[] = [];
  const push = (id: AbsoluteHttpUrl): void => {
    checkDepth(frames.length + 1);
    visiting.add(id);
    frames.push({ id, parents: byId.get(id)?.conformsTo ?? [], next: 0 });
  };
  for (const id of byId.keys()) {
    if (effectiveTypes.has(id)) continue;
    push(id);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) throw new Error("missing Type conformance frame");
      const parent = frame.parents[frame.next];
      if (parent !== undefined) {
        frame.next++;
        if (visiting.has(parent))
          throw new ProtocolArtifactValidationError(
            `Type conformance graph contains a cycle at '${parent}'`,
          );
        if (!effectiveTypes.has(parent)) push(parent);
        continue;
      }
      let depth = 1;
      for (const parent of frame.parents) depth = Math.max(depth, 1 + (depths.get(parent) ?? 0));
      checkDepth(depth);
      charge("memberships");
      const result = new Set<AbsoluteHttpUrl>([frame.id]);
      for (const parent of frame.parents) {
        const inherited = effectiveTypes.get(parent);
        if (inherited === undefined) throw new Error("missing parent Type conformance set");
        for (const effective of inherited) {
          charge("unionAttempts");
          if (!result.has(effective)) {
            charge("memberships");
            result.add(effective);
          }
        }
      }
      visiting.delete(frame.id);
      effectiveTypes.set(frame.id, result);
      depths.set(frame.id, depth);
      frames.pop();
    }
  }

  return Object.freeze({
    statistics: Object.freeze(counts),
    includes(declaredType: AbsoluteHttpUrl, requiredType: AbsoluteHttpUrl): boolean {
      return (
        declaredType === requiredType ||
        effectiveTypes.get(declaredType)?.has(requiredType) === true
      );
    },
  });
}
