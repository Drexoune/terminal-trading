"""Fichier doré des calculs de P1 (plan « Tout en ligne », étape O3).

Fige les sorties de gateway/terminal_gateway/bls_api.py (chiffres recalculés depuis l'API
v1, sur la réponse réelle du 23/11/2026) et de surprise.py (surprise brute, z) sur des cas
fixes. Les portages TypeScript (supabase/functions/p1-jobs/bls_api.ts, surprise.ts) doivent
redonner exactement ce fichier (p1_math.test.ts) ; gateway/tests/test_p1_math_golden.py
vérifie qu'il suit le code Python. Après une modification voulue :

    .venv/bin/python scripts/make_p1_math_golden.py
"""

from __future__ import annotations

import gzip
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gateway"))

from terminal_gateway import bls_api  # noqa: E402
from terminal_gateway.surprise import raw_surprise, z_score  # noqa: E402

FIX = ROOT / "gateway" / "tests" / "fixtures" / "bls"
OUT = FIX / "golden_math.json"
SURPRISES = [("0.4", "0.3"), ("0.3", "0.3"), ("-0.1", "0.2"), ("165", "50"), ("4.1", "4.25"),
             ("-23", "-50"), ("0.0", "-0.0"), ("3.6", "4.0"), ("0.4", None), (None, "0.3"),
             ("0.4", "n/a"), ("0.10", "0.1"), ("-0.15", "-0.05")]


def z_cases() -> list:
    rnd = random.Random(20261123)
    out = []
    for n in (0, 7, 8, 9, 12, 23, 24, 30):
        for _ in range(3):
            hist = [f"{rnd.randint(-30, 30) / 10:.1f}" for _ in range(n)]
            out.append([f"{rnd.randint(-20, 20) / 10:.1f}", hist, "0.4"])
    out.append(["0.1", ["0.0"] * 8, "0.4"])          # sigma nul : plancher 0.05
    out.append(["5", ["0"] * 10, "165"])              # plancher 0.5 (milliers)
    out.append([None, ["0.1"] * 10, "0.4"])            # sans prévision
    out.append(["-0.001", ["0.1", "-0.1"] * 5, "0.4"])  # z = -0.00 (signe gardé)
    return out


def build() -> dict:
    data = bls_api.parse_response(gzip.decompress((FIX / "api_v1_2026-11-23.json.gz").read_bytes()))
    derive = {}
    for ind, (sid, _) in sorted(bls_api.DERIVATIONS.items()):
        derive[ind] = {}
        for period in sorted(data.series[sid]):
            d = bls_api.derive(ind, period, data)
            derive[ind][period] = [d.value, d.excerpt] if d else None
    zs = []
    for s, hist, actual in z_cases():
        z = z_score(s, hist, actual)
        zs.append([s, hist, actual, z.z, z.n, z.provisional, z.reason])
    return {
        "_comment": "Généré par scripts/make_p1_math_golden.py ; ne pas modifier à la main.",
        "latest": data.latest,
        "derive": derive,
        "shift": [[p, k, bls_api.shift(p, k)] for p, k in (("2026-01", -1), ("2026-10", -12),
                                                           ("2026-Q1", -1), ("2026-Q4", 1),
                                                           ("2026-12", 1))],
        "surprise": [[a, f, raw_surprise(a, f)] for a, f in SURPRISES],
        "z": zs,
    }


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render(), encoding="utf-8")
    print(f"écrit : {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} ko)")
