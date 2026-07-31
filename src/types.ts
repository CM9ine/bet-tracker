/** All money values are integer pence. Never floats. See STANDARDS.md. */
export type Pence = number;

/**
 * Decimal odds stored as integer hundredths, e.g. 2.5 → 250, 11.0 → 1100.
 * See STANDARDS.md.
 */
export type OddsHundredths = number;
