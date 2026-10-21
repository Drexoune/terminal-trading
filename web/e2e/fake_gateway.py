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


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8790)
    a = p.parse_args()
    settings = Settings(okx_region="demo", instruments=("BTC-USDT-SWAP",), host="127.0.0.1",
                        port=a.port, allowed_origins=("http://127.0.0.1:5174", "http://localhost:5174"),
                        log_dir=Path(tempfile.gettempdir()),
                        stop_file=Path(tempfile.gettempdir()) / "fake-gateway.stop")
    bus = Bus()
    app = gw_app.create_app(settings, service=DemoService(bus), bus=bus)
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
