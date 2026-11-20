"""Service « calendar » (étape E2) : agenda ForexFactory et calendrier officiel du BLS.

- ForexFactory : une requête conditionnelle (ETag, Last-Modified) par heure,
  vers hh:45 (fichier régénéré vers hh:42, § 3) ; au démarrage, si le dernier
  relevé date de plus de 50 min. Archive privée (T-018) : chaque relevé dans
  `calendar_snapshots`, chaque version d'un événement dans `calendar_events`.
- BLS : `bls.ics` une fois par jour, avec l'adresse de contact dédiée dans le
  User-Agent (T-023) ; sans adresse, le flux reste arrêté avec sa raison.
- Bus : `calendar:week:<AAAA-Wnn>` (semaine en cours), `calendar:next` (cinq
  prochains événements Fort ou Moyen), `calendar:official` (prochaines
  publications officielles et dates déplacées), `feed:calendar`, `feed:bls-calendar`.
- Échec : nouvel essai avec délai croissant (5, 10, 20… 60 min), journalisé.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections.abc import Awaitable, Callable
from email.utils import parsedate_to_datetime

from .bus import Bus
from .calendar_data import (
    INDICATORS,
    FfEvent,
    OfficialRelease,
    attach_official,
    event_dict,
    parse_bls_ics,
    parse_ff_xml,
    parse_value,
    week_bounds,
    week_id,
)
from .config import Settings
from .storage import Storage

log = logging.getLogger(__name__)

FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml"
BLS_ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics"
FF_MINUTE = 45
FF_MAX_AGE_MS = 50 * 60_000
BLS_MAX_AGE_MS = 20 * 3_600_000
RETRY_MIN_S, RETRY_MAX_S = 300, 3600
NEXT_COUNT = 5
NEXT_REFRESH_S = 30
TRACKED_RELEASES = sorted({i.bls_release for i in INDICATORS if i.bls_release})

# Fraîcheur annoncée au front (feed:<source>) : un agenda horaire n'est pas un flux temps réel.
FF_FEED = {
    "name": "calendar",
    "label": "Agenda",
    "late_after_ms": 75 * 60_000,
    "stale_after_ms": 3 * 3_600_000,
}
BLS_FEED = {
    "name": "bls-calendar",
    "label": "Calendrier BLS",
    "late_after_ms": 26 * 3_600_000,
    "stale_after_ms": 50 * 3_600_000,
}

HttpGet = Callable[[str, dict], Awaitable[tuple[int, dict, bytes]]]


def now_ms() -> int:
    return time.time_ns() // 1_000_000


async def httpx_get(url: str, headers: dict) -> tuple[int, dict, bytes]:
    import httpx

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        r = await client.get(url, headers=headers)
        return r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content


def http_ms(value: str | None) -> int | None:
    try:
        return int(parsedate_to_datetime(value).timestamp() * 1000) if value else None
    except (TypeError, ValueError):
        return None


class Feed:
    """État d'une source, au format de feed:<nom> (FeedState du front)."""

    def __init__(self, base: dict) -> None:
        self.base = base
        self.status = "connecting"
        self.connected_since_ms: int | None = None
        self.last_message_ms: int | None = None
        self.reconnects = 0
        self.last_error: str | None = None

    def ok(self, t: int) -> None:
        if self.status != "connected":
            self.connected_since_ms = t
        self.status, self.last_message_ms, self.last_error = "connected", t, None

    def fail(self, why: str) -> None:
        self.status, self.last_error = "reconnecting", why
        self.reconnects += 1

    def stop(self, why: str) -> None:
        self.status, self.last_error = "stopped", why

    def snapshot(self) -> dict:
        return {
            **self.base,
            "status": self.status,
            "connected_since_ms": self.connected_since_ms,
            "last_message_ms": self.last_message_ms,
            "reconnects": self.reconnects,
            "outages": [],
            "last_error": self.last_error,
        }


class CalendarService:
    name = "calendar"
    needs_storage = True

    def __init__(
        self,
        bus: Bus,
        storage: Storage,
        settings: Settings,
        http_get: HttpGet = httpx_get,
        clock: Callable[[], int] = now_ms,
    ) -> None:
        self.bus, self.db, self.settings, self.http_get, self.clock = (
            bus,
            storage,
            settings,
            http_get,
            clock,
        )
        self.ff_feed, self.bls_feed = Feed(FF_FEED), Feed(BLS_FEED)
        self.events: list[FfEvent] = []
        self.ff_meta: dict = {}
        self.official: list[OfficialRelease] = []
        self.official_meta: dict = {}
        self.moved: list[dict] = []
        self._tasks: list[asyncio.Task] = []
        self.bus.set_retention("calendar:week:", 3)

    # --- cycle de vie --------------------------------------------------------------

    async def start(self) -> None:
        await self._seed_indicators()
        await self._load_last()
        self._publish_all()
        self._tasks = [
            asyncio.create_task(self._ff_loop(), name="calendar-ff"),
            asyncio.create_task(self._bls_loop(), name="calendar-bls"),
            asyncio.create_task(self._next_loop(), name="calendar-next"),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks = []

    def health(self) -> dict:
        return {
            "forexfactory": self.ff_feed.snapshot(),
            "bls": self.bls_feed.snapshot(),
            "events": len(self.events),
            "week": self.current_week(),
            "official_moved": len(self.moved),
        }

    # --- relevés -------------------------------------------------------------------

    async def fetch_ff(self) -> None:
        headers = {"User-Agent": "terminal-trading/0.1", "Accept": "application/xml"}
        if self.ff_meta.get("etag"):
            headers["If-None-Match"] = self.ff_meta["etag"]
        if self.ff_meta.get("last_modified"):
            headers["If-Modified-Since"] = self.ff_meta["last_modified"]
        received = self.clock()
        status, h, body = await self.http_get(FF_URL, headers)
        sha = hashlib.sha256(body).hexdigest() if status == 200 else None
        snap_id = await self.db.execute(
            "insert into calendar_snapshots (source, url, status, source_ts_ms, received_ms, etag,"
            " sha256, body)"
            " values ('ForexFactory', ?, ?, ?, ?, ?, ?, ?)",
            (
                FF_URL,
                status,
                http_ms(h.get("last-modified")),
                received,
                h.get("etag"),
                sha,
                body if status == 200 else None,
            ),
        )
        if status == 304:
            self.ff_meta["received_ms"] = received
        elif status == 200:
            events = parse_ff_xml(body)
            self.events = events
            self.ff_meta = {
                "etag": h.get("etag"),
                "last_modified": h.get("last-modified"),
                "source_ts_ms": http_ms(h.get("last-modified")),
                "received_ms": received,
            }
            await self._store_events(events, received, snap_id)
        else:
            raise RuntimeError(f"ForexFactory : HTTP {status}")
        self.ff_feed.ok(received)
        self._publish_all()

    async def fetch_bls(self) -> None:
        email = self.settings.bls_contact_email
        if not email:
            self.bls_feed.stop("BLS_CONTACT_EMAIL absente : heure officielle indisponible")
            self._publish_feeds()
            return
        headers = {"User-Agent": f"terminal-trading/0.1 ({email})", "Accept": "text/calendar"}
        if self.official_meta.get("etag"):
            headers["If-None-Match"] = self.official_meta["etag"]
        received = self.clock()
        status, h, body = await self.http_get(BLS_ICS_URL, headers)
        await self.db.execute(
            "insert into calendar_snapshots (source, url, status, source_ts_ms, received_ms, etag,"
            " sha256, body)"
            " values ('BLS', ?, ?, ?, ?, ?, ?, ?)",
            (
                BLS_ICS_URL,
                status,
                http_ms(h.get("last-modified")),
                received,
                h.get("etag"),
                hashlib.sha256(body).hexdigest() if status == 200 else None,
                body if status == 200 else None,
            ),
        )
        if status == 200:
            releases, problems = parse_bls_ics(body.decode("utf-8", "replace"))
            for p in problems:
                log.warning("calendrier BLS : %s", p)
            self.official = releases
            self.official_meta = {
                "etag": h.get("etag"),
                "source_ts_ms": http_ms(h.get("last-modified")),
                "received_ms": received,
            }
            await self._store_official(releases, received)
        elif status == 304:
            self.official_meta["received_ms"] = received
        else:
            why = " (contact refusé ou débit dépassé)" if status == 403 else ""
            raise RuntimeError(f"BLS : HTTP {status}{why}")
        self.bls_feed.ok(received)
        self._publish_all()

    async def _ff_loop(self) -> None:
        delay = RETRY_MIN_S
        last = self.ff_meta.get("received_ms")
        wait = (
            0
            if last is None or self.clock() - last > FF_MAX_AGE_MS
            else _seconds_to_minute(self.clock(), FF_MINUTE)
        )
        while True:
            await asyncio.sleep(wait)
            try:
                await self.fetch_ff()
                delay = RETRY_MIN_S
                wait = _seconds_to_minute(self.clock(), FF_MINUTE)
            except Exception as exc:
                log.warning("agenda ForexFactory indisponible : %s", exc)
                self.ff_feed.fail(str(exc)[:200])
                self._publish_feeds()
                wait, delay = delay, min(delay * 2, RETRY_MAX_S)

    async def _bls_loop(self) -> None:
        delay = RETRY_MIN_S
        last = self.official_meta.get("received_ms")
        wait = 0 if last is None or self.clock() - last > BLS_MAX_AGE_MS else 3600
        while True:
            await asyncio.sleep(wait)
            try:
                await self.fetch_bls()
                delay = RETRY_MIN_S
                wait = 24 * 3600
            except Exception as exc:
                log.warning("calendrier BLS indisponible : %s", exc)
                self.bls_feed.fail(str(exc)[:200])
                self._publish_feeds()
                wait, delay = delay, min(delay * 2, RETRY_MAX_S)

    async def _next_loop(self) -> None:
        while True:
            await asyncio.sleep(NEXT_REFRESH_S)
            self.bus.publish("calendar:next", self.next_events())
            self._publish_feeds()

    # --- base ----------------------------------------------------------------------

    async def _seed_indicators(self) -> None:
        await self.db.executemany(
            "insert into indicators (id, label_fr, currency, official_series, unit, capture)"
            " values (?, ?, ?, ?, ?, ?)"
            " on conflict (id) do update set label_fr = excluded.label_fr, official_series ="
            " excluded.official_series,"
            " unit = excluded.unit, capture = excluded.capture",
            [
                (i.id, i.label_fr, i.currency, i.official_series, i.unit, int(i.capture))
                for i in INDICATORS
            ],
        )

    async def _load_last(self) -> None:
        """Dernier relevé archivé : l'agenda s'affiche dès le démarrage, sans attendre le réseau."""
        rows = await self.db.query(
            "select body, etag, source_ts_ms, received_ms from calendar_snapshots"
            " where source = 'ForexFactory' and status = 200 order by id desc limit 1"
        )
        if rows:
            r = rows[0]
            self.events = parse_ff_xml(r["body"])
            last_ok = await self.db.query(
                "select max(received_ms) as t from calendar_snapshots where source ="
                " 'ForexFactory' and status in (200, 304)"
            )
            self.ff_meta = {
                "etag": r["etag"],
                "source_ts_ms": r["source_ts_ms"],
                "received_ms": last_ok[0]["t"] or r["received_ms"],
            }
            self.ff_feed.ok(self.ff_meta["received_ms"])
        rows = await self.db.query(
            "select body, etag, source_ts_ms, received_ms from calendar_snapshots"
            " where source = 'BLS' and status = 200 order by id desc limit 1"
        )
        if rows:
            self.official, _ = parse_bls_ics(rows[0]["body"].decode("utf-8", "replace"))
            self.official_meta = {
                "etag": rows[0]["etag"],
                "source_ts_ms": rows[0]["source_ts_ms"],
                "received_ms": rows[0]["received_ms"],
            }
            self.bls_feed.ok(rows[0]["received_ms"])

    async def _store_events(self, events: list[FfEvent], received: int, snap_id: int) -> None:
        official = attach_official(events, self.official)

        def write(conn) -> None:
            for ev in events:
                o = official.get(ev.identity)
                forecast, _ = parse_value(ev.forecast_raw)
                kind = "exacte" if ev.time_ms is not None else ev.time_raw
                row = conn.execute(
                    "select id from calendar_events where identity = ? and forecast_raw is ? and"
                    " previous_raw is ?"
                    " and ff_time_ms is ? and status = 'prévu' order by id desc limit 1",
                    (ev.identity, ev.forecast_raw, ev.previous_raw, ev.time_ms),
                ).fetchone()
                if row:
                    conn.execute(
                        "update calendar_events set last_seen_ms = ?, snapshot_id = ?,"
                        " official_time_ms = ?, official_local = ?, official_tz = ? where id = ?",
                        (
                            received,
                            snap_id,
                            o.utc_ms if o else None,
                            o.local_time if o else None,
                            o.tz if o else None,
                            row[0],
                        ),
                    )
                else:
                    conn.execute(
                        "insert into calendar_events (identity, indicator_id, title, currency,"
                        " ff_time_ms, ff_time_kind,"
                        " official_time_ms, official_local, official_tz, impact, forecast_raw,"
                        " forecast, previous_raw,"
                        " status, first_seen_ms, last_seen_ms, snapshot_id)"
                        " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prévu', ?, ?, ?)",
                        (
                            ev.identity,
                            ev.indicator.id if ev.indicator else None,
                            ev.title,
                            ev.currency,
                            ev.time_ms,
                            kind,
                            o.utc_ms if o else None,
                            o.local_time if o else None,
                            o.tz if o else None,
                            ev.impact,
                            ev.forecast_raw,
                            forecast,
                            ev.previous_raw,
                            received,
                            received,
                            snap_id,
                        ),
                    )

        await self.db.transaction(write)

    async def _store_official(self, releases: list[OfficialRelease], received: int) -> None:
        def write(conn) -> list[dict]:
            for r in releases:
                cur = conn.execute(
                    "update official_releases set last_seen_ms = ?, utc_ms = ?, tz = ?"
                    " where source = 'BLS' and title = ? and local_date = ? and local_time = ?",
                    (received, r.utc_ms, r.tz, r.title, r.local_date, r.local_time),
                )
                if cur.rowcount == 0:
                    conn.execute(
                        "insert into official_releases (source, title, local_date, local_time, tz,"
                        " utc_ms,"
                        " first_seen_ms, last_seen_ms) values ('BLS', ?, ?, ?, ?, ?, ?, ?)",
                        (r.title, r.local_date, r.local_time, r.tz, r.utc_ms, received, received),
                    )
            # Publication à venir annoncée avant, absente du calendrier du jour :
            # date déplacée ou annulée.
            rows = conn.execute(
                "select title, local_date, local_time, tz, utc_ms, last_seen_ms from"
                " official_releases"
                " where source = 'BLS' and last_seen_ms < ? and utc_ms > ?",
                (received, received),
            ).fetchall()
            return [dict(x) for x in rows]

        moved = await self.db.transaction(write)
        self.moved = [m for m in moved if m["title"] in TRACKED_RELEASES]
        for m in self.moved:
            log.warning(
                "calendrier BLS : %s du %s %s n'est plus annoncé",
                m["title"],
                m["local_date"],
                m["local_time"],
            )

    # --- publication ---------------------------------------------------------------

    def current_week(self) -> str | None:
        return week_id(self.events[0].ny_date) if self.events else None

    def week_payload(self) -> dict | None:
        week = self.current_week()
        if week is None:
            return None
        official = attach_official(self.events, self.official)
        events = sorted(
            (event_dict(e, official.get(e.identity)) for e in self.events),
            key=lambda d: (d["ny_date"], d["time_ms"] if d["time_ms"] is not None else -1),
        )
        start, end = week_bounds(week)
        return {
            "week": week,
            "from": start,
            "to": end,
            "events": events,
            "archive": False,
            "forexfactory": {
                "source_ts_ms": self.ff_meta.get("source_ts_ms"),
                "received_ms": self.ff_meta.get("received_ms"),
            },
            "bls": {
                "source_ts_ms": self.official_meta.get("source_ts_ms"),
                "received_ms": self.official_meta.get("received_ms"),
            }
            if self.official
            else None,
        }

    def next_events(self) -> dict:
        now = self.clock()
        payload = self.week_payload()
        events = [
            e
            for e in (payload["events"] if payload else [])
            if e["impact"] in ("High", "Medium") and e["time_ms"] is not None and e["time_ms"] > now
        ]
        events.sort(key=lambda e: e["time_ms"])
        return {
            "events": events[:NEXT_COUNT],
            "computed_ms": now,
            "week": payload["week"] if payload else None,
            "forexfactory": payload["forexfactory"] if payload else None,
        }

    def official_payload(self) -> dict:
        now = self.clock()
        upcoming = [r for r in self.official if r.title in TRACKED_RELEASES and r.utc_ms > now]
        upcoming.sort(key=lambda r: r.utc_ms)
        return {
            "releases": [r.__dict__ for r in upcoming[:12]],
            "moved": self.moved,
            "source_ts_ms": self.official_meta.get("source_ts_ms"),
            "received_ms": self.official_meta.get("received_ms"),
        }

    def _publish_feeds(self) -> None:
        self.bus.publish("feed:calendar", self.ff_feed.snapshot())
        self.bus.publish("feed:bls-calendar", self.bls_feed.snapshot())

    def _publish_all(self) -> None:
        payload = self.week_payload()
        if payload:
            self.bus.publish(f"calendar:week:{payload['week']}", payload)
        self.bus.publish("calendar:next", self.next_events())
        self.bus.publish("calendar:official", self.official_payload())
        self._publish_feeds()

    # --- archive (REST) ------------------------------------------------------------

    async def week(self, week: str) -> dict:
        """Semaine demandée : en cours depuis le dernier relevé, les autres depuis l'archive."""
        start, end = week_bounds(week)
        current = self.week_payload()
        if current and current["week"] == week:
            return current
        rows = await self.db.query(
            "select e.*, i.label_fr from calendar_events e left join indicators i on i.id ="
            " e.indicator_id"
            " where e.id in (select max(id) from calendar_events group by identity)"
        )
        events = []
        for r in rows:
            ny_date = r["identity"].split("|")[2]
            if not (start <= ny_date <= end):
                continue
            forecast, unit = parse_value(r["forecast_raw"])
            previous, _ = parse_value(r["previous_raw"])
            t_off = r["official_time_ms"]
            events.append(
                {
                    "id": r["identity"],
                    "title": r["title"],
                    "title_fr": r["label_fr"],
                    "indicator": r["indicator_id"],
                    "capture": r["indicator_id"] is not None,
                    "currency": r["currency"],
                    "impact": r["impact"],
                    "ny_date": ny_date,
                    "time_ms": t_off if t_off is not None else r["ff_time_ms"],
                    "time_source": "BLS" if t_off is not None else "ForexFactory",
                    "time_kind": "officielle"
                    if t_off is not None
                    else ("indicative" if r["ff_time_ms"] is not None else r["ff_time_kind"]),
                    "ff_time_ms": r["ff_time_ms"],
                    "time_mismatch": t_off is not None
                    and r["ff_time_ms"] is not None
                    and t_off != r["ff_time_ms"],
                    "official": {"local_time": r["official_local"], "tz": r["official_tz"]}
                    if t_off is not None
                    else None,
                    "forecast_raw": r["forecast_raw"] or None,
                    "forecast": forecast,
                    "previous_raw": r["previous_raw"] or None,
                    "previous": previous,
                    "unit": unit,
                    "actual": None,
                    "series": r["identity"].split("|")[0],
                    "last_seen_ms": r["last_seen_ms"],
                }
            )
        events.sort(key=lambda d: (d["ny_date"], d["time_ms"] if d["time_ms"] is not None else -1))
        return {
            "week": week,
            "from": start,
            "to": end,
            "events": events,
            "archive": True,
            "forexfactory": {
                "source_ts_ms": None,
                "received_ms": max((e["last_seen_ms"] for e in events), default=None),
            },
            "bls": None,
        }


def _seconds_to_minute(t_ms: int, minute: int) -> float:
    """Secondes jusqu'au prochain hh:<minute>:00 (même minute en UTC et à Paris)."""
    t = t_ms / 1000
    nxt = (int(t // 3600) * 3600) + minute * 60
    if nxt <= t:
        nxt += 3600
    return nxt - t
