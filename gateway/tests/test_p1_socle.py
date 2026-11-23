"""Socle de P1 (étape E1) : bus (suppression, rétention, écouteurs synchrones),
stockage SQLite (WAL, migrations, transactions), configuration des services,
passerelle multi-services."""

from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from terminal_gateway import storage as storage_mod
from terminal_gateway.app import create_app
from terminal_gateway.bus import Bus
from terminal_gateway.config import Settings, parse_contact_email, parse_services
from terminal_gateway.services import build_services
from terminal_gateway.storage import MIGRATIONS, Storage

# --- bus ----------------------------------------------------------------------------


async def test_publishing_none_deletes_and_notifies_clients():
    bus = Bus()
    sub = bus.subscribe(["news:"])
    bus.publish("news:item:1", {"t": 1})
    bus.publish("news:item:1", None)
    assert bus.get("news:item:1") is None
    assert bus.snapshot(["news:"]) == {}
    assert await sub.next_batch() == [("news:item:1", None)]
    bus.delete("news:item:absent")  # supprimer une clé absente ne diffuse rien
    assert not sub._pending


async def test_retention_drops_oldest_keys_under_prefix():
    bus = Bus()
    bus.set_retention("news:item:", 3)
    sub = bus.subscribe(["news:"])
    for k in range(5):
        bus.publish(f"news:item:{k}", {"k": k})
    bus.publish("calendar:next", {"x": 1})
    assert bus.keys("news:item:") == ["news:item:2", "news:item:3", "news:item:4"]
    batch = dict(await sub.next_batch())
    assert batch["news:item:0"] is None and batch["news:item:1"] is None
    with pytest.raises(ValueError):
        bus.set_retention("x:", 0)


def test_sync_listeners_see_every_value_without_conflation():
    bus = Bus()
    seen: list = []
    remove = bus.listen("ticker:", lambda k, v: seen.append((k, v and v["p"])))
    bus.listen("ticker:", lambda k, v: 1 / 0)  # un écouteur en erreur ne bloque pas les autres
    for p in (100, 101, 99):
        bus.publish("ticker:BTC", {"p": p})
    bus.publish("trade:BTC", {"p": 1})
    assert seen == [("ticker:BTC", 100), ("ticker:BTC", 101), ("ticker:BTC", 99)]
    remove()
    bus.publish("ticker:BTC", {"p": 98})
    assert len(seen) == 3


# --- stockage -----------------------------------------------------------------------


async def test_storage_wal_migrations_and_queries(tmp_path):
    db = Storage(tmp_path / "data" / "t.sqlite3")
    assert await db.open() == len(MIGRATIONS)
    assert await db.version() == len(MIGRATIONS)
    mode = await db.query("pragma journal_mode")
    assert mode[0]["journal_mode"] == "wal"
    rowid = await db.execute(
        "insert into indicators (id, label_fr, currency, ff_series, capture)"
        " values (?, ?, ?, ?, ?)",
        ("us-cpi-mm", "IPC américain (m/m)", "USD", "78-us-cpi-mm", 1))
    assert rowid == 1
    rows = await db.query("select id, capture from indicators")
    assert rows == [{"id": "us-cpi-mm", "capture": 1}]
    n = await db.executemany("insert into indicators (id, label_fr, currency) values (?, ?, ?)",
                             [("a", "A", "USD"), ("b", "B", "EUR")])
    assert n == 2
    await db.close()
    # Réouverture : aucune migration rejouée, données intactes.
    db2 = Storage(tmp_path / "data" / "t.sqlite3")
    await db2.open()
    assert len(await db2.query("select * from indicators")) == 3
    await db2.close()


async def test_storage_transaction_rolls_back_on_error(tmp_path):
    db = Storage(tmp_path / "t.sqlite3")
    await db.open()

    def failing(conn: sqlite3.Connection):
        conn.execute("insert into indicators (id, label_fr, currency) values ('x', 'X', 'USD')")
        conn.execute("insert into indicators (id, label_fr, currency) values ('x', 'X', 'USD')")

    with pytest.raises(sqlite3.IntegrityError):
        await db.transaction(failing)
    assert await db.query("select * from indicators") == []
    with pytest.raises(sqlite3.IntegrityError):
        await db.executemany("insert into indicators (id, label_fr, currency) values (?, ?, ?)",
                             [("y", "Y", "USD"), ("y", "Y", "USD")])
    assert await db.query("select * from indicators") == []
    await db.close()


async def test_storage_refuses_newer_database(tmp_path, monkeypatch):
    db = Storage(tmp_path / "t.sqlite3")
    await db.open()
    await db.close()
    monkeypatch.setattr(storage_mod, "MIGRATIONS", [])
    with pytest.raises(RuntimeError, match="plus récent"):
        await Storage(tmp_path / "t.sqlite3").open()


async def test_storage_writes_never_overlap(tmp_path):
    db = Storage(tmp_path / "t.sqlite3")
    await db.open()
    sql = "insert into indicators (id, label_fr, currency) values (?, 'L', 'USD')"
    await asyncio.gather(*(db.execute(sql, (f"i{k}",)) for k in range(50)))
    assert len(await db.query("select id from indicators")) == 50
    await db.close()


# --- configuration ------------------------------------------------------------------


def test_parse_services():
    assert parse_services(None) == ("okx",)
    assert parse_services(" okx , calendar,okx ") == ("okx", "calendar")
    with pytest.raises(ValueError, match="inconnu"):
        parse_services("okx,bourse")


def test_parse_contact_email():
    assert parse_contact_email(None) is None
    assert parse_contact_email(" terminal@exemple.org ") == "terminal@exemple.org"
    with pytest.raises(ValueError):
        parse_contact_email("https://exemple.org")


def make_settings(tmp_path, **over) -> Settings:
    base = Settings(okx_region="eea", instruments=("BTC-USDT-SWAP",), host="127.0.0.1", port=0,
                    allowed_origins=("http://localhost:5173",), log_dir=tmp_path / "logs",
                    stop_file=tmp_path / "stop", machine="mac-test", data_dir=tmp_path / "data",
                    telegram_bot_token="secret-token-123", telegram_chat_id="42")
    return replace(base, **over)


def test_secrets_stay_out_of_repr(tmp_path):
    assert "secret-token-123" not in repr(make_settings(tmp_path))


def test_planned_services_are_refused_until_their_step(tmp_path):
    with pytest.raises(ValueError, match="arrive en E6"):
        build_services(make_settings(tmp_path, services=("okx", "news")), Bus(), None)


# --- passerelle multi-services ------------------------------------------------------


class Svc:
    def __init__(self, name: str, log: list, fail: bool = False, storage: bool = False):
        self.name, self.log, self.fail, self.needs_storage = name, log, fail, storage

    async def start(self):
        if self.fail:
            raise RuntimeError(f"{self.name} ne démarre pas")
        self.log.append(f"start {self.name}")

    async def stop(self):
        self.log.append(f"stop {self.name}")

    def health(self):
        return {"ok": True}


def test_services_start_in_order_stop_in_reverse_and_report_health(tmp_path):
    log: list = []
    settings = make_settings(tmp_path)
    app = create_app(settings, services=[Svc("a", log), Svc("b", log, storage=True)])
    with TestClient(app) as client:
        h = client.get("/api/health").json()
        assert h["services"] == {"a": {"ok": True}, "b": {"ok": True}}
        assert "secret-token-123" not in str(h)
        assert client.get("/api/chart").status_code == 503
        assert (tmp_path / "data" / "terminal.sqlite3").exists()
    assert log == ["start a", "start b", "stop b", "stop a"]


def test_failed_start_stops_services_already_started(tmp_path):
    log: list = []
    app = create_app(make_settings(tmp_path), services=[Svc("a", log), Svc("b", log, fail=True)])
    with pytest.raises(RuntimeError, match="b ne démarre pas"):
        with TestClient(app):
            pass
    assert log == ["start a", "stop a"]
    assert not (tmp_path / "data").exists()  # aucun service n'exige la base
