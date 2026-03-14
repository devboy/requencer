"""JLCPCB parts database — download, cache, and query stock levels.

Uses the CDFER/jlcpcb-parts-database community SQLite database
(updated daily via GitHub Actions). No API key required.

Download URL: GitHub releases → jlcpcb-components.db
Cache: hardware/boards/build/jlcpcb-parts.sqlite3 (7-day TTL)
"""

import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import requests

DB_URL = (
    "https://github.com/CDFER/jlcpcb-parts-database/releases/latest/download/"
    "cache.sqlite3"
)
CACHE_MAX_AGE_SECONDS = 7 * 24 * 3600  # 7 days


@dataclass
class StockInfo:
    lcsc: str
    description: str
    stock: int
    price: float | None  # Unit price USD, None if unavailable
    library_type: str  # "basic" or "extended"
    found: bool = True


NOT_FOUND = StockInfo(
    lcsc="", description="", stock=0, price=None, library_type="", found=False
)


def _db_is_fresh(db_path: Path) -> bool:
    """Check if cached DB file exists and is within TTL."""
    if not db_path.exists():
        return False
    age = time.time() - db_path.stat().st_mtime
    return age < CACHE_MAX_AGE_SECONDS


def ensure_db(cache_path: Path) -> Path:
    """Download JLCPCB parts database if missing or stale. Returns path to DB."""
    if _db_is_fresh(cache_path):
        age_days = (time.time() - cache_path.stat().st_mtime) / 86400
        print(f"  Using cached JLCPCB DB ({age_days:.0f} days old): {cache_path}")
        return cache_path

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"  Downloading JLCPCB parts database...")
    print(f"  URL: {DB_URL}")

    headers = {}
    if cache_path.exists():
        # Use If-Modified-Since for conditional download
        mtime = os.path.getmtime(cache_path)
        headers["If-Modified-Since"] = time.strftime(
            "%a, %d %b %Y %H:%M:%S GMT", time.gmtime(mtime)
        )

    resp = requests.get(DB_URL, headers=headers, stream=True, timeout=120)

    if resp.status_code == 304:
        print("  DB not modified, keeping cached version.")
        cache_path.touch()  # Reset mtime
        return cache_path

    resp.raise_for_status()

    # Stream download with progress
    total = int(resp.headers.get("content-length", 0))
    downloaded = 0
    tmp_path = cache_path.with_suffix(".tmp")

    with open(tmp_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                mb = downloaded / 1024 / 1024
                print(f"\r  Downloaded {mb:.0f}MB ({pct:.0f}%)", end="", flush=True)

    print()
    tmp_path.rename(cache_path)
    print(f"  Saved: {cache_path} ({downloaded / 1024 / 1024:.0f}MB)")
    return cache_path


def _discover_schema(conn: sqlite3.Connection) -> dict:
    """Discover table name and column names in the database."""
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = [row[0] for row in cursor.fetchall()]

    # Try common table names
    for table in tables:
        cursor = conn.execute(f"PRAGMA table_info({table})")
        columns = {row[1].lower(): row[1] for row in cursor.fetchall()}
        # Check if this looks like a parts table
        if any(k in columns for k in ("lcsc", "lcsc_part")):
            return {"table": table, "columns": columns}

    return {"table": tables[0] if tables else "", "columns": {}}


def check_stock(db_path: Path, lcsc_numbers: list[str]) -> dict[str, StockInfo]:
    """Query stock info for a list of LCSC part numbers.

    Returns dict mapping LCSC number to StockInfo.
    """
    if not lcsc_numbers:
        return {}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    schema = _discover_schema(conn)
    if not schema["table"]:
        print("  WARNING: No parts table found in JLCPCB database")
        conn.close()
        return {lcsc: NOT_FOUND for lcsc in lcsc_numbers}

    table = schema["table"]
    cols = schema["columns"]

    # Find the right column names (database schema varies between versions)
    lcsc_col = cols.get("lcsc_part") or cols.get("lcsc") or cols.get("lcsc_number", "")
    stock_col = cols.get("stock", "")
    price_col = cols.get("price", "")
    lib_col = (
        cols.get("library_type")
        or cols.get("basic_or_extended")
        or cols.get("type", "")
    )
    desc_col = cols.get("description", cols.get("desc", ""))

    if not lcsc_col:
        print(f"  WARNING: Cannot find LCSC column in table '{table}'")
        print(f"  Available columns: {list(cols.keys())}")
        conn.close()
        return {lcsc: NOT_FOUND for lcsc in lcsc_numbers}

    results = {}
    for lcsc in lcsc_numbers:
        if not lcsc or lcsc in ("C0000", "TBD"):
            results[lcsc] = NOT_FOUND
            continue

        try:
            cursor = conn.execute(
                f"SELECT * FROM {table} WHERE {lcsc_col} = ? LIMIT 1", (lcsc,)
            )
            row = cursor.fetchone()
        except sqlite3.OperationalError:
            results[lcsc] = NOT_FOUND
            continue

        if row is None:
            results[lcsc] = StockInfo(
                lcsc=lcsc, description="", stock=0, price=None,
                library_type="", found=False,
            )
            continue

        row_dict = dict(row)
        # Extract values by trying different column name conventions
        stock_val = 0
        if stock_col and stock_col in row_dict:
            try:
                stock_val = int(row_dict[stock_col])
            except (ValueError, TypeError):
                pass

        price_val = None
        if price_col and price_col in row_dict:
            try:
                price_val = float(row_dict[price_col])
            except (ValueError, TypeError):
                pass

        lib_val = ""
        if lib_col and lib_col in row_dict:
            lib_val = str(row_dict[lib_col] or "")

        desc_val = ""
        if desc_col and desc_col in row_dict:
            desc_val = str(row_dict[desc_col] or "")

        results[lcsc] = StockInfo(
            lcsc=lcsc,
            description=desc_val,
            stock=stock_val,
            price=price_val,
            library_type=lib_val,
            found=True,
        )

    conn.close()
    return results
