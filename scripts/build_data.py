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
    df = df[df["watch_dt"].notna() & df["IMDb ID"].str.
