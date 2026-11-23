"""Plan « Tout en ligne » (T-042) : la base SQLite de la passerelle et les tables Supabase de
P1 doivent garder les mêmes colonnes, dans le même ordre. Deux mises en œuvre lisent et
écrivent ces tables (Python sur le Mac, TypeScript en ligne) ; une colonne ajoutée d'un
seul côté ferait diverger les données sans bruit."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from terminal_gateway.storage import MIGRATIONS

ROOT = Path(__file__).resolve().parents[2]
PG = ROOT / "supabase" / "migrations" / "20261123120000_p1_online.sql"
TABLES = ("indicators", "calendar_snapshots", "calendar_events", "official_releases", "releases",
          "release_timings", "release_polls", "release_revisions", "release_reactions",
          "alert_rules", "alert_events")
NOT_COLUMNS = ("unique", "primary", "constraint", "foreign", "check", "--")


def sqlite_columns() -> dict[str, list[str]]:
    db = sqlite3.connect(":memory:")
    for migration in MIGRATIONS:
        for sql in migration:
            db.execute(sql)
    return {t: [r[1] for r in db.execute(f"pragma table_info({t})")] for t in TABLES}


def postgres_columns() -> dict[str, list[str]]:
    text = PG.read_text(encoding="utf-8")
    out: dict[str, list[str]] = {}
    for m in re.finditer(r"create table public\.(\w+) \((.*?)\n\);", text, re.S):
        cols = []
        for line in m.group(2).splitlines():
            line = line.strip()
            if line and not line.lower().startswith(NOT_COLUMNS):
                cols.append(line.split()[0])
        out[m.group(1)] = cols
    return out


def test_same_tables_and_columns_in_sqlite_and_supabase():
    pg, lite = postgres_columns(), sqlite_columns()
    assert sorted(pg) == sorted(TABLES)
    for t in TABLES:
        assert pg[t] == lite[t], t


def test_every_p1_table_has_rls_and_no_policy():
    text = PG.read_text(encoding="utf-8")
    for t in TABLES:
        assert f"alter table public.{t:<18} enable row level security;" in text, t
    assert "create policy" not in text.lower()
    revoke = "revoke all on function public.p1_sync_sequences() from public, anon, authenticated"
    assert revoke in text


def test_copy_script_converts_blobs_and_respects_key_kinds():
    import importlib.util

    script = ROOT / "scripts" / "p1_copy_to_supabase.py"
    spec = importlib.util.spec_from_file_location("p1_copy", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.to_json_row({"id": 1, "body": b"\x00<a>", "x": None}) == {
        "id": 1, "body": "\\x003c613e", "x": None}
    assert mod.auth_headers("sb_secret_abc") == {"apikey": "sb_secret_abc"}
    assert mod.auth_headers("eyJxyz")["Authorization"] == "Bearer eyJxyz"
    import pytest
    with pytest.raises(SystemExit):
        mod.auth_headers("sb_publishable_abc")
    rows = [{"body": "x" * 500_000} for _ in range(3)]
    assert [len(b) for b in mod.batches(rows)] == [1, 1, 1]
    assert tuple(mod.TABLES) == TABLES  # même liste, même ordre (clés étrangères)
