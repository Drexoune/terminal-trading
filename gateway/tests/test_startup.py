"""Démarrage de la passerelle : demande d'arrêt, paramètres d'instrument."""

import asyncio
import json
import os
import time
from pathlib import Path

import pytest
from terminal_collectors.okx.rest import UNKNOWN_INSTRUMENT, OkxError
from terminal_gateway import __main__ as entry
from terminal_gateway import okx_service
from terminal_gateway.bus import Bus
from terminal_gateway.config import Settings
from terminal_gateway.okx_service import OkxService


def make_settings(tmp_path: Path) -> Settings:
    return Settings(okx_region="eea", instruments=("BTC-USDT-SWAP",), host="x", port=0,
                    allowed_origins=(), log_dir=tmp_path,
                    stop_file=tmp_path / "_control" / "gateway.stop")


def test_stale_stop_request_is_cleared(tmp_path):
    s = make_settings(tmp_path)
    s.stop_file.parent.mkdir(parents=True)
    s.stop_file.write_text("")
    old = time.time() - 60
    os.utime(s.stop_file, (old, old))
    entry.clear_stale_stop(s, started_at=time.time())
    assert not s.stop_file.exists()


def test_stop_request_made_during_startup_is_kept(tmp_path):
    # Arrêt demandé pendant la première seconde : honoré, pas effacé.
    s = make_settings(tmp_path)
    started = time.time() - 1
    s.stop_file.parent.mkdir(parents=True)
    s.stop_file.write_text("")
    entry.clear_stale_stop(s, started_at=started)
    assert s.stop_file.exists()
    entry.clear_stale_stop(make_settings(tmp_path / "vide"))  # absent : rien à faire


class FakeRest:
    def __init__(self, failures: dict[str, list[Exception]]) -> None:
        self.failures = failures
        self.calls: list[str] = []

    async def instrument(self, inst: str) -> dict:
        self.calls.append(inst)
        pending = self.failures.get(inst)
        if pending:
            raise pending.pop(0)
        return {"inst": inst, "ct_val": 0.01}

    async def aclose(self) -> None:
        pass


async def test_instrument_params_are_retried_until_read(tmp_path, monkeypatch):
    monkeypatch.setattr(okx_service, "INSTRUMENTS_RETRY_MIN_S", 0.01)
    bus = Bus()
    svc = OkxService(bus, "eea", ("BTC-USDT-SWAP", "FOO-USDT-SWAP"), tmp_path)
    svc.rest = FakeRest({
        "BTC-USDT-SWAP": [OkxError("délai dépassé"), OkxError("HTTP 503")],
        "FOO-USDT-SWAP": [OkxError("instrument introuvable", code=UNKNOWN_INSTRUMENT)],
    })
    missing = await svc._load_instruments(svc.instruments)
    assert missing == ["BTC-USDT-SWAP"]            # FOO n'existe pas : pas redemandé
    assert "BTC-USDT-SWAP" in svc.health()["instrument_errors"]
    await asyncio.wait_for(svc._instruments_retry(missing), 2)
    assert svc.instrument_meta["BTC-USDT-SWAP"]["ct_val"] == 0.01
    assert bus.get("instrument:BTC-USDT-SWAP")["ct_val"] == 0.01
    assert svc.rest.calls.count("FOO-USDT-SWAP") == 1
    assert svc.health()["instrument_errors"] == {"FOO-USDT-SWAP": "instrument introuvable"}


def test_print_config_is_ascii_json(tmp_path, capsys):
    s = make_settings(tmp_path / "Clément")
    entry.print_config(s)
    out = capsys.readouterr().out
    assert out.isascii()
    assert json.loads(out) == {"health_url": "http://x:0/api/health", "stop_file": str(s.stop_file)}


@pytest.mark.parametrize(("host", "url"), [
    ("0.0.0.0", "http://127.0.0.1:8710/api/health"), ("", "http://127.0.0.1:8710/api/health"),
    ("100.64.0.7", "http://100.64.0.7:8710/api/health"), ("::1", "http://[::1]:8710/api/health")])
def test_local_health_url(tmp_path, host, url):
    s = Settings(okx_region="eea", instruments=(), host=host, port=8710, allowed_origins=(),
                 log_dir=tmp_path, stop_file=tmp_path / "stop")
    assert entry.local_health_url(s) == url


def test_unknown_option_is_refused():
    with pytest.raises(SystemExit, match="--print-config"):
        entry.main(["--stop"])
