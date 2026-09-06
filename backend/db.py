"""Read-only Postgres access for the Catalog webapp.

Use case:
    Connects to the exact same self-hosted Supabase Postgres database that
    PricingManagementSystem uses (DB_HOST/PORT/USER/PASSWORD/NAME in .env).
    This app only ever SELECTs - the B2B Catalog admin tab inside
    PricingManagementSystem is the only writer to b2b_catalog, so any edit
    made there is visible here on the very next request, with no sync step.
"""

import os
from contextlib import contextmanager

import psycopg2
import psycopg2.pool
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

_POOL: psycopg2.pool.ThreadedConnectionPool | None = None
_TUNNEL = None  # kept alive for the process lifetime when USE_SSH_TUNNEL=true


def _resolve_db_host_port() -> tuple[str, int]:
    """Deployed on the same Dokploy/VPS network as PricingManagementSystem,
    the DB is reached directly (DB_HOST/DB_PORT as-is, e.g. the host
    gateway on port 5433). For local development off that network, the raw
    VPS Postgres port isn't reachable directly - set USE_SSH_TUNNEL=true
    (with SSH_HOST/SSH_USER/SSH_PASSWORD in .env) to open the same kind of
    SSH tunnel PricingManagementSystem's backend uses for local dev."""
    if os.environ.get("USE_SSH_TUNNEL", "").lower() != "true":
        return os.environ.get("DB_HOST", "localhost"), int(os.environ.get("DB_PORT", "5432"))

    global _TUNNEL
    if _TUNNEL is None:
        from sshtunnel import SSHTunnelForwarder

        _TUNNEL = SSHTunnelForwarder(
            (os.environ["SSH_HOST"], int(os.environ.get("SSH_PORT", "22"))),
            ssh_username=os.environ["SSH_USER"],
            ssh_password=os.environ["SSH_PASSWORD"],
            remote_bind_address=(os.environ.get("DB_HOST", "localhost"), int(os.environ.get("DB_PORT", "5432"))),
        )
        _TUNNEL.start()
    return "127.0.0.1", _TUNNEL.local_bind_port


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _POOL
    if _POOL is None:
        host, port = _resolve_db_host_port()
        _POOL = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            host=host,
            port=port,
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", ""),
            dbname=os.environ.get("DB_NAME", "postgres"),
        )
    return _POOL


@contextmanager
def get_cursor():
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def fetch_all(query: str, params: tuple = ()) -> list[dict]:
    with get_cursor() as cur:
        cur.execute(query, params)
        return [dict(r) for r in cur.fetchall()]


def fetch_one(query: str, params: tuple = ()) -> dict | None:
    with get_cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
        return dict(row) if row else None
