"""Stockage SQLite de la passerelle (décision T-003, docs/plan-p1.md § 5 et § 6).

- Un fichier par machine dans GATEWAY_DATA_DIR (`data/terminal.sqlite3`,
  dossier ignoré par git), en mode WAL : lectures pendant les écritures.
- Un seul fil d'exécution pour toutes les opérations : jamais deux écritures
  concurrentes, et la boucle asyncio n'attend jamais le disque.
- Migrations numérotées, appliquées dans l'ordre au démarrage ; le numéro
  atteint est gardé dans `PRAGMA user_version`. Une migration ne se modifie
  plus une fois livrée : on en ajoute une nouvelle.
- Heures en millisecondes UTC (entiers), valeurs publiées en texte décimal :
  jamais de flottant pour un chiffre officiel.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")

# Chaque migration : liste d'instructions SQL. Ne jamais modifier une migration livrée.
MIGRATIONS: list[list[str]] = [
    # 1 — agenda (E2) : indicateurs suivis, relevés ForexFactory, versions des événements.
    [
        """create table indicators (
             id text primary key,                 -- « us-cpi-mm »
             label_fr text not null,
             currency text not null,
             official_series text,                -- « CUSR0000SA0 »
             unit text,
             decimals integer,
             ff_series text unique,               -- série ForexFactory (« 78-us-cpi-mm »)
             capture integer not null default 0   -- 1 : capté à la source en Mode Local
           )""",
        """create table calendar_snapshots (
             id integer primary key,
             source text not null,                -- « ForexFactory »
             url text not null,
             status integer not null,
             source_ts_ms integer,                -- Last-Modified
             received_ms integer not null,
             etag text,
             sha256 text,
             body blob                            -- contenu brut (null sur 304)
           )""",
        "create index calendar_snapshots_received on calendar_snapshots (received_ms)",
        """create table calendar_events (
             id integer primary key,
             identity text not null,              -- série|devise|jour New York|rang
             indicator_id text references indicators (id),
             title text not null,
             currency text not null,
             ff_time_ms integer,                  -- heure ForexFactory (indicative)
             ff_time_kind text,                   -- « exacte », « tentative », « all day »…
             official_time_ms integer,            -- heure officielle (UTC)
             official_local text,                 -- heure locale officielle « 08:30 »
             official_tz text,                    -- zone IANA « America/New_York »
             impact text,
             forecast_raw text,
             forecast text,                       -- texte décimal
             previous_raw text,
             status text not null default 'prévu',
             first_seen_ms integer not null,
             last_seen_ms integer not null,
             snapshot_id integer references calendar_snapshots (id),
             unique (identity, forecast_raw, previous_raw, ff_time_ms, status)
           )""",
        "create index calendar_events_identity on calendar_events (identity, last_seen_ms)",
        "create index calendar_events_time on calendar_events (ff_time_ms)",
    ],
    # 2 — calendrier officiel (E2) : une ligne par publication et par date annoncée ;
    # une date qui change crée une nouvelle ligne (l'ancienne garde son dernier relevé).
    [
        """create table official_releases (
             id integer primary key,
             source text not null,                -- « BLS »
             title text not null,                 -- « Consumer Price Index »
             local_date text not null,
             local_time text not null,
             tz text not null,                    -- zone IANA
             utc_ms integer not null,
             first_seen_ms integer not null,
             last_seen_ms integer not null,
             unique (source, title, local_date, local_time)
           )""",
        "create index official_releases_time on official_releases (utc_ms)",
    ],
]


class Storage:
    """Base SQLite avec un fil unique ; API asynchrone."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sqlite")
        self._conn: sqlite3.Connection | None = None

    # --- cycle de vie ------------------------------------------------------------

    async def open(self) -> int:
        """Ouvre la base, active WAL, applique les migrations ; renvoie la version atteinte."""
        return await self._run(self._open)

    def _open(self) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma journal_mode = wal")
        conn.execute("pragma synchronous = normal")
        conn.execute("pragma foreign_keys = on")
        conn.execute("pragma busy_timeout = 5000")
        self._conn = conn
        return self._migrate(conn)

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> int:
        version = conn.execute("pragma user_version").fetchone()[0]
        if version > len(MIGRATIONS):
            raise RuntimeError(f"base en version {version}, code en version {len(MIGRATIONS)} : "
                               "base créée par un code plus récent")
        for number in range(version + 1, len(MIGRATIONS) + 1):
            conn.execute("begin")
            try:
                for sql in MIGRATIONS[number - 1]:
                    conn.execute(sql)
                conn.execute(f"pragma user_version = {number}")
                conn.execute("commit")
            except Exception:
                conn.execute("rollback")
                raise
            log.info("base %s : migration %d appliquée", "SQLite", number)
        return len(MIGRATIONS)

    async def close(self) -> None:
        if self._conn is not None:
            await self._run(self._conn.close)
            self._conn = None
        self._pool.shutdown(wait=True)

    # --- opérations ---------------------------------------------------------------

    async def _run(self, fn: Callable[..., T], *args: Any) -> T:
        return await asyncio.get_running_loop().run_in_executor(self._pool, fn, *args)

    def _c(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("base non ouverte")
        return self._conn

    async def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        """Écriture ; renvoie l'identifiant de la dernière ligne insérée (ou 0)."""
        def run() -> int:
            cur = self._c().execute(sql, params)
            return cur.lastrowid or 0
        return await self._run(run)

    async def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> int:
        """Écritures en une transaction ; renvoie le nombre de lignes modifiées."""
        rows = list(rows)

        def run() -> int:
            c = self._c()
            c.execute("begin")
            try:
                cur = c.executemany(sql, rows)
                c.execute("commit")
                return cur.rowcount
            except Exception:
                c.execute("rollback")
                raise
        return await self._run(run)

    async def transaction(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        """Exécute `fn(conn)` dans une transaction, sur le fil de la base."""
        def run() -> T:
            c = self._c()
            c.execute("begin")
            try:
                out = fn(c)
                c.execute("commit")
                return out
            except Exception:
                c.execute("rollback")
                raise
        return await self._run(run)

    async def query(self, sql: str, params: Sequence[Any] = ()) -> list[dict]:
        def run() -> list[dict]:
            return [dict(r) for r in self._c().execute(sql, params).fetchall()]
        return await self._run(run)

    async def version(self) -> int:
        return await self._run(lambda: self._c().execute("pragma user_version").fetchone()[0])
