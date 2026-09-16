import { type EvaluationBudget, EvaluationRefusal } from "./installed-schema-value.js";

/** Private policy1 fixes Unicode13's25 whitespace points. No host Unicode table,
 * native RegExp, captures or caller callbacks participate. Fixed profile limits
 * are not EvaluatorLimits keys. Regex records never consume evaluator states. */
export const PATTERN_POLICY = "bounded-ecma2020-regular-subset-1" as const;
const MAX = 4096;
const SYNTAX = Object.freeze([94, 36, 92, 46, 42, 43, 63, 40, 41, 91, 93, 123, 125, 124, 47]);
const SPACE = Object.freeze([
  9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
  8202, 8232, 8233, 8239, 8287, 12288, 65279,
]);
// kind0 is a singleton/range;1/2 digit/complement;3/4 word/complement;
//5/6 whitespace/complement;7 dot. A class unions terms before outer negation.
interface Term {
  readonly kind: number;
  readonly lo: number;
  readonly hi: number;
}
type Kind = "empty" | "char" | "start" | "end" | "cat" | "alt" | "repeat";
interface Node {
  readonly kind: Kind;
  readonly left: number;
  readonly right: number;
  readonly min: number;
  readonly max: number;
  readonly size: number;
  readonly terms: readonly Term[] | undefined;
  readonly negate: boolean;
}
// op0 accept,1 consume,2 split,3 jump,4 start,5 end.
interface Instruction {
  readonly op: number;
  x: number;
  y: number;
  readonly terms: readonly Term[] | undefined;
  readonly negate: boolean;
}
export interface PatternProgram {
  readonly instructions: readonly Readonly<Instruction>[];
  readonly start: number;
}
function unsupported(): never {
  throw new EvaluationRefusal("unsupported-pattern");
}
function sizeLimit(): never {
  throw new EvaluationRefusal("limit-patternStates");
}
function hex(c: number): number {
  return c >= 48 && c <= 57
    ? c - 48
    : c >= 65 && c <= 70
      ? c - 55
      : c >= 97 && c <= 102
        ? c - 87
        : -1;
}
/** Ledger macros are prepaid logical operations, not CPU or heap measurements.
 * Scalar dispatch blocks conservatively charge their bounded field/branch work;
 * every variable traversal, retained slot and mutable stack has a separate charge. */
export function compilePattern(text: string, b: EvaluationBudget): PatternProgram {
  if (typeof text !== "string") throw new Error("pattern invariant: certified string");
  b.work(2);
  if (text.length > MAX) throw new EvaluationRefusal("limit-patternUnits");
  b.charge("logicalBytes", 128);
  b.work(2);
  const nodes: Node[] = [];
  const groups: { seq: number | undefined; alt: number | undefined }[] = [];
  let at = 0;
  function read(offset = at): number {
    b.work(2); // Boundary test and unit read (including an end sentinel).
    return offset < text.length ? text.charCodeAt(offset) : -1;
  }
  function take(): number {
    const c = read();
    if (c < 0) unsupported();
    b.work();
    at++;
    return c;
  }
  function term(kind: number, lo = 0, hi = lo): Term {
    b.work(4);
    b.charge("logicalBytes", 32);
    return { kind, lo, hi };
  }
  function terms(): Term[] {
    b.work();
    b.charge("logicalBytes", 64);
    return [];
  }
  function append(list: Term[], value: Term): void {
    b.work();
    b.charge("logicalBytes", 16);
    list.push(value);
  }
  function node(
    kind: Kind,
    left = -1,
    right = -1,
    min = 0,
    max = 0,
    set?: readonly Term[],
    negate = false,
  ): number {
    b.work(20); // Kind/field reads, projected arithmetic/check, creation/write/append.
    let size = 1;
    if (kind === "cat" || kind === "alt") {
      size = get(left).size + get(right).size + (kind === "alt" ? 1 : 0);
    } else if (kind === "repeat") {
      const child = get(left).size;
      if (max === -1) size = child * (min + 1) + 1;
      else if (max !== 0) size = child * max + max - min;
    }
    // Count values are saturated at MAX+1, node sizes<=MAX-1: arithmetic is safe.
    if (size >= MAX || min > MAX || max > MAX) sizeLimit();
    b.charge("logicalBytes", 80);
    const id = nodes.length;
    nodes.push({ kind, left, right, min, max, size, terms: set, negate });
    return id;
  }
  function get(id: number): Node {
    b.work();
    const value = nodes[id];
    if (!value) throw new Error("pattern invariant: AST identity");
    return value;
  }
  function group(): void {
    b.work(4);
    b.bound("frames", groups.length + 1);
    b.charge("logicalBytes", 80);
    groups.push({ seq: undefined, alt: undefined });
  }
  function finish(frame: (typeof groups)[number]): number {
    b.work(3);
    const branch = frame.seq ?? node("empty");
    return frame.alt === undefined ? branch : node("alt", frame.alt, branch);
  }
  function add(id: number): void {
    b.work(3);
    const frame = groups[groups.length - 1];
    if (!frame) throw new Error("pattern invariant: group");
    frame.seq = frame.seq === undefined ? id : node("cat", frame.seq, id);
  }
  function fixedHex(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      b.work(8);
      const digit = hex(take());
      if (digit < 0) unsupported();
      value = value * 16 + digit;
    }
    return value;
  }
  function decodeEscape(inClass: boolean): Term {
    const c = take();
    b.work(20); // Fixed escape dispatch, ASCII predicates and arithmetic.
    const simple =
      c === 102 ? 12 : c === 110 ? 10 : c === 114 ? 13 : c === 116 ? 9 : c === 118 ? 11 : -1;
    if (simple >= 0) return term(0, simple);
    const predefined =
      c === 100
        ? 1
        : c === 68
          ? 2
          : c === 119
            ? 3
            : c === 87
              ? 4
              : c === 115
                ? 5
                : c === 83
                  ? 6
                  : 0;
    if (predefined) return term(predefined);
    if (c === 98 && inClass) return term(0, 8);
    if (c === 45 && inClass) return term(0, 45);
    if (c === 48) {
      const next = read();
      b.work(2);
      if (next >= 48 && next <= 57) unsupported();
      return term(0, 0);
    }
    if (c === 99) {
      const letter = take();
      b.work(4);
      if (!((letter >= 65 && letter <= 90) || (letter >= 97 && letter <= 122))) unsupported();
      return term(0, letter % 32);
    }
    if (c === 120) return term(0, fixedHex(2));
    if (c === 117) {
      let value: number;
      if (read() === 123) {
        take();
        value = 0;
        let digits = 0;
        while (read() !== 125) {
          b.work(10);
          const digit = hex(take());
          if (digit < 0) unsupported();
          value = value * 16 + digit;
          digits++;
          if (value > 0x10ffff) unsupported();
        }
        take();
        if (!digits) unsupported();
      } else {
        value = fixedHex(4);
        b.work(4);
        if (value >= 0xd800 && value <= 0xdbff && read() === 92 && read(at + 1) === 117) {
          let trail = 0;
          for (let i = 2; i < 6; i++) {
            b.work(8);
            const digit = hex(read(at + i));
            if (digit < 0) {
              trail = -1;
              break;
            }
            trail = trail * 16 + digit;
          }
          b.work(5);
          if (trail >= 0xdc00 && trail <= 0xdfff) {
            for (let i = 0; i < 6; i++) {
              b.work();
              take();
            }
            value = (value - 0xd800) * 1024 + trail - 0xdc00 + 0x10000;
          }
        }
      }
      return term(0, value);
    }
    // Unicode IdentityEscape accepts SyntaxCharacter or slash, no legacy escapes.
    b.work(15);
    if (SYNTAX.includes(c)) return term(0, c);
    return unsupported();
  }
  function atomTerm(inClass: boolean): Term {
    const c = take();
    b.work(5);
    if (c === 92) return decodeEscape(inClass);
    if (c >= 0xd800 && c <= 0xdbff) {
      const trail = read();
      b.work(5);
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        take();
        return term(0, (c - 0xd800) * 1024 + trail - 0xdc00 + 0x10000);
      }
    }
    return term(0, c);
  }
  function characterClass(): number {
    take();
    let negate = false;
    if (read() === 94) {
      take();
      negate = true;
    }
    const set = terms();
    while (read() !== 93) {
      b.work(6);
      const first = atomTerm(true);
      if (read() === 45 && read(at + 1) !== 93) {
        take();
        const second = atomTerm(true);
        b.work(5);
        if (first.kind !== 0 || second.kind !== 0 || first.lo > second.lo) unsupported();
        append(set, term(0, first.lo, second.lo));
      } else append(set, first);
    }
    take();
    return node("char", -1, -1, 0, 0, set, negate);
  }
  function count(): number {
    let value = 0,
      digits = 0;
    for (;;) {
      const c = read();
      b.work(4);
      if (c < 48 || c > 57) break;
      take();
      b.work(4);
      value = Math.min(MAX + 1, value * 10 + c - 48);
      digits++;
    }
    if (!digits) unsupported();
    return value;
  }
  function reversed(a: number, ae: number, z: number, ze: number): boolean {
    while (a < ae && read(a) === 48) {
      b.work(2);
      a++;
    }
    while (z < ze && read(z) === 48) {
      b.work(2);
      z++;
    }
    b.work(3);
    if (ae - a !== ze - z) return ae - a > ze - z;
    while (a < ae) {
      b.work(3);
      const x = read(a++),
        y = read(z++);
      if (x !== y) return x > y;
    }
    return false;
  }
  function quantify(id: number, allowed: boolean): number {
    const c = read();
    b.work(5);
    if (c !== 42 && c !== 43 && c !== 63 && c !== 123) return id;
    if (!allowed) unsupported();
    take();
    let min = c === 43 ? 1 : 0,
      max = c === 63 ? 1 : -1;
    if (c === 123) {
      const start = at;
      min = count();
      const end = at;
      max = min;
      if (read() === 44) {
        take();
        if (read() === 125) max = -1;
        else {
          const second = at;
          max = count();
          if (reversed(start, end, second, at)) unsupported();
        }
      }
      if (take() !== 125) unsupported();
    }
    if (read() === 63) take(); // Lazy order cannot affect Boolean acceptance.
    return node("repeat", id, -1, min, max);
  }
  group();
  let root = -1;
  for (;;) {
    b.work(8);
    const frame = groups[groups.length - 1];
    if (!frame) throw new Error("pattern invariant: parser frame");
    const c = read();
    if (c < 0 || c === 41) {
      if (c < 0 && groups.length !== 1) unsupported();
      if (c === 41 && groups.length === 1) unsupported();
      if (c === 41) take();
      const id = finish(frame);
      b.work();
      groups.pop();
      if (!groups.length) {
        root = id;
        break;
      }
      add(quantify(id, true));
      continue;
    }
    if (c === 124) {
      take();
      const id = finish(frame);
      b.work(2);
      frame.alt = id;
      frame.seq = undefined;
      continue;
    }
    if (c === 40) {
      take();
      if (read() === 63) {
        take();
        if (take() !== 58) unsupported();
      }
      group();
      continue;
    }
    let id: number;
    if (c === 94 || c === 36) {
      take();
      id = node(c === 94 ? "start" : "end");
    } else if (c === 91) id = characterClass();
    else {
      b.work(8);
      if (c === 42 || c === 43 || c === 63 || c === 123 || c === 125 || c === 93) unsupported();
      const set = terms();
      if (c === 46) {
        take();
        append(set, term(7));
      } else append(set, atomTerm(false));
      id = node("char", -1, -1, 0, 0, set);
    }
    add(quantify(id, c !== 94 && c !== 36));
  }

  b.work(2);
  b.charge("logicalBytes", 128);
  const instructions: Instruction[] = [];
  interface Frame {
    node: number;
    next: number;
    phase: number;
    rest: number;
    entry: number;
    split: number;
  }
  const stack: Frame[] = [];
  function emit(op: number, x: number, y = -1, set?: readonly Term[], negate = false): number {
    b.work(10);
    if (instructions.length >= MAX) sizeLimit();
    b.charge("logicalBytes", 80);
    const id = instructions.length;
    instructions.push({ op, x, y, terms: set, negate });
    return id;
  }
  function push(id: number, next: number): void {
    b.work(8);
    b.bound("frames", stack.length + 1);
    b.charge("logicalBytes", 80);
    stack.push({ node: id, next, phase: 0, rest: 0, entry: next, split: -1 });
  }
  function patch(id: number, key: "x" | "y", target: number): void {
    b.work(2);
    const instruction = instructions[id];
    if (!instruction) throw new Error("pattern invariant: patch");
    instruction[key] = target;
  }
  let result = emit(0, -1);
  push(root, result);
  while (stack.length) {
    b.work(10);
    const f = stack[stack.length - 1];
    if (!f) throw new Error("pattern invariant: compiler frame");
    const n = get(f.node);
    if (n.kind === "cat") {
      if (f.phase === 0) {
        b.work();
        f.phase = 1;
        push(n.right, f.next);
        continue;
      }
      if (f.phase === 1) {
        b.work();
        f.phase = 2;
        push(n.left, result);
        continue;
      }
    } else if (n.kind === "alt") {
      if (f.phase === 0) {
        f.split = emit(2, -1);
        b.work(2);
        f.phase = 1;
        push(n.left, f.next);
        continue;
      }
      if (f.phase === 1) {
        patch(f.split, "x", result);
        b.work();
        f.phase = 2;
        push(n.right, f.next);
        continue;
      }
      patch(f.split, "y", result);
      b.work();
      result = f.split;
    } else if (n.kind === "repeat" && n.max !== 0) {
      if (f.phase === 0) {
        if (n.max === -1) {
          f.split = emit(2, -1, f.next);
          b.work(2);
          f.phase = 1;
          push(n.left, f.split);
          continue;
        }
        b.work(2);
        f.rest = n.max;
        f.phase = 2;
      }
      if (f.phase === 1) {
        patch(f.split, "x", result);
        b.work(3);
        f.entry = f.split;
        f.rest = n.min;
        f.phase = 2;
      }
      if (f.phase === 3) {
        b.work(5);
        f.entry = n.max !== -1 && f.rest > n.min ? emit(2, result, f.entry) : result;
        f.rest--;
        f.phase = 2;
      }
      if (f.rest > 0) {
        b.work();
        f.phase = 3;
        push(n.left, f.entry);
        continue;
      }
      b.work();
      result = f.entry;
    } else {
      result = emit(
        n.kind === "char" ? 1 : n.kind === "start" ? 4 : n.kind === "end" ? 5 : 3,
        f.next,
        -1,
        n.terms,
        n.negate,
      );
    }
    b.work();
    stack.pop();
  }
  b.work(3);
  if (instructions.length !== get(root).size + 1)
    throw new Error("pattern invariant: projected size");
  for (const instruction of instructions) {
    b.work(3);
    if (instruction.terms) {
      for (const item of instruction.terms) {
        b.work();
        Object.freeze(item);
      }
      b.work();
      Object.freeze(instruction.terms);
    }
    Object.freeze(instruction);
  }
  b.work(5);
  b.charge("logicalBytes", 64);
  return Object.freeze({ instructions: Object.freeze(instructions), start: result });
}

/** Scratch is invocation-owned per actual match; logical charge is cumulative
 *256+64*S even after collection. No cross-instance mutable cache or input copy. */
export function matchPattern(program: PatternProgram, text: string, b: EvaluationBudget): boolean {
  b.work(3);
  const code = program.instructions,
    size = code.length;
  b.charge("logicalBytes", 256 + 64 * size);
  b.work(4);
  const current = new Array<number>(size),
    next = new Array<number>(size),
    pending = new Array<number>(size),
    visited = new Array<number>(size);
  for (let i = 0; i < size; i++) {
    b.work(6);
    current[i] = 0;
    next[i] = 0;
    pending[i] = 0;
    visited[i] = 0;
  }
  let position = 0,
    stamp = 0,
    nextCount = 0,
    pendingCount = 0,
    currentCount = 0;
  function schedule(id: number): void {
    b.work(4);
    if (id < 0 || id >= size) throw new Error("pattern invariant: instruction target");
    if (visited[id] === stamp) return;
    b.bound("frames", pendingCount + 1);
    b.work(3);
    visited[id] = stamp;
    pending[pendingCount++] = id;
  }
  function accepts(instruction: Readonly<Instruction>, cp: number): boolean {
    b.work(3);
    const set = instruction.terms;
    if (!set) throw new Error("pattern invariant: character terms");
    let found = false;
    for (const t of set) {
      b.work(12); // Term read/dispatch and bounded ASCII/range predicates.
      let yes = false;
      if (t.kind === 0) yes = cp >= t.lo && cp <= t.hi;
      else if (t.kind <= 2) yes = cp >= 48 && cp <= 57;
      else if (t.kind <= 4)
        yes =
          (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95;
      else if (t.kind <= 6) {
        for (const c of SPACE) {
          b.work(2);
          if (cp === c) {
            yes = true;
            break;
          }
        }
      } else yes = cp !== 10 && cp !== 13 && cp !== 0x2028 && cp !== 0x2029;
      if (t.kind === 2 || t.kind === 4 || t.kind === 6) yes = !yes;
      if (yes) {
        found = true;
        break;
      }
    }
    b.work();
    return instruction.negate ? !found : found;
  }
  for (;;) {
    b.work(4);
    stamp++;
    pendingCount = 0;
    currentCount = 0;
    schedule(program.start);
    for (let i = 0; i < nextCount; i++) {
      b.work(2);
      schedule(next[i] as number);
    }
    while (pendingCount) {
      b.work(5);
      const id = pending[--pendingCount] as number,
        instruction = code[id];
      if (!instruction) throw new Error("pattern invariant: instruction");
      if (instruction.op === 0) return true;
      if (instruction.op === 1) {
        b.work(2);
        current[currentCount++] = id;
      } else if (instruction.op === 2) {
        b.work(2);
        schedule(instruction.x);
        schedule(instruction.y);
      } else if (instruction.op === 3) {
        b.work();
        schedule(instruction.x);
      } else {
        b.work(3);
        if (instruction.op === 4 ? position === 0 : position === text.length)
          schedule(instruction.x);
      }
    }
    b.work(2);
    if (position === text.length) return false;
    b.work(5);
    let cp = text.charCodeAt(position++);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      b.work(7);
      const trail = text.charCodeAt(position);
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        cp = (cp - 0xd800) * 1024 + trail - 0xdc00 + 0x10000;
        position++;
      }
    }
    nextCount = 0;
    for (let i = 0; i < currentCount; i++) {
      b.work(4);
      const instruction = code[current[i] as number];
      if (!instruction) throw new Error("pattern invariant: consuming instruction");
      if (accepts(instruction, cp)) {
        b.work(2);
        next[nextCount++] = instruction.x;
      }
    }
  }
}
