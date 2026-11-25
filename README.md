# Meier Movie Database (MMDb)

Standalone static data app for Matt Meier's personal film log, designed for GitHub Pages hosting and Tableau Public Web Page embedding.

## Local Preview

1. Extract this archive into a local folder.
2. Optional: refresh `data.json` with live IMDb metadata from `https://datasets.imdbws.com/`:
   ```bash
   python scripts/build_data.py --csv Film_Log.csv --out data.json
   ```
3. Start a local HTTP server (required because browsers block `fetch()` over `file://`):
   ```bash
   python -m http.server 8000
   ```
4. Open `http://localhost:8000` in your browser.

## GitHub Pages & Automated Daily Sync

1. Create a public GitHub repository and push all files at the root of `main`, confirming `.github/workflows/update-data.yml` is present (web drag-and-drop uploaders often skip hidden `.github` folders).
2. Publish your Google Sheet film log tab as CSV (**File -> Share -> Publish to web -> CSV**) and save the URL as repository secret `SHEET_CSV_URL` under **Settings -> Secrets and variables -> Actions**.
3. Under **Settings -> Actions -> General -> Workflow permissions**, enable **Read and write permissions**.
4. Under **Settings -> Pages**, set **Source** to **Deploy from a branch** (`main`, `/ (root)`).
5. Open the **Actions** tab, run **Update MMDb Data**, and confirm `data.json` commits cleanly with live IMDb metadata.
6. Embed `https://<your-username>.github.io/<your-repo>/` inside a `1201` px wide Tableau Public dashboard using a **Web Page** object.
