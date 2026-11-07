import {
  HISTORICAL_UPDATE_MEDIA,
  type AbsoluteHttpUrl,
  isUnicodeScalarString,
  parseCanonicalScope,
  parseRetainedWriteDirectory,
  parseRetainedWriteDiscovery,
  parseRetainedWriteInput,
  parseHistoricalUpdateRequest,
  readHistoricalUpdateCapability,
  RETAINED_V01_MEDIA_TYPE,
  RETAINED_V01_SPECIFICATION,
  type RetainedWriteDirectory,
  type RetainedWriteOperation,
  type RetainedWriteDiscovery,
} from "@bdp/protocol";

export interface RetainedWriteDocument {
  readonly contentType: string;
  readonly bodyText: string;
}
export interface RetainedWriteBindingOptions {
  /** Owning Scope established by the caller's verified navigation. */
  readonly scope: string;
  readonly discovery: RetainedWriteDocument;
  /** Document fetched from discovery.operations in that same navigation flow. */
  readonly directory: RetainedWriteDocument;
  /** Explicit local bounds, not invented server-advertised limits. */
  readonly maximumDocumentBytes: number;
  readonly maximumRequestBodyBytes: number;
}
export interface PreparedRetainedWrite {
  readonly specification: typeof RETAINED_V01_SPECIFICATION;
  readonly scope: AbsoluteHttpUrl;
  readonly operation: RetainedWriteOperation;
  readonly url: AbsoluteHttpUrl;
  readonly method: "POST";
  readonly headers: Readonly<{
    accept: typeof RETAINED_V01_MEDIA_TYPE | typeof HISTORICAL_UPDATE_MEDIA;
    "content-type": typeof RETAINED_V01_MEDIA_TYPE | typeof HISTORICAL_UPDATE_MEDIA;
    "idempotency-key": string;
  }>;
  readonly bodyText: string;
}

/** Base v0.1 preparation seam. No network, CLI parsing, key generation, file
 * persistence, Type defaults, ordinal resolution or optional feature selection.
 * The caller must save this complete invocation before submission and reuse it
 * without rediscovery/rebinding. Authentication belongs to each delivery attempt.
 */
export class RetainedWriteBinding {
  readonly #scope: AbsoluteHttpUrl;
  readonly #directory: RetainedWriteDirectory;
  readonly #discovery: RetainedWriteDiscovery;
  readonly #maximumRequestBodyBytes: number;

  constructor(options: RetainedWriteBindingOptions) {
    // Capture mutable caller input once, before parsing any document.
    const {
      scope,
      discovery: { contentType: discoveryType, bodyText: discoveryText },
      directory: { contentType: directoryType, bodyText: directoryText },
      maximumDocumentBytes,
      maximumRequestBodyBytes,
    } = options;
    positiveLimit(maximumDocumentBytes);
    positiveLimit(maximumRequestBodyBytes);
    selectedMedia(discoveryType);
    selectedMedia(directoryType);
    boundedText(discoveryText, maximumDocumentBytes);
    boundedText(directoryText, maximumDocumentBytes);
    this.#scope = parseCanonicalScope(scope);
    const discovery = parseRetainedWriteDiscovery(discoveryText);
    this.#discovery = discovery;
    if (discovery.scope !== this.#scope)
      throw new TypeError("retained Write discovery does not match the verified owning Scope");
    this.#directory = parseRetainedWriteDirectory(directoryText, discovery);
    this.#maximumRequestBodyBytes = maximumRequestBodyBytes;
    Object.freeze(this);
  }

  get historicalUpdateSupported(): boolean {
    return readHistoricalUpdateCapability(this.#discovery) !== undefined;
  }

  /** Whether discovery advertises `aliases`; the directory has been held to the same answer. */
  get aliasesSupported(): boolean {
    return this.#discovery.aliases !== undefined;
  }

  prepareHistoricalUpdate(bodyText: string, idempotencyKey: string): PreparedRetainedWrite {
    if (!this.historicalUpdateSupported)
      throw new TypeError("historical-update1 is not advertised by this provider");
    return this.#prepare("updateBead", bodyText, idempotencyKey, HISTORICAL_UPDATE_MEDIA);
  }

  prepare(
    operation: RetainedWriteOperation,
    bodyText: string,
    idempotencyKey: string,
  ): PreparedRetainedWrite {
    return this.#prepare(operation, bodyText, idempotencyKey, RETAINED_V01_MEDIA_TYPE);
  }

  #prepare(
    operation: RetainedWriteOperation,
    bodyText: string,
    idempotencyKey: string,
    selected: typeof RETAINED_V01_MEDIA_TYPE | typeof HISTORICAL_UPDATE_MEDIA,
  ): PreparedRetainedWrite {
    const url = this.#directory[operation];
    if (url === undefined)
      throw new TypeError(`${operation} is not served: this provider does not advertise aliases`);
    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 256 ||
      /[^A-Za-z0-9_-]/.test(idempotencyKey)
    )
      throw new TypeError("retained Write requires one valid Idempotency-Key");
    boundedText(bodyText, this.#maximumRequestBodyBytes);
    if (selected === HISTORICAL_UPDATE_MEDIA) parseHistoricalUpdateRequest(bodyText);
    else parseRetainedWriteInput(operation, bodyText);
    return Object.freeze({
      specification: RETAINED_V01_SPECIFICATION,
      scope: this.#scope,
      operation,
      url,
      method: "POST",
      headers: Object.freeze({
        accept: selected,
        "content-type": selected,
        "idempotency-key": idempotencyKey,
      }),
      bodyText,
    });
  }
}

function positiveLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError("retained Write byte bounds must be positive safe integers");
}
function selectedMedia(value: string): void {
  if (
    typeof value !== "string" ||
    value.split(";", 1)[0]?.trim().toLowerCase() !== RETAINED_V01_MEDIA_TYPE
  )
    throw new TypeError("retained Write requires the selected v0.1 JSON media type");
}
function boundedText(value: string, maximumBytes: number): void {
  if (typeof value !== "string" || !isUnicodeScalarString(value))
    throw new TypeError("retained Write requires Unicode scalar JSON text");
  if (value.length > maximumBytes || new TextEncoder().encode(value).byteLength > maximumBytes)
    throw new RangeError("retained Write JSON exceeds the configured byte bound");
}
