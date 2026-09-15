/** Private exact decimal arithmetic. Exponents stay signed digit strings. */
export type DigitCharge = (units: number) => void;
export interface Decimal {
  readonly negative: boolean;
  readonly coefficient: string;
  readonly exponent: string;
}
function strip(s: string): string {
  let i = 0;
  while (i < s.length - 1 && s[i] === "0") i++;
  return s.slice(i);
}
function magnitude(a: string, b: string, charge: DigitCharge): number {
  charge(a.length + b.length);
  return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
}
function unsignedAdd(a: string, b: string, subtract: boolean, charge: DigitCharge): string {
  const out: string[] = [];
  let carry = 0;
  for (let i = a.length - 1, j = b.length - 1; i >= 0 || j >= 0; i--, j--) {
    charge(1);
    const x = i < 0 ? 0 : a.charCodeAt(i) - 48,
      y = j < 0 ? 0 : b.charCodeAt(j) - 48;
    let n = x + (subtract ? -y : y) + carry;
    if (subtract) {
      carry = n < 0 ? -1 : 0;
      if (n < 0) n += 10;
    } else {
      carry = n >= 10 ? 1 : 0;
      if (n >= 10) n -= 10;
    }
    out.push(String(n));
  }
  if (carry === 1) out.push("1");
  return strip(out.reverse().join(""));
}
function signed(s: string): { minus: boolean; digits: string } {
  const minus = s[0] === "-";
  const digits = strip(s[0] === "-" || s[0] === "+" ? s.slice(1) : s);
  return { minus: minus && digits !== "0", digits };
}
export function addInteger(a: string, b: string, charge: DigitCharge): string {
  const x = signed(a),
    y = signed(b);
  const cmp = magnitude(x.digits, y.digits, charge);
  if (x.minus === y.minus)
    return (x.minus ? "-" : "") + unsignedAdd(x.digits, y.digits, false, charge);
  if (cmp === 0) return "0";
  const larger = cmp > 0 ? x : y,
    smaller = cmp > 0 ? y : x;
  return (larger.minus ? "-" : "") + unsignedAdd(larger.digits, smaller.digits, true, charge);
}
export function compareInteger(a: string, b: string, charge: DigitCharge): number {
  const x = signed(a),
    y = signed(b);
  if (x.minus !== y.minus) return x.minus ? -1 : 1;
  return magnitude(x.digits, y.digits, charge) * (x.minus ? -1 : 1);
}
export function decimal(literal: string, charge: DigitCharge, coefficientLimit: number): Decimal {
  charge(literal.length);
  const negative = literal[0] === "-";
  const text = negative ? literal.slice(1) : literal;
  const e = text.search(/[eE]/);
  const mantissa = e < 0 ? text : text.slice(0, e),
    exp = e < 0 ? "0" : text.slice(e + 1);
  const dot = mantissa.indexOf(".");
  let coefficient = strip(mantissa.replace(".", ""));
  if (coefficient.length > coefficientLimit) throw new DecimalLimitError();
  let exponent = addInteger(exp, String(dot < 0 ? 0 : -(mantissa.length - dot - 1)), charge);
  if (coefficient === "0")
    return Object.freeze({ negative: false, coefficient: "0", exponent: "0" });
  let end = coefficient.length;
  while (end > 0 && coefficient[end - 1] === "0") {
    charge(1);
    end--;
  }
  exponent = addInteger(exponent, String(coefficient.length - end), charge);
  coefficient = coefficient.slice(0, end);
  return Object.freeze({ negative, coefficient, exponent });
}
export class DecimalLimitError extends Error {}
export function compareDecimal(a: Decimal, b: Decimal, charge: DigitCharge): number {
  if (a.coefficient === "0" || b.coefficient === "0") {
    if (a.coefficient === b.coefficient) return 0;
    return a.coefficient === "0" ? (b.negative ? 1 : -1) : a.negative ? -1 : 1;
  }
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  let cmp = compareInteger(
    addInteger(a.exponent, String(a.coefficient.length), charge),
    addInteger(b.exponent, String(b.coefficient.length), charge),
    charge,
  );
  if (!cmp)
    for (let i = 0; i < Math.max(a.coefficient.length, b.coefficient.length); i++) {
      charge(1);
      const x = a.coefficient[i] ?? "0",
        y = b.coefficient[i] ?? "0";
      if (x !== y) {
        cmp = x < y ? -1 : 1;
        break;
      }
    }
  return cmp * (a.negative ? -1 : 1);
}
export function isInteger(a: Decimal, charge: DigitCharge): boolean {
  return a.coefficient === "0" || compareInteger(a.exponent, "0", charge) >= 0;
}
function divideSmall(a: string, n: number, charge: DigitCharge): string {
  let remainder = 0;
  const out: string[] = [];
  for (const digit of a) {
    charge(1);
    const value = remainder * 10 + digit.charCodeAt(0) - 48;
    out.push(String(Math.floor(value / n)));
    remainder = value % n;
  }
  return strip(out.join(""));
}
function factor(a: string, charge: DigitCharge): { rest: string; two: number; five: number } {
  let two = 0,
    five = 0;
  while ((a.charCodeAt(a.length - 1) - 48) % 2 === 0) {
    a = divideSmall(a, 2, charge);
    two++;
  }
  while (a.endsWith("5")) {
    a = divideSmall(a, 5, charge);
    five++;
  }
  return { rest: a, two, five };
}
function divisible(a: string, b: string, charge: DigitCharge): boolean {
  if (b === "1") return true;
  let remainder = "0";
  for (const digit of a) {
    charge(1);
    remainder = strip(remainder === "0" ? digit : remainder + digit);
    while (magnitude(remainder, b, charge) >= 0)
      remainder = unsignedAdd(remainder, b, true, charge);
  }
  return remainder === "0";
}
export function multipleOf(a: Decimal, b: Decimal, charge: DigitCharge): boolean {
  if (b.negative || b.coefficient === "0") throw new Error("nonpositive divisor");
  if (a.coefficient === "0") return true;
  const x = factor(a.coefficient, charge),
    y = factor(b.coefficient, charge);
  const d = addInteger(
    a.exponent,
    b.exponent[0] === "-" ? b.exponent.slice(1) : `-${b.exponent}`,
    charge,
  );
  return (
    compareInteger(addInteger(d, String(x.two - y.two), charge), "0", charge) >= 0 &&
    compareInteger(addInteger(d, String(x.five - y.five), charge), "0", charge) >= 0 &&
    divisible(x.rest, y.rest, charge)
  );
}
