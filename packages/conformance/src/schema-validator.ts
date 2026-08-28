import {
  Ajv2020,
  type ErrorObject,
  type JSONSchemaType,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { isJsonSchemaUri } from "@bdp/protocol";

export interface SchemaValidationFailure {
  readonly instancePath: string;
  readonly message: string;
}

export interface SchemaValidator {
  resolve(schemaRef: string): void;
  validate(schemaRef: string, value: unknown): readonly SchemaValidationFailure[];
}

export class SchemaValidatorError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "SchemaValidatorError";
  }
}

/** Validates against the repository's offline canonical schema bundle. */
export function createJsonSchemaValidator(
  bundle: JSONSchemaType<unknown> | Record<string, unknown>,
): SchemaValidator {
  const ajv = new Ajv2020({ allErrors: false, strict: true });
  ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  const root = bundle as Record<string, unknown>;
  if (typeof root.$id !== "string" || root.$id.length === 0)
    throw new SchemaValidatorError("schema bundle must declare a non-empty $id");
  const schemaId = root.$id;
  ajv.addSchema(bundle, schemaId);
  const resolve = (schemaRef: string): ValidateFunction => {
    const ref = schemaRef.startsWith("#") ? `${schemaId}${schemaRef}` : schemaRef;
    let validator: ValidateFunction | undefined;
    try {
      validator = ajv.getSchema(ref);
    } catch (error) {
      throw new SchemaValidatorError("schema reference could not be compiled", { cause: error });
    }
    if (validator === undefined)
      throw new SchemaValidatorError(`unknown schema reference '${schemaRef}'`);
    return validator;
  };
  return {
    resolve(schemaRef) {
      resolve(schemaRef);
    },
    validate(schemaRef, value) {
      const validator = resolve(schemaRef);
      if (validator(value)) return [];
      return (validator.errors ?? []).map(formatAjvError);
    },
  };
}

function formatAjvError(error: ErrorObject): SchemaValidationFailure {
  return { instancePath: error.instancePath, message: error.message ?? error.keyword };
}
