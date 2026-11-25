"""Exploration de l'API publique de Deribit pour P7 (options BTC, étape S0, T-075).

    .venv/bin/python scripts/explore_p7_deribit.py

Lecture seule, sans clé. Affiche et enregistre les réponses réelles de :

- public/get_index_price (indice BTC de Deribit) ;
- public/get_volatility_index_data (DVOL, résolution 1 h sur 2 jours) ;
- public/get_book_summary_by_currency (toutes les options BTC : vol implicite, OI, volume) ;
- public/get_instruments (échéances et strikes actifs) ;
- public/ticker sur une option proche de la monnaie (greeks, vol bid/ask/mark) ;
- en-têtes de réponse (limites de débit éventuelles).

Sortie : data/explore/p7/<date>_deribit/*.json et un résumé à l'écran.
"""

from __future__ import annotations

import json
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import certifi
import httpx

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://www.deribit.com/api/v2/public"
UA = "TERMINAL/0.1 (terminal personnel, exploration en lecture seule)"


def get(client: httpx.Client, out: Path, name: str, method: str, **params) -> dict:
    t0 = time.perf_counter()
    r = client.get(f"{BASE}/{method}", params=params)
    ms = (time.perf_counter() - t0) * 1000
    body = r.json()
    (out / f"{name}.json").write_text(json.dumps(body, indent=1)[:2_000_000])
    limits = {k: v for k, v in r.headers.items() if "limit" in k.lower() or "rate" in k.lower()}
    size = len(r.content) / 1024
    print(f"[{name}] HTTP {r.status_code} {ms:.0f} ms {size:.0f} Kio en-têtes={limits}")
    if "error" in body:
        print("   erreur :", body["error"])
    return body


def main() -> None:
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H%M")
    out = ROOT / "data/explore/p7" / f"{stamp}_deribit"
    out.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=20, headers={"User-Agent": UA}, verify=certifi.where()) as c:
        idx = get(c, out, "index", "get_index_price", index_name="btc_usd")["result"]
        print("   indice btc_usd :", idx)

        now = int(time.time() * 1000)
        dvol = get(
            c,
            out,
            "dvol",
            "get_volatility_index_data",
            currency="BTC",
            start_timestamp=now - 2 * 86_400_000,
            end_timestamp=now,
            resolution="3600",
        )["result"]
        rows = dvol.get("data", [])
        print(
            f"   DVOL : {len(rows)} points [ts, o, h, l, c], dernier {rows[-1] if rows else None}"
        )

        books = get(
            c, out, "summary", "get_book_summary_by_currency", currency="BTC", kind="option"
        )
        res = books["result"]
        print(f"   options : {len(res)} instruments ; champs {sorted(res[0].keys())}")
        exps = Counter(r["instrument_name"].split("-")[1] for r in res)
        print(f"   échéances ({len(exps)}) : {dict(sorted(exps.items(), key=lambda x: x[0]))}")
        oi = sum(r.get("open_interest") or 0 for r in res)
        print(f"   OI total : {oi:.0f} BTC ; exemple : {res[0]}")

        inst = get(
            c, out, "instruments", "get_instruments", currency="BTC", kind="option", expired="false"
        )["result"]
        print(f"   instruments actifs : {len(inst)} ; exemple : {inst[0]}")

        under = idx["index_price"]
        near = sorted(
            (r for r in res if r["instrument_name"].endswith("-C") and r.get("mark_iv")),
            key=lambda r: (
                r["instrument_name"].split("-")[1] != inst[0]["instrument_name"].split("-")[1],
                abs(float(r["instrument_name"].split("-")[2]) - under),
            ),
        )[0]["instrument_name"]
        tick = get(c, out, "ticker", "ticker", instrument_name=near)["result"]
        print(
            f"   ticker {near} : mark_iv={tick.get('mark_iv')} bid_iv={tick.get('bid_iv')}"
            f" ask_iv={tick.get('ask_iv')} greeks={tick.get('greeks')}"
            f" underlying={tick.get('underlying_price')} ({tick.get('underlying_index')})"
        )
    print("sortie :", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
