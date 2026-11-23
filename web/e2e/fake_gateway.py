"""Passerelle de démonstration pour les tests Playwright : jeu de la maquette Main.

Sert le même protocole que la vraie passerelle (même application FastAPI) avec
un service simulé, et une horloge figée au départ sur l'instant de la maquette
(20/10/2026 13:36:04 UTC) puis qui avance normalement. Rien ici n'est utilisé
par l'application : c'est un outil de test.

    python e2e/fake_gateway.py --port 8790
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import tempfile
import time
from datetime import datetime
from pathlib import Path

import terminal_gateway.app as gw_app
import uvicorn
from terminal_gateway.bus import Bus
from terminal_gateway.config import Settings

FIX = json.loads((Path(__file__).parent / "fixtures" / "main-demo.json").read_text())
CAL = json.loads((Path(__file__).parent / "fixtures" / "calendar-demo.json").read_text())
START = int(datetime.fromisoformat(FIX["now"].replace("Z", "+00:00")).timestamp() * 1000)
DELTA = START - time.time_ns() // 1_000_000


def now_ms() -> int:
    return time.time_ns() // 1_000_000 + DELTA


gw_app.now_ms = now_ms  # toute la passerelle de démo vit à l'heure de la maquette

DAY = 86_400_000


def demo_candles(day_start: int, until: int, bar_ms: int) -> list[dict]:
    """Forme de la maquette : creux vers 05:00 UTC, montée jusqu'au dernier prix."""
    b = FIX["btc"]
    out = []
    t = day_start
    n_total = (until - day_start) / bar_ms
    i = 0
    while t <= until:
        x = i / max(n_total, 1)
        dip = -(b["day_open"] - b["day_low"]) * math.sin(min(x / 0.55, 1) * math.pi)
        trend = (b["last"] - b["day_open"]) * max(0.0, (x - 0.3) / 0.7) ** 1.6
        wiggle = 40 * math.sin(i / 7) + 25 * math.sin(i / 2.3)
        c = b["day_open"] + dip + trend + wiggle
        if t + bar_ms > until:
            c = b["last"]
        vol = 20 + 10 * math.sin(i / 11) ** 2
        out.append({"t": t, "o": c, "h": c + 15, "l": c - 15, "c": c,
                    "vol_base": vol, "vol_quote": vol * (c - 5)})
        t += bar_ms
        i += 1
    return out


class DemoService:
    def __init__(self, bus: Bus) -> None:
        self.bus = bus
        self._task: asyncio.Task | None = None
        self._trade_id = 1000

    async def start(self) -> None:
        now = now_ms()
        self.bus.publish("gateway:meta", {"source": "Démo · tests", "region": "demo"})
        b, e = FIX["btc"], FIX["eth"]
        for inst, last, ch, tick in (("BTC-USDT-SWAP", b["last"], b["change24h"], 0.1),
                                     ("ETH-USDT-SWAP", e["last"], e["change24h"], 0.01)):
            open24 = last / (1 + ch)
            self.bus.publish(f"instrument:{inst}", {"inst": inst, "ct_val": 0.01,
                                                     "ct_val_ccy": "BTC", "tick_sz": tick,
                                                     "lot_sz": 0.01})
            self.bus.publish(f"ticker:{inst}", {
                "kind": "ticker", "inst": inst, "last": last, "bid": last, "ask": last,
                "open24h": open24,
                "high24h": b["high24h"] if inst.startswith("BTC") else last * 1.01,
                "low24h": b["low24h"] if inst.startswith("BTC") else open24 * 0.99,
                "sod_utc0": open24, "vol_base24h": b["vol_base24h"],
                "ts_source": now, "ts_recv": now})
        self.bus.publish("funding:BTC-USDT-SWAP", {
            "kind": "funding", "inst": "BTC-USDT-SWAP", "rate": b["funding"],
            "funding_time": now + 2 * 3_600_000, "prev_funding_time": now - 6 * 3_600_000,
            "interval_ms": 8 * 3_600_000, "ts_source": now, "ts_recv": now})
        self.bus.publish("oi:BTC-USDT-SWAP", {"kind": "open_interest", "inst": "BTC-USDT-SWAP",
                                              "oi_base": 287000, "oi_usd": b["oi_usd"],
                                              "ts_source": now, "ts_recv": now})
        self.bus.publish("clock:okx", {"offset_ms": 3.0, "uncertainty_ms": 9.0, "ok": True,
                                       "ts_recv": now})
        # Agenda de démonstration (maquette Calendrier) : semaine, prochains événements, flux.
        stamp = {"source_ts_ms": now - 600_000, "received_ms": now - 120_000}
        week = {**CAL["week"], "forexfactory": stamp}
        self.bus.publish(f"calendar:week:{week['week']}", week)
        upcoming = [e for e in week["events"]
                    if e["time_ms"] > now and e["impact"] in ("High", "Medium")]
        self.bus.publish("calendar:next", {"events": upcoming[:5], "computed_ms": now,
                                           "week": week["week"], "forexfactory": stamp})
        self.bus.publish("feed:calendar", {
            "name": "calendar", "label": "Calendrier", "status": "connected",
            "connected_since_ms": now - 3_600_000, "last_message_ms": now - 120_000,
            "reconnects": 0, "outages": [], "last_error": None,
            "late_after_ms": 75 * 60_000, "stale_after_ms": 3 * 3_600_000})
        self._task = asyncio.create_task(self._tick())

    async def _tick(self) -> None:
        lat = FIX["latency_ms"]
        while True:
            now = now_ms()
            for name in ("okx-public", "okx-business"):
                self.bus.publish(f"feed:{name}", {"name": name, "status": "connected",
                                                  "connected_since_ms": START - 60_000,
                                                  "last_message_ms": now, "reconnects": 0,
                                                  "outages": [], "last_error": None})
            for key in ("ticker:BTC-USDT-SWAP", "ticker:ETH-USDT-SWAP"):
                t = dict(self.bus.get(key))
                t["ts_source"], t["ts_recv"] = now - lat + 25, now
                self.bus.publish(key, t)
            self._trade_id += 1
            self.bus.publish("trade:BTC-USDT-SWAP", {
                "kind": "trade", "inst": "BTC-USDT-SWAP", "trade_id": self._trade_id, "count": 1,
                "px": FIX["btc"]["last"], "sz": 1.0, "side": "buy",
                # trajet total ≈ latency_ms : OKX -> passerelle (lat - 25) + passerelle -> écran
                "ts_source": now - lat + 25, "ts_recv": now})
            await asyncio.sleep(0.25)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def chart(self, inst: str, range_: str) -> dict:
        bar, bar_ms, days = {"1D": ("1m", 60_000, 1), "5D": ("5m", 300_000, 5),
                             "1M": ("1H", 3_600_000, 30)}[range_]
        today = START // DAY * DAY
        start = today - (days - 1) * DAY
        candles = demo_candles(start, START // bar_ms * bar_ms, bar_ms)
        if not inst.startswith("BTC"):
            k = FIX["eth"]["last"] / FIX["btc"]["last"]
            candles = [{**c, **{f: c[f] * k for f in ("o", "h", "l", "c")}} for c in candles]
        return {"inst": inst, "range": range_, "bar": bar, "bar_ms": bar_ms,
                "from_ms": start, "to_ms": today + DAY, "candles": candles,
                "prev_day": {"t": today - DAY, "h": FIX["btc"]["prev_day_high"],
                             "l": FIX["btc"]["prev_day_low"], "confirmed": True},
                "source": "DÉMO (tests)", "ts_recv": now_ms()}

    def health(self) -> dict:
        return {"demo": True, "feeds": []}


class DemoRelease:
    """Service « release » de démonstration (E3) : publie un chiffre capté quand le test
    le demande (POST /test/release) et garde l'heure d'affichage renvoyée par le front."""

    name = "release"

    def __init__(self, bus: Bus) -> None:
        self.bus = bus
        self.displays: dict[str, int] = {}
        self.bus_ms: int | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None: ...

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def health(self) -> dict:
        return {"demo": True}

    def schedule(self, delay_ms: int) -> int:
        t = now_ms() + delay_ms
        self._task = asyncio.create_task(self._publish_at(t))
        return t

    async def _publish_at(self, t: int) -> None:
        await asyncio.sleep(max(0, t - now_ms()) / 1000)
        self.bus_ms = now_ms()
        fig = {"indicator": "us-prod-qq", "label_fr": "Productivité non agricole (t/t)",
               "unit": "%", "release": "prod2", "period": "2026-Q3", "edition": "Revised",
               "ny_date": "2026-10-20",
               "value": "4.1", "reason": None, "part": "texte",
               "excerpt": "Nonfarm business sector labor productivity increased 4.1 percent",
               "flags": [], "timing": "attendue", "nature": "officielle", "source": "BLS",
               "url": "https://www.bls.gov/news.release/prod2.nr0.htm", "machine": "démo",
               "scheduled_ms": t, "embargo_ms": t, "first_byte_ms": t + 900,
               "received_ms": t + 950, "capture_delay_ms": 903, "clock_corrected": True,
               "bus_ms": self.bus_ms, "forecast": "4.0", "forecast_raw": "4.0%",
               "forecast_age_ms": 2_700_000, "surprise": "0.1", "z": None, "z_n": 0,
               "z_provisional": False, "z_reason": "historique insuffisant (0/8)",
               "regular": True, "display_ms": None}
        key = "release:us-prod-qq:2026-Q3:Revised"
        self.bus.publish(key, fig)
        self.bus.publish("release:last", {
            "release": "prod2", "title": "Productivity and Costs", "period": "2026-Q3",
            "edition": "Revised", "ny_date": "2026-10-20", "keys": [key], "timing": "attendue",
            "scheduled_ms": t, "bus_ms": self.bus_ms})

    async def record_display(self, key: str, display_ms: object) -> bool:
        if isinstance(display_ms, (int, float)) and key not in self.displays:
            self.displays[key] = int(display_ms)
            return True
        return False

    def clear(self) -> None:
        for k in self.bus.keys("release:"):
            self.bus.delete(k)
        self.displays.clear()
        self.bus_ms = None


def demo_reaction(bus: Bus) -> None:
    """Réaction du BTC de démonstration (E3) : l'événement « Chicago Fed » du 19/10 devient
    une publication suivie, avec un chiffre révisé et une baisse du BTC dans les 30 minutes.
    Données fictives, routes de test seulement ; DELETE /test/reaction rétablit la semaine."""
    week = json.loads(json.dumps(CAL["week"]))
    ev = next(e for e in week["events"] if e["id"].startswith("demo-2|"))
    ev.update(indicator="us-cpi-yy", capture=True, title_fr="IPC (sur un an)")
    t = ev["time_ms"]
    bus.publish(f"calendar:week:{week['week']}", {**week, "forexfactory": {
        "source_ts_ms": now_ms() - 600_000, "received_ms": now_ms() - 120_000}})
    bus.publish("release:us-cpi-yy:2026-09", {
        "indicator": "us-cpi-yy", "label_fr": "IPC (sur un an)", "unit": "%", "release": "cpi",
        "period": "2026-09", "edition": "", "ny_date": ev["ny_date"], "value": "3.7",
        "reason": None, "part": "tableau A", "excerpt": "All items … 3.7", "flags": [],
        "timing": "attendue", "nature": "officielle", "source": "BLS",
        "url": "https://www.bls.gov/news.release/cpi.nr0.htm", "machine": "démo",
        "scheduled_ms": t, "embargo_ms": t, "first_byte_ms": t + 900, "received_ms": t + 950,
        "capture_delay_ms": 903, "clock_corrected": True, "bus_ms": t + 960, "forecast": "3.6",
        "forecast_raw": "3.6%", "forecast_age_ms": 2_700_000, "surprise": "0.1", "z": None,
        "z_n": 0, "z_provisional": False, "z_reason": "historique insuffisant (0/8)",
        "regular": True, "display_ms": None,
        "revisions": [{"kind": "révision", "previous": "3.7", "value": "3.8",
                       "source": "BLS API v1", "series": "CUUR0000SA0", "excerpt": None,
                       "seen_ms": t + 3_600_000}]})
    price = [67_420, 67_431, 67_409, 67_415, 67_428, 67_402, 66_980, 66_870, 66_905, 66_940,
             66_910, 66_885, 66_860, 66_880, 66_850, 66_830, 66_845, 66_820, 66_800, 66_815,
             66_790, 66_805, 66_780, 66_770, 66_790, 66_760, 66_775, 66_750, 66_765, 66_740,
             66_755, 66_730, 66_745, 66_720, 66_800]
    candles = [{"t": t - 300_000 + i * 60_000, "o": p, "h": p + 8, "l": p - 8, "c": p}
               for i, p in enumerate(price)]
    bus.publish(f"reaction:cpi:{ev['ny_date']}", {
        "release": "cpi", "title": "Consumer Price Index", "indicators": ["us-cpi-yy"],
        "ny_date": ev["ny_date"], "scheduled_ms": t, "inst": "BTC-USDT-SWAP",
        "source": "OKX DÉMO", "candles": candles, "ref_price": "67428",
        "end_price": "66800", "change_pct": "-0.93", "missing": [], "reason": None,
        "received_ms": t + 31 * 60_000})


def clear_reaction(bus: Bus) -> None:
    for k in bus.keys("reaction:"):
        bus.delete(k)
    bus.delete("release:us-cpi-yy:2026-09")
    week = CAL["week"]
    bus.publish(f"calendar:week:{week['week']}", {**week, "forexfactory": {
        "source_ts_ms": now_ms() - 600_000, "received_ms": now_ms() - 120_000}})


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8790)
    a = p.parse_args()
    settings = Settings(okx_region="demo", instruments=("BTC-USDT-SWAP",), host="127.0.0.1",
                        port=a.port, allowed_origins=("http://127.0.0.1:5174", "http://localhost:5174"),
                        log_dir=Path(tempfile.gettempdir()),
                        stop_file=Path(tempfile.gettempdir()) / "fake-gateway.stop")
    bus = Bus()
    release = DemoRelease(bus)
    app = gw_app.create_app(settings, services=[DemoService(bus), release], bus=bus)

    # Routes de test seulement (E3) : publier un chiffre, lire l'heure d'affichage, effacer.
    @app.post("/test/release")
    async def test_publish(delay_ms: int = 1000) -> dict:
        return {"at_ms": release.schedule(delay_ms)}

    @app.get("/test/release")
    async def test_state() -> dict:
        return {"bus_ms": release.bus_ms, "displays": release.displays}

    @app.delete("/test/release")
    async def test_clear() -> dict:
        release.clear()
        return {"ok": True}

    @app.post("/test/reaction")
    async def test_reaction() -> dict:
        demo_reaction(bus)
        return {"ok": True}

    @app.delete("/test/reaction")
    async def test_reaction_clear() -> dict:
        clear_reaction(bus)
        return {"ok": True}

    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
