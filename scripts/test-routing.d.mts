export type Lane = "artifact" | "current" | "legacy" | "shared";
export type ExecutableLane = Exclude<Lane, "shared">;
export type Runner = "vitest" | "node" | "python";
export interface TestEntry {
  readonly path: string;
  readonly lane: Lane;
  readonly runner: Runner;
  readonly reason: string;
}
export interface TestManifest {
  readonly status: "SHADOW_ONLY";
  readonly candidateBase: string;
  readonly scope: string;
  readonly tests: readonly TestEntry[];
}
export const root: string;
export const lanes: readonly Lane[];
export const runners: readonly Runner[];
export function inferredRunner(path: string): Runner | undefined;
export function isTestPath(path: string): boolean;
export function discoveredTests(): string[];
export function readManifest(): TestManifest;
export function validateManifest(manifest: TestManifest, paths: readonly string[]): TestManifest;
export function routeEntries(
  lane: ExecutableLane,
  manifest?: TestManifest,
  paths?: readonly string[],
): TestEntry[];
export function routeFiles(lane: ExecutableLane, runner: Runner): string[];
