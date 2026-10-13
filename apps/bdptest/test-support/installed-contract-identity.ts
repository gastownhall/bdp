/** Decode the existing versioned identity; never recompute installed contracts. */
export function installedContractsDigest(identity: unknown): string {
  if (typeof identity !== "string" || !/^development-schema5-[a-f0-9]{64}$/.test(identity))
    throw Error("unsupported installed contract identity");
  return identity.slice("development-schema5-".length);
}
