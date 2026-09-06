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
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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
async def list_catalog(search: str = Query("", description="Search by Style ID"), category: str = Query("", description="Filter by Category")):
    """Every active B2B Catalog style with at least one image, cover
    thumbnail, fabric, category, price, and the sizes currently in stock."""
    where = ["cat.is_active = TRUE"]
    params: list = []
    if search:
        where.append("cat.style_id ILIKE %s")
        params.append(f"%{search}%")
    if category:
        where.append("cat.category = %s")
        params.append(category)
    where_sql = "WHERE " + " AND ".join(where)

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
            (SELECT MIN(drive_file_id) FROM image_collection ic WHERE ic.style_id = cat.style_id) AS thumb_file_id,
            (SELECT COUNT(*) FROM image_collection ic WHERE ic.style_id = cat.style_id) AS image_count
        FROM cat
        LEFT JOIN sku_stock ON UPPER(TRIM(sku_stock.style_id)) = UPPER(TRIM(cat.style_id))
        GROUP BY cat.style_id, cat.fabric, cat.category, cat.price
        HAVING (SELECT COUNT(*) FROM image_collection ic WHERE ic.style_id = cat.style_id) > 0
        ORDER BY cat.style_id ASC
        """,
        tuple(params),
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
    powers the gallery's category filter chips."""
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
        "SELECT drive_file_id, filename FROM image_collection WHERE style_id = %s ORDER BY uploaded_at ASC",
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
