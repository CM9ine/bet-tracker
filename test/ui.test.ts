import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

function setup(): Hono {
  return createApp(openDb(":memory:"));
}

async function submitForm(app: Hono, path: string, fields: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function createJson(app: Hono, overrides: Record<string, unknown> = {}): Promise<void> {
  const response = await app.request("/bets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      placed_at: "2026-08-01",
      event: "Ascot 14:30",
      selection: "Kyprios",
      stake_pence: 1000,
      odds: "2.5",
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
}

const basicForm = {
  placed_at: "2026-08-01",
  event: "Ascot 14:30",
  selection: "Kyprios",
  stake: "12.50",
  odds: "2.5",
};

describe("server-rendered UI", () => {
  it("renders the entry form as HTML", async () => {
    const response = await setup().request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html; charset=UTF-8");
    expect(await response.text()).toContain('<form action="/ui/bets" method="post">');
  });

  it("creates a bet from decimal form values", async () => {
    const app = setup();
    const response = await submitForm(app, "/ui/bets", basicForm);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(await (await app.request("/bets")).json()).toEqual([
      expect.objectContaining({
        stake_pence: 1250,
        odds_hundredths: 250,
        status: "open",
        returns_pence: null,
      }),
    ]);
  });

  it("persists each-way terms", async () => {
    const app = setup();
    const response = await submitForm(app, "/ui/bets", {
      ...basicForm,
      bet_type: "each_way",
      place_fraction_num: "1",
      place_fraction_den: "5",
      places_count: "3",
    });
    expect(response.status).toBe(303);
    expect(await (await app.request("/bets/1")).json()).toMatchObject({
      bet_type: "each_way",
      place_fraction_num: 1,
      place_fraction_den: 5,
      places_count: 3,
    });
  });

  it("omits blank advanced fields", async () => {
    const app = setup();
    const response = await submitForm(app, "/ui/bets", {
      ...basicForm,
      bet_type: "single",
      place_fraction_num: "",
      place_fraction_den: "",
      places_count: "",
      rule4_pence_in_pound: "",
      dead_heat_win_num: "",
      dead_heat_win_den: "",
      dead_heat_place_num: "",
      dead_heat_place_den: "",
    });
    expect(response.status).toBe(303);
  });

  it("returns the API error and preserves input after invalid submission", async () => {
    const app = setup();
    const response = await submitForm(app, "/ui/bets", {
      ...basicForm,
      event: "Preserve this event",
      odds: "2.555",
    });
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(body).toContain("odds must be a decimal string with at most 2 decimal places");
    expect(body).toContain("Preserve this event");
  });

  it("escapes user-supplied bet data", async () => {
    const app = setup();
    await createJson(app, { selection: "<script>alert(1)</script>" });
    const body = await (await app.request("/")).text();
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("settles with manually entered returns", async () => {
    const app = setup();
    await createJson(app);
    const response = await submitForm(app, "/ui/bets/1/settle", {
      status: "won",
      returns: "25.00",
    });
    expect(response.status).toBe(303);
    expect(await (await app.request("/bets/1")).json()).toMatchObject({
      status: "won",
      returns_pence: 2500,
    });
  });

  it("stores blank won returns as null and reports the bet incomplete", async () => {
    const app = setup();
    await createJson(app);
    expect((await submitForm(app, "/ui/bets/1/settle", { status: "won", returns: "" })).status).toBe(303);
    expect(await (await app.request("/bets/1")).json()).toMatchObject({ returns_pence: null });
    expect(await (await app.request("/stats")).json()).toMatchObject({ incomplete_bet_ids: [1] });
  });

  it("stores blank void returns as null without reporting incompleteness", async () => {
    const app = setup();
    await createJson(app);
    expect((await submitForm(app, "/ui/bets/1/settle", { status: "void", returns: "" })).status).toBe(303);
    expect(await (await app.request("/bets/1")).json()).toMatchObject({ returns_pence: null });
    expect(await (await app.request("/stats")).json()).toMatchObject({ incomplete_bet_ids: [] });
  });

  it.each([
    ["cash single", {}, "void returns stake: £10.00"],
    ["cash each-way", { bet_type: "each_way", place_fraction_num: 1, place_fraction_den: 5, places_count: 3 }, "void returns stake: £20.00"],
    ["free bet", { stake_type: "free_snr" }, "void returns nothing (free bet)"],
  ])("renders the void hint for a %s", async (_name, overrides, expected) => {
    const app = setup();
    await createJson(app, overrides);
    expect(await (await app.request("/")).text()).toContain(expected);
  });

  it("never pre-fills returns inputs for any status", async () => {
    const app = setup();
    for (const [index, status] of ["open", "won", "placed", "lost", "void"].entries()) {
      await createJson(app, {
        selection: `Status ${status}`,
        bet_type: status === "placed" ? "each_way" : "single",
        ...(status === "placed" ? { place_fraction_num: 1, place_fraction_den: 5, places_count: 3 } : {}),
        status,
        returns_pence: index === 0 ? null : 1000 + index,
      });
    }
    const body = await (await app.request("/")).text();
    const returnsInputs = body.match(/<input[^>]*name="returns"[^>]*>/g) ?? [];
    expect(returnsInputs).toHaveLength(5);
    for (const input of returnsInputs) expect(input).not.toMatch(/value="[^"]+"/);
  });

  it("soft-deletes from the row action", async () => {
    const app = setup();
    await createJson(app);
    const response = await submitForm(app, "/ui/bets/1/delete", {});
    expect(response.status).toBe(303);
    expect((await app.request("/bets/1")).status).toBe(404);
    expect(await (await app.request("/")).text()).not.toContain("Kyprios");
  });

  it("caps the list at the newest 50 bets", async () => {
    const app = setup();
    for (let index = 1; index <= 51; index += 1) {
      await createJson(app, { selection: `Selection ${index}` });
    }
    const body = await (await app.request("/")).text();
    expect(body.match(/data-bet-row/g)).toHaveLength(50);
    expect(body).toContain("Showing newest 50 of 51 bets.");
  });

  it("forwards status filters to the bets API", async () => {
    const app = setup();
    await createJson(app, { selection: "Only won", status: "won", returns_pence: 2500 });
    await createJson(app, { selection: "Still open" });
    const body = await (await app.request("/?status=won")).text();
    expect(body).toContain("Only won");
    expect(body).not.toContain("Still open");
  });

  it("renders list money consistently with stats", async () => {
    const app = setup();
    await createJson(app, { status: "won", returns_pence: 2500 });
    const list = await (await app.request("/")).text();
    expect(list).toContain("£10.00");
    expect(list).toContain("£25.00");
    expect(list).toContain("£15.00");
    const dashboard = await (await app.request("/stats/view")).text();
    expect(dashboard).toContain("£15.00");
    expect(dashboard).toContain("£10.00");
    expect(dashboard).toContain("150.00%");
  });

  it("renders the empty stats dashboard with em dashes for null rates", async () => {
    const response = await setup().request("/stats/view");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html; charset=UTF-8");
    expect(await response.text()).toContain("—");
  });
  it("renders verification details and an empty summary", async () => {
    const app = setup();
    const empty = await (await app.request("/verify/view")).text();
    expect(empty).toContain("Checked: 0");
    expect(empty).toContain("Mismatches: 0");
    expect(empty).toContain("Net delta: £0.00");

    await createJson(app, { selection: "Penny short", status: "won", returns_pence: 2499 });
    const response = await app.request("/verify/view");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html; charset=UTF-8");
    expect(body).toContain("Penny short");
    expect(body).toContain("£24.99");
    expect(body).toContain("£25.00");
    expect(body).toContain("-£0.01");
    expect(body).toContain("Checked: 1");
    expect(body).toContain("Mismatches: 1");
  });

  it("marks only mismatched bet rows and shows their expected return", async () => {
    const app = setup();
    await createJson(app, { selection: "Matching", status: "won", returns_pence: 2500 });
    await createJson(app, { selection: "Mismatched", status: "won", returns_pence: 2499 });

    const body = await (await app.request("/")).text();
    expect(body.match(/class="mismatch"/g)).toHaveLength(1);
    expect(body).toContain("<small>expected £25.00</small>");
  });

  it.each(["/", "/stats/view", "/verify/view"])(
    "links all three pages from %s",
    async (path) => {
      const body = await (await setup().request(path)).text();
      expect(body).toContain('<a href="/">Bets</a>');
      expect(body).toContain('<a href="/stats/view">Stats</a>');
      expect(body).toContain('<a href="/verify/view">Verify</a>');
    },
  );
});
