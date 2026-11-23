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
    # 3 — capture à l'heure H (E3) : première publication de chaque chiffre (jamais
    # écrasée : `unique` + insertion sans remplacement), délais mesurés, journal des
    # requêtes envoyées au BLS.
    [
        """create table releases (
             id integer primary key,
             indicator_id text not null references indicators (id),
             release text not null,               -- « cpi », « empsit », « ppi », « prod2 »
             period text not null,                -- « 2026-11 », « 2026-Q3 »
             edition text not null default '',    -- « Preliminary », « Revised » (productivité)
             ny_date text not null,               -- jour de publication à New York
             value text,                          -- texte décimal tel que publié ; null si non lu
             reason text,                         -- raison quand value est null
             part text,                           -- « tableau A », « texte »
             excerpt text,                        -- passage lu (citation de la source)
             flags text not null default '[]',    -- JSON : « texte concordant », « hors bornes »…
             timing text not null,                -- « attendue », « en avance », « en retard »
             nature text not null default 'officielle',
             scheduled_ms integer not null,
             embargo_ms integer,
             first_byte_ms integer,               -- premier octet de la page avec le chiffre
             received_ms integer not null,        -- fin de lecture
             url text not null,
             machine text not null,
             forecast text,                       -- prévision retenue (texte décimal)
             forecast_raw text,
             forecast_seen_ms integer,            -- dernière fois vue avant T
             surprise text,                       -- réel - prévision (texte décimal)
             z text,
             z_n integer,
             z_reason text,
             regular integer not null default 1,  -- 0 : publication irrégulière, exclue de sigma
             unique (indicator_id, period, edition)
           )""",
        "create index releases_indicator on releases (indicator_id, scheduled_ms)",
        """create table release_timings (
             id integer primary key,
             release text not null,
             period text not null,
             edition text not null default '',
             scheduled_ms integer not null,
             last_without_ms integer,             -- envoi de la dernière requête sans le chiffre
             first_send_ms integer,               -- envoi de la requête qui l'a rapporté
             first_byte_ms integer,
             parsed_ms integer,
             bus_ms integer,
             display_ms integer,                  -- heure d'affichage renvoyée par le front
             okx_offset_ms real,                  -- horloge OKX - horloge locale
             date_header text,                    -- en-tête Date de la réponse du BLS
             unique (release, period, edition)
           )""",
        """create table release_polls (
             id integer primary key,
             release text not null,
             scheduled_ms integer not null,
             label text not null,                 -- « T-10min », « T-60s », « rafale », « fin »
             url text not null,
             send_ms integer not null,
             first_byte_ms integer,
             done_ms integer,
             status integer,
             size integer,
             null_bytes integer,
             period text,
             embargo_date text,
             verdict text,                        -- « référence », « inchangée », « attendue »…
             error text
           )""",
        "create index release_polls_sched on release_polls (release, scheduled_ms)",
    ],
    # 4 — suites de la capture (E3) : révisions lues par l'API v1 (une ligne par valeur
    # nouvelle, la première publication reste intacte) et réaction du BTC de T-5 à T+30 min.
    [
        """create table release_revisions (
             id integer primary key,
             indicator_id text not null references indicators (id),
             period text not null,
             edition text not null default '',    -- édition de la publication révisée
             kind text not null,                  -- « révision », ou « écart » le jour même
             previous text not null,              -- dernière valeur connue (texte décimal)
             value text not null,                 -- nouvelle valeur
             source text not null,                -- « BLS API v1 »
             series text,                         -- « CUSR0000SA0 »
             excerpt text,                        -- niveaux utilisés, calcul
             seen_ms integer not null,            -- vue pour la première fois
             poll_id integer references release_polls (id)
           )""",
        "create index release_revisions_ind on release_revisions (indicator_id, period, seen_ms)",
        """create table release_reactions (
             id integer primary key,
             release text not null,               -- « cpi »
             ny_date text not null,
             scheduled_ms integer not null,
             inst text not null,                  -- « BTC-USDT-SWAP »
             source text not null,                -- « OKX EEA REST »
             candles text not null,               -- JSON : bougies 1 min de T-5 à T+30 min
             ref_price text,
             end_price text,
             change_pct text,
             missing text not null default '[]',  -- JSON : minutes absentes
             reason text,
             received_ms integer not null,
             unique (release, ny_date)
           )""",
    ],
    # 5 — alertes (E4, plan P1 § 11) : règles et déclenchements. Deux règles par défaut,
    # armées : publication d'un chiffre capté, et T-5 min avant une publication captée.
    [
        """create table alert_rules (
             id integer primary key,
             kind text not null,                  -- price, funding, event_soon, release,
                                                  -- surprise, keyword
             params text not null,                -- JSON validé par alert_rules.validate
             channels text not null,              -- JSON : ["écran", "telegram", "voix"]
             state text not null default 'armée', -- armée, déclenchée, désactivée
             created_ms integer not null,
             updated_ms integer not null,
             last_fired_ms integer
           )""",
        """create table alert_events (
             id text primary key,                 -- identifiant court, publié sur le bus
             rule_id integer not null references alert_rules (id) on delete cascade,
             dedupe text not null,                -- un déclenchement par règle et par objet
             fired_ms integer not null,
             title text not null,
             body text,
             source text,                         -- « OKX EEA · trade », « BLS »…
             source_ms integer,                   -- heure de la donnée qui a déclenché
             data text not null default '{}',     -- JSON
             telegram text,                       -- null : non demandé ; envoyé, échec, en attente
             telegram_ms integer,
             telegram_error text,
             acked_ms integer,
             unique (rule_id, dedupe)
           )""",
        "create index alert_events_fired on alert_events (fired_ms)",
        """insert into alert_rules (kind, params, channels, created_ms, updated_ms) values
             ('release', '{"releases": []}', '["écran", "telegram", "voix"]', 0, 0),
             ('event_soon',
              '{"minutes": 5, "captured_only": true, "impacts": [], "currencies": []}',
              '["écran", "telegram"]', 0, 0)""",
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
