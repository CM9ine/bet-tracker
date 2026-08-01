import { describe, expect, it } from "vitest";
import { formatPence, parsePence } from "../src/money.ts";
import { formatOdds } from "../src/odds.ts";

describe("money formatting", () => {
  it.each([
    ["12.50", 1250],
    ["12", 1200],
    ["0.05", 5],
    ["12.5", 1250],
    ["£12.50", 1250],
    [" 12.50 ", 1250],
    ["0", 0],
  ])("parses %j as %i pence", (input, expected) => {
    expect(parsePence(input)).toBe(expected);
  });

  it.each(["12.505", "-1", "abc", "", "1,000", "1e3", ".5"])(
    "rejects %j",
    (input) => {
      expect(() => parsePence(input)).toThrow();
    },
  );

  it.each([
    [1250, "£12.50"],
    [5, "£0.05"],
    [0, "£0.00"],
    [-120, "-£1.20"],
    [100000, "£1000.00"],
  ])("formats %i pence as %s", (input, expected) => {
    expect(formatPence(input)).toBe(expected);
  });

  it.each([
    [250, "2.50"],
    [100, "1.00"],
    [1100, "11.00"],
    [375, "3.75"],
  ])("formats odds %i as %s", (input, expected) => {
    expect(formatOdds(input)).toBe(expected);
  });
});
