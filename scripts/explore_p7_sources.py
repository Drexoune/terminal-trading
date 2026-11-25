"""Exploration des sources gratuites de P7 hors Deribit (étape S0, T-075).

    .venv/bin/python scripts/explore_p7_sources.py

Lecture seule, sans clé. Affiche le statut HTTP, la taille, le type et un extrait de chaque
réponse, pour décider si une source est utilisable :

- recherche bancaire : flux RSS publics et documentés (ING THINK).

Les pages JSON non documentées du site de CME ne sont pas sondées : aucune documentation ni
autorisation publique, et on ne se fait jamais passer pour un navigateur.

Sortie : data/explore/p7/<date>_sources/*.txt.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

import certifi
import httpx

ROOT = Path(__file__).resolve().parents[1]
UA = "TERMINAL/0.1 (terminal personnel, exploration en lecture seule)"

PROBES = {
    "ing_rss": "https://think.ing.com/rss/",
}


def main() -> None:
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H%M")
    out = ROOT / "data/explore/p7" / f"{stamp}_sources"
    out.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=20, follow_redirects=True, verify=certifi.where()) as c:
        for name, url in PROBES.items():
            try:
                r = c.get(url, headers={"User-Agent": UA, "Accept": "*/*"})
            except httpx.HTTPError as e:
                print(f"[{name}] erreur {type(e).__name__}: {e}")
                continue
            ctype = r.headers.get("content-type", "")
            text = r.text
            (out / f"{name}.txt").write_text(text[:500_000])
            titles = re.findall(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", text)[:8]
            dates = re.findall(r"<pubDate>(.*?)</pubDate>", text)[:3]
            print(f"[{name}] HTTP {r.status_code} {len(r.content) // 1024} Kio {ctype}")
            print(f"   {text.count('<item>')} articles ; titres :", titles, "dates :", dates)
    print("sortie :", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
