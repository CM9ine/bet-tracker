import type { Pence } from "./types.ts";

export class MoneyValidationError extends Error {}

export function parsePence(input: string): Pence {
  const text = input.trim().replace(/^£/, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (match === null) {
    throw new MoneyValidationError(
      "money must be a non-negative decimal with at most 2 decimal places",
    );
  }

  const whole = match[1];
  if (whole === undefined) {
    throw new MoneyValidationError("money must be a decimal string");
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const pence = Number(`${whole}${fraction}`);
  if (!Number.isSafeInteger(pence)) {
    throw new MoneyValidationError("money amount is too large");
  }
  return pence;
}

export function formatPence(pence: Pence): string {
  const sign = pence < 0 ? "-" : "";
  const absolute = Math.abs(pence);
  const pounds = Math.floor(absolute / 100);
  const pennies = String(absolute % 100).padStart(2, "0");
  return `${sign}£${pounds}.${pennies}`;
}
