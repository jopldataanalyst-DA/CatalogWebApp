# Rajnandini B2B Catalog

Public, unauthenticated gallery of B2B styles. Reads live from the same
self-hosted Supabase Postgres database `PricingManagementSystem` uses -
specifically the `b2b_catalog` table (curated via that app's "B2B Catalog"
sub-tab on the Image Collection page), joined against `item_master` /
`stock_items` / `image_collection`. No caching, no sync job: an edit made in
the admin tab is visible here on the very next page load.

- `backend/` - FastAPI, serves both the JSON API (`/api/*`) and the built
  frontend (single container in production).
- `frontend/` - Vite + React + TypeScript + Tailwind v4.

## Local development

Two options:

**A. Frontend dev server + backend, separately** (hot reload):

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate  # or source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DB_* (see below)
uvicorn main:app --reload --port 8010
```

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to :8010
```

**B. Single combined server** (matches production):

```bash
cd frontend && npm run build   # builds into ../backend/static
cd ../backend && uvicorn main:app --port 8010
# open http://localhost:8010
```

### Database access for local dev

The Postgres database isn't reachable directly from a machine off the
VPS's own network - set `USE_SSH_TUNNEL=true` in `backend/.env` (see
`.env.example`) with `SSH_HOST`/`SSH_USER`/`SSH_PASSWORD` for the VPS. This
opens an SSH tunnel to the VPS and forwards to `172.16.2.4:5432` - Postgres's
address on the VPS's own internal Docker network (same as
`PricingManagementSystem/PricingSystem/App/Core/Tunnel.py` uses).

## Deploying (Dokploy, Nixpacks)

This repo has a `nixpacks.toml` at the root (installs Python + Node deps,
builds the frontend into `backend/static`, then runs uvicorn) - same build
type PricingManagementSystem itself uses, for the same reason noted in that
app's deploy notes (Dokploy's Dockerfile build type has had `.env`-path
issues on this VPS's Dokploy version).

1. New Application in Dokploy, connect this GitHub repo
   (`jopldataanalyst-DA/CatalogWebApp`), branch `main`.
2. Build type: **Nixpacks** (auto-detected from `nixpacks.toml`).
3. Port: container `8010` → whatever host port you want to expose.
4. Environment variables:
   ```
   DB_HOST=supabase-db
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=<same as PricingManagementSystem's DB_PASSWORD>
   DB_NAME=postgres
   USE_SSH_TUNNEL=false
   ```
   (`USE_SSH_TUNNEL=false`/unset is correct here - Dokploy containers sit on
   the VPS's own network already, no tunnel needed. **`DB_HOST=supabase-db`
   is correct, not `172.16.1.1` (PricingManagementSystem's own host-gateway
   address, only reachable on its network - CatalogWebApp's Dokploy app
   lands on `dokploy-network`, the same Docker network `supabase-db` is
   also directly attached to, so its container DNS name resolves and its
   real Postgres port 5432 is reachable directly - confirmed live via
   `docker exec ... python -c "socket.create_connection(('supabase-db',
   5432))"`.** If a future Dokploy app ever lands on some OTHER network
   that isn't `dokploy-network`, check `docker inspect supabase-db` for
   which networks it's actually attached to before assuming either address
   works.)
5. Point a domain/subdomain at it (e.g. `catalog.rajnandinifashion.com`) in
   Dokploy's Domains tab.
6. Deploy. `GET /api/categories` should return `200` once it's up.

No Google Drive credentials are needed here - the image proxy builds public
`drive.google.com` thumbnail URLs directly from the `drive_file_id` already
stored in `image_collection` (those files are shared "anyone with the link
can view" by PricingManagementSystem's own upload flow).
