# PCA Kandidat Test

This project generates a local HTML PCA report from Danish kandidattest data.

## Setup

The project now uses `uv` for dependency management.

```bash
uv sync
```

The Altinget-backed sources load the API key from `.env`:

```bash
ALTINGET_API_KEY=...
```

## Run

```bash
uv run python ft26_pca_analysis.py --source altinget
uv run python ft26_pca_analysis.py --source dr
uv run python ft26_pca_analysis.py --source tv2
```

Outputs:

- `altinget`: `output/ft26_pca/site/index.html`
- `dr`: `output/dr_ft26_pca/site/index.html`
- `tv2`: `output/tv2_fv26_pca/site/index.html`

Notes:

- `altinget` and `dr` use the existing Altinget candidate dataset; the generated site now accepts DR-style uploaded answer files in addition to Altinget JSON.
- `tv2` builds the PCA report from TV 2's public kandidattest candidate endpoints and static question metadata from their published frontend bundle.
