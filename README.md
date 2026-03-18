# PCA Kandidat Test

This project generates a local HTML PCA report from Altinget candidate-test data.

## Setup

The project now uses `uv` for dependency management.

```bash
uv sync
```

The API key is loaded from `.env`:

```bash
ALTINGET_API_KEY=...
```

## Run

```bash
uv run python ft26_pca_analysis.py
```

The generated site is written to `output/ft26_pca/site/index.html`.
