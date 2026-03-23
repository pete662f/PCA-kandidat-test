/**
 * Server-side HTML generation — produces the same report as the Python version
 * but served dynamically by the Bun web server.
 */

import type { SitePayload, LoadingRow } from "../types.ts";
import { MIN_ANSWERED_QUESTIONS } from "../config.ts";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function formatSigned(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

function loadingList(
  title: string,
  rows: LoadingRow[],
  tone: string
): string {
  const items = rows
    .map(
      (r) => `
      <li class="question-item">
        <span class="question-topic">${escapeHtml((r.topic ?? "").trim())}</span>
        <span class="question-text">${escapeHtml((r.question ?? "").trim())}</span>
        <span class="question-loading tone-${tone}">${formatSigned(r.loading)}</span>
      </li>`
    )
    .join("");

  return `
    <section class="question-panel">
      <h3>${title}</h3>
      <ol class="question-list">${items}</ol>
    </section>`;
}

export function renderSiteHtml(
  payload: SitePayload,
  electionName: string,
  electionPrefix: string,
  valgomatId: number
): string {
  const s = payload.summary;
  const meta = payload.site_meta;

  // Variance cards
  const varianceCards = payload.variance
    .slice(0, 4)
    .map(
      (v: any) => `
      <article class="stat-card">
        <span class="stat-label">${v.component}</span>
        <strong class="stat-value">${v.explained_variance_pct.toFixed(1)}%</strong>
        <span class="stat-meta">Kumulativt ${v.cumulative_explained_variance_pct.toFixed(1)}%</span>
      </article>`
    )
    .join("");

  // Loading sections
  const pc1Neg = loadingList("Negativ side", payload.loadings.pc1_negative ?? [], "negative");
  const pc1Pos = loadingList("Positiv side", payload.loadings.pc1_positive ?? [], "positive");
  const pc2Neg = loadingList("Negativ side", payload.loadings.pc2_negative ?? [], "negative");
  const pc2Pos = loadingList("Positiv side", payload.loadings.pc2_positive ?? [], "positive");
  const pc3Neg = loadingList("Negativ side", payload.loadings.pc3_negative ?? [], "negative");
  const pc3Pos = loadingList("Positiv side", payload.loadings.pc3_positive ?? [], "positive");
  const pc4Neg = loadingList("Negativ side", payload.loadings.pc4_negative ?? [], "negative");
  const pc4Pos = loadingList("Positiv side", payload.loadings.pc4_positive ?? [], "positive");

  const bigConstituencyTotal = new Set(
    payload.municipalities.map((m) => m.bigConstituencyName)
  ).size;

  return `<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(electionName)} \u00b7 PCA-rapport</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
</head>
<body>
  <div class="site-shell">
    <header class="masthead">
      <div class="masthead-grid">
        <div>
          <p class="kicker">${escapeHtml(meta.source_label)} kandidattest \u00b7 PCA analyse</p>
          <h1>${escapeHtml(electionName)}</h1>
          <p class="lede">
            En statisk webrapport over ${escapeHtml(electionPrefix)}-kandidattesten bygget direkte fra ${escapeHtml(meta.source_description)}.
            Analysen reducerer ${s.question_total} f\u00e6lles sp\u00f8rgsm\u00e5l til de vigtigste m\u00f8nstre i kandidaternes svar.
          </p>
        </div>
        <dl class="meta-strip">
          <div><dt>K\u00f8rt</dt><dd>${s.run_date}</dd></div>
          <div><dt>Valgomat</dt><dd>${valgomatId}</dd></div>
          <div><dt>Storkredse</dt><dd>${bigConstituencyTotal}</dd></div>
          <div><dt>Kommuner</dt><dd>${payload.municipalities.length}</dd></div>
        </dl>
      </div>
    </header>

    <nav class="section-nav">
      <a href="#overview">Overblik</a>
      <a href="#dimensions">Dimensioner</a>
      <a href="#parties">Partier</a>
      <a href="#figures">Figurer</a>
      <a href="#api-docs">API</a>
    </nav>

    <section class="scope-toolbar" aria-labelledby="scope-heading">
      <div class="scope-card">
        <div>
          <p id="scope-heading" class="scope-label">Visning</p>
          <p class="scope-description">V\u00e6lg en kommune for at filtrere kandidater og figurer til det relevante omr\u00e5de.</p>
        </div>
        <div class="scope-controls">
          <label class="scope-field" for="municipality-select">Kommune</label>
          <select id="municipality-select" class="scope-select"></select>
        </div>
        <p id="municipality-summary" class="scope-summary">Viser hele landet.</p>
      </div>
    </section>

    <main>
      <section id="overview" class="section">
        <div class="section-head">
          <h2>Overblik</h2>
          <p>Datagrundlag og hovedm\u00e5l for modellen.</p>
        </div>
        <div class="stats-grid">
          <article class="stat-card"><span class="stat-label">Kandidater i alt</span><strong class="stat-value">${s.candidate_total}</strong><span class="stat-meta">Unikke kandidater p\u00e5 stemmesedlerne</span></article>
          <article class="stat-card"><span class="stat-label">Kandidater i PCA</span><strong class="stat-value">${s.candidate_retained}</strong><span class="stat-meta">${s.candidate_excluded} udeladt pga. for mange manglende svar</span></article>
          <article class="stat-card"><span class="stat-label">Partier i PCA</span><strong class="stat-value">${s.party_total}</strong><span class="stat-meta">Partier med mindst \u00e9n kandidat i PCA-resultatet</span></article>
          <article class="stat-card"><span class="stat-label">F\u00e6lles sp\u00f8rgsm\u00e5l</span><strong class="stat-value">${s.question_total}</strong><span class="stat-meta">Median svarprocent: ${s.median_answered}/${s.question_total}</span></article>
        </div>

        <div class="two-col">
          <article class="note-panel">
            <h3>Metode i korte tr\u00e6k</h3>
            <ul class="plain-list">
              <li>Svarskalaen 1, 2, 4 og 5 er omsat til en symmetrisk numerisk skala fra -2 til +2.</li>
              <li>Kun de ${s.question_total} sp\u00f8rgsm\u00e5l, som g\u00e5r igen i alle storkredse, er taget med.</li>
              <li>Kandidater med f\u00e6rre end ${MIN_ANSWERED_QUESTIONS} besvarelser er udeladt af PCA-modellen.</li>
              <li>Resten er standardiseret sp\u00f8rgsm\u00e5l for sp\u00f8rgsm\u00e5l, s\u00e5 ingen enkeltsager dominerer alene p\u00e5 skala.</li>
            </ul>
          </article>
          <article class="note-panel">
            <h3>Datakvalitet</h3>
            <ul class="plain-list">
              <li>Sp\u00f8rgsm\u00e5lsgrundlaget er ens p\u00e5 tv\u00e6rs af alle storkredse: ${s.question_set_deviations} afvigelser fundet.</li>
              <li>${escapeHtml(meta.source_attribution)}</li>
              <li>Alle data er tilg\u00e6ngelige via API-endpointet <code>/api</code>.</li>
            </ul>
          </article>
        </div>
      </section>

      <section id="dimensions" class="section">
        <div class="section-head">
          <h2>De fire vigtigste dimensioner</h2>
          <p>PC1 til PC4 forklarer tilsammen ${(s.pc1234_pct ?? 0).toFixed(1)}% af variationen.</p>
        </div>

        <div class="variance-grid">${varianceCards}</div>

        <div class="dimension-grid">
          <article class="dimension-card">
            <div class="dimension-topline"><span>PC1</span><strong>${formatPct(s.pc1_pct)} af variationen</strong></div>
            <div class="question-columns">${pc1Neg}${pc1Pos}</div>
          </article>
          <article class="dimension-card">
            <div class="dimension-topline"><span>PC2</span><strong>${formatPct(s.pc2_pct)} af variationen</strong></div>
            <div class="question-columns">${pc2Neg}${pc2Pos}</div>
          </article>
          <article class="dimension-card">
            <div class="dimension-topline"><span>PC3</span><strong>${formatPct(s.pc3_pct)} af variationen</strong></div>
            <div class="question-columns">${pc3Neg}${pc3Pos}</div>
          </article>
          <article class="dimension-card">
            <div class="dimension-topline"><span>PC4</span><strong>${formatPct(s.pc4_pct)} af variationen</strong></div>
            <div class="question-columns">${pc4Neg}${pc4Pos}</div>
          </article>
        </div>
      </section>

      <section id="parties" class="section">
        <div class="section-head">
          <h2>Partiernes placeringer</h2>
          <p id="party-section-copy">Tabellerne viser partiernes gennemsnitlige placering i PCA-rummet.</p>
        </div>
        <div class="table-grid">
          <article class="table-card"><h3>Mest negative p\u00e5 PC1</h3><div id="table-pc1-neg"></div></article>
          <article class="table-card"><h3>Mest positive p\u00e5 PC1</h3><div id="table-pc1-pos"></div></article>
          <article class="table-card"><h3>Mest negative p\u00e5 PC2</h3><div id="table-pc2-neg"></div></article>
          <article class="table-card"><h3>Mest positive p\u00e5 PC2</h3><div id="table-pc2-pos"></div></article>
        </div>
        <article class="table-card full-width-card">
          <h3>Partier med st\u00f8rst intern spredning</h3>
          <p class="table-note">Spredningen er beregnet som kombineret standardafvigelse i PC1/PC2-planet.</p>
          <div id="table-dispersion"></div>
        </article>
        <article class="table-card full-width-card">
          <h3>Kandidater i det valgte omr\u00e5de</h3>
          <p class="table-note">V\u00e6lg en kommune for at se de kandidater, der h\u00f8rer til det valgte omr\u00e5de.</p>
          <div id="table-candidates"></div>
        </article>
      </section>

      <section id="figures" class="section">
        <div class="section-head">
          <h2>Figurer</h2>
          <p id="figure-section-copy">De vigtigste PCA-figurer er gjort interaktive.</p>
        </div>

        <section class="interactive-block">
          <div class="interactive-head">
            <div>
              <h3>Kandidater i PC1/PC2-rummet</h3>
              <p>Farvet efter parti. Upload svarfiler for at l\u00e6gge jeres profiler oven p\u00e5 feltet.</p>
            </div>
            <div class="filter-actions">
              <button type="button" class="filter-button" data-filter-action="all">Vis alle</button>
              <button type="button" class="filter-button" data-filter-action="none">Skjul alle</button>
            </div>
          </div>
          <div class="upload-panel" aria-labelledby="upload-panel-title">
            <div class="upload-copy">
              <p class="upload-kicker">Plac\u00e9r jer sammen</p>
              <h4 id="upload-panel-title">Upload jeres svar</h4>
              <p>${meta.upload_help_html}</p>
            </div>
            <div class="upload-actions">
              <label class="upload-button" for="answers-upload-input">Upload JSON</label>
              <input id="answers-upload-input" class="upload-input" type="file" accept=".json,application/json,text/plain" multiple>
              <button type="button" id="clear-upload-button" class="filter-button" disabled>Fjern alle</button>
            </div>
            <p id="upload-status" class="upload-status">Ingen profiler uploadet endnu.</p>
            <div id="upload-profiles" class="upload-profiles"></div>
          </div>
          <div id="party-filter" class="party-filter" aria-label="Partifilter"></div>
          <div id="candidate-chart" class="plot-frame"></div>
        </section>

        <section class="interactive-block">
          <div class="interactive-head">
            <div><h3>Kandidater i PC3/PC4-rummet</h3><p>Samme felt vist p\u00e5 tredje og fjerde komponenter.</p></div>
          </div>
          <div id="candidate-chart-34" class="plot-frame"></div>
        </section>

        <section class="interactive-block">
          <div class="interactive-head">
            <div><h3>Particentroider</h3><p>Hvert punkt er et partis gennemsnitsplacering. Krydsene viser spredningen.</p></div>
          </div>
          <div id="centroid-chart" class="plot-frame"></div>
        </section>

        <section class="interactive-block">
          <div class="interactive-head">
            <div><h3>Particentroider i PC3/PC4</h3><p>Gennemsnitsplaceringer p\u00e5 tredje og fjerde komponent.</p></div>
          </div>
          <div id="centroid-chart-34" class="plot-frame"></div>
        </section>

        <section class="interactive-block">
          <div class="interactive-head">
            <div><h3>Forklaret variation pr. komponent</h3><p>B\u00e5de komponentandel og kumulativ forklaringsgrad.</p></div>
          </div>
          <div id="explained-variance-chart" class="plot-frame plot-frame-short"></div>
        </section>
      </section>

      <section id="api-docs" class="section">
        <div class="section-head">
          <h2>API</h2>
          <p>Brug API-endpointerne til at lade LLM-modeller eller andre klienter tage testen programmatisk.</p>
        </div>
        <div class="two-col">
          <article class="note-panel">
            <h3>Endpoints</h3>
            <ul class="plain-list">
              <li><code>GET /api/sources</code> \u2014 Tilg\u00e6ngelige datakilder</li>
              <li><code>GET /api/questions?source=${meta.source_slug}</code> \u2014 Alle sp\u00f8rgsm\u00e5l</li>
              <li><code>GET /api/parties?source=${meta.source_slug}</code> \u2014 Particentroider</li>
              <li><code>GET /api/candidates?source=${meta.source_slug}</code> \u2014 Kandidater med PCA-scorer</li>
              <li><code>POST /api/take-test</code> \u2014 Indsend svar og f\u00e5 PCA-position</li>
            </ul>
          </article>
          <article class="note-panel">
            <h3>Tag testen (POST /api/take-test)</h3>
            <pre style="font-size:0.85rem;overflow-x:auto;"><code>{
  "source": "${meta.source_slug}",
  "answers": [
    { "question_id": "...", "answer": 2 },
    { "question_id": "...", "answer": -1 }
  ]
}</code></pre>
            <p style="margin-top:10px;color:var(--muted);">Svar p\u00e5 -2 til 2 skalaen. Returnerer PCA-scorer og n\u00e6rmeste partier/kandidater.</p>
          </article>
        </div>
      </section>
    </main>
  </div>
  <script>window.__SITE_DATA__ = ${JSON.stringify(payload)};</script>
  <script src="/app.js"></script>
</body>
</html>`;
}
