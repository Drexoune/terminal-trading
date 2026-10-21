"""Reconnexion, maintien en vie et journal des coupures, contre un faux serveur OKX."""

import asyncio
import json
import random
import ssl

import certifi
import pytest
import websockets
from terminal_collectors.okx import ws as okx_ws
from terminal_collectors.okx.ws import BACKOFF_MAX_S, OkxStream, backoff_delay

TRADE = {"arg": {"channel": "trades", "instId": "BTC-USDT-SWAP"},
         "data": [{"instId": "BTC-USDT-SWAP", "tradeId": "1", "px": "1", "sz": "1",
                   "side": "buy", "ts": "1", "count": "1"}]}


def test_backoff_grows_and_is_capped():
    rng = random.Random(0)
    delays = [backoff_delay(n, rng) for n in range(1, 12)]
    assert delays[0] >= 1.0                       # 3 connexions/s/IP au plus
    assert delays[3] > delays[0]
    assert max(delays) <= BACKOFF_MAX_S


@pytest.fixture
def fast(monkeypatch):
    monkeypatch.setattr(okx_ws, "KEEPALIVE_S", 0.3)
    monkeypatch.setattr(okx_ws, "backoff_delay", lambda attempt, rng=None: 0.05)


async def run_until(stream, cond, tries=150):
    task = asyncio.create_task(stream.run())
    for _ in range(tries):
        if cond():
            break
        await asyncio.sleep(0.02)
    stream.stop()
    await asyncio.wait_for(task, 2)


async def test_reconnects_after_server_drop_and_logs_outage(fast):
    connections = 0

    async def handler(conn):
        nonlocal connections
        connections += 1
        sub = json.loads(await conn.recv())
        assert sub["op"] == "subscribe"
        await conn.send(json.dumps({"event": "subscribe", "arg": sub["args"][0]}))
        await conn.send(json.dumps(TRADE))
        if connections == 1:
            await conn.close()          # coupure côté serveur
            return
        await asyncio.sleep(5)

    received = []
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}",
                           [{"channel": "trades", "instId": "BTC-USDT-SWAP"}],
                           received.extend)
        await run_until(stream, lambda: connections >= 2 and len(received) >= 2
                        and stream.state.status == "connected")

    assert connections == 2
    assert len(received) == 2
    assert stream.state.reconnects == 1
    assert len(stream.state.outages) == 1 and stream.state.outages[0]["duration_ms"] >= 0


async def test_keepalive_sends_ping_and_reconnects_without_pong(fast):
    pings = 0
    connections = 0

    async def handler(conn):
        nonlocal pings, connections
        connections += 1
        sub = json.loads(await conn.recv())
        await conn.send(json.dumps({"event": "subscribe", "arg": sub["args"][0]}))
        async for msg in conn:          # silence : on ne répond jamais au ping
            if msg == "ping":
                pings += 1

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}", [{"channel": "x"}], lambda e: None)
        await run_until(stream, lambda: connections >= 2)

    assert pings >= 1
    assert connections >= 2, "sans pong, la connexion doit être refaite"


async def test_subscription_error_triggers_reconnect(fast):
    connections = 0

    async def handler(conn):
        nonlocal connections
        connections += 1
        await conn.recv()
        await conn.send(json.dumps({"event": "error", "code": "60018", "msg": "bad"}))
        await asyncio.sleep(1)

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}", [{"channel": "x"}], lambda e: None)
        await run_until(stream, lambda: connections >= 2)
    assert connections >= 2 and "60018" in (stream.state.last_error or "")


async def test_backoff_restarts_after_data_was_received(monkeypatch):
    # Trois coupures, chacune après une donnée reçue : chaque reconnexion
    # repart du délai minimal au lieu de grimper vers le plafond.
    monkeypatch.setattr(okx_ws, "KEEPALIVE_S", 0.3)
    attempts: list[int] = []

    def fake_backoff(attempt, rng=None):
        attempts.append(attempt)
        return 0.02

    monkeypatch.setattr(okx_ws, "backoff_delay", fake_backoff)
    connections = 0

    async def handler(conn):
        nonlocal connections
        connections += 1
        sub = json.loads(await conn.recv())
        await conn.send(json.dumps({"event": "subscribe", "arg": sub["args"][0]}))
        await conn.send(json.dumps(TRADE))
        if connections <= 3:
            await conn.close()
            return
        await asyncio.sleep(5)

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}", [{"channel": "x"}], lambda e: None)
        await run_until(stream, lambda: connections >= 4 and stream.state.status == "connected")
    assert attempts[:3] == [1, 1, 1]


async def test_backoff_grows_when_connection_drops_before_any_data(monkeypatch):
    # Abonnement confirmé puis coupure immédiate, sans donnée : le délai grandit,
    # sinon une connexion malade serait refaite toutes les secondes sans fin.
    monkeypatch.setattr(okx_ws, "KEEPALIVE_S", 0.3)
    attempts: list[int] = []

    def fake_backoff(attempt, rng=None):
        attempts.append(attempt)
        return 0.02

    monkeypatch.setattr(okx_ws, "backoff_delay", fake_backoff)

    async def handler(conn):
        sub = json.loads(await conn.recv())
        await conn.send(json.dumps({"event": "subscribe", "arg": sub["args"][0]}))
        await conn.close()

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}", [{"channel": "x"}], lambda e: None)
        await run_until(stream, lambda: len(attempts) >= 3)
    assert attempts[:3] == [1, 2, 3]


# Réponse réelle d'OKX (wseea, 21/10/2026) à un abonnement mixte : chaque argument
# reçoit sa propre réponse, la connexion reste ouverte et les autres sont servis.
REJECTED_MSG = ("Subscribe failed, wrong URL or channel:tickers,instId:FOO-USDT-SWAP doesn't "
                "exist. Please use the correct URL, channel and parameters referring to API "
                "document.")
GOOD = {"channel": "trades", "instId": "BTC-USDT-SWAP"}
BAD = {"channel": "tickers", "instId": "FOO-USDT-SWAP"}


async def test_rejected_subscription_is_dropped_without_cutting_the_stream(fast):
    connections = 0
    subs: list[list[dict]] = []

    async def handler(conn):
        nonlocal connections
        connections += 1
        sub = json.loads(await conn.recv())
        subs.append(sub["args"])
        for arg in sub["args"]:
            if arg == BAD:
                await conn.send(json.dumps({"event": "error", "code": "60018", "id": "sub",
                                            "msg": REJECTED_MSG, "connId": "484baa70"}))
            else:
                await conn.send(json.dumps({"id": "sub", "event": "subscribe", "arg": arg}))
        await conn.send(json.dumps(TRADE))
        if connections == 1:
            await asyncio.sleep(0.1)
            await conn.close()      # coupure : la reconnexion ne redemande pas FOO
            return
        await asyncio.sleep(5)

    received = []
    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}", [BAD, GOOD], received.extend)
        await run_until(stream, lambda: connections >= 2 and len(received) >= 2)

    assert subs[0] == [BAD, GOOD] and subs[1] == [GOOD]
    assert stream.state.rejected == ["tickers FOO-USDT-SWAP"]
    assert stream.state.snapshot()["rejected"] == ["tickers FOO-USDT-SWAP"]
    assert len(received) >= 2, "BTC continue d'arriver malgré le refus de FOO"


async def test_all_subscriptions_rejected_stops_the_stream(fast):
    connections = 0

    async def handler(conn):
        nonlocal connections
        connections += 1
        await conn.recv()
        await conn.send(json.dumps({"event": "error", "code": "60018", "msg": REJECTED_MSG}))
        await asyncio.sleep(5)

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        stream = OkxStream("t", f"ws://127.0.0.1:{port}", [BAD], lambda e: None)
        task = asyncio.create_task(stream.run())
        await asyncio.wait_for(task, 2)     # s'arrête seul
    assert connections == 1
    assert stream.state.status == "stopped"
    assert "tickers FOO-USDT-SWAP" in (stream.state.last_error or "")


def test_outages_history_is_bounded():
    state = okx_ws.FeedState("t")
    for i in range(okx_ws.OUTAGES_KEPT + 20):
        state.outages.append({"from_ms": i, "to_ms": i + 1, "duration_ms": 1})
    assert len(state.outages) == okx_ws.OUTAGES_KEPT
    shown = state.snapshot()["outages"]
    assert len(shown) == okx_ws.OUTAGES_SHOWN and shown[-1]["from_ms"] == okx_ws.OUTAGES_KEPT + 19


@pytest.mark.parametrize(("url", "with_ssl"), [
    ("wss://wseea.okx.com/ws/v5/public", True), ("ws://127.0.0.1:1", False)])
async def test_certifi_context_only_for_wss(url, with_ssl):
    seen: dict = {}

    class Refused(Exception):
        pass

    def fake_connect(u, **kwargs):
        seen.update(kwargs)
        raise Refused("pas de réseau dans ce test")

    stream = OkxStream("t", url, [GOOD], lambda e: None, connect=fake_connect)
    with pytest.raises(Refused):
        await stream._session()
    assert ("ssl" in seen) is with_ssl
    if with_ssl:
        assert isinstance(seen["ssl"], ssl.SSLContext)


def test_certificate_store_follows_httpx_rules(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(okx_ws.ssl, "create_default_context", lambda **kw: calls.append(kw))
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    okx_ws.ssl_context()
    monkeypatch.setenv("SSL_CERT_DIR", "/etc/certs")
    okx_ws.ssl_context()
    monkeypatch.setenv("SSL_CERT_FILE", "/etc/proxy-ca.pem")
    okx_ws.ssl_context()
    assert calls == [{"cafile": certifi.where()}, {"capath": "/etc/certs"},
                     {"cafile": "/etc/proxy-ca.pem"}]
