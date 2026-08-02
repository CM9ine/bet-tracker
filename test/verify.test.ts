import { describe, expect, it } from "vitest";
import type { Bet, BetVerification, VerifiedBet } from "../src/types.ts";
import { verifyBet, verifyBets } from "../src/verify.ts";

const baseBet: Bet = {
  id: 1,
  placed_at: "2026-08-01",
  event: "Ascot 14:30",
  selection: "Kyprios",
  tipster: null,
  stake_pence: 1000,
  odds_hundredths: 250,
  bet_type: "single",
  stake_type: "cash",
  place_fraction_num: null,
  place_fraction_den: null,
  places_count: null,
  rule4_pence_in_pound: null,
  dead_heat_win_num: null,
  dead_heat_win_den: null,
  dead_heat_place_num: null,
  dead_heat_place_den: null,
  status: "won",
  returns_pence: 2500,
  profit_pence: 1500,
};

const ok = (expected: number): BetVerification => ({
  status: "ok", expected_returns_pence: expected, delta_pence: 0, error: null,
});
const mismatch = (expected: number, delta: number): BetVerification => ({
  status: "mismatch", expected_returns_pence: expected, delta_pence: delta, error: null,
});
const notApplicable: BetVerification = {
  status: "not_applicable", expected_returns_pence: null, delta_pence: null, error: null,
};

const cases: Array<{ name: string; bet: Bet; expected: BetVerification }> = [
  { name: "won single matches", bet: baseBet, expected: ok(2500) },
  { name: "won single is one penny short", bet: { ...baseBet, returns_pence: 2499 }, expected: mismatch(2500, -1) },
  { name: "won single is one penny over", bet: { ...baseBet, returns_pence: 2501 }, expected: mismatch(2500, 1) },
  { name: "evens", bet: { ...baseBet, odds_hundredths: 100, returns_pence: 1000 }, expected: ok(1000) },
  { name: "odds-on", bet: { ...baseBet, odds_hundredths: 150, returns_pence: 1500 }, expected: ok(1500) },
  { name: "flooring edge", bet: { ...baseBet, stake_pence: 333, odds_hundredths: 333, returns_pence: 1109 }, expected: mismatch(1108, 1) },
  { name: "zero stake", bet: { ...baseBet, stake_pence: 0, returns_pence: 0 }, expected: ok(0) },
  { name: "Rule 4", bet: { ...baseBet, rule4_pence_in_pound: 90, returns_pence: 1150 }, expected: ok(1150) },
  { name: "win dead heat", bet: { ...baseBet, dead_heat_win_num: 1, dead_heat_win_den: 2, returns_pence: 1250 }, expected: ok(1250) },
  { name: "free SNR win", bet: { ...baseBet, stake_type: "free_snr", returns_pence: 1500 }, expected: ok(1500) },
  {
    name: "each-way win",
    bet: { ...baseBet, bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3, returns_pence: 3800 },
    expected: ok(3800),
  },
  {
    name: "each-way placed",
    bet: { ...baseBet, bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3, status: "placed", returns_pence: 1300 },
    expected: ok(1300),
  },
  { name: "lost with zero return", bet: { ...baseBet, status: "lost", returns_pence: 0 }, expected: ok(0) },
  { name: "lost with a return", bet: { ...baseBet, status: "lost", returns_pence: 500 }, expected: mismatch(0, 500) },
  { name: "cash void matches", bet: { ...baseBet, status: "void", returns_pence: 1000 }, expected: ok(1000) },
  { name: "cash void is short", bet: { ...baseBet, status: "void", returns_pence: 950 }, expected: mismatch(1000, -50) },
  {
    name: "each-way cash void",
    bet: { ...baseBet, bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3, status: "void", returns_pence: 2000 },
    expected: ok(2000),
  },
  { name: "free SR void matches", bet: { ...baseBet, stake_type: "free_sr", status: "void", returns_pence: 0 }, expected: ok(0) },
  { name: "free SR void has a return", bet: { ...baseBet, stake_type: "free_sr", status: "void", returns_pence: 1000 }, expected: mismatch(0, 1000) },
  { name: "settled without recorded return", bet: { ...baseBet, returns_pence: null }, expected: notApplicable },
  { name: "open bet", bet: { ...baseBet, status: "open", returns_pence: null }, expected: notApplicable },
  {
    name: "placed single",
    bet: { ...baseBet, status: "placed", returns_pence: 1500 },
    expected: { status: "uncheckable", expected_returns_pence: null, delta_pence: null, error: "a single bet cannot have placed status" },
  },
  {
    name: "each-way missing place numerator",
    bet: { ...baseBet, bet_type: "each_way", place_fraction_num: null, place_fraction_den: 5, places_count: 3 },
    expected: { status: "uncheckable", expected_returns_pence: null, delta_pence: null, error: "place_fraction_num is required and must be a positive integer" },
  },
];

describe("verifyBet", () => {
  it.each(cases)("verifies $name", ({ bet, expected }) => {
    expect(verifyBet(bet)).toEqual(expected);
  });
});

describe("verifyBets", () => {
  it("summarises comparisons and orders discrepancies by id", () => {
    const bets = [
      { ...baseBet, id: 4, status: "open" as const, returns_pence: null },
      { ...baseBet, id: 3, status: "placed" as const, returns_pence: 1500 },
      { ...baseBet, id: 2, returns_pence: 2499 },
      { ...baseBet, id: 1 },
    ].map((bet): VerifiedBet => ({ ...bet, verification: verifyBet(bet) }));

    const report = verifyBets(bets);

    expect(report).toMatchObject({
      checked_count: 2,
      ok_count: 1,
      mismatch_count: 1,
      uncheckable_count: 1,
      net_delta_pence: -1,
    });
    expect(report.discrepancies.map((bet) => bet.id)).toEqual([2, 3]);
    expect(report.discrepancies.map((bet) => bet.verification.status)).toEqual([
      "mismatch",
      "uncheckable",
    ]);
  });
});
