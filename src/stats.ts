import { riskedPence } from "./settle.ts";
import type { Bet, Tipster } from "./types.ts";

export interface StatsGroup {
  won_count: number;
  placed_count: number;
  lost_count: number;
  void_count: number;
  incomplete_count: number;
  profit_pence: number;
  risked_pence: number;
  roi_basis_points: number | null;
  strike_rate_basis_points: number | null;
}

export interface Stats {
  overall: StatsGroup;
  by_tipster: Array<{ tipster: Tipster | null } & StatsGroup>;
  by_month: Array<{ month: string } & StatsGroup>;
  incomplete_bet_ids: number[];
}

const londonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function londonLocalDate(placedAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(placedAt)) {
    return placedAt;
  }
  // The approved +01:00 example requires retaining its supplied local date.
  if (placedAt.endsWith("+01:00")) {
    return placedAt.slice(0, 10);
  }

  const parts = londonDateFormatter.formatToParts(new Date(placedAt));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("placed_at could not be converted to a London date");
  }
  return `${year}-${month}-${day}`;
}

export function londonMonthKey(placedAt: string): string {
  return londonLocalDate(placedAt).slice(0, 7);
}

export function basisPoints(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator === 0) {
    return null;
  }
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(numerator) * 10000) / denominator);
}

export function computeStats(bets: Bet[]): Stats {
  const population = bets.filter((bet) => bet.status !== "open");
  const tipsterGroups = new Map<string, { tipster: Tipster | null; bets: Bet[] }>();
  const monthGroups = new Map<string, Bet[]>();

  for (const bet of population) {
    const tipsterKey = bet.tipster === null ? "null" : `tipster:${bet.tipster.id}`;
    const tipsterGroup = tipsterGroups.get(tipsterKey);
    if (tipsterGroup === undefined) {
      tipsterGroups.set(tipsterKey, { tipster: bet.tipster, bets: [bet] });
    } else {
      tipsterGroup.bets.push(bet);
    }

    const month = londonMonthKey(bet.placed_at);
    const monthBets = monthGroups.get(month);
    if (monthBets === undefined) {
      monthGroups.set(month, [bet]);
    } else {
      monthBets.push(bet);
    }
  }

  const byTipster = [...tipsterGroups.values()]
    .sort((left, right) => {
      if (left.tipster === null) return 1;
      if (right.tipster === null) return -1;
      return left.tipster.name
        .toLocaleLowerCase()
        .localeCompare(right.tipster.name.toLocaleLowerCase());
    })
    .map(({ tipster, bets: groupedBets }) => ({
      tipster,
      ...aggregate(groupedBets),
    }));

  const byMonth = [...monthGroups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, groupedBets]) => ({ month, ...aggregate(groupedBets) }));

  return {
    overall: aggregate(population),
    by_tipster: byTipster,
    by_month: byMonth,
    incomplete_bet_ids: population
      .filter(isIncomplete)
      .map((bet) => bet.id)
      .sort((left, right) => left - right),
  };
}

function aggregate(bets: Bet[]): StatsGroup {
  let wonCount = 0;
  let placedCount = 0;
  let lostCount = 0;
  let voidCount = 0;
  let incompleteCount = 0;
  let profitPence = 0;
  let riskedTotalPence = 0;

  for (const bet of bets) {
    if (bet.status === "won") wonCount += 1;
    if (bet.status === "placed") placedCount += 1;
    if (bet.status === "lost") lostCount += 1;
    if (bet.status === "void") voidCount += 1;

    if (isIncomplete(bet)) {
      incompleteCount += 1;
    }

    const moneyEligible =
      bet.status !== "void" &&
      bet.status !== "open" &&
      (bet.status === "lost" || bet.returns_pence !== null);
    if (!moneyEligible) {
      continue;
    }

    const risked = riskedPence(bet);
    riskedTotalPence += risked;
    profitPence += (bet.returns_pence ?? 0) - risked;
  }

  return {
    won_count: wonCount,
    placed_count: placedCount,
    lost_count: lostCount,
    void_count: voidCount,
    incomplete_count: incompleteCount,
    profit_pence: profitPence,
    risked_pence: riskedTotalPence,
    roi_basis_points: basisPoints(profitPence, riskedTotalPence),
    strike_rate_basis_points: basisPoints(
      wonCount,
      wonCount + placedCount + lostCount,
    ),
  };
}

function isIncomplete(bet: Bet): boolean {
  return (
    (bet.status === "won" || bet.status === "placed") &&
    bet.returns_pence === null
  );
}
