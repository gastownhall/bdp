export class SchemaMarkdownError extends Error {
  code: string;
  location: string;
  constructor(code: string, location: string, message: string);
}
export function renderSchema(schema: unknown, options?: { title?: string }): string;
export function parseSchema(markdown: string): unknown;
export function definitionAnchor(name: string): string;
export const formatVersion: "0.6";
export const dialect: "https://json-schema.org/draft/2020-12/schema";
