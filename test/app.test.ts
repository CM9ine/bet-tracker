import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

const baseBet = {
  placed_at: "2026-03-15",
  event: "Test event",
  selection: "Test selection",
  stake_pence: 1000,
  odds: "2.5",
};

async function createBet(
  app: ReturnType<typeof createApp>,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await app.request("/bets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseBet, ...overrides }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

async function patchBet(
  app: ReturnType<typeof createApp>,
  id: number,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request("/bets/" + id, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("app", () => {
  it.each([
    ["won cash single", "won", {}, 2500, 1500],
    ["won cash single at evens", "won", { odds: "1.0" }, 1000, 0],
    ["lost cash single", "lost", {}, 0, -1000],
    ["void cash single", "void", {}, 1000, 0],
    ["void free SNR single", "void", { stake_type: "free_snr" }, 0, 0],
    ["won free SNR single", "won", { stake_type: "free_snr" }, 1500, 1500],
    ["won cash each-way", "won", { bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3 }, 3800, 1800],
    ["placed cash each-way", "placed", { bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3 }, 1300, -700],
    ["lost cash each-way", "lost", { bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3 }, 0, -2000],
    ["void cash each-way", "void", { bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3 }, 2000, 0],
    ["placed cash each-way with flooring", "placed", { stake_pence: 333, bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3 }, 432, -234],
  ] as const)("auto-settles %s", async (_name, status, terms, expectedReturns, expectedProfit) => {
    const app = createApp(openDb(":memory:"));
    const created = await createBet(app, terms);
    const response = await patchBet(app, created.id as number, { status });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status,
      returns_pence: expectedReturns,
      profit_pence: expectedProfit,
    });
  });

  it("auto-settles a settled POST and treats an explicit null return as auto", async () => {
    const app = createApp(openDb(":memory:"));
    const created = await createBet(app, { status: "won" });
    expect(created).toMatchObject({ returns_pence: 2500, profit_pence: 1500 });

    const open = await createBet(app, { selection: "Blank override" });
    const response = await patchBet(app, open.id as number, { status: "won", returns_pence: null });
    expect(await response.json()).toMatchObject({ returns_pence: 2500, profit_pence: 1500 });
  });

  it("preserves manual returns for no-op settlement writes and places_count edits", async () => {
    const app = createApp(openDb(":memory:"));
    const created = await createBet(app, {
      bet_type: "each_way",
      place_fraction_num: 1,
      place_fraction_den: 5,
      places_count: 3,
      status: "won",
      returns_pence: 2400,
    });
    const response = await patchBet(app, created.id as number, {
      odds: "2.50",
      places_count: 4,
    });
    expect(await response.json()).toMatchObject({
      places_count: 4,
      returns_pence: 2400,
      profit_pence: 400,
    });
  });

  it("preserves a manual override and reports its verification mismatch", async () => {
    const app = createApp(openDb(":memory:"));
    const created = await createBet(app);
    const response = await patchBet(app, created.id as number, { status: "won", returns_pence: 2400 });
    expect(await response.json()).toMatchObject({ returns_pence: 2400, profit_pence: 1400 });
    expect(await (await app.request("/verify")).json()).toMatchObject({
      discrepancies: [{ verification: { status: "mismatch", expected_returns_pence: 2500, delta_pence: -100, error: null } }],
    });
  });

  it("recomputes only when settlement inputs change and clears on un-settle", async () => {
    const app = createApp(openDb(":memory:"));
    const created = await createBet(app);
    const id = created.id as number;

    expect(await (await patchBet(app, id, { status: "won" })).json()).toMatchObject({ returns_pence: 2500, profit_pence: 1500 });
    expect(await (await patchBet(app, id, { event: "Ascot 15:05" })).json()).toMatchObject({ event: "Ascot 15:05", returns_pence: 2500 });
    expect(await (await patchBet(app, id, { odds: "3.0" })).json()).toMatchObject({ returns_pence: 3000, profit_pence: 2000 });
    expect(await (await patchBet(app, id, { status: "lost" })).json()).toMatchObject({ returns_pence: 0, profit_pence: -1000 });
    expect(await (await patchBet(app, id, { status: "open" })).json()).toMatchObject({ returns_pence: null, profit_pence: null });
  });

  it.each([
    ["each-way without place terms", { bet_type: "each_way", status: "placed" }, "place_fraction_num is required and must be a positive integer"],
    ["placed single", { status: "placed" }, "a single bet cannot have placed status"],
  ])("rejects settlement of a %s without writing", async (_name, patch, error) => {
    const db = openDb(":memory:");
    const app = createApp(db);
    const created = await createBet(app);
    if ("bet_type" in patch && patch.bet_type === "each_way") {
      db.prepare("UPDATE bets SET bet_type = 'each_way' WHERE id = ?").run(created.id);
    }

    const response = await patchBet(app, created.id as number, patch);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await (await app.request("/bets/" + created.id)).json()).toMatchObject({ status: "open", returns_pence: null });
  });

  it("responds to health check", async () => {
    const app = createApp(openDb(":memory:"));
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns the exact stats fixture and excludes open and deleted bets", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    await createBet(app, { selection: "A", status: "won", returns_pence: 2500 });
    await createBet(app, { selection: "B", odds: "2.0", status: "lost" });
    await createBet(app, { selection: "C", odds: "3.0", stake_type: "free_snr", status: "won", returns_pence: 2000 });
    await createBet(app, { selection: "D", status: "void", returns_pence: 1000 });
    const incomplete = await createBet(app, { selection: "E", status: "won", returns_pence: null });
    db.prepare("UPDATE bets SET returns_pence = NULL WHERE id = ?").run(incomplete.id);
    await createBet(app, { selection: "Open" });
    await createBet(app, { selection: "Deleted", status: "won", returns_pence: 9999 });
    expect((await app.request("/bets/7", { method: "DELETE" })).status).toBe(204);

    const response = await app.request("/stats");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      overall: {
        won_count: 3, placed_count: 0, lost_count: 1, void_count: 1,
        incomplete_count: 1, profit_pence: 2500, risked_pence: 2000,
        roi_basis_points: 12500, strike_rate_basis_points: 7500,
      },
      incomplete_bet_ids: [incomplete.id],
    });
  });

  it("applies inclusive London-date bounds and case-insensitive tipster filtering", async () => {
    const app = createApp(openDb(":memory:"));
    for (const [placed_at, selection] of [
      ["2026-02-28", "Before"], ["2026-03-01", "From"],
      ["2026-03-31", "To"], ["2026-04-01", "After"],
    ]) {
      await createBet(app, { placed_at, selection, tipster: "Bob", status: "won", returns_pence: 2500 });
    }
    await createBet(app, { selection: "Other", tipster: "Alice", status: "won", returns_pence: 2500 });

    const response = await app.request("/stats?from=2026-03-01&to=2026-03-31&tipster=bob");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      overall: { won_count: 2 },
      by_tipster: [{ tipster: { id: 1, name: "Bob" }, won_count: 2 }],
      by_month: [{ month: "2026-03", won_count: 2 }],
    });
  });

  it("validates filters and returns zeroed stats for an empty population", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { status: "won", returns_pence: 2500 });
    const malformed = await app.request("/stats?from=03-2026");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: expect.any(String) });

    const emptyResponse = await app.request("/stats?from=2026-04-01&to=2026-03-01");
    expect(emptyResponse.status).toBe(200);
    expect(await emptyResponse.json()).toEqual({
      overall: { won_count: 0, placed_count: 0, lost_count: 0, void_count: 0, incomplete_count: 0, profit_pence: 0, risked_pence: 0, roi_basis_points: null, strike_rate_basis_points: null },
      by_tipster: [], by_month: [], incomplete_bet_ids: [],
    });
  });

  it("orders months descending and tipsters case-insensitively with null last", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { placed_at: "2026-01-01T00:30:00Z", tipster: "zoe", status: "won", returns_pence: 2500 });
    await createBet(app, { placed_at: "2026-03-01T00:30:00+01:00", tipster: "Alice", status: "lost" });
    await createBet(app, { placed_at: "2026-03-31", status: "void" });

    const body = (await (await app.request("/stats")).json()) as {
      by_month: Array<{ month: string }>;
      by_tipster: Array<{ tipster: { name: string } | null }>;
    };
    expect(body.by_month.map((row) => row.month)).toEqual(["2026-03", "2026-01"]);
    expect(body.by_tipster.map((row) => row.tipster?.name ?? null)).toEqual(["Alice", "zoe", null]);
  });
  it("reports verification summaries and discrepancies", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { selection: "Matching", status: "won", returns_pence: 2500 });
    const short = await createBet(app, { selection: "Short", status: "won", returns_pence: 2499 });
    await createBet(app, { selection: "Open", status: "open", returns_pence: null });

    const response = await app.request("/verify");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked_count: 2,
      ok_count: 1,
      mismatch_count: 1,
      uncheckable_count: 0,
      net_delta_pence: -1,
      discrepancies: [
        expect.objectContaining({
          id: short.id,
          verification: {
            status: "mismatch",
            expected_returns_pence: 2500,
            delta_pence: -1,
            error: null,
          },
        }),
      ],
    });
  });

  it("filters verification by London date and tipster and validates dates", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { placed_at: "2026-07-31", selection: "Before", tipster: "X", status: "won", returns_pence: 2499 });
    await createBet(app, { placed_at: "2026-08-01", selection: "Included", tipster: "X", status: "won", returns_pence: 2499 });
    await createBet(app, { placed_at: "2026-08-01", selection: "Other", tipster: "Y", status: "won", returns_pence: 2499 });
    await createBet(app, { placed_at: "2026-08-02", selection: "After", tipster: "X", status: "won", returns_pence: 2499 });

    const response = await app.request("/verify?from=2026-08-01&to=2026-08-01&tipster=x");
    expect(response.status).toBe(200);
    const report = (await response.json()) as { discrepancies: Array<{ selection: string }> };
    expect(report.discrepancies.map((bet) => bet.selection)).toEqual(["Included"]);

    const malformed = await app.request("/verify?from=nonsense");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: expect.any(String) });
  });

  it("reports an uncheckable stored bet without returning 500", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { status: "placed", returns_pence: 1500 });

    const response = await app.request("/verify");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checked_count: 0,
      uncheckable_count: 1,
      discrepancies: [{
        verification: {
          status: "uncheckable",
          expected_returns_pence: null,
          delta_pence: null,
          error: "a single bet cannot have placed status",
        },
      }],
    });
  });

  it("includes verification on an individual bet response", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { status: "won", returns_pence: 2499 });

    expect(await (await app.request("/bets/1")).json()).toMatchObject({
      verification: {
        status: "mismatch",
        expected_returns_pence: 2500,
        delta_pence: -1,
        error: null,
      },
    });
  });
});
