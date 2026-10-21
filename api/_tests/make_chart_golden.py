"""Produit api/_tests/fixtures/chart_golden.json : sorties RÉELLES de la passerelle
(gateway/terminal_gateway/okx_service.py::OkxService.chart) pour un faux OKX
déterministe, que api/_tests/chart.test.ts rejoue contre la fonction Vercel.

Le faux OKX (fake_rows) est porté à l'identique dans le test TypeScript : mêmes
bougies pour les mêmes paramètres. Le test vérifie que la fonction envoie les
mêmes requêtes, dans le même ordre, et rend le même JSON (seule `source` diffère).

Le marché fictif ouvre 30 h avant l'heure figée : 1 J couvre 301 bougies de
1 min (deux pages de 300), 5 J s'arrête sur une page vide (début de l'historique),
1 M tient en une page, et la veille UTC (prev_day) existe.

Usage, depuis la racine du dépôt :
    .venv/bin/python api/_tests/make_chart_golden.py
Toute modification de OkxService.chart ou de OkxRest.candles impose de le relancer.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import httpx
from terminal_collectors.okx.rest import OkxRest
from terminal_gateway import okx_service
from terminal_gateway.bus import Bus

OUT = Path(__file__).parent / "fixtures" / "chart_golden.json"
INST = "BTC-USDT-SWAP"
# 20/10/2026 05:00:30,123 UTC : la bougie de 05:00 est en cours.
NOW_MS = int(datetime(2026, 10, 20, 5, 0, 30, 123000, tzinfo=UTC).timestamp() * 1000)
LISTING_MS = NOW_MS - 30 * 3_600_000
BAR_MS = {"1m": 60_000, "5m": 300_000, "1H": 3_600_000, "1Dutc": 86_400_000}


def tenths(n: int) -> str:
    return f"{n // 10}.{n % 10}"


def fake_row(t: int, bar_ms: int) -> list[str]:
    """Bougie fictive déterministe, en entiers (dixièmes) pour un formatage identique en TS."""
    k = t // 60_000
    o = 800_000 + k % 997
    c = o + k % 7 - 3
    h = max(o, c) + k % 5
    lo = min(o, c) - k % 3
    vol = 100 + k % 50  # contrats
    return [str(t), tenths(o), tenths(h), tenths(lo), tenths(c), str(vol),
            f"{vol // 100}.{vol % 100:02d}", str(vol * 8000),
            "0" if t + bar_ms > NOW_MS else "1"]


def fake_rows(params: dict[str, str]) -> list[list[str]]:
    """Réponse du faux OKX : les `limit` bougies antérieures à `after`,
    de la plus récente à la plus ancienne."""
    b = BAR_MS[params["bar"]]
    limit = int(params["limit"])
    t = NOW_MS - NOW_MS % b
    if "after" in params:
        t = min(t, (int(params["after"]) - 1) // b * b)
    rows = []
    while len(rows) < limit and t + b > LISTING_MS:
        rows.append(fake_row(t, b))
        t -= b
    return rows


async def main() -> None:
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        requests.append({"path": request.url.path, "params": params})
        return httpx.Response(200, json={"code": "0", "msg": "", "data": fake_rows(params)})

    okx_service.now_ms = lambda: NOW_MS  # heure figée (today et ts_recv)
    cases = {}
    with tempfile.TemporaryDirectory() as tmp:
        service = okx_service.OkxService(Bus(), "eea", (INST,), Path(tmp))
        base = "https://eea.okx.com"
        service.rest = OkxRest(base, client=httpx.AsyncClient(
            base_url=base, transport=httpx.MockTransport(handler)))
        for range_ in ("1D", "5D", "1M"):
            requests.clear()
            chart = await service.chart(INST, range_)
            cases[f"{INST}|{range_}"] = {"requests": list(requests), "chart": chart}
        await service.rest.aclose()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "_about": "Sorties de OkxService.chart (passerelle) "
                  "pour le faux OKX de make_chart_golden.py",
        "now_ms": NOW_MS, "listing_ms": LISTING_MS, "cases": cases,
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    for key, case in cases.items():
        c = case["chart"]
        print(f"{key} : {len(case['requests'])} requête(s), {len(c['candles'])} bougie(s), "
              f"prev_day={c['prev_day']}")


if __name__ == "__main__":
    asyncio.run(main())
