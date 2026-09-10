/** A malformed protocol artifact at a typed parsing boundary. */
export class ProtocolArtifactValidationError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ProtocolArtifactValidationError";
  }
}
