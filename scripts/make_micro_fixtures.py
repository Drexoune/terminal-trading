"""Fixtures de P5 (microstructure) tirées des relevés de scripts/explore_micro.py (étape S0).

    .venv/bin/python scripts/make_micro_fixtures.py data/explore/micro/<relevé> [<relevé> …]

Écrit web/src/micro/fixtures/<plateforme>.json : messages bruts réels (texte exact reçu),
dans l'ordre de réception, en nombre réduit. Les relevés sont lus dans l'ordre donné ; le premier
qui contient un canal le fournit.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "src" / "micro" / "fixtures"

PICK = {
    "okx": [
        ("okx__books__BTC-USDT-SWAP__snapshot", 1),
        ("okx__books__BTC-USDT-SWAP__update", 20),
        ("okx__trades__BTC-USDT-SWAP__", 5),
        ("okx__trades__BTC-USDT__", 3),
        ("okx__liquidation-orders__SWAP__", 40),
        ("okx__funding-rate__BTC-USDT-SWAP__", 1),
        ("okx__open-interest__BTC-USDT-SWAP__", 1),
        ("okx__mark-price__BTC-USDT-SWAP__", 1),
        ("okx__index-tickers__BTC-USDT__", 1),
    ],
    "binance": [
        ("binance__btcusdt-depth-100ms", 5),
        ("binance-market__btcusdt-aggTrade", 5),
        ("binance-market__btcusdt-markPrice-1s", 1),
        ("binance-market__btcusdt-forceOrder", 10),
        ("binance-market__!forceOrder-arr", 5),
        ("binance-spot__btcusdt-aggTrade", 3),
    ],
    "bybit": [
        ("bybit__orderbook.1000.BTCUSDT__snapshot", 1),
        ("bybit__orderbook.1000.BTCUSDT__delta", 20),
        ("bybit__publicTrade.BTCUSDT__snapshot", 3),
        ("bybit__tickers.BTCUSDT__snapshot", 1),
        ("bybit__tickers.BTCUSDT__delta", 3),
        ("bybit__allLiquidation.BTCUSDT__snapshot", 10),
    ],
    "hyperliquid": [
        ("hyperliquid__l2Book", 8),
        ("hyperliquid__trades", 3),
        ("hyperliquid__activeAssetCtx", 1),
    ],
    "coinbase": [
        ("coinbase__subscriptions", 1),
        ("coinbase__last_match", 1),
        ("coinbase__match", 5),
        ("coinbase__heartbeat", 1),
    ],
}


def main() -> None:
    dirs = [Path(a) for a in sys.argv[1:]]
    OUT.mkdir(parents=True, exist_ok=True)
    for venue, picks in PICK.items():
        out: dict[str, list] = {}
        for name, n in picks:
            for d in dirs:
                f = d / "ws" / f"{name}.json"
                if f.exists():
                    out[name] = json.loads(f.read_text())[:n]
                    break
            else:
                out[name] = []
        (OUT / f"{venue}.json").write_text(json.dumps(out, separators=(",", ":")))
        print(venue, {k: len(v) for k, v in out.items()})


if __name__ == "__main__":
    main()
