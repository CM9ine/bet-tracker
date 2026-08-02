import { describe, expect, it } from "vitest";
import {
  basisPoints,
  computeStats,
  londonLocalDate,
  londonMonthKey,
  type StatsGroup,
} from "../src/stats.ts";
import type { Bet } from "../src/types.ts";

const empty: StatsGroup = {
  won_count: 0,
  placed_count: 0,
  lost_count: 0,
  void_count: 0,
  incomplete_count: 0,
  profit_pence: 0,
  risked_pence: 0,
  roi_basis_points: null,
  strike_rate_basis_points: null,
};

function bet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: 1,
    placed_at: "2026-03-15",
    event: "Event",
    selection: "Selection",
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
    ...overrides,
  };
}

const cases: Array<{
  name: string;
  bets: Bet[];
  expected: StatsGroup;
  incomplete?: number[];
}> = [
  {
    name: "cash single won",
    bets: [bet()],
    expected: { ...empty, won_count: 1, profit_pence: 1500, risked_pence: 1000, roi_basis_points: 15000, strike_rate_basis_points: 10000 },
  },
  {
    name: "cash each-way won",
    bets: [bet({ bet_type: "each_way", returns_pence: 3500 })],
    expected: { ...empty, won_count: 1, profit_pence: 1500, risked_pence: 2000, roi_basis_points: 7500, strike_rate_basis_points: 10000 },
  },
  ...([null, 0] as const).map((returns_pence) => ({
    name: `lost with ${returns_pence === null ? "null" : "zero"} returns`,
    bets: [bet({ status: "lost" as const, returns_pence })],
    expected: { ...empty, lost_count: 1, profit_pence: -1000, risked_pence: 1000, roi_basis_points: -10000, strike_rate_basis_points: 0 },
  })),
  ...([["free_snr", 2000], ["free_sr", 3000]] as const).map(([stake_type, returns_pence]) => ({
    name: `${stake_type} won`,
    bets: [bet({ stake_type, returns_pence })],
    expected: { ...empty, won_count: 1, profit_pence: returns_pence, strike_rate_basis_points: 10000 },
  })),
  {
    name: "all free bets",
    bets: [bet({ id: 1, stake_type: "free_snr", returns_pence: 2000 }), bet({ id: 2, stake_type: "free_sr", returns_pence: 3000 })],
    expected: { ...empty, won_count: 2, profit_pence: 5000, strike_rate_basis_points: 10000 },
  },
  ...([1000, null] as const).map((returns_pence) => ({
    name: `void with ${returns_pence === null ? "null" : "recorded"} returns`,
    bets: [bet({ status: "void" as const, returns_pence })],
    expected: { ...empty, void_count: 1 },
  })),
  ...(["won", "placed"] as const).map((status, index) => ({
    name: `incomplete ${status}`,
    bets: [bet({ id: index + 7, status, returns_pence: null })],
    expected: { ...empty, [`${status}_count`]: 1, incomplete_count: 1, strike_rate_basis_points: status === "won" ? 10000 : 0 },
    incomplete: [index + 7],
  })),
  {
    name: "open excluded",
    bets: [bet({ status: "open", returns_pence: null })],
    expected: empty,
  },
  {
    name: "zero stake",
    bets: [bet({ stake_pence: 0, returns_pence: 0 })],
    expected: { ...empty, won_count: 1, strike_rate_basis_points: 10000 },
  },
  ...([100, 150] as const).map((odds_hundredths) => ({
    name: `odds boundary ${odds_hundredths}`,
    bets: [bet({ stake_pence: 333, odds_hundredths, returns_pence: 499 })],
    expected: { ...empty, won_count: 1, profit_pence: 166, risked_pence: 333, roi_basis_points: 4984, strike_rate_basis_points: 10000 },
  })),
  {
    name: "strike rate excludes void",
    bets: [
      bet({ id: 1 }), bet({ id: 2 }), bet({ id: 3 }),
      bet({ id: 4, status: "lost", returns_pence: null }),
      bet({ id: 5, status: "void", returns_pence: null }),
    ],
    expected: { ...empty, won_count: 3, lost_count: 1, void_count: 1, profit_pence: 3500, risked_pence: 4000, roi_basis_points: 8750, strike_rate_basis_points: 7500 },
  },
];

describe("computeStats", () => {
  it.each(cases)("aggregates $name", ({ bets, expected, incomplete = [] }) => {
    const stats = computeStats(bets);
    expect(stats.overall).toEqual(expected);
    expect(stats.incomplete_bet_ids).toEqual(incomplete);
  });

  it("groups by case-insensitive tipster name with null last", () => {
    const stats = computeStats([
      bet({ id: 1, tipster: { id: 2, name: "zoe" } }),
      bet({ id: 2, tipster: null, status: "lost", returns_pence: null }),
      bet({ id: 3, tipster: { id: 1, name: "Alice" }, status: "void" }),
    ]);
    expect(stats.by_tipster.map((row) => row.tipster?.name ?? null)).toEqual(["Alice", "zoe", null]);
    expect(stats.by_tipster.reduce((sum, row) => sum + row.won_count, 0)).toBe(stats.overall.won_count);
    expect(stats.by_tipster.reduce((sum, row) => sum + row.lost_count, 0)).toBe(stats.overall.lost_count);
    expect(stats.by_tipster.reduce((sum, row) => sum + row.void_count, 0)).toBe(stats.overall.void_count);
    expect(stats.by_tipster.reduce((sum, row) => sum + row.profit_pence, 0)).toBe(stats.overall.profit_pence);
    expect(stats.by_tipster.reduce((sum, row) => sum + row.risked_pence, 0)).toBe(stats.overall.risked_pence);
  });

  it("orders non-empty months newest first", () => {
    const stats = computeStats([
      bet({ id: 1, placed_at: "2026-01-01T00:30:00Z" }),
      bet({ id: 2, placed_at: "2026-03-01T00:30:00+01:00" }),
      bet({ id: 3, placed_at: "2026-07-15" }),
    ]);
    expect(stats.by_month.map((row) => row.month)).toEqual(["2026-07", "2026-03", "2026-01"]);
  });
});

describe("stats helpers", () => {
  it.each([
    ["2026-03-01T00:30:00+01:00", "2026-03-01", "2026-03"],
    ["2026-01-01T00:30:00Z", "2026-01-01", "2026-01"],
    ["2026-07-15", "2026-07-15", "2026-07"],
  ])("converts %s to London date and month", (value, date, month) => {
    expect(londonLocalDate(value)).toBe(date);
    expect(londonMonthKey(value)).toBe(month);
  });

  it.each([[1000, 30000, 333], [-1000, 30000, -333], [1, 0, null]])(
    "calculates basis points for %s / %s",
    (numerator, denominator, expected) => expect(basisPoints(numerator, denominator)).toBe(expected),
  );
});
