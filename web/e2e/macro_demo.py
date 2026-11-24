"""Écrans Heatmap et Macro (P3) de démonstration pour la fausse passerelle : chiffres fictifs de la
maquette Heatmap, tests seulement. Jamais utilisé par l'application."""

from __future__ import annotations

import math

ECON = ["AU", "US", "EA", "NZ", "GB", "CH", "CA", "JP"]
CUR = {
    "US": "USD",
    "EA": "EUR",
    "GB": "GBP",
    "JP": "JPY",
    "CH": "CHF",
    "CA": "CAD",
    "AU": "AUD",
    "NZ": "NZD",
}
SCORE = {"AU": 58, "US": 41, "EA": 27, "NZ": 6, "GB": -4, "CH": -22, "CA": -41, "JP": -65}
THEMES = ["rates", "inflation", "growth", "employment", "activity", "sentiment", "surprises"]
# Valeurs de la maquette (taux, inflation, croissance, chômage, PMI, sentiment, surprises)
# et niveaux de couleur.
CELLS = {
    "AU": ([3.85, 3.2, 1.9, 4.1, 52.8, 1.1, 24], [1, 1, 1, 1, 1, 2, 2]),
    "US": ([4.0, 3.7, 2.2, 4.2, 54.5, 0.1, 12], [2, 1, 2, 0, 1, 0, 1]),
    "EA": ([2.15, 2.3, 1.1, 6.2, 51.0, 0.6, 9], [0, 0, 0, 1, 1, 1, 1]),
    "NZ": ([2.75, 2.9, 0.8, 5.3, 49.6, 0.4, 2], [0, 1, -1, -1, 0, 1, 0]),
    "GB": ([3.75, 3.8, 1.0, 4.8, 50.4, -0.7, -3], [1, 1, -1, -1, 0, -1, 0]),
    "CH": ([0.0, 0.3, 1.2, 2.9, 48.7, 0.0, -8], [-2, -2, 0, 1, -1, 0, -1]),
    "CA": ([2.25, 1.9, 0.9, 7.0, 48.9, -0.9, -11], [0, -1, -1, -2, -1, -1, -1]),
    "JP": ([1.25, 1.9, 0.3, 2.5, 54.1, -0.5, -21], [-1, -1, -2, 1, 0, -1, -2]),
}
SHEET = {  # policy, cpi, cpi_core, gdp, unemployment, retail
    "JP": [1.25, 1.9, 1.7, 0.3, 2.5, 2.7],
    "US": [4.0, 3.7, 2.6, 2.2, 4.2, 6.3],
    "EA": [2.15, 2.3, 2.4, 1.1, 6.2, 1.8],
    "AU": [3.85, 3.2, 2.9, 1.9, 4.1, None],
    "NZ": [2.75, 2.9, None, 0.8, 5.3, None],
    "GB": [3.75, 3.8, 3.1, 1.0, 4.8, 1.2],
    "CH": [0.0, 0.3, 0.6, 1.2, 2.9, None],
    "CA": [2.25, 1.9, 2.5, 0.9, 7.0, None],
}
INDS = ["policy", "cpi", "cpi_core", "gdp", "unemployment", "retail"]
LABEL = {
    "policy": "Taux directeur",
    "cpi": "IPC sur un an",
    "cpi_core": "IPC sous-jacent sur un an",
    "gdp": "PIB sur un an",
    "unemployment": "Taux de chômage",
    "retail": "Ventes au détail sur un an",
}


def demo_macro(now: int) -> dict:
    rows = []
    for rank, e in enumerate(ECON, start=1):
        vals, lv = CELLS[e]
        cells = [
            {
                "theme": t,
                "x": None,
                "value": v,
                "unit": "%" if i < 4 else "",
                "period": "2026-09",
                "indicator": None,
                "reason": None,
                "stale": False,
                "z": lv[i] * 0.8,
                "level": lv[i],
            }
            for i, (t, v) in enumerate(zip(THEMES, vals, strict=True))
        ]
        rows.append(
            {
                "economy": e,
                "score": SCORE[e],
                "rank": rank,
                "bias": "BULLISH" if rank <= 3 else ("BEARISH" if rank >= 6 else "NEUTRAL"),
                "cells": cells,
            }
        )
    sheets = {}
    for e, vals in SHEET.items():
        sheets[e] = {
            "currency": CUR[e],
            "bank": "X",
            "target": {"mid": 2, "text": "2 %"},
            "values": [
                {
                    "indicator": ind,
                    "label": LABEL[ind],
                    "value": v,
                    "period": None if v is None else "2026-09",
                    "previous": None,
                    "source": "fred",
                    "url": None,
                    "transform": "level",
                    "stale": False,
                    "reason": "série absente (démonstration)" if v is None else None,
                }
                for ind, v in zip(INDS, vals, strict=True)
            ],
        }
    rates = {
        e: {
            "bank": e,
            "name": None,
            "tz": "Asia/Tokyo",
            "policy": {
                "display": SHEET[e][0],
                "date": "2026-10-16",
                "last_change": {
                    "date": "2026-09-18",
                    "from": SHEET[e][0] - 0.25,
                    "to": SHEET[e][0],
                },
            },
            "next": {"date": "2026-10-30"},
        }
        for e in SHEET
    }
    return {
        "configured": True,
        "scores": {
            "date": "2026-10-20",
            "themes": THEMES,
            "excluded": [],
            "rows": rows,
            "computed_ms": now - 3_600_000,
        },
        "sheets": {"date": "2026-10-20", "economies": sheets, "computed_ms": now},
        "backtest": {
            "from": "2008-01",
            "to": "2026-08",
            "months": 224,
            "themes": [],
            "measures": [],
            "proven": False,
            "verdict": "outil de contexte (démonstration)",
            "caveats": ["démonstration"],
            "computed_ms": now,
        },
        "feed": None,
        "series": [],
        "rates": rates,
        "computed_ms": now,
    }


def demo_series(economy: str, indicator: str) -> dict:
    """10 ans fictifs de 2016-10 à 2026-09 (marches du taux, inflation lissée)."""
    points = []
    for i in range(120):
        y, m = 2016 + (9 + i) // 12, (9 + i) % 12 + 1
        if indicator == "policy":
            v = -0.1 if i < 90 else round(-0.1 + 0.25 * min(5, (i - 90) // 6 + 1) + 0.1, 2)
        else:
            v = round(0.3 + 3.8 * math.exp(-(((i - 76) / 14) ** 2)) + 0.25 * math.sin(i / 3), 2)
        points.append({"period": f"{y}-{m:02d}", "value": v})
    return {
        "economy": economy,
        "indicator": indicator,
        "years": 10,
        "points": points,
        "computed_ms": 0,
    }
