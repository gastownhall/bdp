import { expect, it } from "vitest";
import {
  addInteger,
  compareInteger,
  decimal,
  compareDecimal,
  multipleOf,
  isInteger,
} from "./installed-schema-decimal.js";
const charge = () => {};
const d = (s: string) => decimal(s, charge, 4096);
it.each([
  ["-9", "0", -1],
  ["10", "9", 1],
  ["-10", "-9", -1],
  ["+0009", "9", 0],
  ["1e99999", "9e99998", 1],
  ["-1e-99999", "-9e-99998", 1],
])("compares signs and magnitudes %s %s", (a, b, expected) => {
  expect(a.includes("e") ? compareDecimal(d(a), d(b), charge) : compareInteger(a, b, charge)).toBe(
    expected,
  );
});
it.each([
  ["-99", "100", "1"],
  ["100", "-99", "1"],
  ["-9", "-11", "-20"],
  ["999", "1", "1000"],
  ["100", "-100", "0"],
])("adds signed exponents %s %s", (a, b, c) => expect(addInteger(a, b, charge)).toBe(c));
it.each([
  ["0", "0.1", true],
  ["0.3", "0.1", true],
  ["1", "0.03", false],
  ["7.5", "2.5", true],
  ["5", "0.2", true],
  ["-21", "7", true],
  ["6e99999", "3e-99999", true],
  ["3e-99999", "6e99999", false],
  ["22", "7", false],
])("exact divisibility %s %s", (a, b, expected) =>
  expect(multipleOf(d(a), d(b), charge)).toBe(expected),
);
it.each([
  ["1.000", true],
  ["0e-9999", true],
  ["1e-99999", false],
  ["1e99999", true],
  ["10e-1", true],
])("integrality %s", (a, expected) => expect(isInteger(d(a), charge)).toBe(expected));
