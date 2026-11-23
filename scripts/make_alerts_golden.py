# ruff: noqa: E501
"""Fichier doré des règles d'alerte (plan « Tout en ligne », étape O4).

Fige les sorties de gateway/terminal_gateway/alert_rules.py (validation, libellés, conditions,
messages, nombres à la française) sur des cas fixes. Le portage TypeScript
(supabase/functions/p1-jobs/alert_rules.ts) doit redonner exactement ce fichier
(alert_rules.test.ts) ; gateway/tests/test_alerts_golden.py vérifie qu'il suit le code Python.

    .venv/bin/python scripts/make_alerts_golden.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gateway"))

from terminal_gateway import alert_rules as ar  # noqa: E402

OUT = ROOT / "gateway" / "tests" / "fixtures" / "alerts_golden.json"
INST = ("BTC-USDT-SWAP", "ETH-USDT-SWAP")
RULES = [
    ("price", {"inst": "BTC-USDT-SWAP", "level": "110000.0", "direction": "hausse"}, ["telegram", "x"]),
    ("price", {"inst": "BTC-USDT-SWAP", "level": "99999.5"}, []),
    ("price", {"inst": "SOL-USDT-SWAP", "level": "1"}, []),
    ("price", {"inst": "BTC-USDT-SWAP", "level": "-5"}, []),
    ("funding", {"inst": "BTC-USDT-SWAP", "threshold_pct": "0.02"}, ["voix"]),
    ("funding", {"inst": "BTC-USDT-SWAP", "threshold_pct": "-0.01", "side": "en dessous"}, []),
    ("funding", {"inst": "BTC-USDT-SWAP", "threshold_pct": "9"}, []),
    ("event_soon", {"minutes": 5, "captured_only": True}, ["telegram"]),
    ("event_soon", {"minutes": 15, "impacts": ["High", "Bad"], "currencies": ["usd", "eur", "x1"]}, []),
    ("event_soon", {"minutes": 0}, []),
    ("release", {"releases": ["cpi", "nope"]}, []),
    ("release", {}, []),
    ("surprise", {"z_min": "1.5"}, []),
    ("surprise", {"indicator": "us-nfp", "raw_min": "50"}, []),
    ("surprise", {}, []),
    ("keyword", {"words": [" Powell ", "ETF", ""]}, []),
    ("keyword", {"words": []}, []),
    ("liquidation", {}, []),
    ("event_watch", {"event_id": "552-us-flash-manufacturing-pmi|USD|2026-11-23|1", "title": " Flash Manufacturing PMI ",
                     "time_ms": 1795409100000}, ["telegram"]),
    ("event_watch", {"event_id": "pas-un-id", "title": "x"}, []),
    ("event_watch", {"event_id": "552-us-flash-manufacturing-pmi|USD|2026-11-23|1", "title": ""}, []),
    ("event_watch", {"event_id": "552-us-flash-manufacturing-pmi|USD|2026-11-23|1", "title": "x", "time_ms": True}, []),
    ("news_category", {"category": "crypto", "urgent_only": True}, ["telegram"]),
    ("news_category", {"category": "general"}, []),
    ("news_category", {"category": "sport"}, []),
]
NUMS = [["-1234.5", None, False], ["0.0312", 4, True], ["-0.00", 2, False], ["110000", None, False],
        ["0.3", None, True], ["abc", None, False], ["1e3", None, False]]
CROSS = [[{"level": "100", "direction": "hausse"}, prev, px] for prev, px in ((None, 101), (99.5, 100), (100.5, 99))]
CROSS += [[{"level": "100", "direction": "les deux"}, prev, px] for prev, px in ((100.5, 99), (99, 101), (101, 102))]
CROSS += [[{"level": "100", "direction": "baisse"}, 101, 100], [{"level": "100", "direction": "baisse"}, 99, 98]]
FUND = [[{"threshold_pct": "0.02", "side": "au-dessus"}, r] for r in (0.0001, 0.0002, 0.00025)]
FUND += [[{"threshold_pct": "-0.01", "side": "en dessous"}, r] for r in (-0.0002, 0.0001)]
EVENTS = [{"capture": True, "impact": "High", "currency": "USD", "title": "CPI m/m", "title_fr": "IPC (m/m)", "forecast_raw": "0.3%"},
          {"capture": False, "impact": "Low", "currency": "EUR", "title": "Flash PMI", "title_fr": None, "forecast_raw": None}]
FIG = {"indicator": "us-cpi-mm", "label_fr": "IPC (m/m)", "unit": "%", "value": "0.6", "forecast": "0.3",
       "surprise": "0.3", "z": "2.1"}


EW = {"event_id": "552-us-flash-manufacturing-pmi|USD|2026-11-23|1", "title": "Flash Manufacturing PMI",
      "currency": "USD", "time_ms": 1795409100000}


def build() -> dict:
    rules = []
    for kind, params, chans in RULES:
        try:
            p, c = ar.validate(kind, params, chans, INST)
            rules.append([kind, params, chans, {"params": p, "channels": c, "describe": list(ar.describe(kind, p))}])
        except ar.RuleError as e:
            rules.append([kind, params, chans, {"error": str(e)}])
    sp = {"minutes": 5, "captured_only": True, "impacts": [], "currencies": []}
    return {
        "_comment": "Généré par scripts/make_alerts_golden.py ; ne pas modifier à la main.",
        "rules": rules,
        "fr_num": [[x, d, s, ar.fr_num(x, d, s)] for x, d, s in NUMS],
        "price_crossed": [[p, prev, px, ar.price_crossed(p, prev, px)] for p, prev, px in CROSS],
        "funding_hit": [[p, r, ar.funding_hit(p, r)] for p, r in FUND],
        "event_matches": [[p, e, ar.event_matches(p, e)] for p in (sp, {"minutes": 5, "captured_only": False, "impacts": ["High"], "currencies": ["USD"]}) for e in EVENTS],
        "keyword_hit": [[w, t, ar.keyword_hit({"words": w}, t)] for w, t in ((["Réserve fédérale", "ETF"], "La reserve FEDERALE maintient"),
                                                                             (["ETF"], "Spot ETF inflows"), (["ETF"], "Netflix earnings"))],
        "surprise_hit": [[p, f, ar.surprise_hit(p, f)] for p, f in (({"indicator": None, "z_min": "1.5", "raw_min": None}, FIG),
                                                                     ({"indicator": "us-nfp", "z_min": "1.5", "raw_min": None}, FIG),
                                                                     ({"indicator": None, "z_min": None, "raw_min": "0.4"}, FIG))],
        "news_category_hit": [[p, i, ar.news_category_hit(p, i)] for p, i in (
            ({"category": "crypto", "urgent_only": True}, {"category": "crypto", "urgent": False}),
            ({"category": "crypto", "urgent_only": True}, {"category": "crypto", "urgent": True}),
            ({"category": "macro", "urgent_only": False}, {"category": "macro", "urgent": False}),
            ({"category": "macro", "urgent_only": False}, {"category": "crypto", "urgent": True}))],
        "messages": {
            "price": list(ar.price_message({"inst": "BTC-USDT-SWAP", "level": "110000"}, 109999.5, 110000.5)),
            "funding": list(ar.funding_message({"inst": "BTC-USDT-SWAP", "threshold_pct": "0.02", "side": "au-dessus"}, 0.000312)),
            "event": list(ar.event_message(sp, EVENTS[0], "14:30")),
            "event_no_fc": list(ar.event_message(sp, EVENTS[1], "10:00")),
            "release": list(ar.release_message({"title": "Consumer Price Index", "period": "2026-11", "edition": None, "nature": "officielle"},
                                               [FIG, {**FIG, "indicator": "us-cpi-yy", "label_fr": "IPC (sur un an)", "value": None, "reason": "non publié"}])),
            "release_catchup": list(ar.release_message({"title": "Productivity and Costs", "period": "2026-Q3", "edition": "Revised", "nature": "rattrapage"}, [])),
            "surprise": list(ar.surprise_message(FIG)),
            "keyword": list(ar.keyword_message("Powell", {"title": "Powell speaks", "source": "Fed"})),
            "event_watch": list(ar.event_watch_message(EW, {"title": "Flash Manufacturing PMI", "title_fr": None,
                                                            "forecast_raw": "54.5", "previous_raw": "54.9"},
                                                       "54,5", "FinancialJuice (fil d\u2019actus)")),
            "event_watch_fr": list(ar.event_watch_message(EW, {"title": "CPI m/m", "title_fr": "IPC (m/m)",
                                                               "forecast_raw": None, "previous_raw": "0.3%"},
                                                          "0,6\u00a0%", "BLS")),
            "event_missing": list(ar.event_missing_message(EW, {"title": "Flash Manufacturing PMI"}, "15:45")),
            "news_category": list(ar.news_category_message({"category": "crypto", "urgent_only": False},
                                                           {"title": "Spot bitcoin ETFs", "source": "FinancialJuice",
                                                            "urgent": True})),
        },
    }


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render(), encoding="utf-8")
    print(f"écrit : {OUT.relative_to(ROOT)}")
