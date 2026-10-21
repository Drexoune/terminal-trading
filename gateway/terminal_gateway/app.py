"""Application FastAPI : WebSocket multiplexée /ws et routes REST /api/*.

Protocole /ws (JSON) :

  client -> {"op": "subscribe", "topics": ["ticker:", "trade:", ...]}   préfixes de clés
  client -> {"op": "ping", "id": 7, "t0": <ms navigateur>}
  serveur -> {"type": "hello", "app": ..., "version": ..., "ts_sent": ms}
  serveur -> {"type": "snapshot", "items": [[clé, valeur], ...], "ts_sent": ms}
  serveur -> {"type": "delta", "items": [[clé, valeur], ...], "ts_sent": ms}
  serveur -> {"type": "pong", "id": 7, "t0": ..., "ts": <ms passerelle>}

Le pong permet au navigateur d'estimer l'écart entre son horloge et celle de
la passerelle, donc de mesurer la latence de bout en bout.

/api/health et la clé gateway:meta portent l'identité de la passerelle : la
machine qui la sert (`host`, nom d'hôte du Mac ou de la tour) et le mode
annoncé par GATEWAY_MODE (`mode_hint` : "local", "tour" ou null). Le mode
lui-même se choisit dans le navigateur (docs/modes.md).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import APP_NAME, VERSION
from .bus import Bus
from .config import Settings
from .okx_service import OkxService

log = logging.getLogger(__name__)

# Au plus 20 envois par seconde et par client : l'écran ne rafraîchit pas plus vite.
SEND_INTERVAL_S = 0.05


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def gateway_identity(settings: Settings) -> dict:
    """Machine qui sert la passerelle et mode annoncé (GATEWAY_MODE), sans rien de secret."""
    return {"host": settings.machine, "mode_hint": settings.mode_hint}


def create_app(settings: Settings, service: OkxService | None = None,
               bus: Bus | None = None) -> FastAPI:
    bus = bus or Bus()
    service = service if service is not None else OkxService(
        bus, settings.okx_region, settings.instruments, settings.log_dir)
    started_ms = now_ms()
    identity = gateway_identity(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await service.start()
        # Le service publie la source des données ; la passerelle y ajoute la
        # machine et le mode annoncé, quel que soit le service (réel ou démo).
        bus.publish("gateway:meta", {**(bus.get("gateway:meta") or {}), **identity})
        try:
            yield
        finally:
            await service.stop()

    app = FastAPI(title=f"{APP_NAME} — passerelle", version=VERSION, lifespan=lifespan)
    app.state.bus = bus
    app.state.service = service
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_methods=["GET"], allow_headers=["*"])

    @app.get("/api/health")
    async def health() -> dict:
        return {"app": APP_NAME, "version": VERSION, "ts": now_ms(),
                "uptime_s": round((now_ms() - started_ms) / 1000),
                "clients": bus.subscriber_count, **service.health(), **identity}

    @app.get("/api/chart")
    async def chart(inst: str = "BTC-USDT-SWAP", range: str = "1D") -> dict:
        try:
            return await service.chart(inst, range)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:
            log.warning("graphique %s %s indisponible : %s", inst, range, exc)
            raise HTTPException(502, f"OKX indisponible : {exc}") from exc

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        origin = ws.headers.get("origin")
        if origin is not None and origin not in settings.allowed_origins:
            log.warning("WebSocket refusée pour l'origine %s", origin)
            await ws.close(code=1008)
            return
        await ws.accept()
        lock = asyncio.Lock()

        async def send(obj: dict) -> None:
            async with lock:  # le pong et les deltas partent de deux tâches
                await ws.send_text(json.dumps(obj, separators=(",", ":")))

        await send({"type": "hello", "app": APP_NAME, "version": VERSION, "ts_sent": now_ms()})
        sub = None
        sender: asyncio.Task | None = None

        async def pump() -> None:
            assert sub is not None
            while True:
                items = await sub.next_batch()
                await send({"type": "delta", "items": items, "ts_sent": now_ms()})
                await asyncio.sleep(SEND_INTERVAL_S)

        try:
            while True:
                msg = json.loads(await ws.receive_text())
                op = msg.get("op")
                if op == "ping":
                    await send({"type": "pong", "id": msg.get("id"), "t0": msg.get("t0"),
                                "ts": now_ms()})
                elif op == "subscribe":
                    topics = [str(t) for t in msg.get("topics", [])][:50]
                    if sub is not None:
                        bus.unsubscribe(sub)
                    if sender is not None:
                        sender.cancel()
                    sub = bus.subscribe(topics)
                    snap = list(bus.snapshot(topics).items())
                    await send({"type": "snapshot", "items": snap, "ts_sent": now_ms()})
                    sender = asyncio.create_task(pump())
        except (WebSocketDisconnect, RuntimeError):
            pass
        except json.JSONDecodeError:
            await ws.close(code=1003)
        finally:
            if sender is not None:
                sender.cancel()
            if sub is not None:
                bus.unsubscribe(sub)

    return app
