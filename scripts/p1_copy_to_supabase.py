"""Plan « Tout en ligne », étape O1 : copie des données de P1 du Mac vers Supabase.

Lit la base SQLite de la passerelle (data/terminal.sqlite3, en lecture seule) et envoie
chaque table de P1 aux tables Supabase du même nom (migration
supabase/migrations/20261123120000_p1_online.sql), par l'API REST de Supabase avec la clé
secrète du .env (SUPABASE_URL, SUPABASE_SECRET_KEY ; jamais affichée).

- Rejouable : une ligne déjà présente (même identifiant) est laissée telle quelle.
- Les identifiants sont conservés (liens entre tables) ; les compteurs sont recalés à la fin.
- Contrôle final : nombre de lignes de chaque table, des deux côtés.

Usage, depuis la racine du dépôt :
    .venv/bin/python scripts/p1_copy_to_supabase.py --dry-run   # compte seulement
    .venv/bin/python scripts/p1_copy_to_supabase.py
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "terminal.sqlite3"
# Ordre des clés étrangères : une table référencée passe avant celles qui la citent.
TABLES = ("indicators", "calendar_snapshots", "calendar_events", "official_releases", "releases",
          "release_timings", "release_polls", "release_revisions", "release_reactions",
          "alert_rules", "alert_events")
BATCH_BYTES = 900_000
PREFER = "resolution=ignore-duplicates,return=minimal"  # rejouable : l'existant reste tel quel


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def auth_headers(key: str) -> dict[str, str]:
    """Clé `sb_secret_…` : en-tête apikey seul ; ancienne clé JWT : apikey + Authorization."""
    if key.startswith("sb_publishable_"):
        raise SystemExit("clé publishable refusée : la copie demande la clé secrète")
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def to_json_row(row: dict) -> dict:
    """bytea : texte « \\x… » (hexadécimal), accepté par PostgREST."""
    return {k: ("\\x" + bytes(v).hex()) if isinstance(v, (bytes, memoryview)) else v
            for k, v in row.items()}


def batches(rows: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    cur: list[dict] = []
    size = 0
    for r in rows:
        n = sum(len(str(v)) for v in r.values()) + 50
        if cur and size + n > BATCH_BYTES:
            out.append(cur)
            cur, size = [], 0
        cur.append(r)
        size += n
    if cur:
        out.append(cur)
    return out


def remote_count(client: httpx.Client, base: str, table: str) -> int | None:
    r = client.get(f"{base}/rest/v1/{table}", params={"select": "id", "limit": "1"},
                   headers={"Prefer": "count=exact"})
    if r.status_code >= 300:
        return None
    total = r.headers.get("content-range", "*/").split("/")[-1]
    return int(total) if total.isdigit() else None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dry-run", action="store_true", help="compter sans rien envoyer")
    args = p.parse_args(argv)

    env = read_env(ROOT / ".env")
    url, key = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        print("SUPABASE_URL ou SUPABASE_SECRET_KEY absent du .env", file=sys.stderr)
        return 2
    lite = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    lite.row_factory = sqlite3.Row

    headers = {**auth_headers(key), "Content-Type": "application/json"}
    problems = 0
    with httpx.Client(timeout=60, headers=headers) as client:
        print(f"{'table':22} {'Mac':>6} {'Supabase':>9}")
        for t in TABLES:
            rows = [to_json_row(dict(r)) for r in lite.execute(f"select * from {t} order by 1")]
            if not args.dry_run:
                for chunk in batches(rows):
                    r = client.post(f"{url}/rest/v1/{t}", params={"on_conflict": "id"}, json=chunk,
                                    headers={"Prefer": PREFER})
                    if r.status_code >= 300:
                        print(f"  {t} : HTTP {r.status_code} {r.text[:200]}", file=sys.stderr)
                        problems += 1
                        break
            n = remote_count(client, url, t)
            ok = n is not None and n >= len(rows)
            problems += 0 if ok or args.dry_run else 1
            flag = "" if ok or args.dry_run else "  ← écart"
            print(f"{t:22} {len(rows):6} {('—' if n is None else n):>9}{flag}")
        if not args.dry_run:
            r = client.post(f"{url}/rest/v1/rpc/p1_sync_sequences", json={})
            if r.status_code >= 300:
                print(f"compteurs : HTTP {r.status_code} {r.text[:200]}", file=sys.stderr)
                problems += 1
            else:
                print("compteurs recalés")
    print("copie terminée sans écart" if not problems else f"{problems} problème(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
