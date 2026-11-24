"""Écran Taux (P2) de démonstration pour la fausse passerelle : chiffres fictifs de la maquette
Taux, tests seulement. Jamais utilisé par l'application."""

from __future__ import annotations

import math
from datetime import datetime

# Écran Taux (P2) : chiffres fictifs de la maquette Taux, tests seulement.
RATES_BANKS = {
    # banque: (nom, devise, fuseau, taux affiché, fourchette, prochaine réunion,
    #          (m25, hold, p25) Polymarket, idem Kalshi ou None)
    "FED": (
        "Réserve fédérale",
        "USD",
        "America/New_York",
        4.0,
        [3.75, 4.0],
        "2026-10-28",
        (0.004, 0.865, 0.131),
        (0.007, 0.841, 0.152),
    ),
    "BCE": (
        "Banque centrale européenne",
        "EUR",
        "Europe/Berlin",
        2.0,
        None,
        "2026-10-29",
        (0.08, 0.9, 0.02),
        None,
    ),
    "BOE": (
        "Banque d\u2019Angleterre",
        "GBP",
        "Europe/London",
        4.0,
        None,
        "2026-11-05",
        (0.35, 0.64, 0.01),
        None,
    ),
    "BOJ": (
        "Banque du Japon",
        "JPY",
        "Asia/Tokyo",
        0.75,
        None,
        "2026-10-30",
        (0.01, 0.6, 0.39),
        (0.01, 0.62, 0.37),
    ),
    "BNS": (
        "Banque nationale suisse",
        "CHF",
        "Europe/Zurich",
        0.0,
        None,
        "2026-12-10",
        (0.1, 0.88, 0.02),
        (0.12, 0.86, 0.02),
    ),
    "BOC": (
        "Banque du Canada",
        "CAD",
        "America/Toronto",
        2.25,
        None,
        "2026-10-28",
        (0.45, 0.54, 0.01),
        (0.43, 0.56, 0.01),
    ),
    "RBA": (
        "Banque de réserve d\u2019Australie",
        "AUD",
        "Australia/Sydney",
        3.35,
        None,
        "2026-11-03",
        (0.3, 0.69, 0.01),
        None,
    ),
    "RBNZ": (
        "Banque de réserve de Nouvelle-Zélande",
        "NZD",
        "Pacific/Auckland",
        2.5,
        None,
        "2026-11-25",
        (0.55, 0.44, 0.01),
        (0.5, 0.49, 0.01),
    ),
}
RATES_FED_PATH = [
    ("2026-10-28", 4.03, 3.3),
    ("2026-12-09", 4.12, 9.1),
    ("2027-01-27", 4.20, 8.0),
    ("2027-03-17", 4.29, 8.6),
    ("2027-04-28", 4.36, 7.2),
    ("2027-06-09", 4.41, 4.9),
    ("2027-07-28", 4.43, 2.3),
    ("2027-09-15", 4.45, 1.5),
    ("2027-10-27", 4.44, -0.8),
    ("2027-12-08", 4.42, -2.3),
]
RATES_DECISIONS = {
    "FED": (
        "2026-09-17",
        -25,
        {
            "kind": "nominatif",
            "for": 9,
            "against": 3,
            "dissents": [{"name": "A", "preferred": "statu quo"}] * 3,
        },
    ),
    "BCE": ("2026-09-10", 0, {"kind": "non publié"}),
    "BOE": (
        "2026-08-06",
        -25,
        {
            "kind": "nominatif",
            "for": 7,
            "against": 2,
            "dissents": [{"name": "B", "preferred": "statu quo"}] * 2,
        },
    ),
    "BOJ": (
        "2026-09-18",
        25,
        {
            "kind": "nominatif",
            "for": 7,
            "against": 2,
            "dissents": [{"name": "C", "preferred": "statu quo"}] * 2,
        },
    ),
    "BNS": ("2026-09-25", 0, {"kind": "non publié"}),
    "BOC": ("2026-09-17", -25, {"kind": "consensus"}),
    "RBA": ("2026-08-12", -25, {"kind": "non nominatif"}),
    "RBNZ": ("2026-10-08", -25, {"kind": "consensus"}),
}


def _q(p: float) -> dict:
    return {
        "p": p,
        "bid": round(max(0.0, p - 0.005), 4),
        "ask": round(min(1.0, p + 0.005), 4),
        "last": p,
        "wide": False,
        "vol24": 250000.0,
    }


def demo_rates(now: int) -> dict:
    banks = {}
    for bank, (name, cur, tz, rate, rng, nxt, pm, ks) in RATES_BANKS.items():

        def block(probs: tuple, ref: str) -> dict:
            d = {o: _q(p) for o, p in zip(("m25", "hold", "p25"), probs, strict=True)}
            return {
                "probs": d,
                "total": round(sum(probs), 4),
                "sum_ok": True,
                "expected_bp": round((probs[2] - probs[0]) * 25, 2),
                "ts_source": now - 20_000,
                "ts_recv": now - 15_000,
                "ref": ref,
                "title": ref,
            }

        sources = {
            "polymarket": block(pm, f"{bank.lower()}-decision"),
            "kalshi": block(ks, f"KX{bank}")
            if ks
            else {"missing": "marché non coté chez Kalshi (séries expirées)"},
            "futures": {
                "missing": "aucun flux gratuit de futures de taux"
                " (calcul prévu en P7 ou FedWatch payant)"
            },
        }
        gap = None
        if ks:
            diffs = [
                (round(abs(a - b) * 100, 1), o)
                for o, a, b in zip(("m25", "hold", "p25"), pm, ks, strict=True)
            ]
            pts, o = max(diffs)
            gap = {"pts": pts, "outcome": o, "sources": ["polymarket", "kalshi"]}
        meeting = {"date": nxt, "days": 0, "sources": sources, "gap": gap}
        if bank == "FED":
            pts = [{"meeting": d, "rate": r, "delta_bp": b} for d, r, b in RATES_FED_PATH]
            path = {
                "source": "kalshi",
                "base": rate,
                "points": pts,
                "end": pts[-1]["rate"],
                "truncated": False,
                "note": "borne haute attendue, marchés KXFED de Kalshi (démonstration)",
            }
        else:
            path = {
                "source": "polymarket",
                "base": rate,
                "points": [
                    {
                        "meeting": nxt,
                        "rate": round(
                            rate + meeting["sources"]["polymarket"]["expected_bp"] / 100, 4
                        ),
                        "delta_bp": meeting["sources"]["polymarket"]["expected_bp"],
                    }
                ],
                "note": "taux actuel + variations attendues cumulées (démonstration)",
            }
            path["end"] = path["points"][-1]["rate"]
        banks[bank] = {
            "bank": bank,
            "name": name,
            "currency": cur,
            "tz": tz,
            "time": None,
            "calendar": {
                "source": "officielle",
                "url": "https://example.invalid",
                "read_on": "2026-10-01",
                "until": None,
                "note": None,
            },
            "policy": {
                "rate": rate if not rng else (rng[0] + rng[1]) / 2,
                "date": "2026-10-16",
                "last_change": {"date": "2026-09-17", "from": rate + 0.25, "to": rate},
                "since": "2024-08-01",
                "ts_recv": now - 3_600_000,
                "label": "Taux directeur",
                "display": rate,
                "range": rng,
                "basis": "milieu publié par le BIS ± 12,5 pb" if rng else None,
            },
            "next": meeting,
            "meetings": [meeting],
            "path": path,
        }
    decisions = {
        b: {
            "bank": b,
            "decision_date": d,
            "change_bp": c,
            "rate_text": None,
            "vote": v,
            "quote": None,
            "source_url": "https://example.invalid",
            "ts_recv": "2026-10-16T00:00:00Z",
        }
        for b, (d, c, v) in RATES_DECISIONS.items()
    }
    feeds = [
        {
            "name": n,
            "label": lab,
            "status": "connected",
            "last_message_ms": now - 15_000,
            "last_error": None,
            "late_after_ms": 180_000,
            "stale_after_ms": 300_000,
        }
        for n, lab in (("polymarket", "Polymarket"), ("kalshi", "Kalshi"))
    ]
    return {
        "configured": True,
        "state": {
            "computed_ms": now - 15_000,
            "minute_ms": now - 15_000,
            "banks": banks,
            "unmatched": [],
        },
        "state_ms": now - 15_000,
        "feeds": feeds,
        "decisions": decisions,
        "gate": {
            "meeting": "2026-10-28",
            "window_min": 30,
            "polymarket": 30,
            "kalshi": 30,
            "last_ms": now - 15_000,
        },
        "computed_ms": now,
    }


def demo_rates_history(now: int) -> dict:
    day = 86_400_000
    nfp = int(datetime.fromisoformat("2026-10-02T12:30:00+00:00").timestamp() * 1000)
    cpi = int(datetime.fromisoformat("2026-10-15T12:30:00+00:00").timestamp() * 1000)
    hold, alt = [], []
    for i in range(0, 60 * 6 + 1):
        t = now - 60 * day + i * 4 * 3_600_000
        step = (0.05 if t >= nfp else 0) + (0.06 if t >= cpi else 0)
        h = 0.97 - step + 0.006 * math.sin(i / 2.3)
        hold.append({"t": t, "p": round(h, 4)})
        alt.append({"t": t, "p": round(1 - h - 0.004, 4)})
    return {
        "bank": "FED",
        "meeting": "2026-10-28",
        "days": 60,
        "series": {"polymarket": {"hold": hold, "p25": alt}},
        "markers": [
            {
                "label": "NFP",
                "title": "Employment Situation",
                "date": "2026-10-02",
                "t": nfp,
                "source": "BLS",
            },
            {
                "label": "IPC",
                "title": "Consumer Price Index",
                "date": "2026-10-15",
                "t": cpi,
                "source": "BLS",
            },
        ],
        "computed_ms": now,
    }
