import { SettlementError, settle } from "./settle.ts";
import type {
  Bet,
  BetVerification,
  Pence,
  VerifiedBet,
} from "./types.ts";

export interface VerificationReport {
  checked_count: number;
  ok_count: number;
  mismatch_count: number;
  uncheckable_count: number;
  net_delta_pence: Pence;
  discrepancies: VerifiedBet[];
}

const NOT_APPLICABLE: BetVerification = {
  status: "not_applicable",
  expected_returns_pence: null,
  delta_pence: null,
  error: null,
};

export function verifyBet(bet: Bet): BetVerification {
  if (bet.status === "open" || bet.returns_pence === null) {
    return NOT_APPLICABLE;
  }

  try {
    const expected = settle(bet).total_pence;
    const delta = bet.returns_pence - expected;
    return {
      status: delta === 0 ? "ok" : "mismatch",
      expected_returns_pence: expected,
      delta_pence: delta,
      error: null,
    };
  } catch (error) {
    if (!(error instanceof SettlementError)) {
      throw error;
    }
    return {
      status: "uncheckable",
      expected_returns_pence: null,
      delta_pence: null,
      error: error.message,
    };
  }
}

export function verifyBets(bets: VerifiedBet[]): VerificationReport {
  let okCount = 0;
  let mismatchCount = 0;
  let uncheckableCount = 0;
  let netDeltaPence = 0;
  const discrepancies: VerifiedBet[] = [];

  for (const bet of bets) {
    switch (bet.verification.status) {
      case "ok":
        okCount += 1;
        break;
      case "mismatch":
        mismatchCount += 1;
        netDeltaPence += bet.verification.delta_pence ?? 0;
        discrepancies.push(bet);
        break;
      case "uncheckable":
        uncheckableCount += 1;
        discrepancies.push(bet);
        break;
      case "not_applicable":
        break;
    }
  }

  discrepancies.sort((left, right) => left.id - right.id);
  return {
    checked_count: okCount + mismatchCount,
    ok_count: okCount,
    mismatch_count: mismatchCount,
    uncheckable_count: uncheckableCount,
    net_delta_pence: netDeltaPence,
    discrepancies,
  };
}
