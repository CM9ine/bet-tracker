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

describe("app", () => {
  it("responds to health check", async () => {
    const app = createApp(openDb(":memory:"));
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns the exact stats fixture and excludes open and deleted bets", async () => {
    const app = createApp(openDb(":memory:"));
    await createBet(app, { selection: "A", status: "won", returns_pence: 2500 });
    await createBet(app, { selection: "B", odds: "2.0", status: "lost" });
    await createBet(app, { selection: "C", odds: "3.0", stake_type: "free_snr", status: "won", returns_pence: 2000 });
    await createBet(app, { selection: "D", status: "void", returns_pence: 1000 });
    const incomplete = await createBet(app, { selection: "E", status: "won", returns_pence: null });
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
});
