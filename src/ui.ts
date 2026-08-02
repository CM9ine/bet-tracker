import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { formatPence, parsePence } from "./money.ts";
import { formatOdds } from "./odds.ts";
import { riskedPence } from "./settle.ts";
import { londonLocalDate, type Stats, type StatsGroup } from "./stats.ts";
import type { Tipster, VerifiedBet } from "./types.ts";
import type { VerificationReport } from "./verify.ts";

type HtmlContent = ReturnType<typeof html>;

const INTEGER_FIELDS = [
  "place_fraction_num",
  "place_fraction_den",
  "places_count",
  "rule4_pence_in_pound",
  "dead_heat_win_num",
  "dead_heat_win_den",
  "dead_heat_place_num",
  "dead_heat_place_den",
] as const;

const BET_STATUSES = ["open", "won", "placed", "lost", "void"] as const;

type FormValues = Record<string, string>;

export function createUi(api: Hono): Hono {
  const ui = new Hono();

  ui.get("/", async (c) => renderBetsPage(c, api));

  ui.get("/stats/view", async (c) => {
    const filters = {
      from: c.req.query("from") ?? "",
      to: c.req.query("to") ?? "",
      tipster: c.req.query("tipster") ?? "",
    };
    const response = await api.request(queryPath("/stats", filters));
    if (!response.ok) {
      return c.html(
        statsPage(emptyStats(), filters, await readApiError(response)),
        400,
      );
    }
    return c.html(statsPage((await response.json()) as Stats, filters));
  });

  ui.get("/verify/view", async (c) => {
    const filters = {
      from: c.req.query("from") ?? "",
      to: c.req.query("to") ?? "",
      tipster: c.req.query("tipster") ?? "",
    };
    const response = await api.request(queryPath("/verify", filters));
    if (!response.ok) {
      return c.html(
        verifyPage(emptyVerificationReport(), filters, await readApiError(response)),
        400,
      );
    }
    return c.html(
      verifyPage((await response.json()) as VerificationReport, filters),
    );
  });

  ui.post("/ui/bets", async (c) => {
    const values = formValues(await c.req.parseBody());
    try {
      const body: Record<string, unknown> = {
        placed_at: value(values, "placed_at"),
        event: value(values, "event"),
        selection: value(values, "selection"),
        stake_pence: parsePence(value(values, "stake")),
        odds: value(values, "odds"),
        bet_type: value(values, "bet_type") || "single",
        stake_type: value(values, "stake_type") || "cash",
      };
      const tipster = value(values, "tipster");
      if (tipster.trim() !== "") body.tipster = tipster;
      for (const field of INTEGER_FIELDS) {
        const input = value(values, field);
        if (input === "") continue;
        if (!/^\d+$/.test(input)) {
          throw new Error(`${field} must be a non-negative integer`);
        }
        const integer = Number(input);
        if (!Number.isSafeInteger(integer)) {
          throw new Error(`${field} is too large`);
        }
        body[field] = integer;
      }

      const response = await api.request("/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return renderBetsPage(c, api, await readApiError(response), values, 400);
      }
      return c.redirect("/", 303);
    } catch (error) {
      return renderBetsPage(c, api, errorMessage(error), values, 400);
    }
  });

  ui.post("/ui/bets/:id/settle", async (c) => {
    const values = formValues(await c.req.parseBody());
    try {
      const returns = value(values, "returns");
      const response = await api.request(`/bets/${c.req.param("id")}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: value(values, "status"),
          returns_pence: returns === "" ? null : parsePence(returns),
        }),
      });
      if (!response.ok) {
        return renderBetsPage(c, api, await readApiError(response), undefined, 400);
      }
      return c.redirect("/", 303);
    } catch (error) {
      return renderBetsPage(c, api, errorMessage(error), undefined, 400);
    }
  });

  ui.post("/ui/bets/:id/delete", async (c) => {
    await c.req.parseBody();
    const response = await api.request(`/bets/${c.req.param("id")}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      return renderBetsPage(c, api, await readApiError(response), undefined, 400);
    }
    return c.redirect("/", 303);
  });

  return ui;
}

async function renderBetsPage(
  c: Context,
  api: Hono,
  error: string | null = null,
  submittedValues?: FormValues,
  status: 200 | 400 = 200,
): Promise<Response> {
  const filters = {
    status: c.req.query("status") ?? "",
    tipster: c.req.query("tipster") ?? "",
  };
  const [betsResponse, tipstersResponse] = await Promise.all([
    api.request(queryPath("/bets", filters)),
    api.request("/tipsters"),
  ]);
  const bets = betsResponse.ok
    ? ((await betsResponse.json()) as VerifiedBet[])
    : [];
  const tipsters = tipstersResponse.ok
    ? ((await tipstersResponse.json()) as Tipster[])
    : [];
  const loadError = !betsResponse.ok
    ? await readApiError(betsResponse)
    : !tipstersResponse.ok
      ? await readApiError(tipstersResponse)
      : null;
  const values = submittedValues ?? {
    placed_at: londonLocalDate(new Date().toISOString()),
  };
  return c.html(betsPage(bets, tipsters, filters, values, error ?? loadError), status);
}

function betsPage(
  bets: VerifiedBet[],
  tipsters: Tipster[],
  filters: { status: string; tipster: string },
  values: FormValues,
  error: string | null,
): HtmlContent {
  const visibleBets = bets.slice(0, 50);
  return layout(
    "Bet tracker",
    html`
      <header>
        <h1>Bet tracker</h1>
        <nav><a href="/">Bets</a><a href="/stats/view">Stats</a><a href="/verify/view">Verify</a></nav>
      </header>
      ${error === null ? "" : html`<div class="error" role="alert">${error}</div>`}
      <section>
        <h2>Record a bet</h2>
        <form action="/ui/bets" method="post">
          <div class="form-grid">
            <label>Date <input type="date" name="placed_at" value=${value(values, "placed_at")} required></label>
            <label>Event <input type="text" name="event" value=${value(values, "event")} required></label>
            <label>Selection <input type="text" name="selection" value=${value(values, "selection")} required></label>
            <label>Tipster
              <input type="text" name="tipster" list="tipsters" value=${value(values, "tipster")}>
              <datalist id="tipsters">${tipsters.map((tipster) => html`<option value=${tipster.name}></option>`)}</datalist>
            </label>
            <label>Stake (£) <input type="text" name="stake" placeholder="12.50" value=${value(values, "stake")} required></label>
            <label>Odds <input type="text" name="odds" placeholder="2.5" value=${value(values, "odds")} required></label>
            <label>Bet type
              <select name="bet_type">
                ${option("single", "Single", value(values, "bet_type") || "single")}
                ${option("each_way", "Each-way", value(values, "bet_type") || "single")}
              </select>
            </label>
            <label>Stake type
              <select name="stake_type">
                ${option("cash", "Cash", value(values, "stake_type") || "cash")}
                ${option("free_snr", "Free SNR", value(values, "stake_type") || "cash")}
                ${option("free_sr", "Free SR", value(values, "stake_type") || "cash")}
              </select>
            </label>
            ${eachWayIntegerInput("Place fraction numerator", "place_fraction_num", values)}
            ${eachWayIntegerInput("Place fraction denominator", "place_fraction_den", values)}
            ${eachWayIntegerInput("Places count", "places_count", values)}
          </div>
          <details>
            <summary>Advanced</summary>
            <div class="form-grid advanced">
              ${integerInput("Rule 4 pence in pound", "rule4_pence_in_pound", values)}
              ${integerInput("Win dead heat numerator", "dead_heat_win_num", values)}
              ${integerInput("Win dead heat denominator", "dead_heat_win_den", values)}
              ${integerInput("Place dead heat numerator", "dead_heat_place_num", values)}
              ${integerInput("Place dead heat denominator", "dead_heat_place_den", values)}
            </div>
          </details>
          <button type="submit">Add bet</button>
        </form>
        <script>
          const betType = document.querySelector('select[name="bet_type"]');
          const placeTerms = document.querySelectorAll("[data-each-way-required]");
          const syncEachWayRequired = () => {
            for (const input of placeTerms) {
              input.required = betType?.value === "each_way";
            }
          };
          betType?.addEventListener("change", syncEachWayRequired);
          syncEachWayRequired();
        </script>
      </section>
      <section>
        <div class="section-heading">
          <h2>Bets</h2>
          <form action="/" method="get" class="filters">
            <label>Status
              <select name="status">
                ${option("", "All", filters.status)}
                ${BET_STATUSES.map((status) => option(status, status, filters.status))}
              </select>
            </label>
            <label>Tipster <input type="text" name="tipster" value=${filters.tipster}></label>
            <button type="submit">Filter</button>
          </form>
        </div>
        ${bets.length > 50 ? html`<p>Showing newest 50 of ${bets.length} bets.</p>` : ""}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Event</th><th>Selection</th><th>Tipster</th><th>Type</th><th>Stake</th><th>Risked</th><th>Odds</th><th>Status</th><th>Returns</th><th>Profit</th><th>Actions</th></tr></thead>
            <tbody>${visibleBets.map(betRow)}</tbody>
          </table>
        </div>
      </section>
    `,
  );
}

function betRow(bet: VerifiedBet): HtmlContent {
  const risked = riskedPence(bet);
  const profit = bet.profit_pence === null ? "—" : formatPence(bet.profit_pence);
  const hint = bet.stake_type === "cash"
    ? `void returns stake: ${formatPence(risked)}`
    : "void returns nothing (free bet)";
  const mismatchAttribute = bet.verification.status === "mismatch"
    ? html` class="mismatch"`
    : "";

  return html`
    <tr data-bet-row${mismatchAttribute}>
      <td>${londonLocalDate(bet.placed_at)}</td>
      <td>${bet.event}</td>
      <td>${bet.selection}</td>
      <td>${bet.tipster?.name ?? "—"}</td>
      <td>${bet.bet_type} / ${bet.stake_type}</td>
      <td>${formatPence(bet.stake_pence)}</td>
      <td>${formatPence(risked)}</td>
      <td>${formatOdds(bet.odds_hundredths)}</td>
      <td>${bet.status}</td>
      <td>${bet.returns_pence === null
        ? "—"
        : bet.verification.status === "mismatch"
          ? html`${formatPence(bet.returns_pence)} <small>expected ${formatPence(bet.verification.expected_returns_pence as number)}</small>`
          : formatPence(bet.returns_pence)}</td>
      <td>${profit}</td>
      <td class="actions">
        <form action=${`/ui/bets/${bet.id}/settle`} method="post">
          <select name="status" aria-label="Status">
            ${BET_STATUSES.map((status) => option(status, status, bet.status))}
          </select>
          <input type="text" name="returns" placeholder="Auto" aria-label="Returns">
          <small>Calculated automatically when blank; ${hint}</small>
          <button type="submit">Settle</button>
        </form>
        <form action=${`/ui/bets/${bet.id}/delete`} method="post">
          <button type="submit">Delete</button>
        </form>
      </td>
    </tr>
  `;
}

function verifyPage(
  report: VerificationReport,
  filters: { from: string; to: string; tipster: string },
  error: string | null = null,
): HtmlContent {
  return layout(
    "Bet tracker verification",
    html`
      <header>
        <h1>Returns verification</h1>
        <nav><a href="/">Bets</a><a href="/stats/view">Stats</a><a href="/verify/view">Verify</a></nav>
      </header>
      ${error === null ? "" : html`<div class="error" role="alert">${error}</div>`}
      <section>
        <form action="/verify/view" method="get" class="filters">
          <label>From <input type="date" name="from" value=${filters.from}></label>
          <label>To <input type="date" name="to" value=${filters.to}></label>
          <label>Tipster <input type="text" name="tipster" value=${filters.tipster}></label>
          <button type="submit">Filter</button>
        </form>
      </section>
      <section>
        <h2>Summary</h2>
        <p>Checked: ${report.checked_count} · OK: ${report.ok_count} · Mismatches: ${report.mismatch_count} · Uncheckable: ${report.uncheckable_count} · Net delta: ${formatPence(report.net_delta_pence)}</p>
      </section>
      <section>
        <h2>Discrepancies</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Event</th><th>Selection</th><th>Tipster</th><th>Status</th><th>Stake</th><th>Odds</th><th>Recorded</th><th>Expected</th><th>Delta</th><th>Error</th></tr></thead>
            <tbody>
              ${report.discrepancies.map((bet) => html`
                <tr>
                  <td>${londonLocalDate(bet.placed_at)}</td>
                  <td>${bet.event}</td>
                  <td>${bet.selection}</td>
                  <td>${bet.tipster?.name ?? "—"}</td>
                  <td>${bet.status}</td>
                  <td>${formatPence(bet.stake_pence)}</td>
                  <td>${formatOdds(bet.odds_hundredths)}</td>
                  <td>${bet.returns_pence === null ? "—" : formatPence(bet.returns_pence)}</td>
                  <td>${bet.verification.expected_returns_pence === null ? "—" : formatPence(bet.verification.expected_returns_pence)}</td>
                  <td>${bet.verification.delta_pence === null ? "—" : formatPence(bet.verification.delta_pence)}</td>
                  <td>${bet.verification.error ?? "—"}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </section>
    `,
  );
}

function statsPage(
  stats: Stats,
  filters: { from: string; to: string; tipster: string },
  error: string | null = null,
): HtmlContent {
  return layout(
    "Bet tracker stats",
    html`
      <header>
        <h1>Stats dashboard</h1>
        <nav><a href="/">Bets</a><a href="/stats/view">Stats</a><a href="/verify/view">Verify</a></nav>
      </header>
      ${error === null ? "" : html`<div class="error" role="alert">${error}</div>`}
      <section>
        <form action="/stats/view" method="get" class="filters">
          <label>From <input type="date" name="from" value=${filters.from}></label>
          <label>To <input type="date" name="to" value=${filters.to}></label>
          <label>Tipster <input type="text" name="tipster" value=${filters.tipster}></label>
          <button type="submit">Filter</button>
        </form>
      </section>
      <section>
        <h2>Overall</h2>
        ${statsTable(["Overall"], [stats.overall])}
      </section>
      <section>
        <h2>By tipster</h2>
        ${statsTable(
          stats.by_tipster.map((row) => row.tipster?.name ?? "(none)"),
          stats.by_tipster,
        )}
      </section>
      <section>
        <h2>By month</h2>
        ${statsTable(stats.by_month.map((row) => row.month), stats.by_month)}
      </section>
    `,
  );
}

function statsTable(labels: string[], groups: StatsGroup[]): HtmlContent {
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr><th>Group</th><th>Won</th><th>Placed</th><th>Lost</th><th>Void</th><th>Incomplete</th><th>Profit</th><th>Risked</th><th>ROI</th><th>Strike rate</th></tr></thead>
        <tbody>
          ${groups.map((group, index) => html`
            <tr>
              <th>${labels[index] ?? ""}</th>
              <td>${group.won_count}</td>
              <td>${group.placed_count}</td>
              <td>${group.lost_count}</td>
              <td>${group.void_count}</td>
              <td>${group.incomplete_count}</td>
              <td>${formatPence(group.profit_pence)}</td>
              <td>${formatPence(group.risked_pence)}</td>
              <td>${formatBasisPoints(group.roi_basis_points)}</td>
              <td>${formatBasisPoints(group.strike_rate_basis_points)}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function layout(title: string, content: HtmlContent): HtmlContent {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <style>
          :root { color-scheme: light; font-family: system-ui, sans-serif; color: #17202a; background: #f4f6f7; }
          body { max-width: 1500px; margin: 0 auto; padding: 1rem; }
          header, .section-heading, .filters { display: flex; gap: 1rem; align-items: end; justify-content: space-between; flex-wrap: wrap; }
          nav { display: flex; gap: 1rem; }
          section { background: white; padding: 1rem; margin: 1rem 0; border-radius: .5rem; box-shadow: 0 1px 3px #ccd1d1; }
          .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .75rem; margin-bottom: .75rem; }
          .advanced { margin-top: .75rem; }
          label { display: grid; gap: .25rem; font-weight: 600; }
          input, select, button { font: inherit; padding: .45rem; }
          button { cursor: pointer; }
          details { margin: .75rem 0; }
          .error { padding: .75rem; border: 1px solid #c0392b; background: #fdedec; color: #922b21; }
          .mismatch { background: #fdedec; }
          .table-wrap { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: .5rem; border-bottom: 1px solid #d5dbdb; text-align: left; vertical-align: top; white-space: nowrap; }
          .actions { min-width: 18rem; }
          .actions form { display: flex; gap: .35rem; align-items: center; margin-bottom: .35rem; }
          .actions small { color: #626567; white-space: normal; max-width: 10rem; }
        </style>
      </head>
      <body>${content}</body>
    </html>`;
}

function eachWayIntegerInput(label: string, name: string, values: FormValues): HtmlContent {
  return html`<label>${label}<input type="number" min="0" step="1" name=${name} value=${value(values, name)} data-each-way-required></label>`;
}

function integerInput(label: string, name: string, values: FormValues): HtmlContent {
  return html`<label>${label}<input type="number" min="0" step="1" name=${name} value=${value(values, name)}></label>`;
}

function option(optionValue: string, label: string, selected: string): HtmlContent {
  return optionValue === selected
    ? html`<option value=${optionValue} selected>${label}</option>`
    : html`<option value=${optionValue}>${label}</option>`;
}

function formatBasisPoints(basisPoints: number | null): string {
  if (basisPoints === null) return "—";
  const sign = basisPoints < 0 ? "-" : "";
  const absolute = Math.abs(basisPoints);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}%`;
}

function queryPath(path: string, fields: Record<string, string>): string {
  const query = new URLSearchParams();
  for (const [name, fieldValue] of Object.entries(fields)) {
    if (fieldValue !== "") query.set(name, fieldValue);
  }
  const encoded = query.toString();
  return encoded === "" ? path : `${path}?${encoded}`;
}

function formValues(
  body: Record<string, string | File | (string | File)[]>,
): FormValues {
  const result: FormValues = {};
  for (const [name, bodyValue] of Object.entries(body)) {
    if (typeof bodyValue === "string") result[name] = bodyValue;
  }
  return result;
}

function value(values: FormValues, name: string): string {
  return values[name] ?? "";
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to a stable message when the API response is not JSON.
  }
  return `request failed with status ${response.status}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "invalid form submission";
}

function emptyVerificationReport(): VerificationReport {
  return {
    checked_count: 0,
    ok_count: 0,
    mismatch_count: 0,
    uncheckable_count: 0,
    net_delta_pence: 0,
    discrepancies: [],
  };
}

function emptyStats(): Stats {
  return {
    overall: emptyStatsGroup(),
    by_tipster: [],
    by_month: [],
    incomplete_bet_ids: [],
  };
}

function emptyStatsGroup(): StatsGroup {
  return {
    won_count: 0,
    placed_count: 0,
    lost_count: 0,
    void_count: 0,
    incomplete_count: 0,
    profit_pence: 0,
    risked_pence: 0,
    roi_basis_points: null,
    strike_rate_basis_points: null,
  };
}
