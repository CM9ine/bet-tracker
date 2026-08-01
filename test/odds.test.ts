import { describe, expect, it } from "vitest";
import { parseOdds } from "../src/odds.ts";

describe("parseOdds", () => {
  const validCases = [
    ["1.0", 100],
    ["1.5", 150],
    ["2", 200],
    ["2.5", 250],
    ["2.50", 250],
    ["3.75", 375],
    ["11.0", 1100],
  ] as const;

  it.each(validCases)("parses %s as %i hundredths", (input, expected) => {
    expect(parseOdds(input)).toBe(expected);
  });

  const invalidCases = ["0.99", "2.555", "abc", "", "-2.5"] as const;

  it.each(invalidCases)("rejects %s", (input) => {
    expect(() => parseOdds(input)).toThrow();
  });
});
