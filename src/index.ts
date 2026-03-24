/**
 * PCA Kandidattest — Bun + Hono web server
 *
 * Serves an interactive PCA analysis of Danish candidate tests,
 * with a REST API for LLMs to take the test programmatically.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { apiRouter } from "./routes/api.ts";
import { pageRouter } from "./routes/pages.ts";
import { loadSource, getAvailableSources } from "./services/data-store.ts";
import { PORT } from "./config.ts";

const app = new Hono();

// ── Middleware ──

app.use("/api/*", cors());

// ── Static files ──

app.use("/styles.css", serveStatic({ path: "./public/styles.css" }));
app.use("/app.js", serveStatic({ path: "./public/app.js" }));

// ── API routes ──

app.route("/api", apiRouter);

// ── Page routes ──

app.route("/", pageRouter);

// ── Start server ──

console.log(`\n  PCA Kandidattest`);
console.log(`  ─────────────────────────────────`);
console.log(`  Server starting on port ${PORT}...`);

// Determine which sources to load from environment
const sourcesToLoad = (process.env.SOURCES ?? "tv2")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

console.log(`  Sources to load: ${sourcesToLoad.join(", ")}`);
console.log(`  ─────────────────────────────────\n`);

// Load sources in background after server starts
async function loadAllSources() {
  for (const source of sourcesToLoad) {
    try {
      await loadSource(source);
    } catch (e: any) {
      console.error(`[ERROR] Failed to load source "${source}":`, e.message);
      if (source === "altinget" || source === "dr") {
        console.error(
          "  Hint: Set ALTINGET_API_KEY environment variable for Altinget/DR sources."
        );
      }
    }
  }
  const loaded = getAvailableSources();
  console.log(
    `\n  ✓ ${loaded.length} source(s) ready: ${loaded.join(", ") || "none"}`
  );
  if (loaded.length > 0) {
    console.log(`  → Open http://localhost:${PORT}/`);
    console.log(`  → API: http://localhost:${PORT}/api/sources`);
  }
}

loadAllSources();

export default {
  port: PORT,
  fetch: app.fetch,
};
