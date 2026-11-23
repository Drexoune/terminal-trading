"""Exploration des sources de P2 (écran Taux), à lancer sur le Mac (plan P2, étape R0).

    .venv/bin/python scripts/explore_rates.py

Relève, sans clé et en lecture seule, une requête par seconde au plus par service :
- Polymarket Gamma : événements « décision » des 8 banques centrales, marchés et prix ;
  Polymarket CLOB : historique des prix de la prochaine réunion de chaque banque ;
- Kalshi : séries de taux (KXFED, KXFEDDECISION, KXECB, KXBOJDECISION et autres trouvées
  par mot-clé), événements ouverts ou non, règles de KXFED, bougies de la prochaine réunion,
  en-têtes de limite de débit ;
- BIS : taux directeurs quotidiens des 8 banques sur 400 jours (CSV SDMX) ;
- calendriers officiels des réunions (pages des 8 banques) ;
- dernières pages de décision de la Fed et de la BoE (formulation des votes).

Sortie : data/explore/rates/<date>_probe/ (réponses brutes + events.jsonl) puis une archive
.zip. Les réponses deviennent les fichiers de référence des tests de p2-jobs.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parents[1]
PARIS = ZoneInfo("Europe/Paris")
UA = "TERMINAL/0.1 (terminal personnel, exploration en lecture seule)"
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
BIS = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0"

# Recherche Polymarket par banque : mots de la question, puis filtre sur le titre.
BANKS = {
    "FED": ("fed decision", r"^Fed Decision in "),
    "BCE": ("ecb interest rates", r"^ECB Interest Rates: "),
    "BOE": ("bank of england decision", r"^Bank of England Decision in "),
    "BOJ": ("bank of japan decision", r"^Bank of Japan Decision in "),
    "BNS": ("swiss national bank decision", r"^Swiss National Bank Decision in "),
    "BOC": ("bank of canada decision", r"^Bank of Canada Decision in "),
    "RBA": ("reserve bank of australia decision", r"^Reserve Bank of Australia Decision in "),
    "RBNZ": ("reserve bank of new zealand decision", r"^Reserve Bank of New Zealand Decision in "),
}
BIS_AREAS = {
    "FED": "US",
    "BCE": "XM",
    "BOE": "GB",
    "BOJ": "JP",
    "BNS": "CH",
    "BOC": "CA",
    "RBA": "AU",
    "RBNZ": "NZ",
}
CALENDARS = {
    "FED": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    "BCE": "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
    "BOE": "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
    "BOJ": "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm",
    "BNS": "https://www.snb.ch/en/services-events/digital-services/event-schedule",
    "BOC": "https://www.bankofcanada.ca/press/upcoming-events/",
    "RBA": "https://www.rba.gov.au/schedules-events/board-meeting-schedules.html",
    "RBNZ": "https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/monetary-policy-statements-and-official-cash-rate-dates",
}
KALSHI_SERIES = ["KXFED", "KXFEDDECISION", "KXECB", "KXBOJDECISION"]
KALSHI_WORDS = r"England|BoE|BOE|Canada|BoC|Australia|RBA|Swiss|SNB|Zealand|RBNZ|ECB|Japan|BOJ"
HEADERS_KEPT = {
    "date",
    "content-type",
    "cache-control",
    "age",
    "etag",
    "last-modified",
    "cf-cache-status",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-cost",
    "retry-after",
}


def now_ms() -> int:
    return int(time.time() * 1000)


class Probe:
    def __init__(self) -> None:
        self.dir = ROOT / "data" / "explore" / "rates" / f"{datetime.now(PARIS):%Y-%m-%d}_probe"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = (self.dir / "events.jsonl").open("a", encoding="utf-8")
        self.client = httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": UA})
        self.last: dict[str, float] = {}

    def get(
        self, name: str, url: str, params: dict | None = None, keep: bool = True
    ) -> httpx.Response | None:
        host = httpx.URL(url).host
        wait = self.last.get(host, 0) + 1.0 - time.monotonic()
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
        entry.update(
            status=r.status_code,
            t_recv_ms=now_ms(),
            size=len(body),
            headers={k: v for k, v in r.headers.items() if k.lower() in HEADERS_KEPT},
        )
        if keep and body:
            digest = hashlib.sha256(body).hexdigest()[:12]
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:80]
            ext = (
                "json"
                if "json" in r.headers.get("content-type", "")
                else ("csv" if "csv" in r.headers.get("content-type", "") else "html")
            )
            (self.dir / f"{safe}.{digest}.{ext}").write_bytes(body)
            entry["file"] = f"{safe}.{digest}.{ext}"
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


def polymarket(p: Probe, summary: dict) -> None:
    print("Polymarket", flush=True)
    for bank, (q, title_rx) in BANKS.items():
        r = p.get(
            f"pm-search-{bank}",
            f"{GAMMA}/public-search",
            {"q": q, "limit_per_type": 20, "events_status": "active"},
        )
        if r is None or r.status_code != 200:
            continue
        events = [
            e
            for e in (r.json().get("events") or [])
            if re.search(title_rx, e.get("title", ""), re.I) and not e.get("closed")
        ]
        events.sort(key=lambda e: e.get("endDate") or "")
        summary["polymarket"][bank] = []
        for i, e in enumerate(events[:4]):
            full = p.get(f"pm-event-{bank}-{i}", f"{GAMMA}/events", {"slug": e["slug"]})
            if full is None or full.status_code != 200 or not full.json():
                continue
            ev = full.json()[0]
            markets = [
                {
                    "outcome": m.get("groupItemTitle"),
                    "bid": m.get("bestBid"),
                    "ask": m.get("bestAsk"),
                    "last": m.get("lastTradePrice"),
                    "vol24": m.get("volume24hr"),
                    "token": (json.loads(m.get("clobTokenIds") or "[]") or [None])[0],
                }
                for m in ev.get("markets", [])
            ]
            summary["polymarket"][bank].append(
                {
                    "slug": ev["slug"],
                    "title": ev["title"],
                    "end": ev.get("endDate"),
                    "neg_risk": ev.get("negRisk"),
                    "markets": markets,
                }
            )
            if i == 0:  # historique de la prochaine réunion : 60 jours, pas d'une heure
                end = int(time.time())
                for m in markets:
                    if m["token"]:
                        p.get(
                            f"pm-history-{bank}-{m['outcome']}",
                            f"{CLOB}/prices-history",
                            {
                                "market": m["token"],
                                "startTs": end - 60 * 86400,
                                "endTs": end,
                                "fidelity": 60,
                            },
                        )


def kalshi(p: Probe, summary: dict) -> None:
    print("Kalshi", flush=True)
    r = p.get("k-series-economics", f"{KALSHI}/series", {"category": "Economics"})
    found = []
    if r is not None and r.status_code == 200:
        found = [
            s["ticker"]
            for s in r.json().get("series", [])
            if re.search(KALSHI_WORDS, s.get("title", ""))
        ]
    summary["kalshi"]["series_found"] = found
    for s in dict.fromkeys(KALSHI_SERIES + found):
        p.get(f"k-serie-{s}", f"{KALSHI}/series/{s}")
        for status in ("open", None):
            params = {"series_ticker": s, "with_nested_markets": "true", "limit": 12}
            if status:
                params["status"] = status
            r = p.get(f"k-events-{s}-{status or 'tous'}", f"{KALSHI}/events", params)
            if r is None or r.status_code != 200:
                continue
            evs = r.json().get("events", [])
            summary["kalshi"].setdefault(s, {})[status or "tous"] = [
                {
                    "event": e["event_ticker"],
                    "sub": e.get("sub_title"),
                    "markets": len(e.get("markets", [])),
                    "statuses": sorted({m.get("status") for m in e.get("markets", [])}),
                }
                for e in evs
            ]
    # Règles de KXFED : borne haute de la fourchette ou autre ?
    r = p.get(
        "k-events-KXFED-open-1",
        f"{KALSHI}/events",
        {"series_ticker": "KXFED", "status": "open", "with_nested_markets": "true", "limit": 1},
    )
    if r is not None and r.status_code == 200 and r.json().get("events"):
        m = r.json()["events"][0]["markets"][0]
        p.get(f"k-market-{m['ticker']}", f"{KALSHI}/markets/{m['ticker']}")
    # Bougies de la prochaine décision de la Fed (60 jours, pas horaire).
    r = p.get(
        "k-events-KXFEDDECISION-next",
        f"{KALSHI}/events",
        {
            "series_ticker": "KXFEDDECISION",
            "status": "open",
            "with_nested_markets": "true",
            "limit": 1,
        },
    )
    if r is not None and r.status_code == 200 and r.json().get("events"):
        end = int(time.time())
        for m in r.json()["events"][0]["markets"]:
            p.get(
                f"k-candles-{m['ticker']}",
                f"{KALSHI}/series/KXFEDDECISION/markets/{m['ticker']}/candlesticks",
                {"start_ts": end - 60 * 86400, "end_ts": end, "period_interval": 60},
            )


def bis_and_pages(p: Probe) -> None:
    print("BIS", flush=True)
    start = (datetime.now(UTC) - timedelta(days=400)).strftime("%Y-%m-%d")
    p.get(
        "bis-cbpol",
        f"{BIS}/D.{'+'.join(BIS_AREAS.values())}",
        {"startPeriod": start, "format": "csv"},
    )
    print("Calendriers officiels", flush=True)
    for bank, url in CALENDARS.items():
        p.get(f"cal-{bank}", url)
    print("Pages de décision", flush=True)
    fx = ROOT / "gateway" / "tests" / "fixtures" / "news"
    for bank, feed, title_rx in (
        ("FED", "fed-monetary", r"Federal Reserve issues FOMC statement"),
        ("BOE", "boe-news", r"Bank Rate (?:maintained|reduced|increased|cut|raised)"),
    ):
        xml = (fx / f"{feed}.xml").read_text("utf-8")
        for item in re.findall(r"<item>(.*?)</item>", xml, re.S)[:40]:
            if re.search(title_rx, item, re.I):
                link = re.search(r"<link>\s*(?:<!\[CDATA\[)?\s*(https?://[^\]<\s]+)", item)
                if link:
                    p.get(f"decision-{bank}", link.group(1))
                break


def main() -> None:
    import argparse

    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument(
        "--only", choices=["polymarket", "kalshi", "pages"], help="une seule partie du relevé"
    )
    only = a.parse_args().only
    p = Probe()
    summary: dict = {
        "version": "0.1",
        "started": datetime.now(PARIS).isoformat(),
        "polymarket": {},
        "kalshi": {},
    }
    try:
        if only in (None, "polymarket"):
            polymarket(p, summary)
        if only in (None, "kalshi"):
            kalshi(p, summary)
        if only in (None, "pages"):
            bis_and_pages(p)
    finally:
        if only is None:
            (p.dir / "summary.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=1), "utf-8"
            )
        target = p.close()
    print(f"\nArchive : {target.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
