# Coding Standards

These rules are binding for all contributors, human and agent. PRs that violate
them get rejected regardless of whether the feature works.

## Money

- All monetary values are **integer pence** (`Pence` in `src/types.ts`).
  £12.50 is `1250`. Database columns storing money are `INTEGER` and named
  `*_pence`.
- **No floats anywhere in a money or odds path.** No `parseFloat`, no
  intermediate floating-point values. Formatting to `£x.yz` happens only at
  the display/API boundary.
- **Rounding rule (global):** intermediate calculations stay exact (integer
  arithmetic); only the **final return figure** is rounded, and it is
  **floored to the whole penny**.

## Odds

- Odds are entered in decimal form as bookmakers display them (e.g. `2.5`,
  `3.75`, `11.0`), always ≤ 2 decimal places.
- Odds are stored and computed as **integer hundredths**
  (`odds_hundredths`), e.g. `2.5` → `250`, `11.0` → `1100`.
- Parse decimal input strings straight to integer hundredths **without going
  through floating point** (split on the decimal point; never `parseFloat`).
- Total return for a win: `floor(stake_pence * odds_hundredths / 100)`.
- Decimal display of odds (e.g. "3.50") is a formatting concern only.

## Settlement

- Every settlement rule (won / lost / void / each-way / partial, etc.) requires
  **table-driven tests**: an array of cases with named inputs and expected
  outputs, covering boundary values (zero stake, evens `100`, odds-on like
  `150`, flooring edges).
- A settlement change without new or updated table cases is incomplete.

## General

- TypeScript strict mode; `npm run typecheck` and `npm test` must pass.
- Tests live in `test/`, written with Vitest.
- User data (`*.db`, `/data`) is never committed — this is a public repo.
