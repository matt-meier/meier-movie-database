# Meier Movie Database (MMDb) v5

Self-contained static data app hosted on GitHub Pages and embedded in Tableau Public, with automated daily IMDb syncing and optional TMDb movie posters, film descriptions, and cast/crew portraits.

## What Is New in v5

- Added a **Download CSV** button in the top-right header of the **Complete Viewing Log** so visitors can export the film log for their own analysis in Excel, Tableau, Python, or R.
- When search or filter inputs are active, the button exports the filtered view (`Download Filtered CSV (N)`) alongside a **Full Log** button to grab the complete archive.
- Exported CSV includes 14 clean, RFC-4180 escaped columns with UTF-8 encoding (`Watch Date`, `Watch Year`, `Film Title`, `IMDb ID`, `IMDb URL`, `Release Year`, `Film Age at Watch (Years)`, `Genres`, `IMDb Rating`, `Runtime (Minutes)`, `Viewing Number`, `Total Views for Film`, `Cumulative Runtime at Viewing (Minutes)`, and `Cumulative Runtime at Viewing (D, H, M)`).
- Added scroll and viewport resize dismissal plus larger coarse-pointer close hit areas for mobile touch tooltips.
