# PCA Kandidat Test

Interactive PCA analysis of Danish candidate tests (kandidattests) for the 2026 parliamentary election. Fetches candidate answers from Altinget, DR, and TV 2, runs Principal Component Analysis, and serves an interactive web app with charts and a REST API.

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/)
- **Framework:** [Hono](https://hono.dev/)
- **Language:** TypeScript
- **PCA:** Custom implementation using [ml-matrix](https://github.com/mljs/matrix)

## Quick Start

```bash
# Install dependencies
bun install

# Start the dev server (with hot reload)
bun run dev

# Or start in production mode
bun run start
```

The server starts on `http://localhost:3000` by default (override with `PORT` env var).

### Choosing Data Sources

Set the `SOURCES` environment variable to load one or more sources (comma-separated). Defaults to `tv2`.

```bash
# Single source
SOURCES=tv2 bun run dev

# Multiple sources
SOURCES=tv2,altinget,dr bun run dev
```

For the `altinget` and `dr` sources, set the API key in `.env`:

```bash
ALTINGET_API_KEY=...
```

### Docker

```bash
docker build -t pca-kandidat-test .
docker run -p 3000:3000 -e SOURCES=tv2 pca-kandidat-test
```

## REST API

All endpoints accept an optional `?source=<slug>` query parameter (defaults to the first loaded source).

| Endpoint | Method | Description |
|---|---|---|
| `/api/sources` | GET | List available sources and usage hints |
| `/api/questions?source=<slug>` | GET | Get all questions with answer scale instructions |
| `/api/parties?source=<slug>` | GET | Party centroids with PCA coordinates and variance |
| `/api/candidates?source=<slug>` | GET | Candidate PCA scores (supports `?party=`, `?limit=`, `?offset=`) |
| `/api/model?source=<slug>` | GET | Raw PCA model (components, scaler, imputer stats) |
| `/api/take-test` | POST | Submit answers, get PCA scores + closest parties/candidates |

### Taking the Test via API

```bash
# 1. List sources
curl http://localhost:3000/api/sources

# 2. Get questions
curl http://localhost:3000/api/questions?source=tv2

# 3. Submit answers
curl -X POST http://localhost:3000/api/take-test \
  -H "Content-Type: application/json" \
  -d '{
    "source": "tv2",
    "label": "My Name",
    "answers": [
      {"question_id": "<id>", "answer": 2},
      {"question_id": "<id>", "answer": -1}
    ]
  }'
```

Answers use the scale: `-2` (strongly disagree) to `+2` (strongly agree), with `0` for neutral/skip.

The response includes your PCA position, closest parties, closest candidates, and an `upload_file` object you can save as JSON and upload on the website to see your profile in the charts.

## Project Structure

```
src/
  index.ts            # Hono server entrypoint
  config.ts           # Source configs, party colors, PCA parameters
  types.ts            # TypeScript type definitions
  routes/
    api.ts            # REST API endpoints
    pages.ts          # HTML page routes
  services/
    data-store.ts     # In-memory source data management
    altinget.ts       # Altinget/DR data fetcher
    tv2.ts            # TV 2 data fetcher
  lib/
    pca.ts            # PCA computation (SVD, projection)
  templates/
    site.ts           # HTML template rendering
  client/
    lib/              # Client-side JavaScript
public/
  styles.css          # Stylesheet
  app.js              # Client-side app bundle
```

## Data Sources

| Source | Data origin | Notes |
|---|---|---|
| **tv2** | TV 2's public candidate test API + static question metadata from their frontend bundle | Default source |
| **altinget** | Altinget's candidate test API | Requires `ALTINGET_API_KEY` |
| **dr** | Same Altinget candidate data, with DR-compatible upload/answer model | Requires `ALTINGET_API_KEY` |

