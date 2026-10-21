"""Exploration des flux publics OKX : affiche et enregistre les réponses réelles.

Sert à vérifier, sur des messages observés et non sur des exemples de doc,
les champs, les unités et le comportement de chaque canal utilisé en P0.

    python scripts/explore_okx.py --region eea --seconds 40 --save

Avec --save, les messages bruts sont écrits dans collectors/tests/fixtures/,
où les tests d'analyse les relisent.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import time
from collections import defaultdict
from pathlib import Path

import httpx
import websockets

ENDPOINTS = {
    # Doc OKX, « Regional API Domain Requirement » : un compte ouvert sur
    # my.okx.com doit utiliser eea.okx.com (REST) et wseea.okx.com (WebSocket).
    "eea": ("https://eea.okx.com", "wss://wseea.okx.com/ws/v5"),
    "global": ("https://openapi.okx.com", "wss://ws.okx.com/ws/v5"),
}
FIXTURES = Path(__file__).resolve().parents[1] / "collectors" / "tests" / "fixtures"


def now_ms() -> int:
    return time.time_ns() // 1_000_000


async def rest(base: str, inst: str, save: bool) -> None:
    async with httpx.AsyncClient(base_url=base, timeout=10) as client:
        t0 = now_ms()
        r = await client.get("/api/v5/public/time")
        t1 = now_ms()
        server = int(r.json()["data"][0]["ts"])
        print(f"[time] serveur={server} local_milieu={(t0 + t1) // 2} "
              f"écart≈{server - (t0 + t1) // 2} ms aller-retour={t1 - t0} ms")

        r = await client.get("/api/v5/public/instruments",
                             params={"instType": "SWAP", "instId": inst})
        inst_doc = r.json()
        print("[instruments]", json.dumps(inst_doc["data"][0], ensure_ascii=False)[:600])

        r = await client.get("/api/v5/market/candles",
                             params={"instId": inst, "bar": "1m", "limit": "3"})
        candles = r.json()
        print("[candles 1m]", candles["data"])
        r = await client.get("/api/v5/market/candles",
                             params={"instId": inst, "bar": "1Dutc", "limit": "2"})
        daily = r.json()
        print("[candles 1Dutc]", daily["data"])
        print("[rate-limit headers]", {k: v for k, v in r.headers.items() if "limit" in k.lower()})
        if save:
            (FIXTURES / "rest_instruments.json").write_text(json.dumps(inst_doc, indent=1))
            (FIXTURES / "rest_candles_1m.json").write_text(json.dumps(candles, indent=1))
            (FIXTURES / "rest_candles_1dutc.json").write_text(json.dumps(daily, indent=1))


async def stream(url: str, args: list[dict], seconds: float, out: dict) -> None:
    async with websockets.connect(url, ping_interval=None) as ws:
        await ws.send(json.dumps({"id": "1", "op": "subscribe", "args": args}))
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=20)
            except TimeoutError:
                await ws.send("ping")
                continue
            recv = now_ms()
            if raw == "pong":
                continue
            msg = json.loads(raw)
            key = msg.get("arg", {}).get("channel", "?") + ":" + msg.get("event", "push")
            out[key].append({"recv_ms": recv, "msg": msg})


def report(out: dict) -> None:
    for key, items in sorted(out.items()):
        print(f"\n== {key} : {len(items)} messages")
        for item in items[:2]:
            print("  ", json.dumps(item["msg"], ensure_ascii=False)[:500])
        if key == "trades:push":
            ids = [(int(d["tradeId"]), int(d["count"]), int(d["ts"]), it["recv_ms"])
                   for it in items for d in it["msg"]["data"]]
            breaks = sum(1 for a, b in itertools.pairwise(ids) if b[0] - b[1] != a[0])
            lat = sorted(r - ts for _, _, ts, r in ids)
            print(f"   trades={len(ids)} ruptures tradeId(prev) != tradeId-count : {breaks}")
            if lat:
                print(f"   réception - ts OKX : médiane {lat[len(lat) // 2]} ms, "
                      f"min {lat[0]} ms, max {lat[-1]} ms")
        if key == "tickers:push":
            gaps = [b["recv_ms"] - a["recv_ms"] for a, b in itertools.pairwise(items)]
            if gaps:
                print(f"   intervalle entre tickers : max {max(gaps)} ms")


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--region", choices=ENDPOINTS, default="eea")
    p.add_argument("--inst", default="BTC-USDT-SWAP")
    p.add_argument("--seconds", type=float, default=30)
    p.add_argument("--save", action="store_true")
    a = p.parse_args()
    base, ws_base = ENDPOINTS[a.region]
    if a.save:
        FIXTURES.mkdir(parents=True, exist_ok=True)

    await rest(base, a.inst, a.save)
    out: dict[str, list] = defaultdict(list)
    public = [{"channel": c, "instId": a.inst}
              for c in ("trades", "tickers", "funding-rate", "open-interest")]
    business = [{"channel": "candle1m", "instId": a.inst}]
    await asyncio.gather(
        stream(f"{ws_base}/public", public, a.seconds, out),
        stream(f"{ws_base}/business", business, a.seconds, out),
    )
    report(out)
    if a.save:
        (FIXTURES / "ws_messages.json").write_text(
            json.dumps({k: v[:40] for k, v in out.items()}, indent=1))
        print(f"\nfixtures écrites dans {FIXTURES}")


if __name__ == "__main__":
    asyncio.run(main())
