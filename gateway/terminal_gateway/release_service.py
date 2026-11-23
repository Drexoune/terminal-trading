"""Service « release » (étape E3, docs/plan-p1.md § 7) : capture des chiffres du BLS à l'heure H.

Déroulé d'une publication suivie (IPC, emploi, PPI, productivité), à partir du
calendrier officiel relevé par le service « calendar » (table official_releases) :

- T-15 min : empêche la veille du Mac (`caffeinate`), jusqu'à la fin de la capture.
- T-10 min : une requête, qui ouvre la connexion et lit la publication précédente
  (référence ; contrôle du parseur). L'API du BLS est verrouillée à ce moment :
  elle n'est pas interrogée.
- T-60 s : une requête. De T-3 s à T+60 s : une par seconde, une seule en vol.
  Puis toutes les 10 s jusqu'à T+5 min, et arrêt. Une requête en retard (veille,
  lenteur) est sautée, jamais rattrapée. Une centaine de requêtes au plus.
- Nouveauté : la date d'embargo de la page = date prévue, et version (période,
  embargo) ≠ référence. Le communiqué révisé de la productivité garde la même
  période que le préliminaire : seule la date d'embargo le distingue.
- Page vide ou pleine d'octets nuls : la requête suivante lit la page complète.
- 403 ou 429 : arrêt immédiat, état « bloqué », aucun contournement.

À la capture : chaque chiffre est enregistré (première publication, jamais
écrasée), avec la prévision ForexFactory retenue, la surprise brute, z, et les
délais ; il est publié sur le bus (`release:<indicateur>:<période>[:<édition>]`,
`release:last`). Le front renvoie l'heure d'affichage (op « displayed »).

Suites, vérifiées chaque minute (`followups`) :

- Réaction du BTC : à T+31 min, bougies 1 min OKX de T-5 à T+30 min, gardées
  (OKX n'en sert que 24 h) ; au démarrage, rattrapée tant que T a moins de 23 h.
- Rattrapage d'une capture manquée (Mac en veille, passerelle arrêtée, page en
  ligne après T+5 min), décision T-040 : relecture du communiqué (`.nr0`, page
  complète, puis copie archivée à la date) par le même parseur ; l'API v1 ne sert
  que si la page reste illisible, chiffre marqué « recalculé ».
- Révisions : l'API v1 relue à T+15 min et T+60 min après chaque publication
  suivie, et chaque jour ouvré à 12:00 à New York (au plus 20 requêtes par jour sur
  25). Une valeur différente de la dernière connue devient une ligne de
  `release_revisions` ; la première publication n'est jamais modifiée.

Sans BLS_CONTACT_EMAIL (T-023), la capture et l'API restent arrêtées avec leur
raison ; la réaction du BTC, qui ne lit qu'OKX, continue.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from . import bls_api
from .bls_release import BLS, BY_TITLE, RELEASES, Figure, Parsed, Release, classify, parse_page
from .bus import Bus
from .calendar_data import INDICATORS
from .calendar_service import Feed
from .config import Settings
from .reaction import BEFORE_MS, DUE_AFTER_MS, INST, OKX_KEEPS_MS, btc_reaction
from .storage import Storage
from .surprise import ZScore, raw_surprise, z_score

log = logging.getLogger(__name__)

AWAKE_BEFORE_MS = 15 * 60_000
RECHECK_MS = 10 * 60_000  # relecture du calendrier pendant l'attente
LATE_SLACK_MS = 500  # une requête plus en retard que ça est sautée
RECENT_MS = 40 * 86_400_000  # publications republiées au démarrage
LABELS = {i.id: i for i in INDICATORS}
NEW_YORK = ZoneInfo("America/New_York")
FOLLOWUP_EVERY_S = 60
CATCHUP_FROM_MS = 10 * 60_000  # après la fin de la rafale (T+5 min)
CATCHUP_WINDOW_MS = 35 * 86_400_000
CATCHUP_SPACING_S = 1.0
API_FALLBACK_AFTER_MS = 60 * 60_000  # l'API n'est pas à jour à 08:30
API_CHECKS = ((15 * 60_000, "révisions T+15min"), (60 * 60_000, "révisions T+60min"))
API_DAILY_AT = (12, 0)  # New York, jours ouvrés
REVISION_GRACE_MS = 7 * 86_400_000  # écart sur une publication de moins de 7 jours : « écart »
REACTION_RETRY_MS = 5 * 60_000
REACTION_FINAL_MS = 45 * 60_000  # au-delà, une bougie absente est enregistrée comme telle

FEED = {
    "name": "bls-release",
    "label": "Capture BLS",
    # Le service n'interroge le BLS que pendant les fenêtres de publication.
    "late_after_ms": 8 * 86_400_000,
    "stale_after_ms": 15 * 86_400_000,
}


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass
class Fetched:
    status: int | None
    headers: dict
    body: bytes
    send_ms: int
    first_byte_ms: int | None = None
    done_ms: int | None = None
    error: str | None = None


Fetch = Callable[[str], Awaitable[Fetched]]
ApiPost = Callable[[str, dict], Awaitable[Fetched]]
Candles = Callable[[str, int], Awaitable[list[dict]]]  # (instrument, depuis) -> bougies 1 min
KeepAwake = Callable[[], Callable[[], None]]


@dataclass(frozen=True)
class Scheduled:
    release: Release
    local_date: str  # jour de publication à New York
    local_time: str
    utc_ms: int

    @property
    def ident(self) -> tuple[str, int]:
        return self.release.key, self.utc_ms


def burst_plan(t_ms: int) -> list[tuple[int, str]]:
    """Instants (ms UTC) et étiquettes des requêtes, dans l'ordre (§ 7.2)."""
    plan = [(t_ms - 600_000, "T-10min"), (t_ms - 60_000, "T-60s")]
    plan += [(t_ms + s * 1000 + 50, "rafale") for s in range(-3, 61)]
    plan += [(t_ms + s * 1000, "fin") for s in range(70, 301, 10)]
    return plan


def caffeinate() -> Callable[[], None]:
    """macOS : empêche la veille tant que la capture tourne ; renvoie de quoi l'arrêter."""
    if sys.platform != "darwin":
        return lambda: None
    try:
        proc = subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
    except OSError:
        log.warning("caffeinate indisponible : garder le Mac éveillé à la main")
        return lambda: None
    return proc.terminate


def make_fetch(user_agent: str) -> tuple[Fetch, ApiPost, Callable[[], Awaitable[None]]]:
    """Client httpx unique (connexion gardée ouverte entre deux requêtes), en flux ;
    GET des pages du BLS, POST JSON de l'API v1."""
    import httpx

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False,
        headers={"User-Agent": user_agent, "Accept-Encoding": "gzip"},
        limits=httpx.Limits(max_connections=2, max_keepalive_connections=2, keepalive_expiry=900))

    async def fetch(url: str, json_body: dict | None = None) -> Fetched:
        out = Fetched(None, {}, b"", now_ms())
        method = "GET" if json_body is None else "POST"
        try:
            async with client.stream(method, url, json=json_body) as r:
                chunks: list[bytes] = []
                async for chunk in r.aiter_bytes():
                    if out.first_byte_ms is None:
                        out.first_byte_ms = now_ms()
                    chunks.append(chunk)
                out.status, out.body = r.status_code, b"".join(chunks)
                out.headers = {k.lower(): v for k, v in r.headers.items()}
        except httpx.HTTPError as exc:
            out.error = repr(exc)[:200]
        out.done_ms = now_ms()
        return out

    async def post(url: str, body: dict) -> Fetched:
        return await fetch(url, body)

    return fetch, post, client.aclose


def make_candles(region: str) -> tuple[Candles, Callable[[], Awaitable[None]]]:
    """Bougies 1 min du REST public d'OKX (même domaine que le collecteur)."""
    from terminal_collectors.okx.endpoints import endpoints
    from terminal_collectors.okx.rest import OkxRest

    rest = OkxRest(endpoints(region).rest)

    async def candles(inst: str, since_ms: int) -> list[dict]:
        return await rest.candles(inst, "1m", since_ms=since_ms)

    return candles, rest.aclose


def utc_day_start(ms: int) -> int:
    d = datetime.fromtimestamp(ms / 1000, UTC)
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp() * 1000)


def ny_date(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, NEW_YORK).date().isoformat()


def archive_url(rel: Release, local_date: str) -> str:
    """Copie archivée d'un communiqué : « news.release/archives/cpi_12102026.htm »."""
    y, m, d = local_date.split("-")
    return f"{BLS}/news.release/archives/{rel.key}_{m}{d}{y}.htm"


@dataclass
class Capture:
    """État d'une fenêtre de capture, publié sur `release:state`."""

    scheduled: Scheduled
    phase: str = "attente"  # attente, rafale, capté, non capté, bloqué
    polls: int = 0
    baseline: tuple[str | None, str | None] | None = None
    baseline_read: str | None = None  # « 4/4 chiffres lus sur la publication précédente »
    last_without_ms: int | None = None
    reason: str | None = None
    problems: list[str] = field(default_factory=list)


class ReleaseService:
    name = "release"
    needs_storage = True

    def __init__(self, bus: Bus, storage: Storage, settings: Settings,
                 fetch: Fetch | None = None, clock: Callable[[], int] = now_ms,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 keep_awake: KeepAwake = caffeinate, api_post: ApiPost | None = None,
                 candles: Candles | None = None) -> None:
        self.bus, self.db, self.settings = bus, storage, settings
        self.clock, self.sleep, self.keep_awake = clock, sleep, keep_awake
        self._fetch, self._api_post, self._candles = fetch, api_post, candles
        self._closers: list[Callable[[], Awaitable[None]]] = []
        self.feed = Feed(FEED)
        self.capture: Capture | None = None
        self._done: set[tuple[str, int]] = set()
        self._tasks: list[asyncio.Task] = []
        # Suites : prochain essai de rattrapage, raisons, essais de réaction, API.
        self._catchup_next: dict[tuple[str, int], int] = {}
        self.catchup_notes: dict[str, str] = {}
        self._reaction_tried: dict[tuple[str, int], int] = {}
        self._api_blocked_until = 0
        self.api_note: str | None = None
        self.bus.set_retention("release:", 120)
        self.bus.set_retention("reaction:", 40)

    # --- cycle de vie --------------------------------------------------------------

    async def start(self) -> None:
        await self._publish_recent()
        if self._candles is None:
            self._candles, close = make_candles(self.settings.okx_region)
            self._closers.append(close)
        email = self.settings.bls_contact_email
        if not email:
            self.feed.stop("BLS_CONTACT_EMAIL absente : capture à la source arrêtée (T-023)")
            self._publish_state()
        else:
            if self._fetch is None:
                self._fetch, post, close = make_fetch(f"terminal-trading/0.1 ({email})")
                self._api_post = self._api_post or post
                self._closers.append(close)
            self.feed.ok(self.clock())
            self._tasks.append(asyncio.create_task(self._loop(), name="release-loop"))
        self._tasks.append(asyncio.create_task(self._followups_loop(), name="release-followups"))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []
        for close in self._closers:
            await close()
        self._closers = []

    def health(self) -> dict:
        c = self.capture
        return {"bls": self.feed.snapshot(),
                "next": c.scheduled.release.key if c else None,
                "phase": c.phase if c else None,
                "catch_up": dict(self.catchup_notes),
                "api": {"note": self.api_note, "blocked_until_ms": self._api_blocked_until or None}}

    # --- planification ---------------------------------------------------------------

    async def next_scheduled(self) -> Scheduled | None:
        """Prochaine publication suivie, encore annoncée par le dernier calendrier relevé."""
        titles = list(BY_TITLE)
        rows = await self.db.query(
            "select title, local_date, local_time, utc_ms from official_releases"
            " where source = 'BLS' and utc_ms > ? and title in"
            f" ({', '.join('?' * len(titles))})"
            " and last_seen_ms = (select max(last_seen_ms) from official_releases"
            " where source = 'BLS') order by utc_ms",
            (self.clock() - 6 * 60_000, *titles))
        for r in rows:
            s = Scheduled(BY_TITLE[r["title"]], r["local_date"], r["local_time"], r["utc_ms"])
            if s.ident in self._done or await self._already_captured(s):
                continue
            return s
        return None

    async def past_scheduled(self, since_ms: int, until_ms: int) -> list[Scheduled]:
        """Publications suivies passées, annoncées par le dernier calendrier relevé."""
        titles = list(BY_TITLE)
        rows = await self.db.query(
            "select title, local_date, local_time, utc_ms from official_releases"
            " where source = 'BLS' and utc_ms between ? and ? and title in"
            f" ({', '.join('?' * len(titles))})"
            " and last_seen_ms = (select max(last_seen_ms) from official_releases"
            " where source = 'BLS') order by utc_ms",
            (since_ms, until_ms, *titles))
        return [Scheduled(BY_TITLE[r["title"]], r["local_date"], r["local_time"], r["utc_ms"])
                for r in rows]

    async def _already_captured(self, s: Scheduled) -> bool:
        rows = await self.db.query(
            "select 1 from releases where release = ? and ny_date = ? limit 1",
            (s.release.key, s.local_date))
        return bool(rows)

    async def _loop(self) -> None:
        while True:
            try:
                nxt = await self.next_scheduled()
            except Exception:
                log.exception("capture BLS : calendrier officiel illisible")
                nxt = None
            if nxt is None:
                self.capture = None
                self._publish_state("aucune publication suivie annoncée : calendrier officiel "
                                    "du BLS requis (service calendar)")
                await self.sleep(RECHECK_MS / 1000)
                continue
            if self.capture is None or self.capture.scheduled != nxt:
                self.capture = Capture(nxt)
            wake = nxt.utc_ms - AWAKE_BEFORE_MS
            now = self.clock()
            if now < wake:
                self._publish_state()
                await self.sleep(min(wake - now, RECHECK_MS) / 1000)
                continue
            await self.run_capture(self.capture)
            self._done.add(nxt.ident)

    # --- capture ----------------------------------------------------------------------

    async def run_capture(self, cap: Capture) -> Parsed | None:
        self.capture = cap
        s, rel = cap.scheduled, cap.scheduled.release
        stop_awake = self.keep_awake()
        cap.phase = "rafale"
        self._publish_state()
        fallback = False
        try:
            for at, label in burst_plan(s.utc_ms):
                now = self.clock()
                if now > at + LATE_SLACK_MS:
                    continue
                if at > now:
                    await self.sleep((at - now) / 1000)
                url = rel.fallback if fallback else rel.url
                got = await self._fetch(url)
                cap.polls += 1
                parsed = parse_page(rel.key, got.body) if got.status == 200 else None
                verdict = None
                if got.status in (403, 429):
                    cap.phase = "bloqué"
                    cap.reason = f"HTTP {got.status} du BLS : capture arrêtée, aucun contournement"
                    self.feed.stop(cap.reason)
                elif parsed is not None:
                    self.feed.ok(got.done_ms or self.clock())
                    if parsed.page in ("vide", "octets nuls"):
                        fallback = not fallback
                        cap.problems.append(f"{label} : page {parsed.page}, page complète ensuite")
                    else:
                        fallback = False
                        verdict = classify(parsed, s.local_date, cap.baseline)
                        if verdict is None and cap.baseline is None and parsed.page == "ok":
                            cap.baseline = parsed.version
                            read = sum(f.value is not None for f in parsed.figures.values())
                            cap.baseline_read = (f"{read}/{len(parsed.figures)} chiffres lus sur "
                                                 f"la publication précédente ({parsed.period})")
                await self._log_poll(s, label, url, got, parsed, verdict
                                     or ("référence" if parsed and parsed.version == cap.baseline
                                         else None))
                if cap.phase == "bloqué":
                    break
                if verdict is not None and parsed is not None:
                    await self._record(cap, parsed, got, verdict, url)
                    cap.phase = "capté"
                    return parsed
                if parsed is not None and parsed.page == "ok":
                    cap.last_without_ms = got.send_ms
                self._publish_state()
            if cap.phase != "bloqué":
                cap.phase = "non capté"
                cap.reason = "aucune nouvelle publication jusqu'à T+5 min"
            return None
        finally:
            stop_awake()
            self._publish_state()

    async def _log_poll(self, s: Scheduled, label: str, url: str, got: Fetched,
                        parsed: Parsed | None, verdict: str | None) -> None:
        await self.db.execute(
            "insert into release_polls (release, scheduled_ms, label, url, send_ms, first_byte_ms,"
            " done_ms, status, size, null_bytes, period, embargo_date, verdict, error)"
            " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (s.release.key, s.utc_ms, label, url, got.send_ms, got.first_byte_ms, got.done_ms,
             got.status, len(got.body), got.body.count(0) if got.body else 0,
             parsed.period if parsed else None, parsed.embargo_date if parsed else None,
             verdict, got.error))

    # --- enregistrement ------------------------------------------------------------------

    async def _forecast(self, indicator: str, ny_date: str, t_ms: int) -> dict:
        """Dernière version ForexFactory vue avant T, et l'heure du dernier relevé qui l'a vue."""
        rows = await self.db.query(
            "select forecast, forecast_raw, first_seen_ms from calendar_events"
            " where indicator_id = ? and identity like ? and first_seen_ms <= ?"
            " order by id desc limit 1",
            (indicator, f"%|{ny_date}|%", t_ms))
        if not rows:
            return {}
        seen = await self.db.query(
            "select max(received_ms) as t from calendar_snapshots where source = 'ForexFactory'"
            " and status in (200, 304) and received_ms <= ?", (t_ms,))
        return {**rows[0], "seen_ms": seen[0]["t"] if seen else None}

    async def _history(self, indicator: str, before_ms: int) -> list[str]:
        rows = await self.db.query(
            "select surprise from releases where indicator_id = ? and surprise is not null"
            " and regular = 1 and scheduled_ms < ? order by scheduled_ms",
            (indicator, before_ms))
        return [r["surprise"] for r in rows]

    async def _record(self, cap: Capture, parsed: Parsed, got: Fetched, verdict: str,
                      url: str, nature: str = "officielle") -> None:
        s = cap.scheduled
        parsed_ms = self.clock()
        clock = self.bus.get("clock:okx") or {}
        offset = clock.get("offset_ms")
        machine = self.settings.machine
        date_header = got.headers.get("date")
        payloads: dict[str, dict] = {}
        for ind, fig in parsed.figures.items():
            fc = await self._forecast(ind, s.local_date, s.utc_ms)
            surprise = raw_surprise(fig.value, fc.get("forecast"))
            irregular = fig.value is None and (fig.reason or "").startswith("publication irrég")
            history = await self._history(ind, s.utc_ms)
            z = (z_score(surprise, history, fig.value) if fig.value is not None
                 else ZScore(None, len(history), False, "chiffre non lu"))
            row = {
                "indicator_id": ind, "release": s.release.key, "period": parsed.period,
                "edition": parsed.edition or "", "ny_date": s.local_date, "value": fig.value,
                "reason": fig.reason, "part": fig.part, "excerpt": fig.excerpt,
                "flags": json.dumps(list(fig.flags), ensure_ascii=False), "timing": verdict,
                "scheduled_ms": s.utc_ms, "embargo_ms": parsed.embargo_ms,
                "first_byte_ms": got.first_byte_ms, "received_ms": got.done_ms or parsed_ms,
                "url": url, "machine": machine, "forecast": fc.get("forecast"),
                "forecast_raw": fc.get("forecast_raw"), "forecast_seen_ms": fc.get("seen_ms"),
                "surprise": surprise, "z": z.z, "z_n": z.n, "z_reason": z.reason,
                "regular": 0 if irregular or verdict != "attendue" else 1, "nature": nature,
            }
            cols = ", ".join(row)
            await self.db.execute(
                f"insert into releases ({cols}) values ({', '.join('?' * len(row))})"
                " on conflict (indicator_id, period, edition) do nothing", tuple(row.values()))
            payloads[ind] = self._payload(row, z.provisional, offset)
        if nature == "officielle":  # les délais d'un rattrapage ne mesurent rien
            await self.db.execute(
                "insert into release_timings (release, period, edition, scheduled_ms,"
                " last_without_ms, first_send_ms, first_byte_ms, parsed_ms, okx_offset_ms,"
                " date_header) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing",
                (s.release.key, parsed.period, parsed.edition or "", s.utc_ms,
                 cap.last_without_ms, got.send_ms, got.first_byte_ms, parsed_ms, offset,
                 date_header))
        bus_ms = self.clock()
        keys = []
        for p in payloads.values():
            p.update(bus_ms=bus_ms, parsed_ms=parsed_ms, last_without_ms=cap.last_without_ms,
                     date_header=date_header)
            key = release_key(p["indicator"], p["period"], p["edition"])
            keys.append(key)
            self.bus.publish(key, p)
        self.bus.publish("release:last", {
            "release": s.release.key, "title": s.release.title, "period": parsed.period,
            "edition": parsed.edition, "ny_date": s.local_date, "keys": keys, "timing": verdict,
            "scheduled_ms": s.utc_ms, "bus_ms": bus_ms, "nature": nature})
        await self.db.execute(
            "update release_timings set bus_ms = ? where release = ? and period = ?"
            " and edition = ?", (bus_ms, s.release.key, parsed.period, parsed.edition or ""))
        log.info("BLS %s %s %s : %s", s.release.key, parsed.period,
                 "capté" if nature == "officielle" else nature,
                 {k: v.value for k, v in parsed.figures.items()})

    def _payload(self, row: dict, provisional: bool, offset: float | None,
                 revisions: list[dict] | None = None) -> dict:
        ind = LABELS.get(row["indicator_id"])
        nature = row.get("nature") or "officielle"
        fb = row["first_byte_ms"] if nature == "officielle" else None
        corr = offset or 0
        return {
            "indicator": row["indicator_id"], "label_fr": ind.label_fr if ind else None,
            "unit": ind.unit if ind else None, "release": row["release"],
            "period": row["period"], "edition": row["edition"], "ny_date": row["ny_date"],
            "value": row["value"], "reason": row["reason"], "part": row["part"],
            "excerpt": row["excerpt"], "flags": json.loads(row["flags"]),
            "timing": row["timing"], "nature": nature,
            "source": "BLS", "url": row["url"], "machine": row["machine"],
            "scheduled_ms": row["scheduled_ms"], "embargo_ms": row["embargo_ms"],
            "first_byte_ms": fb, "received_ms": row["received_ms"],
            # Délai de capture : premier octet avec le chiffre - heure prévue, sur l'horloge OKX.
            "capture_delay_ms": (round(fb + corr - row["scheduled_ms"]) if fb else None),
            "clock_corrected": offset is not None,
            "forecast": row["forecast"], "forecast_raw": row["forecast_raw"],
            "forecast_age_ms": (row["scheduled_ms"] - row["forecast_seen_ms"]
                                if row["forecast_seen_ms"] else None),
            "surprise": row["surprise"], "z": row["z"], "z_n": row["z_n"],
            "z_provisional": provisional, "z_reason": row["z_reason"],
            "regular": bool(row["regular"]), "display_ms": row.get("display_ms"),
            "revisions": revisions or [], "filled_ms": row.get("filled_ms"),
        }

    async def _publish_recent(self) -> None:
        """Publications des 40 derniers jours : le calendrier les montre dès le démarrage."""
        rows = await self.db.query(
            "select r.*, t.display_ms, t.bus_ms, t.parsed_ms, t.last_without_ms, t.okx_offset_ms"
            " from releases r left join release_timings t on t.release = r.release"
            " and t.period = r.period and t.edition = r.edition"
            " where r.scheduled_ms > ? order by r.scheduled_ms",
            (self.clock() - RECENT_MS,))
        revs = await self._revisions()
        for r in rows:
            p = self._payload(r, (r["z_n"] or 0) < 24, r["okx_offset_ms"],
                              revs.get((r["indicator_id"], r["period"], r["edition"])))
            p.update(bus_ms=r["bus_ms"], parsed_ms=r["parsed_ms"],
                     last_without_ms=r["last_without_ms"])
            if r["display_ms"]:
                p["display_delay_ms"] = r["display_ms"] - r["scheduled_ms"]
            self.bus.publish(release_key(r["indicator_id"], r["period"], r["edition"]), p)
        for r in await self.db.query("select * from release_reactions where scheduled_ms > ?",
                                     (self.clock() - RECENT_MS,)):
            self._publish_reaction(r)

    async def _revisions(self) -> dict[tuple[str, str, str], list[dict]]:
        out: dict[tuple[str, str, str], list[dict]] = {}
        for r in await self.db.query(
                "select indicator_id, period, edition, kind, previous, value, source, series,"
                " excerpt, seen_ms from release_revisions order by seen_ms, id"):
            key = (r.pop("indicator_id"), r.pop("period"), r.pop("edition"))
            out.setdefault(key, []).append(r)
        return out

    async def _republish(self, triples: set[tuple[str, str, str]]) -> None:
        revs = await self._revisions()
        for ind, period, edition in triples:
            for r in await self.db.query(
                    "select r.*, t.display_ms, t.bus_ms, t.parsed_ms, t.last_without_ms,"
                    " t.okx_offset_ms from releases r left join release_timings t on"
                    " t.release = r.release and t.period = r.period and t.edition = r.edition"
                    " where r.indicator_id = ? and r.period = ? and r.edition = ?",
                    (ind, period, edition)):
                p = self._payload(r, (r["z_n"] or 0) < 24, r["okx_offset_ms"],
                                  revs.get((ind, period, edition)))
                p.update(bus_ms=r["bus_ms"], parsed_ms=r["parsed_ms"],
                         last_without_ms=r["last_without_ms"])
                if r["display_ms"]:
                    p["display_delay_ms"] = r["display_ms"] - r["scheduled_ms"]
                self.bus.publish(release_key(ind, period, edition), p)

    # --- suites : réaction du BTC, rattrapage, révisions -------------------------------

    async def _followups_loop(self) -> None:
        while True:
            try:
                await self.followups()
            except Exception:
                log.exception("suites de la capture BLS en erreur")
            await self.sleep(FOLLOWUP_EVERY_S)

    async def followups(self) -> None:
        now = self.clock()
        for s in await self.past_scheduled(now - OKX_KEEPS_MS, now - DUE_AFTER_MS):
            await self.record_reaction(s)
        if self._fetch is None:
            return  # sans adresse de contact, ni page ni API du BLS
        busy = self.capture.scheduled.ident if self.capture and self.capture.phase == "rafale" \
            else None
        for s in await self.past_scheduled(now - CATCHUP_WINDOW_MS, now - CATCHUP_FROM_MS):
            if s.ident == busy or now < self._catchup_next.get(s.ident, 0):
                continue
            if not await self._already_captured(s):
                await self.catch_up(s)
        await self._api_checks(now)

    # Réaction du BTC

    async def record_reaction(self, s: Scheduled) -> dict | None:
        if await self.db.query("select 1 from release_reactions where release = ? and ny_date = ?",
                               (s.release.key, s.local_date)):
            return None
        now = self.clock()
        if now - self._reaction_tried.get(s.ident, now - REACTION_RETRY_MS) < REACTION_RETRY_MS:
            return None
        self._reaction_tried[s.ident] = now
        try:
            candles = await self._candles(INST, s.utc_ms - BEFORE_MS)
        except Exception as exc:
            log.warning("réaction du BTC (%s %s) : bougies OKX illisibles : %s",
                        s.release.key, s.local_date, exc)
            return None
        r = btc_reaction(candles, s.utc_ms)
        if r["reason"] and now < s.utc_ms + REACTION_FINAL_MS:
            return None  # bougie pas encore clôturée : nouvel essai dans 5 min
        row = {"release": s.release.key, "ny_date": s.local_date, "scheduled_ms": s.utc_ms,
               "inst": r["inst"], "source": f"OKX {self.settings.okx_region.upper()} REST",
               "candles": json.dumps(r["candles"]), "ref_price": r["ref_price"],
               "end_price": r["end_price"], "change_pct": r["change_pct"],
               "missing": json.dumps(r["missing"]), "reason": r["reason"], "received_ms": now}
        await self.db.execute(
            f"insert into release_reactions ({', '.join(row)}) values"
            f" ({', '.join('?' * len(row))}) on conflict do nothing", tuple(row.values()))
        self._publish_reaction(row)
        log.info("réaction du BTC à %s %s : %s %%", s.release.key, s.local_date,
                 r["change_pct"] or r["reason"])
        return row

    def _publish_reaction(self, row: dict) -> None:
        rel = RELEASES.get(row["release"])
        self.bus.publish(f"reaction:{row['release']}:{row['ny_date']}", {
            "release": row["release"], "title": rel.title if rel else row["release"],
            "indicators": list(rel.indicators) if rel else [],
            "ny_date": row["ny_date"], "scheduled_ms": row["scheduled_ms"], "inst": row["inst"],
            "source": row["source"], "candles": json.loads(row["candles"]),
            "ref_price": row["ref_price"], "end_price": row["end_price"],
            "change_pct": row["change_pct"], "missing": json.loads(row["missing"]),
            "reason": row["reason"], "received_ms": row["received_ms"]})

    # Rattrapage d'une capture manquée (T-040)

    async def catch_up(self, s: Scheduled) -> str | None:
        """Relit le communiqué d'une publication passée restée sans chiffre."""
        rel, now = s.release, self.clock()
        self._catchup_next[s.ident] = now + (30 * 60_000 if now - s.utc_ms < 86_400_000
                                             else 6 * 3_600_000)
        cap = Capture(s, phase="rattrapage")
        unreadable = True
        urls = [rel.url, rel.fallback, archive_url(rel, s.local_date)]
        i = 0
        while i < len(urls):
            url = urls[i]
            await self.sleep(CATCHUP_SPACING_S)  # jamais plus d'une requête par seconde au BLS
            got = await self._fetch(url)
            if got.status in (403, 429):
                await self._log_poll(s, "rattrapage", url, got, None, None)
                self.catchup_notes[rel.key] = f"HTTP {got.status} du BLS : rattrapage suspendu 6 h"
                self._catchup_next[s.ident] = now + 6 * 3_600_000
                return None
            parsed = parse_page(rel.key, got.body) if got.status == 200 else None
            verdict = classify(parsed, s.local_date, None) if parsed else None
            await self._log_poll(s, "rattrapage", url, got, parsed, verdict)
            if verdict == "attendue" and parsed is not None:
                await self._record(cap, parsed, got, verdict, url, nature="rattrapage")
                self.catchup_notes.pop(rel.key, None)
                return verdict
            if parsed is not None and parsed.page == "ok" and parsed.embargo_date:
                unreadable = False
                if parsed.embargo_date < s.local_date:
                    self.catchup_notes[rel.key] = (f"communiqué du {s.local_date} pas encore en "
                                                   "ligne : nouvel essai plus tard")
                    return None
                i = 2  # page plus récente : la copie archivée à la date
                if url == urls[2]:
                    break
                continue
            i += 1
        if unreadable and now - s.utc_ms >= API_FALLBACK_AFTER_MS:
            return await self._catch_up_api(s, cap)
        self.catchup_notes[rel.key] = (
            f"communiqué du {s.local_date} illisible : API v1 à partir de T+1 h" if unreadable
            else f"copie archivée du {s.local_date} introuvable")
        return None

    async def _expected_period(self, rel: Release) -> tuple[str | None, str, str | None]:
        rows = await self.db.query(
            "select period, edition from releases where release = ?"
            " order by scheduled_ms desc limit 1", (rel.key,))
        if not rows:
            return None, "", "période attendue inconnue : aucune publication enregistrée avant"
        period, edition = rows[0]["period"], rows[0]["edition"]
        if rel.quarterly:
            if edition == "Preliminary":
                return None, "", ("communiqué révisé : l'API ne dit pas si la valeur publiée "
                                  "est déjà la révisée")
            return bls_api.shift(period, 1), "Preliminary", None
        return bls_api.shift(period, 1), "", None

    async def _catch_up_api(self, s: Scheduled, cap: Capture) -> str | None:
        rel = s.release
        period, edition, why = await self._expected_period(rel)
        if period is None:
            self.catchup_notes[rel.key] = f"page illisible ; API v1 écartée : {why}"
            return None
        series = sorted({bls_api.DERIVATIONS[i][0] for i in rel.indicators
                         if i in bls_api.DERIVATIONS})
        data, got, _ = await self._api_call(series, "rattrapage API", s.utc_ms,
                                            int(period[:4]) - 1)
        if data is None or got is None:
            self.catchup_notes[rel.key] = f"page illisible ; API v1 : {self.api_note}"
            return None
        latest = {data.latest.get(sid) for sid in series}
        if latest != {period}:
            self.catchup_notes[rel.key] = (f"page illisible ; API v1 pas à jour (dernière période"
                                           f" {', '.join(sorted(p or '—' for p in latest))},"
                                           f" attendue {period})")
            return None
        figures = {}
        for ind in rel.indicators:
            d = bls_api.derive(ind, period, data)
            figures[ind] = Figure(
                ind, d.value if d else None,
                None if d else "aucune série de l'API v1 retenue pour cet indicateur",
                part="API v1 (recalculé)" if d else None, excerpt=d.excerpt if d else None,
                flags=("recalculé",) if d else ())
        parsed = Parsed(rel.key, "ok", period=period, edition=edition or None, figures=figures)
        await self._record(cap, parsed, got, "inconnue", bls_api.API_V1, nature="rattrapage API")
        self.catchup_notes.pop(rel.key, None)
        return "inconnue"

    # API v1 : quota, révisions

    async def _api_call(self, series: list[str], label: str, scheduled_ms: int,
                        start_year: int) -> tuple[bls_api.ApiData | None, Fetched | None, int]:
        now = self.clock()
        if self._api_post is None or not series:
            return None, None, 0
        if now < self._api_blocked_until:
            return None, None, 0
        used = (await self.db.query(
            "select count(*) as n from release_polls where url = ? and send_ms >= ?",
            (bls_api.API_V1, utc_day_start(now))))[0]["n"]
        if used >= bls_api.DAILY_MAX:
            self.api_note = f"quota du jour atteint ({used}/{bls_api.DAILY_MAX} requêtes)"
            return None, None, 0
        body = bls_api.request_body(series, start_year, int(ny_date(now)[:4]))
        got = await self._api_post(bls_api.API_V1, body)
        data, verdict = None, None
        if got.status == 429:
            self._api_blocked_until = utc_day_start(now) + 86_400_000
            self.api_note = "HTTP 429 : quota de l'API v1 épuisé, reprise demain (UTC)"
        elif got.status == 200:
            try:
                data = bls_api.parse_response(got.body)
                self.api_note = None
                verdict = "périodes : " + ", ".join(
                    f"{sid} {p}" for sid, p in sorted(data.latest.items()))
            except bls_api.ApiError as exc:
                self.api_note = f"API v1 : {exc}"[:200]
        else:
            self.api_note = f"API v1 : HTTP {got.status} {got.error or ''}".strip()
        poll_id = await self.db.execute(
            "insert into release_polls (release, scheduled_ms, label, url, send_ms, first_byte_ms,"
            " done_ms, status, size, null_bytes, verdict, error) values"
            " ('api-v1', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            (scheduled_ms, label, bls_api.API_V1, got.send_ms, got.first_byte_ms, got.done_ms,
             got.status, len(got.body), verdict, got.error or (None if data else self.api_note)))
        return data, got, poll_id

    async def _api_checks(self, now: int) -> None:
        """Une relecture de l'API au plus par passage : T+15 min, T+60 min, 12:00 New York."""
        due: list[tuple[int, str]] = []
        for s in await self.past_scheduled(now - 5 * 3_600_000, now):
            due += [(s.utc_ms + after, label) for after, label in API_CHECKS
                    if now >= s.utc_ms + after]
        d = datetime.fromtimestamp(now / 1000, NEW_YORK)
        noon = d.replace(hour=API_DAILY_AT[0], minute=API_DAILY_AT[1], second=0, microsecond=0)
        if d.weekday() < 5 and d >= noon:
            due.append((int(noon.timestamp() * 1000), "révisions quotidiennes"))
        for due_ms, label in sorted(due):
            done = await self.db.query(
                "select 1 from release_polls where release = 'api-v1' and label like 'révisions%'"
                " and send_ms >= ? limit 1", (due_ms,))
            if not done:
                await self.check_revisions(label, due_ms)
                return

    async def check_revisions(self, label: str = "révisions", scheduled_ms: int = 0) -> int:
        """Compare l'API v1 aux valeurs connues ; une valeur nouvelle devient une révision.

        Même relecture : un chiffre resté vide à l'heure H parce qu'il manque à la page
        (PPI sous-jacent) est complété par la valeur recalculée, une seule fois.
        Renvoie le nombre de révisions, écarts et compléments."""
        every = [r for r in await self.db.query(
            "select id, indicator_id, period, edition, value, regular, scheduled_ms, forecast"
            " from releases order by scheduled_ms, id")
            if r["indicator_id"] in bls_api.DERIVATIONS]
        rows = [r for r in every if r["value"] is not None]
        empty = [r for r in every if r["value"] is None and r["regular"]]
        if not every or not (rows or empty):
            return 0
        latest: dict[tuple[str, str], dict] = {}
        history: dict[tuple[str, str], list[str]] = {}
        for r in rows:
            key = (r["indicator_id"], r["period"])
            latest[key] = r
            history.setdefault(key, []).append(r["value"])
        for r in await self.db.query(
                "select indicator_id, period, value from release_revisions order by seen_ms, id"):
            history.setdefault((r["indicator_id"], r["period"]), []).append(r["value"])
        wanted = list(latest) + [(r["indicator_id"], r["period"]) for r in empty]
        series = sorted({bls_api.DERIVATIONS[i][0] for i, _ in wanted})
        start = min(int(p[:4]) for _, p in wanted) - 1
        data, _, poll_id = await self._api_call(series, label, scheduled_ms, start)
        if data is None:
            return 0
        now, changed = self.clock(), set()
        filled = 0
        for r in empty:
            d = bls_api.derive(r["indicator_id"], r["period"], data)
            if d is None:
                continue  # API pas encore à jour pour cette période : relecture suivante
            await self._fill(r, d, now)
            changed.add((r["indicator_id"], r["period"], r["edition"]))
            filled += 1
        for (ind, period), row in latest.items():
            d = bls_api.derive(ind, period, data)
            known = history[(ind, period)]
            if d is None or bls_api.same_value(d.value, known[-1]):
                continue
            recent = now - row["scheduled_ms"] < REVISION_GRACE_MS
            if recent and any(bls_api.same_value(d.value, v) for v in known[:-1]):
                continue  # l'API n'a pas encore repris la dernière publication
            kind = "écart" if recent else "révision"
            if kind == "écart":
                log.warning("API v1 : %s %s = %s, publié %s (écart à vérifier)", ind, period,
                            d.value, known[-1])
            await self.db.execute(
                "insert into release_revisions (indicator_id, period, edition, kind, previous,"
                " value, source, series, excerpt, seen_ms, poll_id) values"
                " (?, ?, ?, ?, ?, ?, 'BLS API v1', ?, ?, ?, ?)",
                (ind, period, row["edition"], kind, known[-1], d.value, d.series, d.excerpt, now,
                 poll_id))
            changed.add((ind, period, row["edition"]))
        await self.db.execute(
            "update release_polls set verdict = coalesce(verdict, '') || ? where id = ?",
            (f" ; {len(changed) - filled} révision(s) ou écart(s), {filled} complément(s)",
             poll_id))
        if changed:
            await self._republish(changed)
        return len(changed)

    async def _fill(self, row: dict, d: bls_api.Derived, now: int) -> None:
        """Complète un chiffre vide par la valeur recalculée : surprise et z comme à la capture."""
        surprise = raw_surprise(d.value, row["forecast"])
        history = await self._history(row["indicator_id"], row["scheduled_ms"])
        z = z_score(surprise, history, d.value)
        flags = json.dumps(["recalculé", "complété par l'API v1"], ensure_ascii=False)
        await self.db.execute(
            "update releases set value = ?, reason = null, part = 'API v1 (recalculé)',"
            " excerpt = ?, flags = ?, surprise = ?, z = ?, z_n = ?, z_reason = ?, filled_ms = ?"
            " where id = ? and value is null",
            (d.value, d.excerpt, flags, surprise, z.z, z.n, z.reason, now, row["id"]))
        log.info("API v1 : %s %s complété à %s", row["indicator_id"], row["period"], d.value)

    # --- affichage ------------------------------------------------------------------------

    async def record_display(self, key: str, display_ms: int) -> bool:
        """Heure d'affichage renvoyée par le front (horloge de la passerelle) ; la 1re compte."""
        p = self.bus.get(key)
        if not key.startswith("release:") or p is None or p.get("display_ms"):
            return False
        if not isinstance(display_ms, (int, float)) or abs(display_ms - self.clock()) > 60_000:
            return False
        display_ms = int(display_ms)
        p = {**p, "display_ms": display_ms,
             "display_delay_ms": display_ms - p["scheduled_ms"],
             "display_after_capture_ms": (display_ms - p["first_byte_ms"]
                                          if p.get("first_byte_ms") else None)}
        self.bus.publish(key, p)
        await self.db.execute(
            "update release_timings set display_ms = ? where release = ? and period = ?"
            " and edition = ? and display_ms is null",
            (display_ms, p["release"], p["period"], p["edition"]))
        return True

    # --- état ------------------------------------------------------------------------------

    def _publish_state(self, why: str | None = None) -> None:
        c = self.capture
        self.bus.publish("feed:bls-release", self.feed.snapshot())
        self.bus.publish("release:state", {
            "phase": c.phase if c else None,
            "release": c.scheduled.release.key if c else None,
            "title": c.scheduled.release.title if c else None,
            "scheduled_ms": c.scheduled.utc_ms if c else None,
            "ny_date": c.scheduled.local_date if c else None,
            "polls": c.polls if c else 0,
            "baseline_read": c.baseline_read if c else None,
            "reason": (c.reason if c else None) or why or self.feed.last_error,
            "problems": c.problems[-5:] if c else [],
            "computed_ms": self.clock(),
        })


def release_key(indicator: str, period: str, edition: str | None) -> str:
    return f"release:{indicator}:{period}" + (f":{edition}" if edition else "")

