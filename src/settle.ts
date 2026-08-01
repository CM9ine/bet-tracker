import type {
  BetStatus,
  BetType,
  OddsHundredths,
  Pence,
  StakeType,
} from "./types.ts";

export class SettlementError extends Error {}

export interface Settlement {
  win_part_pence: Pence;
  place_part_pence: Pence;
  total_pence: Pence;
  profit_pence: Pence;
}

export interface SettlementInput {
  stake_pence: Pence;
  odds_hundredths: OddsHundredths;
  bet_type: BetType;
  stake_type: StakeType;
  status: BetStatus;
  place_fraction_num?: number | null;
  place_fraction_den?: number | null;
  rule4_pence_in_pound?: number | null;
  dead_heat_win_num?: number | null;
  dead_heat_win_den?: number | null;
  dead_heat_place_num?: number | null;
  dead_heat_place_den?: number | null;
}

export function settle(bet: SettlementInput): Settlement {
  if (bet.status === "open") {
    throw new SettlementError("an open bet cannot be settled");
  }
  if (bet.status === "placed" && bet.bet_type === "single") {
    throw new SettlementError("a single bet cannot have placed status");
  }

  const winDeadHeat = validateFraction(
    bet.dead_heat_win_num,
    bet.dead_heat_win_den,
    "win dead heat",
  );
  const placeDeadHeat = validateFraction(
    bet.dead_heat_place_num,
    bet.dead_heat_place_den,
    "place dead heat",
  );

  if (bet.bet_type === "single" && placeDeadHeat.supplied) {
    throw new SettlementError("single bets cannot include place dead heat terms");
  }
  if (bet.status === "placed" && winDeadHeat.supplied) {
    throw new SettlementError("placed bets cannot include win dead heat terms");
  }

  const rule4 = bet.rule4_pence_in_pound ?? 0;
  if (!Number.isInteger(rule4) || rule4 < 0 || rule4 > 90) {
    throw new SettlementError("rule4_pence_in_pound must be an integer from 0 to 90");
  }

  let placeFractionNum = 0;
  let placeFractionDen = 1;
  if (bet.bet_type === "each_way") {
    placeFractionNum = requirePositiveInteger(
      bet.place_fraction_num,
      "place_fraction_num",
    );
    placeFractionDen = requirePositiveInteger(
      bet.place_fraction_den,
      "place_fraction_den",
    );
  }

  const risked =
    bet.stake_type === "cash"
      ? bet.stake_pence * (bet.bet_type === "each_way" ? 2 : 1)
      : 0;

  if (bet.status === "void") {
    const totalPence = bet.stake_type === "cash" ? risked : 0;
    return settlement(0, 0, totalPence, risked);
  }
  if (bet.status === "lost") {
    return settlement(0, 0, 0, risked);
  }

  const stakeReturned = bet.stake_type === "free_snr" ? 0 : 1;
  const winPartPence =
    bet.status === "won"
      ? Math.floor(
          (bet.stake_pence *
            winDeadHeat.num *
            (stakeReturned * 10000 +
              (bet.odds_hundredths - 100) * (100 - rule4))) /
            (winDeadHeat.den * 10000),
        )
      : 0;
  const placePartPence =
    bet.bet_type === "each_way" &&
    (bet.status === "won" || bet.status === "placed")
      ? Math.floor(
          (bet.stake_pence *
            placeDeadHeat.num *
            (stakeReturned * 10000 * placeFractionDen +
              (bet.odds_hundredths - 100) *
                placeFractionNum *
                (100 - rule4))) /
            (placeDeadHeat.den * 10000 * placeFractionDen),
        )
      : 0;
  const totalPence = winPartPence + placePartPence;

  return settlement(winPartPence, placePartPence, totalPence, risked);
}

function validateFraction(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  name: string,
): { num: number; den: number; supplied: boolean } {
  const supplied =
    (numerator !== null && numerator !== undefined) ||
    (denominator !== null && denominator !== undefined);
  if (!supplied) {
    return { num: 1, den: 1, supplied: false };
  }
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    (numerator as number) < 1 ||
    (denominator as number) < 1 ||
    (numerator as number) > (denominator as number)
  ) {
    throw new SettlementError(`${name} must be two integers with 1 <= num <= den`);
  }
  return { num: numerator as number, den: denominator as number, supplied: true };
}

function requirePositiveInteger(
  value: number | null | undefined,
  name: string,
): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new SettlementError(
      `${name} is required and must be a positive integer`,
    );
  }
  return value as number;
}

function settlement(
  winPartPence: Pence,
  placePartPence: Pence,
  totalPence: Pence,
  risked: Pence,
): Settlement {
  return {
    win_part_pence: winPartPence,
    place_part_pence: placePartPence,
    total_pence: totalPence,
    profit_pence: totalPence - risked,
  };
}
