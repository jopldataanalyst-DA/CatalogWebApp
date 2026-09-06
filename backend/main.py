"""Public Catalog webapp API.

Use case:
    A public, unauthenticated gallery for B2B buyers. Serves exactly the
    rows the "B2B Catalog" sub-tab (Image Collection page, in
    PricingManagementSystem) has marked active, live from the shared
    Postgres database - no caching layer, no sync job. Available sizes are
    computed fresh on every request from item_master + stock_items: a size
    shows only when (Uniware qty - 2) > 0, and the raw quantity itself is
    never returned to the client.
"""

import re
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from db import fetch_all, fetch_one

app = FastAPI(title="Rajnandini B2B Catalog")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Same live-computed CTE as PricingManagementSystem's B2BCatalog.py -
# sizes/availability are never stored, only ever derived from current stock.
_SKU_STOCK_CTE = """
    sku_stock AS (
        SELECT im."Style ID / Parent SKU" AS style_id, im."Size" AS size,
               COALESCE(si.available_atp, 0) AS qty
        FROM item_master im
        LEFT JOIN (
            SELECT DISTINCT ON (UPPER(TRIM(sku_code))) *
            FROM stock_items
            ORDER BY UPPER(TRIM(sku_code)), id DESC
        ) si ON UPPER(TRIM(im."Master SKU")) = UPPER(TRIM(si.sku_code))
        WHERE im."Style ID / Parent SKU" IS NOT NULL AND im."Style ID / Parent SKU" != ''
    )
"""


# Category is never stored on b2b_catalog - live-joined from item_master on
# every read, same as PricingManagementSystem's own Catalog/B2B Catalog tabs.
_ITEM_MASTER_CATEGORY_CTE = """
    im_category AS (
        SELECT DISTINCT ON ("Style ID / Parent SKU") "Style ID / Parent SKU" AS style_id, "Category" AS category
        FROM item_master
        WHERE "Style ID / Parent SKU" IS NOT NULL AND "Style ID / Parent SKU" != ''
    )
"""


@app.get("/api/catalog")
async def list_catalog(
    search: str = Query("", description="Search by Style ID"),
    categories: list[str] = Query([], description="Filter by Category (any of)"),
    fabrics: list[str] = Query([], description="Filter by Fabric (any of)"),
    sizes: list[str] = Query([], description="Filter by Size (any of, matches currently-in-stock sizes)"),
    price_min: Optional[float] = Query(None),
    price_max: Optional[float] = Query(None),
):
    """Every active B2B Catalog style with at least one image, cover
    thumbnail, fabric, category, price, and the sizes currently in stock."""
    where = ["cat.is_active = TRUE"]
    params: list = []
    if search:
        where.append("cat.style_id ILIKE %s")
        params.append(f"%{search}%")
    if categories:
        where.append("cat.category = ANY(%s)")
        params.append(categories)
    if fabrics:
        where.append("cat.fabric = ANY(%s)")
        params.append(fabrics)
    if price_min is not None:
        where.append("cat.price >= %s")
        params.append(price_min)
    if price_max is not None:
        where.append("cat.price <= %s")
        params.append(price_max)
    where_sql = "WHERE " + " AND ".join(where)

    having = ["(SELECT COUNT(*) FROM b2b_catalog_images bci WHERE bci.style_id = cat.style_id) > 0"]
    having_params: list = []
    if sizes:
        having.append(
            "array_remove(array_agg(DISTINCT sku_stock.size) FILTER (WHERE sku_stock.qty - 2 > 0), NULL) && %s"
        )
        having_params.append(sizes)
    having_sql = "HAVING " + " AND ".join(having)

    rows = fetch_all(
        f"""
        WITH {_ITEM_MASTER_CATEGORY_CTE},
        cat_all AS (
            SELECT b.*, imc.category
            FROM b2b_catalog b
            LEFT JOIN im_category imc ON imc.style_id = b.style_id
        ),
        cat AS (SELECT * FROM cat_all AS cat {where_sql}),
        {_SKU_STOCK_CTE}
        SELECT
            cat.style_id, cat.fabric, cat.category, cat.price,
            array_remove(array_agg(DISTINCT sku_stock.size) FILTER (WHERE sku_stock.qty - 2 > 0), NULL) AS sizes_available,
            (
                SELECT ic.drive_file_id FROM b2b_catalog_images bci
                JOIN image_collection ic ON ic.id = bci.image_id
                WHERE bci.style_id = cat.style_id
                ORDER BY bci.position, bci.id LIMIT 1
            ) AS thumb_file_id,
            (SELECT COUNT(*) FROM b2b_catalog_images bci WHERE bci.style_id = cat.style_id) AS image_count
        FROM cat
        LEFT JOIN sku_stock ON UPPER(TRIM(sku_stock.style_id)) = UPPER(TRIM(cat.style_id))
        GROUP BY cat.style_id, cat.fabric, cat.category, cat.price
        {having_sql}
        ORDER BY cat.style_id ASC
        """,
        (*params, *having_params),
    )

    return {
        "items": [
            {
                "style_id": r["style_id"],
                "fabric": r.get("fabric") or "Cotton",
                "category": r.get("category") or "Unknown",
                "price": float(r["price"]) if r.get("price") is not None else None,
                "sizes_available": sorted(r.get("sizes_available") or []),
                "image_count": r.get("image_count") or 0,
                "cover_image_id": r.get("thumb_file_id"),
            }
            for r in rows
        ]
    }


@app.get("/api/categories")
async def list_categories():
    """Distinct categories currently present in the active B2B Catalog -
    powers the sidebar's Category filter."""
    rows = fetch_all(
        f"""
        WITH {_ITEM_MASTER_CATEGORY_CTE}
        SELECT DISTINCT imc.category AS category
        FROM b2b_catalog b
        JOIN im_category imc ON imc.style_id = b.style_id
        WHERE b.is_active = TRUE AND imc.category IS NOT NULL
        ORDER BY category ASC
        """
    )
    return {"categories": [r["category"] for r in rows]}


@app.get("/api/fabrics")
async def list_fabrics():
    """Distinct fabrics currently present in the active B2B Catalog -
    powers the sidebar's Fabric filter."""
    rows = fetch_all(
        "SELECT DISTINCT fabric FROM b2b_catalog WHERE is_active = TRUE AND fabric IS NOT NULL ORDER BY fabric ASC"
    )
    return {"fabrics": [r["fabric"] for r in rows]}


_SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "3XL", "4XL", "5XL"]


def _size_sort_key(size: str):
    if size in _SIZE_ORDER:
        return (0, _SIZE_ORDER.index(size))
    if size.replace(".", "", 1).isdigit():
        return (1, float(size))
    return (2, size)


@app.get("/api/sizes")
async def list_sizes():
    """Distinct sizes currently in stock (qty - 2 > 0) across the active B2B
    Catalog - powers the sidebar's Size filter. Uses the same live stock CTE
    as everything else, so a size only appears here while it's actually
    orderable somewhere in the catalog. Sorted in garment-size order
    (XS..5XL, then numeric sizes, then anything else alphabetically) rather
    than plain alphabetical, which would put "L" before "M" before "S" but
    "XL" before "L" too - wrong reading order for a shopper."""
    rows = fetch_all(
        f"""
        WITH {_SKU_STOCK_CTE}
        SELECT DISTINCT sku_stock.size
        FROM sku_stock
        JOIN b2b_catalog b ON b.style_id = sku_stock.style_id AND b.is_active = TRUE
        WHERE sku_stock.qty - 2 > 0
        """
    )
    sizes = sorted((r["size"] for r in rows if r["size"]), key=_size_sort_key)
    return {"sizes": sizes}


@app.get("/api/catalog/{style_id}")
async def get_style(style_id: str):
    cat_row = fetch_one(
        f"""
        WITH {_ITEM_MASTER_CATEGORY_CTE}
        SELECT b.style_id, b.fabric, b.price, imc.category
        FROM b2b_catalog b
        LEFT JOIN im_category imc ON imc.style_id = b.style_id
        WHERE b.style_id = %s AND b.is_active = TRUE
        """,
        (style_id,),
    )
    if not cat_row:
        raise HTTPException(status_code=404, detail="Style not found")

    size_rows = fetch_all(
        f"""
        WITH {_SKU_STOCK_CTE}
        SELECT size, qty FROM sku_stock WHERE UPPER(TRIM(style_id)) = UPPER(TRIM(%s))
        """,
        (style_id,),
    )
    sizes_available = sorted({r["size"] for r in size_rows if r.get("size") and (r.get("qty") or 0) - 2 > 0})

    image_rows = fetch_all(
        """
        SELECT ic.drive_file_id, ic.filename
        FROM b2b_catalog_images bci
        JOIN image_collection ic ON ic.id = bci.image_id
        WHERE bci.style_id = %s
        ORDER BY bci.position, bci.id
        """,
        (style_id,),
    )
    images = [
        {"drive_file_id": r["drive_file_id"], "filename": r["filename"]}
        for r in image_rows
    ]

    return {
        "style_id": cat_row["style_id"],
        "fabric": cat_row.get("fabric") or "Cotton",
        "category": cat_row.get("category") or "Unknown",
        "price": float(cat_row["price"]) if cat_row.get("price") is not None else None,
        "sizes_available": sizes_available,
        "images": images,
    }


def _fetch_drive_image_sync(file_id: str, sz: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    urls_to_try = [
        f"https://drive.google.com/thumbnail?id={file_id}&sz={sz}",
        f"https://lh3.googleusercontent.com/d/{file_id}",
        f"https://drive.google.com/uc?export=download&id={file_id}",
    ]
    last_error: Optional[Exception] = None
    for candidate in urls_to_try:
        try:
            req = urllib.request.Request(candidate, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as response:
                content_type = response.headers.get("Content-Type", "image/jpeg")
                if "text/html" in content_type:
                    continue
                data = response.read()
                if data and len(data) > 200:
                    return data, content_type
        except Exception as e:
            last_error = e
            continue
    raise RuntimeError(f"Failed to fetch image: {last_error}")


@app.get("/api/image-proxy")
async def image_proxy(id: str = Query(..., description="Google Drive file id"), sz: str = Query("w800")):
    """Self-contained proxy for Drive thumbnails - avoids browser CORS /
    anti-hotlinking issues on a raw drive.google.com <img src>, and keeps
    this app independent of PricingManagementSystem's own proxy/server."""
    if not re.fullmatch(r"[\w-]+", id):
        raise HTTPException(status_code=400, detail="Invalid file id")
    try:
        data, content_type = await run_in_threadpool(_fetch_drive_image_sync, id, sz)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------------------
# Serve the built frontend (production only - `frontend/` builds into
# `backend/static/` per vite.config.ts). In local dev this directory doesn't
# exist, so these blocks are no-ops and the Vite dev server (with its own
# /api proxy to this backend) serves the UI instead. Same single-container
# pattern PricingManagementSystem's Main.py uses for its own SPA.
# ---------------------------------------------------------------------------

_static_dir = Path(__file__).parent / "static"
_spa_index = _static_dir / "index.html"

if (_static_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_catchall(request: Request, full_path: str):
    if full_path.startswith("api/"):
        return HTMLResponse(content='{"detail":"Not Found"}', status_code=404, media_type="application/json")
    # Public root files copied verbatim from frontend/public/ (favicon.svg
    # etc.) - not under /assets, so they need this direct check before
    # falling through to the SPA shell.
    candidate = _static_dir / full_path
    if full_path and candidate.is_file() and _static_dir in candidate.resolve().parents:
        return FileResponse(str(candidate))
    if _spa_index.exists():
        response = FileResponse(str(_spa_index), media_type="text/html")
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response
    return HTMLResponse(content="<h1>Frontend build not found. Run: npm run build</h1>", status_code=503)
