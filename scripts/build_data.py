import argparse
import gzip
import io
import json
import os
import time
import urllib.error
import urllib.parse
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

TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w342"
TMDB_PROFILE_BASE = "https://image.tmdb.org/t/p/w185"

# Edit dates or change an end date to "Present" to auto-extend to your latest watch date.
LIFE_ERAS = [
    {"start": "2007-08-01", "end": "2008-05-18", "label": "Final high school years", "track": 0, "color": "#5B7C99"},
    {"start": "2008-08-01", "end": "2013-12-17", "label": "Undergraduate years", "track": 0, "color": "#2E6F9E"},
    {"start": "2014-06-01", "end": "2015-08-28", "label": "Part-time job", "track": 0, "color": "#6B8E78"},
    {"start": "2015-11-01", "end": "2016-04-15", "label": "First full time job", "track": 0, "color": "#4C8C74"},
    {"start": "2016-06-14", "end": "2025-12-31", "label": "Analytics career", "track": 0, "color": "#2F4858"},
    {"start": "2022-08-01", "end": "2025-08-01", "label": "MSDA/MBA years", "track": 1, "color": "#D9822B"},
    {"start": "2023-01-27", "end": "2025-12-31", "label": "Fatherhood years", "track": 2, "color": "#C99A00"},
]


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
        req = urllib.request.Request(sheet_url, headers={"User-Agent": "MMDb-Sync/2.0"})
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
    req = urllib.request.Request(url, headers={"User-Agent": "MMDb-Sync/2.0"})
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
) -> tuple[dict[str, dict[str, list[dict]]], dict[str, str]]:
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

    resolved_title_credits: dict[str, dict[str, list[dict]]] = {}
    for tc, buckets in title_credits.items():
        resolved_title_credits[tc] = {
            k: [{"nconst": nm, "name": name_lookup[nm]} for nm in v if nm in name_lookup]
            for k, v in buckets.items()
        }
    return resolved_title_credits, name_lookup


def load_existing_media_cache(out_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    posters: dict[str, str] = {}
    profiles: dict[str, str] = {}
    if not out_path.exists():
        return posters, profiles
    try:
        prev = json.loads(out_path.read_text(encoding="utf-8"))
        mrw = prev.get("mostRecentWatch") or {}
        if mrw.get("imdbId") and mrw.get("posterUrl"):
            posters[mrw["imdbId"]] = mrw["posterUrl"]
        for item in prev.get("topRewatched") or []:
            if item.get("imdbId") and item.get("posterUrl"):
                posters[item["imdbId"]] = item["posterUrl"]
        for role_list in (prev.get("credits") or {}).values():
            for person in role_list or []:
                if person.get("nconst") and person.get("profileUrl"):
                    profiles[person["nconst"]] = person["profileUrl"]
    except Exception:
        pass
    return posters, profiles


def fetch_tmdb_media(imdb_id: str, media_kind: str, tmdb_token: str) -> str | None:
    if not tmdb_token or not imdb_id:
        return None
    headers = {"Accept": "application/json", "User-Agent": "MMDb-Sync/2.0"}
    params = {"external_source": "imdb_id"}
    if len(tmdb_token) > 45:
        headers["Authorization"] = f"Bearer {tmdb_token}"
    else:
        params["api_key"] = tmdb_token

    url = f"{TMDB_API_BASE}/find/{urllib.parse.quote(imdb_id)}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if media_kind == "poster":
            for key in ("movie_results", "tv_results"):
                items = data.get(key) or []
                for item in items:
                    pp = item.get("poster_path")
                    if pp:
                        return f"{TMDB_POSTER_BASE}{pp}"
        elif media_kind == "profile":
            items = data.get("person_results") or []
            for item in items:
                pp = item.get("profile_path")
                if pp:
                    return f"{TMDB_PROFILE_BASE}{pp}"
    except Exception:
        return None
    return None


def fmt_hours(minutes: float | None) -> str:
    if minutes is None or not np.isfinite(minutes):
        return "--"
    return f"{minutes / 60.0:,.1f} hrs"


def build_dynamic_insights(payload: dict) -> dict[str, str]:
    k = payload["kpis"]
    timeline = payload["timeline"]
    eras = payload["lifeEras"]
    genres = payload["genres"]
    release_eras = payload["releaseEras"]
    ratings = payload["ratingDistribution"]
    credits = payload["credits"]
    rewatched = payload["topRewatched"]
    season = payload["seasonality"]
    latency = payload["rewatchLatency"]
    runtime_yr = payload["runtimeByWatchYear"]
    vote_depth = payload["voteDepth"]
    viewings = payload["viewings"]

    # 1. Timeline & Life Eras insight
    if timeline:
        peak_q = max(timeline, key=lambda x: x["viewings"])
        pace_era = max(eras, key=lambda x: x["avgPerMonth"]) if eras else None
        era_clause = (
            f" Your highest pace occurred during {pace_era['label']} at {pace_era['avgPerMonth']} films per month ({pace_era['viewings']:,} total viewings)."
            if pace_era
            else ""
        )
        timeline_ins = (
            f"Viewing volume peaked in {peak_q['quarter']} with {peak_q['viewings']} logged watches ({peak_q['totalHours']} hrs).{era_clause}"
        )
    else:
        timeline_ins = "Quarterly viewing volume and life era comparisons populate once log dates are parsed."

    # 2. Genres insight
    top_g = genres["counts"][0] if genres["counts"] else None
    top_pair = genres["coOccurrence"][0] if genres["coOccurrence"] else None
    if top_g:
        share = round((top_g["viewings"] / max(k["totalViewings"], 1)) * 100, 1)
        pair_txt = (
            f" {top_pair['genreA']} + {top_pair['genreB']} is your most frequent overlap at {top_pair['viewings']:,} shared viewings."
            if top_pair
            else ""
        )
        genres_ins = f"{top_g['genre']} appears in {share}% of all logged viewings ({top_g['viewings']:,} watches).{pair_txt}"
    else:
        genres_ins = "Genre dominance and overlap pairings update automatically once IMDb title.basics.tsv.gz is synced."

    # 3. Recency & Release Era insight
    with_lag = [v for v in viewings if v.get("recencyLagYears") is not None]
    if with_lag:
        recent_n = sum(1 for v in with_lag if v["recencyLagYears"] <= 2)
        recent_pct = round((recent_n / len(with_lag)) * 100, 1)
        median_age = int(round(float(np.median([v["recencyLagYears"] for v in with_lag]))))
        peak_u = max(release_eras, key=lambda x: x["uniqueFilms"]) if release_eras else None
        peak_h = max(release_eras, key=lambda x: x["cumulativeHours"]) if release_eras else None
        era_txt = ""
        if peak_u and peak_h:
            if peak_u["era"] == peak_h["era"]:
                era_txt = f" The {peak_u['era']} lead both unique titles ({peak_u['uniqueFilms']}) and total watch time ({peak_h['cumulativeHours']} hrs)."
            else:
                era_txt = f" The {peak_u['era']} lead unique titles ({peak_u['uniqueFilms']}), while the {peak_h['era']} drive the most watch time ({peak_h['cumulativeHours']} hrs)."
        recency_ins = f"Only {recent_pct}% of viewings occur within 2 years of release, with a median film age of {median_age} years.{era_txt}"
    else:
        recency_ins = "Recency lag and release decade splits update automatically once IMDb release years are joined."

    # 4. Ratings & Vote Depth insight
    rated = [v["imdbRating"] for v in viewings if v.get("imdbRating") is not None]
    if rated:
        avg_r = round(float(np.mean(rated)), 2)
        high_share = round((sum(1 for r in rated if r >= 7.0) / len(rated)) * 100, 1)
        peak_bin = max(ratings, key=lambda x: x["viewings"]) if ratings else None
        top_tier = max([t for t in vote_depth if t["tier"] != "Unknown"], key=lambda x: x["viewings"], default=None)
        tier_txt = f" {top_tier['tier']} titles make up {round((top_tier['viewings']/max(k['totalViewings'],1))*100,1)}% of your log." if top_tier else ""
        ratings_ins = (
            f"Your log averages {avg_r}/10 on IMDb, with {high_share}% of viewings rated 7.0 or higher"
            + (f" and peak density at {peak_bin['rating']}." if peak_bin else ".")
            + tier_txt
        )
    else:
        ratings_ins = "IMDb rating averages and vote depth shares populate after syncing title.ratings.tsv.gz."

    # 5. Credits insight
    top_act = credits["actors"][0] if credits["actors"] else None
    top_dir = credits["directors"][0] if credits["directors"] else None
    if top_act or top_dir:
        parts = []
        if top_act:
            parts.append(f"{top_act['name']} leads all actors with {top_act['viewings']} viewings across {top_act['uniqueFilms']} unique films")
        if top_dir:
            parts.append(f"{top_dir['name']} tops directors ({top_dir['viewings']} viewings, {top_dir['uniqueFilms']} films)")
        credits_ins = "; ".join(parts) + "."
    else:
        credits_ins = "Cast and crew rankings populate automatically once IMDb principals and names are synced."

    # 6. Top Rewatched insight
    if rewatched:
        top1 = rewatched[0]
        top10_views = sum(item["views"] for item in rewatched[:10])
        top10_share = round((top10_views / max(k["totalViewings"], 1)) * 100, 1)
        yr_lbl = f" ({top1['releaseYear']})" if top1.get("releaseYear") else ""
        rt_lbl = f", totaling {fmt_hours(top1.get('totalMinutes'))}" if top1.get("totalMinutes") else ""
        rewatches_ins = (
            f"{top1['title']}{yr_lbl} is your most watched film at {top1['views']} viewings{rt_lbl}. "
            f"Your top 10 titles alone account for {top10_share}% of all logged watches."
        )
    else:
        rewatches_ins = "Most watched film rankings update on every log refresh."

    # 7. Behavior (Seasonality, Runtime, Latency) insight
    peak_m = max(season["monthly"], key=lambda x: x["viewings"]) if season["monthly"] else None
    peak_d = max(season["dayOfWeek"], key=lambda x: x["viewings"]) if season["dayOfWeek"] else None
    rt_clause = ""
    if len(runtime_yr) >= 6:
        early_avg = round(float(np.mean([r["avgRuntimeMinutes"] for r in runtime_yr[:5]])), 1)
        late_avg = round(float(np.mean([r["avgRuntimeMinutes"] for r in runtime_yr[-5:]])), 1)
        diff = round(late_avg - early_avg, 1)
        direction = "up" if diff >= 0 else "down"
        rt_clause = f" Average runtime shifted {direction} {abs(diff)} mins from your first 5 years ({early_avg}m) to your last 5 years ({late_avg}m)."
    med_gap = latency.get("medianDays")
    gap_clause = f" Median rewatch wait is {int(round(med_gap)):,} days (average {int(round(latency['avgDays'])):,} days)." if med_gap is not None else ""
    if peak_m and peak_d:
        behavior_ins = (
            f"Viewing peaks in {peak_m['label']} ({peak_m['viewings']} watches) and on {peak_d['day']}s ({peak_d['viewings']} watches)."
            f"{gap_clause}{rt_clause}"
        )
    else:
        behavior_ins = "Seasonality, rewatch latency, and runtime shifts compute automatically from your watch history."

    return {
        "timeline": timeline_ins,
        "genres": genres_ins,
        "recency": recency_ins,
        "ratings": ratings_ins,
        "credits": credits_ins,
        "rewatches": rewatches_ins,
        "behavior": behavior_ins,
    }


def build_payload(
    log_df: pd.DataFrame,
    use_imdb: bool = True,
    tmdb_token: str = "",
    cached_posters: dict[str, str] | None = None,
    cached_profiles: dict[str, str] | None = None,
) -> dict:
    cached_posters = cached_posters or {}
    cached_profiles = cached_profiles or {}

    log_df = log_df.sort_values(["watch_dt", "IMDb ID"]).reset_index(drop=True)
    log_df["viewing_number"] = log_df.groupby("IMDb ID").cumcount() + 1
    log_df["total_views_for_title"] = log_df.groupby("IMDb ID")["IMDb ID"].transform("count")
    log_df["prev_watch_dt"] = log_df.groupby("IMDb ID")["watch_dt"].shift(1)
    log_df["days_since_prev_watch"] = (log_df["watch_dt"] - log_df["prev_watch_dt"]).dt.days

    target_tconsts = set(log_df["IMDb ID"].unique())

    basics_map: dict[str, dict] = {}
    ratings_map: dict[str, dict] = {}
    credits_map: dict[str, dict[str, list[dict]]] = {}

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

    full_viewings = []
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
        total_v_for_title = int(row["total_views_for_title"])
        total_film_mins = round(float(rt) * total_v_for_title, 1) if rt is not None and np.isfinite(rt) else None

        full_viewings.append(
            {
                "id": int(idx) + 1,
                "watchDate": row["watch_date"],
                "watchDt": row["watch_dt"],
                "watchYear": int(row["watch_year"]),
                "watchMonth": int(row["watch_month"]),
                "watchDow": row["watch_dow"],
                "imdbId": tc,
                "title": canonical_title[tc],
                "releaseYear": rel_yr,
                "recencyLagYears": recency_lag,
                "runtimeMinutes": rt,
                "totalFilmMinutes": total_film_mins,
                "genres": b.get("genres", []),
                "imdbRating": r.get("averageRating"),
                "numVotes": r.get("numVotes"),
                "directors": c.get("directors", []),
                "writers": c.get("writers", []),
                "producers": c.get("producers", []),
                "actors": c.get("actors", []),
                "viewingNumber": int(row["viewing_number"]),
                "totalViewsForTitle": total_v_for_title,
                "daysSincePrevWatch": None if pd.isna(row["days_since_prev_watch"]) else int(row["days_since_prev_watch"]),
            }
        )

    latest = sorted(full_viewings, key=lambda x: (x["watchDate"], x["id"]), reverse=True)[0]
    same_tc_views = [v for v in full_viewings if v["imdbId"] == latest["imdbId"]]
    prev_view = same_tc_views[-2] if len(same_tc_views) >= 2 else None

    # Annual sparklines
    annual_map: dict[int, dict] = {}
    all_years = list(range(int(log_df["watch_year"].min()), int(log_df["watch_year"].max()) + 1))
    seen_so_far: set[str] = set()
    by_year = defaultdict(list)
    for v in full_viewings:
        by_year[v["watchYear"]].append(v)

    sparklines = []
    for yr in all_years:
        vs = by_year.get(yr, [])
        n_v = len(vs)
        firsts = sum(1 for v in vs if v["viewingNumber"] == 1)
        rewatches = n_v - firsts
        for v in vs:
            seen_so_far.add(v["imdbId"])
        mins = sum(float(v["runtimeMinutes"]) for v in vs if v["runtimeMinutes"] is not None)
        sparklines.append(
            {
                "year": yr,
                "viewings": n_v,
                "firstWatches": firsts,
                "cumulativeUnique": len(seen_so_far),
                "rewatchPct": round((rewatches / n_v) * 100, 1) if n_v else 0.0,
                "totalHours": round(mins / 60.0, 1),
            }
        )

    # Continuous quarterly timeline from min date to max date
    min_dt = log_df["watch_dt"].min()
    max_dt = log_df["watch_dt"].max()
    q_range = pd.period_range(start=min_dt.to_period("Q"), end=max_dt.to_period("Q"), freq="Q")
    by_quarter = defaultdict(list)
    for v in full_viewings:
        q_key = str(v["watchDt"].to_period("Q"))
        by_quarter[q_key].append(v)

    timeline = []
    for q in q_range:
        q_str = str(q)
        vs = by_quarter.get(q_str, [])
        n_v = len(vs)
        firsts = sum(1 for v in vs if v["viewingNumber"] == 1)
        rewatches = n_v - firsts
        mins = sum(float(v["runtimeMinutes"]) for v in vs if v["runtimeMinutes"] is not None)
        lags = [v["recencyLagYears"] for v in vs if v["recencyLagYears"] is not None]
        top_title = Counter(v["title"] for v in vs).most_common(1)[0][0] if vs else None
        q_start = q.start_time.strftime("%Y-%m-%d")
        q_end = q.end_time.strftime("%Y-%m-%d")
        q_mid = (q.start_time + (q.end_time - q.start_time) / 2).strftime("%Y-%m-%d")
        timeline.append(
            {
                "quarter": q_str,
                "startDate": q_start,
                "endDate": q_end,
                "midDate": q_mid,
                "viewings": n_v,
                "totalHours": round(mins / 60.0, 1),
                "firstWatches": firsts,
                "rewatchPct": round((rewatches / n_v) * 100, 1) if n_v else 0.0,
                "avgFilmAge": round(float(np.mean(lags)), 1) if lags else None,
                "topMovie": top_title,
            }
        )

    # Life Eras Gantt stats
    latest_date_str = max_dt.strftime("%Y-%m-%d")
    life_eras_out = []
    for era in LIFE_ERAS:
        s_str = era["start"]
        e_str = latest_date_str if str(era["end"]).strip().lower() == "present" else era["end"]
        s_dt = pd.to_datetime(s_str)
        e_dt = pd.to_datetime(e_str)
        era_vs = [v for v in full_viewings if s_dt <= v["watchDt"] <= e_dt]
        n_v = len(era_vs)
        u_f = len({v["imdbId"] for v in era_vs})
        mins = sum(float(v["runtimeMinutes"]) for v in era_vs if v["runtimeMinutes"] is not None)
        months = max(1.0, (e_dt - s_dt).days / 30.4375)
        rew_n = sum(1 for v in era_vs if v["viewingNumber"] > 1)
        top_m = Counter(v["title"] for v in era_vs).most_common(1)[0][0] if era_vs else None
        life_eras_out.append(
            {
                "label": era["label"],
                "start": s_str,
                "end": e_str,
                "track": era["track"],
                "color": era["color"],
                "viewings": n_v,
                "uniqueFilms": u_f,
                "totalHours": round(mins / 60.0, 1),
                "avgPerMonth": round(n_v / months, 1),
                "rewatchPct": round((rew_n / n_v) * 100, 1) if n_v else 0.0,
                "topMovie": top_m,
            }
        )

    # Genres & co-occurrence
    genre_view_counts = Counter()
    co_counts = Counter()
    for v in full_viewings:
        gs = sorted(set(v["genres"]))
        for g in gs:
            genre_view_counts[g] += 1
        for i in range(len(gs)):
            for j in range(i + 1, len(gs)):
                co_counts[(gs[i], gs[j])] += 1

    # Cast & crew aggregations (keyed by nconst so headshots match accurately)
    role_counters: dict[str, Counter] = {
        "actors": Counter(),
        "directors": Counter(),
        "writers": Counter(),
        "producers": Counter(),
    }
    role_names: dict[str, dict[str, str]] = {
        "actors": {},
        "directors": {},
        "writers": {},
        "producers": {},
    }
    role_unique_titles: dict[str, dict[str, set[str]]] = {
        "actors": defaultdict(set),
        "directors": defaultdict(set),
        "writers": defaultdict(set),
        "producers": defaultdict(set),
    }
    for v in full_viewings:
        for role in role_counters:
            for person in v.get(role, []):
                nm = person["nconst"]
                role_counters[role][nm] += 1
                role_names[role][nm] = person["name"]
                role_unique_titles[role][nm].add(v["imdbId"])

    credits_out = {}
    for role, counter in role_counters.items():
        top_list = []
        for nm, cnt in counter.most_common(12):
            profile_url = cached_profiles.get(nm)
            if not profile_url and tmdb_token:
                profile_url = fetch_tmdb_media(nm, "profile", tmdb_token)
                if profile_url:
                    cached_profiles[nm] = profile_url
                time.sleep(0.05)
            top_list.append(
                {
                    "nconst": nm,
                    "name": role_names[role][nm],
                    "viewings": cnt,
                    "uniqueFilms": len(role_unique_titles[role][nm]),
                    "profileUrl": profile_url,
                }
            )
        credits_out[role] = top_list

    # Top rewatched films with release year and poster URL
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
                "totalHours": round((float(rt) * cnt) / 60.0, 1) if rt is not None else None,
                "firstWatched": grp["watch_date"].min(),
                "lastWatched": grp["watch_date"].max(),
                "posterUrl": None,
            }
        )
    rewatched_summary.sort(key=lambda x: (-x["views"], -(x["totalMinutes"] or 0), x["title"]))
    top_rewatched = rewatched_summary[:15]

    for item in top_rewatched:
        tc = item["imdbId"]
        purl = cached_posters.get(tc)
        if not purl and tmdb_token:
            purl = fetch_tmdb_media(tc, "poster", tmdb_token)
            if purl:
                cached_posters[tc] = purl
            time.sleep(0.05)
        item["posterUrl"] = purl

    latest_poster = cached_posters.get(latest["imdbId"])
    if not latest_poster and tmdb_token:
        latest_poster = fetch_tmdb_media(latest["imdbId"], "poster", tmdb_token)
        if latest_poster:
            cached_posters[latest["imdbId"]] = latest_poster

    # Seasonality: monthly, weekday, and 12x7 Month x Weekday matrix
    month_order = list(range(1, 13))
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_short = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    monthly_counts = [
        {"month": m, "label": month_names[m - 1], "viewings": int((log_df["watch_month"] == m).sum())}
        for m in month_order
    ]
    dow_counts = [
        {"day": d, "short": dow_short[i], "viewings": int((log_df["watch_dow"] == d).sum())}
        for i, d in enumerate(dow_order)
    ]

    md_counts = Counter((v["watchMonth"], v["watchDow"]) for v in full_viewings)
    md_mins = defaultdict(float)
    for v in full_viewings:
        if v["runtimeMinutes"] is not None:
            md_mins[(v["watchMonth"], v["watchDow"])] += float(v["runtimeMinutes"])

    season_matrix = []
    for m in month_order:
        for i, d in enumerate(dow_order):
            season_matrix.append(
                {
                    "month": m,
                    "monthLabel": month_names[m - 1],
                    "dayIndex": i,
                    "day": d,
                    "dayShort": dow_short[i],
                    "viewings": md_counts.get((m, d), 0),
                    "totalHours": round(md_mins.get((m, d), 0.0) / 60.0, 1),
                }
            )

    # Rewatch latency
    gaps = [v["daysSincePrevWatch"] for v in full_viewings if v["daysSincePrevWatch"] is not None]
    latency_buckets = [
        {"bucket": "Within 30d", "count": sum(1 for g in gaps if g <= 30)},
        {"bucket": "31-180d", "count": sum(1 for g in gaps if 31 <= g <= 180)},
        {"bucket": "181-365d", "count": sum(1 for g in gaps if 181 <= g <= 365)},
        {"bucket": "1-3 yrs", "count": sum(1 for g in gaps if 366 <= g <= 1095)},
        {"bucket": "3+ yrs", "count": sum(1 for g in gaps if g > 1095)},
    ]

    # Release eras
    era_unique: dict[str, set[str]] = defaultdict(set)
    era_minutes: dict[str, float] = defaultdict(float)
    for v in full_viewings:
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

    # Rating distribution
    rating_bins = defaultdict(int)
    for v in full_viewings:
        rtg = v["imdbRating"]
        if rtg is not None:
            b_val = round(float(rtg) * 2) / 2
            rating_bins[b_val] += 1

    rating_distribution = [{"rating": k, "viewings": rating_bins[k]} for k in sorted(rating_bins.keys())]

    # Runtime trend by watch year
    rt_by_yr: dict[int, list[float]] = defaultdict(list)
    for v in full_viewings:
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

    # Vote depth
    vote_tiers = Counter()
    for v in full_viewings:
        nv = v["numVotes"]
        if nv is None:
            vote_tiers["Unknown"] += 1
        elif nv >= 250_000:
            vote_tiers["Blockbuster (250k+)"] += 1
        elif nv >= 50_000:
            vote_tiers["Mainstream (50k-250k)"] += 1
        elif nv >= 10_000:
            vote_tiers["Cult / Mid-Tier (10k-50k)"] += 1
        else:
            vote_tiers["Niche (<10k)"] += 1

    tier_order = ["Blockbuster (250k+)", "Mainstream (50k-250k)", "Cult / Mid-Tier (10k-50k)", "Niche (<10k)", "Unknown"]
    vote_depth_out = [{"tier": t, "viewings": vote_tiers[t]} for t in tier_order if vote_tiers[t] > 0]

    # Trimmed viewings for table + scatter
    trimmed_viewings = [
        {
            "watchDate": v["watchDate"],
            "watchYear": v["watchYear"],
            "imdbId": v["imdbId"],
            "title": v["title"],
            "releaseYear": v["releaseYear"],
            "recencyLagYears": v["recencyLagYears"],
            "runtimeMinutes": v["runtimeMinutes"],
            "totalFilmMinutes": v["totalFilmMinutes"],
            "genres": v["genres"],
            "imdbRating": v["imdbRating"],
            "viewingNumber": v["viewingNumber"],
            "totalViewsForTitle": v["totalViewsForTitle"],
        }
        for v in sorted(full_viewings, key=lambda x: (x["watchDate"], x["id"]), reverse=True)
    ]

    payload = {
        "meta": {
            "title": "Meier Movie Database",
            "badge": "MMDb",
            "dateRange": {
                "start": log_df["watch_date"].min(),
                "end": log_df["watch_date"].max(),
            },
            "imdbDatasetsIncluded": bool(use_imdb),
            "tmdbMediaIncluded": bool(tmdb_token and (latest_poster or any(i.get("posterUrl") for i in top_rewatched))),
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
        "sparklines": sparklines,
        "mostRecentWatch": {
            "title": latest["title"],
            "imdbId": latest["imdbId"],
            "watchDate": latest["watchDate"],
            "releaseYear": latest["releaseYear"],
            "imdbRating": latest["imdbRating"],
            "runtimeMinutes": latest["runtimeMinutes"],
            "totalFilmMinutes": latest["totalFilmMinutes"],
            "genres": latest["genres"],
            "viewingNumber": latest["viewingNumber"],
            "totalViewsForTitle": latest["totalViewsForTitle"],
            "daysSincePrevWatch": latest["daysSincePrevWatch"],
            "prevWatchDate": prev_view["watchDate"] if prev_view else None,
            "posterUrl": latest_poster,
        },
        "timeline": timeline,
        "lifeEras": life_eras_out,
        "genres": {
            "counts": [{"genre": g, "viewings": c} for g, c in genre_view_counts.most_common()],
            "coOccurrence": [
                {"genreA": a, "genreB": b, "viewings": c}
                for (a, b), c in co_counts.most_common(60)
            ],
        },
        "credits": credits_out,
        "topRewatched": top_rewatched,
        "releaseEras": release_eras,
        "ratingDistribution": rating_distribution,
        "seasonality": {
            "monthly": monthly_counts,
            "dayOfWeek": dow_counts,
            "matrix": season_matrix,
        },
        "rewatchLatency": {
            "avgDays": round(float(np.mean(gaps)), 1) if gaps else None,
            "medianDays": round(float(np.median(gaps)), 1) if gaps else None,
            "buckets": latency_buckets,
        },
        "runtimeByWatchYear": runtime_by_watch_year,
        "voteDepth": vote_depth_out,
        "viewings": trimmed_viewings,
    }
    payload["insights"] = build_dynamic_insights(payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build data.json for Meier Movie Database.")
    parser.add_argument("--csv", type=str, default=None, help="Optional path to local Film_Log.csv")
    parser.add_argument("--out", type=str, default="data.json", help="Output JSON path")
    parser.add_argument("--skip-imdb", action="store_true", help="Skip remote IMDb .tsv.gz download for fast local smoke test")
    args = parser.parse_args()

    out_path = Path(args.out)
    cached_posters, cached_profiles = load_existing_media_cache(out_path)
    tmdb_token = os.environ.get("TMDB_API_KEY", "").strip()

    log_df = load_film_log(args.csv)
    payload = build_payload(
        log_df,
        use_imdb=not args.skip_imdb,
        tmdb_token=tmdb_token,
        cached_posters=cached_posters,
        cached_profiles=cached_profiles,
    )
    json_str = json.dumps(payload, separators=(",", ":"), allow_nan=False)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json_str, encoding="utf-8")
    print(f"Wrote {out_path} ({len(json_str):,} bytes) with {payload['kpis']['totalViewings']} viewings.")


if __name__ == "__main__":
    main()
