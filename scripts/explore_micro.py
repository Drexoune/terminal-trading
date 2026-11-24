"""Exploration des flux de P5 (microstructure BTC), à lancer sur le Mac (plan P5, étape S0, T-065).

    .venv/bin/python scripts/explore_micro.py [--seconds 40] [--only okx,binance,bybit,hyperliquid,coinbase,rest]

Lecture seule, données publiques, aucune clé. Pendant `--seconds`, en parallèle :

- WebSockets publiques : OKX EEA (carnet `books`, trades swap et spot, liquidations, funding, OI),
  Binance USDⓈ-M (diff de carnet, aggTrade, forceOrder, markPrice) et spot (aggTrade), Bybit
  linéaire (carnet 1000, trades, tickers, allLiquidation), Hyperliquid (l2Book, trades,
  activeAssetCtx), Coinbase Exchange (matches, heartbeat).
  Pour chaque canal : nombre de messages, débit, premiers messages bruts, erreurs d'abonnement.
- REST : profondeur maximale de chaque carnet (écart en $ et en % couvert de part et d'autre du
  milieu), bougies 1 min avec volume preneur (Binance spot et perp), volume preneur d'OKX
  (rubik, 5 min), historique des liquidations d'OKX, historique d'OI (Binance, Bybit, OKX),
  funding et OI instantanés (Hyperliquid metaAndAssetCtxs), en-tête CORS de chaque réponse.

Sortie : data/explore/micro/<date>_probe/ (messages bruts par canal, rest/*.json, summary.json).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import certifi
import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]
UA = "TERMINAL/0.1 (terminal personnel, exploration en lecture seule)"
ORIGIN = "https://terminal-trading-steel.vercel.app"
KEEP = 40  # messages bruts gardés par canal
SSL = ssl.create_default_context(cafile=certifi.where())


class Probe:
    def __init__(self, out: Path, seconds: int):
        self.out, self.seconds = out, seconds
        self.counts: dict[str, int] = defaultdict(int)
        self.first: dict[str, float] = {}
        self.samples: dict[str, list] = defaultdict(list)
        self.notes: dict[str, list[str]] = defaultdict(list)
        self.rest: dict[str, dict] = {}

    def msg(self, chan: str, raw) -> None:
        self.counts[chan] += 1
        self.first.setdefault(chan, time.time())
        if len(self.samples[chan]) < KEEP:
            self.samples[chan].append(raw)

    def note(self, venue: str, text: str) -> None:
        self.notes[venue].append(text)
        print(f"  [{venue}] {text}")


async def ws_run(p: Probe, venue: str, url: str, subs: list, classify, ping=None, ping_every=20.0) -> None:
    """Connexion, abonnements, comptage par canal pendant p.seconds."""
    t_end = time.time() + p.seconds
    try:
        async with websockets.connect(url, ssl=SSL, open_timeout=10, max_size=2**24,
                                      additional_headers={"User-Agent": UA, "Origin": ORIGIN}) as ws:
            p.note(venue, f"connecté à {url}")
            for s in subs:
                await ws.send(json.dumps(s) if not isinstance(s, str) else s)
            last_ping = time.time()
            while time.time() < t_end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                except TimeoutError:
                    raw = None
                if ping and time.time() - last_ping > ping_every:
                    await ws.send(ping)
                    last_ping = time.time()
                if raw is None:
                    continue
                try:
                    data = json.loads(raw)
                except ValueError:
                    p.msg(f"{venue}:text", raw)
                    continue
                p.msg(f"{venue}:{classify(data)}", data)
    except Exception as e:  # noqa: BLE001 - l'exploration consigne tout
        p.note(venue, f"ERREUR {type(e).__name__}: {e}")


# --- Classements par plateforme --------------------------------------------------------------------

def okx_class(d):
    if "event" in d:
        return f"event:{d['event']}:{d.get('arg', {}).get('channel', '')}:{d.get('code', '')}"
    a = d.get("arg", {})
    return f"{a.get('channel')}:{a.get('instId') or a.get('instType')}:{d.get('action', '')}"


def binance_class(d):
    if "stream" in d:
        return d["stream"]
    return f"ctl:{json.dumps(d)[:60]}"


def bybit_class(d):
    if "topic" in d:
        return f"{d['topic']}:{d.get('type', '')}"
    return f"ctl:{d.get('op')}:{d.get('success')}:{d.get('ret_msg', '')}"


def hl_class(d):
    return f"{d.get('channel')}"


def cb_class(d):
    return f"{d.get('type')}"


async def okx(p: Probe):
    subs = [{"op": "subscribe", "args": [
        {"channel": "books", "instId": "BTC-USDT-SWAP"},
        {"channel": "trades", "instId": "BTC-USDT-SWAP"},
        {"channel": "trades", "instId": "BTC-USDT"},
        {"channel": "liquidation-orders", "instType": "SWAP"},
        {"channel": "funding-rate", "instId": "BTC-USDT-SWAP"},
        {"channel": "open-interest", "instId": "BTC-USDT-SWAP"},
        {"channel": "mark-price", "instId": "BTC-USDT-SWAP"},
        {"channel": "index-tickers", "instId": "BTC-USDT"},
    ]}]
    await ws_run(p, "okx", "wss://wseea.okx.com/ws/v5/public", subs, okx_class, ping="ping")


async def binance(p: Probe):
    # USDⓈ-M : chemins routés depuis 2026 (« Important WebSocket Change Notice ») ; l'ancienne URL
    # sans chemin ne reçoit plus que /public (carnet).
    public = "wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms"
    market = "wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder/btcusdt@markPrice@1s/!forceOrder@arr"
    spot = "wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade"
    await asyncio.gather(ws_run(p, "binance", public, [], binance_class), ws_run(p, "binance-market", market, [], binance_class),
                         ws_run(p, "binance-spot", spot, [], binance_class))


async def bybit(p: Probe):
    subs = [{"op": "subscribe", "args": ["orderbook.1000.BTCUSDT", "publicTrade.BTCUSDT", "tickers.BTCUSDT", "allLiquidation.BTCUSDT", "allLiquidation.ETHUSDT",
                                     "allLiquidation.SOLUSDT", "allLiquidation.XRPUSDT", "allLiquidation.DOGEUSDT"]}]
    await ws_run(p, "bybit", "wss://stream.bybit.com/v5/public/linear", subs, bybit_class, ping=json.dumps({"op": "ping"}))


async def hyperliquid(p: Probe):
    subs = [{"method": "subscribe", "subscription": s} for s in (
        {"type": "l2Book", "coin": "BTC"}, {"type": "l2Book", "coin": "BTC", "nSigFigs": 4},
        {"type": "trades", "coin": "BTC"}, {"type": "activeAssetCtx", "coin": "BTC"})]
    await ws_run(p, "hyperliquid", "wss://api.hyperliquid.xyz/ws", subs, hl_class, ping=json.dumps({"method": "ping"}), ping_every=30)


async def coinbase(p: Probe):
    subs = [{"type": "subscribe", "product_ids": ["BTC-USD"], "channels": ["matches", "heartbeat", "ticker"]}]
    await ws_run(p, "coinbase", "wss://ws-feed.exchange.coinbase.com", subs, cb_class)


# --- REST ------------------------------------------------------------------------------------------

def span(bids, asks):
    """Milieu, écart couvert de part et d'autre, nombre de niveaux."""
    if not bids or not asks:
        return None
    bb, ba = float(bids[0][0]), float(asks[0][0])
    mid = (bb + ba) / 2
    lo, hi = float(bids[-1][0]), float(asks[-1][0])
    return {"mid": round(mid, 1), "levels_bid": len(bids), "levels_ask": len(asks), "down_usd": round(mid - lo, 1), "up_usd": round(hi - mid, 1),
            "down_pct": round((mid - lo) / mid * 100, 3), "up_pct": round((hi - mid) / mid * 100, 3)}


REST = [
    ("okx-books-full", "GET", "https://eea.okx.com/api/v5/market/books-full?instId=BTC-USDT-SWAP&sz=5000", None,
     lambda d: span(d["data"][0]["bids"], d["data"][0]["asks"])),
    ("okx-books-400", "GET", "https://eea.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=400", None,
     lambda d: span(d["data"][0]["bids"], d["data"][0]["asks"])),
    ("binance-perp-depth-1000", "GET", "https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000", None, lambda d: span(d["bids"], d["asks"])),
    ("bybit-orderbook-1000", "GET", "https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=1000", None,
     lambda d: span(d["result"]["b"], d["result"]["a"])),
    ("hl-l2book", "POST", "https://api.hyperliquid.xyz/info", {"type": "l2Book", "coin": "BTC"},
     lambda d: span([[x["px"]] for x in d["levels"][0]], [[x["px"]] for x in d["levels"][1]])),
    ("hl-l2book-sig4", "POST", "https://api.hyperliquid.xyz/info", {"type": "l2Book", "coin": "BTC", "nSigFigs": 4},
     lambda d: span([[x["px"]] for x in d["levels"][0]], [[x["px"]] for x in d["levels"][1]])),
    ("hl-l2book-sig3", "POST", "https://api.hyperliquid.xyz/info", {"type": "l2Book", "coin": "BTC", "nSigFigs": 3},
     lambda d: span([[x["px"]] for x in d["levels"][0]], [[x["px"]] for x in d["levels"][1]])),
    ("binance-perp-klines-1m", "GET", "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=240", None,
     lambda d: {"n": len(d), "fields": len(d[0]), "taker_buy_base_idx9": d[-1][9], "volume_idx5": d[-1][5], "first": d[0][0], "last": d[-1][0]}),
    ("binance-spot-klines-1m", "GET", "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=240", None,
     lambda d: {"n": len(d), "taker_buy_base_idx9": d[-1][9], "volume_idx5": d[-1][5]}),
    ("okx-taker-volume-contracts", "GET", "https://eea.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=CONTRACTS&period=5m", None,
     lambda d: {"n": len(d["data"]), "row": d["data"][0], "last_ts": d["data"][-1][0]}),
    ("okx-taker-volume-spot", "GET", "https://eea.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=SPOT&period=5m", None,
     lambda d: {"n": len(d["data"]), "row": d["data"][0]}),
    ("okx-liq-eea-uly", "GET", "https://eea.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled", None,
     lambda d: {"n": len(d["data"]), "details": len(d["data"][0]["details"]) if d["data"] else 0}),
    ("okx-liq-eea-family", "GET", "https://eea.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled", None,
     lambda d: {"n": len(d["data"]), "details": len(d["data"][0]["details"]) if d["data"] else 0,
                "oldest": d["data"][0]["details"][-1]["ts"] if d["data"] and d["data"][0]["details"] else None}),
    ("okx-liq-www-family", "GET", "https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled", None,
     lambda d: {"n": len(d["data"]), "details": len(d["data"][0]["details"]) if d["data"] else 0,
                "oldest": d["data"][0]["details"][-1]["ts"] if d["data"] and d["data"][0]["details"] else None}),
    ("okx-oi-volume", "GET", "https://eea.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=5m", None,
     lambda d: {"n": len(d["data"]), "row": d["data"][0]}),
    ("okx-oi-history", "GET", "https://eea.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=5m&limit=300", None,
     lambda d: {"n": len(d["data"]), "row": d["data"][0] if d["data"] else None}),
    ("binance-oi-hist-5m", "GET", "https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=300", None,
     lambda d: {"n": len(d), "row": d[-1]}),
    ("binance-oi", "GET", "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", None, lambda d: d),
    ("binance-premium", "GET", "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", None, lambda d: d),
    ("binance-funding-info", "GET", "https://fapi.binance.com/fapi/v1/fundingInfo", None,
     lambda d: [x for x in d if x.get("symbol") == "BTCUSDT"] or "BTCUSDT absent (intervalle par défaut 8 h)"),
    ("bybit-oi-hist", "GET", "https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=200", None,
     lambda d: {"n": len(d["result"]["list"]), "row": d["result"]["list"][0]}),
    ("bybit-tickers", "GET", "https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", None, lambda d: d["result"]["list"][0]),
    ("bybit-kline-1m", "GET", "https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1&limit=3", None,
     lambda d: {"row": d["result"]["list"][0], "note": "start, open, high, low, close, volume, turnover : pas de volume preneur"}),
    ("hl-meta-ctxs", "POST", "https://api.hyperliquid.xyz/info", {"type": "metaAndAssetCtxs"},
     lambda d: {"btc_meta": next(m for m in d[0]["universe"] if m["name"] == "BTC"), "btc_ctx": d[1][[m["name"] for m in d[0]["universe"]].index("BTC")]}),
    ("hl-funding-history", "POST", "https://api.hyperliquid.xyz/info", {"type": "fundingHistory", "coin": "BTC", "startTime": int(time.time() * 1000) - 6 * 3600_000},
     lambda d: {"n": len(d), "last": d[-1] if d else None}),
    ("coinbase-candles", "GET", "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", None,
     lambda d: {"n": len(d), "row": d[0], "note": "time, low, high, open, close, volume : pas de volume preneur"}),
    ("coinbase-trades", "GET", "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=5", None, lambda d: d[:2]),
]


async def rest(p: Probe):
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": UA, "Origin": ORIGIN}) as c:
        for name, method, url, body, summarize in REST:
            t0 = time.time()
            try:
                r = await (c.post(url, json=body) if method == "POST" else c.get(url))
                ms = round((time.time() - t0) * 1000)
                entry = {"url": url, "status": r.status_code, "ms": ms, "bytes": len(r.content),
                         "cors": r.headers.get("access-control-allow-origin")}
                try:
                    d = r.json()
                    (p.out / "rest").mkdir(parents=True, exist_ok=True)
                    (p.out / "rest" / f"{name}.json").write_text(json.dumps(d)[:2_000_000])
                    entry["summary"] = summarize(d)
                except Exception as e:  # noqa: BLE001
                    entry["summary_error"] = f"{type(e).__name__}: {e}"[:300]
                    entry["head"] = r.text[:300]
            except Exception as e:  # noqa: BLE001
                entry = {"url": url, "error": f"{type(e).__name__}: {e}"[:300]}
            p.rest[name] = entry
            print(f"  [rest] {name}: {entry.get('status', entry.get('error'))} cors={entry.get('cors')} {json.dumps(entry.get('summary', entry.get('summary_error', '')))[:160]}")
            await asyncio.sleep(0.2)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=int, default=40)
    ap.add_argument("--only", default="okx,binance,bybit,hyperliquid,coinbase,rest")
    a = ap.parse_args()
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ")
    out = ROOT / "data" / "explore" / "micro" / f"{stamp}_probe"
    out.mkdir(parents=True, exist_ok=True)
    p = Probe(out, a.seconds)
    jobs = {"okx": okx, "binance": binance, "bybit": bybit, "hyperliquid": hyperliquid, "coinbase": coinbase, "rest": rest}
    t0 = time.time()
    await asyncio.gather(*(jobs[k](p) for k in a.only.split(",")))
    dur = time.time() - t0
    (out / "ws").mkdir(exist_ok=True)
    for chan, s in p.samples.items():
        (out / "ws" / f"{chan.replace(':', '__').replace('/', '_').replace('@', '-')[:120]}.json").write_text(json.dumps(s))
    summary = {
        "at": stamp, "seconds": a.seconds,
        "ws": {c: {"messages": n, "per_s": round(n / max(1.0, dur), 2)} for c, n in sorted(p.counts.items())},
        "notes": p.notes, "rest": p.rest,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    print(f"\n{out.relative_to(ROOT)}/summary.json")
    for c, v in summary["ws"].items():
        print(f"  {c:70s} {v['messages']:6d}  {v['per_s']:7.2f}/s")


if __name__ == "__main__":
    asyncio.run(main())
