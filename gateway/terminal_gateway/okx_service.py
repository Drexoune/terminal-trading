"""Service OKX de la passerelle : flux publics vers le bus, bougies à la demande.

En P0, le collecteur tourne dans le process de la passerelle (décision T-002).
Il alimente l'écran ; il n'écrit aucun historique de référence (drexbot garde
le sien, règle d'intégration 3). Même code en Mode Local (passerelle sur le
Mac) et en Mode Tour (sur la tour Windows) : voir docs/modes.md.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path

from terminal_collectors.okx.endpoints import endpoints
from terminal_collectors.okx.gaps import TradeSequence
from terminal_collectors.okx.rest import (
    UNKNOWN_INSTRUMENT,
    ClockSample,
    OkxError,
    OkxRest,
    best_sample,
)
from terminal_collectors.okx.ws import FeedState, OkxStream

from .bus import Bus

log = logging.getLogger(__name__)

CLOCK_EVERY_S = 60.0
CLOCK_SAMPLES = 5
# Au-delà, l'horloge de la machine (Mac ou tour) est jugée fausse (même seuil que drexbot) :
# les latences affichées ne veulent alors plus rien dire, et l'écran le dit.
CLOCK_MAX_DRIFT_MS = 5000.0
CHART_CACHE_S = 15.0
FEED_HEARTBEAT_S = 1.0
# Paramètres d'instrument illisibles (OKX ou réseau indisponible au démarrage) :
# nouvel essai après 2 s, puis délai doublé jusqu'à 5 min.
INSTRUMENTS_RETRY_MIN_S = 2.0
INSTRUMENTS_RETRY_MAX_S = 300.0

# Période du graphique -> (taille de bougie OKX, durée couverte).
# 1 J : journée UTC en cours en 1 min (≤ 1 440 bougies) ;
# 5 J : 5 jours en 5 min (1 440) ; 1 M : 30 jours en 1 h (720).
RANGES: dict[str, tuple[str, int, int]] = {
    "1D": ("1m", 60_000, 1),
    "5D": ("5m", 300_000, 5),
    "1M": ("1H", 3_600_000, 30),
}


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def utc_day_start(ms: int) -> int:
    d = datetime.fromtimestamp(ms / 1000, UTC)
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp() * 1000)


class OkxService:
    def __init__(self, bus: Bus, region: str, instruments: tuple[str, ...],
                 log_dir: Path) -> None:
        self.bus = bus
        self.region = region
        self.instruments = instruments
        self.ep = endpoints(region)
        self.rest = OkxRest(self.ep.rest)
        self.sequence = TradeSequence()
        self.gap_log = log_dir / "okx-gaps.jsonl"
        self.gap_count = 0
        self.instrument_meta: dict[str, dict] = {}
        # Dernière erreur de lecture par instrument (effacée à la réussite).
        self.instrument_errors: dict[str, str] = {}
        self.clock: ClockSample | None = None
        self._chart_cache: dict[tuple[str, str], tuple[float, dict]] = {}
        self._tasks: list[asyncio.Task] = []
        self.streams = [
            OkxStream("okx-public", self.ep.ws_public,
                      [{"channel": c, "instId": i} for i in instruments
                       for c in ("trades", "tickers", "funding-rate", "open-interest")],
                      self._on_events, self._on_state),
            OkxStream("okx-business", self.ep.ws_business,
                      [{"channel": "candle1m", "instId": i} for i in instruments],
                      self._on_events, self._on_state),
        ]

    # --- cycle de vie -------------------------------------------------------

    async def start(self) -> None:
        self.bus.publish("gateway:meta", {"source": f"Données réelles · OKX {self.region.upper()}",
                                          "region": self.region})
        missing = await self._load_instruments(self.instruments)
        self._tasks = [asyncio.create_task(s.run(), name=s.name) for s in self.streams]
        if missing:
            self._tasks.append(asyncio.create_task(self._instruments_retry(missing),
                                                   name="okx-instruments"))
        self._tasks.append(asyncio.create_task(self._clock_loop(), name="okx-clock"))
        self._tasks.append(asyncio.create_task(self._feed_heartbeat(), name="okx-feeds"))

    async def stop(self) -> None:
        for s in self.streams:
            s.stop()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.rest.aclose()

    # --- paramètres d'instrument --------------------------------------------

    async def _load_instruments(self, insts: list[str] | tuple[str, ...]) -> list[str]:
        """Lit les paramètres de chaque instrument ; rend ceux à redemander.

        Un instrument qu'OKX déclare inexistant (51001) n'est pas redemandé :
        l'erreur reste visible dans /api/health.
        """
        retry: list[str] = []
        for inst in insts:
            try:
                meta = await self.rest.instrument(inst)
            except Exception as exc:
                self.instrument_errors[inst] = str(exc)
                unknown = isinstance(exc, OkxError) and exc.code == UNKNOWN_INSTRUMENT
                log.error("paramètres de %s illisibles : %s%s", inst, exc,
                          "" if unknown else " ; nouvel essai prévu")
                if not unknown:
                    retry.append(inst)
                continue
            self.instrument_meta[inst] = meta
            self.instrument_errors.pop(inst, None)
            self.bus.publish(f"instrument:{inst}", meta)
        return retry

    async def _instruments_retry(self, missing: list[str]) -> None:
        delay = INSTRUMENTS_RETRY_MIN_S
        while missing:
            await asyncio.sleep(delay)
            missing = await self._load_instruments(missing)
            delay = min(delay * 2, INSTRUMENTS_RETRY_MAX_S)

    # --- flux ---------------------------------------------------------------

    def _on_events(self, events: list[dict]) -> None:
        for ev in events:
            kind, inst = ev["kind"], ev["inst"]
            if kind == "trade":
                gap = self.sequence.check(ev)
                if gap:
                    self._record_gap(gap.describe(), gap.__dict__)
                self.bus.publish(f"trade:{inst}", ev)
            elif kind == "ticker":
                self.bus.publish(f"ticker:{inst}", ev)
            elif kind == "funding":
                self.bus.publish(f"funding:{inst}", ev)
            elif kind == "open_interest":
                self.bus.publish(f"oi:{inst}", ev)
            elif kind == "candle":
                key = f"candle:{ev['bar']}:{inst}"
                self.bus.publish(key, ev, conflate_key=f"{key}:{ev['t']}")

    def _on_state(self, state: FeedState) -> None:
        self.bus.publish(f"feed:{state.name}", state.snapshot())

    async def _feed_heartbeat(self) -> None:
        """Republie l'état des flux chaque seconde : l'écran juge la fraîcheur
        sur `last_message_ms`, qui avance à chaque message reçu."""
        while True:
            for s in self.streams:
                self._on_state(s.state)
            await asyncio.sleep(FEED_HEARTBEAT_S)

    def _record_gap(self, text: str, data: dict) -> None:
        self.gap_count += 1
        log.warning("trou de séquence : %s", text)
        self.gap_log.parent.mkdir(parents=True, exist_ok=True)
        with self.gap_log.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts_recv": now_ms(), "text": text, **data}) + "\n")
        self.bus.publish("gaps:okx", {"count": self.gap_count, "last": text,
                                      "ts_recv": now_ms()})

    # --- horloge ------------------------------------------------------------

    async def _clock_loop(self) -> None:
        while True:
            samples = []
            for _ in range(CLOCK_SAMPLES):
                try:
                    samples.append(await self.rest.clock_sample())
                except Exception as exc:
                    log.warning("heure OKX indisponible : %s", exc)
                await asyncio.sleep(0.2)
            best = best_sample(samples)
            if best:
                self.clock = best
                ok = abs(best.offset_ms) <= CLOCK_MAX_DRIFT_MS
                if not ok:
                    log.error("horloge de la machine décalée de %.0f ms par rapport à OKX",
                              best.offset_ms)
                self.bus.publish("clock:okx", {
                    "offset_ms": round(best.offset_ms, 1),
                    "uncertainty_ms": round(best.rtt_ms / 2, 1),
                    "ok": ok, "ts_recv": now_ms()})
            await asyncio.sleep(CLOCK_EVERY_S)

    # --- graphique ----------------------------------------------------------

    async def chart(self, inst: str, range_: str) -> dict:
        if inst not in self.instruments:
            raise KeyError(f"instrument non suivi : {inst}")
        if range_ not in RANGES:
            raise KeyError(f"période inconnue : {range_}")
        cached = self._chart_cache.get((inst, range_))
        if cached and time.monotonic() - cached[0] < CHART_CACHE_S:
            return cached[1]
        bar, bar_ms, days = RANGES[range_]
        today = utc_day_start(now_ms())
        start = today - (days - 1) * 86_400_000
        end = today + 86_400_000
        candles = await self.rest.candles(inst, bar, since_ms=start)
        daily = await self.rest.candles(inst, "1Dutc", since_ms=today - 86_400_000,
                                        max_count=2)
        prev = next((c for c in daily if c["t"] == today - 86_400_000), None)
        result = {
            "inst": inst, "range": range_, "bar": bar, "bar_ms": bar_ms,
            "from_ms": start, "to_ms": end,
            "candles": [{k: c[k] for k in ("t", "o", "h", "l", "c", "vol_base", "vol_quote")}
                        for c in candles],
            "prev_day": ({"t": prev["t"], "h": prev["h"], "l": prev["l"],
                          "confirmed": prev["confirmed"]} if prev else None),
            "source": f"OKX {self.region.upper()} REST",
            "ts_recv": now_ms(),
        }
        self._chart_cache[(inst, range_)] = (time.monotonic(), result)
        return result

    def health(self) -> dict:
        return {
            "region": self.region,
            "instruments": self.instrument_meta,
            "instrument_errors": self.instrument_errors,
            "feeds": [s.state.snapshot() for s in self.streams],
            "trade_gaps": self.gap_count,
            "clock": self.bus.get("clock:okx"),
        }

