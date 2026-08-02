import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

type TestApp = Hono;

const baseBet = {
  placed_at: "2026-07-31",
  event: "Ascot 15:40",
  selection: "Baaeed",
  stake_pence: 1000,
  odds: "2.5",
};

function setup(): { app: TestApp; db: Database.Database } {
  const db = openDb(":memory:");
  return { app: createApp(db), db };
}

async function sendJson(
  app: TestApp,
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createBet(
  app: TestApp,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  return sendJson(app, "/bets", "POST", { ...baseBet, ...overrides });
}

describe("bets API", () => {
  it("creates a single with defaults and raw integer response fields", async () => {
    const { app } = setup();
    const response = await createBet(app);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 1,
      placed_at: "2026-07-31",
      event: "Ascot 15:40",
      selection: "Baaeed",
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
      status: "open",
      returns_pence: null,
      profit_pence: null,
      verification: {
        status: "not_applicable",
        expected_returns_pence: null,
        delta_pence: null,
        error: null,
      },
    });
  });

  it("creates an each-way bet while preserving its unit stake", async () => {
    const { app } = setup();
    const response = await createBet(app, {
      bet_type: "each_way",
      odds: "6.0",
      place_fraction_num: 1,
      place_fraction_den: 5,
      places_count: 3,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      stake_pence: 1000,
      odds_hundredths: 600,
      bet_type: "each_way",
      place_fraction_num: 1,
      place_fraction_den: 5,
      places_count: 3,
    });
  });

  it.each([
    ["each-way without place terms", { bet_type: "each_way" }],
    ["single with place terms", { places_count: 3 }],
    ["zero stake", { stake_pence: 0 }],
    ["negative stake", { stake_pence: -100 }],
    ["odds below evens", { odds: "0.99" }],
    ["odds with more than two decimal places", { odds: "2.555" }],
    ["invalid date", { placed_at: "31/07/2026" }],
  ])("rejects %s", async (_name, overrides) => {
    const { app } = setup();
    const response = await createBet(app, overrides);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it.each(["2026-07-31", "2026-07-31T15:40:00Z"])(
    "accepts placed_at %s",
    async (placedAt) => {
      const { app } = setup();
      expect((await createBet(app, { placed_at: placedAt })).status).toBe(201);
    },
  );

  it("accepts two-decimal odds", async () => {
    const { app } = setup();
    const response = await createBet(app, { odds: "2.50" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ odds_hundredths: 250 });
  });

  it("upserts tipsters case-insensitively and preserves the first spelling", async () => {
    const { app, db } = setup();
    const first = await createBet(app, { tipster: "Hugh Taylor" });
    const second = await createBet(app, {
      event: "York 14:10",
      selection: "Second Pick",
      tipster: "  hugh taylor ",
    });

    expect(db.prepare("SELECT COUNT(*) AS count FROM tipsters").get()).toEqual({ count: 1 });
    const firstBody = (await first.json()) as { tipster: unknown };
    const secondBody = (await second.json()) as { tipster: unknown };
    expect(firstBody.tipster).toEqual({ id: 1, name: "Hugh Taylor" });
    expect(secondBody.tipster).toEqual({ id: 1, name: "Hugh Taylor" });

    const response = await app.request("/tipsters");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 1, name: "Hugh Taylor" }]);
  });

  it("lists newest bets first and filters by status and tipster", async () => {
    const { app } = setup();
    await createBet(app, {
      placed_at: "2026-07-30",
      selection: "Old",
      tipster: "Hugh Taylor",
    });
    await createBet(app, {
      selection: "Newer first",
      tipster: "Hugh Taylor",
      status: "won",
    });
    await createBet(app, {
      selection: "Newest by id",
      tipster: "Other",
    });

    const all = (await (await app.request("/bets")).json()) as Array<{ selection: string }>;
    expect(all.map((bet: { selection: string }) => bet.selection)).toEqual([
      "Newest by id",
      "Newer first",
      "Old",
    ]);

    const filtered = (await (
      await app.request("/bets?status=won&tipster=hugh%20taylor")
    ).json()) as Array<{ selection: string; status: string }>;
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ selection: "Newer first", status: "won" });

    const unknown = await app.request("/bets?tipster=unknown");
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual([]);
  });

  it("returns 404 for a missing bet", async () => {
    const { app } = setup();
    const response = await app.request("/bets/999");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("patches settled bets and revalidates the merged row", async () => {
    const { app } = setup();
    await createBet(app, { status: "won" });

    const stakeResponse = await sendJson(app, "/bets/1", "PATCH", { stake_pence: 2000 });
    expect(stakeResponse.status).toBe(200);
    expect(await stakeResponse.json()).toMatchObject({ status: "won", stake_pence: 2000 });

    const invalidResponse = await sendJson(app, "/bets/1", "PATCH", { stake_pence: 0 });
    expect(invalidResponse.status).toBe(400);
  });

  it("stores supplied returns verbatim and computes missing settled returns", async () => {
    const { app } = setup();
    await createBet(app);
    await createBet(app, { selection: "Second" });

    const stored = await sendJson(app, "/bets/1", "PATCH", {
      status: "won",
      returns_pence: 2500,
    });
    expect(await stored.json()).toMatchObject({ status: "won", returns_pence: 2500 });

    const untouched = await sendJson(app, "/bets/2", "PATCH", { status: "won" });
    expect(await untouched.json()).toMatchObject({ status: "won", returns_pence: 2500, profit_pence: 1500 });
  });

  it("soft-deletes a bet and returns 404 when deleting it twice", async () => {
    const { app, db } = setup();
    await createBet(app);

    expect((await app.request("/bets/1", { method: "DELETE" })).status).toBe(204);
    const stored = db.prepare("SELECT deleted_at FROM bets WHERE id = 1").get() as {
      deleted_at: string | null;
    };
    expect(stored.deleted_at).toEqual(expect.any(String));
    expect((await app.request("/bets/1")).status).toBe(404);
    expect(await (await app.request("/bets")).json()).toEqual([]);
    expect((await app.request("/bets/1", { method: "DELETE" })).status).toBe(404);
  });

  it.each(["cash", "free_snr", "free_sr"])("round-trips stake_type %s", async (stakeType) => {
    const { app } = setup();
    const response = await createBet(app, { stake_type: stakeType });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ stake_type: stakeType });
  });

  it("rejects placed status for a single", async () => {
    const { app } = setup();
    const response = await createBet(app, { status: "placed" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "a single bet cannot have placed status" });
  });

  it("round-trips Rule 4 and dead-heat terms through create, get, and patch", async () => {
    const { app } = setup();
    const created = await createBet(app, {
      rule4_pence_in_pound: 25,
      dead_heat_win_num: 1,
      dead_heat_win_den: 2,
    });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      rule4_pence_in_pound: 25,
      dead_heat_win_num: 1,
      dead_heat_win_den: 2,
      dead_heat_place_num: null,
      dead_heat_place_den: null,
    });

    expect(await (await app.request("/bets/1")).json()).toMatchObject({
      rule4_pence_in_pound: 25,
      dead_heat_win_num: 1,
      dead_heat_win_den: 2,
    });

    const patched = await sendJson(app, "/bets/1", "PATCH", {
      rule4_pence_in_pound: 10,
      dead_heat_win_num: 1,
      dead_heat_win_den: 3,
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      rule4_pence_in_pound: 10,
      dead_heat_win_num: 1,
      dead_heat_win_den: 3,
    });
  });

  it.each([
    ["dead_heat status", { status: "dead_heat" }],
    ["Rule 4 above 90", { rule4_pence_in_pound: 91 }],
    [
      "place dead heat on a single",
      { dead_heat_place_num: 1, dead_heat_place_den: 2 },
    ],
  ])("rejects %s", async (_name, overrides) => {
    const { app } = setup();
    const response = await createBet(app, overrides);
    expect(response.status).toBe(400);
  });
});
