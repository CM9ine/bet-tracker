/** All money values are integer pence. Never floats. See STANDARDS.md. */
export type Pence = number;

/**
 * Decimal odds stored as integer hundredths, e.g. 2.5 → 250, 11.0 → 1100.
 * See STANDARDS.md.
 */
export type OddsHundredths = number;

export type BetType = "single" | "each_way";
export type StakeType = "cash" | "free_snr" | "free_sr";
export type BetStatus = "open" | "won" | "placed" | "dead_heat" | "lost" | "void";

export interface Tipster {
  id: number;
  name: string;
}

export interface Bet {
  id: number;
  placed_at: string;
  event: string;
  selection: string;
  tipster: Tipster | null;
  stake_pence: Pence;
  odds_hundredths: OddsHundredths;
  bet_type: BetType;
  stake_type: StakeType;
  place_fraction_num: number | null;
  place_fraction_den: number | null;
  places_count: number | null;
  status: BetStatus;
  returns_pence: Pence | null;
}
