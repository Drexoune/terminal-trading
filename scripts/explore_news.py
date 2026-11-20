"""Exploration des sources du fil d'actus P1, à lancer sur le Mac (décision T-024).

    python scripts/explore_news.py rss
        une lecture de chaque flux RSS (banques centrales, FinancialJuice),
        2 s d'écart : format, nombre d'éléments, champs de date, en-têtes.

    python scripts/explore_news.py watch --minutes 30
        surveillance : Tree of Alpha par WebSocket, sans clé (T-021), et
        FinancialJuice relu toutes les 60 s. Chaque titre est noté avec son
        heure source et son heure de réception, pour mesurer le délai réel.
        Le jour d'une publication, lancer vers 14:20 Paris, en même temps que
        la rafale de scripts/explore_bls.py.

    python scripts/explore_news.py watch --minutes 4320 --no-fj
        Tree of Alpha seul pendant 3 jours : volume et délai du flux gratuit.

Sortie : data/explore/news/<date>_<mode>/ puis une archive .zip à renvoyer
dans la conversation. Aucune clé n'est utilisée ni enregistrée.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import os
import statistics
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import websockets


def ws_ssl_context():
    """Contexte TLS du collecteur OKX : SSL_CERT_FILE ou SSL_CERT_DIR, sinon certifi."""
    from terminal_collectors.okx.ws import ssl_context
    return ssl_context()

ROOT = Path(__file__).resolve().parents[1]
PARIS = ZoneInfo("Europe/Paris")
VERSION = "0.1"

# Flux relevés sur de vraies captures (recherche du 27/10/2026, docs/plan-p1.md § 9).
FEEDS: dict[str, str] = {
    "fed-monetary": "https://www.federalreserve.gov/feeds/press_monetary.xml",
    "fed-all": "https://www.federalreserve.gov/feeds/press_all.xml",
    "fed-speeches": "https://www.federalreserve.gov/feeds/speeches.xml",
    "ecb-press": "https://www.ecb.europa.eu/rss/press.html",
    "ecb-mid": "https://mid.ecb.europa.eu/rss/mid.xml",
    "boe-news": "https://www.bankofengland.co.uk/rss/news",
    "boe-speeches": "https://www.bankofengland.co.uk/rss/speeches",
    "boj-whatsnew": "https://www.boj.or.jp/en/rss/whatsnew.xml",
    "snb-pressrel": "https://www.snb.ch/public/rss/en/pressrel",
    "snb-mopo": "https://www.snb.ch/public/rss/en/mopo",
    "boc-press": "https://www.bankofcanada.ca/content_type/press-releases/feed/",
    "boc-announcements": "https://www.bankofcanada.ca/content_type/announcements/feed/",
    "rba-media": "https://www.rba.gov.au/rss/rss-cb-media-releases.xml",
    "rbnz-news": "https://www.rbnz.govt.nz/feeds/news",
    "financialjuice": "https://www.financialjuice.com/feed.ashx?xy=rss",
}
TREE_WS = "wss://news.treeofalpha.com/ws"
HEADERS_KEPT = ("date", "last-modified", "etag", "cache-control", "age", "content-type",
                "content-length", "server", "x-cache", "cf-cache-status")
DC = "{http://purl.org/dc/elements/1.1/}"
RSS1 = "{http://purl.org/rss/1.0/}"


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def user_agent() -> str:
    email = (os.environ.get("BLS_CONTACT_EMAIL") or "").strip()
    return f"terminal-trading/{VERSION}" + (f" ({email})" if "@" in email else "")


def _ms(value: str | None) -> int | None:
    """Date RSS (RFC 822) ou ISO 8601 en ms UTC ; None si absente, illisible ou sans fuseau."""
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        return None
    return int(dt.timestamp() * 1000)


def summarize_feed(body: bytes) -> dict:
    """Forme du flux telle qu'un parseur la verra : racine, éléments, champs de date."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        return {"parse_error": str(exc)[:200]}
    items = root.findall("./channel/item") or root.findall(f"./{RSS1}item") \
        or root.findall("./{http://www.w3.org/2005/Atom}entry")
    out: dict = {"root": root.tag.split("}")[-1], "version": root.get("version"),
                 "items": len(items),
                 "channel_pubdate": (root.findtext("./channel/pubDate") or "").strip() or None}
    sample = []
    for it in items[:5]:
        title = (it.findtext("title") or it.findtext(f"{RSS1}title") or "").strip()
        pub = it.findtext("pubDate")
        dcdate = it.findtext(f"{DC}date")
        sample.append({"title": title[:160], "pubDate": pub, "dc_date": dcdate,
                       "pub_ms": _ms(pub) or _ms(dcdate),
                       "link": (it.findtext("link") or it.findtext(f"{RSS1}link") or "")
                       .strip()[:200],
                       "guid": (it.findtext("guid") or "").strip()[:120] or None})
    out["sample"] = sample
    return out


class Recorder:
    def __init__(self, out: Path, tag: str) -> None:
        self.dir = out / f"{datetime.now(PARIS):%Y-%m-%d}_{tag}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._log = (self.dir / "events.jsonl").open("a", encoding="utf-8")
        self._seen: set[str] = set()

    def write(self, rec: dict, body: bytes | None = None, name: str | None = None) -> None:
        if body:
            digest = hashlib.sha256(body).hexdigest()[:16]
            rec["sha256_16"] = digest
            if digest not in self._seen:
                self._seen.add(digest)
                (self.dir / f"{name or 'body'}.{digest}").write_bytes(body)
        self._log.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._log.flush()

    def close_and_zip(self) -> Path:
        self._log.close()
        target = self.dir.with_suffix(".zip")
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(self.dir.iterdir()):
                z.write(p, f"{self.dir.name}/{p.name}")
        return target


async def fetch_feed(client: httpx.AsyncClient, rec: Recorder, name: str, url: str,
                     label: str = "rss") -> tuple[dict, bytes]:
    entry: dict = {"label": label, "feed": name, "url": url, "t_send_ms": now_ms()}
    try:
        r = await client.get(url)
        body = r.content
        entry.update(status=r.status_code, t_recv_ms=now_ms(), size=len(body),
                     http_version=r.http_version,
                     headers={k: v for k, v in r.headers.items() if k.lower() in HEADERS_KEPT})
        if r.status_code == 200:
            entry.update(summarize_feed(body))
        rec.write(entry, body if label == "rss" else None, name)
        shown = {k: entry.get(k) for k in ("feed", "status", "root", "items")}
        print(json.dumps(shown), flush=True)
        return entry, body
    except httpx.HTTPError as exc:
        entry.update(error=repr(exc), t_recv_ms=now_ms())
        rec.write(entry)
        print(json.dumps({"feed": name, "error": repr(exc)}), flush=True)
        return entry, b""


async def rss_once(client: httpx.AsyncClient, rec: Recorder) -> None:
    for name, url in FEEDS.items():
        await fetch_feed(client, rec, name, url)
        await asyncio.sleep(2)


# --- surveillance ------------------------------------------------------------------

def tree_record(raw: str | bytes, recv_ms: int) -> dict:
    """Message Tree of Alpha → ligne de journal, sans perdre aucun champ."""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    try:
        msg = json.loads(raw)
    except ValueError:
        return {"label": "tree-text", "text": raw[:200], "t_recv_ms": recv_ms}
    if not isinstance(msg, dict):
        return {"label": "tree-other", "raw": msg, "t_recv_ms": recv_ms}
    rec: dict = {"label": "tree", "t_recv_ms": recv_ms, "raw": msg}
    src_ms = msg.get("time")
    if isinstance(src_ms, (int, float)) and src_ms > 1e12:
        rec["lag_ms"] = recv_ms - int(src_ms)
    if "user" in msg and "title" not in msg:      # réponse de connexion : jamais attendue sans clé
        rec["label"] = "tree-login"
        rec["raw"] = {"keys": sorted(msg)}
    return rec


async def watch_tree(rec: Recorder, until: float, stats: dict) -> None:
    attempt = 0
    while time.time() < until:
        try:
            # Python de python.org (macOS) : pas de magasin de certificats système ;
            # même contexte que le collecteur OKX (SSL_CERT_FILE, sinon certifi).
            async with websockets.connect(TREE_WS, ping_interval=20, ping_timeout=10,
                                          open_timeout=10, max_size=2**22,
                                          ssl=ws_ssl_context()) as ws:
                rec.write({"label": "tree-open", "t_ms": now_ms(), "attempt": attempt})
                attempt = 0
                while time.time() < until:
                    try:
                        left = min(30, until - time.time())
                        raw = await asyncio.wait_for(ws.recv(), timeout=left)
                    except TimeoutError:
                        continue
                    line = tree_record(raw, now_ms())
                    if line["label"] == "tree-text" and line["text"].strip().lower() == "ping":
                        await ws.send("pong")
                    rec.write(line)
                    if line["label"] == "tree":
                        stats["tree"] += 1
                        if "lag_ms" in line:
                            stats["tree_lag"].append(line["lag_ms"])
        except (OSError, websockets.WebSocketException, TimeoutError) as exc:
            attempt += 1
            rec.write({"label": "tree-closed", "error": repr(exc)[:200], "t_ms": now_ms(),
                       "attempt": attempt})
            await asyncio.sleep(min(30, 2 ** attempt))


async def watch_fj(client: httpx.AsyncClient, rec: Recorder, until: float, stats: dict) -> None:
    known: set[str] = set()
    first = True
    while time.time() < until:
        entry, body = await fetch_feed(client, rec, "financialjuice", FEEDS["financialjuice"],
                                       "fj-poll")
        if body and entry.get("status") == 200:
            with contextlib.suppress(ET.ParseError):
                for it in ET.fromstring(body).findall("./channel/item"):
                    guid = (it.findtext("guid") or it.findtext("link") or "").strip()
                    if not guid or guid in known:
                        continue
                    known.add(guid)
                    pub_ms = _ms(it.findtext("pubDate"))
                    line = {"label": "fj-item", "guid": guid,
                            "title": (it.findtext("title") or "")[:300], "pub_ms": pub_ms,
                            "t_first_seen_ms": entry["t_recv_ms"], "initial": first}
                    if pub_ms and not first:
                        line["lag_ms"] = entry["t_recv_ms"] - pub_ms
                        stats["fj_lag"].append(line["lag_ms"])
                    rec.write(line)
                    stats["fj"] += 1
            first = False
        await asyncio.sleep(max(0.0, min(60.0, until - time.time())))


def describe_lags(values: list[int]) -> dict | None:
    if not values:
        return None
    s = sorted(values)
    return {"n": len(s), "min_ms": s[0], "median_ms": int(statistics.median(s)),
            "p90_ms": s[min(len(s) - 1, int(len(s) * 0.9))], "max_ms": s[-1]}


async def watch(client: httpx.AsyncClient, rec: Recorder, minutes: float, fj: bool) -> dict:
    until = time.time() + minutes * 60
    stats: dict = {"tree": 0, "tree_lag": [], "fj": 0, "fj_lag": []}
    tasks = [watch_tree(rec, until, stats)]
    if fj:
        tasks.append(watch_fj(client, rec, until, stats))
    await asyncio.gather(*tasks)
    summary = {"label": "summary", "minutes": minutes, "tree_messages": stats["tree"],
               "tree_lag": describe_lags(stats["tree_lag"]), "fj_items": stats["fj"],
               "fj_lag": describe_lags(stats["fj_lag"]), "t_ms": now_ms()}
    rec.write(summary)
    return summary


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="mode", required=True)
    sub.add_parser("rss")
    w = sub.add_parser("watch")
    w.add_argument("--minutes", type=float, default=30)
    w.add_argument("--no-fj", action="store_true", help="Tree of Alpha seul")
    p.add_argument("--out", default=str(ROOT / "data" / "explore" / "news"))
    args = p.parse_args(argv)

    sys.path.insert(0, str(ROOT / "gateway"))
    with contextlib.suppress(ImportError):
        from terminal_gateway.config import load_dotenv
        load_dotenv(ROOT / ".env")

    rec = Recorder(Path(args.out), args.mode)
    rec.write({"label": "start", "mode": args.mode, "platform": sys.platform, "t_ms": now_ms()})

    async def run() -> None:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True,
                                     headers={"User-Agent": user_agent()}) as client:
            if args.mode == "rss":
                await rss_once(client, rec)
            else:
                print(json.dumps(await watch(client, rec, args.minutes, not args.no_fj),
                                 ensure_ascii=False))

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        rec.write({"label": "interrupted", "t_ms": now_ms()})
        print("\nInterrompu : archive partielle.")
    archive = rec.close_and_zip()
    print(f"\nTerminé. Archive à renvoyer dans la conversation : {archive}")


if __name__ == "__main__":
    main()
