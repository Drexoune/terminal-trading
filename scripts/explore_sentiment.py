"""Exploration des sources de P4 (sentiment et liquidité), à lancer sur le Mac (plan P4, étape S0).

    .venv/bin/python scripts/explore_sentiment.py [--only fred|tiingo|okx|cftc|crowding]

Relève, en lecture seule, une requête par source, la profondeur d'historique et la fraîcheur :

- FRED (fredgraph.csv, sans clé) : VIX, S&P 500, écart de crédit haut rendement, 10 ans, bilan de
  la Fed (WALCL), compte du Trésor (WTREGEN), reverse repo (RRPONTSYD) et leurs unités.
- Tiingo (clé TIINGO_API_KEY lue dans l'environnement, jamais écrite) : clôtures quotidiennes
  SPY, TLT, CPER, GLD (/tiingo/daily) et historique quotidien AUD/JPY (/tiingo/fx/.../prices).
  Sans clé sur le Mac : ignoré, la sonde depuis Supabase (p4-jobs, tâche explore) le couvre.
- OKX : bougies quotidiennes BTC et ETH (history-candles, 100 par page), profondeur sur un an.
- CFTC : catalogue Socrata de publicreporting.cftc.gov (identifiants des jeux), Traders in
  Financial Futures et rapport « legacy » (dernière date), page du Bank Participation Report.
- Binance, OKX, Bybit : ratios long/short (comptes, gros comptes), financement, profondeur.

Les clés n'apparaissent jamais dans les fichiers (remplacées par « <clé> »). Sortie :
data/explore/sentiment/<date>_probe/ (réponses brutes, events.jsonl, summary.json) puis un .zip.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parents[1]
PARIS = ZoneInfo("Europe/Paris")
UA = "TERMINAL/0.1 (terminal personnel, exploration en lecture seule)"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
TIINGO = "https://api.tiingo.com"
OKX = "https://www.okx.com"
CFTC = "https://publicreporting.cftc.gov"
BINANCE_F = "https://fapi.binance.com"
BYBIT = "https://api.bybit.com"
SPACING = {"api.tiingo.com": 1.5, "www.okx.com": 0.3}

FRED_SERIES = ["VIXCLS", "SP500", "BAMLH0A0HYM2", "DGS10", "WALCL", "WTREGEN", "RRPONTSYD"]
TIINGO_EOD = ["SPY", "TLT", "CPER", "GLD"]
HEADERS_KEPT = {
    "date",
    "content-type",
    "cache-control",
    "last-modified",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-mbx-used-weight-1m",
    "x-bapi-limit-status",
}


def now_ms() -> int:
    return int(time.time() * 1000)


def iso_day(ms: int | str) -> str:
    return datetime.fromtimestamp(int(ms) / 1000, UTC).strftime("%Y-%m-%d %H:%M")


class Probe:
    def __init__(self) -> None:
        self.dir = ROOT / "data" / "explore" / "sentiment" / f"{datetime.now(PARIS):%Y-%m-%d}_probe"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = (self.dir / "events.jsonl").open("a", encoding="utf-8")
        self.client = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": UA})
        self.last: dict[str, float] = {}
        self.secrets = [v for v in (os.environ.get("TIINGO_API_KEY"),) if v and len(v) >= 6]

    def scrub(self, text: str) -> str:
        for v in self.secrets:
            text = text.replace(v, "<clé>")
        return text

    def get(
        self, name: str, url: str, params: dict | None = None, headers: dict | None = None
    ) -> httpx.Response | None:
        host = httpx.URL(url).host
        wait = self.last.get(host, 0) + SPACING.get(host, 1.0) - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last[host] = time.monotonic()
        entry: dict = {"name": name, "url": url, "params": params, "t_send_ms": now_ms()}
        try:
            r = self.client.get(url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            entry.update(error=self.scrub(repr(exc)), t_recv_ms=now_ms())
            self.log.write(json.dumps(entry, ensure_ascii=False) + "\n")
            print(f"  {name} : erreur {self.scrub(repr(exc))}", flush=True)
            return None
        body = self.scrub(r.text).encode()
        digest = hashlib.sha256(body).hexdigest()[:12]
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:80]
        ext = "json" if "json" in r.headers.get("content-type", "") else "txt"
        (self.dir / f"{safe}.{digest}.{ext}").write_bytes(body)
        entry.update(
            status=r.status_code,
            t_recv_ms=now_ms(),
            size=len(body),
            file=f"{safe}.{digest}.{ext}",
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


def ok_json(r: httpx.Response | None):
    if r is None or r.status_code != 200:
        return None
    try:
        return r.json()
    except ValueError:
        return None


def status_of(r: httpx.Response | None) -> dict:
    return {
        "status": None if r is None else r.status_code,
        "body": "" if r is None else r.text[:160],
    }


def fred(p: Probe, s: dict) -> None:
    print("FRED", flush=True)
    for sid in FRED_SERIES:
        r = p.get(f"fred-{sid}", FRED, {"id": sid})
        if r is None or r.status_code != 200:
            s["fred"][sid] = status_of(r)
            continue
        rows = [ln.split(",") for ln in r.text.strip().splitlines()[1:]]
        rows = [x for x in rows if len(x) == 2 and x[1] not in ("", ".")]
        s["fred"][sid] = {
            "first": rows[0][0] if rows else None,
            "last": rows[-1] if rows else None,
            "count": len(rows),
            "header": r.text.splitlines()[0],
        }


def tiingo(p: Probe, s: dict) -> None:
    print("Tiingo", flush=True)
    key = os.environ.get("TIINGO_API_KEY")
    if not key:
        s["tiingo"] = "TIINGO_API_KEY absente sur le Mac : voir la sonde p4-jobs depuis Supabase"
        print("  ignoré (pas de clé)", flush=True)
        return
    auth = {"Authorization": f"Token {key}"}
    for t in TIINGO_EOD:
        r = p.get(
            f"tiingo-eod-{t}",
            f"{TIINGO}/tiingo/daily/{t}/prices",
            {"startDate": "2025-10-01"},
            auth,
        )
        d = ok_json(r)
        s["tiingo"][t] = (
            {"count": len(d), "first": d[0], "last": d[-1]}
            if isinstance(d, list) and d
            else status_of(r)
        )
    r = p.get(
        "tiingo-fx-audjpy",
        f"{TIINGO}/tiingo/fx/audjpy/prices",
        {"startDate": "2025-10-01", "resampleFreq": "1day"},
        auth,
    )
    d = ok_json(r)
    s["tiingo"]["audjpy"] = (
        {"count": len(d), "first": d[0], "last": d[-1]}
        if isinstance(d, list) and d
        else status_of(r)
    )


def okx(p: Probe, s: dict) -> None:
    print("OKX bougies", flush=True)
    for inst in ("BTC-USDT", "ETH-USDT"):
        rows: list = []
        after = None
        for page in range(4):  # 4 pages de 100 bougies : plus d'un an
            params = {"instId": inst, "bar": "1Dutc", "limit": "100"}
            if after:
                params["after"] = after
            r = p.get(f"okx-candles-{inst}-p{page}", f"{OKX}/api/v5/market/history-candles", params)
            d = ok_json(r)
            data = (d or {}).get("data") or []
            if not data:
                break
            rows += data
            after = data[-1][0]
        s["okx"][inst] = {
            "count": len(rows),
            "newest": [iso_day(rows[0][0]), *rows[0][1:]] if rows else None,
            "oldest": iso_day(rows[-1][0]) if rows else None,
        }


def cftc(p: Probe, s: dict) -> None:
    print("CFTC", flush=True)
    # Le catalogue Socrata ne liste pas ce domaine (réponse vide le 24/11/2026). Identifiants
    # confirmés par leurs métadonnées (/api/views/<id>.json, champ « name »), relevées ici aussi.
    wanted = {
        "tff-futures": "gpe5-46if",
        "tff-combined": "yw9f-hn96",
        "legacy-futures": "6dca-aqww",
    }
    for label, rid in wanted.items():
        r = p.get(f"cftc-{label}-meta", f"{CFTC}/api/views/{rid}.json")
        meta = ok_json(r) or {}
        s["cftc"][f"{label}-meta"] = {
            "name": meta.get("name"),
            "rowsUpdatedAt": iso_day(meta["rowsUpdatedAt"] * 1000)
            if meta.get("rowsUpdatedAt")
            else None,
        }
        r = p.get(
            f"cftc-{label}",
            f"{CFTC}/resource/{rid}.json",
            {
                "$where": "upper(market_and_exchange_names) like '%BITCOIN%' "
                "or upper(market_and_exchange_names) like '%EURO FX%' "
                "or upper(market_and_exchange_names) like '%E-MINI S&P 500%'",
                "$order": "report_date_as_yyyy_mm_dd DESC",
                "$limit": "12",
            },
        )
        rows = ok_json(r)
        s["cftc"][label] = (
            {
                "id": rid,
                "rows": [
                    [x.get("market_and_exchange_names"), x.get("report_date_as_yyyy_mm_dd")]
                    for x in rows
                ],
                "columns": sorted(rows[0].keys()) if rows else [],
            }
            if isinstance(rows, list)
            else {"id": rid, **status_of(r)}
        )
    r = p.get(
        "cftc-bpr-index", "https://www.cftc.gov/MarketReports/BankParticipationReports/index.htm"
    )
    if r is not None and r.status_code == 200:
        links = sorted(
            set(re.findall(r'href="([^"]*Bank[^"]*|[^"]*(?:fut|opt)\d{4}[^"]*)"', r.text))
        )
        s["cftc"]["bpr"] = {"links": links}
    else:
        s["cftc"]["bpr"] = status_of(r)


def crowding(p: Probe, s: dict) -> None:
    print("Ratios long/short et financement", flush=True)
    c = s["crowding"]

    def span(name: str, rows: list, ts_key, fields: list[str]) -> None:
        if not rows:
            c[name] = "vide"
            return
        ts = [int(ts_key(x)) for x in rows]
        c[name] = {
            "count": len(rows),
            "oldest": iso_day(min(ts)),
            "newest": iso_day(max(ts)),
            "sample": {f: rows[0].get(f) if isinstance(rows[0], dict) else None for f in fields},
        }

    # Binance USDⓈ-M : 30 jours d'historique au plus selon la documentation.
    for path, label in (
        ("globalLongShortAccountRatio", "binance-global-account"),
        ("topLongShortAccountRatio", "binance-top-account"),
        ("topLongShortPositionRatio", "binance-top-position"),
    ):
        r = p.get(
            label,
            f"{BINANCE_F}/futures/data/{path}",
            {"symbol": "BTCUSDT", "period": "1h", "limit": "500"},
        )
        d = ok_json(r)
        if isinstance(d, list):
            span(
                label,
                d,
                lambda x: x["timestamp"],
                ["longShortRatio", "longAccount", "shortAccount"],
            )
        else:
            c[label] = status_of(r)
    r = p.get("binance-premium-index", f"{BINANCE_F}/fapi/v1/premiumIndex", {"symbol": "BTCUSDT"})
    c["binance-premium-index"] = ok_json(r) or status_of(r)

    # OKX : statistiques « rubik ».
    for path, params, label in (
        (
            "/api/v5/rubik/stat/contracts/long-short-account-ratio",
            {"ccy": "BTC", "period": "1H"},
            "okx-account-ratio",
        ),
        (
            "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract",
            {"instId": "BTC-USDT-SWAP", "period": "1H", "limit": "100"},
            "okx-account-ratio-contract",
        ),
        (
            "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader",
            {"instId": "BTC-USDT-SWAP", "period": "1H", "limit": "100"},
            "okx-top-trader-account",
        ),
        (
            "/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader",
            {"instId": "BTC-USDT-SWAP", "period": "1H", "limit": "100"},
            "okx-top-trader-position",
        ),
    ):
        r = p.get(label, f"{OKX}{path}", params)
        d = ok_json(r) or {}
        if d.get("code") == "0":
            rows = d.get("data") or []
            c[label] = {
                "count": len(rows),
                "newest": [iso_day(rows[0][0]), *rows[0][1:]] if rows else None,
                "oldest": iso_day(rows[-1][0]) if rows else None,
            }
        else:
            c[label] = d or status_of(r)
    r = p.get("okx-funding", f"{OKX}/api/v5/public/funding-rate", {"instId": "BTC-USDT-SWAP"})
    c["okx-funding"] = (ok_json(r) or {}).get("data") or status_of(r)

    # Bybit v5.
    r = p.get(
        "bybit-account-ratio",
        f"{BYBIT}/v5/market/account-ratio",
        {"category": "linear", "symbol": "BTCUSDT", "period": "1h", "limit": "500"},
    )
    d = ok_json(r) or {}
    rows = (d.get("result") or {}).get("list") or []
    if d.get("retCode") == 0:
        span("bybit-account-ratio", rows, lambda x: x["timestamp"], ["buyRatio", "sellRatio"])
    else:
        c["bybit-account-ratio"] = d or status_of(r)
    r = p.get(
        "bybit-ticker", f"{BYBIT}/v5/market/tickers", {"category": "linear", "symbol": "BTCUSDT"}
    )
    d = ok_json(r) or {}
    t = ((d.get("result") or {}).get("list") or [{}])[0]
    c["bybit-ticker"] = {
        k: t.get(k) for k in ("fundingRate", "nextFundingTime", "openInterest")
    } or status_of(r)


PARTS = {"fred": fred, "tiingo": tiingo, "okx": okx, "cftc": cftc, "crowding": crowding}


def main() -> None:
    import argparse

    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("--only", choices=list(PARTS), help="une seule source")
    only = a.parse_args().only
    p = Probe()
    summary: dict = {"version": "0.1", "started": datetime.now(PARIS).isoformat()}
    summary.update({k: {} for k in PARTS})
    try:
        for part, fn in PARTS.items():
            if only in (None, part):
                fn(p, summary)
    finally:
        (p.dir / f"summary{'-' + only if only else ''}.json").write_text(
            p.scrub(json.dumps(summary, ensure_ascii=False, indent=1)), "utf-8"
        )
        target = p.close()
    print(f"\nArchive : {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
