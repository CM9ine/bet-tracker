import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";

const app = createApp(openDb());
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bet-tracker listening on http://localhost:${info.port}`);
});
