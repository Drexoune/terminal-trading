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

Sans BLS_CONTACT_EMAIL (T-023), le service reste arrêté avec sa raison.
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

from .bls_release import BY_TITLE, Parsed, Release, classify, parse_page
from .bus import Bus
from .calendar_data import INDICATORS
from .calendar_service import Feed
from .config import Settings
from .storage import Storage
from .surprise import ZScore, raw_surprise, z_score

log = logging.getLogger(__name__)

AWAKE_BEFORE_MS = 15 * 60_000
RECHECK_MS = 10 * 60_000  # relecture du calendrier pendant l'attente
LATE_SLACK_MS = 500  # une requête plus en retard que ça est sautée
RECENT_MS = 40 * 86_400_000  # publications republiées au démarrage
LABELS = {i.id: i for i in INDICATORS}

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


def make_fetch(user_agent: str) -> tuple[Fetch, Callable[[], Awaitable[None]]]:
    """Client httpx unique (connexion gardée ouverte entre deux requêtes), en flux."""
    import httpx

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False,
        headers={"User-Agent": user_agent, "Accept-Encoding": "gzip"},
        limits=httpx.Limits(max_connections=2, max_keepalive_connections=2, keepalive_expiry=900))

    async def fetch(url: str) -> Fetched:
        out = Fetched(None, {}, b"", now_ms())
        try:
            async with client.stream("GET", url) as r:
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

    return fetch, client.aclose


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
                 keep_awake: KeepAwake = caffeinate) -> None:
        self.bus, self.db, self.settings = bus, storage, settings
        self.clock, self.sleep, self.keep_awake = clock, sleep, keep_awake
        self._fetch, self._close = fetch, None
        self.feed = Feed(FEED)
        self.capture: Capture | None = None
        self._done: set[tuple[str, int]] = set()
        self._task: asyncio.Task | None = None
        self.bus.set_retention("release:", 120)

    # --- cycle de vie --------------------------------------------------------------

    async def start(self) -> None:
        await self._publish_recent()
        email = self.settings.bls_contact_email
        if not email:
            self.feed.stop("BLS_CONTACT_EMAIL absente : capture à la source arrêtée (T-023)")
            self._publish_state()
            return
        if self._fetch is None:
            self._fetch, self._close = make_fetch(f"terminal-trading/0.1 ({email})")
        self.feed.ok(self.clock())
        self._task = asyncio.create_task(self._loop(), name="release-loop")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        if self._close:
            await self._close()

    def health(self) -> dict:
        c = self.capture
        return {"bls": self.feed.snapshot(),
                "next": c.scheduled.release.key if c else None,
                "phase": c.phase if c else None}

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
                      url: str) -> None:
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
                "regular": 0 if irregular or verdict != "attendue" else 1,
            }
            cols = ", ".join(row)
            await self.db.execute(
                f"insert into releases ({cols}) values ({', '.join('?' * len(row))})"
                " on conflict (indicator_id, period, edition) do nothing", tuple(row.values()))
            payloads[ind] = self._payload(row, z.provisional, offset)
        await self.db.execute(
            "insert into release_timings (release, period, edition, scheduled_ms, last_without_ms,"
            " first_send_ms, first_byte_ms, parsed_ms, okx_offset_ms, date_header)"
            " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing",
            (s.release.key, parsed.period, parsed.edition or "", s.utc_ms, cap.last_without_ms,
             got.send_ms, got.first_byte_ms, parsed_ms, offset, date_header))
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
            "scheduled_ms": s.utc_ms, "bus_ms": bus_ms})
        await self.db.execute(
            "update release_timings set bus_ms = ? where release = ? and period = ?"
            " and edition = ?", (bus_ms, s.release.key, parsed.period, parsed.edition or ""))
        log.info("BLS %s %s capté : %s", s.release.key, parsed.period,
                 {k: v.value for k, v in parsed.figures.items()})

    def _payload(self, row: dict, provisional: bool, offset: float | None) -> dict:
        ind = LABELS.get(row["indicator_id"])
        fb = row["first_byte_ms"]
        corr = offset or 0
        return {
            "indicator": row["indicator_id"], "label_fr": ind.label_fr if ind else None,
            "unit": ind.unit if ind else None, "release": row["release"],
            "period": row["period"], "edition": row["edition"], "ny_date": row["ny_date"],
            "value": row["value"], "reason": row["reason"], "part": row["part"],
            "excerpt": row["excerpt"], "flags": json.loads(row["flags"]),
            "timing": row["timing"], "nature": row.get("nature", "officielle"),
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
        }

    async def _publish_recent(self) -> None:
        """Publications des 40 derniers jours : le calendrier les montre dès le démarrage."""
        rows = await self.db.query(
            "select r.*, t.display_ms, t.bus_ms, t.parsed_ms, t.last_without_ms, t.okx_offset_ms"
            " from releases r left join release_timings t on t.release = r.release"
            " and t.period = r.period and t.edition = r.edition"
            " where r.scheduled_ms > ? order by r.scheduled_ms",
            (self.clock() - RECENT_MS,))
        for r in rows:
            p = self._payload(r, (r["z_n"] or 0) < 24, r["okx_offset_ms"])
            p.update(bus_ms=r["bus_ms"], parsed_ms=r["parsed_ms"],
                     last_without_ms=r["last_without_ms"])
            if r["display_ms"]:
                p["display_delay_ms"] = r["display_ms"] - r["scheduled_ms"]
            self.bus.publish(release_key(r["indicator_id"], r["period"], r["edition"]), p)

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

