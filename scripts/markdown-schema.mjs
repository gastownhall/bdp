const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const MARKER = "Format: markdown-json-schema/0.6";
const FENCE = String.fromCharCode(96).repeat(3);
const OWN = (o, k) => Object.hasOwn(o, k);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const singles = new Set([
  "items",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
]);
const arrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const maps = new Set(["$defs", "properties", "patternProperties", "dependentSchemas"]);
const strings = new Set([
  "$schema",
  "$id",
  "$ref",
  "$anchor",
  "$dynamicRef",
  "$dynamicAnchor",
  "$comment",
  "title",
  "description",
  "format",
  "pattern",
  "contentEncoding",
  "contentMediaType",
]);
const nonnegative = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
]);
const numbers = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);
const booleans = new Set(["uniqueItems", "readOnly", "writeOnly", "deprecated"]);
const types = new Set(["string", "number", "integer", "boolean", "null", "object", "array"]);
const words = {
  text: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
  null: "null",
  object: "object",
  array: "array",
};
const error = (code, location, message) => {
  throw new SchemaMarkdownError(code, location, message);
};
export class SchemaMarkdownError extends Error {
  constructor(code, location, message) {
    super(code + " at " + location + ": " + message);
    this.name = "SchemaMarkdownError";
    this.code = code;
    this.location = location;
  }
}

// Serialization preserves parsed JSON values, including negative zero. It does
// not preserve a source number's spelling, object-key order or whitespace.
function json(v, pretty = false, depth = 0) {
  if (depth > 128) error("E_LIMIT", "$", "JSON nesting exceeds128");
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) error("E_JSON", "$", "finite JSON number required");
    return Object.is(v, -0) ? "-0" : JSON.stringify(v);
  }
  if (
    typeof v !== "object" ||
    (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
  )
    error("E_JSON", "$", "parsed JSON values required");
  if (Object.getOwnPropertySymbols(v).length) error("E_JSON", "$", "symbol keys are not JSON");
  const list = Array.isArray(v)
    ? Array.from(v, (x) => json(x, pretty, depth + 1))
    : Object.keys(v).map(
        (k) => JSON.stringify(k) + (pretty ? ": " : ":") + json(v[k], pretty, depth + 1),
      );
  const pair = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  if (!list.length) return pair.join("");
  return pretty
    ? pair[0] +
        "\n" +
        list.map((x) => "  ".repeat(depth + 1) + x).join(",\n") +
        "\n" +
        "  ".repeat(depth) +
        pair[1]
    : pair[0] + list.join(",") + pair[1];
}
// Compare decimal values without expanding powers of ten. Native JSON parsing
// may round authored literals even when the resulting Number is finite.
function decimalValue(token) {
  const [, sign, integer, fraction = "", exponent = "0"] =
    /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  const digits = (integer + fraction).replace(/^0+/, "");
  if (!digits) return sign + "0";
  const coefficient = digits.replace(/0+$/, "");
  const power =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - coefficient.length);
  return sign + coefficient + "e" + power;
}
function exactNumber(token, location) {
  const number = Number(token);
  if (!Number.isFinite(number) || decimalValue(token) !== decimalValue(json(number)))
    error(
      "E_PRECISION",
      location,
      "number literal changes value in the parsed Number representation",
    );
}
function parseJSON(text, location) {
  let i = 0;
  const ws = () => {
    while (/\s/.test(text[i] || "") && i < text.length) i++;
  };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error("unterminated JSON string");
  }
  function value(depth = 0) {
    if (depth > 128) error("E_LIMIT", location, "JSON nesting exceeds128");
    ws();
    if (text[i] === '"') {
      string();
      return;
    }
    if (text[i] === "{") {
      i++;
      ws();
      const seen = new Set();
      if (text[i] === "}") {
        i++;
        return;
      }
      while (i < text.length) {
        if (text[i] !== '"') throw new Error("object key required");
        const key = string();
        if (seen.has(key))
          error("E_DUPLICATE", location, "duplicate decoded JSON key " + json(key));
        seen.add(key);
        ws();
        if (text[i++] !== ":") throw new Error("colon required");
        value(depth + 1);
        ws();
        const ch = text[i++];
        if (ch === "}") return;
        if (ch !== ",") throw new Error("comma required");
        ws();
      }
      throw new Error("unterminated object");
    }
    if (text[i] === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      while (i < text.length) {
        value(depth + 1);
        ws();
        const ch = text[i++];
        if (ch === "]") return;
        if (ch !== ",") throw new Error("comma required");
      }
      throw new Error("unterminated array");
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
      text.slice(i),
    );
    if (!match) throw new Error("JSON value required");
    if (/^[-0-9]/.test(match[0])) exactNumber(match[0], location);
    i += match[0].length;
  }
  try {
    value();
    ws();
    if (i !== text.length) throw new Error("trailing JSON input");
    const result = JSON.parse(text);
    json(result);
    return result;
  } catch (e) {
    if (e instanceof SchemaMarkdownError) throw e;
    error("E_JSON", location, String(e.message));
  }
}
function validate(s, location = "$", depth = 0) {
  if (depth > 128) error("E_LIMIT", location, "schema nesting exceeds128");
  if (typeof s === "boolean") return;
  if (!object(s)) error("E_SCHEMA", location, "object or boolean schema required");
  for (const [k, v] of Object.entries(s)) {
    const at = location + "/" + k;
    if (singles.has(k)) validate(v, at, depth + 1);
    else if (arrays.has(k)) {
      if (!Array.isArray(v) || !v.length) error("E_SCHEMA", at, "nonempty schema array required");
      v.forEach((x, n) => {
        validate(x, at + "/" + n, depth + 1);
      });
    } else if (maps.has(k)) {
      if (!object(v)) error("E_SCHEMA", at, "schema map required");
      for (const [name, child] of Object.entries(v)) validate(child, at + "/" + name, depth + 1);
    } else if (strings.has(k)) {
      if (typeof v !== "string") error("E_SCHEMA", at, "string required");
      if (k === "$schema" && v !== DIALECT) error("E_DIALECT", at, "only Draft2020-12 is selected");
    } else if (k === "type") {
      const items = Array.isArray(v) ? v : [v];
      if (!items.length || items.some((x) => !types.has(x)) || new Set(items).size !== items.length)
        error("E_SCHEMA", at, "valid distinct JSON Schema types required");
    } else if (k === "required" || k === "dependentRequired") {
      const check = (x) => {
        if (
          !Array.isArray(x) ||
          x.some((n) => typeof n !== "string") ||
          new Set(x).size !== x.length
        )
          error("E_SCHEMA", at, "distinct string array required");
      };
      if (k === "required") check(v);
      else {
        if (!object(v)) error("E_SCHEMA", at, "dependency map required");
        Object.values(v).forEach(check);
      }
    } else if (nonnegative.has(k)) {
      if (!Number.isInteger(v) || v < 0) error("E_SCHEMA", at, "nonnegative integer required");
    } else if (numbers.has(k)) {
      if (typeof v !== "number" || !Number.isFinite(v) || (k === "multipleOf" && v <= 0))
        error("E_SCHEMA", at, "valid numeric bound required");
    } else if (booleans.has(k)) {
      if (typeof v !== "boolean") error("E_SCHEMA", at, "boolean required");
    } else if (k === "enum") {
      if (!Array.isArray(v) || !v.length) error("E_SCHEMA", at, "nonempty enum array required");
      const ordered = (x) =>
        Array.isArray(x)
          ? x.map(ordered)
          : object(x)
            ? Object.fromEntries(
                Object.keys(x)
                  .sort()
                  .map((key) => [key, ordered(x[key])]),
              )
            : typeof x === "number" && x === 0
              ? 0
              : x;
      if (new Set(v.map((x) => json(ordered(x)))).size !== v.length)
        error("E_SCHEMA", at, "duplicate enum values");
    } else if (k === "examples") {
      if (!Array.isArray(v)) error("E_SCHEMA", at, "examples array required");
    } else if (k === "$vocabulary") {
      if (!object(v) || Object.values(v).some((x) => typeof x !== "boolean"))
        error("E_SCHEMA", at, "vocabulary boolean map required");
    } else if (k !== "const" && k !== "default" && !k.startsWith("x-"))
      error("E_KEYWORD", at, "unsupported keyword");
    json(v);
  }
}
const cell = (s) => s.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
function row(values) {
  return "| " + values.map(cell).join(" | ") + " |";
}
function cells(line, location) {
  if (!line.startsWith("|") || !line.endsWith("|"))
    error("E_TABLE", location, "bounded table row required");
  const result = [];
  let value = "";
  for (let n = 1; n < line.length - 1; n++) {
    const ch = line[n];
    if (ch === "\\") {
      const next = line[++n];
      if (next !== "\\" && next !== "|")
        error("E_TABLE", location, "only escaped backslash or pipe in a cell");
      value += next;
    } else if (ch === "|") {
      result.push(value.trim());
      value = "";
    } else value += ch;
  }
  result.push(value.trim());
  return result;
}
function outer(text) {
  if (!text.startsWith("(")) return false;
  let level = 0,
    quote = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') quote = true;
    else if (c === "(") level++;
    else if (c === ")" && --level === 0) return i === text.length - 1;
  }
  return false;
}
function parseType(text, location, depth = 0, budget = { calls: 0 }) {
  if (text.length > 65536 || depth > 128 || ++budget.calls > 4096)
    error(
      "E_LIMIT",
      location,
      "Type expression exceeds65536 code units,128 recursive levels or4096 parse nodes",
    );
  // Refuse deep parentheses in one bounded pass before outer() rescans them.
  if (depth === 0) {
    let nesting = 0,
      quote = false,
      escaped = false;
    for (const ch of text) {
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quote = false;
      } else if (ch === '"') quote = true;
      else if (ch === "(" && ++nesting > 128)
        error("E_LIMIT", location, "Type expression exceeds128 parenthesis levels");
      else if (ch === ")") nesting--;
    }
  }
  text = text.trim();
  if (outer(text)) return parseType(text.slice(1, -1), location, depth + 1, budget);
  let level = 0,
    quote = false,
    escaped = false,
    start = 0;
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') quote = true;
    else if (c === "(") level++;
    else if (c === ")") {
      if (--level < 0) error("E_TYPE", location, "unbalanced parentheses");
    } else if (level === 0 && text.slice(i, i + 4) === " OR ") {
      parts.push(text.slice(start, i));
      start = i + 4;
      i += 3;
    }
  }
  if (quote || level) error("E_TYPE", location, "unbalanced Type expression");
  if (parts.length)
    return {
      anyOf: [...parts, text.slice(start)].map((p) => parseType(p, location, depth + 1, budget)),
    };
  if (text.startsWith("array of "))
    return { type: "array", items: parseType(text.slice(9), location, depth + 1, budget) };
  if (text.startsWith("ref ")) {
    const value = parseJSON(text.slice(4), location);
    if (typeof value !== "string") error("E_TYPE", location, "reference string required");
    return { $ref: value };
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "any") return {};
  if (text === "Url") return { type: "string", format: "uri" };
  if (OWN(words, text)) return { type: words[text] };
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(text) && text !== "schema")
    return { $ref: "#/$defs/" + text };
  error("E_TYPE", location, "invalid Type expression");
}
function typeText(s) {
  if (typeof s === "boolean") return String(s);
  const keys = Object.keys(s);
  if (!keys.length) return "any";
  if (keys.length === 1 && typeof s.$ref === "string") return "ref " + json(s.$ref);
  if (keys.length === 1 && typeof s.type === "string" && types.has(s.type))
    return s.type === "string" ? "text" : s.type;
  if (keys.length === 2 && s.type === "string" && s.format === "uri") return "Url";
  if (keys.length === 2 && s.type === "array" && OWN(s, "items")) {
    const item = typeText(s.items);
    if (item !== null) return "array of (" + item + ")";
  }
  if (keys.length === 1 && Array.isArray(s.anyOf) && s.anyOf.length >= 2) {
    const choices = s.anyOf.map(typeText);
    if (choices.every((x) => x !== null)) return choices.map((x) => "(" + x + ")").join(" OR ");
  }
  return null;
}
function inlineType(s) {
  const text = typeText(s);
  if (text === null) return null;
  try {
    parseType(text, "Type");
  } catch (e) {
    if (e instanceof SchemaMarkdownError && e.code === "E_LIMIT") return null;
    throw e;
  }
  return text;
}
export function definitionAnchor(name) {
  if (typeof name !== "string") error("E_NAME", "$defs", "definition name must be a string");
  return "schema-def-" + Buffer.from(JSON.stringify(name), "utf8").toString("base64url");
}
function renderNode(s, name, root) {
  const result = [
    root ? '<a id="schema-root"></a>' : '<a id="' + definitionAnchor(name) + '"></a>',
    root ? "## Root schema" : "## Schema: " + json(name),
    "",
    "Value: " + (typeof s === "boolean" ? String(s) : "object"),
    "",
  ];
  if (typeof s === "boolean") return result;
  if (root && OWN(s, "$defs")) result.push("Definitions: present", "");
  if (typeof s.additionalProperties === "boolean")
    result.push("Other fields: " + (s.additionalProperties ? "allowed" : "not allowed"), "");
  if (OWN(s, "properties") && OWN(s, "required"))
    result.push("Required order: " + json(s.required), "");
  const keywords = Object.entries(s).filter(
    ([k]) =>
      k !== "properties" &&
      !(root && k === "$defs") &&
      !(OWN(s, "properties") && k === "required") &&
      !singles.has(k) &&
      !arrays.has(k) &&
      !maps.has(k),
  );
  if (keywords.length) {
    result.push("### Keywords", "", "| Keyword | JSON value |", "| --- | --- |");
    for (const [k, v] of keywords.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      result.push(row([/^[A-Za-z$][A-Za-z0-9_$-]*$/.test(k) ? k : json(k), json(v)]));
    result.push("");
  }
  const advanced = Object.fromEntries(
    Object.entries(s).filter(
      ([k]) =>
        (singles.has(k) && !(k === "additionalProperties" && typeof s[k] === "boolean")) ||
        arrays.has(k) ||
        (maps.has(k) && k !== "properties" && !(root && k === "$defs")),
    ),
  );
  if (OWN(s, "properties")) {
    result.push(
      "### Properties",
      "",
      "| Name | Type | Required | Defined by | Meaning |",
      "| --- | --- | --- | --- | --- |",
    );
    const complex = [];
    for (const name of Object.keys(s.properties).sort()) {
      const property = s.properties[name];
      const bare =
        typeof property === "boolean"
          ? property
          : Object.fromEntries(
              Object.entries(property).filter(([k]) => k !== "description" && k !== "x-definedBy"),
            );
      const type = inlineType(bare);
      if (type === null) complex.push([name, bare]);
      result.push(
        row([
          json(name),
          type ?? "schema",
          (s.required ?? []).includes(name) ? "yes" : "no",
          object(property) && OWN(property, "x-definedBy") ? json(property["x-definedBy"]) : "—",
          object(property) && OWN(property, "description") ? json(property.description) : "—",
        ]),
      );
    }
    if (complex.length) advanced.properties = Object.fromEntries(complex);
    result.push("");
  }
  if (Object.keys(advanced).length)
    result.push("### Advanced", "", FENCE + "json-schema", json(advanced, true), FENCE, "");
  return result;
}
export function renderSchema(schema, options = {}) {
  json(schema);
  validate(schema);
  if (
    !object(options) ||
    Object.keys(options).some((k) => k !== "title") ||
    (OWN(options, "title") && typeof options.title !== "string")
  )
    error("E_OPTIONS", "$", "only optional string display title is admitted");
  const display =
    options.title ??
    (object(schema) && typeof schema.title === "string" ? schema.title : "JSON Schema");
  const lines = ["# " + json(display), "", MARKER, "", ...renderNode(schema, "", true)];
  if (object(schema) && OWN(schema, "$defs"))
    for (const name of Object.keys(schema.$defs).sort())
      lines.push(...renderNode(schema.$defs[name], name, false));
  const output = lines.join("\n").replace(/\n+$/, "") + "\n";
  if (Buffer.byteLength(output) > 16 * 1024 * 1024) error("E_LIMIT", "$", "Markdown exceeds16MiB");
  return output;
}
function parseNode(lines, root, location) {
  const state = {
    value: undefined,
    definitions: false,
    required: undefined,
    additional: undefined,
    keywords: undefined,
    properties: undefined,
    advanced: undefined,
  };
  let i = 0;
  const loc = () => location + ":" + (i + 1);
  while (i < lines.length) {
    const line = lines[i++];
    if (!line) continue;
    if (line.startsWith("Value: ")) {
      if (state.value !== undefined || !["object", "true", "false"].includes(line.slice(7)))
        error("E_DOCUMENT", loc(), "duplicate or invalid schema value");
      state.value = line.slice(7);
      continue;
    }
    if (line.startsWith("Other fields: ")) {
      if (state.additional !== undefined || !["allowed", "not allowed"].includes(line.slice(14)))
        error("E_DOCUMENT", loc(), "invalid or duplicate Other fields setting");
      state.additional = line.slice(14) === "allowed";
      continue;
    }
    if (line === "Definitions: present") {
      if (!root || state.definitions)
        error("E_DOCUMENT", loc(), "root-only definition marker duplicated");
      state.definitions = true;
      continue;
    }
    if (line.startsWith("Required order: ")) {
      if (state.required !== undefined) error("E_DUPLICATE", loc(), "required order duplicated");
      state.required = parseJSON(line.slice(16), loc());
      continue;
    }
    if (line === "### Keywords" || line === "### Properties") {
      const properties = line === "### Properties",
        key = properties ? "properties" : "keywords";
      if (state[key] !== undefined) error("E_DUPLICATE", loc(), "table duplicated");
      while (lines[i] === "") i++;
      const expected = properties
        ? ["Name", "Type", "Required", "Defined by", "Meaning"]
        : ["Keyword", "JSON value"];
      if (json(cells(lines[i++] || "", loc())) !== json(expected))
        error("E_TABLE", loc(), "wrong table header");
      const separator = cells(lines[i++] || "", loc());
      if (separator.length !== expected.length || separator.some((x) => !/^---+$/.test(x)))
        error("E_TABLE", loc(), "wrong separator");
      const entries = [],
        seen = new Set();
      while ((lines[i] || "").startsWith("|")) {
        const row = cells(lines[i++], loc());
        if (row.length !== expected.length) error("E_TABLE", loc(), "wrong column count");
        const name = properties || row[0].startsWith('"') ? parseJSON(row[0], loc()) : row[0];
        if (typeof name !== "string") error("E_NAME", loc(), "JSON-string property name required");
        if (seen.has(name)) error("E_DUPLICATE", loc(), "duplicate table name");
        seen.add(name);
        entries.push(properties ? [name, row.slice(1)] : [name, parseJSON(row[1], loc())]);
      }
      state[key] = Object.fromEntries(entries);
      continue;
    }
    if (line === "### Advanced") {
      if (state.advanced !== undefined) error("E_DUPLICATE", loc(), "advanced block duplicated");
      while (lines[i] === "") i++;
      if (lines[i++] !== FENCE + "json-schema")
        error("E_DOCUMENT", loc(), "json-schema fence required");
      const block = [];
      while (i < lines.length && lines[i] !== FENCE) block.push(lines[i++]);
      if (lines[i++] !== FENCE) error("E_DOCUMENT", loc(), "unclosed advanced fence");
      state.advanced = parseJSON(block.join("\n"), loc());
      continue;
    }
    error("E_DOCUMENT", loc(), "unrecognized or executable prose");
  }
  if (state.value === undefined) error("E_DOCUMENT", location, "schema Value marker required");
  if (state.value !== "object") {
    if (
      state.definitions ||
      state.required !== undefined ||
      state.additional !== undefined ||
      state.keywords !== undefined ||
      state.properties !== undefined ||
      state.advanced !== undefined
    )
      error("E_SCHEMA", location, "boolean schema cannot have object sections");
    return { schema: state.value === "true", definitions: false };
  }
  const schema = state.keywords ?? {};
  for (const key of Object.keys(schema))
    if (
      key === "properties" ||
      key === "$defs" ||
      singles.has(key) ||
      arrays.has(key) ||
      maps.has(key)
    )
      error("E_OWNERSHIP", location, "schema-valued keyword belongs in its structural surface");
  const advanced = state.advanced ?? {};
  if (!object(advanced)) error("E_SCHEMA", location, "advanced residual must be an object");
  for (const key of Object.keys(advanced))
    if (!(singles.has(key) || arrays.has(key) || maps.has(key)) || (root && key === "$defs"))
      error(
        "E_OWNERSHIP",
        location,
        "advanced block may not replace keyword tables or root definitions",
      );
  if (state.additional !== undefined && OWN(advanced, "additionalProperties"))
    error("E_DUPLICATE", location, "two additionalProperties authorities");
  if (state.additional !== undefined) schema.additionalProperties = state.additional;
  for (const key of Object.keys(advanced))
    if (key !== "properties") {
      if (OWN(schema, key)) error("E_DUPLICATE", location, "duplicate keyword ownership");
      Object.defineProperty(schema, key, {
        value: advanced[key],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  if (state.properties === undefined) {
    if (OWN(advanced, "properties") || state.required !== undefined)
      error("E_OWNERSHIP", location, "property table required");
  } else {
    if (OWN(schema, "required") && state.required !== undefined)
      error("E_DUPLICATE", location, "two required authorities");
    if (OWN(schema, "required"))
      error(
        "E_OWNERSHIP",
        location,
        "required belongs in Required order when a property table is present",
      );
    const residual = advanced.properties ?? {};
    if (!object(residual)) error("E_SCHEMA", location, "complex property map required");
    const props = [],
      inferred = [];
    for (const [name, [type, required, origin, meaning]] of Object.entries(state.properties)) {
      if (!["yes", "no"].includes(required))
        error("E_TABLE", location, "Required must be yes or no");
      let value;
      if (type === "schema") {
        if (!OWN(residual, name))
          error("E_OWNERSHIP", location, "complex field has no residual schema");
        value = residual[name];
        if (object(value) && (OWN(value, "description") || OWN(value, "x-definedBy")))
          error("E_OWNERSHIP", location, "field annotations belong in their cells");
      } else {
        if (OWN(residual, name))
          error("E_OWNERSHIP", location, "simple field also has a residual schema");
        value = parseType(type, location);
      }
      if (origin !== "—" || meaning !== "—") {
        if (!object(value)) error("E_SCHEMA", location, "boolean field cannot carry annotations");
        if (origin !== "—")
          Object.defineProperty(value, "x-definedBy", {
            value: parseJSON(origin, location),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        if (meaning !== "—") {
          const text = parseJSON(meaning, location);
          if (typeof text !== "string") error("E_SCHEMA", location, "description string required");
          value.description = text;
        }
      }
      props.push([name, value]);
      if (required === "yes") inferred.push(name);
    }
    if (Object.keys(residual).some((name) => !OWN(state.properties, name)))
      error("E_OWNERSHIP", location, "orphan complex property");
    schema.properties = Object.fromEntries(props);
    if (state.required !== undefined) {
      schema.required = state.required;
      validate({ required: schema.required }, location);
      if (
        Object.entries(state.properties).some(
          ([name, fields]) => (fields[1] === "yes") !== schema.required.includes(name),
        )
      )
        error("E_REQUIRED", location, "Required cells disagree with explicit order");
    } else if (inferred.length) schema.required = inferred;
  }
  validate(schema, location);
  return { schema, definitions: state.definitions };
}
export function parseSchema(markdown) {
  if (typeof markdown !== "string" || Buffer.byteLength(markdown) > 16 * 1024 * 1024)
    error("E_LIMIT", "$", "bounded Markdown string required");
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  if (!lines[0].startsWith("# ") || typeof parseJSON(lines[0].slice(2), "heading") !== "string")
    error("E_DOCUMENT", "heading", "JSON-string display heading required");
  let i = 1;
  while (lines[i] === "") i++;
  if (lines[i++] !== MARKER)
    error("E_VERSION", "$", "explicit0.6 marker required;0.5 is not parsed");
  const sections = [];
  let current;
  while (i < lines.length) {
    const line = lines[i++];
    if (line.startsWith('<a id="')) {
      if (current) sections.push(current);
      const anchor = line;
      const heading = lines[i++];
      const root = heading === "## Root schema";
      if (!root && !heading?.startsWith("## Schema: "))
        error("E_DOCUMENT", String(i), "schema heading required after anchor");
      const name = root ? null : parseJSON(heading.slice(11), String(i));
      if (!root && typeof name !== "string")
        error("E_NAME", String(i), "JSON-string definition name required");
      if (anchor !== '<a id="' + (root ? "schema-root" : definitionAnchor(name)) + '"></a>')
        error("E_NAME", String(i), "anchor does not match exact definition name");
      current = { root, name, lines: [] };
    } else if (!current) {
      if (line) error("E_DOCUMENT", String(i), "root schema section required");
    } else current.lines.push(line);
  }
  if (current) sections.push(current);
  if (!sections.length || !sections[0].root || sections.slice(1).some((s) => s.root))
    error("E_DOCUMENT", "$", "one root first required");
  const first = parseNode(sections[0].lines, true, "root");
  const defs = [],
    names = new Set();
  for (const section of sections.slice(1)) {
    if (names.has(section.name)) error("E_DUPLICATE", "$defs", "definition duplicated");
    names.add(section.name);
    defs.push([section.name, parseNode(section.lines, false, "$defs/" + section.name).schema]);
  }
  if (defs.length && !first.definitions)
    error("E_OWNERSHIP", "$defs", "definition-presence marker required");
  if (first.definitions) {
    if (!object(first.schema)) error("E_SCHEMA", "$defs", "boolean root cannot own definitions");
    first.schema.$defs = Object.fromEntries(defs);
  }
  json(first.schema);
  validate(first.schema);
  return first.schema;
}

// Import-safe library only. CLI/file generation belongs to the receiving owner.
export const formatVersion = "0.6";
export const dialect = DIALECT;
