"""Écrans de P4 (sentiment et liquidité) de démonstration pour la fausse passerelle : chiffres
fictifs de la maquette Risque, et chiffres inventés pour les écrans sans maquette. Tests
seulement ; jamais utilisé par l'application."""

from __future__ import annotations

import math
from datetime import date, timedelta

ZONES = [
    {"id": "risk_off_strong", "label": "Risk-off fort", "from": 0, "to": 25},
    {"id": "risk_off", "label": "Risk-off", "from": 25, "to": 45},
    {"id": "neutral", "label": "Neutre", "from": 45, "to": 55},
    {"id": "risk_on", "label": "Risk-on", "from": 55, "to": 75},
    {"id": "risk_on_strong", "label": "Risk-on fort", "from": 75, "to": 100},
]
# Maquette Risque : (id, libellé, description, unité, source, séries, valeur brute, percentile).
COMPONENTS = [
    (
        "vix",
        "VIX",
        "Volatilité implicite du S&P 500",
        "pts",
        "Cboe (FRED en repli)",
        ["VIX"],
        20.0,
        18,
    ),
    (
        "trend",
        "Tendance actions",
        "SPY vs moyenne mobile 125 séances",
        "%",
        "Tiingo",
        ["SPY"],
        1.58,
        15,
    ),
    (
        "credit",
        "Crédit",
        "Écart haut rendement · variation sur 20 séances",
        "pts",
        "FRED (ICE BofA)",
        ["HY_OAS"],
        -0.90,
        10,
    ),
    ("audjpy", "AUD/JPY", "Variation sur 20 séances", "%", "Tiingo", ["AUDJPY"], -1.86, 9),
    (
        "copper_gold",
        "Cuivre / or",
        "Ratio CPER / GLD · variation sur 20 séances",
        "%",
        "Tiingo",
        ["CPER", "GLD"],
        4.49,
        59,
    ),
    (
        "stocks_bonds",
        "Actions vs refuge",
        "SPY \u2212 TLT · rendement sur 20 séances",
        "pts",
        "Tiingo",
        ["SPY", "TLT"],
        5.63,
        67,
    ),
    (
        "crypto",
        "Momentum crypto",
        "BTC et ETH · rendement moyen sur 20 séances",
        "%",
        "OKX",
        ["BTC", "ETH"],
        -3.61,
        32,
    ),
]
LAST = date(2026, 10, 19)


def sessions(n: int, last: date = LAST) -> list[str]:
    out: list[str] = []
    d = last
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out[::-1]


def feed(name: str, label: str, now: int, ago_min: int, late_h: float, stale_h: float) -> dict:
    return {
        "name": name,
        "label": label,
        "status": "connected",
        "connected_since_ms": None,
        "last_message_ms": now - ago_min * 60_000,
        "reconnects": 0,
        "outages": [],
        "last_error": None,
        "late_after_ms": int(late_h * 3_600_000),
        "stale_after_ms": int(stale_h * 3_600_000),
    }


def reply(route: str, now: int, data: dict, fd: dict, **extra) -> dict:
    return {
        "configured": True,
        "route": route,
        "computed_ms": now,
        "published_ms": now - 60_000,
        "feed": fd,
        "data": data,
        "reason": None,
        **extra,
    }


def demo_risk(now: int) -> dict:
    d = sessions(252)
    # Courbe de la maquette : risk-on à l'automne 2025, creux en janvier, remontée, chute à 30.
    hist = [round(55 + 18 * math.sin(i / 22) + 6 * math.sin(i / 5), 1) for i in range(252)]
    hist[-6], hist[-22] = 61.0, 47.0
    hist[-1] = 30.0
    spy = [round(6742.0 * (1 + 0.136 * i / 251) + 90 * math.sin(i / 13), 2) for i in range(252)]
    spy[0], spy[-1] = 6742.46, 7659.44
    vix = [
        round(17 + 2.5 * math.sin(i / 9) + (14 * math.exp(-(((i - 70) / 9) ** 2))), 2)
        for i in range(252)
    ]
    vix[-1] = 19.99
    comps = [
        {
            "id": i,
            "label": lb,
            "description": de,
            "unit": u,
            "source": so,
            "raw": raw,
            "percentile": p,
            "reason": None,
            "last_dates": {s: LAST.isoformat() for s in se},
        }
        for i, lb, de, u, so, se, raw, p in COMPONENTS
    ]
    data = {
        "date": LAST.isoformat(),
        "index": 30.0,
        "zone": "risk_off",
        "components_used": 7,
        "week_ago": {"date": d[-6], "value": 61.0},
        "month_ago": {"date": d[-22], "value": 47.0},
        "components": comps,
        "history": [{"date": x, "value": v} for x, v in zip(d, hist, strict=True)],
        "spy": [{"date": x, "value": v} for x, v in zip(d, spy, strict=True)],
        "vix": [{"date": x, "value": v} for x, v in zip(d, vix, strict=True)],
        "zones": ZONES,
        "window": 252,
        "min_components": 4,
        "computed_ms": now - 60_000,
    }
    series = {
        s: {"label": s, "last_date": LAST.isoformat(), "last_ok_ms": now - 60_000, "error": None}
        for s in ("VIX", "HY_OAS", "SPY", "TLT", "CPER", "GLD", "AUDJPY", "BTC", "ETH")
    }
    series["VIX_FRED"] = {"label": "VIX_FRED", "last_date": "2026-10-16", "error": None}
    return reply(
        "risk",
        now,
        data,
        feed("closes", "Clôtures (Cboe, Tiingo, OKX, FRED)", now, 30, 30, 54),
        series=series,
    )


COT = [  # code, libellé, groupe, intérêt ouvert, (fonds spéculatifs, gérants, dealers) nets
    ("099741", "EUR", "fx", 866032, (-76587, 147234, -118393)),
    ("097741", "JPY", "fx", 380641, (32110, -41220, 9812)),
    ("096742", "GBP", "fx", 245590, (-18233, 25410, -4120)),
    ("092741", "CHF", "fx", 133162, (-9150, 11020, -3311)),
    ("090741", "CAD", "fx", 348660, (-61200, 48230, 14320)),
    ("232741", "AUD", "fx", 328599, (-40210, 30120, 6000)),
    ("112741", "NZD", "fx", 132550, (-22050, 12150, 7330)),
    ("13874A", "E-mini S&P 500", "index", 1986532, (-210440, 865210, -301220)),
    ("133741", "Bitcoin (CME)", "crypto", 17527, (-2104, 1530, -310)),
]


def demo_cot(now: int) -> dict:
    dates = [(date(2026, 10, 13) - timedelta(weeks=155 - i)).isoformat() for i in range(156)]
    markets = []
    for k, (code, label, group, oi, nets) in enumerate(COT):
        cats, hist = {}, {}
        for c, net, pct in zip(
            ("lev_money", "asset_mgr", "dealer"), nets, (8 + k, 71 - k, 40 + 3 * k), strict=True
        ):
            longv = max(net, 0) + oi // 10
            cats[c] = {
                "long": longv,
                "short": longv - net,
                "net": net,
                "net_change_1w": round(net * 0.04),
                "net_pct_oi": round(net / oi * 100, 1),
                "percentile_3y": float(pct),
                "weeks": 156,
            }
            hist[c] = [round(net * (0.6 + 0.4 * math.sin(i / 12 + k))) for i in range(155)] + [net]
        markets.append(
            {
                "code": code,
                "label": label,
                "group": group,
                "date": dates[-1],
                "open_interest": oi,
                "categories": cats,
                "history": {"dates": dates, "net": hist},
            }
        )
    data = {
        "report_date": dates[-1],
        "report": "TFF, futures seuls",
        "markets": markets,
        "computed_ms": now - 3_600_000,
    }
    return reply(
        "cot", now, data, feed("cot", "COT (CFTC, rapport TFF)", now, 3 * 24 * 60, 8 * 24, 15 * 24)
    )


def demo_banks(now: int) -> dict:
    cot = demo_cot(now)["data"]
    markets = [
        {
            "code": m["code"],
            "label": m["label"],
            "group": m["group"],
            "date": m["date"],
            "open_interest": m["open_interest"],
            "dealer": m["categories"]["dealer"],
            "history": {"dates": m["history"]["dates"], "net": m["history"]["net"]["dealer"]},
        }
        for m in cot["markets"]
    ]
    months = [(date(2024, 11, 5) + timedelta(days=28 * i)).isoformat() for i in range(24)]
    bpr = {
        "report_date": "2026-10-06",
        "source": "CFTC, Bank Participation Report (futures)",
        "computed_ms": now - 3_600_000,
        "markets": [
            {
                "market": "CME EURO FX",
                "label": "EUR",
                "group": "fx",
                "date": "2026-10-06",
                "banks": 12,
                "long": 10361,
                "short": 161790,
                "net": -151429,
                "long_pct": 1.2,
                "short_pct": 18.5,
                "net_pct_oi": -17.3,
                "open_interest": 876122,
                "net_change_1m": -8120,
                "history": [{"date": d, "net": -140000 + 900 * i} for i, d in enumerate(months)],
            },
            {
                "market": "CME BITCOIN",
                "label": "Bitcoin (CME)",
                "group": "crypto",
                "date": "2026-10-06",
                "banks": None,
                "long": 0,
                "short": 704,
                "net": -704,
                "long_pct": 0.0,
                "short_pct": 4.0,
                "net_pct_oi": -4.0,
                "open_interest": 17527,
                "net_change_1m": None,
                "history": [{"date": "2026-10-06", "net": -704}],
            },
        ],
    }
    return reply(
        "banks",
        now,
        {
            "report_date": cot["report_date"],
            "label": "Dealers (rapport TFF de la CFTC)",
            "markets": markets,
        },
        feed("cot", "COT (CFTC, rapport TFF)", now, 3 * 24 * 60, 8 * 24, 15 * 24),
        bpr=bpr,
        bpr_reason=None,
        bpr_published_ms=now - 3_600_000,
        bpr_feed=feed(
            "banks", "Positions des banques (CFTC, BPR via Vercel)", now, 15 * 60, 30, 54
        ),
    )


def demo_crowding(now: int) -> dict:
    ts = "2026-10-20T13:00:00+00:00"
    assets: dict = {}
    for a, base in (("BTC", 2.4), ("ETH", 2.9)):
        assets[a] = {}
        for k, ex in enumerate(("binance", "okx", "bybit")):
            m = {}
            for j, metric in enumerate(("account", "top_account", "top_position")):
                if ex == "bybit" and metric != "account":
                    continue
                last = round(base + 0.15 * k - 0.4 * j, 3)
                avg = round(last * (1 - 0.05 * (k - 1)), 3)
                m[metric] = {
                    "last": last,
                    "ts": ts,
                    "long_share": round(last / (1 + last), 4),
                    "avg_30d": avg,
                    "deviation_pct": round((last / avg - 1) * 100, 1),
                    "days_covered": 30 if ex == "okx" else 20.8,
                    "partial": ex != "okx",
                    "spark": [round(avg + 0.2 * math.sin(i / 6), 3) for i in range(71)] + [last],
                }
            m["funding"] = {
                "last": 0.0000458 * (k + 1),
                "ts": ts,
                "long_share": None,
                "avg_30d": None,
                "deviation_pct": None,
                "days_covered": 0.1,
                "partial": True,
                "spark": [],
            }
            assets[a][ex] = m
    return reply(
        "crowding",
        now,
        {"assets": assets, "days": 30, "computed_ms": now - 120_000},
        feed("crowding", "Ratios long/short (Binance, OKX, Bybit)", now, 4, 0.75, 2),
    )


def demo_liquidity(now: int) -> dict:
    weds = [(date(2026, 10, 14) - timedelta(weeks=155 - i)).isoformat() for i in range(156)]
    hist = []
    for i, d in enumerate(weds):
        walcl = 8_600_000 - 12_000 * i
        tga = 750_000 + 120_000 * math.sin(i / 9)
        rrp = max(0, 2_000_000 - 18_000 * i)
        hist.append(
            {
                "date": d,
                "walcl": walcl,
                "tga": round(tga),
                "rrp": rrp,
                "net": round(walcl - tga - rrp),
            }
        )
    last = hist[-1]

    def ch(k: int) -> int:
        return last["net"] - hist[-1 - k]["net"]

    data = {
        "last": last,
        "changes": {"w1": ch(1), "w4": ch(4), "w13": ch(13), "w52": ch(52)},
        "history": hist,
        "unit": "M USD",
        "formula": "WALCL \u2212 WDTGAL \u2212 RRPONTSYD \u00d7 1 000",
        "computed_ms": now - 3_600_000,
    }
    series = {
        "WALCL": {"last_date": weds[-1]},
        "WDTGAL": {"last_date": weds[-1]},
        "RRP": {"last_date": "2026-10-19"},
    }
    return reply(
        "liquidity",
        now,
        data,
        feed("liquidity", "Liquidité de la Fed (FRED)", now, 7 * 60, 30, 54),
        series=series,
    )


def demo_sentiment(now: int) -> dict[str, dict]:
    return {
        "risk": demo_risk(now),
        "cot": demo_cot(now),
        "banks": demo_banks(now),
        "crowding": demo_crowding(now),
        "liquidity": demo_liquidity(now),
    }
