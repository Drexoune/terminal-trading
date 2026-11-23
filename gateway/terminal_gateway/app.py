"""Application FastAPI : WebSocket multiplexée /ws et routes REST /api/*.

Protocole /ws (JSON) :

  client -> {"op": "subscribe", "topics": ["ticker:", "trade:", ...]}   préfixes de clés
  client -> {"op": "ping", "id": 7, "t0": <ms navigateur>}
  client -> {"op": "displayed", "key": "release:…", "t_gateway_ms": ms}   chiffre affiché
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
from .services import Service, build_services, needs_storage
from .storage import Storage

log = logging.getLogger(__name__)

# Au plus 20 envois par seconde et par client : l'écran ne rafraîchit pas plus vite.
SEND_INTERVAL_S = 0.05


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def gateway_identity(settings: Settings) -> dict:
    """Machine qui sert la passerelle et mode annoncé (GATEWAY_MODE), sans rien de secret."""
    return {"host": settings.machine, "mode_hint": settings.mode_hint}


def create_app(settings: Settings, service: OkxService | None = None,
               bus: Bus | None = None, services: list[Service] | None = None,
               storage: Storage | None = None) -> FastAPI:
    """`service` : un service OKX (ou de démonstration) seul, comme en P0 ;
    `services` : la liste complète. Sans l'un ni l'autre, GATEWAY_SERVICES décide."""
    bus = bus or Bus()
    if services is None:
        if service is not None:
            services = [service]
        else:
            storage = storage or Storage(settings.db_path)
            services = build_services(settings, bus, storage)
    if storage is None and needs_storage(services):
        storage = Storage(settings.db_path)
    # Service principal des données de marché (graphique, champs historiques de /api/health).
    market = next((s for s in services
                   if getattr(s, "name", "okx") == "okx" or hasattr(s, "chart")), None)
    started_ms = now_ms()
    identity = gateway_identity(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if storage is not None and needs_storage(services):
            await storage.open()
        started: list = []
        try:
            for s in services:
                await s.start()
                started.append(s)
            # Les services publient la source des données ; la passerelle y ajoute la
            # machine et le mode annoncé, quel que soit le service (réel ou démo).
            bus.publish("gateway:meta", {**(bus.get("gateway:meta") or {}), **identity})
            yield
        finally:
            for s in reversed(started):
                try:
                    await s.stop()
                except Exception:
                    log.exception("arrêt du service %s en erreur", getattr(s, "name", s))
            if storage is not None and needs_storage(services):
                await storage.close()

    app = FastAPI(title=f"{APP_NAME} — passerelle", version=VERSION, lifespan=lifespan)
    app.state.bus = bus
    app.state.service = market
    app.state.services = services
    app.state.storage = storage
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_methods=["GET"], allow_headers=["*"])

    @app.get("/api/health")
    async def health() -> dict:
        return {"app": APP_NAME, "version": VERSION, "ts": now_ms(),
                "uptime_s": round((now_ms() - started_ms) / 1000),
                "clients": bus.subscriber_count, **(market.health() if market else {}),
                "services": {getattr(s, "name", "okx"): s.health() for s in services}, **identity}

    @app.get("/api/chart")
    async def chart(inst: str = "BTC-USDT-SWAP", range: str = "1D") -> dict:
        if market is None or not hasattr(market, "chart"):
            raise HTTPException(503, "service OKX non activé (GATEWAY_SERVICES)")
        try:
            return await market.chart(inst, range)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:
            log.warning("graphique %s %s indisponible : %s", inst, range, exc)
            raise HTTPException(502, f"OKX indisponible : {exc}") from exc

    @app.get("/api/calendar")
    async def calendar(week: str | None = None) -> dict:
        svc = next((s for s in services if getattr(s, "name", None) == "calendar"), None)
        if svc is None:
            raise HTTPException(503, "service calendar non activé (GATEWAY_SERVICES)")
        target = week or svc.current_week()
        if target is None:
            raise HTTPException(503, "agenda pas encore relevé")
        try:
            return await svc.week(target)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    def release_service():
        return next((s for s in services if getattr(s, "name", None) == "release"), None)

    @app.get("/api/releases")
    async def releases(indicator: str | None = None, limit: int = 60) -> dict:
        """Publications enregistrées (premières publications), les plus récentes d'abord."""
        if storage is None or release_service() is None:
            raise HTTPException(503, "service release non activé (GATEWAY_SERVICES)")
        limit = max(1, min(limit, 500))
        where, params = (("where indicator_id = ?", (indicator, limit)) if indicator
                         else ("", (limit,)))
        rows = await storage.query(
            f"select * from releases {where} order by scheduled_ms desc limit ?", params)
        return {"releases": rows}

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
                elif op == "displayed":
                    # Heure d'affichage d'un chiffre capté, dans l'horloge de la passerelle
                    # (le navigateur la corrige par ping/pong) : mesure de la porte P1.
                    svc = release_service()
                    if svc is not None:
                        await svc.record_display(str(msg.get("key", "")), msg.get("t_gateway_ms"))
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
