"""Fichier doré du parseur OKX : les sorties du parseur Python, figées.

Deux parseurs lisent les mêmes messages OKX : celui de la passerelle
(collectors/terminal_collectors/okx/parse.py, Modes Local et Tour) et son
portage dans le navigateur (web/src/data/okx/parse.ts, Mode Online). L'écran
doit recevoir exactement les mêmes valeurs dans les trois modes. Ce script
passe chaque message enregistré (collectors/tests/fixtures/ws_messages.json),
plus quelques cas limites écrits à la main, dans le parseur Python et écrit
le résultat dans collectors/tests/fixtures/parsed_golden.json :

- collectors/tests/test_golden.py vérifie que le fichier est à jour ;
- web/src/data/okx/parse.test.ts vérifie que parse.ts produit le même JSON.

    .venv/bin/python scripts/make_okx_golden.py           # réécrit le fichier doré
    .venv/bin/python scripts/make_okx_golden.py --check   # code 1 s'il n'est pas à jour

À relancer après toute modification de parse.py ou des messages enregistrés.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "collectors"))

from terminal_collectors.okx.parse import Control, parse  # noqa: E402

FIXTURES = ROOT / "collectors" / "tests" / "fixtures"
MESSAGES = FIXTURES / "ws_messages.json"
GOLDEN = FIXTURES / "parsed_golden.json"

# Cas limites absents de l'enregistrement : champs vides ou manquants, contrôles,
# canal inconnu. Ce sont eux qui départagent les conversions (chaîne vide -> null,
# `count` absent -> 1, période de funding sans échéance précédente…).
_TRADE = {"instId": "BTC-USDT-SWAP", "tradeId": "10", "px": "81408.5", "sz": "0.3",
          "side": "sell", "ts": "1792487342011"}
EXTRA: list[tuple[str, int, str]] = [
    ("pong", 1792487342000, "pong"),
    ("error", 1792487342000,
     json.dumps({"event": "error", "code": "60018", "msg": "Wrong URL or channel",
                 "connId": "a4d3ae55"})),
    ("notice", 1792487342000,
     json.dumps({"event": "notice", "code": "64008",
                 "msg": "The connection will soon be closed for a service upgrade.",
                 "connId": "a4d3ae55"})),
    ("trade sans count", 1792487342100,
     json.dumps({"arg": {"channel": "trades", "instId": "BTC-USDT-SWAP"}, "data": [_TRADE]})),
    ("trade count vide", 1792487342100,
     json.dumps({"arg": {"channel": "trades", "instId": "BTC-USDT-SWAP"},
                 "data": [{**_TRADE, "count": ""}]})),
    ("trade agrégé", 1792487342100,
     json.dumps({"arg": {"channel": "trades", "instId": "ETH-USDT-SWAP"},
                 "data": [{**_TRADE, "instId": "ETH-USDT-SWAP", "count": "3", "px": "4012"},
                          {**_TRADE, "instId": "ETH-USDT-SWAP", "tradeId": "11",
                           "side": "buy"}]})),
    ("ticker incomplet", 1792487342200,
     json.dumps({"arg": {"channel": "tickers", "instId": "BTC-USDT-SWAP"},
                 "data": [{"instId": "BTC-USDT-SWAP", "last": "81407.9", "bidPx": "",
                           "askPx": "", "high24h": "83067.4", "low24h": "81166",
                           "sodUtc0": "", "ts": "1792487342011"}]})),
    ("funding sans échéance précédente", 1792487342300,
     json.dumps({"arg": {"channel": "funding-rate", "instId": "BTC-USDT-SWAP"},
                 "data": [{"instId": "BTC-USDT-SWAP", "fundingRate": "-0.0000125",
                           "fundingTime": "1792512000000", "prevFundingTime": "",
                           "ts": "1792487340000"}]})),
    ("open interest sans dollars", 1792487342400,
     json.dumps({"arg": {"channel": "open-interest", "instId": "BTC-USDT-SWAP"},
                 "data": [{"instId": "BTC-USDT-SWAP", "oiCcy": "30495.2358", "oiUsd": "",
                           "ts": "1792487334785"}]})),
    ("bougies 5m, close puis suivante", 1792487400100,
     json.dumps({"arg": {"channel": "candle5m", "instId": "BTC-USDT-SWAP"},
                 "data": [["1792487100000", "81402.9", "81420", "81390.1", "81410",
                           "1200.5", "12.005", "977290.1", "1"],
                          ["1792487400000", "81410", "81410", "81410", "81410",
                           "0", "0", "0", "0"]]})),
    ("données vides", 1792487342500,
     json.dumps({"arg": {"channel": "trades", "instId": "BTC-USDT-SWAP"}, "data": []})),
    ("canal inconnu", 1792487342500,
     json.dumps({"arg": {"channel": "books5", "instId": "BTC-USDT-SWAP"},
                 "data": [{"asks": [], "bids": [], "ts": "1"}]})),
    ("message sans canal", 1792487342500, json.dumps({"op": "unknown"})),
]


def _result(out: list[dict] | Control) -> dict:
    if isinstance(out, Control):
        return {"control": {"event": out.event, "raw": out.raw}}
    return {"events": out}


def build() -> dict:
    """Contenu du fichier doré, recalculé depuis les messages et le parseur actuels."""
    recorded = json.loads(MESSAGES.read_text(encoding="utf-8"))
    cases = []
    for group, items in recorded.items():
        for index, item in enumerate(items):
            # Même chaîne que celle que verrait le parseur sur le fil : le message
            # enregistré, resérialisé. parse.ts la reçoit identique.
            raw = json.dumps(item["msg"])
            cases.append({"name": f"{group}#{index}", "recv_ms": item["recv_ms"], "raw": raw,
                          **_result(parse(raw, item["recv_ms"]))})
    for name, recv_ms, raw in EXTRA:
        cases.append({"name": name, "recv_ms": recv_ms, "raw": raw,
                      **_result(parse(raw, recv_ms))})
    return {
        "comment": ("Généré par scripts/make_okx_golden.py depuis ws_messages.json : "
                    "sorties de parse.py, que parse.ts doit reproduire à l'identique."),
        "cases": cases,
    }


def render(golden: dict) -> str:
    return json.dumps(golden, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="vérifie seulement que le fichier doré est à jour")
    args = ap.parse_args()
    golden = build()
    if args.check:
        current = json.loads(GOLDEN.read_text(encoding="utf-8")) if GOLDEN.exists() else None
        if current != golden:
            print(f"{GOLDEN.relative_to(ROOT)} n'est pas à jour : "
                  "relancer scripts/make_okx_golden.py", file=sys.stderr)
            return 1
        print(f"{GOLDEN.relative_to(ROOT)} à jour ({len(golden['cases'])} cas)")
        return 0
    GOLDEN.write_text(render(golden), encoding="utf-8")
    print(f"{GOLDEN.relative_to(ROOT)} écrit ({len(golden['cases'])} cas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
