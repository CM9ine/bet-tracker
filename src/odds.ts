import type { OddsHundredths } from "./types.ts";

export class OddsValidationError extends Error {}

export function parseOdds(input: string): OddsHundredths {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input);
  if (match === null) {
    throw new OddsValidationError("odds must be a decimal string with at most 2 decimal places");
  }

  const whole = match[1];
  if (whole === undefined) {
    throw new OddsValidationError("odds must be a decimal string");
  }

  const fraction = (match[2] ?? "").padEnd(2, "0");
  const hundredths = Number(`${whole}${fraction}`);

  if (!Number.isSafeInteger(hundredths)) {
    throw new OddsValidationError("odds are too large");
  }
  if (hundredths < 100) {
    throw new OddsValidationError("odds must be at least 1.0");
  }

  return hundredths;
}
