"""Fichier doré du parseur BLS (plan « Tout en ligne », étape O3).

Fige TOUTE la lecture de gateway/terminal_gateway/bls_release.py sur le corpus réel du
20/11/2026 (124 pages : 120 communiqués archivés et 4 pages résumé) : titre, période,
édition, embargo, problèmes, et pour chaque chiffre la valeur, la raison, la partie lue,
la citation et les marques. Le portage TypeScript (supabase/functions/p1-jobs/bls_release.ts)
doit redonner exactement ce fichier (bls_release.test.ts) ; gateway/tests/test_bls_golden.py
vérifie qu'il suit le code Python. Après une modification voulue du parseur Python :

    .venv/bin/python scripts/make_bls_golden.py
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gateway"))

from terminal_gateway.bls_release import classify, parse_page  # noqa: E402

FIX = ROOT / "gateway" / "tests" / "fixtures" / "bls"
OUT = FIX / "golden_parser.json"
# Cas de classify : (page, date attendue, référence) -> verdict.
CLASSIFY = [
    ("cpi_nr0_2026-11-20", "2026-11-10", None),
    ("cpi_nr0_2026-11-20", "2026-11-10", ["2026-10", "2026-11-10"]),
    ("cpi_nr0_2026-11-20", "2026-11-12", ["2026-09", "2026-10-15"]),
    ("cpi_nr0_2026-11-20", "2026-11-05", ["2026-09", "2026-10-15"]),
    ("cpi_nr0_2026-11-20", "2026-11-12", None),
]


def figures(p) -> dict:
    return {k: {"value": f.value, "reason": f.reason, "part": f.part, "excerpt": f.excerpt,
                "flags": list(f.flags)} for k, f in sorted(p.figures.items())}


def build() -> dict:
    raw = gzip.decompress((FIX / "releases_2026-11-20.json.gz").read_bytes())
    pages: dict[str, str] = json.loads(raw)
    out: dict = {"_comment": "Généré par scripts/make_bls_golden.py ; ne pas modifier à la main.",
                 "pages": {}, "classify": [], "special": {}}
    for name in sorted(pages):
        p = parse_page(name.split("_")[0], pages[name].encode())
        out["pages"][name] = {"page": p.page, "title": p.title, "period": p.period,
                              "edition": p.edition, "embargo_text": p.embargo_text,
                              "embargo_ms": p.embargo_ms, "embargo_date": p.embargo_date,
                              "problems": p.problems, "figures": figures(p)}
    for name, date, base in CLASSIFY:
        p = parse_page(name.split("_")[0], pages[name].encode())
        out["classify"].append([name, date, base, classify(p, date, tuple(base) if base else None)])
    for label, raw in (("vide", b"  \n"), ("octets nuls", b"<html>\x00\x00</html>"),
                       ("erreur", b"<html><title>Sorry, the page cannot be found</title></html>"),
                       ("sans pre", b"<html><title>Consumer Price Index</title><p>x</p></html>")):
        p = parse_page("cpi", raw)
        out["special"][label] = {"page": p.page, "problems": p.problems}
    return out


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render(), encoding="utf-8")
    print(f"écrit : {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} ko)")
