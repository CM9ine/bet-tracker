import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

describe("app", () => {
  it("responds to health check", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
