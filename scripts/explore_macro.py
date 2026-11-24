"""Exploration des sources de P3 (macro et heatmap), à lancer sur le Mac (plan P3, étape M0).

    .venv/bin/python scripts/explore_macro.py [--only oecd|ecb|fred|bis]

Relève, sans clé et en lecture seule, pour les 8 économies (États-Unis, zone euro, Royaume-Uni,
Japon, Suisse, Canada, Australie, Nouvelle-Zélande) la première et la dernière période de chaque
indicateur candidat, depuis janvier 2005 :

- OECD (API SDMX directe, sdmx.oecd.org) : IPC global et sous-jacent (COICOP 1999 et 2018),
  chômage mensuel, PIB trimestriel (volume, sur un an), confiance des consommateurs, indicateurs
  clés (ventes au détail). Limite publiée : 60 téléchargements par heure (20 selon une autre page
  de l'OCDE) : 10 requêtes au plus par passage, 2 s entre deux requêtes.
- BCE (data-api.ecb.europa.eu) : zone euro, IPCH (jeu « HICP » depuis 2026), chômage et PIB
  (composition à 21 pays, code I10).
- FRED (fredgraph.csv, sans clé) : séries américaines et changes contre le dollar (backtest).
- BIS (WS_CBPOL, fréquence mensuelle) : taux directeurs sur 20 ans.

Pourquoi : la copie de l'OCDE chez DBnomics n'est plus mise à jour depuis le 16/06/2026
(docs/exploration-p3.md § 1). Sortie : data/explore/macro/<date>_probe/ (réponses brutes,
events.jsonl, summary.json) puis une archive .zip.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parents[1]
PARIS = ZoneInfo("Europe/Paris")
UA = "TERMINAL/0.1 (terminal personnel, exploration en lecture seule)"
OECD = "https://sdmx.oecd.org/public/rest/data"
ECB = "https://data-api.ecb.europa.eu/service/data"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
BIS = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0"
START = "2005-01"
AREAS = "USA+EA20+GBR+JPN+CHE+CAN+AUS+NZL"
SPACING = {"sdmx.oecd.org": 2.0}

# OECD : (nom, flux, clé, colonnes qui distinguent les séries). Clés relevées le 24/11/2026.
OECD_QUERIES = [
    (
        "oecd-cpi-1999",
        "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
        f"{AREAS}.M+Q.N.CPI.PA._T+_TXCP01_NRG.N.GY",
        ["FREQ", "EXPENDITURE"],
    ),
    (
        "oecd-cpi-2018",
        "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0",
        f"{AREAS}.M+Q.N.CPI.._T+_TXCP01_NRG..GY",
        ["FREQ", "EXPENDITURE"],
    ),
    (
        "oecd-unemployment",
        "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
        f"{AREAS}.UNE_LF_M...Y._T.Y_GE15..",
        ["FREQ"],
    ),
    (
        "oecd-gdp",
        "OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA,1.1",
        f"Q.Y.{AREAS}.S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102",
        ["FREQ"],
    ),
    (
        "oecd-confidence",
        "OECD.SDD.STES,DSD_STES@DF_CS,4.0",
        f"{AREAS}..CCICP......",
        ["FREQ", "UNIT_MEASURE"],
    ),
    (
        "oecd-kei",
        "OECD.SDD.STES,DSD_KEI@DF_KEI,4.0",
        f"{AREAS}.M.........",
        ["MEASURE", "UNIT_MEASURE", "TRANSFORMATION"],
    ),
]
ECB_SERIES = {
    "ecb-hicp": "HICP/M.U2.N.000000.4D0.ANR",
    "ecb-hicp-core": "HICP/M.U2.N.XEF000.4D0.ANR",
    "ecb-unemployment": "LFSI/M.I10.S.UNEHRT.TOTAL0.15_74.T",
    "ecb-gdp": "MNA/Q.Y.I10.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.GY",
}
FRED_SERIES = [
    "CPIAUCSL",
    "CPILFESL",
    "UNRATE",
    "GDPC1",
    "UMCSENT",
    "RSAFS",
    "DEXUSEU",
    "DEXJPUS",
    "DEXUSUK",
    "DEXSZUS",
    "DEXCAUS",
    "DEXUSAL",
    "DEXUSNZ",
]
HEADERS_KEPT = {
    "date",
    "content-type",
    "cache-control",
    "age",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "cf-cache-status",
}


def now_ms() -> int:
    return int(time.time() * 1000)


class Probe:
    def __init__(self) -> None:
        self.dir = ROOT / "data" / "explore" / "macro" / f"{datetime.now(PARIS):%Y-%m-%d}_probe"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = (self.dir / "events.jsonl").open("a", encoding="utf-8")
        self.client = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": UA})
        self.last: dict[str, float] = {}

    def get(self, name: str, url: str, params: dict | None = None) -> httpx.Response | None:
        host = httpx.URL(url).host
        wait = self.last.get(host, 0) + SPACING.get(host, 1.0) - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last[host] = time.monotonic()
        entry: dict = {"name": name, "url": url, "params": params, "t_send_ms": now_ms()}
        try:
            r = self.client.get(url, params=params)
        except httpx.HTTPError as exc:
            entry.update(error=repr(exc), t_recv_ms=now_ms())
            self.log.write(json.dumps(entry, ensure_ascii=False) + "\n")
            print(f"  {name} : erreur {exc!r}", flush=True)
            return None
        body = r.content
        digest = hashlib.sha256(body).hexdigest()[:12]
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:80]
        (self.dir / f"{safe}.{digest}.csv").write_bytes(body)
        entry.update(
            status=r.status_code,
            t_recv_ms=now_ms(),
            size=len(body),
            file=f"{safe}.{digest}.csv",
            headers={k: v for k, v in r.headers.items() if k.lower() in HEADERS_KEPT},
        )
        self.log.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.log.flush()
        print(
            f"  {name} : HTTP {r.status_code}, {len(body)} octets, "
            f"{entry['t_recv_ms'] - entry['t_send_ms']} ms",
            flush=True,
        )
        return r

    def close(self) -> Path:
        self.log.close()
        self.client.close()
        target = self.dir.with_suffix(".zip")
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(self.dir.iterdir()):
                z.write(p, f"{self.dir.name}/{p.name}")
        return target


def spans(text: str, keys: list[str], area_col: str = "REF_AREA") -> dict[str, list]:
    """CSV SDMX -> {zone|clés : [première période, dernière période, dernière valeur]}."""
    out: dict[str, list] = {}
    for r in csv.DictReader(io.StringIO(text)):
        if not r.get("OBS_VALUE"):
            continue
        k = "|".join([r.get(area_col, "?"), *(r.get(c, "") for c in keys)])
        t = r["TIME_PERIOD"]
        cur = out.setdefault(k, [t, t, r["OBS_VALUE"]])
        cur[0] = min(cur[0], t)
        if t >= cur[1]:
            cur[1], cur[2] = t, r["OBS_VALUE"]
    return out


def oecd(p: Probe, summary: dict) -> None:
    print("OCDE", flush=True)
    for name, flow, key, cols in OECD_QUERIES:
        r = p.get(
            name,
            f"{OECD}/{flow}/{key}",
            {
                "startPeriod": START,
                "dimensionAtObservation": "AllDimensions",
                "format": "csvfilewithlabels",
            },
        )
        summary["oecd"][name] = (
            spans(r.text, cols)
            if r is not None and r.status_code == 200
            else {
                "status": None if r is None else r.status_code,
                "body": "" if r is None else r.text[:120],
            }
        )


def ecb(p: Probe, summary: dict) -> None:
    print("BCE", flush=True)
    for name, key in ECB_SERIES.items():
        r = p.get(name, f"{ECB}/{key}", {"format": "csvdata", "startPeriod": START})
        ok = r is not None and r.status_code == 200 and r.text.startswith("KEY")
        summary["ecb"][name] = (
            spans(r.text, []) if ok else {"status": None if r is None else r.status_code}
        )


def fred(p: Probe, summary: dict) -> None:
    print("FRED", flush=True)
    for sid in FRED_SERIES:
        r = p.get(f"fred-{sid}", FRED, {"id": sid})
        if r is None or r.status_code != 200:
            summary["fred"][sid] = {"status": None if r is None else r.status_code}
            continue
        rows = [ln.split(",") for ln in r.text.strip().splitlines()[1:]]
        rows = [x for x in rows if len(x) == 2 and x[1] not in ("", ".") and x[0] >= START]
        summary["fred"][sid] = [rows[0][0], rows[-1][0], rows[-1][1]] if rows else "vide"


def bis(p: Probe, summary: dict) -> None:
    print("BIS", flush=True)
    r = p.get(
        "bis-cbpol-monthly",
        f"{BIS}/M.US+XM+GB+JP+CH+CA+AU+NZ",
        {"startPeriod": START, "format": "csv"},
    )
    out: dict[str, list] = {}
    if r is not None and r.status_code == 200:
        # Champs entre guillemets avec virgules : date et valeur lues par la fin de la ligne.
        for line in r.text.splitlines()[1:]:
            m = re.search(r",(\d{4}-\d{2}),(-?[\d.]+),[A-Z]?,[A-Z]?,[^,]*$", line)
            if not m:
                continue
            cur = out.setdefault(line.split(",")[1], [m.group(1), m.group(1), m.group(2)])
            cur[0] = min(cur[0], m.group(1))
            if m.group(1) >= cur[1]:
                cur[1], cur[2] = m.group(1), m.group(2)
    summary["bis"] = out


def main() -> None:
    import argparse

    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("--only", choices=["oecd", "ecb", "fred", "bis"], help="une seule source")
    only = a.parse_args().only
    p = Probe()
    summary: dict = {
        "version": "0.1",
        "started": datetime.now(PARIS).isoformat(),
        "start_period": START,
        "oecd": {},
        "ecb": {},
        "fred": {},
        "bis": {},
    }
    try:
        for part, fn in (("oecd", oecd), ("ecb", ecb), ("fred", fred), ("bis", bis)):
            if only in (None, part):
                fn(p, summary)
    finally:
        (p.dir / f"summary{'-' + only if only else ''}.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=1), "utf-8"
        )
        target = p.close()
    print(f"\nArchive : {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
