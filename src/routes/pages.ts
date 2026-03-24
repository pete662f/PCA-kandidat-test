/**
 * HTML page routes — serves the interactive report UI.
 */

import { Hono } from "hono";
import {
  getBundle,
  getAvailableSources,
} from "../services/data-store.ts";
import { renderSiteHtml } from "../templates/site.ts";

export const pageRouter = new Hono();

// ── Source-specific report ──

pageRouter.get("/:source", (c) => {
  const source = c.req.param("source");
  const bundle = getBundle(source);

  if (!bundle) {
    const available = getAvailableSources();
    return c.html(
      `<!DOCTYPE html><html><head><title>Ikke fundet</title></head><body>
      <h1>Kilden "${source}" er ikke tilgængelig.</h1>
      <p>Tilgængelige kilder: ${available.length ? available.map((s) => `<a href="/${s}">${s}</a>`).join(", ") : "Ingen (data indlæses stadig...)"}</p>
      <p><a href="/">Gå til forsiden</a></p>
      </body></html>`,
      404
    );
  }

  const html = renderSiteHtml(
    bundle.sitePayload,
    bundle.election.name,
    bundle.election.prefix,
    bundle.election.valgomatId
  );

  return c.html(html);
});

// ── Index / redirect ──

pageRouter.get("/", (c) => {
  const sources = getAvailableSources();

  if (sources.length === 1) {
    return c.redirect(`/${sources[0]}`);
  }

  if (sources.length === 0) {
    return c.html(
      `<!DOCTYPE html><html><head><title>PCA Kandidattest</title>
      <meta http-equiv="refresh" content="5">
      <style>body{font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;color:#333}</style>
      </head><body>
      <h1>PCA Kandidattest</h1>
      <p>Data indlæses... Siden opdaterer automatisk.</p>
      </body></html>`
    );
  }

  // Multiple sources: show index
  return c.html(
    `<!DOCTYPE html><html lang="da"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PCA Kandidattest</title>
    <link rel="stylesheet" href="/styles.css">
    </head><body>
    <div class="site-shell" style="padding-top:60px">
      <h1 style="font-family:Georgia,serif">PCA Kandidattest</h1>
      <p style="color:#6f655d;max-width:50ch;margin:16px 0 32px">
        Vælg en datakilde for at se den interaktive PCA-rapport over kandidattesten.
      </p>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        ${sources
          .map((s) => {
            const b = getBundle(s)!;
            return `<a href="/${s}" class="stat-card" style="text-decoration:none;color:inherit">
              <span class="stat-label">${b.siteMeta.sourceLabel}</span>
              <strong class="stat-value">${b.candidates.length}</strong>
              <span class="stat-meta">kandidater · ${b.questions.length} spørgsmål</span>
            </a>`;
          })
          .join("")}
      </div>
      <div style="margin-top:32px">
        <h3 style="font-family:Georgia,serif">API</h3>
        <p style="color:#6f655d">Programmatisk adgang: <code>GET /api/sources</code></p>
      </div>
    </div>
    </body></html>`
  );
});
