# Meier Movie Database (MMDb) v4

Self-contained static data app hosted on GitHub Pages and embedded in Tableau Public, with automated daily IMDb syncing and optional TMDb movie posters, film descriptions, and cast/crew portraits.

## What Is New in v4

- Every panel anchors its **Insight** button consistently in the top-right corner, with chart toggles cleanly placed on their own controls row below the header.
- Most Recent Watch displays the film's brief description (`overview`) automatically via TMDb alongside poster, metadata, and viewing ordinal.
- Tooltips across **Genre Profile & Overlap**, **IMDb Rating Curve & Vote Depth**, and **Viewing Cadence, Runtime Shift & Rewatch Latency** list the top contributing films for every datapoint.
- The **Complete Viewing Log** calculates **Total Runtime Watched (At Viewing)** as point-in-time cumulative time (`runtimeMinutes * viewingNumber`) and layers an inline horizontal bar chart scaled to your all-time peak film commitment.
