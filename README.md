# Meier Movie Database (MMDb) v2

Self-contained static data app hosted on GitHub Pages and embedded in Tableau Public, with automated daily IMDb syncing and optional TMDb movie posters and cast/crew portraits.

## GitHub Secrets Setup

1. `SHEET_CSV_URL` (Required): Published CSV URL of your Google Sheet film log tab.
2. `TMDB_API_KEY` (Optional, free for personal use): Either your TMDb v3 API Key or v4 Read Access Token from https://www.themoviedb.org/settings/api. When set, `scripts/build_data.py` automatically resolves posters for your Most Recent Watch and Top 15 Most Watched Movies plus headshots for your Top 12 Actors, Directors, Writers, and Producers using their IMDb IDs (`tt...` / `nm...`) and caches them inside `data.json`.

## Life Eras Customization

Edit the `LIFE_ERAS` list at the top of `scripts/build_data.py` anytime. Setting `"end": "Present"` automatically extends an era to your latest logged viewing date.
