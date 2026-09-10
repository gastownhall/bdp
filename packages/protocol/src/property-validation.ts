/** Internal installed-validator receiving contract, not a BDP wire extension.
 * An installer must separately bound compiler work and speculative error storage.
 */
export interface PropertyValidationDiagnostic {
  readonly schemaLocation: string;
  /** JSON Pointer within properties; the empty string names its root. */
  readonly instanceLocation: string;
  readonly message: string;
}
export interface PropertyDiagnosticEmitter {
  /** Emit only a confirmed final failure, never a speculative branch error.
   * The receiver supplies the effective Type ID before measuring wire bytes.
   * False proves this additional entry was omitted: stop emitting immediately.
   * This synchronous emitter must not escape the validator invocation.
   */
  emit(diagnostic: PropertyValidationDiagnostic): boolean;
}
export type PropertyValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly diagnosticsComplete: boolean };
/** Valid results emit nothing. Invalid results emit at least one confirmed
 * diagnostic; diagnosticsComplete is false exactly when emit returned false.
 * Do not call a validator that eagerly builds an unbounded error array here.
 */
export type PropertyValidator = (
  properties: Readonly<Record<string, unknown>>,
  diagnostics: PropertyDiagnosticEmitter,
) => PropertyValidationResult;
