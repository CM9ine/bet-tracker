import { describe, expect, it } from "vitest";
import {
  SettlementError,
  settle,
  type Settlement,
  type SettlementInput,
} from "../src/settle.ts";

const baseInput: SettlementInput = {
  stake_pence: 1000,
  odds_hundredths: 250,
  bet_type: "single",
  stake_type: "cash",
  status: "won",
};

const eachWayTerms = {
  bet_type: "each_way" as const,
  place_fraction_num: 1,
  place_fraction_den: 5,
};

const validCases: Array<{
  name: string;
  input: SettlementInput;
  expected: Settlement;
}> = [
  {
    name: "single won, cash",
    input: baseInput,
    expected: { win_part_pence: 2500, place_part_pence: 0, total_pence: 2500, profit_pence: 1500 },
  },
  {
    name: "single won, evens",
    input: { ...baseInput, odds_hundredths: 100 },
    expected: { win_part_pence: 1000, place_part_pence: 0, total_pence: 1000, profit_pence: 0 },
  },
  {
    name: "zero stake",
    input: { ...baseInput, stake_pence: 0 },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 0, profit_pence: 0 },
  },
  {
    name: "single won, odds-on",
    input: { ...baseInput, odds_hundredths: 150 },
    expected: { win_part_pence: 1500, place_part_pence: 0, total_pence: 1500, profit_pence: 500 },
  },
  {
    name: "flooring edge",
    input: { ...baseInput, stake_pence: 333 },
    expected: { win_part_pence: 832, place_part_pence: 0, total_pence: 832, profit_pence: 499 },
  },
  {
    name: "single lost",
    input: { ...baseInput, status: "lost" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 0, profit_pence: -1000 },
  },
  {
    name: "single void, cash",
    input: { ...baseInput, status: "void" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 1000, profit_pence: 0 },
  },
  {
    name: "single won, free_snr",
    input: { ...baseInput, stake_type: "free_snr" },
    expected: { win_part_pence: 1500, place_part_pence: 0, total_pence: 1500, profit_pence: 1500 },
  },
  {
    name: "single won, free_sr",
    input: { ...baseInput, stake_type: "free_sr" },
    expected: { win_part_pence: 2500, place_part_pence: 0, total_pence: 2500, profit_pence: 2500 },
  },
  {
    name: "free_snr at evens returns nothing",
    input: { ...baseInput, odds_hundredths: 100, stake_type: "free_snr" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 0, profit_pence: 0 },
  },
  {
    name: "void free_snr",
    input: { ...baseInput, stake_type: "free_snr", status: "void" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 0, profit_pence: 0 },
  },
  {
    name: "void free_sr",
    input: { ...baseInput, stake_type: "free_sr", status: "void" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 0, profit_pence: 0 },
  },
  {
    name: "Rule 4 25p/£",
    input: { ...baseInput, rule4_pence_in_pound: 25 },
    expected: { win_part_pence: 2125, place_part_pence: 0, total_pence: 2125, profit_pence: 1125 },
  },
  {
    name: "Rule 4 90p/£ (max)",
    input: { ...baseInput, rule4_pence_in_pound: 90 },
    expected: { win_part_pence: 1150, place_part_pence: 0, total_pence: 1150, profit_pence: 150 },
  },
  {
    name: "Rule 4 0 is a no-op",
    input: { ...baseInput, rule4_pence_in_pound: 0 },
    expected: { win_part_pence: 2500, place_part_pence: 0, total_pence: 2500, profit_pence: 1500 },
  },
  {
    name: "dead heat 1/2",
    input: { ...baseInput, dead_heat_win_num: 1, dead_heat_win_den: 2 },
    expected: { win_part_pence: 1250, place_part_pence: 0, total_pence: 1250, profit_pence: 250 },
  },
  {
    name: "dead heat 1/3, R4 10p, odds-on",
    input: {
      ...baseInput,
      odds_hundredths: 150,
      rule4_pence_in_pound: 10,
      dead_heat_win_num: 1,
      dead_heat_win_den: 3,
    },
    expected: { win_part_pence: 483, place_part_pence: 0, total_pence: 483, profit_pence: -517 },
  },
  {
    name: "dead heat 1/1 is a no-op",
    input: { ...baseInput, dead_heat_win_num: 1, dead_heat_win_den: 1 },
    expected: { win_part_pence: 2500, place_part_pence: 0, total_pence: 2500, profit_pence: 1500 },
  },
  {
    name: "e/w won, 1/5 terms",
    input: { ...baseInput, ...eachWayTerms, odds_hundredths: 900 },
    expected: { win_part_pence: 9000, place_part_pence: 2600, total_pence: 11600, profit_pence: 9600 },
  },
  {
    name: "e/w placed, 1/5 terms",
    input: { ...baseInput, ...eachWayTerms, odds_hundredths: 900, status: "placed" },
    expected: { win_part_pence: 0, place_part_pence: 2600, total_pence: 2600, profit_pence: 600 },
  },
  {
    name: "e/w lost",
    input: { ...baseInput, ...eachWayTerms, odds_hundredths: 900, status: "lost" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 0, profit_pence: -2000 },
  },
  {
    name: "e/w void, cash",
    input: { ...baseInput, ...eachWayTerms, odds_hundredths: 900, status: "void" },
    expected: { win_part_pence: 0, place_part_pence: 0, total_pence: 2000, profit_pence: 0 },
  },
  {
    name: "e/w won, free_snr",
    input: { ...baseInput, ...eachWayTerms, odds_hundredths: 900, stake_type: "free_snr" },
    expected: { win_part_pence: 8000, place_part_pence: 1600, total_pence: 9600, profit_pence: 9600 },
  },
  {
    name: "e/w part-flooring",
    input: {
      ...baseInput,
      bet_type: "each_way",
      stake_pence: 333,
      place_fraction_num: 1,
      place_fraction_den: 2,
    },
    // The exact combined return is 1415.25; bookmakers floor each part separately.
    expected: { win_part_pence: 832, place_part_pence: 582, total_pence: 1414, profit_pence: 748 },
  },
  {
    name: "e/w won, R4 25p, 1/5",
    input: {
      ...baseInput,
      ...eachWayTerms,
      odds_hundredths: 900,
      rule4_pence_in_pound: 25,
    },
    expected: { win_part_pence: 7000, place_part_pence: 2200, total_pence: 9200, profit_pence: 7200 },
  },
  {
    name: "e/w win-part dead heat 1/2",
    input: {
      ...baseInput,
      ...eachWayTerms,
      odds_hundredths: 900,
      dead_heat_win_num: 1,
      dead_heat_win_den: 2,
    },
    expected: { win_part_pence: 4500, place_part_pence: 2600, total_pence: 7100, profit_pence: 5100 },
  },
  {
    name: "e/w place-part dead heat 1/2",
    input: {
      ...baseInput,
      ...eachWayTerms,
      odds_hundredths: 900,
      status: "placed",
      dead_heat_place_num: 1,
      dead_heat_place_den: 2,
    },
    expected: { win_part_pence: 0, place_part_pence: 1300, total_pence: 1300, profit_pence: -700 },
  },
];

const invalidCases: Array<{
  name: string;
  input: SettlementInput;
  message: string;
}> = [
  { name: "open status", input: { ...baseInput, status: "open" }, message: "open" },
  { name: "placed single", input: { ...baseInput, status: "placed" }, message: "single" },
  {
    name: "place dead heat on a single",
    input: { ...baseInput, dead_heat_place_num: 1, dead_heat_place_den: 2 },
    message: "place dead heat",
  },
  {
    name: "win dead heat on a placed bet",
    input: {
      ...baseInput,
      ...eachWayTerms,
      status: "placed",
      dead_heat_win_num: 1,
      dead_heat_win_den: 2,
    },
    message: "win dead heat",
  },
  {
    name: "missing each-way place numerator",
    input: { ...baseInput, bet_type: "each_way", place_fraction_num: null, place_fraction_den: 5 },
    message: "place_fraction_num",
  },
  {
    name: "Rule 4 above maximum",
    input: { ...baseInput, rule4_pence_in_pound: 91 },
    message: "rule4_pence_in_pound",
  },
  {
    name: "negative Rule 4",
    input: { ...baseInput, rule4_pence_in_pound: -1 },
    message: "rule4_pence_in_pound",
  },
  {
    name: "dead heat numerator above denominator",
    input: { ...baseInput, dead_heat_win_num: 2, dead_heat_win_den: 1 },
    message: "dead heat",
  },
  {
    name: "zero dead heat denominator",
    input: { ...baseInput, dead_heat_win_num: 1, dead_heat_win_den: 0 },
    message: "dead heat",
  },
];

describe("settle", () => {
  it.each(validCases)("settles $name", ({ input, expected }) => {
    expect(settle(input)).toEqual(expected);
  });

  it.each(invalidCases)("rejects $name", ({ input, message }) => {
    expect(() => settle(input)).toThrow(SettlementError);
    expect(() => settle(input)).toThrow(message);
  });
});
