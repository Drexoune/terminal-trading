"""Exploration du BLS avant la capture P1 : mesurer, sur le Mac, comment bls.gov publie.

À lancer sur le Mac (décision T-024), depuis la racine du dépôt, avec le Python
de la venv. Volume volontairement faible : le BLS bloque en temps réel les robots
qu'il juge excessifs (« plusieurs fois par seconde ») ou sans contact
(bls.gov/bls/pss.htm). Le User-Agent porte l'adresse dédiée de T-023 :
BLS_CONTACT_EMAIL dans le .env, jamais dans le code.

    python scripts/explore_bls.py probe
        n'importe quel jour : une requête par adresse, 3 s d'écart (environ
        20 requêtes) : pages des communiqués, calendriers, requête conditionnelle.

    python scripts/explore_bls.py burst --event ppi --at "2026-11-13 08:30"
        jour de publication (heure de New York) : une requête à T-10 min et à
        T-60 s, puis UNE requête par seconde de T-3 s à T+60 s, puis toutes les
        10 s jusqu'à T+5 min. Arrêt immédiat sur 403 ou 429. Le script attend
        lui-même l'heure : le lancer avant T-10 min et laisser le Mac allumé
        (il empêche la veille avec caffeinate tant qu'il tourne).

    python scripts/explore_bls.py archives --event cpi --count 36
        une fois : communiqués archivés des 36 dernières publications, une page
        toutes les 5 s (corpus du parseur et historique des premières publications).

Sortie : data/explore/bls/<date>_<mode>/ (requests.jsonl, une ligne par requête,
et chaque réponse distincte) puis une archive .zip à renvoyer dans la conversation.
Les heures sont en ms UTC, corrigées sur l'horloge d'OKX mesurée au début et à la fin.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo("America/New_York")
BLS = "https://www.bls.gov"
API_V1 = "https://api.bls.gov/publicAPI/v1/timeseries/data"  # sans clé (T-023) : 25 requêtes/jour
OKX_REST = "https://eea.okx.com"
VERSION = "0.1"

# Adresse interrogée chaque seconde pendant la rafale, pages relues une fois
# après, séries de l'API v1 (rattrapage seulement : la base est verrouillée
# avant chaque publication).
EVENTS: dict[str, dict] = {
    "cpi": {"primary": f"{BLS}/news.release/cpi.nr0.htm",
            "after": [f"{BLS}/news.release/cpi.htm", f"{BLS}/news.release/cpi.t01.htm"],
            "series": "CUSR0000SA0"},
    "empsit": {"primary": f"{BLS}/news.release/empsit.nr0.htm",
               "after": [f"{BLS}/news.release/empsit.htm", f"{BLS}/news.release/empsit.b.htm"],
               "series": "CES0000000001"},
    "ppi": {"primary": f"{BLS}/news.release/ppi.nr0.htm",
            "after": [f"{BLS}/news.release/ppi.htm", f"{BLS}/news.release/ppi.t01.htm"],
            "series": "WPSFD4"},
    # Productivité et coûts (trimestriel) : répétition de la capture le 08/12 (T-035).
    # Adresses construites comme les autres communiqués, confirmées par la sonde.
    "prod2": {"primary": f"{BLS}/news.release/prod2.nr0.htm",
              "after": [f"{BLS}/news.release/prod2.htm", f"{BLS}/news.release/prod2.t01.htm"],
              "series": "PRS85006092"},
    "claims": {"primary": "https://www.dol.gov/ui/data.pdf", "after": [], "series": None},
}

PROBE_URLS = [
    f"{BLS}/robots.txt",
    f"{BLS}/news.release/cpi.nr0.htm",
    f"{BLS}/news.release/cpi.htm",
    f"{BLS}/news.release/empsit.nr0.htm",
    f"{BLS}/news.release/ppi.nr0.htm",
    f"{BLS}/news.release/ppi.htm",
    f"{BLS}/news.release/prod2.nr0.htm",
    f"{BLS}/schedule/news_release/bls.ics",
    f"{BLS}/schedule/news_release/cpi.htm",
    f"{BLS}/schedule/news_release/empsit.htm",
    f"{BLS}/schedule/news_release/ppi.htm",
    f"{BLS}/schedule/news_release/prod2.htm",
    f"{BLS}/bls/2025-lapse-revised-release-dates.htm",
    f"{BLS}/bls/news-release/cpi.htm",
    f"{BLS}/feed/bls_latest.rss",
    "https://www.dol.gov/ui/data.pdf",
]

# Index des communiqués archivés. Celui de la productivité s'appelle « prod.htm »
# (relevé le 20/11/2026 : « prod2.htm » répond 404), ses communiqués « prod2_MMJJAAAA.htm ».
ARCHIVE_INDEX = {e: f"{BLS}/bls/news-release/{e}.htm" for e in ("cpi", "empsit", "ppi")}
ARCHIVE_INDEX["prod2"] = f"{BLS}/bls/news-release/prod.htm"

TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.S | re.I)
# Mensuel « 2026 M10 Results », trimestriel « 2026 Q03 Results ».
PERIOD_RE = re.compile(r"(\d{4}) (?:M(\d{2})|Q0?([1-4])) Results")
EMBARGO_RE = re.compile(
    r"embargoed\s+until\s+(\d{1,2}:\d{2}\s*[ap]\.?m\.?\s*\(ET\)\s*[A-Za-z]+,\s*[A-Za-z]+\.?\s+\d{1,2},\s*\d{4})",
    re.I)
HEADERS_KEPT = ("date", "last-modified", "etag", "cache-control", "age", "expires", "server",
                "content-type", "content-length", "x-cache", "akamai-grn", "pool-info", "via")


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def contact_user_agent(email: str | None) -> str:
    """User-Agent de T-023 : « terminal-trading/0.1 (<adresse>) », sans URL."""
    email = (email or "").strip()
    if "@" not in email or " " in email or "http" in email.lower() or "/" in email:
        raise SystemExit("BLS_CONTACT_EMAIL absente ou invalide (adresse dédiée attendue, "
                         "sans URL) : la mettre dans le .env (décision T-023).")
    return f"terminal-trading/{VERSION} ({email})"


def describe(body: bytes) -> dict:
    """Ce que la capture lira : titre, période, ligne d'embargo, octets nuls."""
    out: dict = {"null_bytes": body.count(0)}
    m = TITLE_RE.search(body[:20_000])
    if m:
        title = " ".join(m.group(1).decode("utf-8", "replace").split())
        out["title"] = title
        p = PERIOD_RE.search(title)
        if p:
            out["period"] = (f"{p.group(1)}-{p.group(2)}" if p.group(2)
                             else f"{p.group(1)}-Q{p.group(3)}")
    text = " ".join(body[:80_000].decode("utf-8", "replace").split())
    e = EMBARGO_RE.search(text)
    if e:
        out["embargo"] = e.group(1)
    return out


# --- horloge corrigée sur OKX ----------------------------------------------------

async def okx_offset_ms(client: httpx.AsyncClient, samples: int = 5) -> dict:
    """Écart heure OKX - heure locale, échantillon au plus court aller-retour."""
    best: tuple[float, float] | None = None
    for _ in range(samples):
        t0 = now_ms()
        try:
            r = await client.get(f"{OKX_REST}/api/v5/public/time", timeout=5)
            server = int(r.json()["data"][0]["ts"])
        except Exception as exc:  # exploration : on note, on ne s'arrête pas
            return {"error": repr(exc)}
        t1 = now_ms()
        rtt = t1 - t0
        offset = server - (t0 + t1) / 2
        if best is None or rtt < best[1]:
            best = (offset, rtt)
        await asyncio.sleep(0.2)
    assert best is not None
    return {"offset_ms": round(best[0], 1), "rtt_ms": round(best[1], 1)}


# --- enregistrement --------------------------------------------------------------

@dataclass
class Recorder:
    out: Path
    tag: str
    seen: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        stamp = datetime.now(NY).strftime("%Y-%m-%d")
        self.dir = self.out / f"{stamp}_{self.tag}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._log = (self.dir / "requests.jsonl").open("a", encoding="utf-8")

    def write(self, rec: dict, body: bytes | None = None) -> None:
        if body:
            digest = hashlib.sha256(body).hexdigest()[:16]
            rec["sha256_16"] = digest
            if digest not in self.seen:
                self.seen.add(digest)
                name = re.sub(r"[^A-Za-z0-9._-]", "_", rec.get("url", "x").split("//", 1)[-1])[:100]
                (self.dir / f"{name}.{digest}").write_bytes(body)
        self._log.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._log.flush()
        keys = ("label", "status", "ms_total", "period", "size", "null_bytes")
        short = {k: rec.get(k) for k in keys if rec.get(k) is not None}
        print(json.dumps(short, ensure_ascii=False), flush=True)

    def close_and_zip(self) -> Path:
        self._log.close()
        target = self.dir.with_suffix(".zip")
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(self.dir.iterdir()):
                z.write(p, f"{self.dir.name}/{p.name}")
        return target


async def fetch(client: httpx.AsyncClient, rec: Recorder, url: str, label: str,
                headers: dict | None = None) -> tuple[dict, bytes]:
    """Une requête GET, enregistrée ; rend la ligne du journal et le corps."""
    entry: dict = {"label": label, "url": url, "t_send_ms": now_ms()}
    if headers:
        entry["req_headers"] = headers
    t0 = time.perf_counter()
    try:
        async with client.stream("GET", url, headers=headers) as r:
            chunks: list[bytes] = []
            async for chunk in r.aiter_bytes():
                if not chunks:
                    entry["t_first_byte_ms"] = now_ms()
                chunks.append(chunk)
            body = b"".join(chunks)
            entry.update(status=r.status_code, http_version=r.http_version, size=len(body),
                         ms_total=round((time.perf_counter() - t0) * 1000, 1),
                         t_done_ms=now_ms(),
                         headers={k: v for k, v in r.headers.items() if k.lower() in HEADERS_KEPT})
            if body and url.endswith((".htm", ".html", ".rss", ".ics", ".txt")):
                entry.update(describe(body))
            elif body:
                entry["null_bytes"] = body.count(0) if not url.endswith(".pdf") else None
            rec.write(entry, body)
            return entry, body
    except httpx.HTTPError as exc:
        entry.update(error=repr(exc), ms_total=round((time.perf_counter() - t0) * 1000, 1))
        rec.write(entry)
        return entry, b""


def make_client(user_agent: str,
                transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False, transport=transport,
        headers={"User-Agent": user_agent, "Accept-Encoding": "gzip"},
        limits=httpx.Limits(max_connections=2, max_keepalive_connections=2, keepalive_expiry=600))


# --- rafale ----------------------------------------------------------------------

Clock = Callable[[], float]                 # secondes UTC (time.time)
Sleep = Callable[[float], Awaitable[None]]

API_OFFSETS = (65, 125, 185, 305)


def burst_plan(t_release: float, with_api: bool = True) -> list[tuple[float, str]]:
    """Instants (s UTC) et étiquettes des requêtes, dans l'ordre. Une seule requête
    à la fois : l'API v1 (rattrapage, 25 requêtes/jour sans clé) passe dans les
    creux de la fin de rafale, jamais pendant la seconde par seconde."""
    plan = [(t_release - 600, "T-10min"), (t_release - 60, "T-60s")]
    plan += [(t_release + s + 0.05, "burst") for s in range(-3, 61)]
    plan += [(t_release + s, "tail") for s in range(70, 301, 10)]
    if with_api:
        plan += [(t_release + s, f"api-v1-T+{s}s") for s in API_OFFSETS]
    return sorted(plan)


async def run_burst(client: httpx.AsyncClient, rec: Recorder, event: str, t_release: float,
                    clock: Clock = time.time, sleep: Sleep = asyncio.sleep) -> dict:
    ev = EVENTS[event]
    rec.write({"label": "plan", "url": ev["primary"], "event": event,
               "t_release_ms": int(t_release * 1000),
               "release_ny": datetime.fromtimestamp(t_release, NY).isoformat(), "t_ms": now_ms()})
    baseline: str | None = None
    first_new: dict | None = None
    last_before: dict | None = None
    blocked = False
    for at, label in burst_plan(t_release, with_api=bool(ev["series"])):
        if clock() > at + 0.5:      # en retard (veille, lenteur) : on saute, on ne rattrape pas
            continue
        delay = at - clock()
        if delay > 0:
            await sleep(delay)
        if label.startswith("api-v1"):
            await fetch(client, rec, f"{API_V1}/{ev['series']}", label)
            continue
        line, _ = await fetch(client, rec, ev["primary"], label)
        if line.get("status") in (403, 429):
            blocked = True
            rec.write({"label": "blocked", "url": ev["primary"], "status": line["status"],
                       "t_ms": now_ms()})
            break
        if label == "T-60s":
            clock_line = {"label": "okx-clock", "okx_clock": await okx_offset_ms(client)}
            rec.write({**clock_line, "t_ms": now_ms()})
        key = _version_key(line)
        if key is None:
            continue
        if baseline is None:
            baseline = key
        elif key != baseline:
            if first_new is None:
                first_new = line
        elif first_new is None:
            last_before = line
    if not blocked and first_new is not None:
        for u in ev["after"]:
            await sleep(3)
            await fetch(client, rec, u, "after")
    summary: dict = {"label": "summary", "event": event, "blocked": blocked,
                     "t_release_ms": int(t_release * 1000), "baseline": baseline,
                     "first_new": _pick(first_new), "last_before": _pick(last_before),
                     "okx_clock_end": await okx_offset_ms(client), "t_ms": now_ms()}
    if first_new and last_before:
        first_byte = first_new.get("t_first_byte_ms", 0)
        summary["published_between_ms"] = [last_before.get("t_send_ms"), first_byte]
        summary["first_byte_minus_release_ms"] = first_byte - int(t_release * 1000)
    rec.write(summary)
    return summary


def _version_key(line: dict) -> str | None:
    """Version de la page : la période du titre, sinon l'empreinte. Une réponse
    en erreur, vide ou pleine d'octets nuls ne compte pas."""
    if line.get("status") != 200 or not line.get("size") or line.get("null_bytes"):
        return None
    return line.get("period") or line.get("sha256_16")


def _pick(line: dict | None) -> dict | None:
    if not line:
        return None
    return {k: line.get(k) for k in ("label", "status", "period", "embargo", "t_send_ms",
                                      "t_first_byte_ms", "t_done_ms", "headers", "sha256_16")}


# --- modes ------------------------------------------------------------------------

async def probe(client: httpx.AsyncClient, rec: Recorder) -> None:
    rec.write({"label": "okx-clock", "okx_clock": await okx_offset_ms(client), "t_ms": now_ms()})
    for url in PROBE_URLS:
        await fetch(client, rec, url, "probe")
        await asyncio.sleep(3)
    main = f"{BLS}/news.release/cpi.nr0.htm"
    line, _ = await fetch(client, rec, main, "probe-again")
    got = line.get("headers", {})
    if line.get("status") == 200:
        cond = {k: v for k, v in (("If-None-Match", got.get("etag")),
                                  ("If-Modified-Since", got.get("last-modified"))) if v}
        if cond:
            await asyncio.sleep(3)
            await fetch(client, rec, main, "probe-conditional", headers=cond)
    await asyncio.sleep(3)
    await fetch(client, rec, f"{API_V1}/CUSR0000SA0", "probe-api-v1")


async def archives(client: httpx.AsyncClient, rec: Recorder, event: str, count: int) -> None:
    line, body = await fetch(client, rec, ARCHIVE_INDEX[event], "archive-index")
    if line.get("status") != 200:
        return
    pattern = rf"/news\.release/archives/{event}_(\d{{8}})\.htm".encode()
    links = sorted(set(re.findall(pattern, body)),
                   key=lambda d: (d[4:8], d[0:4]), reverse=True)[:count]
    for d in links:
        await asyncio.sleep(5)
        await fetch(client, rec, f"{BLS}/news.release/archives/{event}_{d.decode()}.htm", "archive")


def keep_awake() -> subprocess.Popen | None:
    """macOS : empêche la veille tant que ce process vit (caffeinate -i -w <pid>)."""
    if sys.platform != "darwin":
        return None
    try:
        return subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])
    except OSError:
        print("caffeinate indisponible : garder le Mac éveillé à la main", file=sys.stderr)
        return None


def parse_release_time(at: str) -> float:
    return datetime.strptime(at, "%Y-%m-%d %H:%M").replace(tzinfo=NY).timestamp()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="mode", required=True)
    sub.add_parser("probe")
    b = sub.add_parser("burst")
    b.add_argument("--event", choices=sorted(EVENTS), required=True)
    b.add_argument("--at", required=True, help='heure de New York, "AAAA-MM-JJ HH:MM"')
    a = sub.add_parser("archives")
    a.add_argument("--event", choices=sorted(ARCHIVE_INDEX), required=True)
    a.add_argument("--count", type=int, default=36)
    p.add_argument("--out", default=str(ROOT / "data" / "explore" / "bls"))
    args = p.parse_args(argv)

    sys.path.insert(0, str(ROOT / "gateway"))
    try:
        from terminal_gateway.config import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    ua = contact_user_agent(os.environ.get("BLS_CONTACT_EMAIL"))

    tag = args.mode if args.mode != "burst" else f"burst_{args.event}"
    rec = Recorder(Path(args.out), tag)
    rec.write({"label": "start", "mode": args.mode, "user_agent": ua.split(" (")[0] + " (…)",
               "platform": sys.platform, "python": sys.version.split()[0], "t_ms": now_ms()})

    async def run() -> None:
        async with make_client(ua) as client:
            if args.mode == "probe":
                await probe(client, rec)
            elif args.mode == "burst":
                t_release = parse_release_time(args.at)
                if time.time() > t_release - 600:
                    print("Attention : lancé après T-10 min, "
                          "la mesure avant publication sera incomplète.")
                waiting = t_release - 600 - time.time()
                if waiting > 0:
                    print(f"Attente jusqu'à T-10 min ({waiting / 60:.0f} min). "
                          "Laisser le Mac allumé.")
                await run_burst(client, rec, args.event, t_release)
            else:
                await archives(client, rec, args.event, args.count)

    awake = keep_awake() if args.mode == "burst" else None
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        rec.write({"label": "interrupted", "t_ms": now_ms()})
        print("\nInterrompu : archive partielle.")
    finally:
        if awake:
            awake.terminate()
    archive = rec.close_and_zip()
    print(f"\nTerminé. Archive à renvoyer dans la conversation : {archive}")


if __name__ == "__main__":
    main()
