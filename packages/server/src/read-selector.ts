import type { BeadRecord, LinkRecord } from "@bdp/protocol";

/** Complete response-shaped Resources accepted by the Read Selector evaluator. */
export type ReadSelectorCandidate = BeadRecord | LinkRecord;

/** Explicit operational bounds. The caller, not this module, owns their defaults. */
export interface ReadSelectorLimits {
  readonly bytes: number;
  readonly depth: number;
  readonly nodes: number;
}

export type ReadSelectorErrorCode =
  | "syntax"
  | "unsupported-feature"
  | "source-bytes-limit-exceeded"
  | "ast-depth-limit-exceeded"
  | "ast-nodes-limit-exceeded";

/** A protocol-mapping-free failure from parsing or bounding a Selector. */
export class ReadSelectorError extends Error {
  constructor(
    readonly code: ReadSelectorErrorCode,
    message: string,
    readonly offset: number | undefined = undefined,
    readonly limit: number | undefined = undefined,
    readonly actual: number | undefined = undefined,
    cause: unknown = undefined,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReadSelectorError";
  }
}

interface NamePathSegment {
  readonly kind: "name";
  readonly value: string;
}

interface IndexPathSegment {
  readonly kind: "index";
  readonly value: number;
}

type PathSegment = NamePathSegment | IndexPathSegment;

interface PathNode {
  readonly kind: "path";
  readonly segments: readonly PathSegment[];
  readonly depth: number;
  readonly nodes: number;
}

interface LiteralNode {
  readonly kind: "literal";
  readonly value: string | number | boolean | null;
  readonly depth: 1;
  readonly nodes: 1;
}

type ValueNode = PathNode | LiteralNode;

interface ComparisonNode {
  readonly kind: "comparison";
  readonly operator: ComparisonOperator;
  readonly left: ValueNode;
  readonly right: ValueNode;
  readonly depth: number;
  readonly nodes: number;
}

interface NotNode {
  readonly kind: "not";
  readonly operand: BooleanNode;
  readonly depth: number;
  readonly nodes: number;
}

interface LogicalNode {
  readonly kind: "and" | "or";
  readonly left: BooleanNode;
  readonly right: BooleanNode;
  readonly depth: number;
  readonly nodes: number;
}

interface GroupNode {
  readonly kind: "group";
  readonly operand: BooleanNode;
  readonly depth: number;
  readonly nodes: number;
}

type BooleanNode = PathNode | ComparisonNode | NotNode | LogicalNode | GroupNode;
type AstNode = ValueNode | ComparisonNode | NotNode | LogicalNode | GroupNode;

type ComparisonOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";
type BinaryOperator = ComparisonOperator | "&&" | "||";

interface OperatorToken {
  readonly kind: "operator";
  readonly operator: BinaryOperator | "!";
  readonly offset: number;
}

interface PathToken {
  readonly kind: "path";
  readonly segments: readonly PathSegment[];
  readonly offset: number;
}

interface LiteralToken {
  readonly kind: "literal";
  readonly value: string | number | boolean | null;
  readonly offset: number;
}

interface PunctuationToken {
  readonly kind:
    | "dollar"
    | "open-bracket"
    | "question"
    | "close-bracket"
    | "open-paren"
    | "close-paren";
  readonly offset: number;
}

interface EndToken {
  readonly kind: "end";
  readonly offset: number;
}

type Token = OperatorToken | PathToken | LiteralToken | PunctuationToken | EndToken;

interface OpenGroup {
  readonly kind: "open-group";
  readonly offset: number;
  readonly valueCount: number;
}

type OperatorEntry = OperatorToken | OpenGroup;

interface EvaluatedFrame {
  readonly node: BooleanNode;
  readonly visited: boolean;
}

const MISSING: unique symbol = Symbol("READ_SELECTOR_MISSING");
const ROOT_SELECTOR_MEMBERS: ReadonlySet<string> = new Set([
  "id",
  "type",
  "source",
  "target",
  "properties",
]);

/**
 * Parse, bound, and evaluate one decoded Selector over complete canonical records.
 * The returned array is frozen, preserves input order, and contains the original
 * candidate objects rather than copies.
 */
export function selectReadResources<Candidate extends ReadSelectorCandidate>(
  selector: string,
  limits: ReadSelectorLimits,
  candidates: readonly Candidate[],
): readonly Candidate[] {
  if (typeof selector !== "string") throw new TypeError("selector must be a string");
  const checkedLimits = validateLimits(limits);
  const source = selector;
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > checkedLimits.bytes)
    throw new ReadSelectorError(
      "source-bytes-limit-exceeded",
      `Selector source is ${sourceBytes} UTF-8 bytes; limit is ${checkedLimits.bytes}`,
      undefined,
      checkedLimits.bytes,
      sourceBytes,
    );

  const expression = parseSelector(source, checkedLimits);
  const matches: Candidate[] = [];
  for (const candidate of candidates) if (evaluate(expression, candidate)) matches.push(candidate);
  return Object.freeze(matches);
}

function validateLimits(limits: ReadSelectorLimits): ReadSelectorLimits {
  if (typeof limits !== "object" || limits === null)
    throw new TypeError("limits must be an object");
  const snapshot = { bytes: limits.bytes, depth: limits.depth, nodes: limits.nodes };
  for (const [name, value] of Object.entries(snapshot)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`Selector ${name} limit must be a positive safe integer`);
  }
  return snapshot;
}

function parseSelector(source: string, limits: ReadSelectorLimits): BooleanNode {
  const tokens = tokenize(source);
  let cursor = 0;
  const take = (): Token => {
    const token = tokens[cursor];
    if (token === undefined) return { kind: "end", offset: source.length };
    cursor += 1;
    return token;
  };
  const expectToken = (kind: Token["kind"], description: string): Token => {
    const token = take();
    if (token.kind !== kind) throw syntaxError(`expected ${description}`, token.offset);
    return token;
  };

  expectToken("dollar", "'$'");
  expectToken("open-bracket", "'['");
  expectToken("question", "'?'");

  const values: AstNode[] = [];
  const operators: OperatorEntry[] = [];
  let expectingOperand = true;
  let sawExpression = false;

  for (;;) {
    const token = take();
    if (token.kind === "end") throw syntaxError("expected closing ']'", token.offset);
    if (token.kind === "close-bracket") {
      if (expectingOperand || !sawExpression)
        throw syntaxError("expected a filter expression", token.offset);
      if (operators.some((entry) => entry.kind === "open-group"))
        throw syntaxError("expected closing ')'", token.offset);
      reduceAll(operators, values, limits);
      const expression = takeSingleBoolean(values, token.offset);
      const trailing = take();
      if (trailing.kind !== "end") throw unsupportedOrSyntaxAfterSelector(trailing);
      return expression;
    }

    if (expectingOperand) {
      if (token.kind === "operator" && token.operator === "!") {
        const preceding = operators.at(-1);
        if (preceding?.kind === "operator" && preceding.operator === "!")
          throw syntaxError("repeated logical NOT requires parentheses", token.offset);
        operators.push(token);
        continue;
      }
      if (token.kind === "open-paren") {
        operators.push({ kind: "open-group", offset: token.offset, valueCount: values.length });
        continue;
      }
      if (token.kind === "path") {
        values.push(makePath(token.segments, limits, token.offset));
        expectingOperand = false;
        sawExpression = true;
        continue;
      }
      if (token.kind === "literal") {
        values.push({ kind: "literal", value: token.value, depth: 1, nodes: 1 });
        expectingOperand = false;
        sawExpression = true;
        continue;
      }
      if (token.kind === "open-bracket")
        throw unsupportedError("array literals and nested filters are not supported", token.offset);
      if (token.kind === "dollar")
        throw unsupportedError("absolute paths and joins are not supported", token.offset);
      throw syntaxError("expected a path, literal, '!', or '('", token.offset);
    }

    if (token.kind === "operator" && token.operator !== "!") {
      reduceForIncoming(token, operators, values, limits);
      operators.push(token);
      expectingOperand = true;
      continue;
    }
    if (token.kind === "close-paren") {
      closeGroup(token.offset, operators, values, limits);
      expectingOperand = false;
      continue;
    }
    if (token.kind === "open-bracket")
      throw unsupportedError("array and bracket selectors are not supported", token.offset);
    if (token.kind === "dollar")
      throw unsupportedError("absolute paths and joins are not supported", token.offset);
    throw syntaxError("expected an operator, ')', or closing ']'", token.offset);
  }
}

function makePath(
  segments: readonly PathSegment[],
  limits: ReadSelectorLimits,
  offset: number,
): PathNode {
  const size = segments.length + 1;
  enforceAstLimits(size, size, limits, offset);
  return { kind: "path", segments: Object.freeze([...segments]), depth: size, nodes: size };
}

function reduceForIncoming(
  incoming: OperatorToken,
  operators: OperatorEntry[],
  values: AstNode[],
  limits: ReadSelectorLimits,
): void {
  const incomingPrecedence = precedence(incoming.operator);
  for (;;) {
    const top = operators.at(-1);
    if (top === undefined || top.kind === "open-group") return;
    const topPrecedence = precedence(top.operator);
    if (topPrecedence < incomingPrecedence) return;
    reduceOperator(operators.pop() as OperatorToken, values, limits);
  }
}

function reduceAll(
  operators: OperatorEntry[],
  values: AstNode[],
  limits: ReadSelectorLimits,
): void {
  while (operators.length > 0) {
    const operator = operators.pop();
    if (operator === undefined || operator.kind === "open-group")
      throw syntaxError("unclosed parenthesized expression", operator?.offset ?? 0);
    reduceOperator(operator, values, limits);
  }
}

function closeGroup(
  offset: number,
  operators: OperatorEntry[],
  values: AstNode[],
  limits: ReadSelectorLimits,
): void {
  for (;;) {
    const operator = operators.pop();
    if (operator === undefined) throw syntaxError("unmatched ')'", offset);
    if (operator.kind === "open-group") {
      if (values.length !== operator.valueCount + 1)
        throw syntaxError("parenthesized expression is incomplete", offset);
      const operand = popBoolean(values, offset);
      const group: GroupNode = {
        kind: "group",
        operand,
        depth: operand.depth + 1,
        nodes: operand.nodes + 1,
      };
      enforceAstLimits(group.depth, group.nodes, limits, operator.offset);
      values.push(group);
      return;
    }
    reduceOperator(operator, values, limits);
  }
}

function reduceOperator(token: OperatorToken, values: AstNode[], limits: ReadSelectorLimits): void {
  if (token.operator === "!") {
    const operand = popBoolean(values, token.offset);
    const node: NotNode = {
      kind: "not",
      operand,
      depth: operand.depth + 1,
      nodes: operand.nodes + 1,
    };
    enforceAstLimits(node.depth, node.nodes, limits, token.offset);
    values.push(node);
    return;
  }

  const right = popNode(values, token.offset);
  const left = popNode(values, token.offset);
  if (token.operator === "&&" || token.operator === "||") {
    const booleanLeft = requireBoolean(left, token.offset);
    const booleanRight = requireBoolean(right, token.offset);
    const node: LogicalNode = {
      kind: token.operator === "&&" ? "and" : "or",
      left: booleanLeft,
      right: booleanRight,
      depth: Math.max(booleanLeft.depth, booleanRight.depth) + 1,
      nodes: booleanLeft.nodes + booleanRight.nodes + 1,
    };
    enforceAstLimits(node.depth, node.nodes, limits, token.offset);
    values.push(node);
    return;
  }

  const valueLeft = requireValue(left, token.offset);
  const valueRight = requireValue(right, token.offset);
  if (valueLeft.kind === "path" && valueRight.kind === "path")
    throw unsupportedError("path-to-path comparisons are not supported", token.offset);
  const node: ComparisonNode = {
    kind: "comparison",
    operator: token.operator,
    left: valueLeft,
    right: valueRight,
    depth: Math.max(valueLeft.depth, valueRight.depth) + 1,
    nodes: valueLeft.nodes + valueRight.nodes + 1,
  };
  enforceAstLimits(node.depth, node.nodes, limits, token.offset);
  values.push(node);
}

function popNode(values: AstNode[], offset: number): AstNode {
  const node = values.pop();
  if (node === undefined) throw syntaxError("operator is missing an operand", offset);
  return node;
}

function popBoolean(values: AstNode[], offset: number): BooleanNode {
  return requireBoolean(popNode(values, offset), offset);
}

function requireBoolean(node: AstNode, offset: number): BooleanNode {
  if (node.kind === "literal")
    throw syntaxError("a JSON literal is not a filter expression", offset);
  return node;
}

function requireValue(node: AstNode, offset: number): ValueNode {
  if (node.kind !== "path" && node.kind !== "literal")
    throw syntaxError("comparison operands must be singular paths or JSON literals", offset);
  return node;
}

function takeSingleBoolean(values: AstNode[], offset: number): BooleanNode {
  if (values.length !== 1) throw syntaxError("incomplete filter expression", offset);
  return requireBoolean(values[0] as AstNode, offset);
}

function enforceAstLimits(
  depth: number,
  nodes: number,
  limits: ReadSelectorLimits,
  offset: number,
): void {
  if (depth > limits.depth)
    throw new ReadSelectorError(
      "ast-depth-limit-exceeded",
      `Selector AST depth is ${depth}; limit is ${limits.depth}`,
      offset,
      limits.depth,
      depth,
    );
  if (nodes > limits.nodes)
    throw new ReadSelectorError(
      "ast-nodes-limit-exceeded",
      `Selector AST has ${nodes} nodes; limit is ${limits.nodes}`,
      offset,
      limits.nodes,
      nodes,
    );
}

function precedence(operator: BinaryOperator | "!"): number {
  if (operator === "!") return 4;
  if (
    operator === "==" ||
    operator === "!=" ||
    operator === "<" ||
    operator === "<=" ||
    operator === ">" ||
    operator === ">="
  )
    return 3;
  if (operator === "&&") return 2;
  return 1;
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset] as string;
    if (isWhitespace(character)) {
      offset += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const token = scanString(source, offset);
      tokens.push(token.token);
      offset = token.next;
      continue;
    }
    if (character === "@") {
      const token = scanPath(source, offset);
      tokens.push(token.token);
      offset = token.next;
      continue;
    }
    if (character === "-" || isDigit(character)) {
      const token = scanNumber(source, offset);
      tokens.push(token.token);
      offset = token.next;
      continue;
    }
    if (isNameFirstAt(source, offset)) {
      const token = scanWord(source, offset);
      tokens.push(token.token);
      offset = token.next;
      continue;
    }

    const pair = source.slice(offset, offset + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(pair)) {
      tokens.push({ kind: "operator", operator: pair as BinaryOperator, offset });
      offset += 2;
      continue;
    }
    if (pair === "=~") throw unsupportedError("regular expressions are not supported", offset);
    if (character === "!") tokens.push({ kind: "operator", operator: "!", offset });
    else if (character === "<" || character === ">")
      tokens.push({ kind: "operator", operator: character, offset });
    else if (character === "$") tokens.push({ kind: "dollar", offset });
    else if (character === "[") tokens.push({ kind: "open-bracket", offset });
    else if (character === "]") tokens.push({ kind: "close-bracket", offset });
    else if (character === "?") tokens.push({ kind: "question", offset });
    else if (character === "(") tokens.push({ kind: "open-paren", offset });
    else if (character === ")") tokens.push({ kind: "close-paren", offset });
    else if (character === "*" || character === ":")
      throw unsupportedError("wildcards and array selectors are not supported", offset);
    else if (character === ".")
      throw unsupportedError(
        "recursive descent and nested-value selection are not supported",
        offset,
      );
    else if (character === ",")
      throw unsupportedError("joins and unions are not supported", offset);
    else if (character === "/")
      throw unsupportedError("regular expressions are not supported", offset);
    else if (character === "{" || character === "}")
      throw unsupportedError("object and array literals are not supported", offset);
    else throw syntaxError(`unexpected character ${JSON.stringify(character)}`, offset);
    offset += 1;
  }
  tokens.push({ kind: "end", offset: source.length });
  return tokens;
}

function scanPath(
  source: string,
  start: number,
): { readonly token: PathToken; readonly next: number } {
  const segments: PathSegment[] = [];
  let offset = start + 1;
  for (;;) {
    let segmentOffset = offset;
    while (segmentOffset < source.length && isWhitespace(source[segmentOffset] as string))
      segmentOffset += 1;
    if (source[segmentOffset] === ".") {
      if (source[segmentOffset + 1] === ".")
        throw unsupportedError("recursive descent is not supported", segmentOffset);
      if (source[segmentOffset + 1] === "*")
        throw unsupportedError("member wildcards are not supported", segmentOffset);
      const memberOffset = segmentOffset + 1;
      if (!isNameFirstAt(source, memberOffset))
        throw syntaxError("expected a dot-member name", memberOffset);
      const scanned = scanName(source, memberOffset);
      segments.push({ kind: "name", value: scanned.value });
      offset = scanned.next;
      continue;
    }
    if (source[segmentOffset] === "[") {
      const scanned = scanSingularBracketSegment(source, segmentOffset);
      segments.push(scanned.segment);
      offset = scanned.next;
      continue;
    }
    break;
  }
  return {
    token: { kind: "path", segments: Object.freeze(segments), offset: start },
    next: offset,
  };
}

function scanSingularBracketSegment(
  source: string,
  start: number,
): { readonly segment: PathSegment; readonly next: number } {
  const selectorOffset = start + 1;
  const character = source[selectorOffset];
  if (character === "?") throw unsupportedError("nested filters are not supported", start);
  if (character === "*" || character === ":")
    throw unsupportedError("wildcards and array slices are not supported", start);
  if (character === '"' || character === "'") {
    const scanned = scanQuotedString(source, selectorOffset);
    if (source[scanned.next] === ",")
      throw unsupportedError("joins and unions are not supported", scanned.next);
    if (source[scanned.next] !== "]")
      throw syntaxError("expected closing ']' after name selector", scanned.next);
    return {
      segment: { kind: "name", value: scanned.value },
      next: scanned.next + 1,
    };
  }
  if (character === "-" || (character !== undefined && isDigit(character))) {
    let next = selectorOffset;
    if (source[next] === "-") next += 1;
    while (next < source.length && isDigit(source[next] as string)) next += 1;
    const raw = source.slice(selectorOffset, next);
    if (source[next] === ":") throw unsupportedError("array slices are not supported", next);
    if (source[next] === ",") throw unsupportedError("joins and unions are not supported", next);
    if (!/^(?:0|-?[1-9][0-9]*)$/.test(raw) || source[next] !== "]")
      throw syntaxError("invalid canonical index selector", selectorOffset);
    const value = Number(raw);
    if (!Number.isSafeInteger(value))
      throw syntaxError("index selector is outside the I-JSON exact integer range", selectorOffset);
    return { segment: { kind: "index", value }, next: next + 1 };
  }
  if (character === ",") throw unsupportedError("joins and unions are not supported", start);
  throw syntaxError("expected a quoted member name or canonical index selector", selectorOffset);
}

function scanWord(
  source: string,
  start: number,
): { readonly token: LiteralToken; readonly next: number } {
  const scanned = scanName(source, start);
  if (source[scanned.next] === "(") throw unsupportedError("functions are not supported", start);
  if (scanned.value === "true" || scanned.value === "false")
    return {
      token: { kind: "literal", value: scanned.value === "true", offset: start },
      next: scanned.next,
    };
  if (scanned.value === "null")
    return { token: { kind: "literal", value: null, offset: start }, next: scanned.next };
  throw syntaxError(`unexpected name ${JSON.stringify(scanned.value)}`, start);
}

function scanName(
  source: string,
  start: number,
): { readonly value: string; readonly next: number } {
  let offset = start;
  let value = "";
  while (offset < source.length && isNameCharacterAt(source, offset)) {
    const codePoint = source.codePointAt(offset) as number;
    const character = String.fromCodePoint(codePoint);
    value += character;
    offset += character.length;
  }
  return { value, next: offset };
}

function scanString(
  source: string,
  start: number,
): { readonly token: LiteralToken; readonly next: number } {
  const scanned = scanQuotedString(source, start);
  return { token: { kind: "literal", value: scanned.value, offset: start }, next: scanned.next };
}

function scanQuotedString(
  source: string,
  start: number,
): { readonly value: string; readonly next: number } {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") throw syntaxError("expected a quoted string", start);
  let offset = start + 1;
  let value = "";
  while (offset < source.length) {
    const codePoint = source.codePointAt(offset) as number;
    const character = String.fromCodePoint(codePoint);
    if (character === quote) return { value, next: offset + 1 };
    if (codePoint < 0x20 || (codePoint >= 0xd800 && codePoint <= 0xdfff))
      throw syntaxError("invalid JSONPath string literal", offset);
    if (character !== "\\") {
      value += character;
      offset += character.length;
      continue;
    }

    const escaped = source[offset + 1];
    const simpleEscapes: Readonly<Record<string, string>> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      "/": "/",
      "\\": "\\",
    };
    if (escaped !== undefined && escaped in simpleEscapes) {
      value += simpleEscapes[escaped];
      offset += 2;
      continue;
    }
    if (escaped === quote) {
      value += quote;
      offset += 2;
      continue;
    }
    if (escaped !== "u") throw syntaxError("invalid JSONPath string escape", offset);
    const first = scanUnicodeEscape(source, offset);
    if (first.value >= 0xd800 && first.value <= 0xdbff) {
      if (source.slice(first.next, first.next + 2) !== "\\u")
        throw syntaxError("unpaired high surrogate escape", offset);
      const second = scanUnicodeEscape(source, first.next);
      if (second.value < 0xdc00 || second.value > 0xdfff)
        throw syntaxError("unpaired high surrogate escape", offset);
      value += String.fromCodePoint(
        0x10000 + ((first.value - 0xd800) << 10) + (second.value - 0xdc00),
      );
      offset = second.next;
      continue;
    }
    if (first.value >= 0xdc00 && first.value <= 0xdfff)
      throw syntaxError("unpaired low surrogate escape", offset);
    value += String.fromCodePoint(first.value);
    offset = first.next;
  }
  throw syntaxError("unterminated JSONPath string literal", start);
}

function scanUnicodeEscape(
  source: string,
  start: number,
): { readonly value: number; readonly next: number } {
  const raw = source.slice(start + 2, start + 6);
  if (source.slice(start, start + 2) !== "\\u" || !/^[0-9A-Fa-f]{4}$/.test(raw))
    throw syntaxError("invalid Unicode escape", start);
  return { value: Number.parseInt(raw, 16), next: start + 6 };
}

function scanNumber(
  source: string,
  start: number,
): { readonly token: LiteralToken; readonly next: number } {
  const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(start));
  if (match === null) throw syntaxError("invalid JSON number literal", start);
  const raw = match[0];
  const next = start + raw.length;
  if (isNameCharacterAt(source, next) || source[next] === ".")
    throw syntaxError("invalid JSON number literal", start);
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw syntaxError("JSON number literal is outside the finite range", start);
  return { token: { kind: "literal", value, offset: start }, next };
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isNameFirstAt(source: string, offset: number): boolean {
  if (offset >= source.length) return false;
  const codePoint = source.codePointAt(offset) as number;
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    codePoint === 0x5f ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0x80 && (codePoint < 0xd800 || codePoint > 0xdfff))
  );
}

function isNameCharacterAt(source: string, offset: number): boolean {
  if (offset >= source.length) return false;
  const codePoint = source.codePointAt(offset) as number;
  return (codePoint >= 0x30 && codePoint <= 0x39) || isNameFirstAt(source, offset);
}

function evaluate(root: BooleanNode, candidate: ReadSelectorCandidate): boolean {
  const frames: EvaluatedFrame[] = [{ node: root, visited: false }];
  const results: boolean[] = [];
  while (frames.length > 0) {
    const frame = frames.pop() as EvaluatedFrame;
    const node = frame.node;
    if (!frame.visited) {
      if (node.kind === "path") {
        results.push(resolvePath(node, candidate) !== MISSING);
        continue;
      }
      if (node.kind === "comparison") {
        results.push(
          compare(
            node.operator,
            resolveValue(node.left, candidate),
            resolveValue(node.right, candidate),
          ),
        );
        continue;
      }
      frames.push({ node, visited: true });
      if (node.kind === "not" || node.kind === "group")
        frames.push({ node: node.operand, visited: false });
      else {
        frames.push({ node: node.right, visited: false });
        frames.push({ node: node.left, visited: false });
      }
      continue;
    }
    if (node.kind === "not") results.push(!popResult(results));
    else if (node.kind === "group") results.push(popResult(results));
    else {
      const right = popResult(results);
      const left = popResult(results);
      results.push(node.kind === "and" ? left && right : left || right);
    }
  }
  return popResult(results);
}

function popResult(results: boolean[]): boolean {
  const result = results.pop();
  if (result === undefined) throw new Error("invalid internal Selector evaluation state");
  return result;
}

function resolveValue(node: ValueNode, candidate: ReadSelectorCandidate): unknown | typeof MISSING {
  return node.kind === "literal" ? node.value : resolvePath(node, candidate);
}

function resolvePath(path: PathNode, candidate: ReadSelectorCandidate): unknown | typeof MISSING {
  let value: unknown = candidate;
  for (const [position, segment] of path.segments.entries()) {
    if (position === 0 && segment.kind === "name" && !ROOT_SELECTOR_MEMBERS.has(segment.value))
      return MISSING;
    if (value === null || typeof value !== "object") return MISSING;
    if (segment.kind === "name" && Array.isArray(value)) return MISSING;
    if (segment.kind === "index" && !Array.isArray(value)) return MISSING;
    let member = String(segment.value);
    if (segment.kind === "index" && segment.value < 0) {
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      } catch {
        return MISSING;
      }
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value)
      )
        return MISSING;
      const resolvedIndex = (lengthDescriptor.value as number) + segment.value;
      if (resolvedIndex < 0) return MISSING;
      member = String(resolvedIndex);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, member);
    } catch {
      return MISSING;
    }
    if (descriptor === undefined || !("value" in descriptor)) return MISSING;
    value = descriptor.value;
  }
  return value;
}

function compare(
  operator: ComparisonOperator,
  left: unknown | typeof MISSING,
  right: unknown | typeof MISSING,
): boolean {
  if (operator === "==" || operator === "!=") {
    const equal = left !== MISSING && right !== MISSING && primitiveJsonEqual(left, right);
    return operator === "==" ? equal : !equal;
  }
  if (typeof left === "number" && typeof right === "number") {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === "<") return left < right;
    if (operator === "<=") return left <= right;
    if (operator === ">") return left > right;
    return left >= right;
  }
  if (typeof left === "string" && typeof right === "string") {
    const order = compareUnicodeScalars(left, right);
    if (operator === "<") return order < 0;
    if (operator === "<=") return order <= 0;
    if (operator === ">") return order > 0;
    return order >= 0;
  }
  return false;
}

function compareUnicodeScalars(left: string, right: string): number {
  const leftScalars = left[Symbol.iterator]();
  const rightScalars = right[Symbol.iterator]();
  for (;;) {
    const leftScalar = leftScalars.next();
    const rightScalar = rightScalars.next();
    if (leftScalar.done || rightScalar.done) {
      if (leftScalar.done && rightScalar.done) return 0;
      return leftScalar.done ? -1 : 1;
    }
    const leftValue = leftScalar.value.codePointAt(0) as number;
    const rightValue = rightScalar.value.codePointAt(0) as number;
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
}

function primitiveJsonEqual(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === "number" && typeof right === "number")
    return Number.isFinite(left) && Number.isFinite(right) && left === right;
  if (typeof left === "string" && typeof right === "string") return left === right;
  if (typeof left === "boolean" && typeof right === "boolean") return left === right;
  return false;
}

function unsupportedOrSyntaxAfterSelector(token: Token): ReadSelectorError {
  if (token.kind === "path" || token.kind === "dollar" || token.kind === "open-bracket")
    return unsupportedError("selection of nested values is not supported", token.offset);
  return syntaxError("unexpected content after closing ']'", token.offset);
}

function syntaxError(message: string, offset: number, cause?: unknown): ReadSelectorError {
  return new ReadSelectorError(
    "syntax",
    `${message} at offset ${offset}`,
    offset,
    undefined,
    undefined,
    cause,
  );
}

function unsupportedError(message: string, offset: number): ReadSelectorError {
  return new ReadSelectorError("unsupported-feature", `${message} at offset ${offset}`, offset);
}
