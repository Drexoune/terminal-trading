"""Protocole de la WebSocket et routes REST, avec un service OKX simulé."""

import socket
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from terminal_gateway.app import create_app
from terminal_gateway.bus import Bus
from terminal_gateway.config import Settings
from terminal_gateway.okx_service import utc_day_start

ORIGIN = "http://localhost:5173"


class FakeService:
    def __init__(self, bus):
        self.bus = bus

    async def start(self):
        self.bus.publish("gateway:meta", {"source": "Données réelles · OKX EEA", "region": "eea"})
        self.bus.publish("ticker:BTC-USDT-SWAP", {"last": 100.0, "ts_source": 1, "ts_recv": 2})

    async def stop(self):
        pass

    async def chart(self, inst, range_):
        if range_ != "1D":
            raise KeyError("période inconnue")
        return {"inst": inst, "range": range_, "candles": []}

    def health(self):
        return {"feeds": []}


def make_settings(tmp_path: Path, **extra) -> Settings:
    return Settings(okx_region="eea", instruments=("BTC-USDT-SWAP",), host="x", port=0,
                    allowed_origins=(ORIGIN,), log_dir=tmp_path,
                    stop_file=tmp_path / "stop", **extra)


@pytest.fixture
def client(tmp_path: Path):
    settings = make_settings(tmp_path, machine="mac-de-clement", mode_hint="local")
    bus = Bus()
    app = create_app(settings, service=FakeService(bus), bus=bus)
    with TestClient(app) as c:
        yield c


def test_snapshot_then_delta(client):
    with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as ws:
        assert ws.receive_json()["type"] == "hello"
        ws.send_json({"op": "subscribe", "topics": ["ticker:"]})
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert snap["items"] == [["ticker:BTC-USDT-SWAP",
                                  {"last": 100.0, "ts_source": 1, "ts_recv": 2}]]
        client.app.state.bus.publish("ticker:BTC-USDT-SWAP", {"last": 101.0})
        delta = ws.receive_json()
        assert delta["type"] == "delta" and delta["items"][0][1]["last"] == 101.0
        assert "ts_sent" in delta


def test_ping_returns_gateway_time(client):
    with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as ws:
        ws.receive_json()
        ws.send_json({"op": "ping", "id": 3, "t0": 123})
        pong = ws.receive_json()
        assert pong["type"] == "pong" and pong["id"] == 3 and pong["t0"] == 123
        assert pong["ts"] > 1_700_000_000_000


def test_foreign_origin_is_refused(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()
    assert exc.value.code == 1008


def test_chart_unknown_range_is_404(client):
    assert client.get("/api/chart?range=9Y").status_code == 404
    assert client.get("/api/chart?range=1D").json()["inst"] == "BTC-USDT-SWAP"


def test_health(client):
    body = client.get("/api/health").json()
    assert body["app"] == "TERMINAL" and "feeds" in body


def test_health_and_meta_name_the_machine_and_mode(client):
    body = client.get("/api/health").json()
    assert body["host"] == "mac-de-clement" and body["mode_hint"] == "local"
    # gateway:meta garde la source publiée par le service et y ajoute l'identité.
    with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as ws:
        ws.receive_json()
        ws.send_json({"op": "subscribe", "topics": ["gateway:"]})
        snap = ws.receive_json()
    assert snap["items"] == [["gateway:meta", {
        "source": "Données réelles · OKX EEA", "region": "eea",
        "host": "mac-de-clement", "mode_hint": "local"}]]


def test_identity_defaults_to_hostname_and_no_mode(tmp_path: Path):
    bus = Bus()
    app = create_app(make_settings(tmp_path), service=FakeService(bus), bus=bus)
    with TestClient(app) as c:
        body = c.get("/api/health").json()
    assert body["host"] == socket.gethostname()
    assert body["mode_hint"] is None
    assert bus.get("gateway:meta")["host"] == socket.gethostname()


def test_cors_allows_configured_origin_only(client):
    ok = client.get("/api/health", headers={"origin": ORIGIN})
    assert ok.headers.get("access-control-allow-origin") == ORIGIN
    other = client.get("/api/health", headers={"origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers


def test_utc_day_start():
    # 20/10/2026 13:36:04 UTC -> 20/10/2026 00:00 UTC
    assert utc_day_start(1792503364000) == 1792454400000
