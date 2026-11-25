import argparse
import gzip
import io
import json
import os
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

IMDB_BASE_URL = "https://datasets.imdbws.com"
DATASETS = {
    "title_basics": f"{IMDB_BASE_URL}/title.basics.tsv.gz",
    "title_ratings": f"{IMDB_BASE_URL}/title.ratings.tsv.gz",
    "title_principals": f"{IMDB_BASE_URL}/title.principals.tsv.gz",
    "name_basics": f"{IMDB_BASE_URL}/name.basics.tsv.gz",
}


def clean_number_series(series: pd.Series) -> pd.Series:
    cleaned = (
        series.astype(str)
        .str.replace(r"[\$,\s]", "", regex=True)
        .replace(
            {
                "": np.nan,
                "\\N": np.nan,
                "nan": np.nan,
                "None": np.nan,
                "null": np.nan,
                "--": np.nan,
                "N/A": np.nan,
            }
        )
    )
    return pd.to_numeric(cleaned, errors="coerce")


def load_film_log(csv_path: str | None) -> pd.DataFrame:
    if csv_path and Path(csv_path).exists():
        df = pd.read_csv(csv_path, dtype=str)
    else:
        sheet_url = os.environ.get("SHEET_CSV_URL", "").strip()
        if not sheet_url:
            raise ValueError("Provide --csv or set SHEET_CSV_URL environment variable.")
        req = urllib.request.Request(sheet_url, headers={"User-Agent": "MMDb-Sync/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw_bytes = resp.read()
        df = pd.read_csv(io.BytesIO(raw_bytes), dtype=str)

    df.columns = [c.strip() for c in df.columns]
    col_map = {}
    for c in df.columns:
        low = c.lower()
        if low in {"date", "watch_date", "date_watched"}:
            col_map[c] = "Date"
        elif low in {"movie", "title", "film"}:
            col_map[c] = "Movie"
        elif low in {"imdb id", "imdb_id", "tconst", "imdbid"}:
            col_map[c] = "IMDb ID"
    df = df.rename(columns=col_map)

    required = ["Date", "Movie", "IMDb ID"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns in film log: {missing}")

    df["Date"] = df["Date"].astype(str).str.strip()
    df["Movie"] = df["Movie"].astype(str).str.strip()
    df["IMDb ID"] = df["IMDb ID"].astype(str).str.strip()

    df["watch_dt"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df[df["watch_dt"].notna() & df["IMDb ID"].str.match(r"^tt\d+$", na=False)].copy()
    df["watch_date"] = df["watch_dt"].dt.strftime("%Y-%m-%d")
    df["watch_year"] = df["watch_dt"].dt.year.astype(int)
    df["watch_month"] = df["watch_dt"].dt.month.astype(int)
    df["watch_dow"] = df["watch_dt"].dt.day_name()
    return df


def download_gz_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "MMDb-Sync/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


def parse_title_basics(gz_bytes: bytes, target_tconsts: set[str]) -> dict[str, dict]:
    records: dict[str, dict] = {}
    usecols = ["tconst", "titleType", "primaryTitle", "originalTitle", "startYear", "runtimeMinutes", "genres"]
    with gzip.GzipFile(fileobj=io.BytesIO(gz_bytes)) as gz:
        for chunk in pd.read_csv(gz, sep="\t", usecols=usecols, dtype=str, chunksize=100_000, low_memory=False):
            sub = chunk[chunk["tconst"].isin(target_tconsts)]
            for row in sub.itertuples(index=False):
                yr = clean_number_series(pd.Series([row.startYear])).iloc[0]
                rt = clean_number_series(pd.Series([row.runtimeMinutes])).iloc[0]
                raw_genres = "" if pd.isna(row.genres) or row.genres == "\\N" else str(row.genres).strip()
                genre_list = [g.strip() for g in raw_genres.split(",") if g.strip() and g.strip() != "\\N"]
                records[row.tconst] = {
                    "tconst": row.tconst,
                    "titleType": "" if pd.isna(row.titleType) else str(row.titleType),
                    "imdbTitle": "" if pd.isna(row.primaryTitle) or row.primaryTitle == "\\N" else str(row.primaryTitle),
                    "releaseYear": None if pd.isna(yr) else int(yr),
                    "runtimeMinutes": None if pd.isna(rt) else float(rt),
                    "genres": genre_list,
                }
    return records


def parse_title_ratings(gz_bytes: bytes, target_tconsts: set[str]) -> dict[str, dict]:
    ratings: dict[str, dict] = {}
    usecols = ["tconst", "averageRating", "numVotes"]
    with gzip.GzipFile(fileobj=io.BytesIO(gz_bytes)) as gz:
        for chunk in pd.read_csv(gz, sep="\t", usecols=usecols, dtype=str, chunksize=100_000, low_memory=False):
            sub = chunk[chunk["tconst"].isin(target_tconsts)]
            for row in sub.itertuples(index=False):
                avg_r = clean_number_series(pd.Series([row.averageRating])).iloc[0]
                votes = clean_number_series(pd.Series([row.numVotes])).iloc[0]
                ratings[row.tconst] = {
                    "averageRating": None if pd.isna(avg_r) else round(float(avg_r), 1),
                    "numVotes": None if pd.isna(votes) else int(votes),
                }
    return ratings


def parse_principals_and_names(
    principals_gz: bytes,
    names_gz: bytes,
    target_tconsts: set[str],
) -> tuple[dict[str, dict[str, list[str]]], dict[str, str]]:
    role_bucket = {
        "actor": "actors",
        "actress": "actors",
        "director": "directors",
        "writer": "writers",
        "producer": "producers",
    }
    title_credits: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    needed_nconsts: set[str] = set()

    with gzip.GzipFile(fileobj=io.BytesIO(principals_gz)) as gz:
        for chunk in pd.read_csv(gz, sep="\t", usecols=["tconst", "nconst", "category"], dtype=str, chunksize=150_000, low_memory=False):
            sub = chunk[chunk["tconst"].isin(target_tconsts)]
            for row in sub.itertuples(index=False):
                bucket = role_bucket.get(str(row.category).strip().lower())
                if bucket and isinstance(row.nconst, str) and row.nconst.startswith("nm"):
                    if row.nconst not in title_credits[row.tconst][bucket]:
                        title_credits[row.tconst][bucket].append(row.nconst)
                    needed_nconsts.add(row.nconst)

    name_lookup: dict[str, str] = {}
    with gzip.GzipFile(fileobj=io.BytesIO(names_gz)) as gz:
        for chunk in pd.read_csv(gz, sep="\t", usecols=["nconst", "primaryName"], dtype=str, chunksize=150_000, low_memory=False):
            sub = chunk[chunk["nconst"].isin(needed_nconsts)]
            for row in sub.itertuples(index=False):
                if pd.notna(row.primaryName) and row.primaryName != "\\N":
                    name_lookup[row.nconst] = str(row.primaryName).strip()

    resolved_title_credits: dict[str, dict[str, list[str]]] = {}
    for tc, buckets in title_credits.items():
        resolved_title_credits[tc] = {
            k: [name_lookup[nm] for nm in v if nm in name_lookup]
            for k, v in buckets.items()
        }
    return resolved_title_credits, name_lookup


def build_payload(log_df: pd.DataFrame, use_imdb: bool = True) -> dict:
    log_df = log_df.sort_values(["watch_dt", "IMDb ID"]).reset_index(drop=True)
    log_df["viewing_number"] = log_df.groupby("IMDb ID").cumcount() + 1
    log_df["total_views_for_title"] = log_df.groupby("IMDb ID")["IMDb ID"].transform("count")
    log_df["prev_watch_dt"] = log_df.groupby("IMDb ID")["watch_dt"].shift(1)
    log_df["days_since_prev_watch"] = (log_df["watch_dt"] - log_df["prev_watch_dt"]).dt.days

    target_tconsts = set(log_df["IMDb ID"].unique())

    basics_map: dict[str, dict] = {}
    ratings_map: dict[str, dict] = {}
    credits_map: dict[str, dict[str, list[str]]] = {}

    if use_imdb:
        basics_gz = download_gz_bytes(DATASETS["title_basics"])
        ratings_gz = download_gz_bytes(DATASETS["title_ratings"])
        principals_gz = download_gz_bytes(DATASETS["title_principals"])
        names_gz = download_gz_bytes(DATASETS["name_basics"])

        basics_map = parse_title_basics(basics_gz, target_tconsts)
        ratings_map = parse_title_ratings(ratings_gz, target_tconsts)
        credits_map, _ = parse_principals_and_names(principals_gz, names_gz, target_tconsts)

    canonical_title: dict[str, str] = {}
    for tc, grp in log_df.groupby("IMDb ID"):
        non_empty = [m for m in grp["Movie"] if m]
        fallback = basics_map.get(tc, {}).get("imdbTitle") or tc
        canonical_title[tc] = non_empty[-1] if non_empty else fallback

    total_viewings = int(len(log_df))
    unique_films = int(log_df["IMDb ID"].nunique())
    rewatch_viewings = int(total_viewings - unique_films)
    rewatch_pct = round((rewatch_viewings / total_viewings) * 100, 1) if total_viewings else 0.0

    viewings = []
    total_minutes = 0.0
    for idx, row in log_df.iterrows():
        tc = row["IMDb ID"]
        b = basics_map.get(tc, {})
        r = ratings_map.get(tc, {})
        c = credits_map.get(tc, {})
        rt = b.get("runtimeMinutes")
        if rt is not None and np.isfinite(rt):
            total_minutes += float(rt)
        rel_yr = b.get("releaseYear")
        recency_lag = (int(row["watch_year"]) - int(rel_yr)) if rel_yr is not None else None

        viewings.append(
            {
                "id": int(idx) + 1,
                "watchDate": row["watch_date"],
                "watchYear": int(row["watch_year"]),
                "watchMonth": int(row["watch_month"]),
                "watchDow": row["watch_dow"],
                "imdbId": tc,
                "title": canonical_title[tc],
                "loggedTitle": row["Movie"],
                "releaseYear": rel_yr,
                "recencyLagYears": recency_lag,
                "runtimeMinutes": rt,
                "genres": b.get("genres", []),
                "imdbRating": r.get("averageRating"),
                "numVotes": r.get("numVotes"),
                "directors": c.get("directors", []),
                "writers": c.get("writers", []),
                "producers": c.get("producers", []),
                "actors": c.get("actors", []),
                "viewingNumber": int(row["viewing_number"]),
                "totalViewsForTitle": int(row["total_views_for_title"]),
                "isRewatch": bool(int(row["viewing_number"]) > 1),
                "daysSincePrevWatch": None if pd.isna(row["days_since_prev_watch"]) else int(row["days_since_prev_watch"]),
            }
        )

    latest = sorted(viewings, key=lambda x: (x["watchDate"], x["id"]), reverse=True)[0]
    same_tc_views = [v for v in viewings if v["imdbId"] == latest["imdbId"]]
    prev_view = same_tc_views[-2] if len(same_tc_views) >= 2 else None

    genre_view_counts = Counter()
    co_counts = Counter()
    for v in viewings:
        gs = sorted(set(v["genres"]))
        for g in gs:
            genre_view_counts[g] += 1
        for i in range(len(gs)):
            for j in range(i + 1, len(gs)):
                co_counts[(gs[i], gs[j])] += 1

    role_counters = {
        "actors": Counter(),
        "directors": Counter(),
        "writers": Counter(),
        "producers": Counter(),
    }
    role_unique_titles = {
        "actors": defaultdict(set),
        "directors": defaultdict(set),
        "writers": defaultdict(set),
        "producers": defaultdict(set),
    }
    for v in viewings:
        for role in role_counters:
            for person in v.get(role, []):
                role_counters[role][person] += 1
                role_unique_titles[role][person].add(v["imdbId"])

    rewatched_summary = []
    for tc, grp in log_df.groupby("IMDb ID"):
        cnt = int(len(grp))
        b = basics_map.get(tc, {})
        r = ratings_map.get(tc, {})
        rt = b.get("runtimeMinutes")
        rewatched_summary.append(
            {
                "imdbId": tc,
                "title": canonical_title[tc],
                "views": cnt,
                "rewatches": cnt - 1,
                "releaseYear": b.get("releaseYear"),
                "imdbRating": r.get("averageRating"),
                "runtimeMinutes": rt,
                "totalMinutes": round(float(rt) * cnt, 1) if rt is not None else None,
                "firstWatched": grp["watch_date"].min(),
                "lastWatched": grp["watch_date"].max(),
            }
        )
    rewatched_summary.sort(key=lambda x: (-x["views"], -x["rewatches"], x["title"]))

    month_order = list(range(1, 13))
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthly_counts = [
        {
            "month": m,
            "label": month_names[m - 1],
            "viewings": int((log_df["watch_month"] == m).sum()),
        }
        for m in month_order
    ]

    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_counts = [
        {
            "day": d,
            "viewings": int((log_df["watch_dow"] == d).sum()),
        }
        for d in dow_order
    ]

    gaps = [v["daysSincePrevWatch"] for v in viewings if v["daysSincePrevWatch"] is not None]
    latency_buckets = [
        {"bucket": "Within 30d", "count": sum(1 for g in gaps if g <= 30)},
        {"bucket": "31-180d", "count": sum(1 for g in gaps if 31 <= g <= 180)},
        {"bucket": "181-365d", "count": sum(1 for g in gaps if 181 <= g <= 365)},
        {"bucket": "1-3 yrs", "count": sum(1 for g in gaps if 366 <= g <= 1095)},
        {"bucket": "3+ yrs", "count": sum(1 for g in gaps if g > 1095)},
    ]

    era_unique: dict[str, set[str]] = defaultdict(set)
    era_minutes: dict[str, float] = defaultdict(float)
    for v in viewings:
        ry = v["releaseYear"]
        if ry is not None:
            decade = f"{(int(ry) // 10) * 10}s"
            era_unique[decade].add(v["imdbId"])
            if v["runtimeMinutes"] is not None:
                era_minutes[decade] += float(v["runtimeMinutes"])

    release_eras = [
        {
            "era": dec,
            "uniqueFilms": len(era_unique[dec]),
            "cumulativeHours": round(era_minutes[dec] / 60.0, 1),
        }
        for dec in sorted(era_unique.keys())
    ]

    rating_bins = defaultdict(int)
    for v in viewings:
        rtg = v["imdbRating"]
        if rtg is not None:
            b_val = round(float(rtg) * 2) / 2
            rating_bins[b_val] += 1

    rating_distribution = [
        {"rating": k, "viewings": rating_bins[k]}
        for k in sorted(rating_bins.keys())
    ]

    rt_by_yr: dict[int, list[float]] = defaultdict(list)
    for v in viewings:
        if v["runtimeMinutes"] is not None:
            rt_by_yr[v["watchYear"]].append(float(v["runtimeMinutes"]))

    runtime_by_watch_year = [
        {
            "watchYear": yr,
            "avgRuntimeMinutes": round(float(np.mean(vals)), 1),
            "totalHours": round(float(np.sum(vals)) / 60.0, 1),
        }
        for yr, vals in sorted(rt_by_yr.items())
    ]

    vote_tiers = Counter()
    for v in viewings:
        nv = v["numVotes"]
        if nv is None:
            vote_tiers["Unknown"] += 1
        elif nv >= 250_000:
            vote_tiers["Blockbuster (250k+ votes)"] += 1
        elif nv >= 50_000:
            vote_tiers["Mainstream (50k-250k)"] += 1
        elif nv >= 10_000:
            vote_tiers["Cult / Mid-Tier (10k-50k)"] += 1
        else:
            vote_tiers["Niche (<10k votes)"] += 1

    payload = {
        "meta": {
            "title": "Meier Movie Database",
            "badge": "MMDb",
            "dateRange": {
                "start": log_df["watch_date"].min(),
                "end": log_df["watch_date"].max(),
            },
            "imdbDatasetsIncluded": bool(use_imdb),
        },
        "kpis": {
            "uniqueFilms": unique_films,
            "totalViewings": total_viewings,
            "rewatchViewings": rewatch_viewings,
            "rewatchPct": rewatch_pct,
            "totalMinutes": round(total_minutes, 1),
            "totalHours": round(total_minutes / 60.0, 1),
            "totalDays": round(total_minutes / 1440.0, 1),
        },
        "mostRecentWatch": {
            "title": latest["title"],
            "imdbId": latest["imdbId"],
            "watchDate": latest["watchDate"],
            "releaseYear": latest["releaseYear"],
            "imdbRating": latest["imdbRating"],
            "viewingNumber": latest["viewingNumber"],
            "totalViewsForTitle": latest["totalViewsForTitle"],
            "daysSincePrevWatch": latest["daysSincePrevWatch"],
            "prevWatchDate": prev_view["watchDate"] if prev_view else None,
        },
        "genres": {
            "counts": [{"genre": g, "viewings": c} for g, c in genre_view_counts.most_common()],
            "coOccurrence": [
                {"genreA": a, "genreB": b, "viewings": c}
                for (a, b), c in co_counts.most_common(45)
            ],
        },
        "credits": {
            role: [
                {
                    "name": nm,
                    "viewings": cnt,
                    "uniqueFilms": len(role_unique_titles[role][nm]),
                }
                for nm, cnt in counter.most_common(15)
            ]
            for role, counter in role_counters.items()
        },
        "topRewatched": rewatched_summary[:15],
        "releaseEras": release_eras,
        "ratingDistribution": rating_distribution,
        "seasonality": {
            "monthly": monthly_counts,
            "dayOfWeek": dow_counts,
        },
        "rewatchLatency": {
            "avgDays": round(float(np.mean(gaps)), 1) if gaps else None,
            "medianDays": round(float(np.median(gaps)), 1) if gaps else None,
            "buckets": latency_buckets,
        },
        "runtimeByWatchYear": runtime_by_watch_year,
        "voteDepth": [{"tier": t, "viewings": c} for t, c in vote_tiers.items()],
        "viewings": sorted(viewings, key=lambda x: (x["watchDate"], x["id"]), reverse=True),
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build data.json for Meier Movie Database.")
    parser.add_argument("--csv", type=str, default=None, help="Optional path to local Film_Log.csv")
    parser.add_argument("--out", type=str, default="data.json", help="Output JSON path")
    parser.add_argument("--skip-imdb", action="store_true", help="Skip remote IMDb .tsv.gz download for fast local smoke test")
    args = parser.parse_args()

    log_df = load_film_log(args.csv)
    payload = build_payload(log_df, use_imdb=not args.skip_imdb)
    json_str = json.dumps(payload, indent=2, allow_nan=False)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json_str, encoding="utf-8")
    print(f"Wrote {out_path} ({len(json_str):,} bytes) with {payload['kpis']['totalViewings']} viewings.")


if __name__ == "__main__":
    main()
