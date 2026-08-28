import type { TypeDescriptor, TypeSummary } from "./index.js";

export const REFERENCE_BEAD_TYPES = [
  ["https://work.example/types/tracked-item", "Tracked Item"],
  ["https://work.example/types/work-item", "Work Item"],
  ["https://work.example/types/task", "Task"],
  ["https://work.example/types/bug", "Bug"],
  ["https://work.example/types/feature", "Feature"],
  ["https://work.example/types/chore", "Chore"],
  ["https://work.example/types/epic", "Epic"],
  ["https://work.example/types/decision", "Decision"],
] as const;

export const REFERENCE_BLOCKING_LINK_TYPE_ID = "https://work.example/types/blocks";

export const REFERENCE_LINK_TYPES = [
  ["https://work.example/types/relationship", "Relationship"],
  ["https://work.example/types/dependency", "Dependency"],
  [REFERENCE_BLOCKING_LINK_TYPE_ID, "Blocks"],
  ["https://work.example/types/relates", "Relates"],
] as const;

export const REFERENCE_TYPE_SUMMARIES: readonly TypeSummary[] = [
  ...REFERENCE_BEAD_TYPES.map(([id, name]) => ({ id, name, describes: "bead" as const })),
  ...REFERENCE_LINK_TYPES.map(([id, name]) => ({ id, name, describes: "link" as const })),
];

export const REFERENCE_TYPE_DESCRIPTORS: readonly TypeDescriptor[] = REFERENCE_TYPE_SUMMARIES.map(
  (summary): TypeDescriptor =>
    summary.describes === "link"
      ? {
          id: summary.id,
          name: summary.name,
          describes: "link",
          conformsTo:
            summary.id === REFERENCE_BLOCKING_LINK_TYPE_ID
              ? ["https://work.example/types/dependency"]
              : summary.id === "https://work.example/types/dependency"
                ? ["https://work.example/types/relationship"]
                : [],
          source: { conformsTo: [] },
          target: { conformsTo: [] },
        }
      : {
          id: summary.id,
          name: summary.name,
          describes: "bead",
          conformsTo:
            summary.id === "https://work.example/types/work-item"
              ? ["https://work.example/types/tracked-item"]
              : summary.id !== "https://work.example/types/tracked-item" &&
                  summary.id !== "https://work.example/types/decision"
                ? ["https://work.example/types/work-item"]
                : [],
        },
);
