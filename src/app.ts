import type Database from "better-sqlite3";
import { Hono } from "hono";
import { parseOdds } from "./odds.ts";
import { computeStats, londonLocalDate } from "./stats.ts";
import { createUi } from "./ui.ts";
import { verifyBet, verifyBets } from "./verify.ts";
import type {
  Bet,
  BetStatus,
  BetType,
  OddsHundredths,
  Pence,
  StakeType,
  Tipster,
  VerifiedBet,
} from "./types.ts";

const BET_TYPES = ["single", "each_way"] as const;
const STAKE_TYPES = ["cash", "free_snr", "free_sr"] as const;
const BET_STATUSES = ["open", "won", "placed", "lost", "void"] as const;

interface BetDbRow {
  id: number;
  placed_at: string;
  event: string;
  selection: string;
  tipster_id: number | null;
  tipster_name: string | null;
  stake_pence: number;
  odds_hundredths: number;
  bet_type: BetType;
  stake_type: StakeType;
  place_fraction_num: number | null;
  place_fraction_den: number | null;
  places_count: number | null;
  rule4_pence_in_pound: number | null;
  dead_heat_win_num: number | null;
  dead_heat_win_den: number | null;
  dead_heat_place_num: number | null;
  dead_heat_place_den: number | null;
  status: BetStatus;
  returns_pence: number | null;
  deleted_at: string | null;
}

interface ValidatedBet {
  placedAt: string;
  event: string;
  selection: string;
  tipsterName: string | null;
  stakePence: Pence;
  oddsHundredths: OddsHundredths;
  betType: BetType;
  stakeType: StakeType;
  placeFractionNum: number | null;
  placeFractionDen: number | null;
  placesCount: number | null;
  rule4PenceInPound: number | null;
  deadHeatWinNum: number | null;
  deadHeatWinDen: number | null;
  deadHeatPlaceNum: number | null;
  deadHeatPlaceDen: number | null;
  status: BetStatus;
  returnsPence: Pence | null;
}

class ValidationError extends Error {}

const SELECT_BET = `
  SELECT
    b.id,
    b.placed_at,
    b.event,
    b.selection,
    b.tipster_id,
    t.name AS tipster_name,
    b.stake_pence,
    b.odds_hundredths,
    b.bet_type,
    b.stake_type,
    b.place_fraction_num,
    b.place_fraction_den,
    b.places_count,
    b.rule4_pence_in_pound,
    b.dead_heat_win_num,
    b.dead_heat_win_den,
    b.dead_heat_place_num,
    b.dead_heat_place_den,
    b.status,
    b.returns_pence,
    b.deleted_at
  FROM bets b
  LEFT JOIN tipsters t ON t.id = b.tipster_id
`;

export function createApp(db: Database.Database): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/bets", async (c) => {
    try {
      const body = asObject(await c.req.json<unknown>());
      const bet = validateCreate(body);
      const id = db.transaction(() => {
        const tipsterId = resolveTipsterId(db, bet.tipsterName);
        const result = db
          .prepare(
            `INSERT INTO bets (
              placed_at, event, selection, tipster_id, stake_pence, odds_hundredths,
              bet_type, stake_type, place_fraction_num, place_fraction_den,
              places_count, rule4_pence_in_pound, dead_heat_win_num,
              dead_heat_win_den, dead_heat_place_num, dead_heat_place_den,
              status, returns_pence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            bet.placedAt,
            bet.event,
            bet.selection,
            tipsterId,
            bet.stakePence,
            bet.oddsHundredths,
            bet.betType,
            bet.stakeType,
            bet.placeFractionNum,
            bet.placeFractionDen,
            bet.placesCount,
            bet.rule4PenceInPound,
            bet.deadHeatWinNum,
            bet.deadHeatWinDen,
            bet.deadHeatPlaceNum,
            bet.deadHeatPlaceDen,
            bet.status,
            bet.returnsPence,
          );
        return Number(result.lastInsertRowid);
      })();

      const created = getBetRow(db, id);
      if (created === undefined) {
        throw new Error("created bet could not be read");
      }
      return c.json(toBet(created), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/bets", (c) => {
    try {
      const conditions = ["b.deleted_at IS NULL"];
      const parameters: string[] = [];
      const status = c.req.query("status");
      const tipster = c.req.query("tipster");

      if (status !== undefined) {
        validateStatus(status);
        conditions.push("b.status = ?");
        parameters.push(status);
      }
      if (tipster !== undefined) {
        conditions.push("t.name = ? COLLATE NOCASE");
        parameters.push(tipster);
      }

      const rows = db
        .prepare(
          `${SELECT_BET}
           WHERE ${conditions.join(" AND ")}
           ORDER BY b.placed_at DESC, b.id DESC`,
        )
        .all(...parameters) as BetDbRow[];

      return c.json(rows.map(toBet));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/stats", (c) => {
    try {
      const from = validateStatsDate(c.req.query("from"), "from");
      const to = validateStatsDate(c.req.query("to"), "to");
      const tipster = c.req.query("tipster");
      const conditions = ["b.deleted_at IS NULL", "b.status != 'open'"];
      const parameters: string[] = [];

      if (tipster !== undefined) {
        conditions.push("t.name = ? COLLATE NOCASE");
        parameters.push(tipster);
      }

      const rows = db
        .prepare(
          `${SELECT_BET}
           WHERE ${conditions.join(" AND ")}`,
        )
        .all(...parameters) as BetDbRow[];
      const bets = rows.map(toBet).filter((bet) => {
        const localDate = londonLocalDate(bet.placed_at);
        return (from === undefined || localDate >= from) &&
          (to === undefined || localDate <= to);
      });

      return c.json(computeStats(bets));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/verify", (c) => {
    try {
      const from = validateStatsDate(c.req.query("from"), "from");
      const to = validateStatsDate(c.req.query("to"), "to");
      const tipster = c.req.query("tipster");
      const conditions = ["b.deleted_at IS NULL", "b.status != 'open'"];
      const parameters: string[] = [];

      if (tipster !== undefined) {
        conditions.push("t.name = ? COLLATE NOCASE");
        parameters.push(tipster);
      }

      const rows = db
        .prepare(
          `${SELECT_BET}
           WHERE ${conditions.join(" AND ")}`,
        )
        .all(...parameters) as BetDbRow[];
      const bets = rows.map(toBet).filter((bet) => {
        const localDate = londonLocalDate(bet.placed_at);
        return (
          (from === undefined || localDate >= from) &&
          (to === undefined || localDate <= to)
        );
      });

      return c.json(verifyBets(bets));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/bets/:id", (c) => {
    const id = parseId(c.req.param("id"));
    const row = id === null ? undefined : getBetRow(db, id);
    if (row === undefined) {
      return c.json({ error: "bet not found" }, 404);
    }
    return c.json(toBet(row));
  });

  app.patch("/bets/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const existing = id === null ? undefined : getBetRow(db, id);
    if (existing === undefined || id === null) {
      return c.json({ error: "bet not found" }, 404);
    }

    try {
      const body = asObject(await c.req.json<unknown>());
      const bet = validatePatch(existing, body);

      db.transaction(() => {
        const tipsterId = resolveTipsterId(db, bet.tipsterName);
        db.prepare(
          `UPDATE bets SET
            placed_at = ?,
            event = ?,
            selection = ?,
            tipster_id = ?,
            stake_pence = ?,
            odds_hundredths = ?,
            bet_type = ?,
            stake_type = ?,
            place_fraction_num = ?,
            place_fraction_den = ?,
            places_count = ?,
            rule4_pence_in_pound = ?,
            dead_heat_win_num = ?,
            dead_heat_win_den = ?,
            dead_heat_place_num = ?,
            dead_heat_place_den = ?,
            status = ?,
            returns_pence = ?
          WHERE id = ? AND deleted_at IS NULL`,
        ).run(
          bet.placedAt,
          bet.event,
          bet.selection,
          tipsterId,
          bet.stakePence,
          bet.oddsHundredths,
          bet.betType,
          bet.stakeType,
          bet.placeFractionNum,
          bet.placeFractionDen,
          bet.placesCount,
          bet.rule4PenceInPound,
          bet.deadHeatWinNum,
          bet.deadHeatWinDen,
          bet.deadHeatPlaceNum,
          bet.deadHeatPlaceDen,
          bet.status,
          bet.returnsPence,
          id,
        );
      })();

      const updated = getBetRow(db, id);
      if (updated === undefined) {
        throw new Error("updated bet could not be read");
      }
      return c.json(toBet(updated));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.delete("/bets/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "bet not found" }, 404);
    }

    const result = db
      .prepare("UPDATE bets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(new Date().toISOString(), id);
    if (result.changes === 0) {
      return c.json({ error: "bet not found" }, 404);
    }
    return c.body(null, 204);
  });

  app.get("/tipsters", (c) => {
    const tipsters = db.prepare("SELECT id, name FROM tipsters ORDER BY name").all() as Tipster[];
    return c.json(tipsters);
  });

  app.route("/", createUi(app));

  return app;
}

function validateCreate(body: Record<string, unknown>): ValidatedBet {
  const odds = requireString(body.odds, "odds");

  return validateBet({
    placedAt: body.placed_at,
    event: body.event,
    selection: body.selection,
    tipsterName: parseTipsterName(body.tipster),
    stakePence: body.stake_pence,
    oddsHundredths: parseOdds(odds),
    betType: body.bet_type ?? "single",
    stakeType: body.stake_type ?? "cash",
    placeFractionNum: body.place_fraction_num ?? null,
    placeFractionDen: body.place_fraction_den ?? null,
    placesCount: body.places_count ?? null,
    rule4PenceInPound: body.rule4_pence_in_pound ?? null,
    deadHeatWinNum: body.dead_heat_win_num ?? null,
    deadHeatWinDen: body.dead_heat_win_den ?? null,
    deadHeatPlaceNum: body.dead_heat_place_num ?? null,
    deadHeatPlaceDen: body.dead_heat_place_den ?? null,
    status: body.status ?? "open",
    returnsPence: body.returns_pence ?? null,
  });
}

function validatePatch(existing: BetDbRow, body: Record<string, unknown>): ValidatedBet {
  return validateBet({
    placedAt: propertyOr(body, "placed_at", existing.placed_at),
    event: propertyOr(body, "event", existing.event),
    selection: propertyOr(body, "selection", existing.selection),
    tipsterName: hasProperty(body, "tipster")
      ? parseTipsterName(body.tipster)
      : existing.tipster_name,
    stakePence: propertyOr(body, "stake_pence", existing.stake_pence),
    oddsHundredths: hasProperty(body, "odds")
      ? parseOdds(requireString(body.odds, "odds"))
      : existing.odds_hundredths,
    betType: propertyOr(body, "bet_type", existing.bet_type),
    stakeType: propertyOr(body, "stake_type", existing.stake_type),
    placeFractionNum: propertyOr(body, "place_fraction_num", existing.place_fraction_num),
    placeFractionDen: propertyOr(body, "place_fraction_den", existing.place_fraction_den),
    placesCount: propertyOr(body, "places_count", existing.places_count),
    rule4PenceInPound: propertyOr(
      body,
      "rule4_pence_in_pound",
      existing.rule4_pence_in_pound,
    ),
    deadHeatWinNum: propertyOr(body, "dead_heat_win_num", existing.dead_heat_win_num),
    deadHeatWinDen: propertyOr(body, "dead_heat_win_den", existing.dead_heat_win_den),
    deadHeatPlaceNum: propertyOr(
      body,
      "dead_heat_place_num",
      existing.dead_heat_place_num,
    ),
    deadHeatPlaceDen: propertyOr(
      body,
      "dead_heat_place_den",
      existing.dead_heat_place_den,
    ),
    status: propertyOr(body, "status", existing.status),
    returnsPence: propertyOr(body, "returns_pence", existing.returns_pence),
  });
}

function validateBet(input: {
  placedAt: unknown;
  event: unknown;
  selection: unknown;
  tipsterName: string | null;
  stakePence: unknown;
  oddsHundredths: OddsHundredths;
  betType: unknown;
  stakeType: unknown;
  placeFractionNum: unknown;
  placeFractionDen: unknown;
  placesCount: unknown;
  rule4PenceInPound: unknown;
  deadHeatWinNum: unknown;
  deadHeatWinDen: unknown;
  deadHeatPlaceNum: unknown;
  deadHeatPlaceDen: unknown;
  status: unknown;
  returnsPence: unknown;
}): ValidatedBet {
  const placedAt = requireString(input.placedAt, "placed_at");
  if (!isValidPlacedAt(placedAt)) {
    throw new ValidationError("placed_at must be YYYY-MM-DD or a full ISO 8601 datetime");
  }

  const event = requireNonEmptyString(input.event, "event");
  const selection = requireNonEmptyString(input.selection, "selection");
  const stakePence = requirePositiveInteger(input.stakePence, "stake_pence");
  const betType = validateBetType(input.betType);
  const stakeType = validateStakeType(input.stakeType);
  const status = validateStatus(input.status);
  const placeFractionNum = optionalInteger(input.placeFractionNum, "place_fraction_num");
  const placeFractionDen = optionalInteger(input.placeFractionDen, "place_fraction_den");
  const placesCount = optionalInteger(input.placesCount, "places_count");
  const rule4PenceInPound = optionalInteger(
    input.rule4PenceInPound,
    "rule4_pence_in_pound",
  );
  if (
    rule4PenceInPound !== null &&
    (rule4PenceInPound < 0 || rule4PenceInPound > 90)
  ) {
    throw new ValidationError("rule4_pence_in_pound must be between 0 and 90");
  }
  const winDeadHeat = validateDeadHeatFraction(
    input.deadHeatWinNum,
    input.deadHeatWinDen,
    "dead_heat_win",
  );
  const placeDeadHeat = validateDeadHeatFraction(
    input.deadHeatPlaceNum,
    input.deadHeatPlaceDen,
    "dead_heat_place",
  );

  if (betType === "each_way") {
    requirePositivePlaceTerm(placeFractionNum, "place_fraction_num");
    requirePositivePlaceTerm(placeFractionDen, "place_fraction_den");
    requirePositivePlaceTerm(placesCount, "places_count");
  } else if (
    placeFractionNum !== null ||
    placeFractionDen !== null ||
    placesCount !== null
  ) {
    throw new ValidationError("single bets cannot include each-way place terms");
  }
  if (betType === "single" && placeDeadHeat.num !== null) {
    throw new ValidationError("single bets cannot include place dead heat terms");
  }

  let returnsPence: Pence | null = null;
  if (input.returnsPence !== null) {
    if (!Number.isInteger(input.returnsPence) || (input.returnsPence as number) < 0) {
      throw new ValidationError("returns_pence must be a non-negative integer");
    }
    returnsPence = input.returnsPence as Pence;
  }

  return {
    placedAt,
    event,
    selection,
    tipsterName: input.tipsterName,
    stakePence,
    oddsHundredths: input.oddsHundredths,
    betType,
    stakeType,
    placeFractionNum,
    placeFractionDen,
    placesCount,
    rule4PenceInPound,
    deadHeatWinNum: winDeadHeat.num,
    deadHeatWinDen: winDeadHeat.den,
    deadHeatPlaceNum: placeDeadHeat.num,
    deadHeatPlaceDen: placeDeadHeat.den,
    status,
    returnsPence,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (text.trim().length === 0) {
    throw new ValidationError(`${field} must not be empty`);
  }
  return text;
}

function parseTipsterName(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const name = requireString(value, "tipster").trim();
  return name.length === 0 ? null : name;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return value as number;
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  return value as number;
}

function validateDeadHeatFraction(
  numeratorInput: unknown,
  denominatorInput: unknown,
  field: string,
): { num: number | null; den: number | null } {
  const numerator = optionalInteger(numeratorInput, `${field}_num`);
  const denominator = optionalInteger(denominatorInput, `${field}_den`);
  if (numerator === null && denominator === null) {
    return { num: null, den: null };
  }
  if (numerator === null || denominator === null) {
    throw new ValidationError(
      `${field}_num and ${field}_den must both be null or integers`,
    );
  }
  if (numerator < 1 || denominator < 1 || numerator > denominator) {
    throw new ValidationError(`${field} must satisfy 1 <= num <= den`);
  }
  return { num: numerator, den: denominator };
}

function requirePositivePlaceTerm(value: number | null, field: string): asserts value is number {
  if (value === null || value <= 0) {
    throw new ValidationError(`${field} is required and must be a positive integer`);
  }
}

function validateBetType(value: unknown): BetType {
  if (typeof value !== "string" || !BET_TYPES.some((candidate) => candidate === value)) {
    throw new ValidationError("bet_type is invalid");
  }
  return value as BetType;
}

function validateStakeType(value: unknown): StakeType {
  if (typeof value !== "string" || !STAKE_TYPES.some((candidate) => candidate === value)) {
    throw new ValidationError("stake_type is invalid");
  }
  return value as StakeType;
}

function validateStatus(value: unknown): BetStatus {
  if (typeof value !== "string" || !BET_STATUSES.some((candidate) => candidate === value)) {
    throw new ValidationError("status is invalid");
  }
  return value as BetStatus;
}

function validateStatsDate(
  value: string | undefined,
  field: "from" | "to",
): string | undefined {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return value;
}

function isValidPlacedAt(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function resolveTipsterId(db: Database.Database, name: string | null): number | null {
  if (name === null) {
    return null;
  }

  db.prepare("INSERT OR IGNORE INTO tipsters(name) VALUES (?)").run(name);
  const tipster = db
    .prepare("SELECT id FROM tipsters WHERE name = ? COLLATE NOCASE")
    .get(name) as { id: number } | undefined;

  if (tipster === undefined) {
    throw new Error("tipster could not be resolved");
  }
  return tipster.id;
}

function getBetRow(db: Database.Database, id: number): BetDbRow | undefined {
  return db
    .prepare(`${SELECT_BET} WHERE b.id = ? AND b.deleted_at IS NULL`)
    .get(id) as BetDbRow | undefined;
}

function toBet(row: BetDbRow): VerifiedBet {
  const bet: Bet = {
    id: row.id,
    placed_at: row.placed_at,
    event: row.event,
    selection: row.selection,
    tipster:
      row.tipster_id === null || row.tipster_name === null
        ? null
        : { id: row.tipster_id, name: row.tipster_name },
    stake_pence: row.stake_pence,
    odds_hundredths: row.odds_hundredths,
    bet_type: row.bet_type,
    stake_type: row.stake_type,
    place_fraction_num: row.place_fraction_num,
    place_fraction_den: row.place_fraction_den,
    places_count: row.places_count,
    rule4_pence_in_pound: row.rule4_pence_in_pound,
    dead_heat_win_num: row.dead_heat_win_num,
    dead_heat_win_den: row.dead_heat_win_den,
    dead_heat_place_num: row.dead_heat_place_num,
    dead_heat_place_den: row.dead_heat_place_den,
    status: row.status,
    returns_pence: row.returns_pence,
  };
  return {
    ...bet,
    verification: verifyBet(bet),
  };
}

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function propertyOr(
  body: Record<string, unknown>,
  property: string,
  fallback: unknown,
): unknown {
  return hasProperty(body, property) ? body[property] : fallback;
}

function hasProperty(body: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, property);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "validation failed";
}
