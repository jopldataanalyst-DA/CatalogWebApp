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

# Style-level sales tier ("Diamond A/B/C", "Platinum A/B/C", "Slow Moving",
# "New Listing", ...) from PricingManagementSystem's Item Master "Sales Qty"
# tab - computed there from 3 months of real unified sales data, synced
# on-demand into `sales_qty_remarks` (keyed by Master SKU). Every SKU under
# one style carries the same style-level ("parent") remark, so DISTINCT ON
# picks any one of them per style; a style with no synced remark yet (never
# run through that tab, or genuinely has none) simply won't appear in a
# tier-based homepage section - not an error, just unclassified.
_SKU_PRICE_AVG_CTE = """
    sku_price_avg AS (
        SELECT style_id, AVG(price) AS avg_price
        FROM b2b_catalog_sku_prices
        GROUP BY style_id
    )
"""

_STYLE_TIER_CTE = """
    style_tier AS (
        SELECT DISTINCT ON (im."Style ID / Parent SKU")
            im."Style ID / Parent SKU" AS style_id,
            sqr.computed_parent_remark AS tier
        FROM item_master im
        JOIN sales_qty_remarks sqr ON sqr.master_sku = im."Master SKU"
        WHERE im."Style ID / Parent SKU" IS NOT NULL AND im."Style ID / Parent SKU" != ''
        ORDER BY im."Style ID / Parent SKU", sqr.updated_at DESC
    )
"""

_TIER_RANK = {"Diamond A": 0, "Diamond B": 1, "Diamond C": 2, "Platinum A": 3, "Platinum B": 4, "Platinum C": 5}
_BEST_SELLER_TIERS = ("Diamond A", "Diamond B", "Diamond C")
_TRENDING_TIERS = ("Platinum A", "Platinum B", "Platinum C")
# "New Arrivals" = the N most-recently-added active styles, NOT a fixed time
# window - a day/week cutoff is meaningless right after a bulk import (every
# style would tie on "added today"), and stays meaningful indefinitely once
# styles trickle in one at a time (the window just naturally slides).
_NEW_ARRIVALS_LIMIT = 60

# Public, shopper-facing collections - never expose PricingManagementSystem's
# internal tier jargon ("Diamond"/"Platinum") to the storefront. "Browse all"
# on a homepage section links to /search?collection=<key>, which this same
# key filters down to - so the deep link always matches what was shown.
_COLLECTIONS = {
    "best_sellers": {"title": "Best Sellers", "subtitle": "Our top-performing styles by sales volume", "badge": "Best Seller"},
    "trending_now": {"title": "Trending Now", "subtitle": "Consistently strong sellers", "badge": "Trending"},
    "new_arrivals": {"title": "New Arrivals", "subtitle": "Freshly added to the catalog", "badge": "New"},
}


def _badge_for_tier(tier: Optional[str]) -> Optional[str]:
    if tier in _BEST_SELLER_TIERS:
        return "Best Seller"
    if tier in _TRENDING_TIERS:
        return "Trending"
    return None


@app.get("/api/catalog")
async def list_catalog(
    search: str = Query("", description="Search by Style ID"),
    categories: list[str] = Query([], description="Filter by Category (any of)"),
    fabrics: list[str] = Query([], description="Filter by Fabric (any of)"),
    sizes: list[str] = Query([], description="Filter by Size (any of, matches currently-in-stock sizes)"),
    price_min: Optional[float] = Query(None),
    price_max: Optional[float] = Query(None),
    include_out_of_stock: bool = Query(False, description="Show styles with zero sizes currently in stock too"),
    collection: str = Query("", description="One of best_sellers/trending_now/new_arrivals - matches a homepage section's 'Browse all' link"),
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
        where.append("cat.effective_price >= %s")
        params.append(price_min)
    if price_max is not None:
        where.append("cat.effective_price <= %s")
        params.append(price_max)
    if collection == "best_sellers":
        where.append("cat.tier = ANY(%s)")
        params.append(list(_BEST_SELLER_TIERS))
    elif collection == "trending_now":
        where.append("cat.tier = ANY(%s)")
        params.append(list(_TRENDING_TIERS))
    elif collection == "new_arrivals":
        where.append(
            f"cat.style_id IN (SELECT style_id FROM b2b_catalog WHERE is_active = TRUE ORDER BY added_at DESC LIMIT {_NEW_ARRIVALS_LIMIT})"
        )
    where_sql = "WHERE " + " AND ".join(where)

    having = ["(SELECT COUNT(*) FROM b2b_catalog_images bci WHERE bci.style_id = cat.style_id) > 0"]
    having_params: list = []
    if not include_out_of_stock:
        having.append(
            "array_length(array_remove(array_agg(DISTINCT sku_stock.size) FILTER (WHERE sku_stock.qty - 2 > 0), NULL), 1) > 0"
        )
    if sizes:
        having.append(
            "array_remove(array_agg(DISTINCT sku_stock.size) FILTER (WHERE sku_stock.qty - 2 > 0), NULL) && %s"
        )
        having_params.append(sizes)
    having_sql = "HAVING " + " AND ".join(having)

    rows = fetch_all(
        f"""
        WITH {_ITEM_MASTER_CATEGORY_CTE},
        {_STYLE_TIER_CTE},
        {_SKU_PRICE_AVG_CTE},
        cat_all AS (
            SELECT b.*, imc.category, st.tier, COALESCE(spa.avg_price, b.price) AS effective_price
            FROM b2b_catalog b
            LEFT JOIN im_category imc ON imc.style_id = b.style_id
            LEFT JOIN style_tier st ON st.style_id = b.style_id
            LEFT JOIN sku_price_avg spa ON spa.style_id = b.style_id
        ),
        cat AS (SELECT * FROM cat_all AS cat {where_sql}),
        {_SKU_STOCK_CTE}
        SELECT
            cat.style_id, cat.fabric, cat.category, cat.effective_price AS price, cat.tier,
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
        GROUP BY cat.style_id, cat.fabric, cat.category, cat.effective_price, cat.tier
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
                "sizes_available": sorted(r.get("sizes_available") or [], key=_size_sort_key),
                "image_count": r.get("image_count") or 0,
                "cover_image_id": r.get("thumb_file_id"),
                "tier": "New" if collection == "new_arrivals" else _badge_for_tier(r.get("tier")),
            }
            for r in rows
        ],
        "collection_title": _COLLECTIONS.get(collection, {}).get("title"),
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


@app.get("/api/home")
async def home_sections(per_section: int = Query(12, ge=1, le=30)):
    """Curated homepage sections, driven by real data instead of an
    arbitrary/random product order - never PricingManagementSystem's
    internal tier jargon ("Diamond"/"Platinum"), always the public
    `_COLLECTIONS` labels. "Best Sellers"/"Trending Now" come from Item
    Master's "Sales Qty" tab (3 months of real unified sales, synced
    on-demand into `sales_qty_remarks`); "New Arrivals" is simply the N
    most-recently-added active styles (`b2b_catalog.added_at`, no sales-sync
    step needed at all). A style with no synced sales tier and outside the
    recently-added set just doesn't appear in any section - the full
    catalog is still reachable via /search."""
    rows = fetch_all(
        f"""
        WITH {_ITEM_MASTER_CATEGORY_CTE},
        {_STYLE_TIER_CTE},
        {_SKU_PRICE_AVG_CTE},
        recent AS (
            SELECT style_id FROM b2b_catalog WHERE is_active = TRUE ORDER BY added_at DESC LIMIT {_NEW_ARRIVALS_LIMIT}
        ),
        cat AS (
            SELECT b.*, imc.category, st.tier, COALESCE(spa.avg_price, b.price) AS effective_price
            FROM b2b_catalog b
            LEFT JOIN im_category imc ON imc.style_id = b.style_id
            LEFT JOIN style_tier st ON st.style_id = b.style_id
            LEFT JOIN sku_price_avg spa ON spa.style_id = b.style_id
            WHERE b.is_active = TRUE
              AND (
                st.tier IN ('Diamond A', 'Diamond B', 'Diamond C', 'Platinum A', 'Platinum B', 'Platinum C')
                OR b.style_id IN (SELECT style_id FROM recent)
              )
        ),
        {_SKU_STOCK_CTE}
        SELECT
            cat.style_id, cat.fabric, cat.category, cat.effective_price AS price, cat.tier, cat.added_at,
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
        GROUP BY cat.style_id, cat.fabric, cat.category, cat.effective_price, cat.tier, cat.added_at
        HAVING (SELECT COUNT(*) FROM b2b_catalog_images bci WHERE bci.style_id = cat.style_id) > 0
        ORDER BY cat.style_id ASC
        """
    )

    def to_item(r, badge):
        return {
            "style_id": r["style_id"],
            "fabric": r.get("fabric") or "Cotton",
            "category": r.get("category") or "Unknown",
            "price": float(r["price"]) if r.get("price") is not None else None,
            "sizes_available": sorted(r.get("sizes_available") or [], key=_size_sort_key),
            "image_count": r.get("image_count") or 0,
            "cover_image_id": r.get("thumb_file_id"),
            "tier": badge,
        }

    # The homepage is meant to showcase what a buyer can actually order right
    # now - an out-of-stock style earning a high sales tier or a recent
    # add-date is still real, but doesn't belong here (it's still reachable
    # via /search with "Include Out of Stock" checked).
    def in_stock(r):
        return bool(r.get("sizes_available"))

    best_sellers = sorted(
        (to_item(r, "Best Seller") for r in rows if r["tier"] in _BEST_SELLER_TIERS and in_stock(r)),
        key=lambda it: it["style_id"],
    )[:per_section]
    trending_now = sorted(
        (to_item(r, "Trending") for r in rows if r["tier"] in _TRENDING_TIERS and in_stock(r)),
        key=lambda it: it["style_id"],
    )[:per_section]
    # `rows` is already restricted to (tier match OR in the top-N-most-recent
    # set) by the SQL above, so sorting this subset by added_at and taking
    # the top `per_section` correctly surfaces the truly most-recent styles
    # without needing a separate query.
    new_arrival_rows = sorted(
        (r for r in rows if r["added_at"] is not None and in_stock(r)),
        key=lambda r: r["added_at"],
        reverse=True,
    )
    new_arrivals = [to_item(r, "New") for r in new_arrival_rows][:per_section]

    return {
        "sections": [
            {"key": "best_sellers", **{k: v for k, v in _COLLECTIONS["best_sellers"].items() if k != "badge"}, "items": best_sellers},
            {"key": "trending_now", **{k: v for k, v in _COLLECTIONS["trending_now"].items() if k != "badge"}, "items": trending_now},
            {"key": "new_arrivals", **{k: v for k, v in _COLLECTIONS["new_arrivals"].items() if k != "badge"}, "items": new_arrivals},
        ]
    }


@app.get("/api/fabrics")
async def list_fabrics():
    """Distinct fabrics currently present in the active B2B Catalog -
    powers the sidebar's Fabric filter."""
    rows = fetch_all(
        "SELECT DISTINCT fabric FROM b2b_catalog WHERE is_active = TRUE AND fabric IS NOT NULL ORDER BY fabric ASC"
    )
    return {"fabrics": [r["fabric"] for r in rows]}


_BASE_SIZE_ORDER = ["XS", "S", "M", "L"]
# "NXL" sizes (XL, XXL, 3XL, 4XL, ... 10XL, ...) sort by their numeric
# multiplier, not alphabetically - alphabetical put "10XL" before "6XL"
# (string '1' < '6') and "XL"/"XXL" out of order entirely.
_NXL_RE = re.compile(r"^(\d*)X+L$", re.IGNORECASE)


def _nxl_multiplier(size: str) -> Optional[int]:
    m = _NXL_RE.match(size.upper())
    if not m:
        return None
    digits, xl = m.group(1), m.group(0)
    if digits:
        return int(digits)
    # No leading digit: count the X's (XL=1, XXL=2, XXXL=3, ...)
    return xl.upper().count("X")


def _size_sort_key(size: str):
    if size in _BASE_SIZE_ORDER:
        return (0, _BASE_SIZE_ORDER.index(size), "")
    nxl = _nxl_multiplier(size)
    if nxl is not None:
        return (1, nxl, "")
    if size.replace(".", "", 1).isdigit():
        return (2, float(size), "")
    return (3, 0, size)


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
        WITH {_ITEM_MASTER_CATEGORY_CTE},
        {_STYLE_TIER_CTE},
        {_SKU_PRICE_AVG_CTE}
        SELECT b.style_id, b.fabric, COALESCE(spa.avg_price, b.price) AS price, imc.category, st.tier,
               -- Per-style override (fit) wins over the shared category
               -- default (clm) - same PricingManagementSystem admin edit
               -- (pencil icon -> per-style fit) that sets this table.
               COALESCE(fit.b2b_category, clm.b2b_category) AS b2b_category,
               COALESCE(fit.length_type, clm.length_type) AS length_type,
               COALESCE(fit.top_length, clm.top_length) AS top_length,
               COALESCE(fit.bottom_length, clm.bottom_length) AS bottom_length,
               b.style_id IN (SELECT style_id FROM b2b_catalog WHERE is_active = TRUE ORDER BY added_at DESC LIMIT {_NEW_ARRIVALS_LIMIT}) AS is_new_arrival
        FROM b2b_catalog b
        LEFT JOIN im_category imc ON imc.style_id = b.style_id
        LEFT JOIN style_tier st ON st.style_id = b.style_id
        LEFT JOIN sku_price_avg spa ON spa.style_id = b.style_id
        LEFT JOIN category_length_map clm ON clm.category = imc.category
        LEFT JOIN b2b_catalog_style_fit fit ON fit.style_id = b.style_id
        WHERE b.style_id = %s AND b.is_active = TRUE
        """,
        (style_id,),
    )
    if not cat_row:
        raise HTTPException(status_code=404, detail="Style not found")

    badge = _badge_for_tier(cat_row.get("tier")) or ("New" if cat_row.get("is_new_arrival") else None)

    size_rows = fetch_all(
        f"""
        WITH {_SKU_STOCK_CTE}
        SELECT size, qty FROM sku_stock WHERE UPPER(TRIM(style_id)) = UPPER(TRIM(%s))
        """,
        (style_id,),
    )
    sizes_available = sorted(
        {r["size"] for r in size_rows if r.get("size") and (r.get("qty") or 0) - 2 > 0},
        key=_size_sort_key,
    )

    # Per-size pricing: different sizes of the same style can be priced
    # differently (set per Master SKU in PricingManagementSystem's B2B
    # Catalog admin tab). Only sizes actually in stock are worth pricing
    # here - matches sizes_available above, and a size with no per-SKU
    # price set falls back to the style's overall (averaged) price so the
    # UI never has to show a blank.
    size_price_rows = fetch_all(
        """
        SELECT im."Size" AS size, p.price
        FROM item_master im
        LEFT JOIN b2b_catalog_sku_prices p
            ON UPPER(TRIM(p.master_sku)) = UPPER(TRIM(im."Master SKU")) AND p.style_id = %s
        WHERE im."Style ID / Parent SKU" = %s
            AND im."Master SKU" IS NOT NULL AND im."Master SKU" != ''
        """,
        (style_id, style_id),
    )
    price_by_size = {r["size"]: float(r["price"]) for r in size_price_rows if r.get("size") and r.get("price") is not None}
    fallback_price = float(cat_row["price"]) if cat_row.get("price") is not None else None
    size_prices = [
        {"size": sz, "price": price_by_size.get(sz, fallback_price)}
        for sz in sizes_available
    ]
    # Sizes only need their own price shown when they actually differ from
    # each other (or from the overall price) - otherwise a flat "Price"
    # line is clearer than repeating the same number under every chip.
    has_varying_prices = len({p["price"] for p in size_prices if p["price"] is not None}) > 1

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
        "price": fallback_price,
        "sizes_available": sizes_available,
        "size_prices": size_prices if has_varying_prices else [],
        "images": images,
        "tier": badge,
        "fit": {
            "b2b_category": cat_row.get("b2b_category"),
            "length_type": cat_row.get("length_type"),
            "top_length": float(cat_row["top_length"]) if cat_row.get("top_length") is not None else None,
            "bottom_length": float(cat_row["bottom_length"]) if cat_row.get("bottom_length") is not None else None,
        },
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


# Link-preview crawlers (WhatsApp, Telegram, iMessage, Facebook, Slack...)
# never run the SPA's JavaScript, so a client-side <title>/meta update after
# fetchStyle() resolves is invisible to them - they only ever see whatever
# static HTML this server hands back for the URL. Detecting these specific
# user agents and serving a tiny real HTML page with the actual product
# photo/price baked into <meta property="og:*"> tags is the only way a
# shared product link renders with an image preview instead of a bare link.
_LINK_PREVIEW_BOT_RE = re.compile(
    r"whatsapp|facebookexternalhit|telegrambot|slackbot|twitterbot|linkedinbot|"
    r"discordbot|skypeuripreview|pinterest|vkshare|redditbot|line-poker",
    re.IGNORECASE,
)


def _og_preview_html(request: Request, style_id: str, category: str, price_text: str, image_id: Optional[str]) -> str:
    base = str(request.base_url).rstrip("/")
    page_url = f"{base}/search?style={style_id}"
    image_url = f"{base}/api/image-proxy?id={image_id}&sz=w1200" if image_id else f"{base}/hero-banner.jpg"
    title = f"{style_id} - Rajnandini Fashion"
    description = f"{category} · {price_text}"

    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{esc(title)}</title>
<meta property="og:type" content="product">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:image" content="{esc(image_url)}">
<meta property="og:url" content="{esc(page_url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(image_url)}">
</head>
<body></body>
</html>"""


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_catchall(request: Request, full_path: str):
    if full_path.startswith("api/"):
        return HTMLResponse(content='{"detail":"Not Found"}', status_code=404, media_type="application/json")

    style_id = request.query_params.get("style")
    if full_path == "search" and style_id and _LINK_PREVIEW_BOT_RE.search(request.headers.get("user-agent", "")):
        row = fetch_one(
            f"""
            WITH {_ITEM_MASTER_CATEGORY_CTE},
            {_SKU_PRICE_AVG_CTE}
            SELECT b.style_id, imc.category, COALESCE(spa.avg_price, b.price) AS price,
                   (
                       SELECT ic.drive_file_id FROM b2b_catalog_images bci
                       JOIN image_collection ic ON ic.id = bci.image_id
                       WHERE bci.style_id = b.style_id
                       ORDER BY bci.position, bci.id LIMIT 1
                   ) AS thumb_file_id
            FROM b2b_catalog b
            LEFT JOIN im_category imc ON imc.style_id = b.style_id
            LEFT JOIN sku_price_avg spa ON spa.style_id = b.style_id
            WHERE b.style_id = %s AND b.is_active = TRUE
            """,
            (style_id,),
        )
        if row:
            price_text = f"₹{row['price']:,.0f}" if row.get("price") is not None else "Price on request"
            html = _og_preview_html(request, row["style_id"], row.get("category") or "", price_text, row.get("thumb_file_id"))
            return HTMLResponse(content=html)

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


if __name__ == "__main__":
    # Lets this file be run directly (e.g. VS Code's "Run Python File in
    # Dedicated Terminal") instead of only via `uvicorn main:app`.
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8010, reload=True)
